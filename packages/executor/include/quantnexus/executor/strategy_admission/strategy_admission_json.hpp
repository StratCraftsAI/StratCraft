// TICKET_1292 Phase 5 5A (MC-09): JSON adapter for the strategy-admission owner.
//
// Parses a StrategyAdmissionRequest from the packaged-command JSON payload and
// serializes an AdmissionResult to the versioned diagnostic envelope. Header-only
// (nlohmann), same style as scoreboard_score_json.hpp / promotion_gates_json.hpp.

#pragma once

#include "quantnexus/executor/strategy_admission/strategy_admission.hpp"

#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>

namespace StratCraft::executor::strategy_admission {

inline AdmissionRequest parse_request(const nlohmann::json& document) {
    if (!document.is_object()) {
        throw std::runtime_error("strategy-admission request must be an object");
    }
    const int version = document.value("diagnosticVersion", 0);
    if (version != kDiagnosticVersion) {
        throw std::runtime_error(
            "unsupported diagnosticVersion " + std::to_string(version)
            + " (expected " + std::to_string(kDiagnosticVersion) + ")");
    }
    if (!document.contains("code") || !document.at("code").is_string()) {
        throw std::runtime_error("strategy-admission request requires string 'code'");
    }

    AdmissionRequest request;
    request.code = document.at("code").get<std::string>();
    request.signal_source = document.value("signalSource", std::string{});
    request.compiler_path = document.value("compilerPath", std::string{});

    if (document.contains("includePaths")) {
        const auto& includes = document.at("includePaths");
        if (!includes.is_array()) {
            throw std::runtime_error("includePaths must be an array");
        }
        for (const auto& element : includes) {
            request.include_paths.push_back(element.get<std::string>());
        }
    }

    if (document.contains("checks")) {
        const auto& checks = document.at("checks");
        if (!checks.is_object()) {
            throw std::runtime_error("checks must be an object");
        }
        request.checks.prohibited_constructs =
            checks.value("prohibitedConstructs", true);
        request.checks.structural = checks.value("structural", true);
        request.checks.syntax = checks.value("syntax", true);
        request.checks.warnings = checks.value("warnings", true);
        request.checks.abi_export = checks.value("abiExport", true);
    }

    return request;
}

inline nlohmann::json to_json(const Diagnostic& diagnostic) {
    nlohmann::json j;
    j["severity"] = to_string(diagnostic.severity);
    j["ruleId"] = diagnostic.rule_id;
    j["message"] = diagnostic.message;
    j["source"] = to_string(diagnostic.source);
    if (diagnostic.line.has_value()) j["line"] = *diagnostic.line;
    if (diagnostic.column.has_value()) j["column"] = *diagnostic.column;
    return j;
}

inline nlohmann::json to_json(const AdmissionResult& result) {
    nlohmann::json abi;
    abi["factoryExportPresent"] = result.abi.factory_export_present;
    if (result.abi.abi_version.has_value()) {
        abi["abiVersion"] = *result.abi.abi_version;
    }
    abi["symbols"] = result.abi.symbols;

    nlohmann::json diagnostics = nlohmann::json::array();
    for (const Diagnostic& d : result.diagnostics) {
        diagnostics.push_back(to_json(d));
    }

    nlohmann::json j;
    j["diagnosticVersion"] = result.diagnostic_version;
    j["admitted"] = result.admitted;
    j["compilerAvailable"] = result.compiler_available;
    j["abi"] = std::move(abi);
    j["diagnostics"] = std::move(diagnostics);
    return j;
}

}  // namespace StratCraft::executor::strategy_admission
