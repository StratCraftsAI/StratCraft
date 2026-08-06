#include "quantnexus/executor/evaluation_contract.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <sstream>

namespace StratCraft::executor::evaluation {
namespace {

[[noreturn]] void invalid(std::string message) {
  throw std::invalid_argument("QNX_EVAL_CONTRACT_INVALID: " + std::move(message));
}

void require_identifier(std::string_view value, std::string_view field) {
  if (value.empty() || value.size() > 256) {
    invalid(std::string(field) + " must contain 1..256 characters");
  }
}

std::uint64_t unsigned_integer(const nlohmann::json& value,
                               std::string_view field) {
  if (value.is_number_unsigned()) {
    return value.get<std::uint64_t>();
  }
  if (!value.is_number_integer()) {
    invalid(std::string(field) + " must be a non-negative integer");
  }
  const auto raw = value.get<std::int64_t>();
  if (raw < 0) {
    invalid(std::string(field) + " must be a non-negative integer");
  }
  return static_cast<std::uint64_t>(raw);
}

Timestamp timestamp(const nlohmann::json& value, std::string_view field) {
  const auto raw = unsigned_integer(value, field);
  if (raw > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max())) {
    invalid(std::string(field) + " exceeds int64 milliseconds");
  }
  return Timestamp{static_cast<std::int64_t>(raw)};
}

std::optional<PValue> optional_p_value(const nlohmann::json& value) {
  if (value.is_null()) {
    return std::nullopt;
  }
  return PValue{value.get<double>()};
}

EvaluationStatus parse_status(const std::string& value) {
  if (value == "completed") return EvaluationStatus::kCompleted;
  if (value == "partial") return EvaluationStatus::kPartial;
  if (value == "failed") return EvaluationStatus::kFailed;
  if (value == "cancelled") return EvaluationStatus::kCancelled;
  invalid("status is not a supported evaluation state");
}

void require_exact_fields(const nlohmann::json& object,
                          std::initializer_list<std::string_view> fields,
                          std::string_view path) {
  if (!object.is_object()) {
    invalid(std::string(path) + " must be an object");
  }
  std::set<std::string, std::less<>> expected;
  for (const auto field : fields) expected.emplace(field);
  for (const auto& [key, unused] : object.items()) {
    static_cast<void>(unused);
    if (!expected.contains(key)) {
      invalid(std::string(path) + " contains unknown field " + key);
    }
  }
  for (const auto& field : expected) {
    if (!object.contains(field)) {
      invalid(std::string(path) + " is missing required field " + field);
    }
  }
}

}  // namespace

template <typename Tag>
FiniteDouble<Tag>::FiniteDouble(double value) : value_(value) {
  if (!std::isfinite(value)) invalid("numeric values must be finite");
}

template class FiniteDouble<PriceValueTag>;
template class FiniteDouble<ReturnValueTag>;
template class FiniteDouble<EffectSizeTag>;
template class FiniteDouble<StatisticValueTag>;

SignalScore::SignalScore(double value) : value_(value) {
  if (!std::isfinite(value) || value < -1.0 || value > 1.0) {
    invalid("signal_score must be finite and within [-1, 1]");
  }
}

Probability::Probability(double value) : value_(value) {
  if (!std::isfinite(value) || value < 0.0 || value > 1.0) {
    invalid("probability must be finite and within [0, 1]");
  }
}

ModelIdentifier::ModelIdentifier(std::string value) : value_(std::move(value)) {
  require_identifier(value_, "model_id");
}

EvaluationWindow::EvaluationWindow(Timestamp start_value, Timestamp end_value,
                                   bool end_inclusive_value)
    : start(start_value), end(end_value), end_inclusive(end_inclusive_value) {
  if (!end_inclusive) invalid("window.end_inclusive must be true in version 1");
  if (start.value() < 0 || end.value() < 0 || start > end) {
    invalid("window must be a non-negative inclusive interval");
  }
}

bool EvaluationWindow::contains(Timestamp value) const noexcept {
  return value >= start && value <= end;
}

