/**
 * LiveEnginePlugin alt_data branch tests (TICKET_196_7_7 P2.1).
 *
 * Three contracts pinned here:
 *
 *   1. Valid alt_data stdin line is forwarded to cpp_on_alt_data_ verbatim
 *      via row.dump(); the captured payload round-trips through nlohmann::json
 *      and matches the orchestrator-emitted shape (provider_id, series_id,
 *      event_time, knowledge_time, value).
 *
 *   2. alt_data with a missing required field surfaces a structured error
 *      event on stdout with `code == "ALT_DATA_INVALID"`; cpp_on_alt_data_ is
 *      NOT called. Per CLAUDE.md "NO SILENT FAILURES" -- the orchestrator
 *      must be able to surface this through useMessage without parsing
 *      free-form text.
 *
 *   3. alt_data delivered to a strategy with no `qnx_live_strategy_on_alt_data`
 *      (i.e. ABI v1, where cpp_on_alt_data_ stays null) is dropped with a
 *      stderr log -- no stdout emission, no exception. Confirms v1 strategies
 *      keep working unchanged when the orchestrator routes alt-data to them
 *      (which should not happen, but the engine must not crash if it does).
 *
 * The test bypasses the .so load path by injecting a fake function pointer
 * via `LiveEngineTestSeam`. This is the minimum seam that lets the dispatch
 * logic be unit-tested without compiling and dlopening a test strategy.
 *
 * NOTE: TICKET_196_7_7 P2.2 (TS orchestrator + IPC) is deferred -- no
 * live-engine subprocess spawner exists on the TS side yet (audit finding in
 * the ticket "Implementation design" section). When P2.2 lands, an
 * integration test driving a real subprocess will join this file.
 */

#include <catch2/catch_test_macros.hpp>

#include "quantnexus/executor/live/live_engine_plugin.hpp"

#include <nlohmann/json.hpp>

#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace StratCraft::executor::live {

// Test seam: lets the test set the dlsym'd function pointer fields directly,
// bypassing the .so load path entirely. Declared as a friend struct in
// live_engine_plugin.hpp; defined here so its dependencies (the fake function
// trampolines) stay local to the test translation unit.
struct LiveEngineTestSeam {
    static void setOnAltData(LiveEnginePlugin& p, LiveEnginePlugin::CppOnAltDataFn fn) {
        p.cpp_on_alt_data_ = fn;
    }
    static void clearOnAltData(LiveEnginePlugin& p) {
        p.cpp_on_alt_data_ = nullptr;
    }
    static void runEventLoop(LiveEnginePlugin& p, std::istream& in) {
        p.eventLoop(in);
    }
};

namespace {

// Capture for the most recent payload the fake `on_alt_data` saw, plus a
// counter. File-scope state because the dlsym'd function pointer is a plain
// C function pointer -- no captures, no std::function.
struct FakeOnAltDataCapture {
    int call_count = 0;
    std::string last_payload;
    std::vector<std::string> payloads;   // every payload, in arrival order
    std::string response_to_return;  // empty -> return nullptr
};

FakeOnAltDataCapture g_fake_capture;

const char* fakeOnAltData(const char* json_in) {
    g_fake_capture.call_count += 1;
    const std::string body = json_in ? std::string(json_in) : std::string{};
    g_fake_capture.last_payload = body;
    g_fake_capture.payloads.push_back(body);
    return g_fake_capture.response_to_return.empty()
        ? nullptr
        : g_fake_capture.response_to_return.c_str();
}

// stdout interceptor: redirect std::cout to a stringstream for the duration
// of an expression. Matches what `eventLoop()` writes via `std::cout`.
class StdoutCapture {
public:
    StdoutCapture() : old_buf_(std::cout.rdbuf(captured_.rdbuf())) {}
    ~StdoutCapture() { std::cout.rdbuf(old_buf_); }
    std::string str() const { return captured_.str(); }
private:
    std::stringstream captured_;
    std::streambuf* old_buf_;
};

// Build a valid alt_data stdin line that mirrors the AlternativeFactorRow
// JSON shape (TICKET_196_7_7 P2.1 wire format).
std::string makeAltDataLine(
    const std::string& provider_id,
    const std::string& series_id,
    const std::string& event_time,
    const std::string& knowledge_time,
    double value)
{
    nlohmann::json msg;
    msg["type"] = "alt_data";
    msg["data"]["provider_id"] = provider_id;
    msg["data"]["series_id"] = series_id;
    msg["data"]["category"] = "macro";
    msg["data"]["event_time"] = event_time;
    msg["data"]["knowledge_time"] = knowledge_time;
    msg["data"]["value"] = value;
    return msg.dump() + "\n";
}

}  // namespace

