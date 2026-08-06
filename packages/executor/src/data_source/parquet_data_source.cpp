/**
 * Parquet Data Source Implementation
 *
 * TICKET_133 Phase 1: Executor Core Development
 * TICKET_175 Phase 1: Zero-copy Data Pipeline Optimization
 *
 * Reads OHLCV data from Parquet files using Apache Arrow.
 *
 * Optimizations applied (modernc_quant.md):
 * - #51 Arrow columnar access: Direct buffer access via raw_values()
 * - #40 std::span views: Zero-copy column extraction
 * - #18 Vector pre-allocation: resize() instead of reserve()+push_back()
 * - #53 Move semantics: std::move for DataFrame transfers
 */

#include "quantnexus/executor/data_source.hpp"
#include "quantnexus/executor/executor_constants.hpp"

#include <arrow/api.h>
#include <arrow/io/file.h>
#include <parquet/arrow/reader.h>
#include <parquet/metadata.h>
#include <parquet/statistics.h>

#include <stdexcept>
#include <format>
#include <cstring>  // std::memcpy
#include <algorithm>  // std::lower_bound, std::upper_bound
#include <vector>
#include <cstdint>
#include <limits>

namespace StratCraft::executor {

// The OHLCV `timestamp` column name. The five OHLCV value columns are
// still referenced as literals below (pre-existing TICKET_175 code);
// only the timestamp name is centralized here because the TICKET_1292
// row-group pushdown resolves it in two places (data extract + stats
// probe) and a drift between them would silently disable pruning.
inline constexpr const char* PARQUET_TIMESTAMP_COLUMN = "timestamp";

// =============================================================================
// ParquetDataSource - Zero-copy Optimized (TICKET_175)
// =============================================================================

class ParquetDataSource : public IDataSource {
public:
    DataFrame loadData(const DataConfig& config) override {
        DataFrame df;
        df.symbol = config.symbol;
        df.interval = config.interval;

        // Open Parquet file
        auto result = arrow::io::ReadableFile::Open(config.dataPath);
        if (!result.ok()) [[unlikely]] {
            throw std::runtime_error(
                std::format("Failed to open Parquet file: {}", config.dataPath));
        }
        auto infile = result.ValueOrDie();

        // Create Parquet reader with optimized settings
        parquet::arrow::FileReaderBuilder builder;
        auto builderStatus = builder.Open(infile);
        if (!builderStatus.ok()) [[unlikely]] {
            throw std::runtime_error(
                std::format("Failed to open Parquet reader: {}", builderStatus.ToString()));
        }

        // Configure for performance: read only needed columns
        parquet::ArrowReaderProperties props;
        props.set_batch_size(constants::PARQUET_BATCH_SIZE);
        builder.properties(props);

        std::unique_ptr<parquet::arrow::FileReader> reader;
        auto buildStatus = builder.Build(&reader);
        if (!buildStatus.ok()) [[unlikely]] {
            throw std::runtime_error(
                std::format("Failed to build Parquet reader: {}", buildStatus.ToString()));
        }

        const auto fileMeta = reader->parquet_reader()->metadata();

        // TICKET_641_1: Pre-read metadata check -- reject before ReadTable() loads data into memory
        const auto metadataRowCount = fileMeta->num_rows();
        if (static_cast<size_t>(metadataRowCount) > constants::MAX_DATAFRAME_ROWS) [[unlikely]] {
            throw std::runtime_error(
                std::format("Parquet file metadata reports {} rows, exceeds maximum allowed {} rows",
                    metadataRowCount, constants::MAX_DATAFRAME_ROWS));
        }

        // TICKET_1292 Phase 3 (MC-07): window pushdown at the row-group
        // level. When a window is requested, select only the row groups
        // whose `timestamp` statistics overlap the (warmup-extended)
        // window and read *those* -- never the whole file. When no window
        // is requested the legacy full ReadTable() path is preserved
        // byte-for-byte.
        const bool windowRequested = (config.startTime > 0 || config.endTime > 0);

        std::shared_ptr<arrow::Table> table;
        if (windowRequested) {
            const std::vector<int> rowGroups =
                selectRowGroupsForWindow(*fileMeta, config);
            auto readStatus = reader->ReadRowGroups(rowGroups, &table);
            if (!readStatus.ok()) [[unlikely]] {
                throw std::runtime_error(std::format(
                    "Failed to read Parquet row groups: {}", readStatus.ToString()));
            }
        } else {
            // Read entire table (Arrow manages memory efficiently)
            auto readStatus = reader->ReadTable(&table);
            if (!readStatus.ok()) [[unlikely]] {
                throw std::runtime_error(
                    std::format("Failed to read Parquet table: {}", readStatus.ToString()));
            }
        }

        // Pre-allocate with exact size (modernc_quant #18)
        const size_t numRows = static_cast<size_t>(table->num_rows());

        // TICKET_641_1: Guard against corrupted/malicious Parquet files claiming excessive rows
        if (numRows > constants::MAX_DATAFRAME_ROWS) [[unlikely]] {
            throw std::runtime_error(
                std::format("Parquet file claims {} rows, exceeds maximum allowed {} rows",
                    numRows, constants::MAX_DATAFRAME_ROWS));
        }

        df.timestamps.resize(numRows);
        df.open.resize(numRows);
        df.high.resize(numRows);
        df.low.resize(numRows);
        df.close.resize(numRows);
        df.volume.resize(numRows);

        // Zero-copy column extraction (modernc_quant #51)
        extractColumnZeroCopy(table, PARQUET_TIMESTAMP_COLUMN, df.timestamps);
        extractColumnZeroCopy(table, "open", df.open);
        extractColumnZeroCopy(table, "high", df.high);
        extractColumnZeroCopy(table, "low", df.low);
        extractColumnZeroCopy(table, "close", df.close);
        extractColumnZeroCopy(table, "volume", df.volume);

        // Filter by time range using binary search (O(log n) instead of O(n)).
        // Row-group pushdown above already discarded groups outside the
        // window; this trims the retained groups to the exact bounds while
        // preserving `warmupBars` rows before `startTime` so a stateful
        // consumer reaches the same warm state it would under a full read.
        if (windowRequested) {
            filterByTimeRangeOptimized(
                df, config.startTime, config.endTime, config.warmupBars);
        }

        return df;
    }

