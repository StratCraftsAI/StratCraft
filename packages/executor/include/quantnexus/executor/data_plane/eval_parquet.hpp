#pragma once

#include <cstdint>
#include <filesystem>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace StratCraft::executor::data_plane {

inline constexpr std::string_view kEvalParquetContractVersion =
    "qnx.eval-parquet/1.0.0";
inline constexpr std::string_view kEvalRowStreamMagic = "QNXEVL10";

enum class EvalTable : std::uint8_t {
    canonical_score = 1,
    forward_return = 2,
};

struct EvalWriteRequest {
    std::filesystem::path root;
    EvalTable table;
    std::int64_t signal_id;
    std::int64_t run_id;
    std::int64_t created_at_ms;
    std::filesystem::path rows_path;
};

struct EvalWindow {
    std::optional<std::int64_t> start_ms;
    std::optional<std::int64_t> end_ms;
};

struct CanonicalScoreRow {
    std::string symbol;
    std::int64_t ts;
    double score;
    double confidence;
    std::optional<std::int32_t> path_index;
};

struct ForwardReturnRow {
    std::string symbol;
    std::int64_t ts;
    double r_next;
    std::int32_t horizon_bars;
    std::optional<std::int32_t> path_index;
};

struct ForwardReturnPair {
    std::string symbol;
    std::int64_t ts;
    double signal_value;
    double signal_confidence;
    double r_next;
    std::int32_t horizon_bars;
    std::optional<std::int32_t> path_index;
};

struct Coverage {
    std::int64_t start;
    std::int64_t end;
    std::int64_t row_count;
};

struct EvalCacheRow {
    std::string symbol;
    std::int64_t ts;
    double score;
    double confidence;
    double r_next;
    std::int32_t horizon_bars;
};

struct EvalCacheMetadata {
    std::int64_t row_count;
    std::vector<std::string> symbols;
    std::int32_t horizon_bars;
};

struct FoldBoundary {
    std::int32_t path_index;
    std::int32_t test_segment_index;
    std::int64_t start_ms;
    std::int64_t end_ms;
};

struct RegimePoint {
    std::int64_t ts;
    std::int32_t label;
};

struct FunnelSlice {
    std::int64_t pair_count;
    std::int64_t distinct_symbols;
    std::optional<double> pooled_ic;
    std::optional<double> xs_mean_ic;
    std::int64_t xs_bars_measurable;
    std::int64_t xs_bars_observed;
};

struct FunnelFold : FunnelSlice {
    std::int32_t path_index;
    std::int32_t test_segment_index;
};

struct FunnelRegime {
    std::int32_t label;
    std::int64_t pair_count;
    std::optional<double> pooled_ic;
};

struct FunnelDecay {
    std::int32_t lag;
    std::int64_t pair_count;
    std::optional<double> pooled_ic;
    std::optional<double> xs_mean_ic;
    std::int64_t xs_bars_measurable;
};

struct ArmFunnelAggregates {
    FunnelSlice arm;
    bool uses_path_index;
    std::vector<FunnelFold> folds;
    std::vector<FunnelRegime> regimes;
    std::vector<FunnelDecay> decay;
};

struct EvalCacheIcStats {
    std::optional<double> mean_ic;
    std::optional<double> std_ic;
};

[[nodiscard]] EvalTable parse_eval_table(std::string_view value);
[[nodiscard]] std::string_view eval_table_name(EvalTable table) noexcept;

void write_eval_partition(const EvalWriteRequest& request);

[[nodiscard]] std::optional<std::filesystem::path> resolve_latest_partition(
    const std::filesystem::path& root,
    EvalTable table,
    std::int64_t signal_id);

[[nodiscard]] std::optional<Coverage> read_coverage(
    const std::filesystem::path& root,
    EvalTable table,
    std::int64_t signal_id);

[[nodiscard]] std::vector<CanonicalScoreRow> read_canonical_scores(
    const std::filesystem::path& root,
    std::int64_t signal_id,
    const EvalWindow& window);

[[nodiscard]] std::vector<ForwardReturnPair> read_forward_return_pairs(
    const std::filesystem::path& root,
    std::int64_t signal_id,
    const EvalWindow& window);

[[nodiscard]] std::int64_t read_parquet_footer_row_count(
    const std::filesystem::path& path);

[[nodiscard]] std::vector<std::string> read_canonical_symbols(
    const std::filesystem::path& root,
    std::int64_t signal_id);

[[nodiscard]] std::vector<EvalCacheRow> read_eval_cache_rows(
    const std::filesystem::path& path);

[[nodiscard]] EvalCacheMetadata read_eval_cache_metadata(
    const std::filesystem::path& path);

[[nodiscard]] std::optional<ArmFunnelAggregates> read_arm_funnel_aggregates(
    const std::filesystem::path& root,
    std::int64_t signal_id,
    std::span<const FoldBoundary> boundaries,
    std::span<const RegimePoint> regimes,
    std::int32_t min_symbols_per_bar,
    std::int32_t max_decay_lag);

[[nodiscard]] EvalCacheIcStats compute_eval_cache_ic_stats(
    std::span<const std::filesystem::path> paths,
    std::uint64_t sampling_threshold,
    std::uint64_t sample_bars);

}  // namespace StratCraft::executor::data_plane
