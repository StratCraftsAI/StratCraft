#pragma once

#include <stratforge/analyzers/analyzer.hpp>
#include <stratforge/broker/broker.hpp>
#include <stratforge/data/data_feed.hpp>
#include <stratforge/observers/observer.hpp>
#include <stratforge/strategy/strategy.hpp>

#include <cstddef>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace nonabt {

/// Cerebro - Central orchestrator for backtesting.
/// Manages data feeds, strategies, broker, analyzers, and observers.
class Cerebro {
public:
    struct RunOptions {
        bool runonce = false;
        bool preload = true;
    };

    Cerebro() = default;

    /// Add a data feed (takes ownership)
    void add_data(std::unique_ptr<DataFeed> feed, std::string name = {}) {
        if (!name.empty()) {
            feed->set_name(std::move(name));
        }
        data_feeds_.push_back(std::move(feed));
    }

    /// Add a strategy (takes ownership)
    void add_strategy(std::unique_ptr<Strategy> strategy) {
        strategies_.push_back(std::move(strategy));
    }

    /// Add a strategy by type with constructor args
    template <typename S, typename... Args>
    S& add_strategy(Args&&... args) {
        auto ptr = std::make_unique<S>(std::forward<Args>(args)...);
        auto& ref = *ptr;
        strategies_.push_back(std::move(ptr));
        return ref;
    }

    /// Add a strategy with parameter overrides
    template <typename S, typename... Args>
    S& add_strategy_with_params(ParamMap params, Args&&... args) {
        auto ptr = std::make_unique<S>(std::forward<Args>(args)...);
        ptr->set_params(std::move(params));
        auto& ref = *ptr;
        strategies_.push_back(std::move(ptr));
        return ref;
    }

    /// Add an analyzer (takes ownership)
    void add_analyzer(std::unique_ptr<Analyzer> analyzer) {
        analyzers_.push_back(std::move(analyzer));
    }

    /// Add an analyzer by type with constructor args
    template <typename A, typename... Args>
    A& add_analyzer(Args&&... args) {
        auto ptr = std::make_unique<A>(std::forward<Args>(args)...);
        auto& ref = *ptr;
        analyzers_.push_back(std::move(ptr));
        return ref;
    }

    /// Add an observer (takes ownership)
    void add_observer(std::unique_ptr<Observer> observer) {
        observers_.push_back(std::move(observer));
    }

    /// Add an observer by type
    template <typename O, typename... Args>
    O& add_observer(Args&&... args) {
        auto ptr = std::make_unique<O>(std::forward<Args>(args)...);
        auto& ref = *ptr;
        observers_.push_back(std::move(ptr));
        return ref;
    }

    /// Set initial cash
    void set_cash(double cash) { broker_.set_cash(cash); }

    /// Set commission scheme
    void set_commission(CommissionInfo info) { broker_.set_commission(info); }

    /// Set percentage-based slippage on the broker
    void set_slippage_perc(double perc, bool slip_open = true, bool slip_limit = true,
                           bool slip_match = true, bool slip_out = false) {
        broker_.set_slippage_perc(perc, slip_open, slip_limit, slip_match, slip_out);
    }

    /// Set fixed-point slippage on the broker
    void set_slippage_fixed(double fixed, bool slip_open = true, bool slip_limit = true,
                            bool slip_match = true, bool slip_out = false) {
        broker_.set_slippage_fixed(fixed, slip_open, slip_limit, slip_match, slip_out);
    }

    /// Get the broker
    [[nodiscard]] const BackBroker& broker() const noexcept { return broker_; }
    [[nodiscard]] BackBroker& broker() noexcept { return broker_; }

    /// Run the backtest
    void run() {
        run({});
    }

    /// Run the backtest with explicit engine options.
    void run(RunOptions options) {
        if (data_feeds_.empty()) return;
        if (!options.preload) {
            throw std::invalid_argument(
                "Cerebro currently requires preload=true; streaming execution is not implemented");
        }

        // Build raw pointer vector for internal use
        std::vector<DataFeed*> feed_ptrs;
        feed_ptrs.reserve(data_feeds_.size());
        for (auto& feed : data_feeds_) {
            feed_ptrs.push_back(feed.get());
        }

        // Phase 5 contract: runonce currently shares the same bar-by-bar engine
        // path as the validated preload=true execution model.
        static_cast<void>(options.runonce);

        // Preload all data feeds
        for (auto& feed : data_feeds_) {
            feed->preload();
        }

        // Determine the number of bars (use smallest data feed)
        std::size_t num_bars = data_feeds_[0]->size();
        for (std::size_t i = 1; i < data_feeds_.size(); ++i) {
            num_bars = std::min(num_bars, data_feeds_[i]->size());
        }

        if (num_bars == 0) return;

        // Set up broker notifications -> strategy callbacks
        broker_.set_order_notify([this](const Order& order) {
            for (auto& strat : strategies_) {
                strat->notify_order(order);
            }
            for (auto& analyzer : analyzers_) {
                analyzer->notify_order(order);
            }
            for (auto& observer : observers_) {
                observer->notify_order(order);
            }
        });
        broker_.set_trade_notify([this](const Trade& trade, double orig_size) {
            for (auto& strat : strategies_) {
                strat->notify_trade(trade, orig_size);
            }
            for (auto& analyzer : analyzers_) {
                analyzer->notify_trade(trade, orig_size);
            }
            for (auto& observer : observers_) {
                observer->notify_trade(trade, orig_size);
            }
        });

        // Initialize strategies
        for (auto& strat : strategies_) {
            strat->set_broker(&broker_);
            strat->set_data_feeds(feed_ptrs);
            strat->ensure_params_initialized();
            strat->init();
            strat->start();
        }

        // Start analyzers
        for (auto& analyzer : analyzers_) {
            analyzer->start();
        }

        // Start observers
        for (auto& observer : observers_) {
            observer->start();
        }

        // Main loop: bar by bar
        for (std::size_t bar = 0; bar < num_bars; ++bar) {
            broker_.set_bar_index(bar);

            // Process pending orders against current bar
            broker_.process_orders(feed_ptrs);

            // Call strategy lifecycle methods
            for (auto& strat : strategies_) {
                std::size_t min_period = strat->minimum_period();

                if (bar + 1 < min_period) {
                    strat->prenext();
                } else if (bar + 1 == min_period) {
                    strat->nextstart();
                } else {
                    strat->next();
                }
            }

            // Update analyzers
            for (auto& analyzer : analyzers_) {
                analyzer->next(broker_, feed_ptrs);
            }

            // Update observers
            for (auto& observer : observers_) {
                observer->next(broker_, feed_ptrs);
            }

            // Advance all data feeds to next bar
            if (bar + 1 < num_bars) {
                for (auto& feed : data_feeds_) {
                    feed->advance();
                }
            }
        }

        // Stop strategies
        for (auto& strat : strategies_) {
            strat->stop();
        }

        // Stop analyzers
        for (auto& analyzer : analyzers_) {
            analyzer->stop();
        }

        // Stop observers
        for (auto& observer : observers_) {
            observer->stop();
        }
    }

private:
    std::vector<std::unique_ptr<DataFeed>> data_feeds_;
    std::vector<std::unique_ptr<Strategy>> strategies_;
    std::vector<std::unique_ptr<Analyzer>> analyzers_;
    std::vector<std::unique_ptr<Observer>> observers_;
    BackBroker broker_;
};

} // namespace nonabt
