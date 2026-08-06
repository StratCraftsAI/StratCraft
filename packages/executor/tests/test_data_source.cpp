/**
 * Data Source Tests
 *
 * TICKET_133 Phase 1: Executor Core Development
 */

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include "quantnexus/executor/data_source.hpp"
#include "quantnexus/executor/executor_constants.hpp"
#include "quantnexus/executor/error_types.hpp"

#include <arrow/api.h>
#include <arrow/io/file.h>
#include <parquet/arrow/reader.h>
#include <parquet/arrow/writer.h>
#include <filesystem>
#include <fstream>
#include <cstdlib>

using namespace StratCraft::executor;
using Catch::Matchers::WithinAbs;

TEST_CASE("MockDataSource generates synthetic data", "[data_source][mock][regression]") {
    auto source = createDataSource("mock");
    REQUIRE(source != nullptr);
    REQUIRE(source->getName() == "MockDataSource");

    SECTION("generates data for given time range") {
        DataConfig config{
            .symbol = "BTC/USDT",
            .interval = "1h",
            .startTime = 1704067200,  // 2024-01-01 00:00:00
            .endTime = 1704153600,    // 2024-01-02 00:00:00
            .dataPath = "",
            .dataSourceType = "mock"
        };

        DataFrame df = source->loadData(config);

        REQUIRE(!df.empty());
        REQUIRE(df.symbol == "BTC/USDT");
        REQUIRE(df.interval == "1h");

        // Should have ~24 bars for 24 hours
        REQUIRE(df.size() == 24);

        // All arrays should have same size
        REQUIRE(df.timestamps.size() == df.size());
        REQUIRE(df.open.size() == df.size());
        REQUIRE(df.high.size() == df.size());
        REQUIRE(df.low.size() == df.size());
        REQUIRE(df.close.size() == df.size());
        REQUIRE(df.volume.size() == df.size());
    }

    SECTION("generates valid OHLCV data") {
        DataConfig config{
            .symbol = "ETH/USDT",
            .interval = "1d",
            .startTime = 1704067200,
            .endTime = 1706745600,  // 31 days
            .dataPath = "",
            .dataSourceType = "mock"
        };

        DataFrame df = source->loadData(config);

        for (size_t i = 0; i < df.size(); ++i) {
            // High should be >= open and close
            REQUIRE(df.high[i] >= df.open[i]);
            REQUIRE(df.high[i] >= df.close[i]);

            // Low should be <= open and close
            REQUIRE(df.low[i] <= df.open[i]);
            REQUIRE(df.low[i] <= df.close[i]);

            // Volume should be non-negative
            REQUIRE(df.volume[i] >= 0.0);

            // Timestamps should be increasing
            if (i > 0) {
                REQUIRE(df.timestamps[i] > df.timestamps[i-1]);
            }
        }
    }

    SECTION("produces reproducible results with fixed seed") {
        DataConfig config{
            .symbol = "TEST",
            .interval = "1m",
            .startTime = 1704067200,
            .endTime = 1704070800,
            .dataPath = "",
            .dataSourceType = "mock"
        };

        DataFrame df1 = source->loadData(config);
        DataFrame df2 = source->loadData(config);

        REQUIRE(df1.size() == df2.size());

        for (size_t i = 0; i < df1.size(); ++i) {
            REQUIRE_THAT(df1.close[i], WithinAbs(df2.close[i], 0.0001));
        }
    }
}

TEST_CASE("DataFrame operations", "[data_source][dataframe][regression]") {
    DataFrame df;
    df.symbol = "TEST";
    df.interval = "1m";

    SECTION("starts empty") {
        REQUIRE(df.empty());
        REQUIRE(df.size() == 0);
    }

    SECTION("addBar works correctly") {
        OHLCVBar bar{
            .timestamp = 1704067200000,
            .open = 100.0,
            .high = 105.0,
            .low = 98.0,
            .close = 102.0,
            .volume = 1000.0,
            ._padding = {}
        };

        df.addBar(bar);

        REQUIRE(!df.empty());
        REQUIRE(df.size() == 1);
        REQUIRE(df.timestamps[0] == 1704067200000);
        REQUIRE_THAT(df.close[0], WithinAbs(102.0, 0.001));
    }

    SECTION("reserve and clear work") {
        df.reserve(100);

        for (int i = 0; i < 50; ++i) {
            OHLCVBar bar{
                .timestamp = static_cast<int64_t>(1704067200000 + i * 60000),
                .open = 100.0,
                .high = 101.0,
                .low = 99.0,
                .close = 100.5,
                .volume = 100.0,
                ._padding = {}
            };
            df.addBar(bar);
        }

        REQUIRE(df.size() == 50);

        df.clear();
        REQUIRE(df.empty());
    }
}

