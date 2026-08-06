/**
 * Live Engine Plugin Implementation
 *
 * TICKET_613: Actor Model live execution engine.
 * TICKET_613_1: Route B - C++ LiveEngine calls compiled strategy directly.
 * TICKET_681: Removed pybind11/Python path (C++ only).
 *
 * Compiles C++ strategy source to .so, loads via dlopen, processes bars
 * through the live ABI (qnx_live_strategy_on_bar), emits signal change
 * events to stdout (JSON).
 */

#include "quantnexus/executor/live/live_engine_plugin.hpp"
#include "quantnexus/executor/config_types.hpp"
#include "quantnexus/executor/cpp_backtest_plugin.hpp"
#include "quantnexus/executor/plugin_loader.hpp"

#include <nlohmann/json.hpp>

#include <iostream>
#include <fstream>
#include <format>
#include <filesystem>
#include <array>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <sstream>

#ifdef _WIN32
    #include <windows.h>
    #define QNX_POPEN _popen
    #define QNX_PCLOSE _pclose
#else
    #include <dlfcn.h>
    #define QNX_POPEN popen
    #define QNX_PCLOSE pclose
#endif

namespace fs = std::filesystem;

namespace StratCraft::executor::live {

namespace {

// TICKET_196_7_7 P2.1: ABI bumped to 2 to introduce the optional
// `qnx_live_strategy_on_alt_data` entry point. v1 strategies (no alt-data) keep
// working only if they declare version 1; v2 strategies MUST export
// `qnx_live_strategy_on_alt_data` -- declaring v2 without the symbol is a
// load-time error.
constexpr int QNX_LIVE_STRATEGY_ABI_VERSION_V1 = 1;
constexpr int QNX_LIVE_STRATEGY_ABI_VERSION_V2 = 2;

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
        escaped += ch == '"' ? "\\\"" : std::string(1, ch);
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

fs::path resolveCompilerPath(const ExecutorConfig& config) {
    if (!config.compilerPath.empty()) {
        return config.compilerPath;
    }
    const std::string envCompiler = envValue("QNX_CPP_COMPILER");
    if (!envCompiler.empty()) {
        return envCompiler;
    }
    const std::string toolchainRoot = envValue("QNX_CPP_TOOLCHAIN");
    if (!toolchainRoot.empty()) {
        fs::path candidate = fs::path(toolchainRoot) / "bin" / ("clang++" + executableExtension());
        if (fs::exists(candidate)) {
            return candidate;
        }
    }
    return "clang++";
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

std::string compileLiveCommand(
    const ExecutorConfig& config,
    const fs::path& compilerPath,
    const fs::path& strategyPath,
    const fs::path& libraryPath
) {
    std::ostringstream command;
    command << shellQuote(compilerPath) << " -std=c++23 -shared";
#ifndef _WIN32
    command << " -fPIC";
#endif
    for (const auto& includePath : config.cppIncludePaths) {
        if (!includePath.empty()) {
            command << " -I" << shellQuote(includePath);
        }
    }
    const std::string envInclude = envValue("QNX_CPP_INCLUDE_PATH");
    if (!envInclude.empty()) {
        command << " -I" << shellQuote(envInclude);
    }
    if (!config.cppHardening.pchPath.empty()) {
        command << " -include-pch " << shellQuote(config.cppHardening.pchPath);
    }
    command << " " << shellQuote(strategyPath)
            << " -o " << shellQuote(libraryPath)
            << " 2>&1";
    return command.str();
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

void* openLibrary(const fs::path& path) {
#ifdef _WIN32
    return reinterpret_cast<void*>(LoadLibraryA(path.string().c_str()));
#else
    return dlopen(path.string().c_str(), RTLD_NOW | RTLD_LOCAL);
#endif
}

void closeLibrary(void* handle) noexcept {
    if (!handle) {
        return;
    }
#ifdef _WIN32
    FreeLibrary(reinterpret_cast<HMODULE>(handle));
#else
    dlclose(handle);
#endif
}

void* loadSymbol(void* handle, const char* name) {
#ifdef _WIN32
    return reinterpret_cast<void*>(GetProcAddress(reinterpret_cast<HMODULE>(handle), name));
#else
    return dlsym(handle, name);
#endif
}

std::string libraryError() {
#ifdef _WIN32
    return std::format("LoadLibrary/GetProcAddress failed with code {}", GetLastError());
#else
    const char* error = dlerror();
    return error ? std::string(error) : "dlopen/dlsym failed";
#endif
}

} // namespace

// =============================================================================
// Execute (IExecutorPlugin)
// =============================================================================

ExecutionResult LiveEnginePlugin::execute(
    const nlohmann::json& config,
    ProgressCallback progressCallback,
    IncrementCallback /* incrementCallback -- not used; live path is async */)
{
    try {
        // Extract paths from config
        std::string strategyPath = config.at("strategyPath").get<std::string>();

        // Store symbol/interval for context
        symbol_ = config.value("symbol", "UNKNOWN");
        interval_ = config.value("interval", "1m");

        if (!fs::exists(strategyPath)) {
            return {false, std::format("Strategy file not found: {}", strategyPath), {}};
        }

        if (progressCallback) {
            progressCallback(5.0, "Compiling C++ live strategy...");
        }

        initializeCppStrategy(config);

        if (progressCallback) {
            progressCallback(10.0, "Strategy loaded, entering event loop...");
        }

        // Enter event loop (blocks until shutdown event). Production reads from
        // std::cin; tests inject a stringstream via the default-arg seam.
        eventLoop(std::cin);

        nlohmann::json resultData;
        resultData["barsProcessed"] = bar_count_;

        return {true, "", resultData};

    } catch (const std::exception& e) {
        return {false, std::format("LiveEngine error: {}", e.what()), {}};
    } catch (...) {
        return {false, "LiveEngine error: unknown exception", {}};
    }
}

void LiveEnginePlugin::initializeCppStrategy(const nlohmann::json& configJson) {
    ExecutorConfig config = configJson.get<ExecutorConfig>();
    const fs::path strategyPath = config.strategyPath;
    const fs::path outputDir = config.outputDir.empty()
        ? strategyPath.parent_path()
        : fs::path(config.outputDir);
    fs::create_directories(outputDir);

    const std::string source = readTextFile(strategyPath);
    const auto validation = validateCppStrategySource(source);
    if (!validation.valid) {
        std::ostringstream errors;
        for (const auto& error : validation.errors) {
            errors << "- " << error << "\n";
        }
        throw std::runtime_error("C++ live strategy validation failed:\n" + errors.str());
    }

    const std::string cacheKey = cppStrategyArtifactCacheKey(
        source,
        config.cppIncludePaths,
        config.cppHardening.pchPath
    );
    const fs::path cacheDir = config.cppHardening.artifactCacheDir.empty()
        ? outputDir / "cpp_live_cache"
        : fs::path(config.cppHardening.artifactCacheDir);
    fs::create_directories(cacheDir);
    const fs::path libraryPath = cacheDir / ("live_" + cacheKey + sharedLibraryExtension());

    if (!config.cppHardening.enableArtifactCache || !fs::exists(libraryPath)) {
        const fs::path compilerPath = resolveCompilerPath(config);
        std::ostringstream compileOutput;
        const int compileCode = runCommandStreaming(
            compileLiveCommand(config, compilerPath, strategyPath, libraryPath),
            [&](const std::string& line) {
                compileOutput << line << "\n";
                if (!line.empty()) {
                    std::cerr << line << "\n";
                }
            }
        );
        if (compileCode != 0 || !fs::exists(libraryPath)) {
            throw std::runtime_error(std::format(
                "C++ live strategy compilation failed with code {}:\n{}",
                compileCode,
                compileOutput.str()
            ));
        }
    }

    // Load new library into temporaries first; only replace the active library
    // after full validation succeeds. This prevents hot-reload from leaving the
    // engine with no strategy if the new library fails to compile or load.
    void* newLibrary = openLibrary(libraryPath);
    if (!newLibrary) {
        throw std::runtime_error(std::format("Failed to load C++ live strategy {}: {}", libraryPath.string(), libraryError()));
    }

    auto newAbiVersion = reinterpret_cast<CppAbiVersionFn>(loadSymbol(newLibrary, "qnx_live_strategy_abi_version"));
    auto newOnBar = reinterpret_cast<CppOnBarFn>(loadSymbol(newLibrary, "qnx_live_strategy_on_bar"));
    auto newReset = reinterpret_cast<CppResetFn>(loadSymbol(newLibrary, "qnx_live_strategy_reset"));
    auto newOnAltData = reinterpret_cast<CppOnAltDataFn>(loadSymbol(newLibrary, "qnx_live_strategy_on_alt_data"));
    if (!newAbiVersion || !newOnBar) {
        closeLibrary(newLibrary);
        throw std::runtime_error("C++ live strategy must export qnx_live_strategy_abi_version and qnx_live_strategy_on_bar");
    }
    const int abi = newAbiVersion();
    if (abi != QNX_LIVE_STRATEGY_ABI_VERSION_V1 && abi != QNX_LIVE_STRATEGY_ABI_VERSION_V2) {
        closeLibrary(newLibrary);
        throw std::runtime_error(std::format(
            "C++ live strategy ABI version mismatch: got {}, supported [{}, {}]",
            abi, QNX_LIVE_STRATEGY_ABI_VERSION_V1, QNX_LIVE_STRATEGY_ABI_VERSION_V2));
    }
    if (abi == QNX_LIVE_STRATEGY_ABI_VERSION_V2 && !newOnAltData) {
        closeLibrary(newLibrary);
        throw std::runtime_error(
            "C++ live strategy declares ABI v2 but does not export qnx_live_strategy_on_alt_data");
    }

    // New library is fully validated - now swap out the old one.
    unloadCppStrategy();
    cpp_library_ = newLibrary;
    cpp_abi_version_ = newAbiVersion;
    cpp_on_bar_ = newOnBar;
    cpp_on_alt_data_ = newOnAltData;  // null for v1 strategies; present for v2
    cpp_reset_ = newReset;
    if (cpp_reset_) {
        cpp_reset_();
    }
    cpp_strategy_path_ = strategyPath.string();
}

void LiveEnginePlugin::unloadCppStrategy() noexcept {
    cpp_abi_version_ = nullptr;
    cpp_on_bar_ = nullptr;
    cpp_on_alt_data_ = nullptr;
    cpp_reset_ = nullptr;
    closeLibrary(cpp_library_);
    cpp_library_ = nullptr;
}

// =============================================================================
// Event Loop (stdin/stdout JSON protocol)
// =============================================================================

void LiveEnginePlugin::eventLoop(std::istream& in) {
    std::string line;

    while (!cancelled() && std::getline(in, line)) {
        if (line.empty()) continue;

        try {
            auto msg = nlohmann::json::parse(line);
            std::string type = msg.at("type").get<std::string>();

            if (type == "bar") {
                auto& data = msg.at("data");
                BarEvent bar{
                    .timestamp = data.at("t").get<int64_t>(),
                    .open = data.at("o").get<double>(),
                    .high = data.at("h").get<double>(),
                    .low = data.at("l").get<double>(),
                    .close = data.at("c").get<double>(),
                    .volume = data.at("v").get<double>(),
                    .bar_index = bar_count_++
                };

                onCppBar(bar);

            } else if (type == "order_filled") {
                auto& data = msg.at("data");
                OrderFilledEvent order{
                    .order_id = data.at("order_id").get<std::string>(),
                    .symbol = data.value("symbol", ""),
                    .side = data.at("side").get<std::string>(),
                    .price = data.at("price").get<double>(),
                    .qty = data.at("qty").get<double>(),
                    .timestamp = data.value("t", static_cast<int64_t>(0))
                };

                fills_.push_back(order);
                std::cerr << std::format(
                    "[LiveEngine] Order filled: {} {} qty={} price={}\n",
                    order.side, order.symbol, order.qty, order.price);
                emitPositionUpdate(order);

            } else if (type == "alt_data") {
                // TICKET_196_7_7 P2.1: alternative-data row delivery. The row
                // body mirrors AlternativeFactorRow (provider_id, series_id,
                // category, symbol, event_time, knowledge_time, value,
                // optional vintage_id). The orchestrator (P2.2, deferred --
                // see ticket audit note) enforces knowledge_time ascending
                // ordering; the engine does not re-sort.
                onCppAltData(msg.at("data"));

            } else if (type == "shutdown") {
                // Acknowledge and exit
                nlohmann::json ack;
                ack["type"] = "shutdown_ack";
                std::cout << ack.dump() << "\n";
                std::cout.flush();
                break;
            } else if (type == "reload_strategy") {
                auto replacement = msg.value("data", nlohmann::json::object()).value("strategyPath", cpp_strategy_path_);
                nlohmann::json reloadConfig = {
                    {"pluginName", "live"},
                    {"language", "cpp"},
                    {"strategyPath", replacement},
                    {"outputDir", fs::path(replacement).parent_path().string()},
                    {"symbol", symbol_},
                    {"interval", interval_},
                };
                initializeCppStrategy(reloadConfig);
                nlohmann::json ack;
                ack["type"] = "strategy_reloaded";
                ack["data"]["strategyPath"] = replacement;
                std::cout << ack.dump() << "\n";
                std::cout.flush();
            }

        } catch (const nlohmann::json::exception& e) {
            nlohmann::json err;
            err["type"] = "error";
            err["data"]["message"] = std::format("JSON parse error: {}", e.what());
            std::cout << err.dump() << "\n";
            std::cout.flush();
        }
    }
}

// =============================================================================
// Bar Processing (C++ Route B)
// =============================================================================

void LiveEnginePlugin::onCppBar(const BarEvent& bar) {
    bars_.push_back(bar);
    if (!cpp_on_bar_) {
        throw std::runtime_error("C++ live strategy is not initialized");
    }

    nlohmann::json barJson;
    barJson["symbol"] = symbol_;
    barJson["interval"] = interval_;
    barJson["bar_index"] = bar.bar_index;
    barJson["t"] = bar.timestamp;
    barJson["o"] = bar.open;
    barJson["h"] = bar.high;
    barJson["l"] = bar.low;
    barJson["c"] = bar.close;
    barJson["v"] = bar.volume;

    const char* response = cpp_on_bar_(barJson.dump().c_str());
    if (response == nullptr || std::string_view(response).empty()) {
        return;
    }

    auto respMsg = nlohmann::json::parse(response);
    const std::string respType = respMsg.value("type", "");
    if (respType == "signal") {
        const int direction = respMsg.value("data", nlohmann::json::object()).value("direction", 0);
        if (direction == 0 || direction == prev_signal_) {
            prev_signal_ = direction;
            return;
        }
        prev_signal_ = direction;
    }

    std::cout << respMsg.dump() << "\n";
    std::cout.flush();
}

// =============================================================================
// Alt-Data Processing (TICKET_196_7_7 P2.1)
// =============================================================================

void LiveEnginePlugin::onCppAltData(const nlohmann::json& row) {
    // Required-field validation. Surface structured error to stdout so the
    // orchestrator (when wired up in P2.2) can route it through useMessage
    // without parsing free-form text -- per CLAUDE.md "NO SILENT FAILURES".
    static constexpr std::array<const char*, 5> kRequired{
        "provider_id", "series_id", "event_time", "knowledge_time", "value"};
    for (const char* field : kRequired) {
        if (!row.contains(field)) {
            nlohmann::json err;
            err["type"] = "error";
            err["data"]["code"] = "ALT_DATA_INVALID";
            err["data"]["message"] = std::format(
                "alt_data row missing required field '{}'", field);
            std::cout << err.dump() << "\n";
            std::cout.flush();
            return;
        }
    }

    // v1 strategies do not subscribe to alt-data. Dropping is correct here:
    // the orchestrator should not have routed alt-data to a v1 strategy in
    // the first place; if it did, the cleanest engine-side behavior is to
    // log and ignore rather than fail a long-running live engine.
    if (!cpp_on_alt_data_) {
        std::cerr << "[LiveEngine] alt_data received but strategy is ABI v1 "
                     "(no qnx_live_strategy_on_alt_data); dropping row\n";
        return;
    }

    const char* response = cpp_on_alt_data_(row.dump().c_str());
    if (response == nullptr || std::string_view(response).empty()) {
        return;
    }

    // Forward any structured response (signal / error / position_update) to
    // stdout verbatim. The strategy is responsible for shape; the engine only
    // validates that it parses as JSON.
    try {
        auto respMsg = nlohmann::json::parse(response);
        std::cout << respMsg.dump() << "\n";
        std::cout.flush();
    } catch (const nlohmann::json::exception& e) {
        nlohmann::json err;
        err["type"] = "error";
        err["data"]["code"] = "ALT_DATA_RESPONSE_INVALID";
        err["data"]["message"] = std::format(
            "qnx_live_strategy_on_alt_data returned malformed JSON: {}", e.what());
        std::cout << err.dump() << "\n";
        std::cout.flush();
    }
}

// =============================================================================
// Signal Emission (stdout JSON)
// =============================================================================

void LiveEnginePlugin::emitSignal(int direction, const BarEvent& bar) {
    nlohmann::json signalMsg;
    signalMsg["type"] = "signal";
    signalMsg["data"]["direction"] = direction;
    signalMsg["data"]["value"] = bar.close;
    signalMsg["data"]["confidence"] = 0.5;
    signalMsg["data"]["reason"] = std::format(
        "Strategy: {} signal", direction > 0 ? "BUY" : "SELL");
    signalMsg["data"]["bar_index"] = bar.bar_index;
    signalMsg["data"]["timestamp"] = bar.timestamp;

    std::cout << signalMsg.dump() << "\n";
    std::cout.flush();
}

// =============================================================================
// Position Update
// =============================================================================

void LiveEnginePlugin::emitPositionUpdate(const OrderFilledEvent& order) {
    nlohmann::json msg;
    msg["type"] = "position_update";
    msg["data"]["order_id"] = order.order_id;
    msg["data"]["symbol"] = order.symbol;
    msg["data"]["side"] = order.side;
    msg["data"]["price"] = order.price;
    msg["data"]["qty"] = order.qty;
    msg["data"]["timestamp"] = order.timestamp;
    msg["data"]["total_fills"] = fills_.size();

    std::cout << msg.dump() << "\n";
    std::cout.flush();
}

// =============================================================================
// Plugin Registration
// =============================================================================

void registerLiveEnginePlugin() {
    PluginLoader::instance().registerBuiltinPlugin(
        std::make_unique<LiveEnginePlugin>()
    );
}

} // namespace StratCraft::executor::live
