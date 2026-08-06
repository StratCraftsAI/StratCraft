#include "quantnexus/executor/data_plane/ohlcv_constants.hpp"
#include "quantnexus/executor/data_plane/ohlcv_data_plane.hpp"

#include <arrow/api.h>
#include <arrow/io/file.h>
#include <catch2/catch_test_macros.hpp>
#include <parquet/arrow/reader.h>
#include <parquet/arrow/writer.h>

#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <limits>
#include <string>
#include <vector>

namespace data_plane = StratCraft::executor::data_plane;
namespace constants = StratCraft::executor::data_plane::ohlcv_constants;

namespace {

struct Bar {
    std::string symbol;
    std::int64_t timestamp;
    double open;
    double high;
    double low;
    double close;
    double volume;
};

class TempDir {
public:
    TempDir()
        : path(std::filesystem::temp_directory_path() /
               ("qnx_ohlcv_" +
                std::to_string(std::chrono::steady_clock::now()
                                   .time_since_epoch()
                                   .count()))) {
        std::filesystem::create_directories(path);
    }

    ~TempDir() { std::filesystem::remove_all(path); }

    std::filesystem::path path;
};

template <typename Builder, typename Value>
void append(Builder& builder, Value&& value) {
    REQUIRE(builder.Append(std::forward<Value>(value)).ok());
}

template <typename Builder>
std::shared_ptr<arrow::Array> finish(Builder& builder) {
    return builder.Finish().ValueOrDie();
}

void write_bars(
    const std::filesystem::path& path,
    const std::vector<Bar>& rows,
    std::string timestamp_name = "timestamp",
    std::string symbol_name = "symbol",
    std::int64_t row_group_rows = 2) {
    arrow::StringBuilder symbol;
    arrow::Int64Builder timestamp;
    arrow::DoubleBuilder open;
    arrow::DoubleBuilder high;
    arrow::DoubleBuilder low;
    arrow::DoubleBuilder close;
    arrow::DoubleBuilder volume;
    for (const auto& row : rows) {
        append(symbol, row.symbol);
        append(timestamp, row.timestamp);
        append(open, row.open);
        append(high, row.high);
        append(low, row.low);
        append(close, row.close);
        append(volume, row.volume);
    }
    const auto schema = arrow::schema({
        arrow::field(symbol_name, arrow::utf8(), false),
        arrow::field(timestamp_name, arrow::int64(), false),
        arrow::field("o", arrow::float64(), false),
        arrow::field("h", arrow::float64(), false),
        arrow::field("l", arrow::float64(), false),
        arrow::field("c", arrow::float64(), false),
        arrow::field("v", arrow::float64(), false),
    });
    const auto table = arrow::Table::Make(
        schema, {finish(symbol), finish(timestamp), finish(open), finish(high),
                 finish(low), finish(close), finish(volume)});
    auto output = arrow::io::FileOutputStream::Open(path.string()).ValueOrDie();
    parquet::WriterProperties::Builder properties;
    properties.compression(parquet::Compression::SNAPPY);
    REQUIRE(parquet::arrow::WriteTable(
                *table, arrow::default_memory_pool(), output, row_group_rows,
                properties.build())
                .ok());
    REQUIRE(output->Close().ok());
}

std::vector<Bar> read_bars(const std::filesystem::path& path) {
    auto input = arrow::io::ReadableFile::Open(path.string()).ValueOrDie();
    parquet::arrow::FileReaderBuilder builder;
    REQUIRE(builder.Open(input).ok());
    std::unique_ptr<parquet::arrow::FileReader> reader;
    REQUIRE(builder.Build(&reader).ok());
    std::shared_ptr<arrow::Table> table;
    REQUIRE(reader->ReadTable(&table).ok());
    table = table->CombineChunks().ValueOrDie();
    const auto symbol = std::static_pointer_cast<arrow::StringArray>(
        table->GetColumnByName("symbol")->chunk(0));
    const auto timestamp = std::static_pointer_cast<arrow::Int64Array>(
        table->GetColumnByName("timestamp")->chunk(0));
    const auto column = [&](std::string_view name) {
        return std::static_pointer_cast<arrow::DoubleArray>(
            table->GetColumnByName(std::string(name))->chunk(0));
    };
    const auto open = column("open");
    const auto high = column("high");
    const auto low = column("low");
    const auto close = column("close");
    const auto volume = column("volume");
    std::vector<Bar> rows;
    for (std::int64_t index = 0; index < table->num_rows(); ++index) {
        rows.push_back(Bar{
            symbol->GetString(index), timestamp->Value(index),
            open->Value(index), high->Value(index), low->Value(index),
            close->Value(index), volume->Value(index)});
    }
    return rows;
}

nlohmann::json input_json(
    const std::filesystem::path& path,
    std::int64_t precedence = 0,
    std::string timestamp_unit = "ms",
    std::optional<std::string> fixed_symbol = std::nullopt) {
    nlohmann::json projection{
        {"symbol", "ticker"}, {"timestamp", "time"}, {"open", "o"},
        {"high", "h"},       {"low", "l"},           {"close", "c"},
        {"volume", "v"},     {"timestampUnit", timestamp_unit},
    };
    if (fixed_symbol) projection["fixedSymbol"] = *fixed_symbol;
    return {
        {"path", path.string()},
        {"precedence", precedence},
        {"projection", std::move(projection)},
    };
}

nlohmann::json request_json(
    std::string operation,
    const std::filesystem::path& output,
    nlohmann::json inputs,
    std::int64_t start,
    std::int64_t end) {
    return {
        {"version", constants::CONTRACT_VERSION},
        {"decisionId", "decision-21"},
        {"operation", std::move(operation)},
        {"inputs", std::move(inputs)},
        {"window", {{"startMs", start}, {"endMs", end}}},
        {"outputPath", output.string()},
    };
}

}  // namespace

