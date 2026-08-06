/**
 * C++ Backtest Plugin
 *
 * Compiles a C++23 strategy shared library and delegates execution to
 * stratforge-runner. The runner owns the strategy ABI and result serialization.
 */

#include "quantnexus/executor/cpp_backtest_plugin.hpp"

#include "quantnexus/executor/config_types.hpp"
#include "quantnexus/executor/executor_constants.hpp"
#include "quantnexus/executor/plugin_loader.hpp"

#include <array>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <iomanip>
#include <fstream>
#include <format>
#include <functional>
#include <iostream>
#include <memory>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <system_error>

#ifdef _WIN32
    #define QNX_POPEN _popen
    #define QNX_PCLOSE _pclose
#else
    #define QNX_POPEN popen
    #define QNX_PCLOSE pclose
#endif

namespace fs = std::filesystem;

namespace StratCraft::executor {

namespace {

std::string envValue(const char* name) {
    const char* value = std::getenv(name);
    return value ? std::string(value) : std::string{};
}

std::string shellQuote(const fs::path& path) {
    std::string value = path.string();
#ifdef _WIN32
    std::string escaped;
    escaped.reserve(value.size());
    for (char ch : value) {
        if (ch == '"') {
            escaped += "\\\"";
        } else {
            escaped += ch;
        }
    }
    return "\"" + escaped + "\"";
#else
    std::string escaped;
    escaped.reserve(value.size());
    for (char ch : value) {
        if (ch == '\'') {
            escaped += "'\\''";
        } else {
            escaped += ch;
        }
    }
    return "'" + escaped + "'";
#endif
}

std::string shellQuoteArg(const std::string& value) {
    return shellQuote(fs::path(value));
}

std::string sharedLibraryExtension() {
#ifdef _WIN32
    return ".dll";
#elif __APPLE__
    return ".dylib";
#else
    return ".so";
#endif
}

std::string executableExtension() {
#ifdef _WIN32
    return ".exe";
#else
    return "";
#endif
}

bool startsWith(std::string_view value, std::string_view prefix) {
    return value.starts_with(prefix);
}

std::string trim(std::string_view value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos) {
        return {};
    }
    const auto last = value.find_last_not_of(" \t\r\n");
    return std::string(value.substr(first, last - first + 1));
}

bool isAllowedInclude(std::string_view includeName) {
    static const std::set<std::string_view> standardHeaders = {
        "algorithm", "array", "chrono", "cmath", "cstddef", "cstdint", "cstdlib",
        "cstring", "exception", "functional", "iomanip", "iosfwd", "iostream",
        "limits", "map", "memory", "numeric", "optional", "set", "span", "sstream",
        "stdexcept", "string", "string_view", "tuple", "type_traits", "unordered_map",
        "utility", "variant", "vector"
    };

    return startsWith(includeName, "stratforge/") ||
           startsWith(includeName, "qnx_strategy_sdk/") ||
           standardHeaders.contains(includeName);
}

std::string sanitizeForPatternScan(std::string_view source) {
    std::string sanitized;
    sanitized.reserve(source.size());

    bool inLineComment = false;
    bool inBlockComment = false;
    bool inString = false;
    bool inChar = false;
    bool escaped = false;

    for (size_t i = 0; i < source.size(); ++i) {
        const char ch = source[i];
        const char next = i + 1 < source.size() ? source[i + 1] : '\0';

        if (inLineComment) {
            if (ch == '\n') {
                inLineComment = false;
                sanitized += '\n';
            } else {
                sanitized += ' ';
            }
            continue;
        }

        if (inBlockComment) {
            if (ch == '*' && next == '/') {
                sanitized += ' ';
                sanitized += ' ';
                ++i;
                inBlockComment = false;
            } else {
                sanitized += ch == '\n' ? '\n' : ' ';
            }
            continue;
        }

        if (inString || inChar) {
            if (escaped) {
                escaped = false;
                sanitized += ' ';
                continue;
            }
            if (ch == '\\') {
                escaped = true;
                sanitized += ' ';
                continue;
            }
            if ((inString && ch == '"') || (inChar && ch == '\'')) {
                inString = false;
                inChar = false;
                sanitized += ' ';
            } else {
                sanitized += ch == '\n' ? '\n' : ' ';
            }
            continue;
        }

        if (ch == '/' && next == '/') {
            sanitized += ' ';
            sanitized += ' ';
            ++i;
            inLineComment = true;
            continue;
        }
        if (ch == '/' && next == '*') {
            sanitized += ' ';
            sanitized += ' ';
            ++i;
            inBlockComment = true;
            continue;
        }
        if (ch == '"') {
            inString = true;
            sanitized += ' ';
            continue;
        }
        if (ch == '\'') {
            inChar = true;
            sanitized += ' ';
            continue;
        }

        sanitized += ch;
    }

    return sanitized;
}

std::string fnv1aHex(std::string_view value) {
    uint64_t hash = 14695981039346656037ull;
    for (unsigned char ch : value) {
        hash ^= ch;
        hash *= 1099511628211ull;
    }

    std::ostringstream stream;
    stream << std::hex << std::setw(16) << std::setfill('0') << hash;
    return stream.str();
}

fs::path cacheDirectoryForConfig(const ExecutorConfig& config, const fs::path& outputDir) {
    if (!config.cppHardening.artifactCacheDir.empty()) {
        return config.cppHardening.artifactCacheDir;
    }
    return outputDir / "cpp_cache";
}

bool copyFileIfExists(const fs::path& from, const fs::path& to) {
    if (!fs::exists(from)) {
        return false;
    }
    fs::create_directories(to.parent_path());
    std::error_code error;
    fs::copy_file(from, to, fs::copy_options::overwrite_existing, error);
    return !error && fs::exists(to);
}

std::string runnerFailureMessage(int runnerCode, const std::string& runnerOutput) {
    std::string message = std::format("stratforge-runner failed with code {}", runnerCode);
    if (runnerOutput.find("ABI version mismatch") != std::string::npos) {
        message +=
            ": ABI version mismatch. Rebuild the strategy with qnx_strategy_sdk headers "
            "from the same toolchain bundle as stratforge-runner.";
    } else if (runnerOutput.find("qnx_strategy_abi_version") != std::string::npos) {
        message +=
            ": strategy is missing qnx_strategy_abi_version. Include "
            "<qnx_strategy_sdk/qnx_strategy_sdk.hpp> and add "
            "QNX_STRATEGY_FACTORY_EXPORT(StrategyType).";
    } else if (runnerOutput.find("factory exports") != std::string::npos) {
        message +=
            ": strategy is missing stratforge_create_strategy/stratforge_destroy_strategy. "
            "Use QNX_STRATEGY_FACTORY_EXPORT(StrategyType) in the strategy source.";
    }

    if (!runnerOutput.empty()) {
        message += "\nRunner output:\n" + runnerOutput;
    }
    return message;
}

fs::path resolveCompilerPath(const ExecutorConfig& config) {
    if (!config.compilerPath.empty()) {
        return config.compilerPath;
    }

    std::string envCompiler = envValue("QNX_CPP_COMPILER");
    if (!envCompiler.empty()) {
        return envCompiler;
    }

    std::string toolchainRoot = envValue("QNX_CPP_TOOLCHAIN");
    if (!toolchainRoot.empty()) {
        fs::path candidate = fs::path(toolchainRoot) / "bin" / ("clang++" + executableExtension());
        if (fs::exists(candidate)) {
            return candidate;
        }
    }

    return "clang++";
}

fs::path resolveRunnerPath(const ExecutorConfig& config) {
    if (!config.runnerPath.empty()) {
        return config.runnerPath;
    }

    std::string envRunner = envValue("QNX_NONABT_RUNNER");
    if (!envRunner.empty()) {
        return envRunner;
    }

    return "stratforge-runner" + executableExtension();
}

std::string readTextFile(const fs::path& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error(std::format("Failed to open file: {}", path.string()));
    }

