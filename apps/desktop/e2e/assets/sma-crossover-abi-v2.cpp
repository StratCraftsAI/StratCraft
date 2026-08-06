#include <qnx_strategy_sdk/qnx_strategy_sdk.hpp>
#include <stratforge/indicators/sma.hpp>
#include <stratforge/strategy/strategy.hpp>

#include <cmath>
#include <memory>

class P8SmaCrossover final : public stratforge::Strategy {
public:
    void init() override {
        fast_ = std::make_unique<stratforge::SMA>(data().close(), 10);
        slow_ = std::make_unique<stratforge::SMA>(data().close(), 30);
    }

    void next() override {
        fast_->next();
        slow_->next();
        const double fast = fast_->line()[0];
        const double slow = slow_->line()[0];
        if (std::isnan(fast) || std::isnan(slow)) {
            return;
        }
        if (std::abs(position().size) < 1e-10 && fast > slow) {
            (void)buy(100.0);
        } else if (position().size > 0 && fast <= slow) {
            (void)close();
        }
    }

private:
    std::unique_ptr<stratforge::SMA> fast_;
    std::unique_ptr<stratforge::SMA> slow_;
};

QNX_STRATEGY_FACTORY_EXPORT(P8SmaCrossover)
