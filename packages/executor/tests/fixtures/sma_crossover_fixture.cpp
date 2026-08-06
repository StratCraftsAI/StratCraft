/// SMA Crossover Fixture Strategy
///
/// NONABT_TICKET_010_3 Phase 4B: checked-in C++ strategy fixture for
/// end-to-end cpp_backtest plugin verification.
///
/// Implements the QNX Strategy SDK ABI v2 contract:
///   - qnx_strategy_abi_version() -> ABI version
///   - nonabt_create_strategy()   -> factory create
///   - nonabt_destroy_strategy()  -> factory destroy
///
/// This strategy uses a 10/30 SMA crossover on the provided CSV data.
/// It is compiled to a shared library and loaded by stratforge-runner.

#include <qnx_strategy_sdk/qnx_strategy_sdk.hpp>
#include <stratforge/indicators/sma.hpp>
#include <stratforge/strategy/strategy.hpp>

#include <cmath>
#include <memory>

/// SMA Crossover strategy (default 10/30 periods)
class SmaCrossoverStrategy : public stratforge::Strategy {
public:
    void init() override {
        sma_fast_ = std::make_unique<stratforge::SMA>(data().close(), fast_period_);
        sma_slow_ = std::make_unique<stratforge::SMA>(data().close(), slow_period_);
    }

    void next() override {
        sma_fast_->next();
        sma_slow_->next();

        const double fast = sma_fast_->line()[0];
        const double slow = sma_slow_->line()[0];

        // Guard against NaN during warmup
        if (std::isnan(fast) || std::isnan(slow)) return;

        const bool is_flat = std::abs(position().size) < 1e-10;
        const bool fast_above = fast > slow;

        if (is_flat && fast_above) {
            (void)buy(100.0);
        } else if (!is_flat && position().size > 0 && !fast_above) {
            (void)close();
        }
    }

private:
    int fast_period_ = 10;
    int slow_period_ = 30;
    std::unique_ptr<stratforge::SMA> sma_fast_;
    std::unique_ptr<stratforge::SMA> sma_slow_;
};

QNX_STRATEGY_FACTORY_EXPORT(SmaCrossoverStrategy)
