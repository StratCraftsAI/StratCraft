#pragma once

#include <stratforge/broker/broker.hpp>
#include <stratforge/broker/sizer.hpp>
#include <stratforge/core/params.hpp>
#include <stratforge/data/data_feed.hpp>

#include <cstddef>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace nonabt {

/// Strategy base class.
/// Provides lifecycle hooks and order submission methods.
/// Not using CRTP here to keep the API simpler for users;
/// virtual dispatch cost is negligible compared to strategy logic.
class Strategy {
public:
    Strategy() : sizer_(std::make_unique<FixedSize>(1.0)) {}
    virtual ~Strategy() = default;

    Strategy(const Strategy&) = delete;
    Strategy& operator=(const Strategy&) = delete;
    Strategy(Strategy&&) = default;
    Strategy& operator=(Strategy&&) = default;

    // --- Lifecycle hooks (override in derived strategies) ---

    /// Called once before any data processing. Set up indicators here.
    virtual void init() {}

    /// Called once when the strategy starts (data is available).
    virtual void start() {}

    /// Called before minimum_period is reached.
    virtual void prenext() {}

    /// Called exactly once when minimum_period is first reached.
    virtual void nextstart() { next(); }

    /// Called on every bar after minimum_period is satisfied.
    virtual void next() {}

    /// Called when the strategy is stopped (end of data).
    virtual void stop() {}

    // --- Notification callbacks ---

    /// Called when an order changes status
    virtual void notify_order(const Order& order) {}

    /// Called when a trade changes status
    virtual void notify_trade(const Trade& trade, double original_size) {}

    // --- Sizer ---

    /// Set a new sizer. Strategy takes ownership.
    void setsizer(std::unique_ptr<Sizer> sizer) {
        sizer_ = std::move(sizer);
    }

    /// Get current sizer
    [[nodiscard]] const Sizer& sizer() const noexcept {
        return *sizer_;
    }

    // --- Order submission methods ---

    /// Submit a buy order. If size is nullopt, the sizer is used.
    [[nodiscard]] std::size_t buy(std::optional<double> size = std::nullopt,
                                   double price = 0.0,
                                   OrderType type = OrderType::Market,
                                   std::size_t data_index = 0) {
        if (!broker_) return 0;
        double actual_size = size.has_value() ? *size : getsizing(OrderSide::Buy, price, data_index);
        return broker_->buy(actual_size, price, std::nullopt, type, data_index);
    }

    /// Submit a sell order. If size is nullopt, the sizer is used.
    [[nodiscard]] std::size_t sell(std::optional<double> size = std::nullopt,
                                    double price = 0.0,
                                    OrderType type = OrderType::Market,
                                    std::size_t data_index = 0) {
        if (!broker_) return 0;
        double actual_size = size.has_value() ? *size : getsizing(OrderSide::Sell, price, data_index);
        return broker_->sell(actual_size, price, std::nullopt, type, data_index);
    }

    /// Close position
    [[nodiscard]] std::size_t close(std::size_t data_index = 0) {
        if (!broker_) return 0;
        return broker_->close(data_index);
    }

    /// Cancel an order
    void cancel(std::size_t order_id) {
        if (broker_) broker_->cancel_order(order_id);
    }

    /// Submit a buy order with extended parameters
    [[nodiscard]] std::size_t buy_ext(double size, const BackBroker::OrderParams& params) {
        if (!broker_) return 0;
        return broker_->buy_ext(size, params);
    }

    /// Submit a sell order with extended parameters
    [[nodiscard]] std::size_t sell_ext(double size, const BackBroker::OrderParams& params) {
        if (!broker_) return 0;
        return broker_->sell_ext(size, params);
    }

    /// Submit a buy bracket order (main + take-profit + stop-loss)
    [[nodiscard]] BackBroker::BracketResult buy_bracket(
        double size, double limit_price, double stop_price, std::size_t data_index = 0) {
        if (!broker_) return {0, 0, 0};
        return broker_->buy_bracket(size, limit_price, stop_price, data_index);
    }

    /// Submit a sell bracket order (main + take-profit + stop-loss)
    [[nodiscard]] BackBroker::BracketResult sell_bracket(
        double size, double limit_price, double stop_price, std::size_t data_index = 0) {
        if (!broker_) return {0, 0, 0};
        return broker_->sell_bracket(size, limit_price, stop_price, data_index);
    }

    // --- Data access ---

    /// Access data feed by index
    [[nodiscard]] const DataFeed& data(std::size_t index = 0) const {
        return *data_feeds_.at(index);
    }

