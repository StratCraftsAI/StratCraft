#include "quantnexus/executor/evaluation_contract.hpp"

#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <fstream>
#include <limits>
#include <nlohmann/json-schema.hpp>
#include <nlohmann/json.hpp>

namespace fs = std::filesystem;
namespace evaluation = StratCraft::executor::evaluation;

namespace {

const fs::path kRoot{QNX_SOURCE_ROOT};
const fs::path kEnvelopeFixture =
    kRoot / "packages/executor/tests/fixtures/evaluation_envelope_v1.json";
const fs::path kParityFixture =
    kRoot / "packages/executor/tests/fixtures/evaluation_parity_cases_v1.json";
const fs::path kSchema =
    kRoot / "packages/executor/schemas/evaluation_envelope.schema.json";
const fs::path kEvaluationArrowSchema =
    kRoot / "packages/executor/schemas/evaluation_arrow_schema_v1.json";
const fs::path kMarketDataArrowSchema =
    kRoot / "packages/executor/schemas/market_data_arrow_schema_v1.json";

nlohmann::json read_json(const fs::path& path) {
  std::ifstream input(path);
  REQUIRE(input.is_open());
  nlohmann::json value;
  input >> value;
  return value;
}

bool rejects(const nlohmann::json& document) {
  try {
    static_cast<void>(evaluation::parse_envelope(document));
    return false;
  } catch (const std::invalid_argument&) {
    return true;
  }
}

}  // namespace

TEST_CASE("evaluation envelope golden fixture passes schema and typed parser",
          "[evaluation][contract][phase1]") {
  const auto schema = read_json(kSchema);
  const auto fixture = read_json(kEnvelopeFixture);
  nlohmann::json_schema::json_validator validator;
  validator.set_root_schema(schema);
  REQUIRE_NOTHROW(validator.validate(fixture));

  const auto typed = evaluation::parse_envelope(fixture);
  CHECK(typed.schema_version == evaluation::kEnvelopeSchemaVersion);
  CHECK(typed.rows.size() == 3);
  CHECK(typed.rows.front().timestamp.value() == 0);
  CHECK(typed.rows.back().timestamp.value() == 253402300799999);
  CHECK(typed.missing_symbols == std::vector<std::string>{"MISSING"});
  CHECK(evaluation::to_json(typed) == fixture);
}

TEST_CASE("language-neutral parity fixture pins exceptional semantics",
          "[evaluation][contract][phase1]") {
  const auto fixture = read_json(kParityFixture);
  CHECK(fixture.at("fixture_version") == "qnx.evaluation-parity/1.0.0");
  CHECK(fixture.at("non_finite_canonicalization").size() == 3);
  CHECK(fixture.at("tie_ranks").at("expected_average_ranks") ==
        nlohmann::json::array({4.0, 1.5, 1.5, 3.0}));
  CHECK(fixture.at("sample_boundaries").size() == 2);
  CHECK_NOTHROW(evaluation::parse_envelope(fixture.at("failure_envelope")));
  CHECK_NOTHROW(evaluation::parse_envelope(fixture.at("cancelled_envelope")));
}

TEST_CASE("Arrow and Parquet schemas freeze units, fields, and metadata",
          "[evaluation][contract][phase1][arrow]") {
  const auto evaluation_schema = read_json(kEvaluationArrowSchema);
  const auto market_schema = read_json(kMarketDataArrowSchema);
  CHECK(evaluation_schema.at("schema_version") == evaluation::kArrowSchemaVersion);
  CHECK(market_schema.at("schema_version") ==
        evaluation::kMarketDataArrowSchemaVersion);
  CHECK(evaluation_schema.at("timestamp_semantics").at("unit") == "millisecond");
  CHECK(market_schema.at("timestamp_semantics").at("meaning") == "bar_close");
  CHECK(evaluation_schema.at("fields").size() == 5);
  CHECK(market_schema.at("fields").size() == 7);
  CHECK(evaluation_schema.at("parquet").at("timestamp_logical_type") ==
        "TIMESTAMP(MILLIS,true)");
}