std::string_view status_name(EvaluationStatus status) noexcept {
  switch (status) {
    case EvaluationStatus::kCompleted: return "completed";
    case EvaluationStatus::kPartial: return "partial";
    case EvaluationStatus::kFailed: return "failed";
    case EvaluationStatus::kCancelled: return "cancelled";
  }
  return "failed";
}

EvaluationEnvelope parse_envelope(const nlohmann::json& document) {
  require_exact_fields(document,
      {"schema_version", "evaluation_id", "model_id", "window", "status",
       "rows", "statistics", "verdict_inputs", "progress", "cancellation",
       "missing_symbols", "errors"},
      "envelope");

  const auto schema_version = document.at("schema_version").get<std::string>();
  if (schema_version != kEnvelopeSchemaVersion) {
    invalid("schema_version must equal " + std::string(kEnvelopeSchemaVersion));
  }
  const auto evaluation_id = document.at("evaluation_id").get<std::string>();
  require_identifier(evaluation_id, "evaluation_id");

  const auto& window_json = document.at("window");
  require_exact_fields(window_json, {"start_ms", "end_ms", "end_inclusive"},
                       "window");
  EvaluationWindow window{
      timestamp(window_json.at("start_ms"), "window.start_ms"),
      timestamp(window_json.at("end_ms"), "window.end_ms"),
      window_json.at("end_inclusive").get<bool>()};

  std::vector<SignalRow> rows;
  std::pair<std::string, std::int64_t> previous;
  bool have_previous = false;
  for (const auto& row_json : document.at("rows")) {
    require_exact_fields(row_json,
        {"symbol", "timestamp_ms", "signal_score", "confidence", "forward_return"},
        "rows[]");
    auto symbol = row_json.at("symbol").get<std::string>();
    require_identifier(symbol, "rows[].symbol");
    const auto row_timestamp = timestamp(row_json.at("timestamp_ms"),
                                         "rows[].timestamp_ms");
    if (!window.contains(row_timestamp)) {
      invalid("rows[].timestamp_ms falls outside the requested window");
    }
    const auto key = std::pair{symbol, row_timestamp.value()};
    if (have_previous && key <= previous) {
      invalid("rows must be uniquely ordered by symbol then timestamp_ms");
    }
    previous = key;
    have_previous = true;
    std::optional<ReturnValue> forward_return;
    if (!row_json.at("forward_return").is_null()) {
      forward_return.emplace(row_json.at("forward_return").get<double>());
    }
    rows.push_back(SignalRow{
        .symbol = std::move(symbol),
        .timestamp = row_timestamp,
        .signal_score = SignalScore{row_json.at("signal_score").get<double>()},
        .confidence = Probability{row_json.at("confidence").get<double>()},
        .forward_return = forward_return});
  }

  std::vector<Statistic> statistics;
  for (const auto& stat_json : document.at("statistics")) {
    require_exact_fields(stat_json,
        {"name", "value", "sample_count", "raw_p_value", "adjusted_p_value"},
        "statistics[]");
    auto name = stat_json.at("name").get<std::string>();
    require_identifier(name, "statistics[].name");
    statistics.push_back(Statistic{
        .name = std::move(name),
        .value = StatisticValue{stat_json.at("value").get<double>()},
        .sample_count = SampleCount{unsigned_integer(stat_json.at("sample_count"),
                                                     "statistics[].sample_count")},
        .raw_p_value = optional_p_value(stat_json.at("raw_p_value")),
        .adjusted_p_value = optional_p_value(stat_json.at("adjusted_p_value"))});
  }

  const auto& verdict_json = document.at("verdict_inputs");
  require_exact_fields(verdict_json,
      {"observed_sample_count", "minimum_sample_count", "effect_size",
       "raw_p_value", "adjusted_p_value", "significance_level", "passed"},
      "verdict_inputs");
  const auto minimum_samples = unsigned_integer(
      verdict_json.at("minimum_sample_count"), "verdict_inputs.minimum_sample_count");
  if (minimum_samples == 0) invalid("minimum_sample_count must be at least one");
  VerdictInputs verdict{
      .observed_sample_count = SampleCount{unsigned_integer(
          verdict_json.at("observed_sample_count"), "verdict_inputs.observed_sample_count")},
      .minimum_sample_count = SampleCount{minimum_samples},
      .effect_size = EffectSize{verdict_json.at("effect_size").get<double>()},
      .raw_p_value = optional_p_value(verdict_json.at("raw_p_value")),
      .adjusted_p_value = optional_p_value(verdict_json.at("adjusted_p_value")),
      .significance_level = Probability{verdict_json.at("significance_level").get<double>()},
      .passed = verdict_json.at("passed").get<bool>()};

  const auto& progress_json = document.at("progress");
  require_exact_fields(progress_json, {"completed_units", "total_units", "stage"},
                       "progress");
  const auto completed = unsigned_integer(progress_json.at("completed_units"),
                                          "progress.completed_units");
  const auto total = unsigned_integer(progress_json.at("total_units"),
                                      "progress.total_units");
  if (completed > total) invalid("progress.completed_units exceeds total_units");
  auto stage = progress_json.at("stage").get<std::string>();
  require_identifier(stage, "progress.stage");

  const auto& cancellation_json = document.at("cancellation");
  require_exact_fields(cancellation_json, {"requested", "cancelled", "reason"},
                       "cancellation");
  CancellationState cancellation{
      .requested = cancellation_json.at("requested").get<bool>(),
      .cancelled = cancellation_json.at("cancelled").get<bool>(),
      .reason = cancellation_json.at("reason").is_null()
          ? std::nullopt
          : std::optional{cancellation_json.at("reason").get<std::string>()}};
  if (cancellation.cancelled && !cancellation.requested) {
    invalid("cancellation.cancelled requires requested=true");
  }
  if (cancellation.cancelled && !cancellation.reason.has_value()) {
    invalid("a cancelled evaluation requires an actionable reason");
  }

  std::vector<std::string> missing_symbols;
  std::set<std::string, std::less<>> seen_missing;
  for (const auto& symbol_json : document.at("missing_symbols")) {
    auto symbol = symbol_json.get<std::string>();
    require_identifier(symbol, "missing_symbols[]");
    if (!seen_missing.emplace(symbol).second) invalid("missing_symbols must be unique");
    missing_symbols.push_back(std::move(symbol));
  }

  std::vector<EvaluationError> errors;
  for (const auto& error_json : document.at("errors")) {
    require_exact_fields(error_json, {"code", "message", "field", "retryable"},
                         "errors[]");
    auto code = error_json.at("code").get<std::string>();
    auto message = error_json.at("message").get<std::string>();
    require_identifier(code, "errors[].code");
    require_identifier(message, "errors[].message");
    errors.push_back(EvaluationError{
        .code = std::move(code),
        .message = std::move(message),
        .field = error_json.at("field").is_null()
            ? std::nullopt
            : std::optional{error_json.at("field").get<std::string>()},
        .retryable = error_json.at("retryable").get<bool>()});
  }

  const auto status = parse_status(document.at("status").get<std::string>());
  if ((status == EvaluationStatus::kFailed || status == EvaluationStatus::kPartial) &&
      errors.empty()) {
    invalid("failed and partial envelopes require at least one actionable error");
  }
  if (status == EvaluationStatus::kCancelled && !cancellation.cancelled) {
    invalid("cancelled status requires cancellation.cancelled=true");
  }
  if (status != EvaluationStatus::kCancelled && cancellation.cancelled) {
    invalid("cancellation.cancelled=true requires cancelled status");
  }

  return EvaluationEnvelope{
      .schema_version = schema_version,
      .evaluation_id = evaluation_id,
      .model_id = ModelIdentifier{document.at("model_id").get<std::string>()},
      .window = window,
      .status = status,
      .rows = std::move(rows),
      .statistics = std::move(statistics),
      .verdict_inputs = std::move(verdict),
      .progress = EvaluationProgress{SampleCount{completed}, SampleCount{total},
                                     std::move(stage)},
      .cancellation = std::move(cancellation),
      .missing_symbols = std::move(missing_symbols),
      .errors = std::move(errors)};
}