    std::string getName() const noexcept override {
        return constants::DATA_SOURCE_NAME_PARQUET;
    }

private:
    /**
     * TICKET_1292 Phase 3 (MC-07): resolve the `timestamp` column ordinal
     * from the Parquet schema so we can read its per-row-group statistics.
     * Returns -1 when the column is absent (caller falls back to reading
     * all row groups -- safe, just not pruned).
     */
    static int timestampColumnIndex(const parquet::FileMetaData& meta) noexcept {
        const auto* schema = meta.schema();
        for (int i = 0; i < schema->num_columns(); ++i) {
            if (schema->Column(i)->name() == PARQUET_TIMESTAMP_COLUMN) {
                return i;
            }
        }
        return -1;
    }

    /**
     * TICKET_1292 Phase 3 (MC-07): pick the row groups whose `timestamp`
     * range overlaps the requested window, plus enough preceding row
     * groups to cover `warmupBars` rows before the window's first row.
     *
     * Selection is by row-group min/max statistics (O(row groups), no
     * data decode). Contract details that make this a correctness fix and
     * not a heuristic:
     *
     *   - Upper bound: a row group is dropped iff its MIN timestamp is
     *     strictly greater than `endTime` (when endTime > 0). Everything
     *     at or before `endTime` is retained; the exact `<= endTime` trim
     *     happens later in filterByTimeRangeOptimized.
     *   - Lower bound: a row group is dropped iff its MAX timestamp is
     *     strictly less than `startTime` (when startTime > 0) AND it is
     *     not needed for warmup. Warmup keeps the last `warmupBars` rows
     *     preceding the window: we walk row groups in reverse from the
     *     first in-window group, accumulating row counts until the budget
     *     is met, and retain those groups too.
     *   - Any row group whose statistics are missing / not min-max is
     *     conservatively retained (correctness over pruning).
     *   - When the timestamp column is absent, all row groups are
     *     retained (no ordering to prune on).
     *
     * The returned indices are ascending and contiguous over the retained
     * span, matching the file's physical (already time-sorted) order so
     * the concatenated table stays sorted for the downstream binary-search
     * trim.
     */
    static std::vector<int> selectRowGroupsForWindow(
        const parquet::FileMetaData& meta,
        const DataConfig& config
    ) {
        const int numGroups = meta.num_row_groups();
        std::vector<int> all;
        all.reserve(static_cast<size_t>(numGroups));
        for (int i = 0; i < numGroups; ++i) all.push_back(i);

        const int tsCol = timestampColumnIndex(meta);
        if (tsCol < 0) {
            // No timestamp column -> cannot prune; read everything.
            return all;
        }

        // Per-group [min, max] timestamps and row counts. A group with
        // unusable statistics gets [INT64_MIN, INT64_MAX] so it is never
        // pruned (conservative retain).
        struct GroupStat {
            int64_t minTs;
            int64_t maxTs;
            int64_t rows;
            bool hasStats;
        };
        std::vector<GroupStat> stats;
        stats.reserve(static_cast<size_t>(numGroups));
        for (int g = 0; g < numGroups; ++g) {
            const auto rg = meta.RowGroup(g);
            const int64_t rows = rg->num_rows();
            int64_t lo = std::numeric_limits<int64_t>::min();
            int64_t hi = std::numeric_limits<int64_t>::max();
            bool has = false;
            const auto col = rg->ColumnChunk(tsCol);
            if (col && col->is_stats_set()) {
                const auto s = col->statistics();
                if (s && s->HasMinMax()) {
                    if (auto i64 =
                            std::dynamic_pointer_cast<parquet::Int64Statistics>(s)) {
                        lo = i64->min();
                        hi = i64->max();
                        has = true;
                    }
                }
            }
            stats.push_back(GroupStat{lo, hi, rows, has});
        }

        const int64_t startTime = config.startTime;
        const int64_t endTime = config.endTime;

        // First and last in-band row groups (inclusive span). A group is
        // in-band when it is not fully below startTime and not fully above
        // endTime.
        int firstIn = numGroups;  // sentinel: none
        int lastIn = -1;
        for (int g = 0; g < numGroups; ++g) {
            const auto& s = stats[g];
            // Fully above the window (only meaningful with usable stats).
            if (endTime > 0 && s.hasStats && s.minTs > endTime) continue;
            // Fully below the window.
            if (startTime > 0 && s.hasStats && s.maxTs < startTime) continue;
            if (g < firstIn) firstIn = g;
            if (g > lastIn) lastIn = g;
        }

        // No group overlaps the window -> empty read. Reading zero row
        // groups yields an empty table, which the caller treats as "empty
        // symbol" exactly like the legacy full-read-then-empty-slice did.
        if (lastIn < 0) {
            return {};
        }

        // Warmup back-extension: pull in preceding groups until we have
        // accumulated at least `warmupBars` rows before `firstIn`.
        int lowGroup = firstIn;
        if (config.warmupBars > 0 && startTime > 0) {
            int64_t budget = config.warmupBars;
            for (int g = firstIn - 1; g >= 0 && budget > 0; --g) {
                lowGroup = g;
                budget -= stats[g].rows;
            }
        }

        std::vector<int> selected;
        selected.reserve(static_cast<size_t>(lastIn - lowGroup + 1));
        for (int g = lowGroup; g <= lastIn; ++g) selected.push_back(g);
        return selected;
    }

