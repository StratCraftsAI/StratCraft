#include "quantnexus/executor/data_plane/eval_parquet.hpp"
#include "quantnexus/executor/statistics/correlation.hpp"

#include <arrow/api.h>
#include <arrow/io/file.h>
#include <parquet/arrow/reader.h>
#include <parquet/arrow/writer.h>
#include <parquet/statistics.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <format>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <system_error>
#include <unordered_map>

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace StratCraft::executor::data_plane {
namespace {

constexpr std::int32_t kNullPathIndex = -1;

template <typename T>
T read_scalar(std::istream& input, std::string_view field) {
    T value{};
    input.read(reinterpret_cast<char*>(&value), sizeof(value));
    if (!input) {
        throw std::runtime_error(std::format(
            "eval row stream truncated while reading {}", field));
    }
    return value;
}

std::string read_symbol(std::istream& input) {
    const auto size = read_scalar<std::uint32_t>(input, "symbol length");
    if (size > 1024U * 1024U) {
        throw std::runtime_error("eval row symbol exceeds 1 MiB");
    }
    std::string value(size, '\0');
    input.read(value.data(), static_cast<std::streamsize>(size));
    if (!input) {
        throw std::runtime_error("eval row stream truncated while reading symbol");
    }
    return value;
}

void require_positive_id(std::int64_t value, std::string_view field) {
    if (value <= 0) {
        throw std::runtime_error(std::format("{} must be a positive integer", field));
    }
}

void require_finite(double value, std::string_view field) {
    if (!std::isfinite(value)) {
        throw std::runtime_error(std::format("{} must be finite", field));
    }
}

void sync_file(const std::filesystem::path& path) {
#ifdef _WIN32
    const auto handle = CreateFileW(
        path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
        throw std::runtime_error(
            "failed to open eval parquet for durable sync");
    }
    const bool ok = FlushFileBuffers(handle) != 0;
    CloseHandle(handle);
    if (!ok) {
        throw std::runtime_error("failed to durably sync eval parquet");
    }
#else
    const int descriptor = ::open(path.c_str(), O_RDONLY);
    if (descriptor < 0) {
        throw std::runtime_error(
            "failed to open eval parquet for durable sync");
    }
    const int result = ::fsync(descriptor);
    const int close_result = ::close(descriptor);
    if (result != 0 || close_result != 0) {
        throw std::runtime_error("failed to durably sync eval parquet");
    }
#endif
}

std::filesystem::path signal_dir(
    const std::filesystem::path& root,
    EvalTable table,
    std::int64_t signal_id) {
    return root / std::string(eval_table_name(table)) /
           std::format("signal_id={}", signal_id);
}

std::shared_ptr<arrow::Schema> schema_for(EvalTable table) {
    const auto common = std::vector<std::shared_ptr<arrow::Field>>{
        arrow::field("signal_id", arrow::int64(), false),
        arrow::field("symbol", arrow::utf8(), false),
        arrow::field("ts", arrow::int64(), false),
    };
    auto fields = common;
    if (table == EvalTable::canonical_score) {
        fields.push_back(arrow::field("score", arrow::float64(), false));
        fields.push_back(arrow::field("confidence", arrow::float64(), false));
    } else {
        fields.push_back(arrow::field("r_next", arrow::float64(), false));
        fields.push_back(arrow::field("horizon_bars", arrow::int32(), false));
    }
    fields.push_back(arrow::field("created_at", arrow::int64(), false));
    fields.push_back(arrow::field("path_index", arrow::int32(), true));
    return arrow::schema(std::move(fields));
}

template <typename Builder, typename Value>
void append_or_throw(Builder& builder, Value&& value, std::string_view field) {
    const auto status = builder.Append(std::forward<Value>(value));
    if (!status.ok()) {
        throw std::runtime_error(std::format(
            "failed to append {}: {}", field, status.ToString()));
    }
}

void append_null_or_throw(arrow::Int32Builder& builder, std::string_view field) {
    const auto status = builder.AppendNull();
    if (!status.ok()) {
        throw std::runtime_error(std::format(
            "failed to append null {}: {}", field, status.ToString()));
    }
}

template <typename Builder>
std::shared_ptr<arrow::Array> finish_or_throw(
    Builder& builder,
    std::string_view field) {
    std::shared_ptr<arrow::Array> array;
    const auto status = builder.Finish(&array);
    if (!status.ok()) {
        throw std::runtime_error(std::format(
            "failed to finish {}: {}", field, status.ToString()));
    }
    return array;
}

struct CanonicalDiskRow {
    std::string symbol;
    std::int64_t ts;
    double score;
    double confidence;
    std::optional<std::int32_t> path_index;
};

struct ForwardDiskRow {
    std::string symbol;
    std::int64_t ts;
    double r_next;
    std::int32_t horizon_bars;
    std::optional<std::int32_t> path_index;
};

template <typename Row>
bool row_less(const Row& left, const Row& right) {
    return left.symbol < right.symbol ||
           (left.symbol == right.symbol && left.ts < right.ts);
}

std::shared_ptr<arrow::Table> read_row_stream(
    const EvalWriteRequest& request) {
    std::ifstream input(request.rows_path, std::ios::binary);
    if (!input.is_open()) {
        throw std::runtime_error(
            "failed to open eval row stream: " + request.rows_path.string());
    }
    std::array<char, 8> magic{};
    input.read(magic.data(), static_cast<std::streamsize>(magic.size()));
    if (!input ||
        std::string_view(magic.data(), magic.size()) != kEvalRowStreamMagic) {
        throw std::runtime_error("invalid eval row stream magic");
    }
    const auto encoded_table = read_scalar<std::uint8_t>(input, "table");
    if (encoded_table != static_cast<std::uint8_t>(request.table)) {
        throw std::runtime_error("eval row stream table does not match request");
    }
    const auto count = read_scalar<std::uint64_t>(input, "row count");
    if (count > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
        throw std::runtime_error("eval row count exceeds int64 capacity");
    }

    arrow::Int64Builder signal_id;
    arrow::StringBuilder symbol;
    arrow::Int64Builder ts;
    arrow::DoubleBuilder value;
    arrow::DoubleBuilder confidence;
    arrow::Int32Builder horizon;
    arrow::Int64Builder created_at;
    arrow::Int32Builder path_index;

    if (request.table == EvalTable::canonical_score) {
        std::vector<CanonicalDiskRow> rows;
        rows.reserve(static_cast<std::size_t>(count));
        for (std::uint64_t i = 0; i < count; ++i) {
            CanonicalDiskRow row{
                .symbol = read_symbol(input),
                .ts = read_scalar<std::int64_t>(input, "ts"),
                .score = read_scalar<double>(input, "score"),
                .confidence = read_scalar<double>(input, "confidence"),
                .path_index = std::nullopt,
            };
            const auto path = read_scalar<std::int32_t>(input, "path_index");
            if (path >= 0) row.path_index = path;
            require_finite(row.score, "score");
            require_finite(row.confidence, "confidence");
            rows.push_back(std::move(row));
        }
        std::sort(rows.begin(), rows.end(), row_less<CanonicalDiskRow>);
        for (const auto& row : rows) {
            append_or_throw(signal_id, request.signal_id, "signal_id");
            append_or_throw(symbol, row.symbol, "symbol");
            append_or_throw(ts, row.ts, "ts");
            append_or_throw(value, row.score, "score");
            append_or_throw(confidence, row.confidence, "confidence");
            append_or_throw(created_at, request.created_at_ms, "created_at");
            if (row.path_index) {
                append_or_throw(path_index, *row.path_index, "path_index");
            } else {
                append_null_or_throw(path_index, "path_index");
            }
        }
        return arrow::Table::Make(
            schema_for(request.table),
            {finish_or_throw(signal_id, "signal_id"),
             finish_or_throw(symbol, "symbol"),
             finish_or_throw(ts, "ts"),
             finish_or_throw(value, "score"),
             finish_or_throw(confidence, "confidence"),
             finish_or_throw(created_at, "created_at"),
             finish_or_throw(path_index, "path_index")});
    }

    std::vector<ForwardDiskRow> rows;
    rows.reserve(static_cast<std::size_t>(count));
    for (std::uint64_t i = 0; i < count; ++i) {
        ForwardDiskRow row{
            .symbol = read_symbol(input),
            .ts = read_scalar<std::int64_t>(input, "ts"),
            .r_next = read_scalar<double>(input, "r_next"),
            .horizon_bars = read_scalar<std::int32_t>(input, "horizon_bars"),
            .path_index = std::nullopt,
        };
        const auto path = read_scalar<std::int32_t>(input, "path_index");
        if (path >= 0) row.path_index = path;
        require_finite(row.r_next, "r_next");
        if (row.horizon_bars <= 0) {
            throw std::runtime_error("horizon_bars must be positive");
        }
        rows.push_back(std::move(row));
    }
    std::sort(rows.begin(), rows.end(), row_less<ForwardDiskRow>);
    for (const auto& row : rows) {
        append_or_throw(signal_id, request.signal_id, "signal_id");
        append_or_throw(symbol, row.symbol, "symbol");
        append_or_throw(ts, row.ts, "ts");
        append_or_throw(value, row.r_next, "r_next");
        append_or_throw(horizon, row.horizon_bars, "horizon_bars");
        append_or_throw(created_at, request.created_at_ms, "created_at");
        if (row.path_index) {
            append_or_throw(path_index, *row.path_index, "path_index");
        } else {
            append_null_or_throw(path_index, "path_index");
        }
    }
    return arrow::Table::Make(
        schema_for(request.table),
        {finish_or_throw(signal_id, "signal_id"),
         finish_or_throw(symbol, "symbol"),
         finish_or_throw(ts, "ts"),
         finish_or_throw(value, "r_next"),
         finish_or_throw(horizon, "horizon_bars"),
         finish_or_throw(created_at, "created_at"),
         finish_or_throw(path_index, "path_index")});
}

std::shared_ptr<arrow::Table> read_table(
    const std::filesystem::path& path,
    const std::vector<int>& columns,
    const std::optional<EvalWindow>& window = std::nullopt) {
    auto input_result = arrow::io::ReadableFile::Open(path.string());
    if (!input_result.ok()) {
        throw std::runtime_error(
            "failed to open eval parquet: " + input_result.status().ToString());
    }
    parquet::arrow::FileReaderBuilder builder;
    auto status = builder.Open(*input_result);
    if (!status.ok()) {
        throw std::runtime_error(
            "failed to open eval parquet reader: " + status.ToString());
    }
    std::unique_ptr<parquet::arrow::FileReader> reader;
    status = builder.Build(&reader);
    if (!status.ok()) {
        throw std::runtime_error(
            "failed to build eval parquet reader: " + status.ToString());
    }
    std::shared_ptr<arrow::Table> table;
    if (window && (window->start_ms || window->end_ms)) {
        const auto metadata = reader->parquet_reader()->metadata();
        const auto* schema = metadata->schema();
        int ts_column = -1;
        for (int index = 0; index < schema->num_columns(); ++index) {
            if (schema->Column(index)->name() == "ts") {
                ts_column = index;
                break;
            }
        }
        if (ts_column < 0) {
            throw std::runtime_error(
                "eval parquet schema is missing required ts column");
        }
        std::vector<int> row_groups;
        row_groups.reserve(
            static_cast<std::size_t>(metadata->num_row_groups()));
        for (int group = 0; group < metadata->num_row_groups(); ++group) {
            const auto chunk =
                metadata->RowGroup(group)->ColumnChunk(ts_column);
            if (!chunk->is_stats_set()) {
                row_groups.push_back(group);
                continue;
            }
            const auto stats =
                std::dynamic_pointer_cast<parquet::Int64Statistics>(
                    chunk->statistics());
            if (!stats || !stats->HasMinMax()) {
                row_groups.push_back(group);
                continue;
            }
            const bool below =
                window->start_ms && stats->max() < *window->start_ms;
            const bool above =
                window->end_ms && stats->min() > *window->end_ms;
            if (!below && !above) row_groups.push_back(group);
        }
        status = reader->ReadRowGroups(row_groups, columns, &table);
    } else {
        status = reader->ReadTable(columns, &table);
    }
    if (!status.ok()) {
        throw std::runtime_error(
            "failed to read eval parquet: " + status.ToString());
    }
    return table->CombineChunks().ValueOrDie();
}

template <typename Array>
std::shared_ptr<Array> column_as(
    const std::shared_ptr<arrow::Table>& table,
    std::string_view name) {
    const auto column = table->GetColumnByName(std::string(name));
    if (!column || column->num_chunks() != 1) {
        throw std::runtime_error(
            std::format("eval parquet missing canonical column '{}'", name));
    }
    auto array = std::dynamic_pointer_cast<Array>(column->chunk(0));
    if (!array) {
        throw std::runtime_error(
            std::format("eval parquet column '{}' has wrong physical type", name));
    }
    return array;
}

bool in_window(std::int64_t ts, const EvalWindow& window) {
    return (!window.start_ms || ts >= *window.start_ms) &&
           (!window.end_ms || ts <= *window.end_ms);
}

bool parquet_has_column(
    const std::filesystem::path& path,
    std::string_view name) {
    auto input_result = arrow::io::ReadableFile::Open(path.string());
    if (!input_result.ok()) {
        throw std::runtime_error(
            "failed to open eval parquet schema: " +
            input_result.status().ToString());
    }
    parquet::arrow::FileReaderBuilder builder;
    auto status = builder.Open(*input_result);
    if (!status.ok()) {
        throw std::runtime_error(
            "failed to decode eval parquet schema: " + status.ToString());
    }
    std::unique_ptr<parquet::arrow::FileReader> reader;
    status = builder.Build(&reader);
    if (!status.ok()) {
        throw std::runtime_error(
            "failed to build eval parquet schema reader: " +
            status.ToString());
    }
    const auto* schema =
        reader->parquet_reader()->metadata()->schema();
    for (int index = 0; index < schema->num_columns(); ++index) {
        if (schema->Column(index)->name() == name) return true;
    }
    return false;
}

FunnelSlice summarize_pairs(
    const std::vector<const ForwardReturnPair*>& pairs,
    std::int32_t min_symbols_per_bar) {
    using StratCraft::executor::statistics::
        spearman_correlation_opt;
    std::vector<double> scores;
    std::vector<double> returns;
    scores.reserve(pairs.size());
    returns.reserve(pairs.size());
    std::set<std::string> symbols;
    std::map<std::int64_t, std::pair<std::vector<double>, std::vector<double>>>
        by_timestamp;
    for (const auto* pair : pairs) {
        if (!std::isfinite(pair->signal_value) ||
            !std::isfinite(pair->r_next)) {
            continue;
        }
        scores.push_back(pair->signal_value);
        returns.push_back(pair->r_next);
        if (!pair->symbol.empty()) symbols.insert(pair->symbol);
        auto& bucket = by_timestamp[pair->ts];
        bucket.first.push_back(pair->signal_value);
        bucket.second.push_back(pair->r_next);
    }
    std::optional<double> pooled =
        spearman_correlation_opt(scores, returns);
    double xs_sum = 0.0;
    std::int64_t xs_count = 0;
    for (const auto& [ts, bucket] : by_timestamp) {
        (void)ts;
        if (bucket.first.size() <
            static_cast<std::size_t>(min_symbols_per_bar)) {
            continue;
        }
        const auto ic =
            spearman_correlation_opt(bucket.first, bucket.second);
        if (ic && std::isfinite(*ic)) {
            xs_sum += *ic;
            ++xs_count;
        }
    }
    return FunnelSlice{
        .pair_count = static_cast<std::int64_t>(scores.size()),
        .distinct_symbols = static_cast<std::int64_t>(symbols.size()),
        .pooled_ic = pooled,
        .xs_mean_ic =
            xs_count == 0
                ? std::nullopt
                : std::optional<double>{
                      xs_sum / static_cast<double>(xs_count)},
        .xs_bars_measurable = xs_count,
        .xs_bars_observed =
            static_cast<std::int64_t>(by_timestamp.size()),
    };
}

struct PairKey {
    std::string symbol;
    std::int64_t ts;
    bool operator==(const PairKey&) const = default;
};

struct PairKeyHash {
    std::size_t operator()(const PairKey& key) const noexcept {
        const auto left = std::hash<std::string>{}(key.symbol);
        const auto right = std::hash<std::int64_t>{}(key.ts);
        return left ^ (right + 0x9e3779b9U + (left << 6U) + (left >> 2U));
    }
};

}  // namespace

EvalTable parse_eval_table(std::string_view value) {
    if (value == "canonical_score") return EvalTable::canonical_score;
    if (value == "forward_return") return EvalTable::forward_return;
    throw std::runtime_error("table must be canonical_score or forward_return");
}

std::string_view eval_table_name(EvalTable table) noexcept {
    return table == EvalTable::canonical_score ? "canonical_score"
                                                : "forward_return";
}

void write_eval_partition(const EvalWriteRequest& request) {
    require_positive_id(request.signal_id, "signal_id");
    require_positive_id(request.run_id, "run_id");
    if (request.created_at_ms < 0) {
        throw std::runtime_error("created_at_ms must be non-negative");
    }
    const auto table = read_row_stream(request);
    const auto parent = signal_dir(request.root, request.table, request.signal_id);
    const auto tmp = parent / std::format("run_id={}.tmp", request.run_id);
    const auto final = parent / std::format("run_id={}", request.run_id);
    std::error_code ec;
    std::filesystem::create_directories(parent);
    for (const auto& entry : std::filesystem::directory_iterator(parent)) {
        if (entry.is_directory() &&
            entry.path().filename().string().ends_with(".tmp")) {
            std::filesystem::remove_all(entry.path(), ec);
            ec.clear();
        }
    }
    std::filesystem::remove_all(tmp, ec);
    ec.clear();
    std::filesystem::create_directories(tmp);
    const auto part = tmp / "part.parquet";
    auto output_result = arrow::io::FileOutputStream::Open(part.string());
    if (!output_result.ok()) {
        throw std::runtime_error(
            "failed to open eval parquet output: " +
            output_result.status().ToString());
    }
    parquet::WriterProperties::Builder properties;
    properties.compression(parquet::Compression::SNAPPY);
    const auto status = parquet::arrow::WriteTable(
        *table, arrow::default_memory_pool(), *output_result,
        64 * 1024, properties.build());
    if (!status.ok()) {
        std::filesystem::remove_all(tmp, ec);
        throw std::runtime_error(
            "failed to write eval parquet: " + status.ToString());
    }
    const auto close_status = (*output_result)->Close();
    if (!close_status.ok()) {
        std::filesystem::remove_all(tmp, ec);
        throw std::runtime_error(
            "failed to close eval parquet: " + close_status.ToString());
    }
    sync_file(part);
    std::filesystem::remove_all(final, ec);
    ec.clear();
    std::filesystem::rename(tmp, final);
    for (const auto& entry : std::filesystem::directory_iterator(parent)) {
        if (!entry.is_directory() || entry.path() == final) continue;
        const auto name = entry.path().filename().string();
        if (name.starts_with("run_id=") && !name.ends_with(".tmp")) {
            std::filesystem::remove_all(entry.path(), ec);
            ec.clear();
        }
    }
}

std::optional<std::filesystem::path> resolve_latest_partition(
    const std::filesystem::path& root,
    EvalTable table,
    std::int64_t signal_id) {
    require_positive_id(signal_id, "signal_id");
    const auto parent = signal_dir(root, table, signal_id);
    if (!std::filesystem::is_directory(parent)) return std::nullopt;
    std::int64_t latest = -1;
    for (const auto& entry : std::filesystem::directory_iterator(parent)) {
        if (!entry.is_directory()) continue;
        const auto name = entry.path().filename().string();
        if (!name.starts_with("run_id=") || name.ends_with(".tmp")) continue;
        try {
            const auto value = std::stoll(name.substr(7));
            if (value > latest) latest = value;
        } catch (const std::exception&) {
        }
    }
    if (latest <= 0) return std::nullopt;
    const auto part = parent / std::format("run_id={}", latest) / "part.parquet";
    return std::filesystem::is_regular_file(part)
               ? std::optional<std::filesystem::path>{part}
               : std::nullopt;
}

std::optional<Coverage> read_coverage(
    const std::filesystem::path& root,
    EvalTable table,
    std::int64_t signal_id) {
    const auto path = resolve_latest_partition(root, table, signal_id);
    if (!path) return std::nullopt;

    auto input_result = arrow::io::ReadableFile::Open(path->string());
    if (!input_result.ok()) {
        throw std::runtime_error(
            "failed to open eval parquet coverage: " +
            input_result.status().ToString());
    }
    parquet::arrow::FileReaderBuilder builder;
    auto status = builder.Open(*input_result);
    if (!status.ok()) {
        throw std::runtime_error(
            "failed to decode eval parquet coverage: " + status.ToString());
    }
    std::unique_ptr<parquet::arrow::FileReader> reader;
    status = builder.Build(&reader);
    if (!status.ok()) {
        throw std::runtime_error(
            "failed to build eval parquet coverage reader: " +
            status.ToString());
    }
    const auto metadata = reader->parquet_reader()->metadata();
    if (metadata->num_rows() == 0) return std::nullopt;
    int ts_column = -1;
    for (int index = 0; index < metadata->schema()->num_columns(); ++index) {
        if (metadata->schema()->Column(index)->name() == "ts") {
            ts_column = index;
            break;
        }
    }
    if (ts_column < 0) {
        throw std::runtime_error(
            "eval parquet schema is missing required ts column");
    }
    std::int64_t lo = std::numeric_limits<std::int64_t>::max();
    std::int64_t hi = std::numeric_limits<std::int64_t>::min();
    bool complete_statistics = true;
    for (int group = 0; group < metadata->num_row_groups(); ++group) {
        const auto chunk =
            metadata->RowGroup(group)->ColumnChunk(ts_column);
        const auto stats = chunk->is_stats_set()
            ? std::dynamic_pointer_cast<parquet::Int64Statistics>(
                  chunk->statistics())
            : nullptr;
        if (!stats || !stats->HasMinMax()) {
            complete_statistics = false;
            break;
        }
        lo = std::min(lo, stats->min());
        hi = std::max(hi, stats->max());
    }
    if (complete_statistics) {
        return Coverage{lo, hi, metadata->num_rows()};
    }

    // Legacy files may omit statistics; retain exactness with a projected
    // fallback rather than treating missing metadata as missing coverage.
    const auto table_data = read_table(*path, {2});
    const auto ts = column_as<arrow::Int64Array>(table_data, "ts");
    if (ts->length() == 0) return std::nullopt;
    lo = std::numeric_limits<std::int64_t>::max();
    hi = std::numeric_limits<std::int64_t>::min();
    for (std::int64_t i = 0; i < ts->length(); ++i) {
        lo = std::min(lo, ts->Value(i));
        hi = std::max(hi, ts->Value(i));
    }
    return Coverage{lo, hi, ts->length()};
}

std::vector<CanonicalScoreRow> read_canonical_scores(
    const std::filesystem::path& root,
    std::int64_t signal_id,
    const EvalWindow& window) {
    const auto path =
        resolve_latest_partition(root, EvalTable::canonical_score, signal_id);
    if (!path) return {};
    const bool has_path_index = parquet_has_column(*path, "path_index");
    const auto table = read_table(
        *path,
        has_path_index ? std::vector<int>{1, 2, 3, 4, 6}
                       : std::vector<int>{1, 2, 3, 4},
        window);
    const auto symbols = column_as<arrow::StringArray>(table, "symbol");
    const auto ts = column_as<arrow::Int64Array>(table, "ts");
    const auto score = column_as<arrow::DoubleArray>(table, "score");
    const auto confidence = column_as<arrow::DoubleArray>(table, "confidence");
    const auto paths = has_path_index
        ? column_as<arrow::Int32Array>(table, "path_index")
        : std::shared_ptr<arrow::Int32Array>{};
    std::vector<CanonicalScoreRow> rows;
    rows.reserve(static_cast<std::size_t>(table->num_rows()));
    for (std::int64_t i = 0; i < table->num_rows(); ++i) {
        if (!in_window(ts->Value(i), window)) continue;
        rows.push_back(CanonicalScoreRow{
            symbols->GetString(i), ts->Value(i), score->Value(i),
            confidence->Value(i),
            !paths || paths->IsNull(i)
                ? std::nullopt
                : std::optional<std::int32_t>{paths->Value(i)}});
    }
    std::sort(rows.begin(), rows.end(), [](const auto& left, const auto& right) {
        return left.ts < right.ts ||
               (left.ts == right.ts && left.symbol < right.symbol);
    });
    return rows;
}

std::vector<ForwardReturnPair> read_forward_return_pairs(
    const std::filesystem::path& root,
    std::int64_t signal_id,
    const EvalWindow& window) {
    const auto forward_path =
        resolve_latest_partition(root, EvalTable::forward_return, signal_id);
    if (!forward_path) return {};
    const auto scores = read_canonical_scores(root, signal_id, window);
    if (scores.empty()) return {};
    const bool has_path_index =
        parquet_has_column(*forward_path, "path_index");
    const auto table = read_table(
        *forward_path,
        has_path_index ? std::vector<int>{1, 2, 3, 4, 6}
                       : std::vector<int>{1, 2, 3, 4},
        window);
    const auto symbols = column_as<arrow::StringArray>(table, "symbol");
    const auto ts = column_as<arrow::Int64Array>(table, "ts");
    const auto returns = column_as<arrow::DoubleArray>(table, "r_next");
    const auto horizons = column_as<arrow::Int32Array>(table, "horizon_bars");
    const auto paths = has_path_index
        ? column_as<arrow::Int32Array>(table, "path_index")
        : std::shared_ptr<arrow::Int32Array>{};
    struct ReturnValue {
        double value;
        std::int32_t horizon;
        std::optional<std::int32_t> path_index;
    };
    std::unordered_map<PairKey, ReturnValue, PairKeyHash> by_key;
    by_key.reserve(static_cast<std::size_t>(table->num_rows()));
    for (std::int64_t i = 0; i < table->num_rows(); ++i) {
        if (!in_window(ts->Value(i), window)) continue;
        by_key.emplace(
            PairKey{symbols->GetString(i), ts->Value(i)},
            ReturnValue{
                returns->Value(i), horizons->Value(i),
                !paths || paths->IsNull(i)
                    ? std::nullopt
                    : std::optional<std::int32_t>{paths->Value(i)}});
    }
    std::vector<ForwardReturnPair> result;
    result.reserve(scores.size());
    for (const auto& score : scores) {
        const auto found = by_key.find(PairKey{score.symbol, score.ts});
        if (found == by_key.end()) continue;
        result.push_back(ForwardReturnPair{
            score.symbol, score.ts, score.score, score.confidence,
            found->second.value, found->second.horizon,
            score.path_index ? score.path_index : found->second.path_index});
    }
    return result;
}

std::int64_t read_parquet_footer_row_count(
    const std::filesystem::path& path) {
    auto input_result = arrow::io::ReadableFile::Open(path.string());
    if (!input_result.ok()) {
        throw std::runtime_error(
            "failed to open parquet footer: " +
            input_result.status().ToString());
    }
    parquet::arrow::FileReaderBuilder builder;
    auto status = builder.Open(*input_result);
    if (!status.ok()) {
        throw std::runtime_error(
            "failed to decode parquet footer: " + status.ToString());
    }
    std::unique_ptr<parquet::arrow::FileReader> reader;
    status = builder.Build(&reader);
    if (!status.ok()) {
        throw std::runtime_error(
            "failed to build parquet footer reader: " + status.ToString());
    }
    return reader->parquet_reader()->metadata()->num_rows();
}

std::vector<std::string> read_canonical_symbols(
    const std::filesystem::path& root,
    std::int64_t signal_id) {
    const auto path =
        resolve_latest_partition(root, EvalTable::canonical_score, signal_id);
    if (!path) return {};
    const auto table = read_table(*path, {1});
    const auto symbols = column_as<arrow::StringArray>(table, "symbol");
    std::vector<std::string> result;
    result.reserve(static_cast<std::size_t>(symbols->length()));
    for (std::int64_t i = 0; i < symbols->length(); ++i) {
        result.push_back(symbols->GetString(i));
    }
    std::sort(result.begin(), result.end());
    result.erase(std::unique(result.begin(), result.end()), result.end());
    return result;
}

std::vector<EvalCacheRow> read_eval_cache_rows(
    const std::filesystem::path& path) {
    const auto table = read_table(path, {0, 1, 2, 3, 4, 5});
    const auto symbols = column_as<arrow::StringArray>(table, "symbol");
    const auto ts = column_as<arrow::Int64Array>(table, "ts");
    const auto scores = column_as<arrow::DoubleArray>(table, "score");
    const auto confidence =
        column_as<arrow::DoubleArray>(table, "confidence");
    const auto returns = column_as<arrow::DoubleArray>(table, "r_next");
    const auto horizons =
        column_as<arrow::Int32Array>(table, "horizon_bars");
    std::vector<EvalCacheRow> result;
    result.reserve(static_cast<std::size_t>(table->num_rows()));
    for (std::int64_t i = 0; i < table->num_rows(); ++i) {
        result.push_back(EvalCacheRow{
            symbols->GetString(i), ts->Value(i), scores->Value(i),
            confidence->Value(i), returns->Value(i), horizons->Value(i)});
    }
    std::sort(result.begin(), result.end(), [](const auto& left, const auto& right) {
        return left.symbol < right.symbol ||
               (left.symbol == right.symbol && left.ts < right.ts);
    });
    return result;
}

EvalCacheMetadata read_eval_cache_metadata(
    const std::filesystem::path& path) {
    const auto table = read_table(path, {0, 5});
    const auto symbol_column =
        column_as<arrow::StringArray>(table, "symbol");
    const auto horizons =
        column_as<arrow::Int32Array>(table, "horizon_bars");
    std::vector<std::string> symbols;
    symbols.reserve(static_cast<std::size_t>(table->num_rows()));
    std::int32_t horizon = std::numeric_limits<std::int32_t>::max();
    for (std::int64_t i = 0; i < table->num_rows(); ++i) {
        symbols.push_back(symbol_column->GetString(i));
        horizon = std::min(horizon, horizons->Value(i));
    }
    std::sort(symbols.begin(), symbols.end());
    symbols.erase(std::unique(symbols.begin(), symbols.end()), symbols.end());
    return EvalCacheMetadata{
        table->num_rows(), std::move(symbols),
        table->num_rows() == 0 ? 1 : horizon};
}

std::optional<ArmFunnelAggregates> read_arm_funnel_aggregates(
    const std::filesystem::path& root,
    std::int64_t signal_id,
    std::span<const FoldBoundary> boundaries,
    std::span<const RegimePoint> regime_points,
    std::int32_t min_symbols_per_bar,
    std::int32_t max_decay_lag) {
    require_positive_id(signal_id, "signal_id");
    if (min_symbols_per_bar < 1) {
        throw std::runtime_error(
            "min_symbols_per_bar must be positive");
    }
    if (max_decay_lag < -1) {
        throw std::runtime_error("max_decay_lag must be >= -1");
    }
    if (!resolve_latest_partition(
            root, EvalTable::canonical_score, signal_id) ||
        !resolve_latest_partition(
            root, EvalTable::forward_return, signal_id)) {
        return std::nullopt;
    }
    const auto pairs =
        read_forward_return_pairs(root, signal_id, EvalWindow{});
    std::vector<const ForwardReturnPair*> all;
    all.reserve(pairs.size());
    bool uses_path_index = false;
    for (const auto& pair : pairs) {
        if (!std::isfinite(pair.signal_value) ||
            !std::isfinite(pair.r_next)) {
            continue;
        }
        all.push_back(&pair);
        uses_path_index =
            uses_path_index ||
            (pair.path_index && *pair.path_index >= 0);
    }

    ArmFunnelAggregates result{
        .arm = summarize_pairs(all, min_symbols_per_bar),
        .uses_path_index = uses_path_index,
        .folds = {},
        .regimes = {},
        .decay = {},
    };

    if (uses_path_index) {
        std::map<std::int32_t, std::vector<const ForwardReturnPair*>>
            by_path;
        for (const auto* pair : all) {
            if (pair->path_index && *pair->path_index >= 0) {
                by_path[*pair->path_index].push_back(pair);
            }
        }
        std::map<std::int32_t, std::int32_t> segment_by_path;
        for (const auto& boundary : boundaries) {
            segment_by_path.try_emplace(
                boundary.path_index, boundary.test_segment_index);
        }
        for (const auto& [path, slice_pairs] : by_path) {
            const auto summary =
                summarize_pairs(slice_pairs, min_symbols_per_bar);
            FunnelFold fold;
            static_cast<FunnelSlice&>(fold) = summary;
            fold.path_index = path;
            fold.test_segment_index =
                segment_by_path.contains(path)
                    ? segment_by_path.at(path)
                    : path;
            result.folds.push_back(std::move(fold));
        }
    } else {
        for (const auto& boundary : boundaries) {
            std::vector<const ForwardReturnPair*> slice_pairs;
            for (const auto* pair : all) {
                if (pair->ts >= boundary.start_ms &&
                    pair->ts < boundary.end_ms) {
                    slice_pairs.push_back(pair);
                }
            }
            const auto summary =
                summarize_pairs(slice_pairs, min_symbols_per_bar);
            FunnelFold fold;
            static_cast<FunnelSlice&>(fold) = summary;
            fold.path_index = boundary.path_index;
            fold.test_segment_index = boundary.test_segment_index;
            result.folds.push_back(std::move(fold));
        }
    }

    std::map<std::int64_t, std::int32_t> regime_by_ts;
    for (const auto& point : regime_points) {
        regime_by_ts[point.ts] = point.label;
    }
    std::map<std::int32_t, std::vector<const ForwardReturnPair*>>
        by_regime;
    for (const auto* pair : all) {
        const auto found = regime_by_ts.find(pair->ts);
        if (found != regime_by_ts.end()) {
            by_regime[found->second].push_back(pair);
        }
    }
    for (const auto& [label, slice_pairs] : by_regime) {
        const auto summary =
            summarize_pairs(slice_pairs, min_symbols_per_bar);
        result.regimes.push_back(FunnelRegime{
            label, summary.pair_count, summary.pooled_ic});
    }

    struct LagKey {
        std::string symbol;
        std::int32_t path;
        bool operator<(const LagKey& other) const {
            return symbol < other.symbol ||
                   (symbol == other.symbol && path < other.path);
        }
    };
    std::map<LagKey, std::vector<const ForwardReturnPair*>> by_lag_key;
    for (const auto* pair : all) {
        by_lag_key[LagKey{
            pair->symbol, pair->path_index.value_or(-1)}].push_back(pair);
    }
    for (auto& [key, group] : by_lag_key) {
        (void)key;
        std::sort(group.begin(), group.end(), [](const auto* left, const auto* right) {
            return left->ts < right->ts;
        });
    }
    for (std::int32_t lag = 0; lag <= max_decay_lag; ++lag) {
        std::vector<ForwardReturnPair> lagged_storage;
        for (const auto& [key, group] : by_lag_key) {
            (void)key;
            for (std::size_t index = static_cast<std::size_t>(lag);
                 index < group.size(); ++index) {
                auto row = *group[index];
                row.signal_value =
                    group[index - static_cast<std::size_t>(lag)]
                        ->signal_value;
                lagged_storage.push_back(std::move(row));
            }
        }
        std::vector<const ForwardReturnPair*> lagged;
        lagged.reserve(lagged_storage.size());
        for (const auto& pair : lagged_storage) lagged.push_back(&pair);
        const auto summary =
            summarize_pairs(lagged, min_symbols_per_bar);
        result.decay.push_back(FunnelDecay{
            lag, summary.pair_count, summary.pooled_ic,
            summary.xs_mean_ic, summary.xs_bars_measurable});
    }
    return result;
}

EvalCacheIcStats compute_eval_cache_ic_stats(
    std::span<const std::filesystem::path> paths,
    std::uint64_t sampling_threshold,
    std::uint64_t sample_bars) {
    using StratCraft::executor::statistics::
        spearman_correlation_opt;
    std::map<std::int64_t, std::pair<std::vector<double>, std::vector<double>>>
        by_timestamp;
    std::uint64_t total_pairs = 0;
    for (const auto& path : paths) {
        for (const auto& row : read_eval_cache_rows(path)) {
            if (!std::isfinite(row.score) ||
                !std::isfinite(row.r_next)) {
                continue;
            }
            auto& bucket = by_timestamp[row.ts];
            bucket.first.push_back(row.score);
            bucket.second.push_back(row.r_next);
            ++total_pairs;
        }
    }
    if (by_timestamp.size() < 3) return {};

    std::set<std::int64_t> selected;
    if (total_pairs > sampling_threshold &&
        by_timestamp.size() > sample_bars) {
        auto stable_hash = [](std::uint64_t value) {
            value += 0x9e3779b97f4a7c15ULL;
            value = (value ^ (value >> 30U)) *
                    0xbf58476d1ce4e5b9ULL;
            value = (value ^ (value >> 27U)) *
                    0x94d049bb133111ebULL;
            return value ^ (value >> 31U);
        };
        std::vector<std::pair<std::uint64_t, std::int64_t>> ranked;
        ranked.reserve(by_timestamp.size());
        for (const auto& [ts, bucket] : by_timestamp) {
            (void)bucket;
            ranked.emplace_back(
                stable_hash(static_cast<std::uint64_t>(ts)), ts);
        }
        std::sort(ranked.begin(), ranked.end());
        for (std::size_t i = 0;
             i < static_cast<std::size_t>(sample_bars); ++i) {
            selected.insert(ranked[i].second);
        }
    }

    std::vector<double> per_bar;
    per_bar.reserve(by_timestamp.size());
    for (const auto& [ts, bucket] : by_timestamp) {
        if (!selected.empty() && !selected.contains(ts)) continue;
        if (bucket.first.size() < 3) continue;
        const auto ic =
            spearman_correlation_opt(bucket.first, bucket.second);
        if (ic && std::isfinite(*ic)) per_bar.push_back(*ic);
    }
    if (per_bar.empty()) return {};
    double sum = 0.0;
    for (const double value : per_bar) sum += value;
    const double mean = sum / static_cast<double>(per_bar.size());
    double squared = 0.0;
    for (const double value : per_bar) {
        const double delta = value - mean;
        squared += delta * delta;
    }
    const double std_dev =
        std::sqrt(squared / static_cast<double>(per_bar.size()));
    return EvalCacheIcStats{
        .mean_ic = std::isfinite(mean)
                       ? std::optional<double>{mean}
                       : std::nullopt,
        .std_ic = std::isfinite(std_dev) && std_dev > 0.0
                      ? std::optional<double>{std_dev}
                      : std::nullopt,
    };
}

}  // namespace StratCraft::executor::data_plane
