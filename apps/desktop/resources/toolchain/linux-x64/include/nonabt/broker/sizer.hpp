#pragma once

#include <stratforge/broker/order.hpp>
#include <cstddef>
#include <memory>

namespace nonabt {

class DataFeed;
class Strategy;

/// Sizer base class.
/// Responsible for determining the size of an order if not explicitly provided.
class Sizer {
public:
    virtual ~Sizer() = default;

    /// Calculate order size
    /// @param data The data feed the order is for
    /// @param side Order side (Buy/Sell)
    /// @param price Proposed execution price
    /// @param data_index Index of the data feed
    /// @param strategy Reference to the strategy using this sizer
    [[nodiscard]] virtual double getsizing(const DataFeed& data, OrderSide side,
                                           double price, std::size_t data_index,
                                           const Strategy& strategy) const = 0;
};

/// FixedSize sizer - always returns the same size.
class FixedSize : public Sizer {
public:
    explicit FixedSize(double size = 1.0) : size_(size) {}

    [[nodiscard]] double getsizing(const DataFeed&, OrderSide, double, std::size_t,
                                   const Strategy&) const override {
        return size_;
    }

private:
    double size_ = 1.0;
};

/// PercentSizer - returns a size based on a percentage of current portfolio value.
class PercentSizer : public Sizer {
public:
    explicit PercentSizer(double percents = 1.0) : percents_(percents) {}

    [[nodiscard]] double getsizing(const DataFeed& data, OrderSide side,
                                   double price, std::size_t data_index,
                                   const Strategy& strategy) const override;

private:
    double percents_ = 1.0;
};

/// AllInSizer - returns a size that uses all available cash.
class AllInSizer : public Sizer {
public:
    [[nodiscard]] double getsizing(const DataFeed& data, OrderSide side,
                                   double price, std::size_t data_index,
                                   const Strategy& strategy) const override;
};

/// FixedReverser - when reversing position, size = |current position| + base size.
/// If flat, returns base size. Used for strategies that flip between long/short.
class FixedReverser : public Sizer {
public:
    explicit FixedReverser(double base_size = 1.0) : base_size_(base_size) {}

    [[nodiscard]] double getsizing(const DataFeed& data, OrderSide side,
                                   double price, std::size_t data_index,
                                   const Strategy& strategy) const override;

private:
    double base_size_ = 1.0;
};

} // namespace nonabt
