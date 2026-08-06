// TICKET_1292_15 Phase 5 5C (MC-15): C++ code-version owner parity + boundary.
//
// Proves the pure C++ code-version owner (code_version.hpp + its JSON bridge)
// reproduces the Python authority value-identically:
//
//   - The Tool Sweep cache-key code_version (TICKET_815) for every registered
//     template vs the golden fixture code_version_parity_v1.json captured from
//     the live Python module code_version.py BEFORE the rewire. The fixture
//     pins the 64-hex codeVersion, its two component hashes, the source-file
//     count, and the lockfile basename -- proving the C++ static import-closure
//     scan + SHA-256 aggregation is byte-identical to the AST walk it removes.
//
// Plus boundary asserts required by the ticket: unknown template (hard error),
// malformed request (missing/wrong-typed fields), version mismatch, and cross-
// layer agreement (the same envelope is produced through the JSON command).
//
// QNX_SOURCE_ROOT lets the test resolve packages/nona-algorithm as the real
// packageParent so the closure walks the live source tree, exactly as the
// packaged command does in production.

#include "quantnexus/executor/code_version/code_version.hpp"
#include "quantnexus/executor/code_version/code_version_json.hpp"

#include <catch2/catch_test_macros.hpp>

#include <filesystem>
#include <fstream>
#include <string>

#include <nlohmann/json.hpp>

namespace cv = StratCraft::executor::code_version;
namespace fs = std::filesystem;

namespace {

const fs::path kPackageParent = fs::path{QNX_SOURCE_ROOT} / "packages/nona-algorithm";
const fs::path kFixture = fs::path{QNX_SOURCE_ROOT} /
    "packages/executor/tests/fixtures/code_version_parity_v1.json";

nlohmann::json load(const fs::path& p) {
    std::ifstream f(p);
    REQUIRE(f.is_open());
    nlohmann::json doc;
    f >> doc;
    return doc;
}

}  // namespace

TEST_CASE("code_version parity: every template matches the Python golden fixture",
          "[code_version][parity]") {
    const nlohmann::json fixture = load(kFixture);
    REQUIRE(fixture.at("version").get<int>() == 1);
    const auto& cases = fixture.at("cases");
    REQUIRE(cases.is_array());
    REQUIRE(!cases.empty());

    // Every registered template must be represented (no silent coverage gap).
    REQUIRE(cases.size() == cv::templateModuleTable().size());

    for (const auto& c : cases) {
        const std::string templateId = c.at("templateId").get<std::string>();
        INFO("template=" << templateId);

        const cv::CodeVersionResult result =
            cv::computeCodeVersion(templateId, kPackageParent);

        // The parity-critical value: the 64-hex cache key.
        CHECK(result.codeVersion == c.at("codeVersion").get<std::string>());
        CHECK(result.codeVersion.size() == 64);
        // Component hashes.
        CHECK(result.sourceFilesSha256 == c.at("sourceFilesSha256").get<std::string>());
        CHECK(result.lockfileSha256 == c.at("lockfileSha256").get<std::string>());
        // Closure size (observability field the [CACHE-KEY] log line reports).
        CHECK(result.sourceFileCount == c.at("sourceFileCount").get<int>());
        // Lockfile basename (abs path is machine-specific; basename is pinned).
        CHECK(fs::path{result.lockfilePath}.filename().string() ==
              c.at("lockfileBasename").get<std::string>());
    }
}

TEST_CASE("code_version JSON command produces the same envelope",
          "[code_version][json]") {
    const nlohmann::json request{
        {"version", 1},
        {"templateId", "hmm_regime_v1"},
        {"packageParent", kPackageParent.string()},
    };
    const nlohmann::json out = cv::run_code_version(request);
    CHECK(out.at("version").get<int>() == 1);
    CHECK(out.at("codeVersion").get<std::string>().size() == 64);

    // Must equal the direct-call result (no divergence across the JSON boundary).
    const cv::CodeVersionResult direct =
        cv::computeCodeVersion("hmm_regime_v1", kPackageParent);
    CHECK(out.at("codeVersion").get<std::string>() == direct.codeVersion);
    CHECK(out.at("sourceFilesSha256").get<std::string>() == direct.sourceFilesSha256);
    CHECK(out.at("lockfileSha256").get<std::string>() == direct.lockfileSha256);
    CHECK(out.at("sourceFileCount").get<int>() == direct.sourceFileCount);
}

TEST_CASE("code_version determinism: repeated computes are byte-identical",
          "[code_version][determinism]") {
    const cv::CodeVersionResult a = cv::computeCodeVersion("xgboost_return_v3", kPackageParent);
    const cv::CodeVersionResult b = cv::computeCodeVersion("xgboost_return_v3", kPackageParent);
    CHECK(a.codeVersion == b.codeVersion);
    CHECK(a.sourceFileCount == b.sourceFileCount);
}

TEST_CASE("code_version per-template closures are distinct (no shared-closure bug)",
          "[code_version][closure]") {
    // HMM and n-gram must NOT collapse to the same closure/hash: that was the
    // bug the per-template module table exists to prevent (TICKET_815 Q3).
    const cv::CodeVersionResult hmm = cv::computeCodeVersion("hmm_regime_v1", kPackageParent);
    const cv::CodeVersionResult ngram = cv::computeCodeVersion("ngram_next_bar_v1", kPackageParent);
    CHECK(hmm.sourceFilesSha256 != ngram.sourceFilesSha256);
    CHECK(hmm.codeVersion != ngram.codeVersion);
}

TEST_CASE("code_version boundary: unknown template is a hard error",
          "[code_version][error]") {
    CHECK_THROWS_AS(
        cv::computeCodeVersion("no_such_template_xyz", kPackageParent),
        std::runtime_error);
}

TEST_CASE("code_version JSON boundary: malformed requests fail fast",
          "[code_version][error]") {
    // Non-object request.
    CHECK_THROWS_AS(cv::run_code_version(nlohmann::json::array()), std::runtime_error);
    // Version mismatch.
    CHECK_THROWS_AS(
        cv::run_code_version(nlohmann::json{
            {"version", 2}, {"templateId", "hmm_regime_v1"},
            {"packageParent", kPackageParent.string()}}),
        std::runtime_error);
    // Missing templateId.
    CHECK_THROWS_AS(
        cv::run_code_version(nlohmann::json{
            {"version", 1}, {"packageParent", kPackageParent.string()}}),
        std::runtime_error);
    // Missing packageParent.
    CHECK_THROWS_AS(
        cv::run_code_version(nlohmann::json{
            {"version", 1}, {"templateId", "hmm_regime_v1"}}),
        std::runtime_error);
    // Wrong-typed templateId.
    CHECK_THROWS_AS(
        cv::run_code_version(nlohmann::json{
            {"version", 1}, {"templateId", 42},
            {"packageParent", kPackageParent.string()}}),
        std::runtime_error);
}
