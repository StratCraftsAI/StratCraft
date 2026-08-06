#pragma once

#include <stratforge/core/line.hpp>
#include <stratforge/observers/observer.hpp>

namespace nonabt {

/// Value observer - records portfolio value per bar
class ValueObserver : public Observer {
public:
    void next(const BackBroker& broker, const std::vector<DataFeed*>& feeds) override {
        value_.forward(broker.portfolio_value(feeds));
    }

    [[nodiscard]] const Line<double>& value() const noexcept { return value_; }

private:
    Line<double> value_;
};

} // namespace nonabt