TEST_CASE("JSON Schema pins failure and cancellation state agreement",
          "[evaluation][contract][phase1][schema]") {
  nlohmann::json_schema::json_validator validator;
  validator.set_root_schema(read_json(kSchema));
  const auto parity = read_json(kParityFixture);
  CHECK_NOTHROW(validator.validate(parity.at("failure_envelope")));
  CHECK_NOTHROW(validator.validate(parity.at("cancelled_envelope")));

  auto inconsistent = parity.at("cancelled_envelope");
  inconsistent["cancellation"]["requested"] = false;
  CHECK_THROWS(validator.validate(inconsistent));

  auto errorless = parity.at("failure_envelope");
  errorless["errors"] = nlohmann::json::array();
  CHECK_THROWS(validator.validate(errorless));
}

TEST_CASE("typed parser rejects every semantic boundary violation",
          "[evaluation][contract][phase1]") {
  const auto valid = read_json(kEnvelopeFixture);

  SECTION("unknown version") {
    auto value = valid;
    value["schema_version"] = "qnx.evaluation-envelope/2.0.0";
    CHECK(rejects(value));
  }
  SECTION("reversed window") {
    auto value = valid;
    value["window"]["start_ms"] = value["window"]["end_ms"].get<std::int64_t>() + 1;
    CHECK(rejects(value));
  }
  SECTION("out of range score") {
    auto value = valid;
    value["rows"][0]["signal_score"] = 1.01;
    CHECK(rejects(value));
  }
  SECTION("row outside window") {
    auto value = valid;
    value["window"]["start_ms"] = 1;
    CHECK(rejects(value));
  }
  SECTION("duplicate row key") {
    auto value = valid;
    value["rows"].insert(value["rows"].begin() + 1, value["rows"][0]);
    CHECK(rejects(value));
  }
  SECTION("progress exceeds total") {
    auto value = valid;
    value["progress"]["completed_units"] = 4;
    CHECK(rejects(value));
  }
  SECTION("partial status requires error") {
    auto value = valid;
    value["errors"] = nlohmann::json::array();
    CHECK(rejects(value));
  }
  SECTION("cancelled state must agree") {
    auto value = valid;
    value["status"] = "cancelled";
    CHECK(rejects(value));
  }
  SECTION("unknown field") {
    auto value = valid;
    value["parallel_contract"] = true;
    CHECK(rejects(value));
  }
  SECTION("missing field") {
    auto value = valid;
    value.erase("model_id");
    CHECK(rejects(value));
  }
  SECTION("nested value is not an object") {
    auto value = valid;
    value["window"] = 3;
    CHECK(rejects(value));
  }
  SECTION("empty identifier") {
    auto value = valid;
    value["model_id"] = "";
    CHECK(rejects(value));
  }
  SECTION("oversize identifier") {
    auto value = valid;
    value["model_id"] = std::string(257, 'x');
    CHECK(rejects(value));
  }
  SECTION("integer field has wrong type") {
    auto value = valid;
    value["progress"]["total_units"] = "three";
    CHECK(rejects(value));
  }
  SECTION("integer field is negative") {
    auto value = valid;
    value["progress"]["total_units"] = -1;
    CHECK(rejects(value));
  }
  SECTION("timestamp exceeds int64") {
    auto value = valid;
    value["window"]["end_ms"] = std::numeric_limits<std::uint64_t>::max();
    CHECK(rejects(value));
  }
  SECTION("unsupported status") {
    auto value = valid;
    value["status"] = "pending";
    CHECK(rejects(value));
  }
  SECTION("non-finite return") {
    auto value = valid;
    value["rows"][0]["forward_return"] =
        std::numeric_limits<double>::infinity();
    CHECK(rejects(value));
  }
  SECTION("p-value outside domain") {
    auto value = valid;
    value["statistics"][0]["raw_p_value"] = 1.01;
    CHECK(rejects(value));
  }
  SECTION("zero minimum sample count") {
    auto value = valid;
    value["verdict_inputs"]["minimum_sample_count"] = 0;
    CHECK(rejects(value));
  }
  SECTION("cancelled without request") {
    auto value = valid;
    value["status"] = "cancelled";
    value["cancellation"] = {
        {"requested", false}, {"cancelled", true}, {"reason", "caller"}};
    CHECK(rejects(value));
  }
  SECTION("cancelled without reason") {
    auto value = valid;
    value["status"] = "cancelled";
    value["cancellation"] = {
        {"requested", true}, {"cancelled", true}, {"reason", nullptr}};
    CHECK(rejects(value));
  }
  SECTION("non-cancelled status with completed cancellation") {
    auto value = valid;
    value["cancellation"] = {
        {"requested", true}, {"cancelled", true}, {"reason", "caller"}};
    CHECK(rejects(value));
  }
  SECTION("duplicate missing symbol") {
    auto value = valid;
    value["missing_symbols"].push_back("MISSING");
    CHECK(rejects(value));
  }
}