    /// Access data feed by name
    [[nodiscard]] const DataFeed& data(std::string_view name) const {
        return *data_lookup_.at(std::string(name));
    }

    /// Check whether a named data feed exists
    [[nodiscard]] bool has_data(std::string_view name) const {
        return data_lookup_.contains(std::string(name));
    }

    /// Return the configured name for a data feed by index
    [[nodiscard]] const std::string& data_name(std::size_t index) const {
        return data_names_.at(index);
    }

    /// Number of data feeds
    [[nodiscard]] std::size_t data_count() const noexcept {
        return data_feeds_.size();
    }

    /// All data feeds
    [[nodiscard]] const std::vector<DataFeed*>& data_feeds() const noexcept {
        return data_feeds_;
    }

    /// Get the broker
    [[nodiscard]] const BackBroker& broker() const {
        return *broker_;
    }

    /// Get the position for a data feed
    [[nodiscard]] const Position& position(std::size_t data_index = 0) const {
        return broker_->position(data_index);
    }

    // --- Params ---

    /// Default strategy parameters. Override to declare strategy defaults.
    [[nodiscard]] virtual ParamMap default_params() const { return {}; }

    /// Resolved strategy parameters (defaults merged with runtime overrides)
    [[nodiscard]] ParamView params() const noexcept {
        return ParamView(&params_);
    }

    template <typename T>
    [[nodiscard]] T param(std::string_view key) const {
        return params().get<T>(key);
    }

    // --- Minimum period ---

    /// Set minimum period (number of bars before next() is called)
    void set_minimum_period(std::size_t period) noexcept {
        minimum_period_ = period;
    }

    /// Get minimum period
    [[nodiscard]] std::size_t minimum_period() const noexcept {
        return minimum_period_;
    }

    // --- Internal (called by Cerebro) ---

    void set_broker(BackBroker* broker) noexcept { broker_ = broker; }
    void set_data_feeds(std::vector<DataFeed*> feeds) {
        data_feeds_ = std::move(feeds);
        rebuild_data_lookup();
    }
    void set_params(ParamMap overrides) {
        params_ = merge_params(default_params(), overrides);
        params_initialized_ = true;
    }
    void ensure_params_initialized() {
        if (!params_initialized_) {
            set_params({});
        }
    }

private:
    [[nodiscard]] double getsizing(OrderSide side, double price, std::size_t data_index) const {
        if (!sizer_) return 1.0;
        if (price <= 0.0) {
            price = data(data_index).close()[0];
        }
        return sizer_->getsizing(data(data_index), side, price, data_index, *this);
    }

    void rebuild_data_lookup() {
        data_lookup_.clear();
        data_names_.clear();
        data_names_.reserve(data_feeds_.size());

        for (std::size_t index = 0; index < data_feeds_.size(); ++index) {
            auto* feed = data_feeds_[index];
            std::string resolved_name = feed->name().empty()
                ? ("data" + std::to_string(index))
                : feed->name();
            data_names_.push_back(resolved_name);
            data_lookup_[resolved_name] = feed;
        }
    }

    BackBroker* broker_ = nullptr;
    std::vector<DataFeed*> data_feeds_;
    std::vector<std::string> data_names_;
    std::unordered_map<std::string, DataFeed*> data_lookup_;
    ParamMap params_;
    bool params_initialized_ = false;
    std::size_t minimum_period_ = 1;
    std::unique_ptr<Sizer> sizer_;
};

// Inline implementations for Sizers that need Strategy methods.

inline double PercentSizer::getsizing(const DataFeed&, OrderSide,
                                     double price, std::size_t,
                                     const Strategy& strategy) const {
    if (price <= 0.0) return 0.0;
    double value = strategy.broker().portfolio_value(strategy.data_feeds());
    return (value * (percents_ / 100.0)) / price;
}

inline double AllInSizer::getsizing(const DataFeed&, OrderSide side,
                                   double price, std::size_t data_index,
                                   const Strategy& strategy) const {
    if (price <= 0.0) return 0.0;
    if (side == OrderSide::Buy) {
        return strategy.broker().cash() / price;
    } else {
        return std::abs(strategy.position(data_index).size);
    }
}

inline double FixedReverser::getsizing(const DataFeed&, OrderSide,
                                       double, std::size_t data_index,
                                       const Strategy& strategy) const {
    double pos_size = std::abs(strategy.position(data_index).size);
    if (pos_size < 1e-10) return base_size_;
    return pos_size + base_size_;
}

} // namespace nonabt
