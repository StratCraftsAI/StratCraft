/**
 * SBE Message Header - 8-byte binary message header
 *
 * TICKET_473_5: SBE Binary Encoding for IPC messages
 *
 * Every SBE message starts with this 8-byte header:
 * - blockLength (uint16_t): size of the message body in bytes
 * - templateId  (uint16_t): message type identifier
 * - schemaId    (uint16_t): schema identifier (for versioning)
 * - version     (uint16_t): schema version
 *
 * Flyweight pattern: wraps an existing buffer, no copy or allocation.
 *
 * Usage:
 *   char buffer[256];
 *   // Encode:
 *   MessageHeader::encode(buffer, body_size, TemplateId::BacktestConfig, 1, 1);
 *   // Decode:
 *   auto hdr = MessageHeader::decode(buffer);
 *
 */

#pragma once

#include <cstdint>
#include <cstring>
#include <type_traits>

namespace StratCraft::executor::sbe {

// =============================================================================
// Template IDs
// =============================================================================

/// Message template identifiers
enum class TemplateId : uint16_t {
    BacktestConfig   = 1,
    ProgressUpdate   = 2,
    TradeResult      = 3,
    ErrorReport      = 4,
};

// =============================================================================
// MessageHeader
// =============================================================================

/**
 * 8-byte SBE message header.
 *
 * Wire format (little-endian):
 * +--------+--------+--------+--------+--------+--------+--------+--------+
 * | blockLength (2) | templateId (2)  | schemaId (2)    | version (2)     |
 * +--------+--------+--------+--------+--------+--------+--------+--------+
 */
struct MessageHeader {
    uint16_t block_length{0};
    uint16_t template_id{0};
    uint16_t schema_id{0};
    uint16_t version{0};

    static constexpr size_t ENCODED_SIZE = 8;

    MessageHeader() noexcept = default;

    constexpr MessageHeader(uint16_t bl, uint16_t tid, uint16_t sid, uint16_t ver) noexcept
        : block_length{bl}, template_id{tid}, schema_id{sid}, version{ver} {}

    // --- Encode/Decode (flyweight on raw buffer) ---

    /**
     * Encode header into a raw buffer.
     * @param buffer Destination (must have at least ENCODED_SIZE bytes)
     * @param block_len Message body size
     * @param tmpl_id Message template ID
     * @param schema Schema ID
     * @param ver Schema version
     * @return Pointer past the header (buffer + ENCODED_SIZE)
     */
    static char* encode(char* buffer, uint16_t block_len, TemplateId tmpl_id,
                        uint16_t schema = 1, uint16_t ver = 1) noexcept {
        MessageHeader hdr{block_len, static_cast<uint16_t>(tmpl_id), schema, ver};
        std::memcpy(buffer, &hdr, ENCODED_SIZE);
        return buffer + ENCODED_SIZE;
    }

    /**
     * Decode header from a raw buffer.
     * @param buffer Source (must have at least ENCODED_SIZE bytes)
     * @return Decoded header
     */
    [[nodiscard]] static MessageHeader decode(const char* buffer) noexcept {
        MessageHeader hdr;
        std::memcpy(&hdr, buffer, ENCODED_SIZE);
        return hdr;
    }

    /**
     * Get the template ID as the enum type.
     */
    [[nodiscard]] TemplateId template_type() const noexcept {
        return static_cast<TemplateId>(template_id);
    }

    /**
     * Total message size (header + body).
     */
    [[nodiscard]] size_t total_size() const noexcept {
        return ENCODED_SIZE + block_length;
    }
};

// =============================================================================
// Static Assertions
// =============================================================================

static_assert(sizeof(MessageHeader) == MessageHeader::ENCODED_SIZE,
              "MessageHeader must be exactly 8 bytes");
static_assert(std::is_trivially_copyable_v<MessageHeader>,
              "MessageHeader must be trivially copyable");

} // namespace StratCraft::executor::sbe
