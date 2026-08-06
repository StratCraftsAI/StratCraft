#pragma once

#include <stratforge/indicators/periodn.hpp>

#include <limits>

namespace nonabt {

class FindFirstIndexBase : public PeriodN {
public:
    explicit FindFirstIndexBase(const Line<double>& source, std::size_t period)
        : PeriodN(source, period) {}

    void next() override {
        if (in_warmup()) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const auto idx = source().index();
        const std::size_t start = idx - period() + 1;
        const double target = eval(start, idx);

        for (std::size_t i = 0; i < period(); ++i) {
            const std::size_t pos = idx - i;
            if (source().data()[pos] == target) {
                line_.forward(static_cast<double>(i));
                return;
            }
        }

        line_.forward(std::numeric_limits<double>::quiet_NaN());
    }

protected:
    [[nodiscard]] virtual double eval(std::size_t start, std::size_t end) const = 0;
};

class FindLastIndexBase : public PeriodN {
public:
    explicit FindLastIndexBase(const Line<double>& source, std::size_t period)
        : PeriodN(source, period) {}

    void next() override {
        if (in_warmup()) {
            line_.forward(std::numeric_limits<double>::quiet_NaN());
            return;
        }

        const auto idx = source().index();
        const std::size_t start = idx - period() + 1;
        const double target = eval(start, idx);

        for (std::size_t pos = start; pos <= idx; ++pos) {
            if (source().data()[pos] == target) {
                line_.forward(static_cast<double>(idx - pos));
                return;
            }
        }

        line_.forward(std::numeric_limits<double>::quiet_NaN());
    }

protected:
    [[nodiscard]] virtual double eval(std::size_t start, std::size_t end) const = 0;
};

class FindFirstIndexHighest : public FindFirstIndexBase {
public:
    explicit FindFirstIndexHighest(const Line<double>& source, std::size_t period)
        : FindFirstIndexBase(source, period) {}

protected:
    [[nodiscard]] double eval(std::size_t start, std::size_t end) const override {
        double value = source().data()[start];
        for (std::size_t pos = start + 1; pos <= end; ++pos) {
            if (source().data()[pos] > value) {
                value = source().data()[pos];
            }
        }
        return value;
    }
};

class FindLastIndexHighest : public FindLastIndexBase {
public:
    explicit FindLastIndexHighest(const Line<double>& source, std::size_t period)
        : FindLastIndexBase(source, period) {}

protected:
    [[nodiscard]] double eval(std::size_t start, std::size_t end) const override {
        double value = source().data()[start];
        for (std::size_t pos = start + 1; pos <= end; ++pos) {
            if (source().data()[pos] > value) {
                value = source().data()[pos];
            }
        }
        return value;
    }
};

class FindFirstIndexLowest : public FindFirstIndexBase {
public:
    explicit FindFirstIndexLowest(const Line<double>& source, std::size_t period)
        : FindFirstIndexBase(source, period) {}

protected:
    [[nodiscard]] double eval(std::size_t start, std::size_t end) const override {
        double value = source().data()[start];
        for (std::size_t pos = start + 1; pos <= end; ++pos) {
            if (source().data()[pos] < value) {
                value = source().data()[pos];
            }
        }
        return value;
    }
};

class FindLastIndexLowest : public FindLastIndexBase {
public:
    explicit FindLastIndexLowest(const Line<double>& source, std::size_t period)
        : FindLastIndexBase(source, period) {}

protected:
    [[nodiscard]] double eval(std::size_t start, std::size_t end) const override {
        double value = source().data()[start];
        for (std::size_t pos = start + 1; pos <= end; ++pos) {
            if (source().data()[pos] < value) {
                value = source().data()[pos];
            }
        }
        return value;
    }
};

} // namespace nonabt
