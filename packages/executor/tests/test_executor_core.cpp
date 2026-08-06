/**
 * Executor Core Tests
 *
 * TICKET_133 Phase 1: Executor Core Development
 */

#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>

#include "quantnexus/executor/executor_core.hpp"
#include "quantnexus/executor/config_types.hpp"
#include "quantnexus/executor/cpp_backtest_plugin.hpp"
#include "quantnexus/executor/result_types.hpp"
#include "quantnexus/executor/types.hpp"

#include <nlohmann/json.hpp>
#include <algorithm>
#include <fstream>
#include <filesystem>

using namespace StratCraft::executor;
using Catch::Matchers::WithinAbs;
namespace fs = std::filesystem;

namespace {
    const std::string TEST_DIR = "/tmp/StratCraft_executor_test";

    void setupTestDir() {
        fs::create_directories(TEST_DIR);
    }

    void cleanupTestDir() {
        fs::remove_all(TEST_DIR);
    }

    void writeFile(const std::string& path, const std::string& content) {
        std::ofstream file(path);
        file << content;
    }
}

TEST_CASE("ExecutorConfig JSON serialization", "[config][regression]") {
    SECTION("round-trip serialization") {
        ExecutorConfig config;
        config.strategyPath = "/path/to/main.py";
        config.language = "cpp";
        config.pluginName = "cpp_backtest";
        config.compilerPath = "/opt/qnx-llvm/bin/clang++";
        config.runnerPath = "/opt/stratforge/stratforge-runner";
        config.cppIncludePaths = {"/opt/stratforge/include"};
        config.cppStrategyArtifactPath = "/tmp/qnx-cpp-cache/42_deadbeef.so";
        config.cppHardening.enableSandbox = true;
        config.cppHardening.runnerCpuTimeSeconds = 90;
        config.cppHardening.runnerMemoryLimitMb = 768;
        config.cppHardening.enableArtifactCache = true;
        config.cppHardening.artifactCacheDir = "/tmp/qnx-cpp-cache";
        config.cppHardening.pchPath = "/opt/stratforge/include/nonabt.pch";
        config.outputDir = "/path/to/output";
        config.data.symbol = "BTC/USDT";
        config.data.interval = "1h";
        config.data.startTime = 1704067200;
        config.data.endTime = 1704153600;
        config.data.dataSourceType = "mock";
        config.execution.initialCapital = 50000.0;
        config.execution.commission = 0.002;

        nlohmann::json j = config;
        auto loaded = j.get<ExecutorConfig>();

        REQUIRE(loaded.strategyPath == config.strategyPath);
        REQUIRE(loaded.language == "cpp");
        REQUIRE(loaded.pluginName == "cpp_backtest");
        REQUIRE(loaded.compilerPath == config.compilerPath);
        REQUIRE(loaded.runnerPath == config.runnerPath);
        REQUIRE(loaded.cppIncludePaths.size() == 1);
        REQUIRE(loaded.cppStrategyArtifactPath == config.cppStrategyArtifactPath);
        REQUIRE(loaded.cppHardening.enableSandbox);
        REQUIRE(loaded.cppHardening.runnerCpuTimeSeconds == 90);
        REQUIRE(loaded.cppHardening.runnerMemoryLimitMb == 768);
        REQUIRE(loaded.cppHardening.enableArtifactCache);
        REQUIRE(loaded.cppHardening.artifactCacheDir == "/tmp/qnx-cpp-cache");
        REQUIRE(loaded.cppHardening.pchPath == "/opt/stratforge/include/nonabt.pch");
        REQUIRE(loaded.data.symbol == config.data.symbol);
        REQUIRE_THAT(loaded.execution.initialCapital, WithinAbs(50000.0, 0.01));
    }

    SECTION("load from file") {
        setupTestDir();

        nlohmann::json j = {
            {"strategyPath", "/test/main.py"},
            {"outputDir", "/test/output"},
            {"data", {
                {"symbol", "ETH/USDT"},
                {"interval", "1d"},
                {"startTime", 1704067200},
                {"endTime", 1706745600},
                {"dataPath", ""},
                {"dataSourceType", "mock"}
            }},
            {"strategy", {
                {"params", {{"fast_period", 10}, {"slow_period", 20}}}
            }},
            {"execution", {
                {"initialCapital", 100000.0},
                {"commission", 0.001},
                {"slippage", 0.0005},
                {"allowShort", true},
                {"maxPositionSize", 1.0}
            }}
        };

        std::string configPath = TEST_DIR + "/test_config.json";
        writeFile(configPath, j.dump(2));

        auto config = ExecutorConfig::LoadFromFile(configPath);

        REQUIRE(config.data.symbol == "ETH/USDT");
        REQUIRE(config.data.dataSourceType == "mock");

        cleanupTestDir();
    }
}

