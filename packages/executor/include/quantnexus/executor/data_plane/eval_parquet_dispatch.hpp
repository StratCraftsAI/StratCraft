#pragma once

#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <ostream>
#include <string>

#include <nlohmann/json.hpp>

#include "quantnexus/executor/data_plane/eval_parquet.hpp"

namespace StratCraft::executor::data_plane {

namespace detail {

template <typename T>
void writeBinaryScalar(std::ostream& output, T value) {
    static_assert(std::is_trivially_copyable_v<T>);
    output.write(reinterpret_cast<const char*>(&value), sizeof(value));
    if (!output) throw std::runtime_error("failed to write eval-parquet output sidecar");
}

inline void writeBinaryString(std::ostream& output, const std::string& value) {
    if (value.size() > std::numeric_limits<std::uint32_t>::max()) {
        throw std::runtime_error("eval-parquet output string exceeds uint32");
    }
    writeBinaryScalar(output, static_cast<std::uint32_t>(value.size()));
    output.write(value.data(), static_cast<std::streamsize>(value.size()));
    if (!output) throw std::runtime_error("failed to write eval-parquet output string");
}

}  // namespace detail

/// Dispatch an eval-parquet request document and write the result to `out`.
/// Errors go to `err`. Returns 0 on success, 2 on failure.
/// Both main.cpp (executor) and research_cli_main.cpp (research-worker)
/// call this with their respective output streams.
[[nodiscard]] inline int dispatch_eval_parquet(
    const std::string& input_path,
    std::ostream& out,
    std::ostream& err) {

    namespace fs = std::filesystem;

    try {
        std::ifstream input(input_path);
        if (!input.is_open()) {
            throw std::runtime_error(
                "failed to open eval-parquet request: " + input_path);
        }
        nlohmann::json document;
        input >> document;
        if (document.at("version").get<std::string>() !=
            kEvalParquetContractVersion) {
            throw std::runtime_error(
                "version must be qnx.eval-parquet/1.0.0");
        }
        const auto operation =
            document.at("operation").get<std::string>();

        if (operation == "write") {
            const auto root =
                fs::path(document.at("root").get<std::string>());
            const auto table = parse_eval_table(
                document.at("table").get<std::string>());
            const auto signal_id =
                document.at("signal_id").get<std::int64_t>();
            write_eval_partition(EvalWriteRequest{
                .root = root,
                .table = table,
                .signal_id = signal_id,
                .run_id = document.at("run_id").get<std::int64_t>(),
                .created_at_ms =
                    document.at("created_at_ms").get<std::int64_t>(),
                .rows_path =
                    document.at("rows_path").get<std::string>(),
            });
            out << nlohmann::json{
                {"status", "ok"},
                {"version", kEvalParquetContractVersion},
                {"operation", operation},
            }.dump() << '\n';
            return 0;
        }

        if (operation == "coverage") {
            const auto root =
                fs::path(document.at("root").get<std::string>());
            const auto table = parse_eval_table(
                document.at("table").get<std::string>());
            const auto signal_id =
                document.at("signal_id").get<std::int64_t>();
            const auto coverage = read_coverage(
                root, table, signal_id);
            nlohmann::json result = nullptr;
            if (coverage) {
                result = {
                    {"start", coverage->start},
                    {"end", coverage->end},
                    {"bar_count", coverage->row_count},
                };
            }
            out << nlohmann::json{
                {"status", "ok"},
                {"version", kEvalParquetContractVersion},
                {"operation", operation},
                {"result", result},
            }.dump() << '\n';
            return 0;
        }

        if (operation == "footer_counts") {
            nlohmann::json counts = nlohmann::json::object();
            for (const auto& element : document.at("paths")) {
                const auto path = element.get<std::string>();
                counts[path] =
                    read_parquet_footer_row_count(path);
            }
            out << nlohmann::json{
                {"status", "ok"},
                {"version", kEvalParquetContractVersion},
                {"operation", operation},
                {"counts", std::move(counts)},
            }.dump() << '\n';
            return 0;
        }

        if (operation == "symbols") {
            const auto symbols = read_canonical_symbols(
                document.at("root").get<std::string>(),
                document.at("signal_id").get<std::int64_t>());
            out << nlohmann::json{
                {"status", "ok"},
                {"version", kEvalParquetContractVersion},
                {"operation", operation},
                {"symbols", symbols},
            }.dump() << '\n';
            return 0;
        }

        if (operation == "eval_cache_metadata") {
            const auto metadata = read_eval_cache_metadata(
                document.at("path").get<std::string>());
            out << nlohmann::json{
                {"status", "ok"},
                {"version", kEvalParquetContractVersion},
                {"operation", operation},
                {"row_count", metadata.row_count},
                {"symbols", metadata.symbols},
                {"horizon_bars", metadata.horizon_bars},
            }.dump() << '\n';
            return 0;
        }

        if (operation == "arm_funnel") {
            std::vector<FoldBoundary> boundaries;
            for (const auto& row : document.at("fold_boundaries")) {
                boundaries.push_back(FoldBoundary{
                    row.at("path_index").get<std::int32_t>(),
                    row.at("test_segment_index").get<std::int32_t>(),
                    row.at("start_ms").get<std::int64_t>(),
                    row.at("end_ms").get<std::int64_t>(),
                });
            }
            std::vector<RegimePoint> regimes;
            for (const auto& row : document.at("regimes")) {
                regimes.push_back(RegimePoint{
                    row.at("ts").get<std::int64_t>(),
                    row.at("label").get<std::int32_t>(),
                });
            }
            const auto aggregate =
                read_arm_funnel_aggregates(
                    document.at("root").get<std::string>(),
                    document.at("signal_id").get<std::int64_t>(),
                    boundaries,
                    regimes,
                    document.at("min_symbols_per_bar")
                        .get<std::int32_t>(),
                    document.at("max_decay_lag")
                        .get<std::int32_t>());
            nlohmann::json value = nullptr;
            if (aggregate) {
                const auto optional_number =
                    [](const std::optional<double>& number) {
                        return number
                                   ? nlohmann::json(*number)
                                   : nlohmann::json(nullptr);
                    };
                const auto slice_json =
                    [&](const FunnelSlice& slice) {
                        return nlohmann::json{
                            {"nPairs", slice.pair_count},
                            {"distinctSymbols",
                             slice.distinct_symbols},
                            {"pooledIc",
                             optional_number(slice.pooled_ic)},
                            {"xsMeanIc",
                             optional_number(slice.xs_mean_ic)},
                            {"xsBarsMeasurable",
                             slice.xs_bars_measurable},
                            {"xsBarsObserved",
                             slice.xs_bars_observed},
                        };
                    };
                value = {
                    {"nPairsClean", aggregate->arm.pair_count},
                    {"distinctSymbols",
                     aggregate->arm.distinct_symbols},
                    {"pooledArmIc",
                     optional_number(aggregate->arm.pooled_ic)},
                    {"xsArmMeanIc",
                     optional_number(aggregate->arm.xs_mean_ic)},
                    {"xsArmBarsMeasurable",
                     aggregate->arm.xs_bars_measurable},
                    {"xsArmBarsObserved",
                     aggregate->arm.xs_bars_observed},
                };
                value["foldAttribution"] =
                    aggregate->uses_path_index
                        ? "path_index"
                        : "ts_window";
                value["folds"] = nlohmann::json::array();
                for (const auto& fold : aggregate->folds) {
                    auto row = slice_json(fold);
                    row["pathIndex"] = fold.path_index;
                    row["testSegmentIndex"] =
                        fold.test_segment_index;
                    value["folds"].push_back(std::move(row));
                }
                value["regimes"] = nlohmann::json::array();
                for (const auto& regime : aggregate->regimes) {
                    value["regimes"].push_back({
                        {"regimeLabel", regime.label},
                        {"nPairs", regime.pair_count},
                        {"pooledIc",
                         optional_number(regime.pooled_ic)},
                    });
                }
                value["decayLagIcs"] = nlohmann::json::array();
                for (const auto& decay : aggregate->decay) {
                    value["decayLagIcs"].push_back({
                        {"lag", decay.lag},
                        {"nPairs", decay.pair_count},
                        {"pooledIc",
                         optional_number(decay.pooled_ic)},
                        {"xsMeanIc",
                         optional_number(decay.xs_mean_ic)},
                        {"xsBarsMeasurable",
                         decay.xs_bars_measurable},
                    });
                }
            }
            out << nlohmann::json{
                {"status", "ok"},
                {"version", kEvalParquetContractVersion},
                {"operation", operation},
                {"result", std::move(value)},
            }.dump() << '\n';
            return 0;
        }

        if (operation == "eval_cache_ic") {
            std::vector<fs::path> paths;
            for (const auto& path : document.at("paths")) {
                paths.emplace_back(path.get<std::string>());
            }
            const auto stats =
                compute_eval_cache_ic_stats(
                    paths,
                    document.at("sampling_threshold")
                        .get<std::uint64_t>(),
                    document.at("sample_bars")
                        .get<std::uint64_t>());
            out << nlohmann::json{
                {"status", "ok"},
                {"version", kEvalParquetContractVersion},
                {"operation", operation},
                {"ic", stats.mean_ic
                           ? nlohmann::json(*stats.mean_ic)
                           : nlohmann::json(nullptr)},
                {"ic_std", stats.std_ic
                               ? nlohmann::json(*stats.std_ic)
                               : nlohmann::json(nullptr)},
            }.dump() << '\n';
            return 0;
        }

        if (operation == "canonical_scores" ||
            operation == "forward_pairs" ||
            operation == "score_series" ||
            operation == "eval_cache_rows") {
            const auto output_path =
                fs::path(document.at("output_path").get<std::string>());
            std::ofstream output(output_path, std::ios::binary);
            if (!output.is_open()) {
                throw std::runtime_error(
                    "failed to open eval-parquet output sidecar: " +
                    output_path.string());
            }
            constexpr std::string_view magic = "QNXEPR10";
            output.write(magic.data(),
                         static_cast<std::streamsize>(magic.size()));
            const std::uint8_t kind =
                operation == "canonical_scores" ? 1
                : operation == "forward_pairs" ? 2
                : operation == "score_series" ? 3
                : 4;
            detail::writeBinaryScalar(output, kind);

            if (operation == "eval_cache_rows") {
                const auto rows = read_eval_cache_rows(
                    document.at("path").get<std::string>());
                detail::writeBinaryScalar(
                    output, static_cast<std::uint64_t>(rows.size()));
                for (const auto& row : rows) {
                    detail::writeBinaryString(output, row.symbol);
                    detail::writeBinaryScalar(output, row.ts);
                    detail::writeBinaryScalar(output, row.score);
                    detail::writeBinaryScalar(output, row.confidence);
                    detail::writeBinaryScalar(output, row.r_next);
                    detail::writeBinaryScalar(output, row.horizon_bars);
                }
            } else {
                const auto root =
                    fs::path(document.at("root").get<std::string>());
                const auto signal_id =
                    document.at("signal_id").get<std::int64_t>();
                EvalWindow window;
                if (document.contains("start_ms")) {
                    window.start_ms =
                        document.at("start_ms").get<std::int64_t>();
                }
                if (document.contains("end_ms")) {
                    window.end_ms =
                        document.at("end_ms").get<std::int64_t>();
                }
                if (window.start_ms && window.end_ms &&
                    *window.start_ms > *window.end_ms) {
                    throw std::runtime_error(
                        "start_ms must be <= end_ms");
                }
                if (operation == "forward_pairs") {
                    const auto rows =
                        read_forward_return_pairs(
                            root, signal_id, window);
                    detail::writeBinaryScalar(
                        output,
                        static_cast<std::uint64_t>(rows.size()));
                    for (const auto& row : rows) {
                        detail::writeBinaryString(output, row.symbol);
                        detail::writeBinaryScalar(output, row.ts);
                        detail::writeBinaryScalar(output, row.signal_value);
                        detail::writeBinaryScalar(
                            output, row.signal_confidence);
                        detail::writeBinaryScalar(output, row.r_next);
                        detail::writeBinaryScalar(output, row.horizon_bars);
                        detail::writeBinaryScalar(
                            output,
                            row.path_index.value_or(
                                static_cast<std::int32_t>(-1)));
                    }
                } else {
                    const auto rows =
                        read_canonical_scores(
                            root, signal_id, window);
                    detail::writeBinaryScalar(
                        output,
                        static_cast<std::uint64_t>(rows.size()));
                    for (const auto& row : rows) {
                        if (operation == "score_series") {
                            detail::writeBinaryScalar(output, row.score);
                        } else {
                            detail::writeBinaryScalar(output, row.ts);
                            detail::writeBinaryScalar(output, row.score);
                            detail::writeBinaryScalar(
                                output, row.confidence);
                        }
                    }
                }
            }
            output.close();
            if (!output) {
                throw std::runtime_error(
                    "failed to close eval-parquet output sidecar");
            }
            out << nlohmann::json{
                {"status", "ok"},
                {"version", kEvalParquetContractVersion},
                {"operation", operation},
                {"output_path", output_path.string()},
            }.dump() << '\n';
            return 0;
        }

        throw std::runtime_error(
            "unknown eval-parquet operation: " + operation);
    } catch (const std::exception& error) {
        err << nlohmann::json{
            {"code", "QNX_EVAL_PARQUET_INVALID"},
            {"message", error.what()},
            {"retryable", false},
        }.dump() << '\n';
        return 2;
    }
}

}  // namespace StratCraft::executor::data_plane