TEST_CASE("createDataSource factory", "[data_source][factory][regression]") {
    SECTION("creates mock data source") {
        auto source = createDataSource("mock");
        REQUIRE(source != nullptr);
        REQUIRE(source->getName() == "MockDataSource");
    }

    SECTION("creates parquet data source") {
        auto source = createDataSource("parquet");
        REQUIRE(source != nullptr);
        REQUIRE(source->getName() == "ParquetDataSource");
    }

    SECTION("throws for unknown type") {
        REQUIRE_THROWS_AS(createDataSource("unknown"), std::runtime_error);
    }
}

TEST_CASE("TICKET_641_1: MAX_DATAFRAME_ROWS constant and DataTooLarge error", "[data_source][security][regression]") {
    SECTION("MAX_DATAFRAME_ROWS is 50 million") {
        REQUIRE(constants::MAX_DATAFRAME_ROWS == 50'000'000);
    }

    SECTION("DataTooLarge error code exists") {
        auto err = Error(ErrorCode::DataTooLarge, "test overflow");
        REQUIRE(err.code == ErrorCode::DataTooLarge);
        REQUIRE(error_code_name(ErrorCode::DataTooLarge) == "DataTooLarge");
    }
}

// =============================================================================
// Helper: Write a Parquet file with N rows of OHLCV data
// =============================================================================

