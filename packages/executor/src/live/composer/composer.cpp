// TICKET_794 Phase 1 -- composer orchestration.

#include "composer.hpp"
#include "cache.hpp"
#include "source_emitter.hpp"
#include "composer_templates_embed.hpp"  // kNlohmannJsonIncludeDir, kStratforgeIncludeDirs

#include <array>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>

#ifdef _WIN32
#define QNX_POPEN _popen
#define QNX_PCLOSE _pclose
#else
#include <sys/wait.h>
#define QNX_POPEN popen
#define QNX_PCLOSE pclose
#endif

namespace fs = std::filesystem;

namespace stratforge::live::composer {

const char* errorCodeName(ErrorCode code) noexcept {
    switch (code) {
        case ErrorCode::Ok: return "OK";
        case ErrorCode::InputInvalid: return "COMPOSER_INPUT_INVALID";
        case ErrorCode::LanguageMismatch: return "COMPOSER_LANGUAGE_MISMATCH";
        case ErrorCode::ComponentMissing: return "COMPOSER_COMPONENT_MISSING";
        case ErrorCode::IndicatorNotAvailable: return "COMPOSER_INDICATOR_NOT_AVAILABLE";
        case ErrorCode::ToolchainMissing: return "COMPOSER_TOOLCHAIN_MISSING";
        case ErrorCode::CompileFailed: return "COMPOSER_COMPILE_FAILED";
        case ErrorCode::Internal: return "COMPOSER_INTERNAL";
    }
    return "COMPOSER_INTERNAL";
}

namespace {

const char* requireString(const nlohmann::json& obj, const char* key) {
    auto it = obj.find(key);
    if (it == obj.end() || !it->is_string()) {
        throw ComposerError(ErrorCode::InputInvalid,
                            std::string("missing or non-string field '") + key + "'");
    }
    return it->get_ref<const std::string&>().c_str();
}

std::string optionalString(const nlohmann::json& obj, const char* key) {
    auto it = obj.find(key);
    if (it == obj.end() || it->is_null()) return {};
    if (it->is_string()) return it->get<std::string>();
    return it->dump();  // numbers etc. flattened.
}

// TICKET_794 sec 4: Python heuristics. Reject before compile.
void enforceLanguageGate(const std::vector<Component>& components) {
    static const std::regex pyClass(R"(class\s+\w+\s*\(\s*bt\.Strategy\s*\))");
    static const std::regex pyImport(R"(import\s+backtrader)");
    static const std::regex pyNext(R"(def\s+next\s*\(\s*self)");
    for (const auto& c : components) {
        if (std::regex_search(c.algorithmCode, pyClass) ||
            std::regex_search(c.algorithmCode, pyImport) ||
            std::regex_search(c.algorithmCode, pyNext)) {
            throw ComposerError(
                ErrorCode::LanguageMismatch,
                "component '" + c.role + "' contains Python (backtrader) source",
                "see TICKET_661_1 for legacy Python -> C++ migration");
        }
    }
}

fs::path resolveCompiler(const std::string& compilerPath) {
    if (!compilerPath.empty()) {
        if (!fs::exists(compilerPath)) {
            throw ComposerError(ErrorCode::ToolchainMissing,
                                "compilerPath does not exist: " + compilerPath);
        }
        return compilerPath;
    }
    if (const char* env = std::getenv("CXX"); env && *env) {
        return env;
    }
    // Fall back to "c++" on PATH; the compile step itself will fail with
    // COMPOSER_TOOLCHAIN_MISSING if exec lookup fails.
    return "c++";
}

// TICKET_1125 Phase 5: strategy .so flags aligned with the executor library
// build (-O3 + LTO, optional native arch). QNX_COMPOSER_NATIVE_ARCH carries
// the CMake EXECUTOR_NATIVE_ARCH switch into this binary as the build-time
// default; QNX_LIVE_COMPOSER_NATIVE_ARCH=0/1 overrides it at runtime (flag
// matrix tests, producing a distributable .so from a native-arch build).
#ifndef QNX_COMPOSER_NATIVE_ARCH
#define QNX_COMPOSER_NATIVE_ARCH 0
#endif

constexpr const char* kStrategyBaseFlags =
    "-std=c++23 -O3 -flto -fPIC -shared -Wno-unused-parameter";
constexpr const char* kNativeArchFlag = "-march=native";

bool nativeArchEnabled() {
    if (const char* env = std::getenv("QNX_LIVE_COMPOSER_NATIVE_ARCH"); env && *env) {
        return std::string_view(env) != "0";
    }
    return QNX_COMPOSER_NATIVE_ARCH != 0;
}

std::string strategyCompileFlags() {
    std::string flags = kStrategyBaseFlags;
    if (nativeArchEnabled()) {
        flags += ' ';
        flags += kNativeArchFlag;
    }
    return flags;
}

std::string shellQuote(std::string_view value) {
    std::string out;
    out.reserve(value.size() + 2);
    out.push_back('\'');
    for (char ch : value) {
        if (ch == '\'') out.append("'\\''");
        else out.push_back(ch);
    }
    out.push_back('\'');
    return out;
}

struct CompileResult {
    int exitCode = 0;
    std::string stderrTail;  // last ~4KB of compiler stderr for hints.
};

CompileResult runCompiler(const fs::path& compiler,
                          const std::string& compileFlags,
                          const fs::path& sourcePath,
                          const fs::path& outputPath) {
    std::ostringstream cmd;
    cmd << shellQuote(compiler.string()) << ' ' << compileFlags;
    for (const auto* inc : kStratforgeIncludeDirs) {
        if (inc && *inc) {
            cmd << " -I" << shellQuote(inc);
        }
    }
    if (kNlohmannJsonIncludeDir && *kNlohmannJsonIncludeDir) {
        cmd << " -I" << shellQuote(kNlohmannJsonIncludeDir);
    }
    cmd << ' ' << shellQuote(sourcePath.string())
        << " -o " << shellQuote(outputPath.string())
        << " 2>&1";

    std::FILE* pipe = QNX_POPEN(cmd.str().c_str(), "r");
    if (pipe == nullptr) {
        throw ComposerError(ErrorCode::ToolchainMissing,
                            "failed to spawn compiler subprocess");
    }
    std::string buffer;
    char chunk[4096];
    while (std::fgets(chunk, sizeof(chunk), pipe) != nullptr) {
        buffer.append(chunk);
    }
    const int rc = QNX_PCLOSE(pipe);
    CompileResult result;
#ifdef _WIN32
    result.exitCode = rc;
#else
    result.exitCode = WIFEXITED(rc) ? WEXITSTATUS(rc) : rc;
#endif
    // Cap stderr tail at 4 KB so the JSON error stays bounded.
    constexpr std::size_t kMaxTail = 4096;
    if (buffer.size() > kMaxTail) {
        result.stderrTail = buffer.substr(buffer.size() - kMaxTail);
    } else {
        result.stderrTail = std::move(buffer);
    }
    return result;
}

} // namespace

ComposerInput Composer::parseInput(const nlohmann::json& doc) {
    if (!doc.is_object()) {
        throw ComposerError(ErrorCode::InputInvalid, "input must be a JSON object");
    }
    ComposerInput in;
    in.strategyId = requireString(doc, "strategyId");
    in.symbol = requireString(doc, "symbol");
    in.timeframe = requireString(doc, "timeframe");
    in.stratforgeVersion = requireString(doc, "stratforgeVersion");
    in.compilerPath = optionalString(doc, "compilerPath");
    auto hardIt = doc.find("cppHardening");
    in.cppHardening = (hardIt != doc.end() && hardIt->is_boolean()) ? hardIt->get<bool>() : false;

    auto compsIt = doc.find("components");
    if (compsIt == doc.end() || !compsIt->is_array() || compsIt->empty()) {
        throw ComposerError(ErrorCode::InputInvalid,
                            "'components' must be a non-empty array");
    }
    int counts[3] = {0, 0, 0};
    for (const auto& cj : *compsIt) {
        if (!cj.is_object()) {
            throw ComposerError(ErrorCode::InputInvalid, "each component must be a JSON object");
        }
        Component c;
        c.role = requireString(cj, "role");
        if (c.role != "analysis" && c.role != "entry" && c.role != "exit") {
            throw ComposerError(ErrorCode::InputInvalid,
                                "component role must be one of analysis/entry/exit, got '" + c.role + "'");
        }
        c.algorithmId = optionalString(cj, "algorithmId");
        c.algorithmName = optionalString(cj, "algorithmName");
        c.algorithmCode = requireString(cj, "algorithmCode");
        if (c.algorithmCode.empty()) {
            throw ComposerError(ErrorCode::InputInvalid,
                                "component role='" + c.role + "' has empty algorithmCode");
        }
        c.baseClass = optionalString(cj, "baseClass");
        c.timeframe = optionalString(cj, "timeframe");
        c.parameters = optionalString(cj, "parameters");
        auto soIt = cj.find("sortOrder");
        c.sortOrder = (soIt != cj.end() && soIt->is_number_integer()) ? soIt->get<int>() : 0;
        const std::size_t idx = (c.role == "analysis") ? 0 : (c.role == "entry") ? 1 : 2;
        ++counts[idx];
        in.components.push_back(std::move(c));
    }
    if (counts[0] != 1 || counts[1] != 1 || counts[2] > 1) {
        throw ComposerError(ErrorCode::ComponentMissing,
                            "components must contain exactly 1 analysis, 1 entry, and 0-1 exit (got " +
                            std::to_string(counts[0]) + "/" + std::to_string(counts[1]) + "/" +
                            std::to_string(counts[2]) + ")");
    }
    return in;
}

ComposerOutput Composer::compose(const ComposerInput& input,
                                 const fs::path& outputOverride) {
    enforceLanguageGate(input.components);

    EmittedSource emitted = emitComposedSource(input);

    const std::string compileFlags = strategyCompileFlags();

    // Cache key per sec 7, extended by TICKET_1125 Phase 5: compile flags and
    // the codegen version are part of the artifact identity, so a flag change
    // or an emitter change can never serve a stale cached .so.
    std::string keyMaterial;
    keyMaterial += input.stratforgeVersion;
    keyMaterial += '\x1d';
    keyMaterial += input.compilerPath;
    keyMaterial += '\x1d';
    keyMaterial += input.cppHardening ? "1" : "0";
    keyMaterial += '\x1d';
    keyMaterial += compileFlags;
    keyMaterial += '\x1d';
    keyMaterial += kComposerCodegenVersion;
    keyMaterial += '\x1d';
    keyMaterial += canonicalComponents(input.components);
    const std::string cacheKey = sha256Hex(keyMaterial);

    const fs::path cacheDir = resolveCacheDir({});
    fs::path artifactPath;
    if (!outputOverride.empty()) {
        artifactPath = outputOverride;
        fs::create_directories(artifactPath.parent_path());
    } else {
        artifactPath = cacheDir / (cacheKey + ".so");
    }

    if (outputOverride.empty() && fs::exists(artifactPath)) {
        return ComposerOutput{artifactPath, true, compileFlags};
    }

    // Write the .cpp into the cache dir so it is co-located with the .so for
    // debugging; the .cpp also acts as the determinism witness for the Phase 1
    // gate (test composes twice, cmp's the two .cpp files).
    fs::path sourcePath = cacheDir / (cacheKey + ".cpp");
    atomicWriteFile(sourcePath, emitted.source);

    const fs::path compiler = resolveCompiler(input.compilerPath);
    CompileResult cr = runCompiler(compiler, compileFlags, sourcePath, artifactPath);
    if (cr.exitCode != 0 || !fs::exists(artifactPath)) {
        std::string hint = cr.stderrTail.empty() ? std::string("compiler exited with code ") + std::to_string(cr.exitCode)
                                                  : cr.stderrTail;
        throw ComposerError(ErrorCode::CompileFailed,
                            "C++ compilation of composed strategy failed",
                            std::move(hint));
    }

    return ComposerOutput{artifactPath, false, compileFlags};
}

} // namespace stratforge::live::composer
