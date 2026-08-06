#pragma once

#include <stratforge/indicators/periodn.hpp>

#include <limits>
#include <utility>
#include <vector>

namespace nonabt {

/// Weighted arithmetic average over the trailing period.
class WeightedAverage : public PeriodN {
public:
    explicit WeightedAverage(const Line<double>& source,
                             std::size_t period,
                             double coef = 1.0,
                             std::vector<double> weights = {})
        : PeriodN(source, period), coef_(coef), weights_(std::move(weights)) {
        if (weights_.empty()) {
            weights_.reserve(this->period());
            for (std::size_t i = 0; i < this->period(); ++i) {
                weights_.push_back(static_cast<double>(i + 1));
            }
        }
        if (weights_.size() < this->period()) {
            weights_.resize(this->period(), weights_.empty() ? 1.0 : weights_.back());
        }
    }

    void next() override {
        if (in_warmup()) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const auto idx = source().index();
        double total = 0.0;
        for (std::size_t i = 0; i < period(); ++i) {
            total += source().data()[idx - period() + 1 + i] * weights_[i];
        }

        line_.forward(coef_ * total);
    }

private:
    double coef_;
    std::vector<double> weights_;
};

using AverageWeighted = WeightedAverage;

} // namespace nonabt
