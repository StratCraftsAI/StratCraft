/**
 * TICKET_634_6: Incremental Indicator Tests
 *
 * Tests for O(1) live engine indicators: EMA, SMA, RSI, IndicatorRegistry.
 * Validates mathematical correctness, readiness state, and registry management.
 */

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "quantnexus/executor/live/indicators.hpp"

#include <vector>
#include <cmath>

using namespace StratCraft::executor::live;
using Catch::Matchers::WithinAbs;

// =============================================================================
// EMA Tests
// =============================================================================

TEST_CASE("EMA indicator", "[indicators][regression]") {
    SECTION("should not be ready before period bars") {
        EMA ema(10);
        for (int i = 0; i < 9; ++i) {
            ema.update(100.0);
        }
        REQUIRE_FALSE(ema.ready());
    }

    SECTION("should be ready after period bars") {
        EMA ema(10);
        for (int i = 0; i < 10; ++i) {
            ema.update(100.0);
        }
        REQUIRE(ema.ready());
    }

    SECTION("should return constant value for constant input") {
        EMA ema(5);
        for (int i = 0; i < 20; ++i) {
            ema.update(100.0);
        }
        REQUIRE_THAT(ema.value(), WithinAbs(100.0, 1e-10));
    }

    SECTION("should converge toward latest values") {
        EMA ema(3);
        // Feed 100 for warmup
        for (int i = 0; i < 10; ++i) {
            ema.update(100.0);
        }
        // Switch to 200
        for (int i = 0; i < 50; ++i) {
            ema.update(200.0);
        }
        // Should converge close to 200
        REQUIRE_THAT(ema.value(), WithinAbs(200.0, 0.01));
    }

    SECTION("should reset correctly") {
        EMA ema(5);
        for (int i = 0; i < 10; ++i) {
            ema.update(100.0);
        }
        REQUIRE(ema.ready());
        ema.reset();
        REQUIRE_FALSE(ema.ready());
        REQUIRE_THAT(ema.value(), WithinAbs(0.0, 1e-10));
    }

    SECTION("alpha should be 2/(period+1)") {
        // EMA(9): alpha = 2/10 = 0.2
        // First value becomes the EMA
        // Second value: EMA = 0.2 * new + 0.8 * old
        EMA ema(9);
        ema.update(100.0); // value_ = 100
        ema.update(110.0); // value_ = 0.2*110 + 0.8*100 = 102
        REQUIRE_THAT(ema.value(), WithinAbs(102.0, 1e-10));
    }
}

// =============================================================================
// SMA Tests
// =============================================================================

TEST_CASE("SMA indicator", "[indicators][regression]") {
    SECTION("should not be ready before period bars") {
        SMA sma(5);
        for (int i = 0; i < 4; ++i) {
            sma.update(100.0);
        }
        REQUIRE_FALSE(sma.ready());
    }

    SECTION("should be ready after period bars") {
        SMA sma(5);
        for (int i = 0; i < 5; ++i) {
            sma.update(100.0);
        }
        REQUIRE(sma.ready());
    }

    SECTION("should compute correct average") {
        SMA sma(3);
        sma.update(10.0);
        sma.update(20.0);
        sma.update(30.0);
        REQUIRE_THAT(sma.value(), WithinAbs(20.0, 1e-10));
    }

    SECTION("should slide window correctly") {
        SMA sma(3);
        sma.update(10.0);
        sma.update(20.0);
        sma.update(30.0);
        // Window: [10, 20, 30] -> avg = 20
        REQUIRE_THAT(sma.value(), WithinAbs(20.0, 1e-10));

        sma.update(40.0);
        // Window: [20, 30, 40] -> avg = 30
        REQUIRE_THAT(sma.value(), WithinAbs(30.0, 1e-10));
    }

    SECTION("should return 0 for empty window") {
        SMA sma(5);
        REQUIRE_THAT(sma.value(), WithinAbs(0.0, 1e-10));
    }

    SECTION("should reset correctly") {
        SMA sma(3);
        sma.update(100.0);
        sma.update(200.0);
        sma.update(300.0);
        sma.reset();
        REQUIRE_FALSE(sma.ready());
        REQUIRE_THAT(sma.value(), WithinAbs(0.0, 1e-10));
    }

    SECTION("should handle constant input") {
        SMA sma(10);
        for (int i = 0; i < 100; ++i) {
            sma.update(42.0);
        }
        REQUIRE_THAT(sma.value(), WithinAbs(42.0, 1e-10));
    }
}

// =============================================================================
// RSI Tests
// =============================================================================

