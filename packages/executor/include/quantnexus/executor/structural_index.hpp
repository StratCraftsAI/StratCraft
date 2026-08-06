/**
 * Structural Index - SIMD Two-Stage Parsing for Financial Data
 *
 * TICKET_473_9: simdjson-style two-stage parsing adapted for CSV/delimited data
 *
 * Design:
 * - Stage 1: SIMD scan for delimiters (comma, newline, tab) -> position index
 * - Stage 2: Lazy field access by index position (zero parsing until needed)
 * - Runtime SIMD dispatch: AVX-512 > AVX2 > scalar fallback
 *
 * Reuses existing simd_math.hpp SIMD detection patterns (QNX_HAS_AVX2).
 *
 * Usage:
 *   PaddedBuffer buf = PaddedBuffer::from_data(csv_data, csv_len);
 *   StructuralIndex index;
 *   index.build(buf, ',');
 *
 *   // Access fields by position
 *   auto field = index.field(row=5, col=2);  // O(1)
 *
 */

#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <span>
#include <string_view>
#include <vector>

#include "hardware_constants.hpp"

// SIMD detection (reuse simd_math.hpp pattern)
#if defined(__AVX512BW__)
    #include <immintrin.h>
    #define QNX_STRUCTURAL_AVX512 1
    #define QNX_STRUCTURAL_AVX2 1
#elif defined(__AVX2__)
    #include <immintrin.h>
    #define QNX_STRUCTURAL_AVX512 0
    #define QNX_STRUCTURAL_AVX2 1
#else
    #define QNX_STRUCTURAL_AVX512 0
    #define QNX_STRUCTURAL_AVX2 0
#endif

namespace StratCraft::executor {

// TICKET_476: SIMD_PADDING centralized in hardware_constants.hpp
using constants::SIMD_PADDING;

// =============================================================================
// PaddedBuffer - Safe buffer for SIMD overread
// =============================================================================

/**
 * Buffer with extra padding at the end so SIMD loads that extend
 * past the actual data length read zero-initialized bytes instead
 * of causing undefined behavior.
 */
class PaddedBuffer {
public:
    PaddedBuffer() noexcept = default;

    /**
     * Create a padded buffer from existing data.
     * Copies data and adds SIMD_PADDING zero bytes at the end.
     */
    [[nodiscard]] static PaddedBuffer from_data(const char* data, size_t len) {
        PaddedBuffer buf;
        buf.size_ = len;
        buf.data_ = std::make_unique<char[]>(len + SIMD_PADDING);
        std::memcpy(buf.data_.get(), data, len);
        std::memset(buf.data_.get() + len, 0, SIMD_PADDING);
        return buf;
    }

    [[nodiscard]] static PaddedBuffer from_string(std::string_view sv) {
        return from_data(sv.data(), sv.size());
    }

    [[nodiscard]] const char* data() const noexcept { return data_.get(); }
    [[nodiscard]] size_t size() const noexcept { return size_; }
    [[nodiscard]] bool empty() const noexcept { return size_ == 0; }

    /// Total allocated size (data + padding)
    [[nodiscard]] size_t allocated_size() const noexcept { return size_ + SIMD_PADDING; }

private:
    std::unique_ptr<char[]> data_;
    size_t size_{0};
};

// =============================================================================
// StructuralIndex
// =============================================================================

/**
 * Two-stage structural index for delimited data.
 *
 * Stage 1 (build): SIMD scan produces two position vectors:
 *   - delimiter_positions_: byte offsets of delimiter characters
 *   - newline_positions_: byte offsets of newline characters (row boundaries)
 *
 * Stage 2 (access): O(1) field lookup by (row, col) via index arithmetic.
 */
class StructuralIndex {
public:
    StructuralIndex() noexcept = default;

    /**
     * Build the structural index (Stage 1).
     *
     * Scans the buffer for delimiter and newline characters using
     * the best available SIMD instruction set.
     *
     * @param buffer Padded input buffer
     * @param delimiter Field delimiter character (default: comma)
     * @param newline Row delimiter character (default: newline)
     */
    void build(const PaddedBuffer& buffer, char delimiter = ',', char newline = '\n') {
        delimiter_positions_.clear();
        newline_positions_.clear();
        buffer_data_ = buffer.data();
        buffer_size_ = buffer.size();

        // Add implicit row start at position 0
        newline_positions_.push_back(static_cast<uint32_t>(-1));  // Sentinel before first row

#if QNX_STRUCTURAL_AVX512
        build_avx512(buffer.data(), buffer.size(), delimiter, newline);
#elif QNX_STRUCTURAL_AVX2
        build_avx2(buffer.data(), buffer.size(), delimiter, newline);
#else
        build_scalar(buffer.data(), buffer.size(), delimiter, newline);
#endif

        // Add implicit end sentinel
        newline_positions_.push_back(static_cast<uint32_t>(buffer.size()));
    }

    // --- Stage 2: Field Access ---

    /// Number of rows detected
    [[nodiscard]] size_t row_count() const noexcept {
        return newline_positions_.size() >= 2 ? newline_positions_.size() - 2 : 0;
    }

    /// Number of delimiter positions found
    [[nodiscard]] size_t delimiter_count() const noexcept {
        return delimiter_positions_.size();
    }

