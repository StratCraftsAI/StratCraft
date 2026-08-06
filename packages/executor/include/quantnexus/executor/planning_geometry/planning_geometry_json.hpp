#pragma once

// TICKET_1292 Phase 5 cut 5B (MC-11): JSON <-> struct bridge for the pure
// planning-geometry command (`--planning-geometry=`). Shared by src/main.cpp
// and test_planning_geometry.cpp so both exercise the SAME parse +
// serialization. Mirrors the promotion_gates_json.hpp / strategy_admission_json.hpp
// precedent: header-only, nlohmann, ordered arrays are semantic.
//
// Every request carries {"version": 1, "kind": "..."} and dispatches on kind.
// All arrays are index-aligned; JSON object key order is not preserved.
//
//   { version:1, kind:"required_pull_bars", contract:{...} }
//     -> { version:1, requiredPullBars:int }
//
//   { version:1, kind:"embargo",
//     templateId:str, params:{...}, recommendedEmbargoBars:int|null }
//     -> { version:1, embargoBars:int, effectiveMemoryBars:int, memoryKind:str }
//
//   { version:1, kind:"plan",
//     contract:{...}, totalBars:int,
//     barTimestampsMs:[int...]|null, barMs:int|null, dataWindowStartMs:int|null }
//     -> { version:1, refusal:{...}|null, requiredPullBars:int,
//          paths:[ { pathIndex, totalPaths, testSegmentIndices:[int],
//                    isStartBar, isEndBar, oosStartBar, oosEndBar, purgedBars,
//                    isStartMs?, isEndMs?, oosStartMs?, oosEndMs? } ] }
//
//   { version:1, kind:"check_refusal", contract:{...}, totalBars:int }
//     -> { version:1, refusal:{...}|null }
//
//   { version:1, kind:"deficit_allocation",
//     orderedWithDeficit:[ {key:str, deficit:int} ], batchSize:int }
//     -> { version:1, allocation:[ {key:str, iterations:int} ]|null }
//        (allocation null => caller must apply the uniform/empty branch)
//
// The `contract` object shape (bar-space, matching CvSizingContract):
//   { scheme:str, totalSegments:int, testSegments:int, embargoBars:int,
//     horizonBars:int, warmupBars:int, netNewBars:int }

#include "quantnexus/executor/planning_geometry/planning_geometry.hpp"

#include <nlohmann/json.hpp>

#include <cstdint>
#include <stdexcept>
#include <string>

