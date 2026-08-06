#pragma once

#include <cstdint>
#include <cstddef>
#include <string_view>

namespace StratCraft::executor::data_plane::ohlcv_constants {

inline constexpr std::string_view CONTRACT_VERSION = "qnx.ohlcv-data-plane/1.0.0";
inline constexpr std::string_view SCHEMA_VERSION = "qnx.ohlcv/1.0.0";
inline constexpr std::string_view TIMESTAMP_UNIT = "epoch_ms";
inline constexpr std::string_view DEFAULT_CODEC = "zstd";
inline constexpr std::string_view CLI_ARGUMENT_PREFIX = "--ohlcv-data-plane=";
inline constexpr std::int64_t MILLISECONDS_PER_SECOND = 1'000;
inline constexpr std::int64_t MILLISECONDS_PER_DAY = 86'400'000;
inline constexpr std::int64_t DEFAULT_ROW_GROUP_ROWS = 65'536;
inline constexpr std::int64_t MAX_INPUT_ROWS = 50'000'000;
inline constexpr std::uint64_t CANCELLATION_CHECK_ROWS = 4'096;
inline constexpr int COMMAND_ERROR_EXIT_CODE = 2;
inline constexpr int COMMAND_CANCELLED_EXIT_CODE = 130;
inline constexpr double FILLED_VOLUME = 0.0;
inline constexpr double SCALE_SHIFT_MIN_RATIO = 5.0;
inline constexpr std::int64_t JUMP_GATE_MAX_GAP_INTERVAL_MULTIPLE = 3;
inline constexpr std::int64_t FOREX_SCALE_SHIFT_MAX_GAP_MS =
    7 * MILLISECONDS_PER_DAY;
inline constexpr std::int64_t CRYPTO_SCALE_SHIFT_MAX_GAP_MS =
    MILLISECONDS_PER_DAY;
inline constexpr double FOREX_JUMP_SUSPECT_THRESHOLD = 0.2;
inline constexpr double DEFAULT_JUMP_SUSPECT_THRESHOLD = 0.5;
inline constexpr std::size_t QUALITY_EVENT_DETAIL_CAP = 5'000;

}  // namespace StratCraft::executor::data_plane::ohlcv_constants
