// TICKET_794 Phase 1 -- stratforge-live-composer binary entry point.
//
// CLI:
//   stratforge-live-composer [--input <path>] [--output <path>]
//
// If --input is omitted, JSON is read from stdin.
// On success: stdout final line is
// `{"artifact":"<abs>","cached":<bool>,"flags":"<compile flags>"}`.
// On failure: non-zero exit + stderr line `{"error":"<code>","message":"...","hint":"..."}`.

#include "composer.hpp"

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
namespace c = stratforge::live::composer;

namespace {

void writeErrorJson(c::ErrorCode code, std::string_view message, std::string_view hint) {
    nlohmann::json err = {
        {"error", c::errorCodeName(code)},
        {"message", std::string(message)},
    };
    if (!hint.empty()) err["hint"] = std::string(hint);
    std::cerr << err.dump() << '\n';
}

std::string readAll(std::istream& in) {
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

} // namespace

int main(int argc, char** argv) {
    std::string inputPath;
    std::string outputPath;

    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--input" && i + 1 < argc) {
            inputPath = argv[++i];
        } else if (a == "--output" && i + 1 < argc) {
            outputPath = argv[++i];
        } else if (a == "--help" || a == "-h") {
            std::cout << "stratforge-live-composer [--input <path>] [--output <path>]\n";
            return 0;
        } else {
            std::cerr << "[COMPOSER] unknown argument: " << a << '\n';
            writeErrorJson(c::ErrorCode::InputInvalid, "unknown argument: " + a, {});
            return 2;
        }
    }

    std::string raw;
    try {
        if (inputPath.empty()) {
            raw = readAll(std::cin);
        } else {
            std::ifstream in(inputPath);
            if (!in) {
                writeErrorJson(c::ErrorCode::InputInvalid,
                               "could not open --input path: " + inputPath, {});
                return 2;
            }
            raw = readAll(in);
        }
    } catch (const std::exception& e) {
        writeErrorJson(c::ErrorCode::InputInvalid,
                       std::string("failed to read input: ") + e.what(), {});
        return 2;
    }

    nlohmann::json doc;
    try {
        doc = nlohmann::json::parse(raw);
    } catch (const std::exception& e) {
        writeErrorJson(c::ErrorCode::InputInvalid,
                       std::string("invalid JSON: ") + e.what(), {});
        return 2;
    }

    c::ComposerInput parsed;
    try {
        parsed = c::Composer::parseInput(doc);
    } catch (const c::ComposerError& e) {
        writeErrorJson(e.code(), e.message(), e.hint());
        return 2;
    } catch (const std::exception& e) {
        writeErrorJson(c::ErrorCode::InputInvalid, e.what(), {});
        return 2;
    }

    c::ComposerOutput out;
    try {
        c::Composer composer;
        out = composer.compose(parsed, outputPath.empty() ? fs::path{} : fs::path(outputPath));
    } catch (const c::ComposerError& e) {
        std::cerr << "[COMPOSER] " << c::errorCodeName(e.code()) << ": " << e.message() << '\n';
        if (!e.hint().empty()) std::cerr << "[COMPOSER] hint: " << e.hint() << '\n';
        writeErrorJson(e.code(), e.message(), e.hint());
        return 1;
    } catch (const std::exception& e) {
        std::cerr << "[COMPOSER] internal error: " << e.what() << '\n';
        writeErrorJson(c::ErrorCode::Internal, e.what(), {});
        return 1;
    }

    nlohmann::json result = {
        {"artifact", fs::absolute(out.artifactPath).string()},
        {"cached", out.cached},
        {"flags", out.compileFlags},
    };
    std::cout << result.dump() << '\n';
    return 0;
}
