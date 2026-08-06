#pragma once

#include "quantnexus/executor/types.hpp"

#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

namespace StratCraft::executor::evaluation {

inline constexpr std::string_view kEnvelopeSchemaVersion =
    "qnx.evaluation-envelope/1.0.0";
inline constexpr std::string_view kArrowSchemaVersion =
    "qnx.evaluation-arrow/1.0.0";
inline constexpr std::string_view kMarketDataArrowSchemaVersion =
    "qnx.market-data-arrow/1.0.0";

template <typename Tag>
class FiniteDouble final {
 public:
  explicit FiniteDouble(double value);
  [[nodiscard]] double value() const noexcept { return value_; }
  [[nodiscard]] auto operator<=>(const FiniteDouble&) const noexcept = default;

 private:
  double value_;
};

struct PriceValueTag final {};
struct ReturnValueTag final {};
struct EffectSizeTag final {};
struct StatisticValueTag final {};

using PriceValue = FiniteDouble<PriceValueTag>;
using ReturnValue = FiniteDouble<ReturnValueTag>;
using EffectSize = FiniteDouble<EffectSizeTag>;
using StatisticValue = FiniteDouble<StatisticValueTag>;

class SignalScore final {
 public:
  explicit SignalScore(double value);
  [[nodiscard]] double value() const noexcept { return value_; }

 private:
  double value_;
};

class Probability final {
 public:
  explicit Probability(double value);
  [[nodiscard]] double value() const noexcept { return value_; }

 private:
  double value_;
};

using PValue = Probability;

class SampleCount final {
 public:
  explicit constexpr SampleCount(std::uint64_t value) noexcept : value_(value) {}
  [[nodiscard]] constexpr std::uint64_t value() const noexcept { return value_; }

 private:
  std::uint64_t value_;
};

class ModelIdentifier final {
 public:
  explicit ModelIdentifier(std::string value);
  [[nodiscard]] const std::string& value() const noexcept { return value_; }

 private:
  std::string value_;
};

struct EvaluationWindow final {
  Timestamp start;
  Timestamp end;
  bool end_inclusive{true};

  EvaluationWindow(Timestamp start_value, Timestamp end_value,
                   bool end_inclusive_value);
  [[nodiscard]] bool contains(Timestamp timestamp) const noexcept;
};

struct EvaluationError final {
  std::string code;
  std::string message;
  std::optional<std::string> field;
  bool retryable{false};
};

enum class EvaluationStatus { kCompleted, kPartial, kFailed, kCancelled };

struct SignalRow final {
  std::string symbol;
  Timestamp timestamp;
  SignalScore signal_score;
  Probability confidence;
  std::optional<ReturnValue> forward_return;
};

struct Statistic final {
  std::string name;
  StatisticValue value;
  SampleCount sample_count;
  std::optional<PValue> raw_p_value;
  std::optional<PValue> adjusted_p_value;
};

struct VerdictInputs final {
  SampleCount observed_sample_count;
  SampleCount minimum_sample_count;
  EffectSize effect_size;
  std::optional<PValue> raw_p_value;
  std::optional<PValue> adjusted_p_value;
  Probability significance_level;
  bool passed{false};
};

struct EvaluationProgress final {
  SampleCount completed_units;
  SampleCount total_units;
  std::string stage;
};

struct CancellationState final {
  bool requested{false};
  bool cancelled{false};
  std::optional<std::string> reason;
};

struct EvaluationEnvelope final {
  std::string schema_version;
  std::string evaluation_id;
  ModelIdentifier model_id;
  EvaluationWindow window;
  EvaluationStatus status;
  std::vector<SignalRow> rows;
  std::vector<Statistic> statistics;
  VerdictInputs verdict_inputs;
  EvaluationProgress progress;
  CancellationState cancellation;
  std::vector<std::string> missing_symbols;
  std::vector<EvaluationError> errors;
};

[[nodiscard]] EvaluationEnvelope parse_envelope(const nlohmann::json& document);
[[nodiscard]] nlohmann::json to_json(const EvaluationEnvelope& envelope);
[[nodiscard]] std::string_view status_name(EvaluationStatus status) noexcept;

}  // namespace StratCraft::executor::evaluation
