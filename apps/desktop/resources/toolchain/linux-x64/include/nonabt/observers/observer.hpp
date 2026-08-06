#pragma once

#include <stratforge/broker/broker.hpp>
#include <stratforge/data/data_feed.hpp>

#include <vector>

namespace nonabt {

/// Observer base class - passive line-bearing recorder
class Observer {
public:
    Observer() = default;
    virtual ~Observer() = default;

    Observer(const Observer&) = delete;
    Observer& operator=(const Observer&) = delete;
    Observer(Observer&&) = default;
    Observer& operator=(Observer&&) = default;

    /// Called once at the start
    virtual void start() {}

    /// Called when an order changes state
    virtual void notify_order(const Order& order) {}

    /// Called when a trade changes state
    virtual void notify_trade(const Trade& trade, double original_size) {}

    /// Called on every bar to record data
    virtual void next(const BackBroker& broker, const std::vector<DataFeed*>& feeds) = 0;

    /// Called once at the end
    virtual void stop() {}
};

} // namespace nonabt