    /**
     * Get a field by (row, col) coordinates.
     *
     * @param row Row index (0-based)
     * @param col Column index (0-based)
     * @return string_view of the field, or empty if out of bounds
     */
    [[nodiscard]] std::string_view field(size_t row, size_t col) const noexcept {
        if (row + 1 >= newline_positions_.size() - 1) return {};

        // Row boundaries
        uint32_t row_start = newline_positions_[row] + 1;      // After previous newline
        uint32_t row_end = newline_positions_[row + 2];         // Next newline (2 because of sentinel)

        if (row_start >= buffer_size_ || row_end > buffer_size_) return {};

        // Find column within row by scanning delimiter positions
        uint32_t field_start = row_start;
        size_t col_found = 0;

        for (uint32_t dpos : delimiter_positions_) {
            if (dpos < row_start) continue;
            if (dpos >= row_end) break;

            if (col_found == col) {
                // Found the start of our field, end is at this delimiter
                size_t len = dpos - field_start;
                return std::string_view{buffer_data_ + field_start, len};
            }

            field_start = dpos + 1;
            ++col_found;
        }

        // Last column in row (no trailing delimiter)
        if (col_found == col && field_start < row_end) {
            size_t len = row_end - field_start;
            return std::string_view{buffer_data_ + field_start, len};
        }

        return {};
    }

    /**
     * Get an entire row as a string_view.
     */
    [[nodiscard]] std::string_view row(size_t row_idx) const noexcept {
        if (row_idx + 1 >= newline_positions_.size() - 1) return {};

        uint32_t start = newline_positions_[row_idx] + 1;
        uint32_t end = newline_positions_[row_idx + 2];

        if (start >= buffer_size_ || end > buffer_size_) return {};
        return std::string_view{buffer_data_ + start, end - start};
    }

    /// Access raw delimiter positions
    [[nodiscard]] std::span<const uint32_t> delimiter_positions() const noexcept {
        return delimiter_positions_;
    }

    /// Access raw newline positions
    [[nodiscard]] std::span<const uint32_t> newline_positions() const noexcept {
        return newline_positions_;
    }

private:
    // --- Scalar fallback (always available) ---

    void build_scalar(const char* data, size_t len, char delim, char nl) {
        for (size_t i = 0; i < len; ++i) {
            if (data[i] == delim) {
                delimiter_positions_.push_back(static_cast<uint32_t>(i));
            } else if (data[i] == nl) {
                newline_positions_.push_back(static_cast<uint32_t>(i));
            }
        }
    }

#if QNX_STRUCTURAL_AVX2
    // --- AVX2 Stage 1: 32 bytes per iteration ---

    void build_avx2(const char* data, size_t len, char delim, char nl) {
        const __m256i vdelim = _mm256_set1_epi8(delim);
        const __m256i vnl = _mm256_set1_epi8(nl);

        size_t i = 0;
        for (; i + 31 < len; i += 32) {
            __m256i chunk = _mm256_loadu_si256(
                reinterpret_cast<const __m256i*>(data + i));

            // Compare for delimiter
            __m256i delim_cmp = _mm256_cmpeq_epi8(chunk, vdelim);
            uint32_t delim_mask = static_cast<uint32_t>(_mm256_movemask_epi8(delim_cmp));

            // Compare for newline
            __m256i nl_cmp = _mm256_cmpeq_epi8(chunk, vnl);
            uint32_t nl_mask = static_cast<uint32_t>(_mm256_movemask_epi8(nl_cmp));

            // Extract positions from bitmasks
            while (delim_mask != 0) {
                int bit = __builtin_ctz(delim_mask);
                delimiter_positions_.push_back(static_cast<uint32_t>(i + bit));
                delim_mask &= delim_mask - 1;  // Clear lowest set bit
            }

            while (nl_mask != 0) {
                int bit = __builtin_ctz(nl_mask);
                newline_positions_.push_back(static_cast<uint32_t>(i + bit));
                nl_mask &= nl_mask - 1;
            }
        }

        // Scalar remainder
        for (; i < len; ++i) {
            if (data[i] == delim) {
                delimiter_positions_.push_back(static_cast<uint32_t>(i));
            } else if (data[i] == nl) {
                newline_positions_.push_back(static_cast<uint32_t>(i));
            }
        }
    }
#endif

#if QNX_STRUCTURAL_AVX512
    // --- AVX-512 Stage 1: 64 bytes per iteration ---

    void build_avx512(const char* data, size_t len, char delim, char nl) {
        const __m512i vdelim = _mm512_set1_epi8(delim);
        const __m512i vnl = _mm512_set1_epi8(nl);

        size_t i = 0;
        for (; i + 63 < len; i += 64) {
            __m512i chunk = _mm512_loadu_si512(
                reinterpret_cast<const __m512i*>(data + i));

            // AVX-512 mask compare
            __mmask64 delim_mask = _mm512_cmpeq_epi8_mask(chunk, vdelim);
            __mmask64 nl_mask = _mm512_cmpeq_epi8_mask(chunk, vnl);

            // Extract positions from 64-bit masks
            while (delim_mask != 0) {
                int bit = __builtin_ctzll(delim_mask);
                delimiter_positions_.push_back(static_cast<uint32_t>(i + bit));
                delim_mask &= delim_mask - 1;
            }

            while (nl_mask != 0) {
                int bit = __builtin_ctzll(nl_mask);
                newline_positions_.push_back(static_cast<uint32_t>(i + bit));
                nl_mask &= nl_mask - 1;
            }
        }

        // Scalar remainder
        for (; i < len; ++i) {
            if (data[i] == delim) {
                delimiter_positions_.push_back(static_cast<uint32_t>(i));
            } else if (data[i] == nl) {
                newline_positions_.push_back(static_cast<uint32_t>(i));
            }
        }
    }
#endif

    const char* buffer_data_{nullptr};
    size_t buffer_size_{0};
    std::vector<uint32_t> delimiter_positions_;
    std::vector<uint32_t> newline_positions_;
};

} // namespace StratCraft::executor
