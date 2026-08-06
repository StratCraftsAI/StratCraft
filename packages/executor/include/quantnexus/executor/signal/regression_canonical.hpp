// TICKET_1292_21 Phase E: one C++ authority for regression-family canonical
// projection. Both ONNX and portable classical inference consume this contract.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace StratCraft::executor::signal {

inline constexpr int REGRESSION_ROLLING_WINDOW_BARS = 252;
inline constexpr std::int64_t REGRESSION_TRADING_SECONDS_PER_YEAR =
    252LL * 24LL * 3600LL;
inline constexpr int REGRESSION_ROLLING_WINDOW_BARS_MAX = 500'000;
inline constexpr double REGRESSION_DATA_FRACTION_CAP = 0.5;
inline constexpr int REGRESSION_INFER_PROBE_MAX = 200;
inline constexpr double NANOSECONDS_PER_SECOND = 1e9;
inline constexpr std::int64_t NANOSECONDS_PER_MILLISECOND = 1'000'000LL;

struct RegressionCanonicalRow {
  std::int64_t timestamp_ms;
  double score;
  double confidence;
};

[[nodiscard]] inline int infer_regression_rolling_window(
    const std::vector<std::int64_t>& timestamps_ns,
    std::size_t bar_count) {
  if (timestamps_ns.size() < 2) return REGRESSION_ROLLING_WINDOW_BARS;
  const std::size_t probe = std::min<std::size_t>(
      REGRESSION_INFER_PROBE_MAX, timestamps_ns.size());
  std::vector<double> differences;
  differences.reserve(probe);
  for (std::size_t index = 1; index < probe; ++index) {
    const double difference =
        static_cast<double>(timestamps_ns[index] -
                            timestamps_ns[index - 1]) /
        NANOSECONDS_PER_SECOND;
    if (difference > 0.0) differences.push_back(difference);
  }
  if (differences.empty()) return REGRESSION_ROLLING_WINDOW_BARS;
  std::sort(differences.begin(), differences.end());
  const std::size_t count = differences.size();
  const double median =
      count % 2 == 1
          ? differences[count / 2]
          : 0.5 *
                (differences[count / 2 - 1] + differences[count / 2]);
  if (median <= 0.0) return REGRESSION_ROLLING_WINDOW_BARS;
  const int ideal = static_cast<int>(std::llround(
      static_cast<double>(REGRESSION_TRADING_SECONDS_PER_YEAR) / median));
  const int data_cap = std::max(
      REGRESSION_ROLLING_WINDOW_BARS,
      static_cast<int>(static_cast<double>(bar_count) *
                       REGRESSION_DATA_FRACTION_CAP));
  return std::max(
      REGRESSION_ROLLING_WINDOW_BARS,
      std::min(
          {ideal, data_cap, REGRESSION_ROLLING_WINDOW_BARS_MAX}));
}

[[nodiscard]] inline std::vector<double> regression_rolling_std_ddof0(
    const std::vector<double>& values,
    std::size_t window) {
  const std::size_t count = values.size();
  std::vector<double> out(
      count, std::numeric_limits<double>::quiet_NaN());
  if (window == 0) return out;
  double mean = 0.0;
  double squared_deviation = 0.0;
  double add_compensation = 0.0;
  double remove_compensation = 0.0;
  double previous = 0.0;
  std::size_t observations = 0;
  std::size_t consecutive_same = 0;
  std::size_t previous_start = 0;
  std::size_t previous_end = 0;
  auto add = [&](double value) {
    if (!std::isfinite(value)) return;
    ++observations;
    consecutive_same =
        value == previous ? consecutive_same + 1 : 1;
    previous = value;
    const double previous_mean = mean - add_compensation;
    const double adjusted = value - add_compensation;
    const double delta = adjusted - mean;
    add_compensation = (delta + mean) - adjusted;
    mean = observations > 0
               ? mean + delta / static_cast<double>(observations)
               : 0.0;
    squared_deviation +=
        (value - previous_mean) * (value - mean);
  };
  auto remove = [&](double value) {
    if (!std::isfinite(value)) return;
    --observations;
    if (observations > 0) {
      const double previous_mean = mean - remove_compensation;
      const double adjusted = value - remove_compensation;
      const double delta = adjusted - mean;
      remove_compensation = (delta + mean) - adjusted;
      mean -= delta / static_cast<double>(observations);
      squared_deviation -=
          (value - previous_mean) * (value - mean);
    } else {
      mean = 0.0;
      squared_deviation = 0.0;
    }
  };
  for (std::size_t index = 0; index < count; ++index) {
    const std::size_t start =
        index + 1 > window ? index + 1 - window : 0;
    const std::size_t end = index + 1;
    if (index == 0 || start >= previous_end) {
      mean = 0.0;
      squared_deviation = 0.0;
      add_compensation = 0.0;
      remove_compensation = 0.0;
      previous = 0.0;
      consecutive_same = 0;
      observations = 0;
      for (std::size_t item = start; item < end; ++item) add(values[item]);
    } else {
      for (std::size_t item = previous_start; item < start; ++item) {
        remove(values[item]);
      }
      for (std::size_t item = previous_end; item < end; ++item) {
        add(values[item]);
      }
    }
    previous_start = start;
    previous_end = end;
    if (observations >= window && observations > 0) {
      if (consecutive_same >= observations) {
        out[index] = 0.0;
      } else {
        const double variance =
            squared_deviation / static_cast<double>(observations);
        out[index] = variance < 0.0 ? 0.0 : std::sqrt(variance);
      }
    }
  }
  return out;
}

[[nodiscard]] inline std::vector<RegressionCanonicalRow>
build_regression_canonical(
    const std::vector<std::int64_t>& timestamps_ns,
    const std::vector<double>& raw,
    int warmup) {
  const std::size_t count = raw.size();
  const int window =
      infer_regression_rolling_window(timestamps_ns, count);
  const std::vector<double> sigma = regression_rolling_std_ddof0(
      raw, static_cast<std::size_t>(window));
  std::vector<RegressionCanonicalRow> rows;
  rows.reserve(count);
  for (std::size_t index = 0; index < count; ++index) {
    const bool valid =
        static_cast<int>(index) >= warmup &&
        std::isfinite(raw[index]) && std::isfinite(sigma[index]) &&
        sigma[index] > 0.0;
    double score = 0.0;
    double confidence = 0.0;
    if (valid) {
      const double normalized = raw[index] / sigma[index];
      score = std::clamp(normalized, -1.0, 1.0);
      confidence = std::min(1.0, std::fabs(normalized));
    }
    rows.push_back(RegressionCanonicalRow{
        timestamps_ns[index] / NANOSECONDS_PER_MILLISECOND,
        score,
        confidence});
  }
  return rows;
}

}  // namespace StratCraft::executor::signal