TEST_CASE("versioned evaluation value types reject invalid domains",
          "[evaluation][contract][phase1][types]") {
  CHECK(evaluation::PriceValue{10.5}.value() == 10.5);
  CHECK(evaluation::ReturnValue{-0.25}.value() == -0.25);
  CHECK(evaluation::SignalScore{-1.0}.value() == -1.0);
  CHECK(evaluation::SignalScore{1.0}.value() == 1.0);
  CHECK(evaluation::Probability{0.0}.value() == 0.0);
  CHECK(evaluation::Probability{1.0}.value() == 1.0);
  CHECK_THROWS_AS(evaluation::PriceValue{
                      std::numeric_limits<double>::quiet_NaN()},
                  std::invalid_argument);
  CHECK_THROWS_AS(evaluation::ReturnValue{
                      std::numeric_limits<double>::infinity()},
                  std::invalid_argument);
  CHECK_THROWS_AS(evaluation::SignalScore{1.01}, std::invalid_argument);
  CHECK_THROWS_AS(evaluation::SignalScore{
                      std::numeric_limits<double>::quiet_NaN()},
                  std::invalid_argument);
  CHECK_THROWS_AS(evaluation::Probability{-0.01}, std::invalid_argument);
  CHECK_THROWS_AS(evaluation::Probability{
                      std::numeric_limits<double>::infinity()},
                  std::invalid_argument);
  CHECK_THROWS_AS(evaluation::ModelIdentifier{""}, std::invalid_argument);
  CHECK_THROWS_AS((evaluation::EvaluationWindow{
                      StratCraft::executor::Timestamp{2},
                      StratCraft::executor::Timestamp{1}, true}),
                  std::invalid_argument);
  CHECK_THROWS_AS((evaluation::EvaluationWindow{
                      StratCraft::executor::Timestamp{0},
                      StratCraft::executor::Timestamp{1}, false}),
                  std::invalid_argument);
  CHECK(evaluation::status_name(evaluation::EvaluationStatus::kCompleted) ==
        "completed");
  CHECK(evaluation::status_name(evaluation::EvaluationStatus::kPartial) ==
        "partial");
  CHECK(evaluation::status_name(evaluation::EvaluationStatus::kFailed) ==
        "failed");
  CHECK(evaluation::status_name(evaluation::EvaluationStatus::kCancelled) ==
        "cancelled");
  CHECK(evaluation::status_name(
            static_cast<evaluation::EvaluationStatus>(255)) == "failed");
}

TEST_CASE("cancelled golden envelope round trips identically",
          "[evaluation][contract][phase1][cancel]") {
  const auto parity = read_json(kParityFixture);
  const auto& fixture = parity.at("cancelled_envelope");
  const auto typed = evaluation::parse_envelope(fixture);
  CHECK(evaluation::to_json(typed) == fixture);
}
