#pragma once

#include <stratforge/core/line.hpp>
#include <stratforge/observers/observer.hpp>

namespace nonabt {

/// CashValue observer - records cash and portfolio value per bar
class CashValue : public Observer {
public:
    void next(const BackBroker& broker, const std::vector<DataFeed*>& feeds) override {
        cash_.forward(broker.cash());
        value_.forward(broker.portfolio_value(feeds));
    }

    /// Cash line
    [[nodiscard]] const Line<double>& cash() const noexcept { return cash_; }

    /// Portfolio value line
    [[nodiscard]] const Line<double>& value() const noexcept { return value_; }

private:
    Line<double> cash_;
    Line<double> value_;
};

} // namespace nonabt
