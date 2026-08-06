/**
 * Data Source Interface
 *
 * TICKET_133 Phase 1: Executor Core Development
 * TICKET_175 Phase 1: Zero-copy Data Pipeline Optimization
 *
 * Defines the IDataSource interface and DataFrame structure for loading market data.
 *
 * Optimizations applied (modernc_quant.md):
 * - #40 std::span views: Zero-copy access to columnar data
 * - #9 Cache-line alignment: alignas(64) for hot data
 * - #53 Move semantics: Explicit move constructor/assignment
 * - #21 noexcept: Guaranteed no-throw for simple operations
 */

#pragma once

#include "config_types.hpp"

#include <string>
#include <vector>
#include <memory>
#include <cstdint>
#include <span>
#include <utility>  // std::move, std::exchange

#include "hardware_constants.hpp"

namespace StratCraft::executor {

// TICKET_476: CACHE_LINE_SIZE centralized in hardware_constants.hpp
using constants::CACHE_LINE_SIZE;

// =============================================================================
// OHLCV Bar
// =============================================================================

/**
 * Single OHLCV bar (cache-line aligned for hot path access)
 * (modernc_quant #9: Cache-line alignment)
 */
struct alignas(CACHE_LINE_SIZE) OHLCVBar {
    int64_t timestamp;              // Unix timestamp (ms)
    double open;
    double high;
    double low;
    double close;
    double volume;
    // Padding to fill cache line (48 bytes data + 16 bytes padding = 64)
    [[maybe_unused]] char _padding[16];
};

// =============================================================================
// DataFrame
// =============================================================================

/**
 * Columnar data structure for market data
 *
 * Stores OHLCV data in columnar format for efficient NumPy conversion.
 * Provides std::span views for zero-copy access (modernc_quant #40).
 *
 * Memory layout optimized for:
 * - Sequential access patterns (columnar storage)
 * - Zero-copy array access
 * - Cache-friendly iteration
 */
struct DataFrame {
    std::string symbol;
    std::string interval;

    // Columnar storage (for zero-copy NumPy conversion)
    std::vector<int64_t> timestamps;
    std::vector<double> open;
    std::vector<double> high;
    std::vector<double> low;
    std::vector<double> close;
    std::vector<double> volume;

    // =========================================================================
    // Constructors (Rule of 5 with move semantics)
    // =========================================================================

    DataFrame() = default;

    // Move constructor (modernc_quant #53)
    DataFrame(DataFrame&& other) noexcept
        : symbol(std::move(other.symbol))
        , interval(std::move(other.interval))
        , timestamps(std::move(other.timestamps))
        , open(std::move(other.open))
        , high(std::move(other.high))
        , low(std::move(other.low))
        , close(std::move(other.close))
        , volume(std::move(other.volume))
    {}

    // Move assignment (modernc_quant #53)
    DataFrame& operator=(DataFrame&& other) noexcept {
        if (this != &other) {
            symbol = std::move(other.symbol);
            interval = std::move(other.interval);
            timestamps = std::move(other.timestamps);
            open = std::move(other.open);
            high = std::move(other.high);
            low = std::move(other.low);
            close = std::move(other.close);
            volume = std::move(other.volume);
        }
        return *this;
    }

    // Copy constructor (explicit, may be expensive)
    DataFrame(const DataFrame&) = default;

    // Copy assignment (explicit, may be expensive)
    DataFrame& operator=(const DataFrame&) = default;

    // =========================================================================
    // Basic Operations
    // =========================================================================

    /**
     * Get number of rows (noexcept for hot path)
     */
    [[nodiscard]] size_t size() const noexcept { return timestamps.size(); }

    /**
     * Check if empty (noexcept for hot path)
     */
    [[nodiscard]] bool empty() const noexcept { return timestamps.empty(); }

