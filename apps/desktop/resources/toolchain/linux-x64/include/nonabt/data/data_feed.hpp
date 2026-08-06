#pragma once

#include <nonabt/core/line.hpp>
#include <nonabt/data/timeframe.hpp>

#include <chrono>
#include <cstddef>
#include <memory>
#include <string>

namespace nonabt {

/// DateTime type alias using system_clock
using DateTime = std::chrono::system_clock::time_point;

/// DataFeed - Base data feed with standard OHLCV + datetime lines.
/// Derived classes implement load() to provide data from various sources.
class DataFeed {
public:
    DataFeed() = default;
    virtual ~DataFeed() = default;

    DataFeed(const DataFeed&) = delete;
    DataFeed& operator=(const DataFeed&) = delete;
    DataFeed(DataFeed&&) = default;
    DataFeed& operator=(DataFeed&&) = default;

    /// Load next bar into lines. Returns false when no more data.
    [[nodiscard]] virtual bool load() = 0;

    /// Clone this data feed (creates a fresh, independent copy from the same source).
    /// Override in derived classes to enable use with the optimizer.
    [[nodiscard]] virtual std::unique_ptr<DataFeed> clone() const { return nullptr; }

    /// Preload all data into memory
    virtual void preload() {
        while (load()) {}
        datetime_.home();
        open_.home();
        high_.home();
        low_.home();
        close_.home();
        volume_.home();
        openinterest_.home();
    }

    /// Advance all lines to next bar
    void advance() noexcept {
        datetime_.advance();
        open_.advance();
        high_.advance();
        low_.advance();
        close_.advance();
        volume_.advance();
        openinterest_.advance();
    }

    /// Number of bars loaded
    [[nodiscard]] std::size_t size() const noexcept {
        return close_.size();
    }

    /// Current bar index
    [[nodiscard]] std::size_t index() const noexcept {
        return close_.index();
    }

    /// Remaining bars from current position
    [[nodiscard]] std::size_t buflen() const noexcept {
        return close_.buflen();
    }

    // Standard OHLCV + datetime line accessors
    [[nodiscard]] const Line<DateTime>& datetime() const noexcept { return datetime_; }
    [[nodiscard]] const Line<double>& open() const noexcept { return open_; }
    [[nodiscard]] const Line<double>& high() const noexcept { return high_; }
    [[nodiscard]] const Line<double>& low() const noexcept { return low_; }
    [[nodiscard]] const Line<double>& close() const noexcept { return close_; }
    [[nodiscard]] const Line<double>& volume() const noexcept { return volume_; }
    [[nodiscard]] const Line<double>& openinterest() const noexcept { return openinterest_; }

    // Mutable accessors for derived classes
    [[nodiscard]] Line<DateTime>& datetime() noexcept { return datetime_; }
    [[nodiscard]] Line<double>& open() noexcept { return open_; }
    [[nodiscard]] Line<double>& high() noexcept { return high_; }
    [[nodiscard]] Line<double>& low() noexcept { return low_; }
    [[nodiscard]] Line<double>& close() noexcept { return close_; }
    [[nodiscard]] Line<double>& volume() noexcept { return volume_; }
    [[nodiscard]] Line<double>& openinterest() noexcept { return openinterest_; }

    /// Feed name (for identification)
    void set_name(std::string name) noexcept { name_ = std::move(name); }
    [[nodiscard]] const std::string& name() const noexcept { return name_; }

    /// Timeframe
    void set_timeframe(TimeFrameCompression tf) noexcept { timeframe_ = tf; }
    [[nodiscard]] TimeFrameCompression timeframe() const noexcept { return timeframe_; }

protected:
    Line<DateTime> datetime_;
    Line<double> open_;
    Line<double> high_;
    Line<double> low_;
    Line<double> close_;
    Line<double> volume_;
    Line<double> openinterest_;

private:
    std::string name_;
    TimeFrameCompression timeframe_;
};

} // namespace nonabt