TEST_CASE("RSI indicator", "[indicators][regression]") {
    SECTION("should not be ready before period bars + 1") {
        RSI rsi(14);
        // Need 1 price to set prev_close, then 14 more for period
        for (int i = 0; i < 14; ++i) {
            rsi.update(100.0 + i);
        }
        REQUIRE_FALSE(rsi.ready());
    }

    SECTION("should be ready after period+1 bars") {
        RSI rsi(14);
        for (int i = 0; i <= 14; ++i) {
            rsi.update(100.0 + i);
        }
        REQUIRE(rsi.ready());
    }

    SECTION("should return 100 for all-up movement") {
        RSI rsi(5);
        for (int i = 0; i < 20; ++i) {
            rsi.update(100.0 + i * 10.0); // Monotonically increasing
        }
        REQUIRE_THAT(rsi.value(), WithinAbs(100.0, 0.1));
    }

    SECTION("should return near 0 for all-down movement") {
        RSI rsi(5);
        for (int i = 0; i < 20; ++i) {
            rsi.update(200.0 - i * 10.0); // Monotonically decreasing
        }
        REQUIRE(rsi.value() < 1.0);
    }

    SECTION("should return near 50 for equal up/down movement") {
        RSI rsi(10);
        // Alternating up/down with equal magnitude
        for (int i = 0; i < 100; ++i) {
            rsi.update(100.0 + (i % 2 == 0 ? 10.0 : -10.0));
        }
        // RSI should be near 50 for equal gains and losses
        REQUIRE(rsi.value() > 40.0);
        REQUIRE(rsi.value() < 60.0);
    }

    SECTION("should be between 0 and 100") {
        RSI rsi(14);
        std::vector<double> prices = {
            44.0, 44.34, 44.09, 43.61, 44.33,
            44.83, 45.10, 45.42, 45.84, 46.08,
            45.89, 46.03, 45.61, 46.28, 46.28,
            46.00, 46.03, 46.41, 46.22, 45.64,
        };
        for (double p : prices) {
            rsi.update(p);
        }
        REQUIRE(rsi.value() >= 0.0);
        REQUIRE(rsi.value() <= 100.0);
    }

    SECTION("should reset correctly") {
        RSI rsi(5);
        for (int i = 0; i < 20; ++i) {
            rsi.update(100.0 + i);
        }
        rsi.reset();
        REQUIRE_FALSE(rsi.ready());
    }
}

// =============================================================================
// IndicatorRegistry Tests
// =============================================================================

TEST_CASE("IndicatorRegistry", "[indicators][regression]") {
    SECTION("should add and retrieve indicators") {
        IndicatorRegistry registry;
        registry.add<SMA>("sma_20", 20);
        registry.add<EMA>("ema_10", 10);
        REQUIRE(registry.size() == 2);
    }

    SECTION("should update all indicators at once") {
        IndicatorRegistry registry;
        registry.add<SMA>("sma_3", 3);
        registry.add<EMA>("ema_3", 3);

        registry.update_all(100.0);
        registry.update_all(200.0);
        registry.update_all(300.0);

        // SMA(3) of [100, 200, 300] = 200
        REQUIRE_THAT(registry.get("sma_3"), WithinAbs(200.0, 1e-10));
    }

    SECTION("should return 0 for unknown indicator") {
        IndicatorRegistry registry;
        REQUIRE_THAT(registry.get("nonexistent"), WithinAbs(0.0, 1e-10));
    }

    SECTION("should report readiness correctly") {
        IndicatorRegistry registry;
        registry.add<SMA>("sma_3", 3);
        registry.add<SMA>("sma_5", 5);

        // After 3 updates: sma_3 ready, sma_5 not
        for (int i = 0; i < 3; ++i) registry.update_all(100.0);

        REQUIRE(registry.ready("sma_3"));
        REQUIRE_FALSE(registry.ready("sma_5"));
        REQUIRE_FALSE(registry.all_ready());

        // After 2 more: both ready
        for (int i = 0; i < 2; ++i) registry.update_all(100.0);
        REQUIRE(registry.all_ready());
    }

    SECTION("should return false readiness for unknown name") {
        IndicatorRegistry registry;
        REQUIRE_FALSE(registry.ready("unknown"));
    }

    SECTION("should produce correct snapshot") {
        IndicatorRegistry registry;
        auto& sma = registry.add<SMA>("sma_2", 2);
        sma.update(10.0);
        sma.update(20.0);

        auto snap = registry.snapshot();
        REQUIRE(snap.size() == 1);
        REQUIRE_THAT(snap["sma_2"], WithinAbs(15.0, 1e-10));
    }

    SECTION("should clear all indicators") {
        IndicatorRegistry registry;
        registry.add<SMA>("sma", 5);
        registry.add<EMA>("ema", 5);
        REQUIRE(registry.size() == 2);

        registry.clear();
        REQUIRE(registry.size() == 0);
    }

    SECTION("all_ready should return true when empty") {
        IndicatorRegistry registry;
        REQUIRE(registry.all_ready());
    }
}
