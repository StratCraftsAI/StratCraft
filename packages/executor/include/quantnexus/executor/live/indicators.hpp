/**
 * Incremental Indicators for Live Engine
 *
 * TICKET_613: Stateful indicators that update in O(1) per bar.
 * No window recomputation -- each update is constant time.
 */

#pragma once

#include <cmath>
#include <deque>
#include <string>
#include <memory>
#include <unordered_map>

namespace StratCraft::executor::live {

// =============================================================================
// Base Interface
// =============================================================================

class IIndicator {
public:
    virtual ~IIndicator() = default;
    [[nodiscard]] virtual double value() const noexcept = 0;
    [[nodiscard]] virtual bool ready() const noexcept = 0;
    virtual void update(double value) = 0;
    virtual void reset() = 0;
};

// =============================================================================
// Exponential Moving Average -- O(1) update
// =============================================================================

class EMA : public IIndicator {
public:
    explicit EMA(int period) : period_(period), alpha_(2.0 / (period + 1)) {}

    void update(double value) override {
        if (!initialized_) {
            value_ = value;
            initialized_ = true;
            ++count_;
        } else {
            value_ = alpha_ * value + (1.0 - alpha_) * value_;
            ++count_;
        }
    }

    [[nodiscard]] double value() const noexcept override { return value_; }
    [[nodiscard]] bool ready() const noexcept override { return count_ >= period_; }
    void reset() override { value_ = 0; count_ = 0; initialized_ = false; }

private:
    int period_;
    double alpha_;
    double value_ = 0;
    int count_ = 0;
    bool initialized_ = false;
};

// =============================================================================
// Simple Moving Average -- O(1) update with sliding window
// =============================================================================

class SMA : public IIndicator {
public:
    explicit SMA(int period) : period_(period) {}

    void update(double value) override {
        sum_ += value;
        window_.push_back(value);
        if (static_cast<int>(window_.size()) > period_) {
            sum_ -= window_.front();
            window_.pop_front();
        }
    }

    [[nodiscard]] double value() const noexcept override {
        return window_.empty() ? 0 : sum_ / static_cast<double>(window_.size());
    }
    [[nodiscard]] bool ready() const noexcept override {
        return static_cast<int>(window_.size()) >= period_;
    }
    void reset() override { window_.clear(); sum_ = 0; }

private:
    int period_;
    std::deque<double> window_;
    double sum_ = 0;
};

// =============================================================================
// RSI -- O(1) Wilder's smoothing update
// =============================================================================

class RSI : public IIndicator {
public:
    explicit RSI(int period) : period_(period) {}

    void update(double close) override {
        if (prev_close_ < 0) {
            prev_close_ = close;
            return;
        }

        double delta = close - prev_close_;
        double gain = delta > 0 ? delta : 0;
        double loss = delta < 0 ? -delta : 0;
        prev_close_ = close;

        ++count_;

        if (count_ <= period_) {
            gain_sum_ += gain;
            loss_sum_ += loss;
            if (count_ == period_) {
                avg_gain_ = gain_sum_ / period_;
                avg_loss_ = loss_sum_ / period_;
            }
        } else {
            avg_gain_ = (avg_gain_ * (period_ - 1) + gain) / period_;
            avg_loss_ = (avg_loss_ * (period_ - 1) + loss) / period_;
        }

        if (avg_loss_ < 1e-10) {
            rsi_ = 100.0;
        } else {
            rsi_ = 100.0 - 100.0 / (1.0 + avg_gain_ / avg_loss_);
        }
    }

    [[nodiscard]] double value() const noexcept override { return rsi_; }
    [[nodiscard]] bool ready() const noexcept override { return count_ >= period_; }
    void reset() override {
        count_ = 0; prev_close_ = -1; gain_sum_ = 0; loss_sum_ = 0;
        avg_gain_ = 0; avg_loss_ = 0; rsi_ = 50;
    }

private:
    int period_;
    int count_ = 0;
    double prev_close_ = -1;
    double gain_sum_ = 0, loss_sum_ = 0;
    double avg_gain_ = 0, avg_loss_ = 0;
    double rsi_ = 50;
};

// =============================================================================
// Indicator Registry -- manages named indicator instances
// =============================================================================

class IndicatorRegistry {
public:
    template<typename T, typename... Args>
    T& add(const std::string& name, Args&&... args) {
        auto indicator = std::make_unique<T>(std::forward<Args>(args)...);
        T& ref = *indicator;
        indicators_[name] = std::move(indicator);
        return ref;
    }

    void update_all(double close) {
        for (auto& [name, indicator] : indicators_) {
            indicator->update(close);
        }
    }

    [[nodiscard]] double get(const std::string& name) const {
        auto it = indicators_.find(name);
        if (it == indicators_.end()) return 0;
        return it->second->value();
    }

    [[nodiscard]] bool ready(const std::string& name) const {
        auto it = indicators_.find(name);
        if (it == indicators_.end()) return false;
        return it->second->ready();
    }

    [[nodiscard]] bool all_ready() const {
        for (const auto& [name, indicator] : indicators_) {
            if (!indicator->ready()) return false;
        }
        return true;
    }

    // Pack all indicator values into a map
    [[nodiscard]] std::unordered_map<std::string, double> snapshot() const {
        std::unordered_map<std::string, double> result;
        for (const auto& [name, indicator] : indicators_) {
            result[name] = indicator->value();
        }
        return result;
    }

    [[nodiscard]] std::size_t size() const noexcept { return indicators_.size(); }

    void clear() { indicators_.clear(); }

private:
    std::unordered_map<std::string, std::unique_ptr<IIndicator>> indicators_;
};

} // namespace StratCraft::executor::live