TEST_CASE("BacktestResult JSON serialization", "[result][regression]") {
    SECTION("save and load result") {
        setupTestDir();

        BacktestResult result;
        result.success = true;
        result.metrics.totalPnl = 5000.0;
        result.metrics.totalReturn = 0.05;
        result.metrics.sharpeRatio = 1.5;
        result.metrics.maxDrawdown = 0.10;
        result.metrics.totalTrades = 50;
        result.metrics.winRate = 0.6;
        result.executionTimeMs = 1234;

        // Add equity point
        result.equityCurve.push_back({
            .timestamp = 1704067200000,
            .equity = 100000.0,
            .drawdown = 0.0
        });

        // Add trade
        result.trades.push_back({
            .entryTime = 1704067200000,
            .exitTime = 1704153600000,
            .symbol = "BTC/USDT",
            .side = "buy",
            .entryPrice = 42000.0,
            .exitPrice = 43000.0,
            .quantity = 1.0,
            .pnl = 1000.0,
            .commission = 84.0,
            .reason = "MA crossover"
        });

        std::string resultPath = TEST_DIR + "/result.json";
        result.SaveToFile(resultPath);

        // Verify file exists and contains valid JSON
        REQUIRE(fs::exists(resultPath));

        std::ifstream file(resultPath);
        nlohmann::json j;
        file >> j;

        REQUIRE(j["success"] == true);
        REQUIRE_THAT(j["metrics"]["totalPnl"].get<double>(), WithinAbs(5000.0, 0.01));
        REQUIRE(j["trades"].size() == 1);

        cleanupTestDir();
    }
}

TEST_CASE("PerformanceMetrics defaults", "[result]") {
    PerformanceMetrics metrics;

    REQUIRE(metrics.totalPnl == 0.0);
    REQUIRE(metrics.totalTrades == 0);
    REQUIRE(metrics.winRate == 0.0);
}