    std::ostringstream buffer;
    buffer << file.rdbuf();
    return buffer.str();
}

void writeTextFile(const fs::path& path, const std::string& content) {
    std::ofstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error(std::format("Failed to write file: {}", path.string()));
    }
    file << content;
}

int runCommandStreaming(
    const std::string& command,
    const std::function<void(const std::string&)>& onLine
) {
    std::array<char, 4096> buffer{};
    std::string pending;

    FILE* pipe = QNX_POPEN(command.c_str(), "r");
    if (!pipe) {
        throw std::runtime_error("Failed to start subprocess");
    }

    while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe) != nullptr) {
        pending += buffer.data();

        size_t newline = std::string::npos;
        while ((newline = pending.find('\n')) != std::string::npos) {
            std::string line = pending.substr(0, newline);
            if (!line.empty() && line.back() == '\r') {
                line.pop_back();
            }
            onLine(line);
            pending.erase(0, newline + 1);
        }
    }

    if (!pending.empty()) {
        onLine(pending);
    }

    return QNX_PCLOSE(pipe);
}

void forwardRunnerLine(
    const std::string& line,
    ProgressCallback progressCallback,
    IncrementCallback incrementCallback,
    CppBacktestPlugin& plugin
) {
    if (line.empty()) {
        return;
    }

    std::cout << line << "\n";
    std::cout.flush();

    static const std::regex progressRegex(R"(\[\s*(\d+(?:\.\d+)?)%\]\s*(.*))");
    static const std::regex phaseRegex(R"(\[PHASE\]\s*(.*))");
    // TICKET_789 step 4: parse the streaming protocol tag emitted by
    // stratforge-runner (per IncrementBatcher flush). The wire shape is
    // authored in stratforge/observers/increment_wire.hpp (pinned via
    // 08679e1) and matches IncrementalResult's JSON contract. [FINAL_SEQ]
    // is intentionally not forwarded here -- it exists only for the
    // direct-spawn IPC boundary (executor-service.ts); in-process plugin
    // hosts learn that the stream is done when execute() returns.
    static const std::regex incrementV2Regex(R"(\[INCREMENT_V2\]\s*(.*))");

    std::smatch match;
    if (std::regex_match(line, match, progressRegex)) {
        float percent = std::stof(match[1].str());
        plugin.setProgress(percent);
        if (progressCallback) {
            progressCallback(percent, match[2].str());
        }
        return;
    }

    if (std::regex_match(line, match, phaseRegex) && progressCallback) {
        progressCallback(plugin.progress(), match[1].str());
        return;
    }

    if (incrementCallback && std::regex_match(line, match, incrementV2Regex)) {
        try {
            auto payload = nlohmann::json::parse(match[1].str());
            incrementCallback(payload.get<IncrementalResult>());
        } catch (const std::exception&) {
            // Malformed [INCREMENT_V2] line -- drop the increment, do not
            // break the run. The runner's golden-master test (frozen at
            // upstream pin) is the regression gate; a parse failure here
            // means runner and pin have drifted out of sync and should be
            // diagnosed via TICKET_789_2's runner-identity log.
        }
    }
}

