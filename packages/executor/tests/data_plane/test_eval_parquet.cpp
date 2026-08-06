#include "quantnexus/executor/data_plane/eval_parquet.hpp"

#include <arrow/api.h>
#include <arrow/io/file.h>
#include <catch2/catch_test_macros.hpp>
#include <parquet/arrow/writer.h>

#include <array>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>

namespace data_plane = StratCraft::executor::data_plane;

namespace {

class TempDir {
public:
    TempDir()
        : path(std::filesystem::temp_directory_path() /
               ("qnx_eval_parquet_" +
                std::to_string(
                    std::chrono::steady_clock::now()
                        .time_since_epoch().count()))) {
        std::filesystem::create_directories(path);
    }
    ~TempDir() { std::filesystem::remove_all(path); }
    std::filesystem::path path;
};

template <typename T>
void write_scalar(std::ostream& output, T value) {
    output.write(reinterpret_cast<const char*>(&value), sizeof(value));
}

void write_symbol(std::ostream& output, const std::string& value) {
    write_scalar(output, static_cast<std::uint32_t>(value.size()));
    output.write(value.data(), static_cast<std::streamsize>(value.size()));
}

void write_canonical_rows(const std::filesystem::path& path) {
    std::ofstream output(path, std::ios::binary);
    output.write(data_plane::kEvalRowStreamMagic.data(), 8);
    write_scalar(output, static_cast<std::uint8_t>(
                             data_plane::EvalTable::canonical_score));
    write_scalar(output, std::uint64_t{3});
    write_symbol(output, "MSFT");
    write_scalar(output, std::int64_t{3000});
    write_scalar(output, 0.3);
    write_scalar(output, 0.8);
    write_scalar(output, std::int32_t{1});
    write_symbol(output, "AAPL");
    write_scalar(output, std::int64_t{2000});
    write_scalar(output, 0.2);
    write_scalar(output, 0.7);
    write_scalar(output, std::int32_t{-1});
    write_symbol(output, "AAPL");
    write_scalar(output, std::int64_t{1000});
    write_scalar(output, 0.1);
    write_scalar(output, 0.6);
    write_scalar(output, std::int32_t{0});
}

void write_forward_rows(const std::filesystem::path& path) {
    std::ofstream output(path, std::ios::binary);
    output.write(data_plane::kEvalRowStreamMagic.data(), 8);
    write_scalar(output, static_cast<std::uint8_t>(
                             data_plane::EvalTable::forward_return));
    write_scalar(output, std::uint64_t{2});
    write_symbol(output, "AAPL");
    write_scalar(output, std::int64_t{2000});
    write_scalar(output, 0.02);
    write_scalar(output, std::int32_t{5});
    write_scalar(output, std::int32_t{-1});
    write_symbol(output, "AAPL");
    write_scalar(output, std::int64_t{1000});
    write_scalar(output, 0.01);
    write_scalar(output, std::int32_t{5});
    write_scalar(output, std::int32_t{0});
}

template <typename Builder>
std::shared_ptr<arrow::Array> finish(Builder& builder) {
    return builder.Finish().ValueOrDie();
}

void write_legacy_canonical_partition(
    const std::filesystem::path& root,
    std::int64_t signal_id,
    std::int64_t run_id) {
    arrow::Int64Builder signal_ids;
    arrow::StringBuilder symbols;
    arrow::Int64Builder timestamps;
    arrow::DoubleBuilder scores;
    arrow::DoubleBuilder confidences;
    arrow::Int64Builder created_at;
    REQUIRE(signal_ids.Append(signal_id).ok());
    REQUIRE(symbols.Append("AAPL").ok());
    REQUIRE(timestamps.Append(1000).ok());
    REQUIRE(scores.Append(0.25).ok());
    REQUIRE(confidences.Append(0.75).ok());
    REQUIRE(created_at.Append(1234).ok());
    const auto schema = arrow::schema({
        arrow::field("signal_id", arrow::int64(), false),
        arrow::field("symbol", arrow::utf8(), false),
        arrow::field("ts", arrow::int64(), false),
        arrow::field("score", arrow::float64(), false),
        arrow::field("confidence", arrow::float64(), false),
        arrow::field("created_at", arrow::int64(), false),
    });
    const auto table = arrow::Table::Make(
        schema,
        {finish(signal_ids), finish(symbols), finish(timestamps),
         finish(scores), finish(confidences), finish(created_at)});
    const auto partition =
        root / "canonical_score" /
        ("signal_id=" + std::to_string(signal_id)) /
        ("run_id=" + std::to_string(run_id));
    std::filesystem::create_directories(partition);
    auto output =
        arrow::io::FileOutputStream::Open((partition / "part.parquet").string())
            .ValueOrDie();
    REQUIRE(parquet::arrow::WriteTable(
                *table, arrow::default_memory_pool(), output, 64 * 1024)
                .ok());
    REQUIRE(output->Close().ok());
}

}  // namespace

