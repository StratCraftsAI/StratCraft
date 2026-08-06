#pragma once

#include <stratforge/broker/broker.hpp>
#include <stratforge/data/data_feed.hpp>
#include <stratforge/strategy/strategy.hpp>

#include <vector>

namespace nonabt {

/// Analyzer base class - collects statistics during a backtest run
class Analyzer {
public:
    Analyzer() = default;
    virtual ~Analyzer() = default;

    Analyzer(const Analyzer&) = delete;
    Analyzer& operator=(const Analyzer&) = delete;
    Analyzer(Analyzer&&) = default;
    Analyzer& operator=(Analyzer&&) = default;

    /// Called once at the start
    virtual void start() {}

    /// Called when an order changes state
    virtual void notify_order(const Order& order) {}

    /// Called when a trade changes state
    virtual void notify_trade(const Trade& trade, double original_size) {}

    /// Called on every bar
    virtual void next(const BackBroker& broker, const std::vector<DataFeed*>& feeds) {}

    /// Called at the end
    virtual void stop() {}
};

} // namespace nonabt