nlohmann::json to_json(const EvaluationEnvelope& envelope) {
  nlohmann::json rows = nlohmann::json::array();
  for (const auto& row : envelope.rows) {
    nlohmann::json output_row;
    output_row["symbol"] = row.symbol;
    output_row["timestamp_ms"] = row.timestamp.value();
    output_row["signal_score"] = row.signal_score.value();
    output_row["confidence"] = row.confidence.value();
    output_row["forward_return"] = row.forward_return
        ? nlohmann::json(row.forward_return->value()) : nlohmann::json(nullptr);
    rows.push_back(std::move(output_row));
  }
  nlohmann::json statistics = nlohmann::json::array();
  for (const auto& statistic : envelope.statistics) {
    nlohmann::json output_statistic;
    output_statistic["name"] = statistic.name;
    output_statistic["value"] = statistic.value.value();
    output_statistic["sample_count"] = statistic.sample_count.value();
    output_statistic["raw_p_value"] = statistic.raw_p_value
        ? nlohmann::json(statistic.raw_p_value->value()) : nlohmann::json(nullptr);
    output_statistic["adjusted_p_value"] = statistic.adjusted_p_value
        ? nlohmann::json(statistic.adjusted_p_value->value()) : nlohmann::json(nullptr);
    statistics.push_back(std::move(output_statistic));
  }
  nlohmann::json errors = nlohmann::json::array();
  for (const auto& error : envelope.errors) {
    errors.push_back({{"code", error.code}, {"message", error.message},
                      {"field", error.field ? nlohmann::json(*error.field) : nlohmann::json(nullptr)},
                      {"retryable", error.retryable}});
  }
  const auto& verdict = envelope.verdict_inputs;
  nlohmann::json document;
  document["schema_version"] = envelope.schema_version;
  document["evaluation_id"] = envelope.evaluation_id;
  document["model_id"] = envelope.model_id.value();
  nlohmann::json window;
  window["start_ms"] = envelope.window.start.value();
  window["end_ms"] = envelope.window.end.value();
  window["end_inclusive"] = envelope.window.end_inclusive;
  document["window"] = std::move(window);
  document["status"] = status_name(envelope.status);
  document["rows"] = std::move(rows);
  document["statistics"] = std::move(statistics);
  nlohmann::json verdict_output;
  verdict_output["observed_sample_count"] = verdict.observed_sample_count.value();
  verdict_output["minimum_sample_count"] = verdict.minimum_sample_count.value();
  verdict_output["effect_size"] = verdict.effect_size.value();
  verdict_output["raw_p_value"] = verdict.raw_p_value
      ? nlohmann::json(verdict.raw_p_value->value()) : nlohmann::json(nullptr);
  verdict_output["adjusted_p_value"] = verdict.adjusted_p_value
      ? nlohmann::json(verdict.adjusted_p_value->value()) : nlohmann::json(nullptr);
  verdict_output["significance_level"] = verdict.significance_level.value();
  verdict_output["passed"] = verdict.passed;
  document["verdict_inputs"] = std::move(verdict_output);
  nlohmann::json progress;
  progress["completed_units"] = envelope.progress.completed_units.value();
  progress["total_units"] = envelope.progress.total_units.value();
  progress["stage"] = envelope.progress.stage;
  document["progress"] = std::move(progress);
  nlohmann::json cancellation;
  cancellation["requested"] = envelope.cancellation.requested;
  cancellation["cancelled"] = envelope.cancellation.cancelled;
  cancellation["reason"] = envelope.cancellation.reason
      ? nlohmann::json(*envelope.cancellation.reason) : nlohmann::json(nullptr);
  document["cancellation"] = std::move(cancellation);
  document["missing_symbols"] = envelope.missing_symbols;
  document["errors"] = std::move(errors);
  return document;
}

}  // namespace StratCraft::executor::evaluation