std::string compileCommand(
    const ExecutorConfig& config,
    const fs::path& compilerPath,
    const fs::path& strategyPath,
    const fs::path& strategyLibraryPath
) {
    std::ostringstream command;
    command << shellQuote(compilerPath)
            << " -std=c++23 -shared";

#ifndef _WIN32
    command << " -fPIC";
#endif

    for (const auto& includePath : config.cppIncludePaths) {
        if (!includePath.empty()) {
            command << " -I" << shellQuoteArg(includePath);
        }
    }

    std::string envInclude = envValue("QNX_CPP_INCLUDE_PATH");
    if (!envInclude.empty()) {
        command << " -I" << shellQuoteArg(envInclude);
    }

    if (!config.cppHardening.pchPath.empty()) {
        command << " -include-pch " << shellQuoteArg(config.cppHardening.pchPath);
    }

    command << " " << shellQuote(strategyPath)
            << " -o " << shellQuote(strategyLibraryPath)
            << " 2>&1";
    return command.str();
}

} // anonymous namespace

CppStrategyValidationResult validateCppStrategySource(std::string_view source) {
    CppStrategyValidationResult result;

    static const std::regex includeRegex(R"(^\s*#\s*include\s*([<"])([^>"]+)[>"])");
    static const std::vector<std::string_view> unsafePatterns = {
        " system(",
        "::system(",
        "std::system(",
        "popen(",
        "_popen(",
        "fork(",
        "execv",
        "CreateProcess",
        "LoadLibrary",
        "dlopen(",
        "dlsym(",
        "std::filesystem",
        "<filesystem>",
        "#pragma",
        "__asm",
        " asm("
    };

    const std::string sanitizedSource = sanitizeForPatternScan(source);
    std::istringstream rawLines{std::string(source)};
    std::istringstream sanitizedLines{sanitizedSource};
    std::string line;
    std::string sanitizedLine;
    int lineNumber = 0;
    while (std::getline(rawLines, line)) {
        std::getline(sanitizedLines, sanitizedLine);
        ++lineNumber;

        std::smatch match;
        if (std::regex_search(line, match, includeRegex)) {
            const std::string delimiter = match[1].str();
            const std::string includeName = trim(match[2].str());
            if (delimiter == "\"") {
                result.errors.push_back(std::format(
                    "line {}: local quoted includes are not allowed: \"{}\"",
                    lineNumber,
                    includeName
                ));
            } else if (!isAllowedInclude(includeName)) {
                result.errors.push_back(std::format(
                    "line {}: include <{}> is not allowed; use stratforge/*, qnx_strategy_sdk/*, or approved C++ standard headers",
                    lineNumber,
                    includeName
                ));
            }
        }

        for (std::string_view pattern : unsafePatterns) {
            if (sanitizedLine.find(pattern) != std::string::npos) {
                result.errors.push_back(std::format(
                    "line {}: unsafe C++ strategy pattern rejected: {}",
                    lineNumber,
                    pattern
                ));
            }
        }
    }

    result.valid = result.errors.empty();
    return result;
}