    /**
     * Zero-copy int64 column extraction using Arrow raw buffer access
     * (modernc_quant #51: Arrow columnar access)
     */
    static void extractColumnZeroCopy(
        const std::shared_ptr<arrow::Table>& table,
        const std::string& name,
        std::vector<int64_t>& out
    ) noexcept(false) {
        auto column = table->GetColumnByName(name);
        if (!column) [[unlikely]] {
            throw std::runtime_error(std::format("Column '{}' not found", name));
        }

        size_t offset = 0;
        for (int i = 0; i < column->num_chunks(); ++i) {
            auto chunk = column->chunk(i);
            const size_t chunkLen = static_cast<size_t>(chunk->length());

            // Try Int64Array first (most common)
            if (auto int64Array = std::dynamic_pointer_cast<arrow::Int64Array>(chunk)) {
                // Direct memcpy from Arrow buffer (zero-copy pattern)
                const int64_t* rawData = int64Array->raw_values();
                std::memcpy(out.data() + offset, rawData, chunkLen * sizeof(int64_t));
            } else if (auto timestampArray = std::dynamic_pointer_cast<arrow::TimestampArray>(chunk)) {
                // TimestampArray also uses int64 internally
                const int64_t* rawData = timestampArray->raw_values();
                std::memcpy(out.data() + offset, rawData, chunkLen * sizeof(int64_t));
            } else [[unlikely]] {
                // Fallback for unexpected types
                for (size_t j = 0; j < chunkLen; ++j) {
                    out[offset + j] = 0;
                }
            }
            offset += chunkLen;
        }
    }

    /**
     * Zero-copy double column extraction using Arrow raw buffer access
     * (modernc_quant #51: Arrow columnar access)
     */
    static void extractColumnZeroCopy(
        const std::shared_ptr<arrow::Table>& table,
        const std::string& name,
        std::vector<double>& out
    ) noexcept(false) {
        auto column = table->GetColumnByName(name);
        if (!column) [[unlikely]] {
            throw std::runtime_error(std::format("Column '{}' not found", name));
        }

        size_t offset = 0;
        for (int i = 0; i < column->num_chunks(); ++i) {
            auto chunk = column->chunk(i);
            const size_t chunkLen = static_cast<size_t>(chunk->length());

            // Try DoubleArray first (most common)
            if (auto doubleArray = std::dynamic_pointer_cast<arrow::DoubleArray>(chunk)) {
                // Direct memcpy from Arrow buffer (zero-copy pattern)
                const double* rawData = doubleArray->raw_values();
                std::memcpy(out.data() + offset, rawData, chunkLen * sizeof(double));
            } else if (auto floatArray = std::dynamic_pointer_cast<arrow::FloatArray>(chunk)) {
                // Float requires conversion (no zero-copy possible)
                const float* rawData = floatArray->raw_values();
                for (size_t j = 0; j < chunkLen; ++j) {
                    out[offset + j] = static_cast<double>(rawData[j]);
                }
            } else [[unlikely]] {
                // Fallback for unexpected types
                for (size_t j = 0; j < chunkLen; ++j) {
                    out[offset + j] = 0.0;
                }
            }
            offset += chunkLen;
        }
    }

