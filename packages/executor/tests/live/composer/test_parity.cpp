// TICKET_794 Phase 2 -- C++ side of the parity harness.
//
// Composes a 3-component C++ fixture via stratforge-live-composer, dlopens the
// resulting .so, replays a CSV bar stream through qnx_live_strategy_on_bar,
// and writes one JSONL signal event per non-empty on_bar response to the path
// in QNX_LIVE_PARITY_OUT.
//
// This is consumed by tools/scripts/live_parity_diff.py which runs the Python
// reference path against the same CSV and diffs the two JSONL streams per
// TICKET_794 sec 8 step 3.
//
// Env vars (all required):
//   QNX_LIVE_PARITY_FIXTURE_JSON  -- composer input JSON path
//   QNX_LIVE_PARITY_BAR_CSV       -- CSV: ts_ms,open,high,low,close,volume
//   QNX_LIVE_PARITY_OUT           -- output JSONL path
//
// CMake injects QNX_LIVE_COMPOSER_BIN. The test self-skips (via Catch2 SKIP)
// when the CSV fixture is missing, so the CI gate is "fail loud iff CSV
// present and parity broken".

#define CATCH_CONFIG_MAIN
#include <catch2/catch_test_macros.hpp>

#include <dlfcn.h>
#include <sys/wait.h>
#include <unistd.h>

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

#ifndef QNX_LIVE_COMPOSER_BIN
#error "QNX_LIVE_COMPOSER_BIN must be defined at compile time"
#endif

const char* env_or_null(const char* name) {
    const char* v = std::getenv(name);
    return (v != nullptr && v[0] != '\0') ? v : nullptr;
}

struct Bar {
    long long ts_ms = 0;
    double o = 0.0;
    double h = 0.0;
    double l = 0.0;
    double c = 0.0;
    double v = 0.0;
};

std::vector<Bar> read_csv(const fs::path& path) {
    std::vector<Bar> out;
    std::ifstream in(path);
    REQUIRE(in.good());
    std::string line;
    // Header.
    std::getline(in, line);
    while (std::getline(in, line)) {
        if (line.empty()) continue;
        Bar b;
        // ts_ms,open,high,low,close,volume
        std::string cell;
        std::istringstream ss(line);
        std::getline(ss, cell, ','); b.ts_ms = std::stoll(cell);
        std::getline(ss, cell, ','); b.o = std::stod(cell);
        std::getline(ss, cell, ','); b.h = std::stod(cell);
        std::getline(ss, cell, ','); b.l = std::stod(cell);
        std::getline(ss, cell, ','); b.c = std::stod(cell);
        std::getline(ss, cell, ','); b.v = std::stod(cell);
        out.push_back(b);
    }
    return out;
}

int run_cmd(const std::string& cmd, std::string& stderr_capture) {
    const fs::path err_tmp = fs::temp_directory_path() /
        ("qnx-live-parity-err-" + std::to_string(::getpid()) + ".txt");
    const std::string wrapped = cmd + " 2>'" + err_tmp.string() + "'";
    const int rc = std::system(wrapped.c_str());
    std::ifstream in(err_tmp);
    if (in) {
        std::ostringstream ss;
        ss << in.rdbuf();
        stderr_capture = ss.str();
    }
    fs::remove(err_tmp);
    return WIFEXITED(rc) ? WEXITSTATUS(rc) : rc;
}

struct LoadedStrategy {
    void* handle = nullptr;
    int (*abi_version)() = nullptr;
    void (*reset)() = nullptr;
    const char* (*on_bar)(const char*) = nullptr;

    ~LoadedStrategy() { if (handle) ::dlclose(handle); }
};

LoadedStrategy load_so(const fs::path& so_path) {
    LoadedStrategy s;
    s.handle = ::dlopen(so_path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!s.handle) FAIL("dlopen failed: " << ::dlerror());
    s.abi_version = reinterpret_cast<int (*)()>(::dlsym(s.handle, "qnx_live_strategy_abi_version"));
    s.reset = reinterpret_cast<void (*)()>(::dlsym(s.handle, "qnx_live_strategy_reset"));
    s.on_bar = reinterpret_cast<const char* (*)(const char*)>(::dlsym(s.handle, "qnx_live_strategy_on_bar"));
    REQUIRE(s.abi_version != nullptr);
    REQUIRE(s.reset != nullptr);
    REQUIRE(s.on_bar != nullptr);
    REQUIRE(s.abi_version() == 2);
    return s;
}

} // namespace

TEST_CASE("composed C++ strategy replays bar CSV to JSONL", "[composer][phase2][parity]") {
    const char* fixture_json = env_or_null("QNX_LIVE_PARITY_FIXTURE_JSON");
    const char* bar_csv = env_or_null("QNX_LIVE_PARITY_BAR_CSV");
    const char* out_jsonl = env_or_null("QNX_LIVE_PARITY_OUT");

    if (!fixture_json || !bar_csv || !out_jsonl) {
        SKIP("QNX_LIVE_PARITY_{FIXTURE_JSON,BAR_CSV,OUT} not set -- driven by live_parity_diff.py");
    }
    if (!fs::exists(bar_csv)) {
        SKIP("Bar CSV missing (run tools/scripts/capture_okx_btc_usdt_1m_10d.py): " << bar_csv);
    }
    REQUIRE(fs::exists(fixture_json));

    const fs::path cache_dir = fs::temp_directory_path() /
        ("qnx-live-parity-cache-" + std::to_string(::getpid()));
    fs::remove_all(cache_dir);
    fs::create_directories(cache_dir);

    const fs::path artifact = cache_dir / "parity.so";
    std::ostringstream compose_cmd;
    compose_cmd << "QNX_LIVE_COMPOSER_CACHE_DIR='" << cache_dir.string() << "' "
                << "'" << QNX_LIVE_COMPOSER_BIN << "'"
                << " --input '" << fixture_json << "'"
                << " --output '" << artifact.string() << "'"
                << " >/dev/null";
    std::string err;
    const int rc = run_cmd(compose_cmd.str(), err);
    INFO("composer stderr: " << err);
    REQUIRE(rc == 0);
    REQUIRE(fs::exists(artifact));

    auto strat = load_so(artifact);
    strat.reset();

    const auto bars = read_csv(bar_csv);
    REQUIRE_FALSE(bars.empty());

    std::ofstream out(out_jsonl, std::ios::trunc);
    REQUIRE(out.good());

    char bar_json[256];
    std::size_t signal_count = 0;
    for (std::size_t i = 0; i < bars.size(); ++i) {
        const Bar& b = bars[i];
        std::snprintf(bar_json, sizeof(bar_json),
            R"({"t":%lld,"o":%.8f,"h":%.8f,"l":%.8f,"c":%.8f,"v":%.8f,"bar_index":%zu})",
            b.ts_ms, b.o, b.h, b.l, b.c, b.v, i);
        const char* resp = strat.on_bar(bar_json);
        if (resp == nullptr || resp[0] == '\0') continue;
        // Emit one JSONL line per non-empty signal response. The Python diff
        // tool parses the embedded direction/value fields.
        out << "{\"bar_index\":" << i
            << ",\"ts_ms\":" << b.ts_ms
            << ",\"raw\":" << resp << "}\n";
        ++signal_count;
    }
    out.close();

    INFO("emitted " << signal_count << " signal lines to " << out_jsonl);
    REQUIRE(fs::exists(out_jsonl));
    // Non-zero stream is required so the Python diff has something to compare.
    REQUIRE(signal_count > 0);

    fs::remove_all(cache_dir);
}