TEST_CASE("eventLoop forwards valid alt_data row to cpp_on_alt_data_", "[live][alt_data]") {
    g_fake_capture = FakeOnAltDataCapture{};

    LiveEnginePlugin plugin;
    LiveEngineTestSeam::setOnAltData(plugin, &fakeOnAltData);

    std::stringstream in;
    in << makeAltDataLine("fred", "CPIAUCSL",
                          "2026-05-01T00:00:00Z",
                          "2026-05-13T12:30:00Z",
                          312.41);
    // Terminate the loop -- without a shutdown the loop blocks on getline().
    in << "{\"type\":\"shutdown\"}\n";

    StdoutCapture captured;
    LiveEngineTestSeam::runEventLoop(plugin, in);

    REQUIRE(g_fake_capture.call_count == 1);
    auto parsed = nlohmann::json::parse(g_fake_capture.last_payload);
    REQUIRE(parsed.at("provider_id").get<std::string>() == "fred");
    REQUIRE(parsed.at("series_id").get<std::string>() == "CPIAUCSL");
    REQUIRE(parsed.at("event_time").get<std::string>() == "2026-05-01T00:00:00Z");
    REQUIRE(parsed.at("knowledge_time").get<std::string>() == "2026-05-13T12:30:00Z");
    REQUIRE(parsed.at("value").get<double>() == 312.41);
}

TEST_CASE("eventLoop emits ALT_DATA_INVALID when required field missing", "[live][alt_data]") {
    g_fake_capture = FakeOnAltDataCapture{};

    LiveEnginePlugin plugin;
    LiveEngineTestSeam::setOnAltData(plugin, &fakeOnAltData);

    // Missing `value`.
    nlohmann::json msg;
    msg["type"] = "alt_data";
    msg["data"]["provider_id"] = "fred";
    msg["data"]["series_id"] = "CPIAUCSL";
    msg["data"]["event_time"] = "2026-05-01T00:00:00Z";
    msg["data"]["knowledge_time"] = "2026-05-13T12:30:00Z";

    std::stringstream in;
    in << msg.dump() << "\n";
    in << "{\"type\":\"shutdown\"}\n";

    StdoutCapture captured;
    LiveEngineTestSeam::runEventLoop(plugin, in);

    // cpp_on_alt_data_ must NOT have been called.
    REQUIRE(g_fake_capture.call_count == 0);

    // First stdout line is the ALT_DATA_INVALID error event.
    const std::string out = captured.str();
    const auto first_newline = out.find('\n');
    REQUIRE(first_newline != std::string::npos);
    const auto err = nlohmann::json::parse(out.substr(0, first_newline));
    REQUIRE(err.at("type").get<std::string>() == "error");
    REQUIRE(err.at("data").at("code").get<std::string>() == "ALT_DATA_INVALID");
    REQUIRE(err.at("data").at("message").get<std::string>().find("value") != std::string::npos);
}

TEST_CASE("eventLoop drops alt_data for ABI v1 strategy (no on_alt_data_)", "[live][alt_data]") {
    g_fake_capture = FakeOnAltDataCapture{};

    LiveEnginePlugin plugin;
    LiveEngineTestSeam::clearOnAltData(plugin);  // v1 strategy: no symbol exported

    std::stringstream in;
    in << makeAltDataLine("fred", "CPIAUCSL",
                          "2026-05-01T00:00:00Z",
                          "2026-05-13T12:30:00Z",
                          312.41);
    in << "{\"type\":\"shutdown\"}\n";

    StdoutCapture captured;
    LiveEngineTestSeam::runEventLoop(plugin, in);

    REQUIRE(g_fake_capture.call_count == 0);

    // Only stdout output should be the shutdown_ack -- no error event for the
    // dropped alt_data row (intentional: orchestrator-side mis-routing is
    // logged to stderr, not surfaced as a user-facing engine error).
    const std::string out = captured.str();
    const auto first_newline = out.find('\n');
    REQUIRE(first_newline != std::string::npos);
    const auto first = nlohmann::json::parse(out.substr(0, first_newline));
    REQUIRE(first.at("type").get<std::string>() == "shutdown_ack");
}