namespace StratCraft::executor::planning_geometry {

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

inline void require_version(const nlohmann::json& doc) {
    if (!doc.is_object()) {
        throw std::runtime_error("planning-geometry request must be an object");
    }
    const int version = doc.value("version", 0);
    if (version != kPlanningGeometryVersion) {
        throw std::runtime_error(
            "unsupported planning-geometry version " + std::to_string(version) +
            " (expected " + std::to_string(kPlanningGeometryVersion) + ")");
    }
}

inline CvSizingContract parse_contract(const nlohmann::json& doc) {
    if (!doc.is_object()) {
        throw std::runtime_error("contract must be an object");
    }
    const std::string schemeStr = doc.value("scheme", std::string{});
    const auto scheme = parse_scheme(schemeStr);
    if (!scheme.has_value()) {
        throw std::runtime_error("unknown contract.scheme '" + schemeStr + "'");
    }
    CvSizingContract c;
    c.scheme = *scheme;
    c.totalSegments = doc.value("totalSegments", 0);
    c.testSegments = doc.value("testSegments", 0);
    c.embargoBars = doc.value("embargoBars", 0);
    c.horizonBars = doc.value("horizonBars", 0);
    c.warmupBars = doc.value("warmupBars", 0);
    c.netNewBars = doc.value("netNewBars", 0);
    validate_contract(c);  // fail-fast on a malformed request
    return c;
}

inline EmbargoParams parse_embargo_params(const nlohmann::json& doc) {
    EmbargoParams p;
    if (doc.contains("params") && doc.at("params").is_object()) {
        const auto& params = doc.at("params");
        auto get_int = [&](const char* key) -> std::optional<int> {
            if (params.contains(key) && params.at(key).is_number()) {
                return params.at(key).get<int>();
            }
            return std::nullopt;
        };
        p.nStates = get_int("n_states");
        p.nComponents = get_int("n_components");
        p.window = get_int("window");
        p.k = get_int("k");
        p.tau = get_int("tau");
        p.lookback = get_int("lookback");
        p.horizon = get_int("horizon");
        // multi_tf raw: "none" or comma-separated layer list.
        if (params.contains("multi_tf") && params.at("multi_tf").is_string()) {
            const std::string raw = params.at("multi_tf").get<std::string>();
            if (raw != "none" && !raw.empty()) {
                p.multiTfAny = true;
                p.multiTfHas1d = raw.find("1d") != std::string::npos;
                p.multiTfHas4h = raw.find("4h") != std::string::npos;
            }
        }
    }
    // recommended_embargo_bars declared at the request root (the TS caller
    // resolves it from the template PARAM_SCHEMA before spawning; a positive
    // value overrides auto-derivation verbatim).
    if (doc.contains("recommendedEmbargoBars") &&
        doc.at("recommendedEmbargoBars").is_number()) {
        p.recommendedEmbargoBars = doc.at("recommendedEmbargoBars").get<int>();
    }
    return p;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

inline nlohmann::json refusal_to_json(const CvRefusal& r) {
    return nlohmann::json{
        {"totalBars", r.totalBars},
        {"requiredPullBars", r.requiredPullBars},
        {"perPathIsBars", r.perPathIsBars},
        {"floorRequired", r.floorRequired},
        {"embargoBars", r.embargoBars},
        {"totalSegments", r.totalSegments},
        {"testSegments", r.testSegments},
        {"message", r.message},
    };
}

inline nlohmann::json path_to_json(const PlannedPath& p) {
    return nlohmann::json{
        {"pathIndex", p.pathIndex},
        {"totalPaths", p.totalPaths},
        {"testSegmentIndices", p.testSegmentIndices},
        {"isStartBar", p.isStartBar},
        {"isEndBar", p.isEndBar},
        {"oosStartBar", p.oosStartBar},
        {"oosEndBar", p.oosEndBar},
        {"purgedBars", p.purgedBars},
    };
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

inline nlohmann::json run_planning_geometry(const nlohmann::json& doc) {
    require_version(doc);
    const std::string kind = doc.value("kind", std::string{});

    if (kind == "required_pull_bars") {
        const CvSizingContract c = parse_contract(doc.at("contract"));
        return nlohmann::json{
            {"version", kPlanningGeometryVersion},
            {"requiredPullBars", required_pull_bars(c)},
        };
    }

    if (kind == "embargo") {
        if (!doc.contains("templateId") || !doc.at("templateId").is_string()) {
            throw std::runtime_error("embargo request requires string 'templateId'");
        }
        const std::string templateId = doc.at("templateId").get<std::string>();
        const MemoryKind memKind = memory_kind_for(templateId);
        const EmbargoParams params = parse_embargo_params(doc);
        return nlohmann::json{
            {"version", kPlanningGeometryVersion},
            {"embargoBars", auto_embargo(memKind, params)},
            {"effectiveMemoryBars", effective_memory_bars(memKind, params)},
            {"memoryKind", [&] {
                 switch (memKind) {
                     case MemoryKind::none: return "none";
                     case MemoryKind::hmm: return "hmm";
                     case MemoryKind::gmm: return "gmm";
                     case MemoryKind::ngram: return "ngram";
                     case MemoryKind::ml: return "ml";
                     case MemoryKind::xgboost_v3: return "xgboost_v3";
                 }
                 return "none";
             }()},
        };
    }

    if (kind == "check_refusal") {
        const CvSizingContract c = parse_contract(doc.at("contract"));
        const auto totalBars = doc.at("totalBars").get<std::int64_t>();
        const auto refusal = check_refusal(c, totalBars);
        return nlohmann::json{
            {"version", kPlanningGeometryVersion},
            {"refusal", refusal.has_value() ? refusal_to_json(*refusal) : nlohmann::json(nullptr)},
        };
    }

    if (kind == "plan") {
        const CvSizingContract c = parse_contract(doc.at("contract"));
        const auto totalBars = doc.at("totalBars").get<std::int64_t>();

        nlohmann::json out{
            {"version", kPlanningGeometryVersion},
            {"requiredPullBars", required_pull_bars(c)},
        };

        const auto refusal = (c.warmupBars > 0 && totalBars > 0)
                                 ? check_refusal(c, totalBars)
                                 : std::nullopt;
        out["refusal"] = refusal.has_value() ? refusal_to_json(*refusal) : nlohmann::json(nullptr);

        nlohmann::json pathsJson = nlohmann::json::array();
        if (!refusal.has_value() && totalBars > 0) {
            const auto paths = plan_paths(c, totalBars);

            // Optional ms projection through the real bar calendar.
            std::vector<std::int64_t> calendar;
            std::int64_t barMs = 0;
            const bool haveCalendar =
                doc.contains("barTimestampsMs") && doc.at("barTimestampsMs").is_array();
            if (haveCalendar) {
                for (const auto& v : doc.at("barTimestampsMs")) {
                    calendar.push_back(v.get<std::int64_t>());
                }
                barMs = doc.value("barMs", static_cast<std::int64_t>(0));
                if (static_cast<std::int64_t>(calendar.size()) != totalBars) {
                    throw std::runtime_error(
                        "barTimestampsMs.length (" + std::to_string(calendar.size()) +
                        ") != totalBars (" + std::to_string(totalBars) + ")");
                }
                if (barMs <= 0) {
                    throw std::runtime_error(
                        "barMs must be a positive integer when barTimestampsMs is supplied");
                }
            }

            for (const auto& p : paths) {
                nlohmann::json pj = path_to_json(p);
                if (haveCalendar) {
                    pj["isStartMs"] = bar_index_to_ms(p.isStartBar, calendar, barMs);
                    pj["isEndMs"] = bar_index_to_ms(p.isEndBar, calendar, barMs);
                    pj["oosStartMs"] = bar_index_to_ms(p.oosStartBar, calendar, barMs);
                    pj["oosEndMs"] = bar_index_to_ms(p.oosEndBar, calendar, barMs);
                }
                pathsJson.push_back(std::move(pj));
            }
        }
        out["paths"] = std::move(pathsJson);
        return out;
    }

    if (kind == "deficit_allocation") {
        if (!doc.contains("orderedWithDeficit") ||
            !doc.at("orderedWithDeficit").is_array()) {
            throw std::runtime_error(
                "deficit_allocation requires array 'orderedWithDeficit'");
        }
        std::vector<std::pair<std::string, int>> ordered;
        for (const auto& e : doc.at("orderedWithDeficit")) {
            ordered.emplace_back(e.at("key").get<std::string>(),
                                 e.at("deficit").get<int>());
        }
        const int batchSize = doc.value("batchSize", 0);
        const auto alloc = proportional_deficit_allocation(ordered, batchSize);
        if (alloc.empty()) {
            // Uniform/empty branch: signal null so the TS layer applies its
            // RNG-seeded uniformAllocation. This is not a failure -- it is the
            // "no positive-deficit keys" branch the geometry cannot own.
            return nlohmann::json{
                {"version", kPlanningGeometryVersion},
                {"allocation", nlohmann::json(nullptr)},
            };
        }
        nlohmann::json allocJson = nlohmann::json::array();
        for (const auto& a : alloc) {
            allocJson.push_back({{"key", a.key}, {"iterations", a.iterations}});
        }
        return nlohmann::json{
            {"version", kPlanningGeometryVersion},
            {"allocation", std::move(allocJson)},
        };
    }

    throw std::runtime_error("unknown planning-geometry kind '" + kind + "'");
}

}  // namespace StratCraft::executor::planning_geometry
