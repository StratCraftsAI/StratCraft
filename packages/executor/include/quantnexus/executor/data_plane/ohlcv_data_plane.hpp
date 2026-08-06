#pragma once

#include <nlohmann/json.hpp>

#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace StratCraft::executor::data_plane {

enum class OhlcvOperation : std::uint8_t {
    canonicalize,
    merge,
    aggregate,
    pool,
    byod,
};

enum class TimestampUnit : std::uint8_t {
    seconds,
    milliseconds,
    microseconds,
    nanoseconds,
};

enum class QualityAction : std::uint8_t {
    reject_artifact,
    drop_rows,
};

enum class QualityAssetClass : std::uint8_t {
    forex,
    equity,
    crypto,
    default_class,
};

enum class FillPolicy : std::uint8_t {
    none,
    forward,
};

struct OhlcvProjection {
    std::string symbol = "symbol";
    std::string timestamp = "timestamp";
    std::string open = "open";
    std::string high = "high";
    std::string low = "low";
    std::string close = "close";
    std::string volume = "volume";
    std::optional<std::string> fixed_symbol;
    TimestampUnit timestamp_unit = TimestampUnit::milliseconds;
};

struct OhlcvInput {
    std::filesystem::path path;
    OhlcvProjection projection;
    std::int64_t precedence = 0;
};

struct OhlcvInlineRow {
    std::string symbol;
    std::int64_t timestamp;
    double open;
    double high;
    double low;
    double close;
    double volume;
    std::int64_t precedence = 0;
    TimestampUnit timestamp_unit = TimestampUnit::milliseconds;
};

struct OhlcvWindow {
    std::int64_t start_ms;
    std::int64_t end_ms;
};

struct SessionAnchor {
    std::int64_t effective_start_ms;
    std::int64_t anchor_ms;
};

struct OhlcvQualityPolicy {
    QualityAssetClass asset_class = QualityAssetClass::default_class;
    std::int64_t interval_ms = 0;
};

struct OhlcvDataPlaneRequest {
    std::string decision_id;
    OhlcvOperation operation = OhlcvOperation::canonicalize;
    std::vector<OhlcvInput> inputs;
    std::vector<OhlcvInlineRow> inline_rows;
    OhlcvWindow window{0, 0};
    std::filesystem::path output_path;
    std::filesystem::path cancellation_path;
    std::int64_t target_interval_ms = 0;
    std::vector<SessionAnchor> session_anchors;
    bool keep_partial_bucket = true;
    std::vector<std::int64_t> calendar_ms;
    std::vector<std::string> pool_symbols;
    FillPolicy fill_policy = FillPolicy::none;
    QualityAction quality_action = QualityAction::reject_artifact;
    std::optional<OhlcvQualityPolicy> quality_policy;
    std::optional<std::int64_t> minimum_output_rows;
};

struct OhlcvQualityEvent {
    std::string symbol;
    std::int64_t timestamp_ms = 0;
    std::string rule;
    std::string severity;
    double open = 0.0;
    double high = 0.0;
    double low = 0.0;
    double close = 0.0;
    double volume = 0.0;
};

struct OhlcvDecisionMetadata {
    std::string decision_id;
    std::int64_t row_count = 0;
    std::optional<std::int64_t> extent_start_ms;
    std::optional<std::int64_t> extent_end_ms;
    std::int64_t rejected_rows = 0;
    std::int64_t suspect_rows = 0;
    std::int64_t duplicate_rows = 0;
    std::int64_t filled_rows = 0;
    std::int64_t input_row_groups = 0;
    std::int64_t selected_row_groups = 0;
    std::vector<OhlcvQualityEvent> quality_events;
    std::uintmax_t bytes_written = 0;
    std::string operation;
};

class OhlcvDataPlaneError : public std::runtime_error {
public:
    OhlcvDataPlaneError(std::string code, std::string message, bool retryable = false);

    [[nodiscard]] const std::string& code() const noexcept;
    [[nodiscard]] bool is_retryable() const noexcept;

private:
    std::string code_;
    bool retryable_;
};

using CancellationProbe = std::function<bool()>;

[[nodiscard]] OhlcvDataPlaneRequest parse_ohlcv_data_plane_request(
    const nlohmann::json& document);

[[nodiscard]] OhlcvDecisionMetadata execute_ohlcv_data_plane(
    const OhlcvDataPlaneRequest& request,
    CancellationProbe cancellation_probe = {});

[[nodiscard]] nlohmann::json ohlcv_metadata_json(
    const OhlcvDecisionMetadata& metadata);

[[nodiscard]] nlohmann::json run_ohlcv_data_plane_command(
    const nlohmann::json& document,
    CancellationProbe cancellation_probe = {});

[[nodiscard]] std::string_view ohlcv_operation_name(OhlcvOperation operation) noexcept;

}  // namespace StratCraft::executor::data_plane