TEST_CASE("eventLoop forwards non-empty cpp_on_alt_data_ response to stdout", "[live][alt_data]") {
    g_fake_capture = FakeOnAltDataCapture{};
    g_fake_capture.response_to_return = R"({"type":"signal","data":{"direction":1,"value":0.7}})";

    LiveEnginePlugin plugin;
    LiveEngineTestSeam::setOnAltData(plugin, &fakeOnAltData);

    std::stringstream in;
    in << makeAltDataLine("fred", "CPIAUCSL",
                          "2026-05-01T00:00:00Z",
                          "2026-05-13T12:30:00Z",
                          312.41);
    in << "{\"type\":\"shutdown\"}\n";

    StdoutCapture captured;
    LiveEngineTestSeam::runEventLoop(plugin, in);

    REQUIRE(g_fake_capture.call_count == 1);

    const std::string out = captured.str();
    const auto first_newline = out.find('\n');
    REQUIRE(first_newline != std::string::npos);
    const auto resp = nlohmann::json::parse(out.substr(0, first_newline));
    REQUIRE(resp.at("type").get<std::string>() == "signal");
    REQUIRE(resp.at("data").at("direction").get<int>() == 1);
}

TEST_CASE("eventLoop surfaces ALT_DATA_RESPONSE_INVALID on malformed strategy response", "[live][alt_data]") {
    g_fake_capture = FakeOnAltDataCapture{};
    g_fake_capture.response_to_return = "this is not json";

    LiveEnginePlugin plugin;
    LiveEngineTestSeam::setOnAltData(plugin, &fakeOnAltData);

    std::stringstream in;
    in << makeAltDataLine("fred", "CPIAUCSL",
                          "2026-05-01T00:00:00Z",
                          "2026-05-13T12:30:00Z",
                          312.41);
    in << "{\"type\":\"shutdown\"}\n";

    StdoutCapture captured;
    LiveEngineTestSeam::runEventLoop(plugin, in);

    REQUIRE(g_fake_capture.call_count == 1);

    const std::string out = captured.str();
    const auto first_newline = out.find('\n');
    REQUIRE(first_newline != std::string::npos);
    const auto err = nlohmann::json::parse(out.substr(0, first_newline));
    REQUIRE(err.at("type").get<std::string>() == "error");
    REQUIRE(err.at("data").at("code").get<std::string>() == "ALT_DATA_RESPONSE_INVALID");
}

// TICKET_196_7_7 P7(b): the engine's no-look-ahead contract has two halves.
// The TS bridge (out of scope for this repo per CLAUDE.md / user memory; lives
// in StratCraft-ccxt host) is responsible for emitting rows in non-decreasing
// knowledge_time order. The engine's half of the contract is that it forwards
// rows to cpp_on_alt_data_ in stdin order with no buffering / reordering, and
// preserves the exact JSON body the orchestrator emitted. This case pins that
// engine-side guarantee.
TEST_CASE("eventLoop forwards multiple alt_data rows to cpp_on_alt_data_ in stdin order", "[live][alt_data]") {
    g_fake_capture = FakeOnAltDataCapture{};

    LiveEnginePlugin plugin;
    LiveEngineTestSeam::setOnAltData(plugin, &fakeOnAltData);

    std::stringstream in;
    // Three FRED-shaped rows with strictly increasing knowledge_time.
    in << makeAltDataLine("fred", "CPIAUCSL",
                          "2026-03-01T00:00:00Z", "2026-03-13T12:30:00Z", 310.10);
    in << makeAltDataLine("fred", "CPIAUCSL",
                          "2026-04-01T00:00:00Z", "2026-04-10T12:30:00Z", 311.20);
    in << makeAltDataLine("fred", "CPIAUCSL",
                          "2026-05-01T00:00:00Z", "2026-05-13T12:30:00Z", 312.41);
    in << "{\"type\":\"shutdown\"}\n";

    StdoutCapture captured;
    LiveEngineTestSeam::runEventLoop(plugin, in);

    REQUIRE(g_fake_capture.call_count == 3);
    REQUIRE(g_fake_capture.payloads.size() == 3);

    // Strict ordering: the engine does NOT reorder, defer, or coalesce rows.
    // knowledge_time of each successive call must be strictly greater than the
    // previous one (regression guard against an accidental buffer/sort).
    const auto p0 = nlohmann::json::parse(g_fake_capture.payloads[0]);
    const auto p1 = nlohmann::json::parse(g_fake_capture.payloads[1]);
    const auto p2 = nlohmann::json::parse(g_fake_capture.payloads[2]);
    REQUIRE(p0.at("knowledge_time").get<std::string>() == "2026-03-13T12:30:00Z");
    REQUIRE(p1.at("knowledge_time").get<std::string>() == "2026-04-10T12:30:00Z");
    REQUIRE(p2.at("knowledge_time").get<std::string>() == "2026-05-13T12:30:00Z");
    REQUIRE(p0.at("value").get<double>() == 310.10);
    REQUIRE(p1.at("value").get<double>() == 311.20);
    REQUIRE(p2.at("value").get<double>() == 312.41);
}

}  // namespace StratCraft::executor::live