std::string cppStrategyArtifactCacheKey(
    std::string_view source,
    const std::vector<std::string>& includePaths,
    std::string_view pchPath
) {
    std::ostringstream material;
    material << "cpp_backtest:v1\n";
    material << source << "\n";
    for (const auto& includePath : includePaths) {
        material << "I=" << includePath << "\n";
    }
    material << "PCH=" << pchPath << "\n";
    return fnv1aHex(material.str());
}

std::string hardenCppRunnerCommand(
    std::string_view runnerCommand,
    const CppRunnerHardeningOptions& options
) {
    std::string command{runnerCommand};

#ifdef _WIN32
    (void)options;
    return command;
#elif __APPLE__
    std::ostringstream wrapped;
    if (options.cpuTimeSeconds > 0) {
        wrapped << "ulimit -t " << options.cpuTimeSeconds << "; ";
    }
    if (options.memoryLimitMb > 0) {
        wrapped << "ulimit -v " << (options.memoryLimitMb * 1024) << "; ";
    }
    if (options.enableSandbox) {
        wrapped << "sandbox-exec -p '(version 1)(allow default)' ";
    }
    wrapped << command;
    return wrapped.str();
#else
    std::ostringstream wrapped;
    if (options.cpuTimeSeconds > 0 || options.memoryLimitMb > 0) {
        wrapped << "(";
        if (options.cpuTimeSeconds > 0) {
            wrapped << "ulimit -t " << options.cpuTimeSeconds << "; ";
        }
        if (options.memoryLimitMb > 0) {
            wrapped << "ulimit -v " << (options.memoryLimitMb * 1024) << "; ";
        }
        if (options.enableSandbox) {
            wrapped << "if command -v setpriv >/dev/null 2>&1; then "
                    << "exec setpriv --no-new-privs -- " << command << "; "
                    << "else exec " << command << "; fi";
        } else {
            wrapped << "exec " << command;
        }
        wrapped << ")";
        return wrapped.str();
    }
    if (options.enableSandbox) {
        return "if command -v setpriv >/dev/null 2>&1; then exec setpriv --no-new-privs -- " +
               command + "; else exec " + command + "; fi";
    }
    return command;
#endif
}