TEST_CASE("TICKET_1292_07 C++ owner writes, sorts, windows, and joins eval parquet") {
    TempDir temp;
    const auto canonical_stream = temp.path / "canonical.bin";
    const auto forward_stream = temp.path / "forward.bin";
    write_canonical_rows(canonical_stream);
    write_forward_rows(forward_stream);

    data_plane::write_eval_partition(data_plane::EvalWriteRequest{
        .root = temp.path / "eval",
        .table = data_plane::EvalTable::canonical_score,
        .signal_id = 7,
        .run_id = 11,
        .created_at_ms = 1234,
        .rows_path = canonical_stream,
    });
    data_plane::write_eval_partition(data_plane::EvalWriteRequest{
        .root = temp.path / "eval",
        .table = data_plane::EvalTable::forward_return,
        .signal_id = 7,
        .run_id = 11,
        .created_at_ms = 1234,
        .rows_path = forward_stream,
    });

    const auto coverage = data_plane::read_coverage(
        temp.path / "eval", data_plane::EvalTable::canonical_score, 7);
    REQUIRE(coverage.has_value());
    CHECK(coverage->start == 1000);
    CHECK(coverage->end == 3000);
    CHECK(coverage->row_count == 3);

    const auto scores = data_plane::read_canonical_scores(
        temp.path / "eval", 7,
        data_plane::EvalWindow{.start_ms = 1500, .end_ms = 2500});
    REQUIRE(scores.size() == 1);
    CHECK(scores[0].symbol == "AAPL");
    CHECK(scores[0].ts == 2000);
    CHECK_FALSE(scores[0].path_index.has_value());

    const auto pairs = data_plane::read_forward_return_pairs(
        temp.path / "eval", 7, data_plane::EvalWindow{});
    REQUIRE(pairs.size() == 2);
    CHECK(pairs[0].ts == 1000);
    CHECK(pairs[0].r_next == 0.01);
    CHECK(pairs[1].ts == 2000);
    CHECK(pairs[1].signal_value == 0.2);
}

TEST_CASE("TICKET_1292_07 C++ owner atomically replaces the prior run") {
    TempDir temp;
    const auto stream = temp.path / "canonical.bin";
    write_canonical_rows(stream);
    for (const auto run_id : {10, 12}) {
        data_plane::write_eval_partition(data_plane::EvalWriteRequest{
            .root = temp.path / "eval",
            .table = data_plane::EvalTable::canonical_score,
            .signal_id = 9,
            .run_id = run_id,
            .created_at_ms = 1234,
            .rows_path = stream,
        });
    }
    const auto part = data_plane::resolve_latest_partition(
        temp.path / "eval", data_plane::EvalTable::canonical_score, 9);
    REQUIRE(part.has_value());
    CHECK(part->string().find("run_id=12") != std::string::npos);
    CHECK_FALSE(std::filesystem::exists(
        temp.path / "eval/canonical_score/signal_id=9/run_id=10"));
}

TEST_CASE("TICKET_1292_07 C++ owner reads legacy partitions without path_index") {
    TempDir temp;
    const auto root = temp.path / "eval";
    write_legacy_canonical_partition(root, 13, 17);

    const auto rows = data_plane::read_canonical_scores(
        root, 13, data_plane::EvalWindow{});

    REQUIRE(rows.size() == 1);
    CHECK(rows[0].symbol == "AAPL");
    CHECK(rows[0].ts == 1000);
    CHECK(rows[0].score == 0.25);
    CHECK_FALSE(rows[0].path_index.has_value());
}