TEST_CASE("MC-21 canonical contract converts timestamps and pushes the window into parquet") {
    TempDir temp;
    const auto input = temp.path / "seconds.parquet";
    const auto output = temp.path / "canonical.parquet";
    write_bars(input,
               {{"ignored", 1, 10, 11, 9, 10, 1},
                {"ignored", 2, 20, 21, 19, 20, 2},
                {"ignored", 3, 30, 31, 29, 30, 3},
                {"ignored", 4, 40, 41, 39, 40, 4}},
               "time", "ticker");
    auto request = request_json(
        "canonicalize", output,
        nlohmann::json::array({input_json(input, 0, "s", "EURUSD")}),
        2'000, 3'000);

    const auto result = data_plane::run_ohlcv_data_plane_command(request);
    const auto rows = read_bars(output);

    REQUIRE(rows.size() == 2);
    CHECK(rows[0].symbol == "EURUSD");
    CHECK(rows[0].timestamp == 2'000);
    CHECK(rows[1].timestamp == 3'000);
    CHECK(result.at("schema").at("version") == constants::SCHEMA_VERSION);
    CHECK(result.at("schema").at("timestampUnit") == "epoch_ms");
    CHECK(result.at("rowCount") == 2);
    CHECK(result.at("extent").at("startMs") == 2'000);
    CHECK(result.at("codec") == "zstd");
    CHECK(result.at("decisions").at("inputRowGroups") == 2);
    CHECK(result.at("decisions").at("selectedRowGroups") == 2);
}

TEST_CASE("MC-21 merge is ordered latest-wins and quality policy is observable") {
    TempDir temp;
    const auto old_path = temp.path / "old.parquet";
    const auto new_path = temp.path / "new.parquet";
    const auto output = temp.path / "merged.parquet";
    write_bars(old_path,
               {{"A", 1'000, 10, 11, 9, 10, 1},
                {"A", 2'000, 20, 21, 19, 20, 2}},
               "time", "ticker");
    write_bars(new_path,
               {{"A", 1'000, 15, 16, 14, 15, 5},
                {"A", 3'000, 30, 29, 31, 30, 3},
                {"A", 4'000, 40, 41, 39, 40, 4}},
               "time", "ticker");
    auto request = request_json(
        "merge", output,
        nlohmann::json::array(
            {input_json(old_path, 0), input_json(new_path, 1)}),
        1'000, 4'000);
    request["qualityAction"] = "drop_rows";

    const auto result = data_plane::run_ohlcv_data_plane_command(request);
    const auto rows = read_bars(output);

    REQUIRE(rows.size() == 3);
    CHECK(rows[0].timestamp == 1'000);
    CHECK(rows[0].close == 15);
    CHECK(rows[1].timestamp == 2'000);
    CHECK(rows[2].timestamp == 4'000);
    CHECK(result.at("decisions").at("duplicateRows") == 1);
    CHECK(result.at("decisions").at("rejectedRows") == 1);
}

TEST_CASE("MC-21 finer timestamp units preserve inclusive millisecond endpoints") {
    TempDir temp;
    const auto input = temp.path / "microseconds.parquet";
    const auto output = temp.path / "canonical.parquet";
    write_bars(input,
               {{"A", 1'999'999, 10, 11, 9, 10, 1},
                {"A", 2'000'000, 20, 21, 19, 20, 2},
                {"A", 3'000'999, 30, 31, 29, 30, 3},
                {"A", 3'001'000, 40, 41, 39, 40, 4}},
               "time", "ticker");
    const auto result = data_plane::run_ohlcv_data_plane_command(request_json(
        "canonicalize", output,
        nlohmann::json::array({input_json(input, 0, "us")}), 2'000, 3'000));
    const auto rows = read_bars(output);

    REQUIRE(rows.size() == 2);
    CHECK(rows[0].timestamp == 2'000);
    CHECK(rows[1].timestamp == 3'000);
    CHECK(result.at("decisions").at("selectedRowGroups") == 2);
}

TEST_CASE("MC-21 coarse and millisecond pushdown use the exact raw interval") {
    TempDir temp;
    const auto seconds = temp.path / "seconds.parquet";
    const auto milliseconds = temp.path / "milliseconds.parquet";
    const auto output = temp.path / "canonical.parquet";
    write_bars(seconds,
               {{"A", -2, 10, 11, 9, 10, 1},
                {"A", -1, 20, 21, 19, 20, 2},
                {"A", 0, 30, 31, 29, 30, 3},
                {"A", 1, 40, 41, 39, 40, 4}},
               "time", "ticker");
    write_bars(milliseconds,
               {{"A", 1'999, 50, 51, 49, 50, 5},
                {"A", 2'000, 60, 61, 59, 60, 6},
                {"A", 2'001, 70, 71, 69, 70, 7}},
               "time", "ticker");

    const auto no_seconds =
        data_plane::run_ohlcv_data_plane_command(request_json(
            "canonicalize", output,
            nlohmann::json::array({input_json(seconds, 0, "s")}),
            -999, -1));
    CHECK(no_seconds.at("rowCount") == 0);
    CHECK(no_seconds.at("decisions").at("selectedRowGroups") == 0);

    const auto exact_millisecond =
        data_plane::run_ohlcv_data_plane_command(request_json(
            "canonicalize", output,
            nlohmann::json::array(
                {input_json(milliseconds, 0, "ms")}),
            2'000, 2'000));
    const auto rows = read_bars(output);
    REQUIRE(rows.size() == 1);
    CHECK(rows[0].timestamp == 2'000);
    CHECK(exact_millisecond.at("decisions").at("selectedRowGroups") == 1);
}

TEST_CASE("MC-21 rejects invalid and non-finite OHLCV without replacing prior output") {
    TempDir temp;
    const auto valid = temp.path / "valid.parquet";
    const auto replacement = temp.path / "replacement.parquet";
    const auto invalid = temp.path / "invalid.parquet";
    const auto output = temp.path / "published.parquet";
    write_bars(valid, {{"A", 1'000, 10, 11, 9, 10, 1}}, "time", "ticker");
    write_bars(replacement, {{"A", 1'000, 11, 13, 10, 12, 2}}, "time",
               "ticker");
    write_bars(invalid,
               {{"A", 1'000, 10, 11, 9,
                 std::numeric_limits<double>::quiet_NaN(), 1}},
               "time", "ticker");
    const auto initial = data_plane::run_ohlcv_data_plane_command(request_json(
        "byod", output, nlohmann::json::array({input_json(valid)}),
        1'000, 1'000));
    CHECK(initial.at("rowCount") == 1);
    const auto replaced = data_plane::run_ohlcv_data_plane_command(request_json(
        "byod", output, nlohmann::json::array({input_json(replacement)}),
        1'000, 1'000));
    CHECK(replaced.at("rowCount") == 1);
    CHECK(read_bars(output)[0].close == 12);
    const auto original_size = std::filesystem::file_size(output);

    try {
        (void)data_plane::run_ohlcv_data_plane_command(request_json(
            "byod", output, nlohmann::json::array({input_json(invalid)}),
            1'000, 1'000));
        FAIL("expected quality rejection");
    } catch (const data_plane::OhlcvDataPlaneError& error) {
        CHECK(error.code() == "QNX_OHLCV_QUALITY_REJECTED");
        CHECK(std::string(error.what()) ==
              "nonpositive_price OHLCV row at A:1000");
    }
    CHECK(std::filesystem::file_size(output) == original_size);
    CHECK(read_bars(output)[0].close == 12);

    auto shrinking = request_json(
        "merge", output, nlohmann::json::array(), 1'000, 1'000);
    shrinking["minimumOutputRows"] = 1;
    try {
        (void)data_plane::run_ohlcv_data_plane_command(shrinking);
        FAIL("expected preservation failure");
    } catch (const data_plane::OhlcvDataPlaneError& error) {
        CHECK(error.code() == "QNX_OHLCV_PRESERVATION_FAILED");
    }
    CHECK(std::filesystem::file_size(output) == original_size);
    CHECK(read_bars(output)[0].close == 12);
}

TEST_CASE("MC-21 aggregation honors explicit changing session anchors and partial buckets") {
    TempDir temp;
    const auto input = temp.path / "bars.parquet";
    const auto output = temp.path / "aggregate.parquet";
    write_bars(input,
               {{"A", 1'100, 10, 12, 9, 11, 1},
                {"A", 1'500, 11, 14, 10, 13, 2},
                {"A", 2'100, 20, 22, 19, 21, 3},
                {"A", 2'400, 21, 23, 20, 22, 4}},
               "time", "ticker");
    auto request = request_json(
        "aggregate", output, nlohmann::json::array({input_json(input)}),
        1'000, 2'999);
    request["targetIntervalMs"] = 1'000;
    request["sessionAnchors"] = nlohmann::json::array({
        {{"effectiveStartMs", 0}, {"anchorMs", 1'000}},
        {{"effectiveStartMs", 2'000}, {"anchorMs", 1'500}},
    });

    auto result = data_plane::run_ohlcv_data_plane_command(request);
    auto rows = read_bars(output);
    REQUIRE(rows.size() == 2);
    CHECK(rows[0].timestamp == 1'000);
    CHECK(rows[0].open == 10);
    CHECK(rows[0].high == 14);
    CHECK(rows[0].close == 13);
    CHECK(rows[0].volume == 3);
    CHECK(rows[1].timestamp == 1'500);
    CHECK(rows[1].volume == 7);

    request["outputPath"] = (temp.path / "complete.parquet").string();
    request["keepPartialBucket"] = false;
    request["window"]["endMs"] = 2'199;
    result = data_plane::run_ohlcv_data_plane_command(request);
    rows = read_bars(temp.path / "complete.parquet");
    REQUIRE(rows.size() == 1);
    CHECK(rows[0].timestamp == 1'000);
    CHECK(result.at("rowCount") == 1);
}

TEST_CASE("MC-21 pooled calendar alignment exposes forward-fill entry") {
    TempDir temp;
    const auto input = temp.path / "intraday.parquet";
    const auto output = temp.path / "pool.parquet";
    write_bars(input,
               {{"A", 100, 10, 12, 9, 11, 5},
                {"A", 900, 11, 13, 10, 12, 6},
                {"A", 2'100, 20, 22, 19, 21, 7}},
               "time", "ticker");
    auto request = request_json(
        "pool", output, nlohmann::json::array({input_json(input)}), 0, 2'999);
    request["calendarMs"] = {0, 1'000, 2'000};
    request["symbols"] = {"A"};
    request["fillPolicy"] = "forward";

    const auto result = data_plane::run_ohlcv_data_plane_command(request);
    const auto rows = read_bars(output);
    REQUIRE(rows.size() == 3);
    CHECK(rows[0].timestamp == 0);
    CHECK(rows[0].open == 10);
    CHECK(rows[0].close == 12);
    CHECK(rows[1].timestamp == 1'000);
    CHECK(rows[1].open == 12);
    CHECK(rows[1].high == 12);
    CHECK(rows[1].volume == 0);
    CHECK(rows[2].timestamp == 2'000);
    CHECK(result.at("decisions").at("filledRows") == 1);
}

TEST_CASE("MC-21 validates malformed bounds, missing calendars, cancellation, and cleanup") {
    TempDir temp;
    auto malformed = request_json(
        "canonicalize", temp.path / "unused.parquet", nlohmann::json::array(),
        2, 1);
    try {
        (void)data_plane::parse_ohlcv_data_plane_request(malformed);
        FAIL("expected invalid window");
    } catch (const data_plane::OhlcvDataPlaneError& error) {
        CHECK(std::string(error.what()) ==
              "window.startMs must not exceed window.endMs");
    }
    malformed["window"] = nullptr;
    try {
        (void)data_plane::parse_ohlcv_data_plane_request(malformed);
        FAIL("expected missing window");
    } catch (const data_plane::OhlcvDataPlaneError& error) {
        CHECK(std::string(error.what()) ==
              "bounded request requires window.startMs and window.endMs");
    }

    auto pool = request_json(
        "pool", temp.path / "pool.parquet", nlohmann::json::array(), 0, 1);
    try {
        (void)data_plane::run_ohlcv_data_plane_command(pool);
        FAIL("expected missing calendar");
    } catch (const data_plane::OhlcvDataPlaneError& error) {
        CHECK(std::string(error.what()) ==
              "pool operation requires a non-empty calendarMs");
    }

    const auto cancelled_output = temp.path / "cancelled.parquet";
    auto cancelled = data_plane::parse_ohlcv_data_plane_request(request_json(
        "canonicalize", cancelled_output, nlohmann::json::array(), 0, 1));
    try {
        (void)data_plane::execute_ohlcv_data_plane(
            cancelled, [] { return true; });
        FAIL("expected cancellation");
    } catch (const data_plane::OhlcvDataPlaneError& error) {
        CHECK(error.code() == "QNX_OHLCV_CANCELLED");
        CHECK_FALSE(error.is_retryable());
    }
    CHECK_FALSE(std::filesystem::exists(cancelled_output));

    const auto directory_target = temp.path / "directory.parquet";
    std::filesystem::create_directory(directory_target);
    auto publish_failure =
        data_plane::parse_ohlcv_data_plane_request(request_json(
            "canonicalize", directory_target, nlohmann::json::array(), 0, 1));
    try {
        (void)data_plane::execute_ohlcv_data_plane(publish_failure);
        FAIL("expected atomic publication failure");
    } catch (const data_plane::OhlcvDataPlaneError& error) {
        CHECK(error.code() == "QNX_OHLCV_PUBLISH_FAILED");
        CHECK(error.is_retryable());
    }
    CHECK_FALSE(std::filesystem::exists(
        temp.path / ".directory.parquet.decision-21.tmp"));
}

TEST_CASE("MC-21 publishes canonical empty input and propagates storage errors") {
    TempDir temp;
    const auto empty_output = temp.path / "empty.parquet";
    const auto empty = data_plane::run_ohlcv_data_plane_command(request_json(
        "canonicalize", empty_output, nlohmann::json::array(), 0, 1));
    CHECK(empty.at("rowCount") == 0);
    CHECK(empty.at("extent").is_null());
    CHECK(read_bars(empty_output).empty());

    auto missing = request_json(
        "canonicalize", temp.path / "missing-output.parquet",
        nlohmann::json::array(
            {input_json(temp.path / "does-not-exist.parquet")}),
        0, 1);
    try {
        (void)data_plane::run_ohlcv_data_plane_command(missing);
        FAIL("expected storage read failure");
    } catch (const data_plane::OhlcvDataPlaneError& error) {
        CHECK(error.code() == "QNX_OHLCV_READ_FAILED");
        CHECK(error.is_retryable());
    }
    CHECK_FALSE(std::filesystem::exists(
        temp.path / "missing-output.parquet"));

    auto no_symbols = request_json(
        "pool", temp.path / "no-symbols.parquet", nlohmann::json::array(),
        0, 1);
    no_symbols["calendarMs"] = {0};
    try {
        (void)data_plane::run_ohlcv_data_plane_command(no_symbols);
        FAIL("expected explicit pooled symbols");
    } catch (const data_plane::OhlcvDataPlaneError& error) {
        CHECK(error.code() == "QNX_OHLCV_CALENDAR_MISSING");
        CHECK(std::string(error.what()) ==
              "pool operation requires explicit symbols");
    }
}

TEST_CASE("MC-21 inline provider rows cross the C++ owner before publication") {
    TempDir temp;
    const auto output = temp.path / "provider.parquet";
    auto request = request_json(
        "canonicalize", output, nlohmann::json::array(), 1'000, 3'000);
    request["decisionId"] = "inline-provider";
    request["inlineRows"] = nlohmann::json::array({
        {{"symbol", "EURUSD"}, {"timestamp", 3}, {"timestampUnit", "s"},
         {"open", 3.0}, {"high", 4.0}, {"low", 2.0}, {"close", 3.5},
         {"volume", 1.0}},
        {{"symbol", "EURUSD"}, {"timestamp", 2}, {"timestampUnit", "s"},
         {"open", 2.0}, {"high", 3.0}, {"low", 1.0}, {"close", 2.5},
         {"volume", 1.0}},
        {{"symbol", "EURUSD"}, {"timestamp", 2}, {"timestampUnit", "s"},
         {"open", 2.1}, {"high", 3.1}, {"low", 1.1}, {"close", 2.6},
         {"volume", 2.0}},
    });

    const auto result = data_plane::run_ohlcv_data_plane_command(request);
    CHECK(result.at("decisionId") == "inline-provider");
    CHECK(result.at("rowCount") == 2);
    CHECK(result.at("decisions").at("duplicateRows") == 1);
    CHECK(result.at("extent").at("startMs") == 2'000);
    CHECK(result.at("extent").at("endMs") == 3'000);
}

TEST_CASE("MC-21 C++ quality policy preserves last-valid and lookahead semantics") {
    TempDir temp;
    const auto output = temp.path / "quality.parquet";
    auto request = request_json(
        "byod", output, nlohmann::json::array(), 0, 1'800'000);
    request["qualityAction"] = "drop_rows";
    request["qualityPolicy"] = {
        {"assetClass", "forex"},
        {"intervalMs", 300'000},
    };
    request["inlineRows"] = nlohmann::json::array({
        {{"symbol", "EURUSD"}, {"timestamp", 0},
         {"open", 1.0}, {"high", 1.1}, {"low", 0.9}, {"close", 1.0}, {"volume", 1.0}},
        {{"symbol", "EURUSD"}, {"timestamp", 300'000},
         {"open", 10.0}, {"high", 10.1}, {"low", 9.9}, {"close", 10.0}, {"volume", 1.0}},
        {{"symbol", "EURUSD"}, {"timestamp", 600'000},
         {"open", 2.0}, {"high", 2.1}, {"low", 1.9}, {"close", 2.0}, {"volume", 1.0}},
        {{"symbol", "EURUSD"}, {"timestamp", 900'000},
         {"open", 1.0}, {"high", 1.1}, {"low", 0.9}, {"close", 1.0}, {"volume", 1.0}},
        {{"symbol", "EURUSD"}, {"timestamp", 1'200'000},
         {"open", 1.0}, {"high", 6.0}, {"low", 1.0}, {"close", 1.0}, {"volume", 1.0}},
        {{"symbol", "EURUSD"}, {"timestamp", 1'500'000},
         {"open", 1.3}, {"high", 1.4}, {"low", 1.2}, {"close", 1.3}, {"volume", 1.0}},
        {{"symbol", "EURUSD"}, {"timestamp", 1'800'000},
         {"open", 1.31}, {"high", 1.4}, {"low", 1.2}, {"close", 1.31}, {"volume", 1.0}},
    });

    const auto result = data_plane::run_ohlcv_data_plane_command(request);
    const auto rows = read_bars(output);
    REQUIRE(rows.size() == 4);
    CHECK(result.at("decisions").at("rejectedRows") == 3);
    CHECK(result.at("decisions").at("suspectRows") == 1);
    CHECK(rows[0].timestamp == 0);
    CHECK(rows[1].timestamp == 900'000);
    CHECK(rows[2].timestamp == 1'500'000);
    CHECK(rows[3].timestamp == 1'800'000);

    request["qualityPolicy"]["assetClass"] = "invalid";
    CHECK_THROWS_AS(
        data_plane::parse_ohlcv_data_plane_request(request),
        data_plane::OhlcvDataPlaneError);
    request["qualityPolicy"]["assetClass"] = "forex";
    request["qualityPolicy"]["intervalMs"] = 0;
    CHECK_THROWS_AS(
        data_plane::parse_ohlcv_data_plane_request(request),
        data_plane::OhlcvDataPlaneError);
}