namespace {

/// Create a temporary directory path for test Parquet files
std::filesystem::path getTempParquetDir() {
    auto tmpDir = std::filesystem::temp_directory_path() / "stratcraft_test_parquet";
    std::filesystem::create_directories(tmpDir);
    return tmpDir;
}

/// Write a Parquet file with the specified number of rows
std::string writeTestParquetFile(const std::string& filename, int64_t numRows) {
    auto dir = getTempParquetDir();
    auto filePath = dir / filename;

    // Build Arrow schema matching OHLCV columns
    auto schema = arrow::schema({
        arrow::field("timestamp", arrow::int64()),
        arrow::field("open", arrow::float64()),
        arrow::field("high", arrow::float64()),
        arrow::field("low", arrow::float64()),
        arrow::field("close", arrow::float64()),
        arrow::field("volume", arrow::float64()),
    });

    // Build column arrays
    arrow::Int64Builder tsBuilder;
    arrow::DoubleBuilder openBuilder, highBuilder, lowBuilder, closeBuilder, volBuilder;

    (void)tsBuilder.Reserve(numRows);
    (void)openBuilder.Reserve(numRows);
    (void)highBuilder.Reserve(numRows);
    (void)lowBuilder.Reserve(numRows);
    (void)closeBuilder.Reserve(numRows);
    (void)volBuilder.Reserve(numRows);

    for (int64_t i = 0; i < numRows; ++i) {
        (void)tsBuilder.Append(1704067200000 + i * 60000);
        (void)openBuilder.Append(100.0 + static_cast<double>(i) * 0.01);
        (void)highBuilder.Append(101.0 + static_cast<double>(i) * 0.01);
        (void)lowBuilder.Append(99.0 + static_cast<double>(i) * 0.01);
        (void)closeBuilder.Append(100.5 + static_cast<double>(i) * 0.01);
        (void)volBuilder.Append(1000.0);
    }

    std::shared_ptr<arrow::Array> tsArray, openArray, highArray, lowArray, closeArray, volArray;
    (void)tsBuilder.Finish(&tsArray);
    (void)openBuilder.Finish(&openArray);
    (void)highBuilder.Finish(&highArray);
    (void)lowBuilder.Finish(&lowArray);
    (void)closeBuilder.Finish(&closeArray);
    (void)volBuilder.Finish(&volArray);

    auto table = arrow::Table::Make(schema, {tsArray, openArray, highArray, lowArray, closeArray, volArray});

    // Write to Parquet file
    auto outfile = arrow::io::FileOutputStream::Open(filePath.string()).ValueOrDie();
    (void)parquet::arrow::WriteTable(*table, arrow::default_memory_pool(), outfile, numRows);

    return filePath.string();
}

/// Encode a signed int64 as Thrift compact protocol zigzag + varint bytes.
/// Thrift compact i64: zigzag(n) = (n << 1) ^ (n >> 63), then ULEB128 varint.
std::vector<uint8_t> encodeThriftI64(int64_t value) {
    // Zigzag encode (unsigned arithmetic avoids implementation-defined signed shift)
    auto uval = static_cast<uint64_t>(value);
    auto zigzag = (uval << 1) ^ static_cast<uint64_t>(-(value < 0));
    // Varint encode (ULEB128)
    std::vector<uint8_t> bytes;
    while (zigzag > 0x7F) {
        bytes.push_back(static_cast<uint8_t>((zigzag & 0x7F) | 0x80));
        zigzag >>= 7;
    }
    bytes.push_back(static_cast<uint8_t>(zigzag));
    return bytes;
}

/// Find needle bytes in buf starting from offset, return position or std::string::npos.
size_t findBytes(const std::vector<char>& buf, size_t start, size_t end,
                 const std::vector<uint8_t>& needle) {
    if (needle.empty() || end - start < needle.size()) return std::string::npos;
    for (size_t pos = start; pos + needle.size() <= end; ++pos) {
        if (std::memcmp(buf.data() + pos, needle.data(), needle.size()) == 0) {
            return pos;
        }
    }
    return std::string::npos;
}

/// Write a Parquet file whose footer metadata claims forgedRows while actual data has actualRows.
///
/// Parquet binary layout: [data pages] [Thrift footer] [4-byte LE footer_len] [PAR1]
/// Thrift compact protocol encodes i64 as zigzag + varint (variable length).
/// We find zigzag-varint encoded num_rows in the footer and replace all occurrences,
/// then update the footer length field to account for any size change.
std::string writeParquetWithForgedRowCount(
    const std::string& filename,
    int64_t actualRows,
    int64_t forgedRows)
{
    // Step 1: Write a normal valid Parquet file
    auto normalPath = writeTestParquetFile("_tmp_normal_" + filename, actualRows);

    // Step 2: Read entire file into memory
    std::ifstream ifs(normalPath, std::ios::binary | std::ios::ate);
    auto fileSize = ifs.tellg();
    ifs.seekg(0);
    std::vector<char> buf(static_cast<size_t>(fileSize));
    ifs.read(buf.data(), fileSize);
    ifs.close();

    // Step 3: Parse footer location -- last 8 bytes = [4-byte LE footer_len][PAR1]
    auto sz = buf.size();
    uint32_t footerLen = 0;
    std::memcpy(&footerLen, buf.data() + sz - 8, sizeof(uint32_t));
    size_t footerStart = sz - 8 - footerLen;
    size_t footerEnd = sz - 8;

    // Step 4: Encode needle and replacement as zigzag-varint
    auto needleBytes = encodeThriftI64(actualRows);
    auto replacementBytes = encodeThriftI64(forgedRows);

    // Step 5: Find and replace all occurrences in the footer.
    // Rebuild the footer region with replacements (handles size changes).
    std::vector<char> newFooter;
    newFooter.reserve(footerLen + 64);
    size_t pos = footerStart;
    int patchCount = 0;

    while (pos < footerEnd) {
        size_t found = findBytes(buf, pos, footerEnd, needleBytes);
        if (found == std::string::npos) {
            // Copy remaining footer bytes
            newFooter.insert(newFooter.end(), buf.begin() + static_cast<ptrdiff_t>(pos),
                           buf.begin() + static_cast<ptrdiff_t>(footerEnd));
            break;
        }
        // Copy bytes before the match
        newFooter.insert(newFooter.end(), buf.begin() + static_cast<ptrdiff_t>(pos),
                       buf.begin() + static_cast<ptrdiff_t>(found));
        // Insert replacement
        newFooter.insert(newFooter.end(), replacementBytes.begin(), replacementBytes.end());
        pos = found + needleBytes.size();
        ++patchCount;
    }

    if (patchCount < 1) {
        throw std::runtime_error("Failed to find num_rows varint in Parquet footer for patching");
    }

    // Step 6: Reconstruct the file: [data pages] [new footer] [new footer_len] [PAR1]
    auto dir = getTempParquetDir();
    auto forgedPath = (dir / filename).string();

    std::ofstream ofs(forgedPath, std::ios::binary);
    // Write data pages (everything before original footer)
    ofs.write(buf.data(), static_cast<std::streamsize>(footerStart));
    // Write patched footer
    ofs.write(newFooter.data(), static_cast<std::streamsize>(newFooter.size()));
    // Write new footer length (4 bytes LE)
    auto newFooterLen = static_cast<uint32_t>(newFooter.size());
    ofs.write(reinterpret_cast<const char*>(&newFooterLen), sizeof(uint32_t));
    // Write PAR1 magic
    ofs.write(buf.data() + sz - 4, 4);
    ofs.close();

    // Cleanup the intermediate normal file
    std::filesystem::remove(normalPath);

    return forgedPath;
}

/// TICKET_1292 Phase 3 (MC-07): write a Parquet file with `numRows` rows
/// and a fixed `rowGroupSize` so the file has multiple row groups whose
/// per-group `timestamp` statistics the window-pushdown reader can prune
/// on. Timestamps are `baseTs + i * stepSec` in SECONDS (the cache
/// column unit), strictly increasing, so row-group [min,max] ranges are
/// disjoint and contiguous.
std::string writeMultiRowGroupParquet(
    const std::string& filename,
    int64_t numRows,
    int64_t rowGroupSize,
    int64_t baseTs,
    int64_t stepSec)
{
    auto dir = getTempParquetDir();
    auto filePath = dir / filename;

    auto schema = arrow::schema({
        arrow::field("timestamp", arrow::int64()),
        arrow::field("open", arrow::float64()),
        arrow::field("high", arrow::float64()),
        arrow::field("low", arrow::float64()),
        arrow::field("close", arrow::float64()),
        arrow::field("volume", arrow::float64()),
    });

    arrow::Int64Builder tsBuilder;
    arrow::DoubleBuilder openBuilder, highBuilder, lowBuilder, closeBuilder, volBuilder;
    for (int64_t i = 0; i < numRows; ++i) {
        (void)tsBuilder.Append(baseTs + i * stepSec);
        (void)openBuilder.Append(100.0 + static_cast<double>(i));
        (void)highBuilder.Append(101.0 + static_cast<double>(i));
        (void)lowBuilder.Append(99.0 + static_cast<double>(i));
        (void)closeBuilder.Append(100.5 + static_cast<double>(i));
        (void)volBuilder.Append(1000.0 + static_cast<double>(i));
    }
    std::shared_ptr<arrow::Array> tsArray, openArray, highArray, lowArray, closeArray, volArray;
    (void)tsBuilder.Finish(&tsArray);
    (void)openBuilder.Finish(&openArray);
    (void)highBuilder.Finish(&highArray);
    (void)lowBuilder.Finish(&lowArray);
    (void)closeBuilder.Finish(&closeArray);
    (void)volBuilder.Finish(&volArray);

    auto table = arrow::Table::Make(
        schema, {tsArray, openArray, highArray, lowArray, closeArray, volArray});
    auto outfile = arrow::io::FileOutputStream::Open(filePath.string()).ValueOrDie();
    // Passing rowGroupSize as the chunk size forces multiple row groups
    // (Parquet flushes a row group every `chunk_size` rows).
    (void)parquet::arrow::WriteTable(
        *table, arrow::default_memory_pool(), outfile, rowGroupSize);
    return filePath.string();
}

/// Read a Parquet file's row-group count from its footer metadata only.
int parquetRowGroupCount(const std::string& path) {
    auto infile = arrow::io::ReadableFile::Open(path).ValueOrDie();
    parquet::arrow::FileReaderBuilder builder;
    (void)builder.Open(infile);
    std::unique_ptr<parquet::arrow::FileReader> reader;
    (void)builder.Build(&reader);
    return reader->parquet_reader()->metadata()->num_row_groups();
}

/// Cleanup temp Parquet directory
struct TempParquetCleanup {
    ~TempParquetCleanup() {
        std::filesystem::remove_all(getTempParquetDir());
    }
};

} // anonymous namespace

