// TICKET_794 Phase 1 -- stratforge-live-composer end-to-end test.
//
// Asserts the two Phase 1 gate items:
//   1. The fixture sma_3comp.json composes to a .so that loads via the same
//      dlopen path as live_engine_plugin.cpp:323-358 (ABI=2, all four
//      qnx_live_strategy_* symbols present) and produces a non-zero signal
//      count when driven by an inline 100-bar uptrend.
//   2. Composing the same fixture twice yields byte-identical .cpp source
//      (cache determinism witness per sec 7).

#define CATCH_CONFIG_MAIN
#include <catch2/catch_test_macros.hpp>

#include <dlfcn.h>
#include <sys/wait.h>
#include <unistd.h>

#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

// Composer binary path -- CMake passes it as a compile definition.
#ifndef QNX_LIVE_COMPOSER_BIN
#error "QNX_LIVE_COMPOSER_BIN must be defined at compile time"
#endif

// Fixture root -- CMake passes via compile definition.
#ifndef QNX_LIVE_COMPOSER_FIXTURE_DIR
#error "QNX_LIVE_COMPOSER_FIXTURE_DIR must be defined at compile time"
#endif

struct ComposerRun {
    int exitCode = 0;
    std::string stdoutText;
    std::string stderrText;
};

ComposerRun runComposer(const fs::path& inputJson,
                        const fs::path& outputSo,
                        const fs::path& cacheDir,
                        const std::string& extraEnv = {}) {
    const fs::path tmpStdout = cacheDir / "stdout.txt";
    const fs::path tmpStderr = cacheDir / "stderr.txt";

    std::ostringstream cmd;
    cmd << "QNX_LIVE_COMPOSER_CACHE_DIR='" << cacheDir.string() << "' "
        << extraEnv << (extraEnv.empty() ? "" : " ")
        << "'" << QNX_LIVE_COMPOSER_BIN << "'"
        << " --input '" << inputJson.string() << "'"
        << " --output '" << outputSo.string() << "'"
        << " >'" << tmpStdout.string() << "' 2>'" << tmpStderr.string() << "'";
    const int rc = std::system(cmd.str().c_str());

    ComposerRun result;
    result.exitCode = WIFEXITED(rc) ? WEXITSTATUS(rc) : rc;
    if (std::ifstream out(tmpStdout); out) {
        std::ostringstream ss;
        ss << out.rdbuf();
        result.stdoutText = ss.str();
    }
    if (std::ifstream err(tmpStderr); err) {
        std::ostringstream ss;
        ss << err.rdbuf();
        result.stderrText = ss.str();
    }
    return result;
}