    /**
     * Optimized time range filter using binary search
     * Assumes timestamps are sorted (standard for market data)
     * (modernc_quant #53: Move semantics)
     *
     * TICKET_1292 Phase 3 (MC-07): `warmupBars` rows immediately before
     * the first `>= startTime` row are retained so a stateful consumer
     * (factor_eval's rolling indicator + reducer) reaches the exact same
     * warm state at `startTime` it would under a full-file read. The
     * warmup rows are a row COUNT (not a time span), so the trim is exact
     * regardless of bar spacing. The upper bound (`endTime`) is unchanged.
     */
    static void filterByTimeRangeOptimized(
        DataFrame& df, int64_t startTime, int64_t endTime, int64_t warmupBars) {
        if (df.empty()) [[unlikely]] return;

        // Binary search for range bounds (O(log n))
        auto& ts = df.timestamps;

        size_t startIdx = 0;
        size_t endIdx = ts.size();

        if (startTime > 0) {
            auto it = std::lower_bound(ts.begin(), ts.end(), startTime);
            startIdx = static_cast<size_t>(std::distance(ts.begin(), it));
            // Back off by the warmup budget, clamped at the buffer start.
            if (warmupBars > 0) {
                const size_t margin = static_cast<size_t>(warmupBars);
                startIdx = (margin >= startIdx) ? 0 : startIdx - margin;
            }
        }

        if (endTime > 0) {
            auto it = std::upper_bound(ts.begin(), ts.end(), endTime);
            endIdx = static_cast<size_t>(std::distance(ts.begin(), it));
        }

        // No filtering needed
        if (startIdx == 0 && endIdx == ts.size()) [[likely]] {
            return;
        }

        // Create filtered DataFrame with move semantics
        const size_t filteredSize = endIdx - startIdx;
        if (filteredSize == 0) [[unlikely]] {
            df.clear();
            return;
        }

        // In-place truncation when possible (avoid allocation)
        if (startIdx == 0) {
            // Just truncate the end
            df.timestamps.resize(filteredSize);
            df.open.resize(filteredSize);
            df.high.resize(filteredSize);
            df.low.resize(filteredSize);
            df.close.resize(filteredSize);
            df.volume.resize(filteredSize);
        } else {
            // Need to shift data - use memmove for overlapping regions
            std::memmove(df.timestamps.data(), df.timestamps.data() + startIdx, filteredSize * sizeof(int64_t));
            std::memmove(df.open.data(), df.open.data() + startIdx, filteredSize * sizeof(double));
            std::memmove(df.high.data(), df.high.data() + startIdx, filteredSize * sizeof(double));
            std::memmove(df.low.data(), df.low.data() + startIdx, filteredSize * sizeof(double));
            std::memmove(df.close.data(), df.close.data() + startIdx, filteredSize * sizeof(double));
            std::memmove(df.volume.data(), df.volume.data() + startIdx, filteredSize * sizeof(double));

            df.timestamps.resize(filteredSize);
            df.open.resize(filteredSize);
            df.high.resize(filteredSize);
            df.low.resize(filteredSize);
            df.close.resize(filteredSize);
            df.volume.resize(filteredSize);
        }
    }
};

// =============================================================================
// Factory Registration (Parquet)
// =============================================================================

std::unique_ptr<IDataSource> createParquetDataSource() {
    return std::make_unique<ParquetDataSource>();
}

// =============================================================================
// Factory Function
// =============================================================================

std::unique_ptr<IDataSource> createDataSource(const std::string& type) {
    if (type == constants::DATA_SOURCE_TYPE_MOCK) {
        extern std::unique_ptr<IDataSource> createMockDataSource();
        return createMockDataSource();
    } else if (type == constants::DATA_SOURCE_TYPE_PARQUET) {
        return createParquetDataSource();
    } else {
        throw std::runtime_error(std::format("Unknown data source type: {}", type));
    }
}

} // namespace StratCraft::executor