TEST_CASE("TICKET_641_1: Parquet metadata row count validation", "[data_source][security][parquet]") {
    TempParquetCleanup cleanup;

    SECTION("successfully loads valid small Parquet file") {
        constexpr int64_t numRows = 100;
        auto filePath = writeTestParquetFile("valid_small.parquet", numRows);

        auto source = createDataSource("parquet");
        DataConfig config{
            .symbol = "TEST/USDT",
            .interval = "1m",
            .startTime = 0,
            .endTime = 0,
            .dataPath = filePath,
            .dataSourceType = "parquet"
        };

        DataFrame df = source->loadData(config);
        REQUIRE(df.size() == numRows);
        REQUIRE(df.symbol == "TEST/USDT");
    }

    SECTION("metadata num_rows matches actual row count") {
        constexpr int64_t numRows = 250;
        auto filePath = writeTestParquetFile("metadata_check.parquet", numRows);

        // Verify metadata directly via Parquet API
        auto infile = arrow::io::ReadableFile::Open(filePath).ValueOrDie();
        parquet::arrow::FileReaderBuilder builder;
        (void)builder.Open(infile);
        std::unique_ptr<parquet::arrow::FileReader> reader;
        (void)builder.Build(&reader);

        auto metadataRows = reader->parquet_reader()->metadata()->num_rows();
        REQUIRE(metadataRows == numRows);
    }

    SECTION("rejects Parquet file when metadata exceeds MAX_DATAFRAME_ROWS") {
        // Create a Parquet file with 10 actual rows but forged metadata claiming 60M rows.
        // This directly exercises the pre-ReadTable metadata check in parquet_data_source.cpp.
        constexpr int64_t forgedRows = 60'000'000;
        auto filePath = writeParquetWithForgedRowCount(
            "forged_oversized.parquet", 10, forgedRows);

        // Verify the forged metadata is readable and reports the inflated count
        auto infile = arrow::io::ReadableFile::Open(filePath).ValueOrDie();
        parquet::arrow::FileReaderBuilder builder;
        (void)builder.Open(infile);
        std::unique_ptr<parquet::arrow::FileReader> reader;
        (void)builder.Build(&reader);
        REQUIRE(reader->parquet_reader()->metadata()->num_rows() == forgedRows);

        // loadData() must throw before ReadTable() due to the metadata check
        auto source = createDataSource("parquet");
        DataConfig config{
            .symbol = "TEST",
            .interval = "1m",
            .startTime = 0,
            .endTime = 0,
            .dataPath = filePath,
            .dataSourceType = "parquet"
        };

        REQUIRE_THROWS_AS(source->loadData(config), std::runtime_error);
    }

    SECTION("rejection error message contains row count and limit") {
        constexpr int64_t forgedRows = 60'000'000;
        auto filePath = writeParquetWithForgedRowCount(
            "forged_msg_check.parquet", 10, forgedRows);

        auto source = createDataSource("parquet");
        DataConfig config{
            .symbol = "TEST",
            .interval = "1m",
            .startTime = 0,
            .endTime = 0,
            .dataPath = filePath,
            .dataSourceType = "parquet"
        };

        using Catch::Matchers::ContainsSubstring;
        REQUIRE_THROWS_WITH(source->loadData(config),
            ContainsSubstring("60000000") && ContainsSubstring("exceeds maximum"));
    }
}

