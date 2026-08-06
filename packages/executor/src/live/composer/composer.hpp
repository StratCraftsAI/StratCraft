// TICKET_794 Phase 1 -- stratforge-live-composer.
//
// Composer reads a JSON document describing a saved multi-component strategy
// (analysis + entry + optional exit), emits one C++ translation unit, compiles
// it to a .so exporting the qnx_live V2 ABI, and prints the artifact path on
// stdout as `{"artifact":"<abs>","cached":<bool>,"flags":"<compile flags>"}`.

#pragma once

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

#include <nlohmann/json.hpp>

namespace stratforge::live::composer {

// Stable error codes mirroring TICKET_794 sec 5.
enum class ErrorCode {
    Ok = 0,
    InputInvalid,
    LanguageMismatch,
    ComponentMissing,
    IndicatorNotAvailable,
    ToolchainMissing,
    CompileFailed,
    Internal,
};

const char* errorCodeName(ErrorCode code) noexcept;

struct Component {
    std::string role;             // "analysis" | "entry" | "exit"
    std::string algorithmId;
    std::string algorithmName;
    std::string algorithmCode;    // C++ source defining a class matching the contract.
    std::string baseClass;
    std::string timeframe;
    std::string parameters;       // JSON string (raw).
    int sortOrder = 0;
    std::string className;        // populated by composer from regex over algorithmCode.
};

struct ComposerInput {
    std::string strategyId;
    std::string symbol;
    std::string timeframe;
    std::vector<Component> components;
    std::string compilerPath;
    bool cppHardening = false;
    std::string stratforgeVersion;
};

struct ComposerOutput {
    std::filesystem::path artifactPath;
    bool cached = false;
    // Effective strategy .so compile flags (TICKET_1125 Phase 5). Part of the
    // cache key, so a cached artifact was built with exactly these flags.
    std::string compileFlags;
};

class ComposerError : public std::exception {
public:
    ComposerError(ErrorCode code, std::string message, std::string hint = {})
        : code_(code), message_(std::move(message)), hint_(std::move(hint)) {}

    const char* what() const noexcept override { return message_.c_str(); }
    ErrorCode code() const noexcept { return code_; }
    const std::string& message() const noexcept { return message_; }
    const std::string& hint() const noexcept { return hint_; }

private:
    ErrorCode code_;
    std::string message_;
    std::string hint_;
};

class Composer {
public:
    // outputOverride: if non-empty, write artifact there instead of cache path.
    ComposerOutput compose(const ComposerInput& input,
                           const std::filesystem::path& outputOverride);

    // Parse + validate the input JSON. Throws ComposerError on failure.
    static ComposerInput parseInput(const nlohmann::json& doc);
};

} // namespace stratforge::live::composer
