/**
 * SBE Backtest Messages - Binary codecs for Executor IPC
 *
 * TICKET_473_5: Zero-copy binary message format
 *
 * Message types:
 * - BacktestConfig: strategy configuration sent to executor
 * - ProgressUpdate: periodic progress from executor to main process
 * - TradeResult: individual trade execution result
 * - ErrorReport: error information from executor
 *
 * All messages use the flyweight pattern: they wrap an existing buffer
 * and provide typed accessors. No dynamic allocation, ~5ns encode/decode.
 *
 * Usage:
 *   // Encode a progress update
 *   char buffer[256];
 *   char* body = MessageHeader::encode(buffer,
 *       ProgressUpdateCodec::BLOCK_LENGTH, TemplateId::ProgressUpdate);
 *   ProgressUpdateCodec::encode(body, task_id, 75, 1500, 2000, 42);
 *
 *   // Decode
 *   auto hdr = MessageHeader::decode(buffer);
 *   auto progress = ProgressUpdateCodec::decode(buffer + MessageHeader::ENCODED_SIZE);
 *
 */

#pragma once

#include "message_header.hpp"
#include "types.hpp"

#include <cstdint>
#include <cstring>
#include <type_traits>

namespace StratCraft::executor::sbe {

// =============================================================================
// BacktestConfig Message (TemplateId::BacktestConfig = 1)
// =============================================================================

/**
 * Backtest configuration message.
 *
 * Wire layout (after header):
 * +------------------+------------------+------------------+
 * | task_id (32)     | strategy_id (32) | symbol (16)      |
 * +------------------+------------------+------------------+
 * | start_ts (8)     | end_ts (8)       | initial_cap (12) |
 * +------------------+------------------+------------------+
 * | timeframe (4)    | padding (4)      |
 * +------------------+------------------+
 *
 * Total body: 116 bytes
 */
struct BacktestConfigMsg {
    FixedString<32> task_id;
    FixedString<32> strategy_id;
    FixedString<16> symbol;
    int64_t start_timestamp{0};
    int64_t end_timestamp{0};
    DecimalPrice initial_capital;
    uint32_t timeframe_seconds{0};
    char reserved_[4]{};

    BacktestConfigMsg() noexcept = default;
};

struct BacktestConfigCodec {
    static constexpr size_t BLOCK_LENGTH = sizeof(BacktestConfigMsg);

    static char* encode(char* buffer, const BacktestConfigMsg& msg) noexcept {
        std::memcpy(buffer, &msg, BLOCK_LENGTH);
        return buffer + BLOCK_LENGTH;
    }

    [[nodiscard]] static BacktestConfigMsg decode(const char* buffer) noexcept {
        BacktestConfigMsg msg;
        std::memcpy(&msg, buffer, BLOCK_LENGTH);
        return msg;
    }
};

// =============================================================================
// ProgressUpdate Message (TemplateId::ProgressUpdate = 2)
// =============================================================================

/**
 * Backtest progress update message.
 *
 * Wire layout (after header):
 * +------------------+------------------+
 * | task_id (32)     | percent (1)      |
 * +------------------+------------------+
 * | bars_done (8)    | bars_total (8)   |
 * +------------------+------------------+
 * | trades (4)       | status (1)       |
 * +------------------+------------------+
 * | padding (2)      |
 * +------------------+
 *
 * Total body: 56 bytes
 */
struct ProgressUpdateMsg {
    FixedString<32> task_id;
    uint8_t percent_complete{0};     // 0-100
    char pad1_[7]{};                 // Align to 8-byte boundary
    int64_t bars_processed{0};
    int64_t bars_total{0};
    uint32_t trade_count{0};
    SbeBacktestStatus status{SbeBacktestStatus::Running};
    char pad2_[3]{};

    ProgressUpdateMsg() noexcept = default;
};

struct ProgressUpdateCodec {
    static constexpr size_t BLOCK_LENGTH = sizeof(ProgressUpdateMsg);

    static char* encode(char* buffer, const ProgressUpdateMsg& msg) noexcept {
        std::memcpy(buffer, &msg, BLOCK_LENGTH);
        return buffer + BLOCK_LENGTH;
    }