// =============================================================================
// TICKET_1292 Phase 3 (MC-07): Parquet window pushdown
// =============================================================================

TEST_CASE("TICKET_1292: ParquetDataSource window pushdown", "[data_source][parquet][window][1292]") {
    TempParquetCleanup cleanup;

    // 1000 rows, 100 rows per row group => 10 row groups. Timestamps in
    // SECONDS starting at baseTs, one per minute.
    constexpr int64_t kBase = 1'704'067'200;  // 2024-01-01 00:00:00 UTC (seconds)
    constexpr int64_t kStep = 60;             // 1-minute bars
    constexpr int64_t kRows = 1000;
    constexpr int64_t kRgSize = 100;
    const std::string path =
        writeMultiRowGroupParquet("window_pushdown.parquet", kRows, kRgSize, kBase, kStep);

    REQUIRE(parquetRowGroupCount(path) == 10);

    auto source = createDataSource("parquet");

    // Full read = ground truth for parity comparison.
    DataConfig fullCfg{
        .symbol = "TEST", .interval = "1m",
        .startTime = 0, .endTime = 0,
        .dataPath = path, .dataSourceType = "parquet",
    };
    DataFrame full = source->loadData(fullCfg);
    REQUIRE(full.size() == static_cast<size_t>(kRows));

    SECTION("no window requested reads the whole file unchanged") {
        // Ground-truth full read already asserted == kRows; confirm the
        // first/last timestamps are the file bounds (nothing trimmed).
        REQUIRE(full.timestamps.front() == kBase);
        REQUIRE(full.timestamps.back() == kBase + (kRows - 1) * kStep);
    }

    SECTION("windowed read with warmup is byte-identical in-window") {
        // Request rows [500, 700] (by index) => ts [kBase+500*step, kBase+700*step].
        const int64_t startTs = kBase + 500 * kStep;
        const int64_t endTs = kBase + 700 * kStep;
        constexpr int64_t warmup = 30;

        DataConfig winCfg{
            .symbol = "TEST", .interval = "1m",
            .startTime = startTs, .endTime = endTs,
            .dataPath = path, .dataSourceType = "parquet",
        };
        winCfg.warmupBars = warmup;
        DataFrame win = source->loadData(winCfg);

        // The read must NOT contain the whole file.
        REQUIRE(win.size() < full.size());

        // First retained row is exactly `warmup` rows before index 500.
        REQUIRE(win.timestamps.front() == kBase + (500 - warmup) * kStep);
        // Last retained row is index 700 (inclusive endTs).
        REQUIRE(win.timestamps.back() == endTs);
        REQUIRE(win.size() == static_cast<size_t>((700 - (500 - warmup)) + 1));

        // Every row in the windowed frame matches the corresponding full
        // row byte-for-byte (OHLCV + timestamp). This is the parity proof:
        // pushdown changes WHICH rows are returned, never their values.
        const size_t offset = 500 - warmup;
        for (size_t i = 0; i < win.size(); ++i) {
            REQUIRE(win.timestamps[i] == full.timestamps[offset + i]);
            REQUIRE(win.open[i]  == full.open[offset + i]);
            REQUIRE(win.high[i]  == full.high[offset + i]);
            REQUIRE(win.low[i]   == full.low[offset + i]);
            REQUIRE(win.close[i] == full.close[offset + i]);
            REQUIRE(win.volume[i] == full.volume[offset + i]);
        }
    }

    SECTION("row-group pruning: window near end excludes early groups") {
        // Window covering only the last row group's range. With warmup 0,
        // the read must return at most the rows in the overlapping groups,
        // far fewer than the full file.
        const int64_t startTs = kBase + 950 * kStep;
        const int64_t endTs = kBase + 999 * kStep;
        DataConfig winCfg{
            .symbol = "TEST", .interval = "1m",
            .startTime = startTs, .endTime = endTs,
            .dataPath = path, .dataSourceType = "parquet",
        };
        winCfg.warmupBars = 0;
        DataFrame win = source->loadData(winCfg);
        // Exactly rows [950, 999] survive the exact-bound trim.
        REQUIRE(win.timestamps.front() == startTs);
        REQUIRE(win.timestamps.back() == endTs);
        REQUIRE(win.size() == 50);
    }

    SECTION("warmup clamps at buffer start when window is near the beginning") {
        const int64_t startTs = kBase + 10 * kStep;   // index 10
        const int64_t endTs = kBase + 50 * kStep;     // index 50
        DataConfig winCfg{
            .symbol = "TEST", .interval = "1m",
            .startTime = startTs, .endTime = endTs,
            .dataPath = path, .dataSourceType = "parquet",
        };
        winCfg.warmupBars = 1000;  // more than exist before startTs
        DataFrame win = source->loadData(winCfg);
        // Clamped: read starts at the very first row, not before it.
        REQUIRE(win.timestamps.front() == kBase);
        REQUIRE(win.timestamps.back() == endTs);
        REQUIRE(win.size() == 51);  // indices [0, 50]
    }

    SECTION("window entirely after the data returns empty") {
        const int64_t startTs = kBase + (kRows + 100) * kStep;
        const int64_t endTs = startTs + 1000;
        DataConfig winCfg{
            .symbol = "TEST", .interval = "1m",
            .startTime = startTs, .endTime = endTs,
            .dataPath = path, .dataSourceType = "parquet",
        };
        winCfg.warmupBars = 5;
        DataFrame win = source->loadData(winCfg);
        REQUIRE(win.empty());
    }

    SECTION("upper-bound-only window (endTime set, startTime 0) trims the tail") {
        const int64_t endTs = kBase + 300 * kStep;
        DataConfig winCfg{
            .symbol = "TEST", .interval = "1m",
            .startTime = 0, .endTime = endTs,
            .dataPath = path, .dataSourceType = "parquet",
        };
        winCfg.warmupBars = 50;  // ignored: no lower bound to warm up from
        DataFrame win = source->loadData(winCfg);
        REQUIRE(win.timestamps.front() == kBase);
        REQUIRE(win.timestamps.back() == endTs);
        REQUIRE(win.size() == 301);  // indices [0, 300]
    }
}