ExecutionResult CppBacktestPlugin::execute(
    const nlohmann::json& configJson,
    ProgressCallback progressCallback,
    IncrementCallback incrementCallback
) {
    cancelled_.store(false, std::memory_order_release);
    setProgress(0.0f);

    auto startTime = std::chrono::steady_clock::now();
    ExecutionResult result;

    try {
        ExecutorConfig config = configJson.get<ExecutorConfig>();
        fs::path strategyPath = config.strategyPath;
        fs::path outputDir = config.outputDir;

        if (strategyPath.empty()) {
            throw std::runtime_error("strategyPath is required for cpp_backtest");
        }
        if (!fs::exists(strategyPath)) {
            throw std::runtime_error(std::format("C++ strategy file not found: {}", strategyPath.string()));
        }
        if (outputDir.empty()) {
            throw std::runtime_error("outputDir is required for cpp_backtest");
        }

        const std::string strategySource = readTextFile(strategyPath);
        const auto validation = validateCppStrategySource(strategySource);
        if (!validation.valid) {
            std::ostringstream errors;
            for (const auto& error : validation.errors) {
                errors << "- " << error << "\n";
            }
            throw std::runtime_error("C++ strategy validation failed:\n" + errors.str());
        }

        fs::create_directories(outputDir);
        fs::path buildDir = outputDir / "cpp_build";
        fs::create_directories(buildDir);

        fs::path strategyLibraryPath = buildDir / ("strategy" + sharedLibraryExtension());
        fs::path runnerConfigPath = buildDir / "backtest_config.json";
        fs::path resultPath = outputDir / constants::OUTPUT_RESULT_FILENAME;
        const std::string cacheKey = cppStrategyArtifactCacheKey(
            strategySource,
            config.cppIncludePaths,
            config.cppHardening.pchPath
        );
        const fs::path cachedLibraryPath = cacheDirectoryForConfig(config, outputDir) /
            (cacheKey + sharedLibraryExtension());

        writeTextFile(runnerConfigPath, configJson.dump(2));

        bool usedCachedArtifact = false;
        if (!config.cppStrategyArtifactPath.empty()) {
            usedCachedArtifact = copyFileIfExists(config.cppStrategyArtifactPath, strategyLibraryPath);
            if (!usedCachedArtifact) {
                throw std::runtime_error(std::format(
                    "Configured C++ strategy artifact not found: {}",
                    config.cppStrategyArtifactPath
                ));
            }
        } else if (config.cppHardening.enableArtifactCache) {
            usedCachedArtifact = copyFileIfExists(cachedLibraryPath, strategyLibraryPath);
        }

        if (usedCachedArtifact) {
            if (progressCallback) {
                progressCallback(15.0, "Using precompiled C++ strategy artifact");
            }
            setProgress(15.0f);
        } else {
            if (progressCallback) {
                progressCallback(5.0, "Compiling strategy");
            }
            setProgress(5.0f);
            std::cout << constants::OUTPUT_PHASE_PREFIX << "compiling_strategy\n";
            std::cout.flush();

            fs::path compilerPath = resolveCompilerPath(config);
            std::ostringstream compileOutput;
            int compileCode = runCommandStreaming(
                compileCommand(config, compilerPath, strategyPath, strategyLibraryPath),
                [&](const std::string& line) {
                    compileOutput << line << "\n";
                    if (!line.empty()) {
                        std::cout << line << "\n";
                        std::cout.flush();
                    }
                }
            );

            if (compileCode != 0 || !fs::exists(strategyLibraryPath)) {
                throw std::runtime_error(std::format(
                    "C++ strategy compilation failed with code {}:\n{}",
                    compileCode,
                    compileOutput.str()
                ));
            }

            if (config.cppHardening.enableArtifactCache) {
                copyFileIfExists(strategyLibraryPath, cachedLibraryPath);
            }
        }

        if (cancelled()) {
            result.success = false;
            result.errorMessage = "Execution cancelled";
            return result;
        }

        if (progressCallback) {
            progressCallback(20.0, "Running C++ backtest");
        }
        setProgress(20.0f);

        fs::path runnerPath = resolveRunnerPath(config);
        std::ostringstream runnerCommand;
        runnerCommand << shellQuote(runnerPath)
                      << " --strategy=" << shellQuote(strategyLibraryPath)
                      << " --config=" << shellQuote(runnerConfigPath)
                      << " --output=" << shellQuote(resultPath)
                      << " 2>&1";
        CppRunnerHardeningOptions hardeningOptions{
            .enableSandbox = config.cppHardening.enableSandbox,
            .cpuTimeSeconds = config.cppHardening.runnerCpuTimeSeconds,
            .memoryLimitMb = config.cppHardening.runnerMemoryLimitMb,
        };

        std::ostringstream runnerOutput;
        int runnerCode = runCommandStreaming(
            hardenCppRunnerCommand(runnerCommand.str(), hardeningOptions),
            [&](const std::string& line) {
                runnerOutput << line << "\n";
                forwardRunnerLine(line, progressCallback, incrementCallback, *this);
            }
        );

        if (runnerCode != 0) {
            throw std::runtime_error(runnerFailureMessage(runnerCode, runnerOutput.str()));
        }
        if (!fs::exists(resultPath)) {
            throw std::runtime_error(std::format("stratforge-runner did not write result file: {}", resultPath.string()));
        }

        result.data = nlohmann::json::parse(readTextFile(resultPath));
        result.success = result.data.value("success", true);
        result.errorMessage = result.data.value("errorMessage", "");

        auto endTime = std::chrono::steady_clock::now();
        if (!result.data.contains("executionTimeMs")) {
            result.data["executionTimeMs"] = std::chrono::duration_cast<std::chrono::milliseconds>(
                endTime - startTime
            ).count();
        }

        setProgress(100.0f);
        if (progressCallback) {
            progressCallback(100.0, "Done");
        }

    } catch (const std::exception& ex) {
        result.success = false;
        result.errorMessage = ex.what();
        result.data = {
            {"success", false},
            {"errorMessage", result.errorMessage}
        };
    }

    return result;
}

void CppBacktestPlugin::cancel() noexcept {
    cancelled_.store(true, std::memory_order_release);
}

void registerCppBacktestPlugin() {
    PluginLoader::instance().registerBuiltinPlugin(
        std::make_unique<CppBacktestPlugin>()
    );
}

} // namespace StratCraft::executor
