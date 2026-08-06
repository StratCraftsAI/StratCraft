#pragma once

// TICKET_1292_15 (MC-15, cut 5C-1): JSON <-> struct bridge for the pure
// code-version command (`--code-version=`). Shared by src/main.cpp and
// test_code_version.cpp so both exercise the SAME parse + serialization.
// Mirrors the planning_geometry_json.hpp precedent: header-only, nlohmann.
//
// Every request carries {"version": 1}. The packageParent (the directory that
// CONTAINS the nona_algorithm package, i.e. packages/nona-algorithm) is passed
// explicitly so the command is location-independent and testable against
// fixtures; the TS consumer resolves it from the app path exactly as
// code-version-cache.ts resolved the Python cwd.
//
//   { version:1, templateId:str, packageParent:str }
//     -> { version:1, codeVersion:str, sourceFilesSha256:str,
//          lockfileSha256:str, sourceFileCount:int, lockfilePath:str }

#include "quantnexus/executor/code_version/code_version.hpp"

#include <nlohmann/json.hpp>

#include <stdexcept>
#include <string>

namespace StratCraft::executor::code_version {

inline nlohmann::json run_code_version(const nlohmann::json& doc) {
    if (!doc.is_object()) {
        throw std::runtime_error("code-version request must be an object");
    }
    const int version = doc.value("version", 0);
    if (version != kCodeVersionVersion) {
        throw std::runtime_error(
            "unsupported code-version version " + std::to_string(version));
    }
    if (!doc.contains("templateId") || !doc["templateId"].is_string()) {
        throw std::runtime_error("code-version request requires string templateId");
    }
    if (!doc.contains("packageParent") || !doc["packageParent"].is_string()) {
        throw std::runtime_error("code-version request requires string packageParent");
    }
    const std::string templateId = doc["templateId"].get<std::string>();
    const std::string packageParent = doc["packageParent"].get<std::string>();

    const CodeVersionResult result = computeCodeVersion(templateId, packageParent);

    return nlohmann::json{
        {"version", kCodeVersionVersion},
        {"codeVersion", result.codeVersion},
        {"sourceFilesSha256", result.sourceFilesSha256},
        {"lockfileSha256", result.lockfileSha256},
        {"sourceFileCount", result.sourceFileCount},
        {"lockfilePath", result.lockfilePath},
    };
}

}  // namespace StratCraft::executor::code_version
