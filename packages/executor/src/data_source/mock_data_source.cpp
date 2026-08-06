/**
 * Mock Data Source Implementation
 *
 * TICKET_133 Phase 1: Executor Core Development
 *
 * Generates synthetic OHLCV data for testing.
 */

#include "quantnexus/executor/data_source.hpp"
#include "quantnexus/executor/executor_constants.hpp"

#include <cmath>
#include <random>

namespace StratCraft::executor {

// =============================================================================
// MockDataSource
// =============================================================================

class MockDataSource : public IDataSource {
public:
    DataFrame loadData(const DataConfig& config) override {
        DataFrame df;
        df.symbol = config.symbol;
        df.interval = config.interval;

        // Calculate number of bars
        int64_t intervalSeconds = parseInterval(config.interval);
        int64_t duration = config.endTime - config.startTime;
        size_t numBars = static_cast<size_t>(duration / intervalSeconds);

        if (numBars == 0) {
            numBars = constants::MOCK_DATA_DEFAULT_BARS;
        }

        df.reserve(numBars);

        // Generate synthetic price data
        std::mt19937 rng(constants::MOCK_DATA_RNG_SEED);
        std::normal_distribution<double> returns(
            constants::MOCK_DATA_RETURN_MEAN,
            constants::MOCK_DATA_RETURN_STDDEV
        );  // Daily returns

        double price = constants::MOCK_DATA_INITIAL_PRICE;
        int64_t timestamp = config.startTime * constants::MS_PER_SECOND;

        for (size_t i = 0; i < numBars; ++i) {
            double ret = returns(rng);
            double open = price;
            double close = price * (1.0 + ret);
            double high = std::max(open, close) * (1.0 + std::abs(returns(rng)) * constants::MOCK_DATA_VOLATILITY_FACTOR);
            double low = std::min(open, close) * (1.0 - std::abs(returns(rng)) * constants::MOCK_DATA_VOLATILITY_FACTOR);
            double volume = constants::MOCK_DATA_VOLUME_MULTIPLIER * (1.0 + returns(rng));

            OHLCVBar bar{
                .timestamp = timestamp,
                .open = open,
                .high = high,
                .low = low,
                .close = close,
                .volume = std::max(0.0, volume),
                ._padding = {}
            };

            df.addBar(bar);

            price = close;
            timestamp += intervalSeconds * constants::MS_PER_SECOND;
        }

        return df;
    }

    std::string getName() const override {
        return constants::DATA_SOURCE_NAME_MOCK;
    }

private:
    /**
     * Parse interval string to seconds
     */
    static int64_t parseInterval(const std::string& interval) {
        if (interval.empty()) return constants::MOCK_DATA_DEFAULT_INTERVAL_SECONDS;

        char unit = interval.back();
        int value = std::stoi(interval.substr(0, interval.size() - 1));

        switch (unit) {
            case 's': return value;
            case 'm': return value * constants::SECONDS_PER_MINUTE;
            case 'h': return value * constants::SECONDS_PER_HOUR;
            case 'd': return value * constants::SECONDS_PER_DAY;
            default: return constants::MOCK_DATA_DEFAULT_INTERVAL_SECONDS;
        }
    }
};

// =============================================================================
// Factory Registration (Mock)
// =============================================================================

namespace {
    struct MockDataSourceRegistrar {
        MockDataSourceRegistrar() {
            // Registration happens via createDataSource factory
        }
    };
}

std::unique_ptr<IDataSource> createMockDataSource() {
    return std::make_unique<MockDataSource>();
}

} // namespace StratCraft::executor