    [[nodiscard]] static ProgressUpdateMsg decode(const char* buffer) noexcept {
        ProgressUpdateMsg msg;
        std::memcpy(&msg, buffer, BLOCK_LENGTH);
        return msg;
    }
};

// =============================================================================
// TradeResult Message (TemplateId::TradeResult = 3)
// =============================================================================

/**
 * Individual trade execution result.
 *
 * Wire layout (after header):
 * +------------------+------------------+
 * | task_id (32)     | symbol (16)      |
 * +------------------+------------------+
 * | entry_price (12) | exit_price (12)  |
 * +------------------+------------------+
 * | quantity (12)    | pnl (12)         |
 * +------------------+------------------+
 * | entry_ts (8)     | exit_ts (8)      |
 * +------------------+------------------+
 * | side (1)         | order_type (1)   |
 * | trade_id (4)     | padding (2)      |
 * +------------------+------------------+
 *
 * Total body: 120 bytes
 */
struct TradeResultMsg {
    FixedString<32> task_id;
    FixedString<16> symbol;
    DecimalPrice entry_price;
    DecimalPrice exit_price;
    DecimalPrice quantity;
    DecimalPrice pnl;
    int64_t entry_timestamp{0};
    int64_t exit_timestamp{0};
    SbeSide side{SbeSide::NullVal};
    SbeOrderType order_type{SbeOrderType::NullVal};
    uint32_t trade_id{0};
    char pad_[2]{};

    TradeResultMsg() noexcept = default;
};

struct TradeResultCodec {
    static constexpr size_t BLOCK_LENGTH = sizeof(TradeResultMsg);

    static char* encode(char* buffer, const TradeResultMsg& msg) noexcept {
        std::memcpy(buffer, &msg, BLOCK_LENGTH);
        return buffer + BLOCK_LENGTH;
    }

    [[nodiscard]] static TradeResultMsg decode(const char* buffer) noexcept {
        TradeResultMsg msg;
        std::memcpy(&msg, buffer, BLOCK_LENGTH);
        return msg;
    }
};

// =============================================================================
// ErrorReport Message (TemplateId::ErrorReport = 4)
// =============================================================================

/**
 * Error report from executor.
 *
 * Wire layout (after header):
 * +------------------+------------------+
 * | task_id (32)     | error_code (4)   |
 * +------------------+------------------+
 * | message (128)    |
 * +------------------+
 * | source_file (64) | source_line (4)  |
 * +------------------+------------------+
 * | padding (4)      |
 * +------------------+
 *
 * Total body: 236 bytes
 */
struct ErrorReportMsg {
    FixedString<32> task_id;
    uint32_t error_code{0};
    char pad1_[4]{};
    FixedString<128> message;
    FixedString<64> source_file;
    uint32_t source_line{0};
    char pad2_[4]{};

    ErrorReportMsg() noexcept = default;
};

struct ErrorReportCodec {
    static constexpr size_t BLOCK_LENGTH = sizeof(ErrorReportMsg);

    static char* encode(char* buffer, const ErrorReportMsg& msg) noexcept {
        std::memcpy(buffer, &msg, BLOCK_LENGTH);
        return buffer + BLOCK_LENGTH;
    }

    [[nodiscard]] static ErrorReportMsg decode(const char* buffer) noexcept {
        ErrorReportMsg msg;
        std::memcpy(&msg, buffer, BLOCK_LENGTH);
        return msg;
    }
};

// =============================================================================
// Static Assertions
// =============================================================================

static_assert(std::is_trivially_copyable_v<BacktestConfigMsg>,
              "BacktestConfigMsg must be trivially copyable");
static_assert(std::is_trivially_copyable_v<ProgressUpdateMsg>,
              "ProgressUpdateMsg must be trivially copyable");
static_assert(std::is_trivially_copyable_v<TradeResultMsg>,
              "TradeResultMsg must be trivially copyable");
static_assert(std::is_trivially_copyable_v<ErrorReportMsg>,
              "ErrorReportMsg must be trivially copyable");

} // namespace StratCraft::executor::sbe