TEST_CASE("FixedPrice scaled arithmetic preserves wide intermediates", "[types][fixed-price]") {
    const FixedPrice large{9'000'000'000'000'000LL};
    const FixedPrice two{2 * FixedPrice::SCALE};
    const FixedPrice half{FixedPrice::SCALE / 2};

    REQUIRE((large * two).raw() == 18'000'000'000'000'000LL);
    REQUIRE((large / half).raw() == 18'000'000'000'000'000LL);
    REQUIRE((FixedPrice{-large.raw()} * two).raw() == -18'000'000'000'000'000LL);
    REQUIRE((large / FixedPrice{}).raw() == 0);
}

TEST_CASE("CppBacktestPlugin fixture config loading", "[cpp_backtest][config][regression]") {
    SECTION("fixture config routes to cpp_backtest") {
        setupTestDir();

        // Load the checked-in fixture config
        std::string fixtureConfig = R"({
            "pluginName": "cpp_backtest",
            "language": "cpp",
            "strategyPath": "./tests/fixtures/sma_crossover_fixture.cpp",
            "outputDir": "./test_output_cpp",
            "data": {
                "symbol": "BTC/USDT",
                "interval": "1d",
                "startTime": 1704067200,
                "endTime": 1706745600,
                "dataPath": "",
                "dataSourceType": "mock"
            },
            "strategy": { "params": { "fast_period": 10, "slow_period": 30 } },
            "execution": {
                "initialCapital": 100000.0,
                "commission": 0.001,
                "slippage": 0.0005,
                "allowShort": false,
                "maxPositionSize": 1.0
            }
        })";

        auto config = ExecutorConfig::LoadFromString(fixtureConfig);

        REQUIRE(config.pluginName == "cpp_backtest");
        REQUIRE(config.language == "cpp");
        REQUIRE(config.strategyPath == "./tests/fixtures/sma_crossover_fixture.cpp");
        REQUIRE(config.data.symbol == "BTC/USDT");
        REQUIRE(config.data.interval == "1d");
        REQUIRE_THAT(config.execution.initialCapital, WithinAbs(100000.0, 0.01));

        cleanupTestDir();
    }
}

TEST_CASE("CppBacktestPlugin interface", "[cpp_backtest]") {
    SECTION("plugin name and metadata") {
        CppBacktestPlugin plugin;

        REQUIRE(plugin.name() == "cpp_backtest");
        REQUIRE(plugin.version() == "0.1.0");
        REQUIRE(plugin.progress() == 0.0f);
        REQUIRE_FALSE(plugin.cancelled());
    }

    SECTION("cancel sets cancelled flag") {
        CppBacktestPlugin plugin;

        REQUIRE_FALSE(plugin.cancelled());
        plugin.cancel();
        REQUIRE(plugin.cancelled());
    }

    SECTION("setProgress updates progress") {
        CppBacktestPlugin plugin;

        plugin.setProgress(50.0f);
        REQUIRE_THAT(plugin.progress(), WithinAbs(50.0f, 0.01f));

        plugin.setProgress(100.0f);
        REQUIRE_THAT(plugin.progress(), WithinAbs(100.0f, 0.01f));
    }

    SECTION("execute fails with missing strategyPath") {
        CppBacktestPlugin plugin;

        nlohmann::json config = {
            {"outputDir", "/tmp/test"},
            {"data", {
                {"symbol", "BTC/USDT"}, {"interval", "1d"},
                {"startTime", 1704067200}, {"endTime", 1706745600},
                {"dataPath", ""}, {"dataSourceType", "mock"}
            }},
            {"strategy", {{"params", {}}}},
            {"execution", {
                {"initialCapital", 100000.0}, {"commission", 0.001},
                {"slippage", 0.0005}, {"allowShort", false}, {"maxPositionSize", 1.0}
            }}
        };

        auto result = plugin.execute(config);

        REQUIRE_FALSE(result.success);
        REQUIRE(result.errorMessage.find("strategyPath") != std::string::npos);
    }

    SECTION("execute fails with nonexistent strategy file") {
        CppBacktestPlugin plugin;

        nlohmann::json config = {
            {"strategyPath", "/nonexistent/strategy.cpp"},
            {"outputDir", "/tmp/test"},
            {"data", {
                {"symbol", "BTC/USDT"}, {"interval", "1d"},
                {"startTime", 1704067200}, {"endTime", 1706745600},
                {"dataPath", ""}, {"dataSourceType", "mock"}
            }},
            {"strategy", {{"params", {}}}},
            {"execution", {
                {"initialCapital", 100000.0}, {"commission", 0.001},
                {"slippage", 0.0005}, {"allowShort", false}, {"maxPositionSize", 1.0}
            }}
        };

        auto result = plugin.execute(config);

        REQUIRE_FALSE(result.success);
        REQUIRE(result.errorMessage.find("not found") != std::string::npos);
    }
}

TEST_CASE("CppBacktestPlugin strategy source validation", "[cpp_backtest][validation][regression]") {
    SECTION("accepts SDK, nonabt, and approved standard includes") {
        const std::string source = R"cpp(
#include <qnx_strategy_sdk/qnx_strategy_sdk.hpp>
#include <stratforge/strategy/strategy.hpp>
#include <vector>
#include <string>

class TestStrategy : public stratforge::Strategy {
public:
    void init() override {}
    void next() override {}
};
QNX_STRATEGY_FACTORY_EXPORT(TestStrategy)
)cpp";

        auto result = validateCppStrategySource(source);

        REQUIRE(result.valid);
        REQUIRE(result.errors.empty());
    }

    SECTION("rejects unsafe includes before compilation") {
        const std::string source = R"cpp(
#include <qnx_strategy_sdk/qnx_strategy_sdk.hpp>
#include <dlfcn.h>
#include "local_escape.hpp"
)cpp";

        auto result = validateCppStrategySource(source);

        REQUIRE_FALSE(result.valid);
        REQUIRE(result.errors.size() == 2);
        REQUIRE(result.errors[0].find("dlfcn.h") != std::string::npos);
        REQUIRE(result.errors[1].find("local quoted includes") != std::string::npos);
    }

    SECTION("rejects unsafe process and dynamic loading APIs") {
        const std::string source = R"cpp(
#include <cstdlib>
void escape() {
    std::system("whoami");
    dlopen("x", 0);
}
)cpp";

        auto result = validateCppStrategySource(source);

        REQUIRE_FALSE(result.valid);
        REQUIRE(result.errors.size() >= 2);
        REQUIRE(std::ranges::any_of(result.errors, [](const std::string& error) {
            return error.find("std::system") != std::string::npos;
        }));
        REQUIRE(std::ranges::any_of(result.errors, [](const std::string& error) {
            return error.find("dlopen") != std::string::npos;
        }));
    }

    SECTION("ignores unsafe tokens inside comments and string literals") {
        const std::string source = R"cpp(
#include <vector>
// std::system("whoami") in a comment is not executable code.
const char* note = "dlopen should not trigger inside a string";
)cpp";

        auto result = validateCppStrategySource(source);

        REQUIRE(result.valid);
        REQUIRE(result.errors.empty());
    }
}