    /**
     * Reserve capacity for all columns
     */
    void reserve(size_t n) {
        timestamps.reserve(n);
        open.reserve(n);
        high.reserve(n);
        low.reserve(n);
        close.reserve(n);
        volume.reserve(n);
    }

    /**
     * Resize all columns (pre-allocation pattern)
     */
    void resize(size_t n) {
        timestamps.resize(n);
        open.resize(n);
        high.resize(n);
        low.resize(n);
        close.resize(n);
        volume.resize(n);
    }

    /**
     * Add a bar (for compatibility, prefer bulk operations)
     */
    void addBar(const OHLCVBar& bar) {
        timestamps.push_back(bar.timestamp);
        open.push_back(bar.open);
        high.push_back(bar.high);
        low.push_back(bar.low);
        close.push_back(bar.close);
        volume.push_back(bar.volume);
    }

    /**
     * Clear all data
     */
    void clear() noexcept {
        timestamps.clear();
        open.clear();
        high.clear();
        low.clear();
        close.clear();
        volume.clear();
    }

    // =========================================================================
    // Zero-copy Views (modernc_quant #40: std::span)
    // =========================================================================

    /**
     * Get read-only span view of timestamps (zero-copy)
     */
    [[nodiscard]] std::span<const int64_t> timestampView() const noexcept {
        return std::span<const int64_t>(timestamps);
    }

    /**
     * Get read-only span view of open prices (zero-copy)
     */
    [[nodiscard]] std::span<const double> openView() const noexcept {
        return std::span<const double>(open);
    }

    /**
     * Get read-only span view of high prices (zero-copy)
     */
    [[nodiscard]] std::span<const double> highView() const noexcept {
        return std::span<const double>(high);
    }

    /**
     * Get read-only span view of low prices (zero-copy)
     */
    [[nodiscard]] std::span<const double> lowView() const noexcept {
        return std::span<const double>(low);
    }

    /**
     * Get read-only span view of close prices (zero-copy)
     */
    [[nodiscard]] std::span<const double> closeView() const noexcept {
        return std::span<const double>(close);
    }

    /**
     * Get read-only span view of volume (zero-copy)
     */
    [[nodiscard]] std::span<const double> volumeView() const noexcept {
        return std::span<const double>(volume);
    }

    /**
     * Get mutable span view of timestamps
     */
    [[nodiscard]] std::span<int64_t> timestampSpan() noexcept {
        return std::span<int64_t>(timestamps);
    }

    /**
     * Get mutable span view of close prices
     */
    [[nodiscard]] std::span<double> closeSpan() noexcept {
        return std::span<double>(close);
    }

    // =========================================================================
    // Subrange View (for windowed operations)
    // =========================================================================

    /**
     * Get subrange view of close prices [start, end)
     */
    [[nodiscard]] std::span<const double> closeSubrange(size_t start, size_t count) const noexcept {
        if (start >= close.size()) [[unlikely]] {
            return {};
        }
        const size_t actualCount = std::min(count, close.size() - start);
        return std::span<const double>(close.data() + start, actualCount);
    }
};

// =============================================================================
// IDataSource Interface
// =============================================================================

/**
 * Data source interface
 *
 * Abstracts data loading from different sources (Parquet, mock, etc.)
 */
class IDataSource {
public:
    virtual ~IDataSource() = default;

    /**
     * Load data according to configuration
     *
     * @param config Data configuration specifying symbol, time range, etc.
     * @return DataFrame containing OHLCV data
     */
    virtual DataFrame loadData(const DataConfig& config) = 0;

    /**
     * Get data source name
     *
     * @return Human-readable name of this data source
     */
    virtual std::string getName() const = 0;
};

// =============================================================================
// Factory
// =============================================================================

/**
 * Create data source by type
 *
 * @param type Data source type ("parquet", "mock")
 * @return Unique pointer to data source implementation
 */
std::unique_ptr<IDataSource> createDataSource(const std::string& type);

} // namespace StratCraft::executor