std::string readFile(const fs::path& p) {
    std::ifstream in(p, std::ios::binary);
    REQUIRE(in.good());
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

struct LoadedStrategy {
    void* handle = nullptr;
    int (*abi_version)() = nullptr;
    void (*reset)() = nullptr;
    const char* (*on_bar)(const char*) = nullptr;
    const char* (*on_alt_data)(const char*) = nullptr;

    ~LoadedStrategy() {
        if (handle) ::dlclose(handle);
    }
};

LoadedStrategy loadLive(const fs::path& soPath) {
    LoadedStrategy s;
    s.handle = ::dlopen(soPath.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (s.handle == nullptr) {
        FAIL("dlopen failed: " << ::dlerror());
    }
    s.abi_version = reinterpret_cast<int (*)()>(
        ::dlsym(s.handle, "qnx_live_strategy_abi_version"));
    s.reset = reinterpret_cast<void (*)()>(
        ::dlsym(s.handle, "qnx_live_strategy_reset"));
    s.on_bar = reinterpret_cast<const char* (*)(const char*)>(
        ::dlsym(s.handle, "qnx_live_strategy_on_bar"));
    s.on_alt_data = reinterpret_cast<const char* (*)(const char*)>(
        ::dlsym(s.handle, "qnx_live_strategy_on_alt_data"));
    return s;
}

} // namespace

TEST_CASE("composer compiles sma_3comp fixture and load via dlopen", "[composer][phase1]") {
    const fs::path fixtureDir = QNX_LIVE_COMPOSER_FIXTURE_DIR;
    const fs::path fixture = fixtureDir / "sma_3comp.json";
    REQUIRE(fs::exists(fixture));

    // Per-test cache dir so reruns are clean and parallel-safe.
    const fs::path cacheDir = fs::temp_directory_path() /
        ("qnx-live-composer-test-" + std::to_string(::getpid()));
    fs::remove_all(cacheDir);
    fs::create_directories(cacheDir);

    const fs::path artifact = cacheDir / "sma_3comp.so";
    auto run = runComposer(fixture, artifact, cacheDir);
    INFO("composer stdout: " << run.stdoutText);
    INFO("composer stderr: " << run.stderrText);
    REQUIRE(run.exitCode == 0);
    REQUIRE(fs::exists(artifact));

    auto strat = loadLive(artifact);
    REQUIRE(strat.abi_version != nullptr);
    REQUIRE(strat.reset != nullptr);
    REQUIRE(strat.on_bar != nullptr);
    REQUIRE(strat.on_alt_data != nullptr);  // V2 requirement.
    REQUIRE(strat.abi_version() == 2);

    strat.reset();

    // 100-bar uptrend: close = 100 + i, so close > SMA(20) is true for i >= 20.
    // SmaCrossEntry fires once on edge false->true (i=20). After NBarExit's
    // hold_bars=5, exit fires, then condition stays true on a long uptrend so
    // no re-entry occurs (entry_condition_prev_ remains true after exit). That
    // is the documented sec 6.1 behaviour: re-entry requires the entry
    // condition to transition false->true again. We expect exactly 2 signals
    // (one entry, one exit) under this trivial uptrend.
    int signalCount = 0;
    int entryCount = 0;
    int exitCount = 0;
    char bar_json[256];
    for (int i = 0; i < 100; ++i) {
        const double close = 100.0 + i;
        std::snprintf(bar_json, sizeof(bar_json),
            R"({"t":%d000,"o":%.1f,"h":%.1f,"l":%.1f,"c":%.1f,"v":1,"bar_index":%d})",
            i, close - 0.5, close + 0.5, close - 0.5, close, i);
        const char* resp = strat.on_bar(bar_json);
        if (resp != nullptr && std::strlen(resp) > 0) {
            ++signalCount;
            const std::string s(resp);
            if (s.find("\"direction\":1") != std::string::npos) ++entryCount;
            if (s.find("\"direction\":-1") != std::string::npos) ++exitCount;
        }
    }
    INFO("signals=" << signalCount << " entry=" << entryCount << " exit=" << exitCount);
    REQUIRE(signalCount > 0);
    REQUIRE(entryCount == 1);
    REQUIRE(exitCount == 1);

    fs::remove_all(cacheDir);
}

// TICKET_1125 Phase 5 gate 1: golden codegen. The emitted .cpp bakes every
// parameter as a constexpr constant and contains no runtime JSON parameter
// parse (the former reset_from_json/g_params_json path).
TEST_CASE("composer bakes parameters as constexpr constants", "[composer][phase5][codegen]") {
    const fs::path fixtureDir = QNX_LIVE_COMPOSER_FIXTURE_DIR;
    const fs::path fixture = fixtureDir / "sma_3comp.json";
    REQUIRE(fs::exists(fixture));

    const fs::path cacheDir = fs::temp_directory_path() /
        ("qnx-live-composer-baked-" + std::to_string(::getpid()));
    fs::remove_all(cacheDir);
    fs::create_directories(cacheDir);

    const fs::path artifact = cacheDir / "baked.so";
    auto run = runComposer(fixture, artifact, cacheDir);
    INFO("composer stderr: " << run.stderrText);
    REQUIRE(run.exitCode == 0);

    std::string cppBytes;
    for (const auto& ent : fs::directory_iterator(cacheDir)) {
        if (ent.path().extension() == ".cpp") {
            cppBytes = readFile(ent.path());
            break;
        }
    }
    REQUIRE_FALSE(cppBytes.empty());

    // Baked constants present, with fixture values.
    CHECK(cppBytes.find("namespace qnx_baked_params") != std::string::npos);
    CHECK(cppBytes.find("inline constexpr std::uint64_t analysis_period = 20ULL;") != std::string::npos);
    CHECK(cppBytes.find("inline constexpr std::uint64_t exit_hold_bars = 5ULL;") != std::string::npos);
    CHECK(cppBytes.find("analysis_.set_params(qnx_baked_params::analysis_params())") != std::string::npos);
    CHECK(cppBytes.find("entry_.set_params(qnx_baked_params::entry_params())") != std::string::npos);
    CHECK(cppBytes.find("exit_.set_params(qnx_baked_params::exit_params())") != std::string::npos);

    // No runtime JSON parameter parse survives in the generated TU.
    CHECK(cppBytes.find("g_params_json") == std::string::npos);
    CHECK(cppBytes.find("reset_from_json") == std::string::npos);
    CHECK(cppBytes.find("nlohmann::json::parse") == std::string::npos);

    fs::remove_all(cacheDir);
}

// TICKET_1125 Phase 5 gate 3: all-types baking. Every ParamBaker branch --
// unsigned (incl. UINT64_MAX), signed (incl. INT64_MIN), double, bool, string
// escaping, null, nested object, array, empty containers, and identifier
// collision suffixing -- has a golden witness, and the composed .so still
// behaves identically (SmaAnalysis::set_params ignores the extra keys).
TEST_CASE("composer bakes every JSON parameter type", "[composer][phase5][codegen]") {
    const fs::path fixtureDir = QNX_LIVE_COMPOSER_FIXTURE_DIR;
    const fs::path fixture = fixtureDir / "baked_params_all_types.json";
    REQUIRE(fs::exists(fixture));

    const fs::path cacheDir = fs::temp_directory_path() /
        ("qnx-live-composer-alltypes-" + std::to_string(::getpid()));
    fs::remove_all(cacheDir);
    fs::create_directories(cacheDir);

    const fs::path artifact = cacheDir / "alltypes.so";
    auto run = runComposer(fixture, artifact, cacheDir);
    INFO("composer stderr: " << run.stderrText);
    REQUIRE(run.exitCode == 0);

    std::string cppBytes;
    for (const auto& ent : fs::directory_iterator(cacheDir)) {
        if (ent.path().extension() == ".cpp") {
            cppBytes = readFile(ent.path());
            break;
        }
    }
    REQUIRE_FALSE(cppBytes.empty());

    // Scalar leaves: type mirrors nlohmann storage; integer literals carry
    // strict-conformance suffixes; INT64_MIN is an expression, not a literal.
    CHECK(cppBytes.find("inline constexpr std::uint64_t analysis_period = 20ULL;") != std::string::npos);
    CHECK(cppBytes.find("inline constexpr std::uint64_t analysis_u64max = 18446744073709551615ULL;") != std::string::npos);
    CHECK(cppBytes.find("inline constexpr std::int64_t analysis_neg = -3LL;") != std::string::npos);
    CHECK(cppBytes.find("inline constexpr std::int64_t analysis_i64min = (-9223372036854775807LL - 1);") != std::string::npos);
    CHECK(cppBytes.find("inline constexpr double analysis_ratio = 0.75;") != std::string::npos);
    CHECK(cppBytes.find("inline constexpr bool analysis_flag = true;") != std::string::npos);
    CHECK(cppBytes.find("inline constexpr std::string_view analysis_label = \"fast \\\"sma\\\"\\n\";") != std::string::npos);

    // Identifier collision: "weird key!" sanitizes to weird_key_, colliding
    // with the literal key "weird_key_" -- stable numeric suffix resolves it.
    CHECK(cppBytes.find("inline constexpr std::uint64_t analysis_weird_key_ = 1ULL;") != std::string::npos);
    CHECK(cppBytes.find("inline constexpr std::uint64_t analysis_weird_key__2 = 2ULL;") != std::string::npos);

    // Builder: containers rebuilt structurally, null and empties preserved.
    CHECK(cppBytes.find("j[\"nested\"][\"a\"][\"b\"] = analysis_nested_a_b;") != std::string::npos);
    CHECK(cppBytes.find("j[\"arr\"][0] = analysis_arr_0;") != std::string::npos);
    CHECK(cppBytes.find("j[\"arr\"][1] = analysis_arr_1;") != std::string::npos);
    CHECK(cppBytes.find("j[\"arr\"][2] = analysis_arr_2;") != std::string::npos);
    CHECK(cppBytes.find("j[\"nothing\"] = nullptr;") != std::string::npos);
    CHECK(cppBytes.find("j[\"empty_obj\"] = nlohmann::json::object();") != std::string::npos);
    CHECK(cppBytes.find("j[\"empty_arr\"] = nlohmann::json::array();") != std::string::npos);

    // The composed .so loads and behaves identically to sma_3comp: one entry
    // signal on a 30-bar uptrend (extra baked params are ignored).
    REQUIRE(fs::exists(artifact));
    auto strat = loadLive(artifact);
    REQUIRE(strat.abi_version != nullptr);
    REQUIRE(strat.abi_version() == 2);
    REQUIRE(strat.reset != nullptr);
    REQUIRE(strat.on_bar != nullptr);
    strat.reset();
    int entryCount = 0;
    char bar_json[256];
    for (int i = 0; i < 30; ++i) {
        const double close = 100.0 + i;
        std::snprintf(bar_json, sizeof(bar_json),
            R"({"t":%d000,"o":%.1f,"h":%.1f,"l":%.1f,"c":%.1f,"v":1,"bar_index":%d})",
            i, close - 0.5, close + 0.5, close - 0.5, close, i);
        const char* resp = strat.on_bar(bar_json);
        if (resp != nullptr && std::strstr(resp, "\"direction\":1") != nullptr) {
            ++entryCount;
        }
    }
    CHECK(entryCount == 1);

    fs::remove_all(cacheDir);
}

// TICKET_1125 Phase 5 gate 2: flag matrix. The strategy .so compiles with the
// aligned flag set (-O3 -flto), -march=native toggles via the native-arch
// switch, and the flag set is part of the cache key (two distinct .cpp cache
// entries for identical input under different flags).
TEST_CASE("composer strategy flags align and native arch toggles", "[composer][phase5][flags]") {
    const fs::path fixtureDir = QNX_LIVE_COMPOSER_FIXTURE_DIR;
    const fs::path fixture = fixtureDir / "sma_3comp.json";
    REQUIRE(fs::exists(fixture));

    const fs::path cacheDir = fs::temp_directory_path() /
        ("qnx-live-composer-flags-" + std::to_string(::getpid()));
    fs::remove_all(cacheDir);
    fs::create_directories(cacheDir);

    const fs::path nativeSo = cacheDir / "native.so";
    auto nativeRun = runComposer(fixture, nativeSo, cacheDir,
                                 "QNX_LIVE_COMPOSER_NATIVE_ARCH=1");
    INFO("native composer stderr: " << nativeRun.stderrText);
    REQUIRE(nativeRun.exitCode == 0);
    CHECK(nativeRun.stdoutText.find("-O3") != std::string::npos);
    CHECK(nativeRun.stdoutText.find("-flto") != std::string::npos);
    CHECK(nativeRun.stdoutText.find("-march=native") != std::string::npos);

    const fs::path portableSo = cacheDir / "portable.so";
    auto portableRun = runComposer(fixture, portableSo, cacheDir,
                                   "QNX_LIVE_COMPOSER_NATIVE_ARCH=0");
    INFO("portable composer stderr: " << portableRun.stderrText);
    REQUIRE(portableRun.exitCode == 0);
    CHECK(portableRun.stdoutText.find("-O3") != std::string::npos);
    CHECK(portableRun.stdoutText.find("-flto") != std::string::npos);
    CHECK(portableRun.stdoutText.find("-march=native") == std::string::npos);

    // Flags are part of the cache key: identical input, different flags ->
    // two distinct .cpp cache entries.
    std::size_t cppCount = 0;
    for (const auto& ent : fs::directory_iterator(cacheDir)) {
        if (ent.path().extension() == ".cpp") ++cppCount;
    }
    CHECK(cppCount == 2);

    // Both artifacts compile-and-run: dlopen, V2 ABI, one entry signal on a
    // 30-bar uptrend.
    for (const fs::path& so : {nativeSo, portableSo}) {
        REQUIRE(fs::exists(so));
        auto strat = loadLive(so);
        REQUIRE(strat.abi_version != nullptr);
        REQUIRE(strat.abi_version() == 2);
        REQUIRE(strat.reset != nullptr);
        REQUIRE(strat.on_bar != nullptr);
        strat.reset();
        int entryCount = 0;
        char bar_json[256];
        for (int i = 0; i < 30; ++i) {
            const double close = 100.0 + i;
            std::snprintf(bar_json, sizeof(bar_json),
                R"({"t":%d000,"o":%.1f,"h":%.1f,"l":%.1f,"c":%.1f,"v":1,"bar_index":%d})",
                i, close - 0.5, close + 0.5, close - 0.5, close, i);
            const char* resp = strat.on_bar(bar_json);
            if (resp != nullptr && std::strstr(resp, "\"direction\":1") != nullptr) {
                ++entryCount;
            }
        }
        CHECK(entryCount == 1);
    }

    fs::remove_all(cacheDir);
}

TEST_CASE("composer emits deterministic .cpp source", "[composer][phase1][cache]") {
    const fs::path fixtureDir = QNX_LIVE_COMPOSER_FIXTURE_DIR;
    const fs::path fixture = fixtureDir / "sma_3comp.json";
    REQUIRE(fs::exists(fixture));

    auto compose_once = [&](const fs::path& cacheDir) -> std::string {
        fs::remove_all(cacheDir);
        fs::create_directories(cacheDir);
        const fs::path artifact = cacheDir / "out.so";
        auto run = runComposer(fixture, artifact, cacheDir);
        INFO("composer stderr: " << run.stderrText);
        REQUIRE(run.exitCode == 0);
        // The composer writes <cacheKey>.cpp into the cache dir alongside the
        // .so; locate it and return its bytes.
        std::string cppBytes;
        for (const auto& ent : fs::directory_iterator(cacheDir)) {
            if (ent.path().extension() == ".cpp") {
                cppBytes = readFile(ent.path());
                break;
            }
        }
        REQUIRE_FALSE(cppBytes.empty());
        return cppBytes;
    };

    const fs::path cacheA = fs::temp_directory_path() /
        ("qnx-live-composer-detA-" + std::to_string(::getpid()));
    const fs::path cacheB = fs::temp_directory_path() /
        ("qnx-live-composer-detB-" + std::to_string(::getpid()));

    const std::string srcA = compose_once(cacheA);
    const std::string srcB = compose_once(cacheB);
    REQUIRE(srcA == srcB);

    fs::remove_all(cacheA);
    fs::remove_all(cacheB);
}