TEST_CASE("CppBacktestPlugin Phase 4F hardening helpers", "[cpp_backtest][hardening]") {
    SECTION("artifact cache key changes with source, include paths, and PCH") {
        const std::string source = "class Strategy {};";
        const auto key = cppStrategyArtifactCacheKey(source, {"/opt/stratforge/include"}, "/tmp/nonabt.pch");

        REQUIRE(key.size() == 16);
        REQUIRE(key != cppStrategyArtifactCacheKey(source + "\n", {"/opt/stratforge/include"}, "/tmp/nonabt.pch"));
        REQUIRE(key != cppStrategyArtifactCacheKey(source, {"/other/include"}, "/tmp/nonabt.pch"));
        REQUIRE(key != cppStrategyArtifactCacheKey(source, {"/opt/stratforge/include"}, "/tmp/other.pch"));
    }

    SECTION("runner command applies resource limits and platform sandbox wrapper") {
        CppRunnerHardeningOptions options;
        options.enableSandbox = true;
        options.cpuTimeSeconds = 7;
        options.memoryLimitMb = 64;

        const std::string command = hardenCppRunnerCommand("stratforge-runner --strategy strategy.so", options);

#ifdef _WIN32
        REQUIRE(command == "stratforge-runner --strategy strategy.so");
#else
        REQUIRE(command.find("ulimit -t 7") != std::string::npos);
        REQUIRE(command.find("ulimit -v 65536") != std::string::npos);
    #ifdef __APPLE__
        REQUIRE(command.find("sandbox-exec") != std::string::npos);
    #else
        REQUIRE(command.find("setpriv --no-new-privs") != std::string::npos);
    #endif
#endif
    }

    SECTION("runner command can disable sandbox while keeping resource limits") {
        CppRunnerHardeningOptions options;
        options.enableSandbox = false;
        options.cpuTimeSeconds = 5;
        options.memoryLimitMb = 32;

        const std::string command = hardenCppRunnerCommand("stratforge-runner", options);

#ifndef _WIN32
        REQUIRE(command.find("ulimit -t 5") != std::string::npos);
        REQUIRE(command.find("ulimit -v 32768") != std::string::npos);
        REQUIRE(command.find("setpriv") == std::string::npos);
        REQUIRE(command.find("sandbox-exec") == std::string::npos);
#else
        REQUIRE(command == "stratforge-runner");
#endif
    }
}

// TICKET_681: ExecutorCore now delegates to CppBacktestPlugin
TEST_CASE("ExecutorCore construction", "[executor]") {
    // ExecutorCore should construct without error
    ExecutorCore executor;
    // Destructor should clean up properly
}
