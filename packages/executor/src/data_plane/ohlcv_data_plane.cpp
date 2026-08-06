#include "quantnexus/executor/data_plane/ohlcv_data_plane.hpp"

#include "quantnexus/executor/data_plane/ohlcv_constants.hpp"

#include <arrow/api.h>
#include <arrow/io/file.h>
#include <parquet/arrow/reader.h>
#include <parquet/arrow/writer.h>
#include <parquet/statistics.h>

#include <algorithm>
#include <cerrno>
#include <cctype>
#include <cmath>
#include <compare>
#include <cstring>
#include <format>
#include <limits>
#include <map>
#include <set>
#include <system_error>
#include <tuple>
#include <utility>

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace StratCraft::executor::data_plane {
namespace {

using namespace ohlcv_constants;

struct Row {
    std::string symbol;
    std::int64_t timestamp_ms;
    double open;
    double high;
    double low;
    double close;
    double volume;
    std::int64_t precedence;
    std::uint64_t sequence;
};

struct RowKey {
    std::string symbol;
    std::int64_t timestamp_ms;
    auto operator<=>(const RowKey&) const = default;
};

[[noreturn]] void fail(std::string code, std::string message, bool retryable = false) {
    throw OhlcvDataPlaneError(std::move(code), std::move(message), retryable);
}

void check_cancelled(
    const OhlcvDataPlaneRequest& request,
    const CancellationProbe& probe) {
    if ((probe && probe()) ||
        (!request.cancellation_path.empty() &&
         std::filesystem::exists(request.cancellation_path))) {
        fail("QNX_OHLCV_CANCELLED", "OHLCV data-plane operation was cancelled");
    }
}

TimestampUnit parse_timestamp_unit(std::string_view value) {
    if (value == "s") return TimestampUnit::seconds;
    if (value == "ms") return TimestampUnit::milliseconds;
    if (value == "us") return TimestampUnit::microseconds;
    if (value == "ns") return TimestampUnit::nanoseconds;
    fail("QNX_OHLCV_CONTRACT_INVALID",
         "timestampUnit must be one of s, ms, us, or ns");
}

std::int64_t to_milliseconds(std::int64_t value, TimestampUnit unit) {
    const auto floor_scaled = [](std::int64_t raw, std::int64_t scale) {
        auto quotient = raw / scale;
        if (raw < 0 && raw % scale != 0) --quotient;
        return quotient;
    };
    switch (unit) {
        case TimestampUnit::seconds:
            if (value > std::numeric_limits<std::int64_t>::max() /
                            MILLISECONDS_PER_SECOND ||
                value < std::numeric_limits<std::int64_t>::min() /
                            MILLISECONDS_PER_SECOND) {
                fail("QNX_OHLCV_TIMESTAMP_INVALID",
                     "timestamp overflows epoch milliseconds");
            }
            return value * MILLISECONDS_PER_SECOND;
        case TimestampUnit::milliseconds:
            return value;
        case TimestampUnit::microseconds:
            return floor_scaled(value, MILLISECONDS_PER_SECOND);
        case TimestampUnit::nanoseconds:
            return floor_scaled(
                value, MILLISECONDS_PER_SECOND * MILLISECONDS_PER_SECOND);
    }
    std::unreachable();
}

std::int64_t from_milliseconds_floor(std::int64_t value, TimestampUnit unit) {
    switch (unit) {
        case TimestampUnit::seconds: {
            auto quotient = value / MILLISECONDS_PER_SECOND;
            if (value > 0 && value % MILLISECONDS_PER_SECOND != 0) ++quotient;
            return quotient;
        }
        case TimestampUnit::milliseconds:
            return value;
        case TimestampUnit::microseconds:
            if (value > std::numeric_limits<std::int64_t>::max() /
                            MILLISECONDS_PER_SECOND ||
                value < std::numeric_limits<std::int64_t>::min() /
                            MILLISECONDS_PER_SECOND) {
                fail("QNX_OHLCV_WINDOW_INVALID",
                     "window overflows input timestamp unit");
            }
            return value * MILLISECONDS_PER_SECOND;
        case TimestampUnit::nanoseconds:
            if (value > std::numeric_limits<std::int64_t>::max() /
                            (MILLISECONDS_PER_SECOND * MILLISECONDS_PER_SECOND) ||
                value < std::numeric_limits<std::int64_t>::min() /
                            (MILLISECONDS_PER_SECOND * MILLISECONDS_PER_SECOND)) {
                fail("QNX_OHLCV_WINDOW_INVALID",
                     "window overflows input timestamp unit");
            }
            return value * MILLISECONDS_PER_SECOND * MILLISECONDS_PER_SECOND;
    }
    std::unreachable();
}

std::int64_t from_milliseconds_ceil(std::int64_t value, TimestampUnit unit) {
    if (unit == TimestampUnit::seconds) {
        auto quotient = value / MILLISECONDS_PER_SECOND;
        if (value < 0 && value % MILLISECONDS_PER_SECOND != 0) --quotient;
        return quotient;
    }
    if (unit == TimestampUnit::milliseconds) return value;
    const auto scale =
        unit == TimestampUnit::microseconds
            ? MILLISECONDS_PER_SECOND
            : MILLISECONDS_PER_SECOND * MILLISECONDS_PER_SECOND;
    if (value >
        (std::numeric_limits<std::int64_t>::max() - (scale - 1)) / scale) {
        return std::numeric_limits<std::int64_t>::max();
    }
    if (value < std::numeric_limits<std::int64_t>::min() / scale) {
        return std::numeric_limits<std::int64_t>::min();
    }
    return value * scale + (scale - 1);
}

TimestampUnit effective_timestamp_unit(
    const std::shared_ptr<arrow::DataType>& type,
    TimestampUnit declared) {
    if (type->id() != arrow::Type::TIMESTAMP) return declared;
    const auto timestamp = std::static_pointer_cast<arrow::TimestampType>(type);
    switch (timestamp->unit()) {
        case arrow::TimeUnit::SECOND: return TimestampUnit::seconds;
        case arrow::TimeUnit::MILLI: return TimestampUnit::milliseconds;
        case arrow::TimeUnit::MICRO: return TimestampUnit::microseconds;
        case arrow::TimeUnit::NANO: return TimestampUnit::nanoseconds;
    }
    std::unreachable();
}

int field_index(
    const std::shared_ptr<arrow::Schema>& schema,
    const std::string& name,
    std::string_view role) {
    const int index = schema->GetFieldIndex(name);
    if (index < 0) {
        fail("QNX_OHLCV_SCHEMA_INVALID",
             std::format("input is missing {} column '{}'", role, name));
    }
    return index;
}

double numeric_value(
    const std::shared_ptr<arrow::Array>& array,
    std::int64_t index,
    std::string_view field) {
    if (array->IsNull(index)) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    switch (array->type_id()) {
        case arrow::Type::DOUBLE:
            return std::static_pointer_cast<arrow::DoubleArray>(array)->Value(index);
        case arrow::Type::FLOAT:
            return std::static_pointer_cast<arrow::FloatArray>(array)->Value(index);
        case arrow::Type::INT64:
            return static_cast<double>(
                std::static_pointer_cast<arrow::Int64Array>(array)->Value(index));
        case arrow::Type::INT32:
            return static_cast<double>(
                std::static_pointer_cast<arrow::Int32Array>(array)->Value(index));
        case arrow::Type::DECIMAL128:
            return std::stod(
                std::static_pointer_cast<arrow::Decimal128Array>(array)
                    ->FormatValue(index));
        default:
            fail("QNX_OHLCV_SCHEMA_INVALID",
                 std::format("{} must be a numeric Arrow column", field));
    }
}

std::int64_t timestamp_value(
    const std::shared_ptr<arrow::Array>& array,
    std::int64_t index,
    TimestampUnit unit) {
    if (array->IsNull(index)) {
        fail("QNX_OHLCV_TIMESTAMP_INVALID", "timestamp must not be null");
    }
    std::int64_t raw = 0;
    switch (array->type_id()) {
        case arrow::Type::INT64:
            raw = std::static_pointer_cast<arrow::Int64Array>(array)->Value(index);
            break;
        case arrow::Type::INT32:
            raw = std::static_pointer_cast<arrow::Int32Array>(array)->Value(index);
            break;
        case arrow::Type::TIMESTAMP: {
            const auto timestamp =
                std::static_pointer_cast<arrow::TimestampArray>(array);
            raw = timestamp->Value(index);
            const auto type =
                std::static_pointer_cast<arrow::TimestampType>(array->type());
            switch (type->unit()) {
                case arrow::TimeUnit::SECOND: unit = TimestampUnit::seconds; break;
                case arrow::TimeUnit::MILLI: unit = TimestampUnit::milliseconds; break;
                case arrow::TimeUnit::MICRO: unit = TimestampUnit::microseconds; break;
                case arrow::TimeUnit::NANO: unit = TimestampUnit::nanoseconds; break;
            }
            break;
        }
        default:
            fail("QNX_OHLCV_SCHEMA_INVALID",
                 "timestamp must be int32, int64, or Arrow timestamp");
    }
    return to_milliseconds(raw, unit);
}

std::string symbol_value(
    const std::shared_ptr<arrow::Array>& array,
    std::int64_t index) {
    if (!array || array->IsNull(index)) {
        fail("QNX_OHLCV_SCHEMA_INVALID", "symbol must not be null");
    }
    if (array->type_id() == arrow::Type::STRING) {
        return std::static_pointer_cast<arrow::StringArray>(array)->GetString(index);
    }
    if (array->type_id() == arrow::Type::LARGE_STRING) {
        return std::static_pointer_cast<arrow::LargeStringArray>(array)->GetString(index);
    }
    fail("QNX_OHLCV_SCHEMA_INVALID", "symbol must be an Arrow string column");
}

bool has_invalid_price_or_identity(const Row& row) {
    return row.symbol.empty() || !std::isfinite(row.open) ||
           !std::isfinite(row.high) || !std::isfinite(row.low) ||
           !std::isfinite(row.close) || !std::isfinite(row.volume) ||
           row.open <= 0.0 || row.high <= 0.0 || row.low <= 0.0 ||
           row.close <= 0.0 || row.volume < 0.0;
}

bool is_intrabar_incoherent(const Row& row) {
    return row.high < std::max(row.open, row.close) ||
           row.low > std::min(row.open, row.close);
}

bool has_hard_invariant_violation(const Row& row) {
    return has_invalid_price_or_identity(row) || is_intrabar_incoherent(row);
}

QualityAssetClass parse_quality_asset_class(std::string_view value) {
    if (value == "forex") return QualityAssetClass::forex;
    if (value == "equity") return QualityAssetClass::equity;
    if (value == "crypto") return QualityAssetClass::crypto;
    if (value == "default") return QualityAssetClass::default_class;
    fail("QNX_OHLCV_CONTRACT_INVALID",
         "qualityPolicy.assetClass must be forex, equity, crypto, or default");
}

bool quality_rejects_scale_shift(QualityAssetClass asset_class) {
    return asset_class == QualityAssetClass::forex ||
           asset_class == QualityAssetClass::crypto;
}

bool quality_rejects_intra_bar_range(QualityAssetClass asset_class) {
    return asset_class == QualityAssetClass::forex;
}

double jump_suspect_threshold(QualityAssetClass asset_class) {
    return asset_class == QualityAssetClass::forex
               ? FOREX_JUMP_SUSPECT_THRESHOLD
               : DEFAULT_JUMP_SUSPECT_THRESHOLD;
}

std::int64_t scale_shift_gap_ms(
    QualityAssetClass asset_class,
    std::int64_t jump_gap_ms) {
    if (asset_class == QualityAssetClass::forex) {
        return std::max(jump_gap_ms, FOREX_SCALE_SHIFT_MAX_GAP_MS);
    }
    if (asset_class == QualityAssetClass::crypto) {
        return std::max(jump_gap_ms, CRYPTO_SCALE_SHIFT_MAX_GAP_MS);
    }
    return jump_gap_ms;
}

std::vector<Row> apply_quality_policy(
    const OhlcvDataPlaneRequest& request,
    const std::vector<Row>& rows,
    OhlcvDecisionMetadata& metadata,
    const CancellationProbe& cancellation_probe) {
    const auto record_event = [&](
                                  const Row& row,
                                  std::string_view rule,
                                  std::string_view severity) {
        if (metadata.quality_events.size() >= QUALITY_EVENT_DETAIL_CAP) return;
        metadata.quality_events.push_back(OhlcvQualityEvent{
            .symbol = row.symbol,
            .timestamp_ms = row.timestamp_ms,
            .rule = std::string(rule),
            .severity = std::string(severity),
            .open = row.open,
            .high = row.high,
            .low = row.low,
            .close = row.close,
            .volume = row.volume,
        });
    };
    const auto reject = [&](const Row& row, std::string_view rule) {
        ++metadata.rejected_rows;
        record_event(row, rule, "reject");
        if (request.quality_action == QualityAction::reject_artifact) {
            fail("QNX_OHLCV_QUALITY_REJECTED",
                 std::format("{} OHLCV row at {}:{}",
                             rule, row.symbol, row.timestamp_ms));
        }
    };
    std::vector<Row> accepted;
    accepted.reserve(rows.size());
    const auto policy = request.quality_policy;
    const auto jump_gap_ms =
        policy ? JUMP_GATE_MAX_GAP_INTERVAL_MULTIPLE * policy->interval_ms : 0;
    const auto scale_gap_ms =
        policy ? scale_shift_gap_ms(policy->asset_class, jump_gap_ms) : 0;
    const auto jump_threshold =
        policy ? jump_suspect_threshold(policy->asset_class) : 0.0;

    std::optional<Row> previous_valid;
    for (std::size_t index = 0; index < rows.size(); ++index) {
        const auto& row = rows[index];
        if (index % CANCELLATION_CHECK_ROWS == 0) {
            check_cancelled(request, cancellation_probe);
        }
        if (previous_valid && previous_valid->symbol != row.symbol) {
            previous_valid.reset();
        }
        if (has_hard_invariant_violation(row)) {
            reject(row, has_invalid_price_or_identity(row)
                            ? "nonpositive_price"
                            : "intrabar_incoherent");
            continue;
        }
        if (policy && row.high / row.low >= SCALE_SHIFT_MIN_RATIO) {
            if (quality_rejects_intra_bar_range(policy->asset_class)) {
                reject(row, "intrabar_range");
                continue;
            }
            ++metadata.suspect_rows;
            record_event(row, "intrabar_range", "suspect");
        }
        if (policy && previous_valid) {
            const auto delta_ms = row.timestamp_ms - previous_valid->timestamp_ms;
            const auto ratio = row.close / previous_valid->close;
            const bool scale_shift =
                delta_ms <= scale_gap_ms &&
                (ratio >= SCALE_SHIFT_MIN_RATIO ||
                 ratio <= 1.0 / SCALE_SHIFT_MIN_RATIO);
            if (scale_shift) {
                if (quality_rejects_scale_shift(policy->asset_class)) {
                    reject(row, "scale_shift");
                    continue;
                }
                ++metadata.suspect_rows;
                record_event(row, "scale_shift", "suspect");
                accepted.push_back(row);
                previous_valid = row;
                continue;
            }
            const auto jump = std::abs(ratio - 1.0);
            if (delta_ms <= jump_gap_ms && jump > jump_threshold) {
                const Row* next = index + 1 < rows.size() ? &rows[index + 1] : nullptr;
                const bool same_symbol = next && next->symbol == row.symbol;
                const bool next_gap_ok =
                    same_symbol && next->timestamp_ms - row.timestamp_ms <= jump_gap_ms;
                const bool revert_spike =
                    next_gap_ok && !has_hard_invariant_violation(*next) &&
                    std::abs(next->close / row.close - 1.0) > jump_threshold &&
                    std::abs(next->close / previous_valid->close - 1.0) <=
                        jump_threshold;
                if (revert_spike) {
                    reject(row, "revert_spike");
                    continue;
                }
                ++metadata.suspect_rows;
                record_event(row, "interbar_jump_suspect", "suspect");
            }
        }
        accepted.push_back(row);
        previous_valid = row;
    }
    return accepted;
}

std::vector<int> select_row_groups(
    parquet::arrow::FileReader& reader,
    int timestamp_column,
    TimestampUnit unit,
    const OhlcvWindow& window,
    OhlcvDecisionMetadata& metadata) {
    const auto parquet_metadata = reader.parquet_reader()->metadata();
    metadata.input_row_groups += parquet_metadata->num_row_groups();
    const auto raw_start = from_milliseconds_floor(window.start_ms, unit);
    const auto raw_end = from_milliseconds_ceil(window.end_ms, unit);
    std::vector<int> selected;
    for (int group = 0; group < parquet_metadata->num_row_groups(); ++group) {
        const auto chunk =
            parquet_metadata->RowGroup(group)->ColumnChunk(timestamp_column);
        bool include = true;
        if (chunk->is_stats_set()) {
            const auto stats = std::dynamic_pointer_cast<parquet::Int64Statistics>(
                chunk->statistics());
            if (stats && stats->HasMinMax()) {
                include = stats->max() >= raw_start && stats->min() <= raw_end;
            } else {
                const auto int32_stats =
                    std::dynamic_pointer_cast<parquet::Int32Statistics>(
                        chunk->statistics());
                if (int32_stats && int32_stats->HasMinMax()) {
                    include = static_cast<std::int64_t>(int32_stats->max()) >=
                                  raw_start &&
                              static_cast<std::int64_t>(int32_stats->min()) <=
                                  raw_end;
                }
            }
        }
        if (include) selected.push_back(group);
    }
    metadata.selected_row_groups += static_cast<std::int64_t>(selected.size());
    return selected;
}

void append_input(
    const OhlcvDataPlaneRequest& request,
    const OhlcvInput& input,
    std::uint64_t& sequence,
    std::vector<Row>& rows,
    OhlcvDecisionMetadata& metadata,
    const CancellationProbe& cancellation_probe) {
    check_cancelled(request, cancellation_probe);
    auto file = arrow::io::ReadableFile::Open(input.path.string());
    if (!file.ok()) {
        fail("QNX_OHLCV_READ_FAILED",
             std::format("cannot open input '{}': {}", input.path.string(),
                         file.status().ToString()),
             true);
    }
    parquet::arrow::FileReaderBuilder builder;
    auto status = builder.Open(*file);
    if (!status.ok()) {
        fail("QNX_OHLCV_READ_FAILED", status.ToString(), true);
    }
    std::unique_ptr<parquet::arrow::FileReader> reader;
    status = builder.Build(&reader);
    if (!status.ok()) {
        fail("QNX_OHLCV_READ_FAILED", status.ToString(), true);
    }
    std::shared_ptr<arrow::Schema> schema;
    status = reader->GetSchema(&schema);
    if (!status.ok()) fail("QNX_OHLCV_SCHEMA_INVALID", status.ToString());
    const auto& projection = input.projection;
    const int timestamp_index =
        field_index(schema, projection.timestamp, "timestamp");
    const auto pushdown_unit = effective_timestamp_unit(
        schema->field(timestamp_index)->type(), projection.timestamp_unit);
    std::vector<int> columns{timestamp_index,
                             field_index(schema, projection.open, "open"),
                             field_index(schema, projection.high, "high"),
                             field_index(schema, projection.low, "low"),
                             field_index(schema, projection.close, "close"),
                             field_index(schema, projection.volume, "volume")};
    if (!projection.fixed_symbol) {
        columns.push_back(field_index(schema, projection.symbol, "symbol"));
    }
    std::sort(columns.begin(), columns.end());
    columns.erase(std::unique(columns.begin(), columns.end()), columns.end());
    const auto row_groups = select_row_groups(
        *reader, timestamp_index, pushdown_unit, request.window, metadata);
    std::shared_ptr<arrow::Table> table;
    status = reader->ReadRowGroups(row_groups, columns, &table);
    if (!status.ok()) {
        fail("QNX_OHLCV_READ_FAILED", status.ToString(), true);
    }
    auto combined = table->CombineChunks();
    if (!combined.ok()) fail("QNX_OHLCV_READ_FAILED", combined.status().ToString());
    table = *combined;
    if (table->num_rows() > MAX_INPUT_ROWS ||
        static_cast<std::int64_t>(rows.size()) >
            MAX_INPUT_ROWS - table->num_rows()) {
        fail("QNX_OHLCV_INPUT_TOO_LARGE", "input exceeds canonical row limit");
    }
    const auto column = [&](const std::string& name) {
        const auto values = table->GetColumnByName(name);
        if (!values || values->num_chunks() != 1) {
            fail("QNX_OHLCV_SCHEMA_INVALID",
                 std::format("projected column '{}' is unavailable", name));
        }
        return values->chunk(0);
    };
    const auto timestamp = column(projection.timestamp);
    const auto open = column(projection.open);
    const auto high = column(projection.high);
    const auto low = column(projection.low);
    const auto close = column(projection.close);
    const auto volume = column(projection.volume);
    const auto symbol =
        projection.fixed_symbol ? std::shared_ptr<arrow::Array>{}
                                : column(projection.symbol);
    for (std::int64_t index = 0; index < table->num_rows(); ++index) {
        if (static_cast<std::uint64_t>(index) % CANCELLATION_CHECK_ROWS == 0) {
            check_cancelled(request, cancellation_probe);
        }
        Row row{
            .symbol = projection.fixed_symbol
                          ? *projection.fixed_symbol
                          : symbol_value(symbol, index),
            .timestamp_ms =
                timestamp_value(timestamp, index, projection.timestamp_unit),
            .open = numeric_value(open, index, "open"),
            .high = numeric_value(high, index, "high"),
            .low = numeric_value(low, index, "low"),
            .close = numeric_value(close, index, "close"),
            .volume = numeric_value(volume, index, "volume"),
            .precedence = input.precedence,
            .sequence = sequence++,
        };
        if (row.timestamp_ms < request.window.start_ms ||
            row.timestamp_ms > request.window.end_ms) {
            continue;
        }
        rows.push_back(std::move(row));
    }
}

void append_inline_rows(
    const OhlcvDataPlaneRequest& request,
    std::uint64_t& sequence,
    std::vector<Row>& rows,
    const CancellationProbe& cancellation_probe) {
    if (request.inline_rows.size() > static_cast<std::size_t>(MAX_INPUT_ROWS) ||
        rows.size() > static_cast<std::size_t>(MAX_INPUT_ROWS) -
                          request.inline_rows.size()) {
        fail("QNX_OHLCV_INPUT_TOO_LARGE", "input exceeds canonical row limit");
    }
    for (std::size_t index = 0; index < request.inline_rows.size(); ++index) {
        if (index % CANCELLATION_CHECK_ROWS == 0) {
            check_cancelled(request, cancellation_probe);
        }
        const auto& input = request.inline_rows[index];
        Row row{
            .symbol = input.symbol,
            .timestamp_ms = to_milliseconds(input.timestamp, input.timestamp_unit),
            .open = input.open,
            .high = input.high,
            .low = input.low,
            .close = input.close,
            .volume = input.volume,
            .precedence = input.precedence,
            .sequence = sequence++,
        };
        if (row.timestamp_ms < request.window.start_ms ||
            row.timestamp_ms > request.window.end_ms) {
            continue;
        }
        rows.push_back(std::move(row));
    }
}

std::vector<Row> deduplicate(
    std::vector<Row> rows,
    OhlcvDecisionMetadata& metadata) {
    std::map<RowKey, Row> latest;
    for (auto& row : rows) {
        const RowKey key{row.symbol, row.timestamp_ms};
        const auto found = latest.find(key);
        if (found == latest.end()) {
            latest.emplace(key, std::move(row));
            continue;
        }
        ++metadata.duplicate_rows;
        if (row.precedence > found->second.precedence ||
            (row.precedence == found->second.precedence &&
             row.sequence > found->second.sequence)) {
            found->second = std::move(row);
        }
    }
    std::vector<Row> result;
    result.reserve(latest.size());
    for (auto& [key, row] : latest) {
        (void)key;
        result.push_back(std::move(row));
    }
    return result;
}

std::int64_t floor_div(std::int64_t value, std::int64_t divisor) {
    auto quotient = value / divisor;
    const auto remainder = value % divisor;
    if (remainder != 0 && ((remainder < 0) != (divisor < 0))) --quotient;
    return quotient;
}

std::int64_t anchor_for(
    std::int64_t timestamp,
    const std::vector<SessionAnchor>& anchors) {
    auto found = std::upper_bound(
        anchors.begin(), anchors.end(), timestamp,
        [](std::int64_t value, const SessionAnchor& anchor) {
            return value < anchor.effective_start_ms;
        });
    if (found == anchors.begin()) {
        fail("QNX_OHLCV_SESSION_ANCHOR_MISSING",
             std::format("no session anchor covers timestamp {}", timestamp));
    }
    return std::prev(found)->anchor_ms;
}

Row aggregate_rows(
    const std::vector<Row>& rows,
    std::size_t begin,
    std::size_t end,
    std::int64_t timestamp) {
    Row result = rows[begin];
    result.timestamp_ms = timestamp;
    result.open = rows[begin].open;
    result.high = rows[begin].high;
    result.low = rows[begin].low;
    result.volume = 0.0;
    for (std::size_t index = begin; index < end; ++index) {
        result.high = std::max(result.high, rows[index].high);
        result.low = std::min(result.low, rows[index].low);
        result.close = rows[index].close;
        result.volume += rows[index].volume;
        result.precedence = std::max(result.precedence, rows[index].precedence);
        result.sequence = std::max(result.sequence, rows[index].sequence);
    }
    return result;
}

std::vector<Row> aggregate_intervals(
    const OhlcvDataPlaneRequest& request,
    std::vector<Row> rows) {
    if (request.target_interval_ms <= 0) {
        fail("QNX_OHLCV_CONTRACT_INVALID", "targetIntervalMs must be positive");
    }
    if (request.session_anchors.empty()) {
        fail("QNX_OHLCV_SESSION_ANCHOR_MISSING",
             "aggregation requires explicit sessionAnchors");
    }
    std::sort(rows.begin(), rows.end(), [](const Row& left, const Row& right) {
        return std::tie(left.symbol, left.timestamp_ms) <
               std::tie(right.symbol, right.timestamp_ms);
    });
    std::map<RowKey, std::vector<Row>> buckets;
    for (auto& row : rows) {
        const auto anchor = anchor_for(row.timestamp_ms, request.session_anchors);
        const auto bucket =
            anchor + floor_div(row.timestamp_ms - anchor,
                               request.target_interval_ms) *
                         request.target_interval_ms;
        if (!request.keep_partial_bucket &&
            (bucket < request.window.start_ms ||
             bucket + request.target_interval_ms - 1 > request.window.end_ms)) {
            continue;
        }
        buckets[RowKey{row.symbol, bucket}].push_back(std::move(row));
    }
    std::vector<Row> result;
    result.reserve(buckets.size());
    for (auto& [key, bucket] : buckets) {
        result.push_back(aggregate_rows(bucket, 0, bucket.size(), key.timestamp_ms));
    }
    return result;
}

std::vector<Row> pool_calendar(
    const OhlcvDataPlaneRequest& request,
    const std::vector<Row>& rows,
    OhlcvDecisionMetadata& metadata) {
    if (request.calendar_ms.empty()) {
        fail("QNX_OHLCV_CALENDAR_MISSING",
             "pool operation requires a non-empty calendarMs");
    }
    if (request.pool_symbols.empty()) {
        fail("QNX_OHLCV_CALENDAR_MISSING",
             "pool operation requires explicit symbols");
    }
    std::map<std::string, std::vector<Row>> by_symbol;
    for (const auto& row : rows) by_symbol[row.symbol].push_back(row);
    std::vector<Row> result;
    for (const auto& symbol : request.pool_symbols) {
        const auto& source = by_symbol[symbol];
        std::optional<Row> previous;
        for (std::size_t day = 0; day < request.calendar_ms.size(); ++day) {
            const auto start = request.calendar_ms[day];
            const auto end =
                day + 1 < request.calendar_ms.size()
                    ? request.calendar_ms[day + 1]
                    : std::min(request.window.end_ms + 1,
                               start + MILLISECONDS_PER_DAY);
            const auto first = std::lower_bound(
                source.begin(), source.end(), start,
                [](const Row& row, std::int64_t value) {
                    return row.timestamp_ms < value;
                });
            const auto last = std::lower_bound(
                first, source.end(), end,
                [](const Row& row, std::int64_t value) {
                    return row.timestamp_ms < value;
                });
            if (first != last) {
                const auto begin = static_cast<std::size_t>(
                    std::distance(source.begin(), first));
                const auto finish = static_cast<std::size_t>(
                    std::distance(source.begin(), last));
                auto daily = aggregate_rows(source, begin, finish, start);
                result.push_back(daily);
                previous = std::move(daily);
            } else if (request.fill_policy == FillPolicy::forward && previous) {
                auto filled = *previous;
                filled.timestamp_ms = start;
                filled.open = filled.close;
                filled.high = filled.close;
                filled.low = filled.close;
                filled.volume = FILLED_VOLUME;
                result.push_back(std::move(filled));
                ++metadata.filled_rows;
            }
        }
    }
    return result;
}

template <typename Builder, typename Value>
void append(Builder& builder, Value&& value, std::string_view field) {
    const auto status = builder.Append(std::forward<Value>(value));
    if (!status.ok()) {
        fail("QNX_OHLCV_WRITE_FAILED",
             std::format("failed to append {}: {}", field, status.ToString()),
             true);
    }
}

template <typename Builder>
std::shared_ptr<arrow::Array> finish(Builder& builder, std::string_view field) {
    auto result = builder.Finish();
    if (!result.ok()) {
        fail("QNX_OHLCV_WRITE_FAILED",
             std::format("failed to finish {}: {}", field,
                         result.status().ToString()),
             true);
    }
    return *result;
}

void sync_file(const std::filesystem::path& path) {
#ifdef _WIN32
    const auto handle = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                                    nullptr, OPEN_EXISTING,
                                    FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
        fail("QNX_OHLCV_SYNC_FAILED", "cannot open temporary artifact for sync", true);
    }
    const bool synced = FlushFileBuffers(handle) != 0;
    CloseHandle(handle);
    if (!synced) fail("QNX_OHLCV_SYNC_FAILED", "artifact sync failed", true);
#else
    const int descriptor = ::open(path.c_str(), O_RDONLY);
    if (descriptor < 0) {
        fail("QNX_OHLCV_SYNC_FAILED", "cannot open temporary artifact for sync", true);
    }
    const int synced = ::fsync(descriptor);
    const int closed = ::close(descriptor);
    if (synced != 0 || closed != 0) {
        fail("QNX_OHLCV_SYNC_FAILED", "artifact sync failed", true);
    }
#endif
}

std::filesystem::path temporary_path(const OhlcvDataPlaneRequest& request) {
    std::string safe_id = request.decision_id;
    std::replace_if(safe_id.begin(), safe_id.end(),
                    [](unsigned char value) {
                        return !std::isalnum(value) && value != '-' && value != '_';
                    },
                    '_');
    return request.output_path.parent_path() /
           std::format(".{}.{}.tmp",
                       request.output_path.filename().string(), safe_id);
}

void write_atomic(
    const OhlcvDataPlaneRequest& request,
    const std::vector<Row>& rows,
    OhlcvDecisionMetadata& metadata,
    const CancellationProbe& cancellation_probe) {
    if (request.output_path.empty() || request.output_path.filename().empty()) {
        fail("QNX_OHLCV_CONTRACT_INVALID", "outputPath must name a parquet file");
    }
    if (!request.output_path.parent_path().empty()) {
        std::filesystem::create_directories(request.output_path.parent_path());
    }
    const auto temporary = temporary_path(request);
    std::error_code cleanup_error;
    std::filesystem::remove(temporary, cleanup_error);
    struct Cleanup {
        std::filesystem::path path;
        bool armed = true;
        ~Cleanup() {
            if (!armed) return;
            std::error_code error;
            std::filesystem::remove(path, error);
        }
    } cleanup{temporary};

    arrow::StringBuilder symbol;
    arrow::Int64Builder timestamp;
    arrow::DoubleBuilder open;
    arrow::DoubleBuilder high;
    arrow::DoubleBuilder low;
    arrow::DoubleBuilder close;
    arrow::DoubleBuilder volume;
    std::size_t write_index = 0;
    for (const auto& row : rows) {
        if (write_index++ % CANCELLATION_CHECK_ROWS == 0) {
            check_cancelled(request, cancellation_probe);
        }
        append(symbol, row.symbol, "symbol");
        append(timestamp, row.timestamp_ms, "timestamp");
        append(open, row.open, "open");
        append(high, row.high, "high");
        append(low, row.low, "low");
        append(close, row.close, "close");
        append(volume, row.volume, "volume");
    }
    const auto schema = arrow::schema(
        {arrow::field("symbol", arrow::utf8(), false),
         arrow::field("timestamp", arrow::int64(), false),
         arrow::field("open", arrow::float64(), false),
         arrow::field("high", arrow::float64(), false),
         arrow::field("low", arrow::float64(), false),
         arrow::field("close", arrow::float64(), false),
         arrow::field("volume", arrow::float64(), false)},
        arrow::key_value_metadata(
            {"qnx.contract", "qnx.timestamp.unit"},
            {std::string(SCHEMA_VERSION), std::string(TIMESTAMP_UNIT)}));
    const auto table = arrow::Table::Make(
        schema, {finish(symbol, "symbol"), finish(timestamp, "timestamp"),
                 finish(open, "open"), finish(high, "high"),
                 finish(low, "low"), finish(close, "close"),
                 finish(volume, "volume")});
    auto output = arrow::io::FileOutputStream::Open(temporary.string());
    if (!output.ok()) {
        fail("QNX_OHLCV_WRITE_FAILED", output.status().ToString(), true);
    }
    parquet::WriterProperties::Builder properties;
    properties.compression(parquet::Compression::ZSTD);
    auto status = parquet::arrow::WriteTable(
        *table, arrow::default_memory_pool(), *output, DEFAULT_ROW_GROUP_ROWS,
        properties.build());
    if (!status.ok()) fail("QNX_OHLCV_WRITE_FAILED", status.ToString(), true);
    status = (*output)->Close();
    if (!status.ok()) fail("QNX_OHLCV_WRITE_FAILED", status.ToString(), true);
    sync_file(temporary);
    check_cancelled(request, cancellation_probe);
#ifdef _WIN32
    const bool published =
        MoveFileExW(temporary.c_str(), request.output_path.c_str(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
    if (!published) {
        fail("QNX_OHLCV_PUBLISH_FAILED",
             std::format("atomic publish failed with Windows error {}",
                         GetLastError()),
             true);
    }
#else
    if (::rename(temporary.c_str(), request.output_path.c_str()) != 0) {
        fail("QNX_OHLCV_PUBLISH_FAILED",
             std::format("atomic publish failed: {}", std::strerror(errno)),
             true);
    }
    const auto directory = request.output_path.parent_path().empty()
                               ? std::filesystem::path{"."}
                               : request.output_path.parent_path();
    const int directory_descriptor =
        ::open(directory.c_str(), O_RDONLY | O_DIRECTORY);
    if (directory_descriptor < 0) {
        fail("QNX_OHLCV_SYNC_FAILED",
             "cannot open artifact directory for sync", true);
    }
    const int directory_synced = ::fsync(directory_descriptor);
    const int directory_closed = ::close(directory_descriptor);
    if (directory_synced != 0 || directory_closed != 0) {
        fail("QNX_OHLCV_SYNC_FAILED",
             "published artifact directory sync failed", true);
    }
#endif
    cleanup.armed = false;
    metadata.bytes_written = std::filesystem::file_size(request.output_path);
}

OhlcvProjection parse_projection(const nlohmann::json& document) {
    OhlcvProjection projection;
    if (document.is_null()) return projection;
    if (!document.is_object()) {
        fail("QNX_OHLCV_CONTRACT_INVALID", "projection must be an object");
    }
    projection.symbol = document.value("symbol", projection.symbol);
    projection.timestamp = document.value("timestamp", projection.timestamp);
    projection.open = document.value("open", projection.open);
    projection.high = document.value("high", projection.high);
    projection.low = document.value("low", projection.low);
    projection.close = document.value("close", projection.close);
    projection.volume = document.value("volume", projection.volume);
    if (document.contains("fixedSymbol")) {
        projection.fixed_symbol = document.at("fixedSymbol").get<std::string>();
    }
    projection.timestamp_unit =
        parse_timestamp_unit(document.value("timestampUnit", "ms"));
    return projection;
}

}  // namespace

OhlcvDataPlaneError::OhlcvDataPlaneError(
    std::string code, std::string message, bool retryable)
    : std::runtime_error(std::move(message)),
      code_(std::move(code)),
      retryable_(retryable) {}

const std::string& OhlcvDataPlaneError::code() const noexcept { return code_; }

bool OhlcvDataPlaneError::is_retryable() const noexcept { return retryable_; }

std::string_view ohlcv_operation_name(OhlcvOperation operation) noexcept {
    switch (operation) {
        case OhlcvOperation::canonicalize: return "canonicalize";
        case OhlcvOperation::merge: return "merge";
        case OhlcvOperation::aggregate: return "aggregate";
        case OhlcvOperation::pool: return "pool";
        case OhlcvOperation::byod: return "byod";
    }
    std::unreachable();
}

OhlcvDataPlaneRequest parse_ohlcv_data_plane_request(
    const nlohmann::json& document) {
    if (!document.is_object()) {
        fail("QNX_OHLCV_CONTRACT_INVALID", "request must be an object");
    }
    if (document.value("version", "") != CONTRACT_VERSION) {
        fail("QNX_OHLCV_CONTRACT_INVALID",
             std::format("version must be {}", CONTRACT_VERSION));
    }
    const auto operation_name = document.value("operation", "");
    OhlcvOperation operation;
    if (operation_name == "canonicalize") operation = OhlcvOperation::canonicalize;
    else if (operation_name == "merge") operation = OhlcvOperation::merge;
    else if (operation_name == "aggregate") operation = OhlcvOperation::aggregate;
    else if (operation_name == "pool") operation = OhlcvOperation::pool;
    else if (operation_name == "byod") operation = OhlcvOperation::byod;
    else {
        fail("QNX_OHLCV_CONTRACT_INVALID",
             "operation must be canonicalize, merge, aggregate, pool, or byod");
    }
    if (!document.contains("window") || !document.at("window").is_object()) {
        fail("QNX_OHLCV_WINDOW_INVALID",
             "bounded request requires window.startMs and window.endMs");
    }
    const auto& window = document.at("window");
    const auto start = window.at("startMs").get<std::int64_t>();
    const auto end = window.at("endMs").get<std::int64_t>();
    if (start > end) {
        fail("QNX_OHLCV_WINDOW_INVALID", "window.startMs must not exceed window.endMs");
    }
    OhlcvDataPlaneRequest request;
    request.decision_id = document.value("decisionId", "");
    request.operation = operation;
    request.window = {.start_ms = start, .end_ms = end};
    request.output_path = document.value("outputPath", "");
    if (request.decision_id.empty()) {
        fail("QNX_OHLCV_CONTRACT_INVALID", "decisionId must be non-empty");
    }
    if (!document.contains("inputs") || !document.at("inputs").is_array()) {
        fail("QNX_OHLCV_CONTRACT_INVALID", "inputs must be an array");
    }
    for (const auto& item : document.at("inputs")) {
        if (!item.is_object()) {
            fail("QNX_OHLCV_CONTRACT_INVALID", "each input must be an object");
        }
        const auto path = item.value("path", "");
        if (path.empty()) {
            fail("QNX_OHLCV_CONTRACT_INVALID", "input.path must be non-empty");
        }
        request.inputs.push_back(OhlcvInput{
            .path = path,
            .projection = parse_projection(item.value(
                "projection", nlohmann::json::object())),
            .precedence = item.value("precedence", std::int64_t{0}),
        });
    }
    if (document.contains("inlineRows")) {
        if (!document.at("inlineRows").is_array()) {
            fail("QNX_OHLCV_CONTRACT_INVALID", "inlineRows must be an array");
        }
        for (const auto& item : document.at("inlineRows")) {
            if (!item.is_object()) {
                fail("QNX_OHLCV_CONTRACT_INVALID",
                     "each inlineRows entry must be an object");
            }
            request.inline_rows.push_back(OhlcvInlineRow{
                .symbol = item.value("symbol", ""),
                .timestamp = item.at("timestamp").get<std::int64_t>(),
                .open = item.at("open").get<double>(),
                .high = item.at("high").get<double>(),
                .low = item.at("low").get<double>(),
                .close = item.at("close").get<double>(),
                .volume = item.at("volume").get<double>(),
                .precedence = item.value("precedence", std::int64_t{0}),
                .timestamp_unit =
                    parse_timestamp_unit(item.value("timestampUnit", "ms")),
            });
        }
    }
    if (document.contains("cancellationPath")) {
        request.cancellation_path =
            document.at("cancellationPath").get<std::string>();
    }
    request.target_interval_ms =
        document.value("targetIntervalMs", std::int64_t{0});
    request.keep_partial_bucket =
        document.value("keepPartialBucket", true);
    if (document.contains("sessionAnchors")) {
        for (const auto& anchor : document.at("sessionAnchors")) {
            request.session_anchors.push_back(SessionAnchor{
                .effective_start_ms =
                    anchor.at("effectiveStartMs").get<std::int64_t>(),
                .anchor_ms = anchor.at("anchorMs").get<std::int64_t>(),
            });
        }
    }
    if (document.contains("calendarMs")) {
        request.calendar_ms =
            document.at("calendarMs").get<std::vector<std::int64_t>>();
    }
    if (document.contains("symbols")) {
        request.pool_symbols =
            document.at("symbols").get<std::vector<std::string>>();
    }
    const auto fill = document.value("fillPolicy", "none");
    if (fill == "none") request.fill_policy = FillPolicy::none;
    else if (fill == "forward") request.fill_policy = FillPolicy::forward;
    else fail("QNX_OHLCV_CONTRACT_INVALID", "fillPolicy must be none or forward");
    const auto quality = document.value("qualityAction", "reject_artifact");
    if (quality == "reject_artifact") {
        request.quality_action = QualityAction::reject_artifact;
    } else if (quality == "drop_rows") {
        request.quality_action = QualityAction::drop_rows;
    } else {
        fail("QNX_OHLCV_CONTRACT_INVALID",
             "qualityAction must be reject_artifact or drop_rows");
    }
    if (document.contains("qualityPolicy")) {
        const auto& policy = document.at("qualityPolicy");
        if (!policy.is_object()) {
            fail("QNX_OHLCV_CONTRACT_INVALID",
                 "qualityPolicy must be an object");
        }
        const auto interval_ms = policy.value("intervalMs", std::int64_t{0});
        if (interval_ms <= 0 ||
            interval_ms > std::numeric_limits<std::int64_t>::max() /
                              JUMP_GATE_MAX_GAP_INTERVAL_MULTIPLE) {
            fail("QNX_OHLCV_CONTRACT_INVALID",
                 "qualityPolicy.intervalMs must be positive and bounded");
        }
        request.quality_policy = OhlcvQualityPolicy{
            .asset_class = parse_quality_asset_class(
                policy.value("assetClass", "default")),
            .interval_ms = interval_ms,
        };
    }
    if (document.contains("minimumOutputRows")) {
        const auto minimum = document.at("minimumOutputRows").get<std::int64_t>();
        if (minimum < 0 || minimum > MAX_INPUT_ROWS) {
            fail("QNX_OHLCV_CONTRACT_INVALID",
                 "minimumOutputRows must be between zero and the canonical row limit");
        }
        request.minimum_output_rows = minimum;
    }
    std::sort(request.session_anchors.begin(), request.session_anchors.end(),
              [](const SessionAnchor& left, const SessionAnchor& right) {
                  return left.effective_start_ms < right.effective_start_ms;
              });
    if (std::adjacent_find(
            request.session_anchors.begin(), request.session_anchors.end(),
            [](const SessionAnchor& left, const SessionAnchor& right) {
                return left.effective_start_ms == right.effective_start_ms;
            }) != request.session_anchors.end()) {
        fail("QNX_OHLCV_CONTRACT_INVALID",
             "sessionAnchors effectiveStartMs values must be unique");
    }
    if (!std::is_sorted(request.calendar_ms.begin(), request.calendar_ms.end()) ||
        std::adjacent_find(request.calendar_ms.begin(), request.calendar_ms.end()) !=
            request.calendar_ms.end()) {
        fail("QNX_OHLCV_CONTRACT_INVALID",
             "calendarMs must be strictly increasing");
    }
    if (std::any_of(
            request.calendar_ms.begin(), request.calendar_ms.end(),
            [&](std::int64_t timestamp) {
                return timestamp < request.window.start_ms ||
                       timestamp > request.window.end_ms;
            })) {
        fail("QNX_OHLCV_WINDOW_INVALID",
             "calendarMs entries must be inside the requested window");
    }
    if (std::any_of(
            request.pool_symbols.begin(), request.pool_symbols.end(),
            [](const std::string& symbol) { return symbol.empty(); }) ||
        std::set<std::string>(
            request.pool_symbols.begin(), request.pool_symbols.end()).size() !=
            request.pool_symbols.size()) {
        fail("QNX_OHLCV_CONTRACT_INVALID",
             "symbols must be non-empty and unique");
    }
    return request;
}

OhlcvDecisionMetadata execute_ohlcv_data_plane(
    const OhlcvDataPlaneRequest& request,
    CancellationProbe cancellation_probe) {
    OhlcvDecisionMetadata metadata;
    metadata.decision_id = request.decision_id;
    metadata.operation = ohlcv_operation_name(request.operation);
    check_cancelled(request, cancellation_probe);
    std::vector<Row> rows;
    std::uint64_t sequence = 0;
    for (const auto& input : request.inputs) {
        append_input(request, input, sequence, rows, metadata, cancellation_probe);
    }
    append_inline_rows(
        request, sequence, rows, cancellation_probe);
    rows = deduplicate(std::move(rows), metadata);
    rows = apply_quality_policy(
        request, rows, metadata, cancellation_probe);
    if (request.operation == OhlcvOperation::aggregate) {
        rows = aggregate_intervals(request, std::move(rows));
    } else if (request.operation == OhlcvOperation::pool) {
        rows = pool_calendar(request, rows, metadata);
    }
    if (request.minimum_output_rows &&
        static_cast<std::int64_t>(rows.size()) < *request.minimum_output_rows) {
        fail("QNX_OHLCV_PRESERVATION_FAILED",
             std::format("canonical output has {} rows, below required minimum {}",
                         rows.size(), *request.minimum_output_rows));
    }
    std::sort(rows.begin(), rows.end(), [](const Row& left, const Row& right) {
        return std::tie(left.symbol, left.timestamp_ms) <
               std::tie(right.symbol, right.timestamp_ms);
    });
    metadata.row_count = static_cast<std::int64_t>(rows.size());
    for (const auto& row : rows) {
        metadata.extent_start_ms =
            metadata.extent_start_ms
                ? std::min(*metadata.extent_start_ms, row.timestamp_ms)
                : row.timestamp_ms;
        metadata.extent_end_ms =
            metadata.extent_end_ms
                ? std::max(*metadata.extent_end_ms, row.timestamp_ms)
                : row.timestamp_ms;
    }
    write_atomic(request, rows, metadata, cancellation_probe);
    return metadata;
}

nlohmann::json ohlcv_metadata_json(const OhlcvDecisionMetadata& metadata) {
    auto quality_events = nlohmann::json::array();
    for (const auto& event : metadata.quality_events) {
        quality_events.push_back({
            {"symbol", event.symbol},
            {"timestampMs", event.timestamp_ms},
            {"rule", event.rule},
            {"severity", event.severity},
            {"original",
             {{"open", event.open},
              {"high", event.high},
              {"low", event.low},
              {"close", event.close},
              {"volume", event.volume}}},
        });
    }
    return {
        {"version", CONTRACT_VERSION},
        {"status", "ok"},
        {"decisionId", metadata.decision_id},
        {"operation", metadata.operation},
        {"schema",
         {{"version", SCHEMA_VERSION},
          {"columns",
           {"symbol", "timestamp", "open", "high", "low", "close", "volume"}},
          {"timestampUnit", TIMESTAMP_UNIT}}},
        {"rowCount", metadata.row_count},
        {"extent",
         (metadata.extent_start_ms && metadata.extent_end_ms)
             ? nlohmann::json{{"startMs", *metadata.extent_start_ms},
                              {"endMs", *metadata.extent_end_ms}}
             : nlohmann::json(nullptr)},
        {"codec", DEFAULT_CODEC},
        {"bytesWritten", metadata.bytes_written},
        {"decisions",
         {{"rejectedRows", metadata.rejected_rows},
          {"suspectRows", metadata.suspect_rows},
          {"duplicateRows", metadata.duplicate_rows},
          {"filledRows", metadata.filled_rows},
          {"inputRowGroups", metadata.input_row_groups},
          {"selectedRowGroups", metadata.selected_row_groups}}},
        {"qualityEvents", std::move(quality_events)},
    };
}

nlohmann::json run_ohlcv_data_plane_command(
    const nlohmann::json& document,
    CancellationProbe cancellation_probe) {
    const auto request = parse_ohlcv_data_plane_request(document);
    return ohlcv_metadata_json(
        execute_ohlcv_data_plane(request, std::move(cancellation_probe)));
}

}  // namespace StratCraft::executor::data_plane
