// SPDX-License-Identifier: Apache-2.0
// Public Spearman correlation and pairwise covariance primitives.

#pragma once

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <numeric>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace StratCraft::executor::statistics {

inline constexpr std::size_t MIN_SPEARMAN_SAMPLES = 3;

[[nodiscard]] inline bool is_finite(double value) noexcept {
    return std::isfinite(value);
}

// TICKET_1256_3_3 (RC2 / F1): reusable per-worker scratch for the pairwise
// Spearman sweep. Each run_pairs worker owns ONE of these, sized to the dense
// column ONCE and reused across every pair job — replacing the per-call
// allocate/free churn of multi-hundred-MB buffers (av/bv/index/ranks) that made
// the compute transient "depend on allocator luck" and, at worker_cap=12,
// stacked tens of GB of unmodeled Spearman transient (the 2026-07-17 freeze).
//
// The `order` index is uint32 (4 B) instead of the old pair<double,size_t>
// (16 B) — a pure argsort over a key view. Results stay byte-identical: the old
// std::sort ordered by VALUE only and the fractional-rank tie handling assigns
// the same average rank to equal values regardless of index order, so an
// index-argsort by the same key yields identical ranks (AC4). Buffers are only
// grown, never shrunk, so a warm worker never reallocates.
struct SpearmanScratch {
    std::vector<double> av;
    std::vector<double> bv;
    std::vector<std::uint32_t> order;  // argsort index over the active key view
    std::vector<double> rank_a;
    std::vector<double> rank_b;

    // Pre-size all buffers to the dense column length (one allocation each).
    void reserve(std::size_t n) {
        av.reserve(n);
        bv.reserve(n);
        order.reserve(n);
        rank_a.reserve(n);
        rank_b.reserve(n);
    }
};

// Fractional (average) rank of `values` into `ranks` (resized to values.size()),
// using the caller-owned `order` scratch as the argsort index — no per-call
// allocation. Byte-identical to the allocating `fractional_rank` overload.
inline void fractional_rank_into(
    std::span<const double> values,
    std::vector<double>& ranks,
    std::vector<std::uint32_t>& order) {
    const std::size_t n = values.size();
    // TICKET_1256_3_3 (R4): the argsort index is uint32 by design (4 B/cell vs
    // the old 16 B pair — half the scratch); a column beyond 2^32-1 cells would
    // silently wrap the cast and corrupt every rank. Fail fast (TICKET_857)
    // instead — no realistic grid reaches 4.29e9 cells today, so this guard is
    // a contract assertion, not a code path.
    if (n > static_cast<std::size_t>(std::numeric_limits<std::uint32_t>::max())) {
        throw std::length_error(
            "TICKET_1256_3_3 (R4): fractional_rank_into column length "
            + std::to_string(n)
            + " exceeds the uint32 argsort index range; the rank index type "
              "must be widened before grids this large are supported.");
    }
    order.resize(n);
    for (std::size_t i = 0; i < n; ++i) {
        order[i] = static_cast<std::uint32_t>(i);
    }
    std::sort(order.begin(), order.end(),
              [&](std::uint32_t lhs, std::uint32_t rhs) {
                  return values[lhs] < values[rhs];
              });

    ranks.assign(n, 0.0);
    std::size_t i = 0;
    while (i < n) {
        std::size_t j = i;
        while (j < n && values[order[j]] == values[order[i]]) {
            ++j;
        }
        const double avg_rank = (static_cast<double>(i) + static_cast<double>(j) + 1.0) / 2.0;
        for (std::size_t k = i; k < j; ++k) {
            ranks[order[k]] = avg_rank;
        }
        i = j;
    }
}

[[nodiscard]] inline std::vector<double> fractional_rank(std::span<const double> values) {
    std::vector<double> ranks;
    std::vector<std::uint32_t> order;
    fractional_rank_into(values, ranks, order);
    return ranks;
}

// Spearman correlation from the two rank vectors already computed in `scratch`
// (rank_a / rank_b). Extracted so both the allocating and arena overloads share
// the SAME accumulation arithmetic (AC4 byte-identical).
[[nodiscard]] inline double spearman_from_ranks(
    const std::vector<double>& rank_a, const std::vector<double>& rank_b) {
    const double n = static_cast<double>(rank_a.size());
    const double sum_a = std::accumulate(rank_a.begin(), rank_a.end(), 0.0);
    const double sum_b = std::accumulate(rank_b.begin(), rank_b.end(), 0.0);
    const double mean_a = sum_a / n;
    const double mean_b = sum_b / n;

    double cov = 0.0;
    double var_a = 0.0;
    double var_b = 0.0;
    for (std::size_t i = 0; i < rank_a.size(); ++i) {
        const double da = rank_a[i] - mean_a;
        const double db = rank_b[i] - mean_b;
        cov += da * db;
        var_a += da * da;
        var_b += db * db;
    }

    const double denom = std::sqrt(var_a * var_b);
    if (denom == 0.0) {
        return 0.0;
    }
    return cov / denom;
}

// TICKET_1256_3_3 (RC2 / F1): arena overload. Byte-identical to the allocating
// overload below (SAME pairwise-complete finite filtering, SAME average-rank tie
// handling, SAME accumulation order) but reuses the caller's SpearmanScratch —
// no per-call allocation of the av/bv/order/rank buffers.
[[nodiscard]] inline double spearman_correlation(
    std::span<const double> a, std::span<const double> b, SpearmanScratch& scratch) {
    const std::size_t count = std::min(a.size(), b.size());
    scratch.av.clear();
    scratch.bv.clear();
    for (std::size_t t = 0; t < count; ++t) {
        if (is_finite(a[t]) && is_finite(b[t])) {
            scratch.av.push_back(a[t]);
            scratch.bv.push_back(b[t]);
        }
    }
    if (scratch.av.size() < MIN_SPEARMAN_SAMPLES) {
        return 0.0;
    }

    fractional_rank_into(std::span<const double>(scratch.av),
                         scratch.rank_a, scratch.order);
    fractional_rank_into(std::span<const double>(scratch.bv),
                         scratch.rank_b, scratch.order);
    return spearman_from_ranks(scratch.rank_a, scratch.rank_b);
}

[[nodiscard]] inline double spearman_correlation(std::span<const double> a, std::span<const double> b) {
    const std::size_t count = std::min(a.size(), b.size());
    std::vector<double> av;
    std::vector<double> bv;
    av.reserve(count);
    bv.reserve(count);

    for (std::size_t t = 0; t < count; ++t) {
        if (is_finite(a[t]) && is_finite(b[t])) {
            av.push_back(a[t]);
            bv.push_back(b[t]);
        }
    }
    if (av.size() < MIN_SPEARMAN_SAMPLES) {
        return 0.0;
    }

    const std::vector<double> rank_a = fractional_rank(av);
    const std::vector<double> rank_b = fractional_rank(bv);
    return spearman_from_ranks(rank_a, rank_b);
}

// TICKET_1292_01 cut 01-B: abstain-preserving Spearman for the discovery /
// cross-sectional-IC caller.
//
// The `double` overload above collapses TWO statistically distinct outcomes to
// the SAME 0.0:
//   (a) size < MIN_SPEARMAN_SAMPLES after pairwise-complete finite filtering
//       (too thin to rank -- no claim can be made), and
//   (b) zero rank variance (denom == 0.0: a constant score or return
//       cross-section -- "undefined", not a measured "no correlation").
// A verdict layer that reads 0.0 as a real "no predictive power" would mistake
// either abstain for a measured null result (the cut-01-A binding-parity
// divergence #1). This overload preserves the abstain signal as std::nullopt
// while remaining BYTE-IDENTICAL to the `double` overload on every input that
// produces a defined correlation: SAME pairwise-complete filtering (divergence
// #3), SAME MIN_SPEARMAN_SAMPLES=3 floor rechecked AFTER the finite drop
// (divergence #2), SAME average-rank ties, SAME spearman_from_ranks arithmetic.
// The `double` overload stays for the fusion weight path, which intentionally
// treats a flat column as zero contribution.
[[nodiscard]] inline std::optional<double> spearman_correlation_opt(
    std::span<const double> a, std::span<const double> b) {
    const std::size_t count = std::min(a.size(), b.size());
    std::vector<double> av;
    std::vector<double> bv;
    av.reserve(count);
    bv.reserve(count);

    for (std::size_t t = 0; t < count; ++t) {
        if (is_finite(a[t]) && is_finite(b[t])) {
            av.push_back(a[t]);
            bv.push_back(b[t]);
        }
    }
    // Divergence #2 + #3: the floor is re-checked on the SURVIVING pair count,
    // after non-finite pairs are dropped. Below the floor -> abstain (nullopt),
    // NOT a measured 0.0.
    if (av.size() < MIN_SPEARMAN_SAMPLES) {
        return std::nullopt;
    }

    const std::vector<double> rank_a = fractional_rank(av);
    const std::vector<double> rank_b = fractional_rank(bv);

    // Divergence #1: recompute the denom check here so a zero-rank-variance
    // cross-section abstains rather than collapsing to the 0.0 that
    // spearman_from_ranks returns. The accumulation arithmetic is otherwise the
    // SAME code path (spearman_from_ranks) on a defined correlation.
    const double n = static_cast<double>(rank_a.size());
    const double sum_a = std::accumulate(rank_a.begin(), rank_a.end(), 0.0);
    const double sum_b = std::accumulate(rank_b.begin(), rank_b.end(), 0.0);
    const double mean_a = sum_a / n;
    const double mean_b = sum_b / n;
    double var_a = 0.0;
    double var_b = 0.0;
    for (std::size_t i = 0; i < rank_a.size(); ++i) {
        const double da = rank_a[i] - mean_a;
        const double db = rank_b[i] - mean_b;
        var_a += da * da;
        var_b += db * db;
    }
    if (std::sqrt(var_a * var_b) == 0.0) {
        return std::nullopt;
    }
    return spearman_from_ranks(rank_a, rank_b);
}

[[nodiscard]] inline double pairwise_cov(std::span<const double> a, std::span<const double> b) {
    const std::size_t count = std::min(a.size(), b.size());
    std::size_t n = 0;
    double sum_a = 0.0;
    double sum_b = 0.0;

    for (std::size_t t = 0; t < count; ++t) {
        if (is_finite(a[t]) && is_finite(b[t])) {
            sum_a += a[t];
            sum_b += b[t];
            ++n;
        }
    }
    if (n == 0) {
        return 0.0;
    }

    const double mean_a = sum_a / static_cast<double>(n);
    const double mean_b = sum_b / static_cast<double>(n);
    double acc = 0.0;
    for (std::size_t t = 0; t < count; ++t) {
        if (is_finite(a[t]) && is_finite(b[t])) {
            acc += (a[t] - mean_a) * (b[t] - mean_b);
        }
    }
    return acc / static_cast<double>(n);
}

// =====================================================================
// TICKET_1256_4 (F1'): TF-group rank pre-compaction primitives.
//
// The block-pairwise Spearman/covariance sweep (compute_pairwise_matrices)
// re-compacts and re-ranks BOTH full dense columns for every one of the
// N(N-1)/2 pairs — a per-pair scratch arena (av/bv/order/rank_a/rank_b =
// 36 B/dense-cell = 4.37 GB at the reference grid) that forces the solver to
// shed pair concurrency to 1 on a 62 GB machine. But missingness is STRUCTURAL:
// signals share at most a handful of DISTINCT finite-cell masks (one per
// timeframe group), so a pair's intersection depends only on the unordered
// (mask_a, mask_b) combo. Compacting+ranking each signal's column ONCE per
// distinct partner-mask (<= 4 variants/signal, <= 4N total) turns each pair
// into an accumulator-only dot product over precompacted, equal-length arrays —
// zero per-pair scratch, full-cpuCap parallelism.
//
// These primitives are BYTE-IDENTICAL to the per-pair path (AC4): the surviving
// cell set of `spearman_correlation(col_i, col_j)` is {t : finite(col_i[t]) &&
// finite(col_j[t])} = Mi ∩ Mj in dense-index scan order; compacting col_i to
// `finite(col_i[t]) && partner_mask.test(t)` (partner_mask == Mj's exact finite
// bitset) yields the SAME av in the SAME order, fractional_rank_into gives the
// SAME ranks, and spearman_from_ranks / the cov accumulator sum in the SAME
// order. No approximation, no statistics-policy change.
// =====================================================================

// A signal's finite-cell mask over the dense grid: one bit per cell (set iff
// the z-scored column is finite there). grid_size / 8 bytes (~14 MiB at the
// reference 114.6M-cell grid) — far cheaper than the 874 MiB dense column, so
// holding one per DISTINCT group (<= 10) is negligible. `words` is the packed
// bit storage; `finite_count` is the popcount (the compacted length against a
// self-intersection) and the grouping key's partner in the fingerprint.
struct FiniteMask {
    std::vector<std::uint64_t> words;  // ceil(grid_size / 64) words
    std::size_t grid_size = 0;
    std::size_t finite_count = 0;
    std::uint64_t fingerprint = 0;  // order-sensitive hash of the finite-cell set

    [[nodiscard]] bool test(std::size_t cell) const noexcept {
        return (words[cell >> 6] >> (cell & 63)) & 1ULL;
    }

    // TICKET_1256_4 (F2.4a): incremental construction — size the empty mask for
    // a grid, set bits as rows stream past (the chunked moments pre-pass), then
    // finalize_mask_fingerprint() once all bits are in.
    void resize_for_grid(std::size_t n_cells) {
        grid_size = n_cells;
        words.assign((n_cells + 63) / 64, 0ULL);
        finite_count = 0;
        fingerprint = 0;
    }
    void set(std::size_t cell) noexcept {
        words[cell >> 6] |= (1ULL << (cell & 63));
    }
};

// TICKET_1256_4 (F2.4a): finalize a mask built incrementally — popcount +
// FNV-1a fingerprint over the packed words. SHARED by build_finite_mask (the
// one-shot dense-column scan) and the chunked pre-pass's streaming mask build,
// so both producers yield the bit-identical fingerprint for the same finite
// set (TICKET_854 code reuse — a parallel fold would silently fork the
// grouping key). Fold the grid_size in first so masks of different lengths
// never alias.
inline void finalize_mask_fingerprint(FiniteMask& mask) {
    std::size_t count = 0;
    for (const auto w : mask.words) {
        count += static_cast<std::size_t>(std::popcount(w));
    }
    mask.finite_count = count;
    std::uint64_t h = 1469598103934665603ULL;
    const auto fold = [&](std::uint64_t v) {
        h ^= v;
        h *= 1099511628211ULL;
    };
    fold(static_cast<std::uint64_t>(mask.grid_size));
    for (const auto w : mask.words) fold(w);
    mask.fingerprint = h;
}

// Build the finite-cell mask + a collision-resistant fingerprint of a dense
// z-scored column. The fingerprint is an FNV-1a-style fold over the packed mask
// words (which encode the EXACT finite-cell set in dense-index order), so two
// signals fingerprint-equal iff their finite sets are bit-identical — the
// grouping key. Computed in one O(grid) scan, reusing the pre-pass column read.
[[nodiscard]] inline FiniteMask build_finite_mask(std::span<const double> column) {
    FiniteMask mask;
    mask.resize_for_grid(column.size());
    for (std::size_t t = 0; t < column.size(); ++t) {
        if (is_finite(column[t])) {
            mask.set(t);
        }
    }
    finalize_mask_fingerprint(mask);
    return mask;
}

// Compact `column` to the cells finite in BOTH the column AND `partner_mask`,
// in dense-index scan order, appending to `out` (cleared first). This is the
// `av`/`bv` build of the per-pair path with the partner's per-cell finite check
// replaced by its precomputed bitset — the surviving set and order are
// identical. Returns the compacted length (== |Mi ∩ Mj|).
inline void compact_against_mask(
    std::span<const double> column,
    const FiniteMask& partner_mask,
    std::vector<double>& out) {
    out.clear();
    const std::size_t count = std::min(column.size(), partner_mask.grid_size);
    for (std::size_t t = 0; t < count; ++t) {
        if (is_finite(column[t]) && partner_mask.test(t)) {
            out.push_back(column[t]);
        }
    }
}

// TICKET_1256_4 (F1'): a signal's column compacted (and optionally ranked)
// against ONE partner mask — the reusable per-(signal, partner-TF) artifact.
// `compacted` holds the raw values at Mi ∩ Mpartner (for covariance);
// `ranks` holds fractional_rank(compacted) (for Spearman). Both are in dense
// scan order so a pair is spearman_from_ranks(this.ranks, other.ranks) /
// pairwise_cov(this.compacted, other.compacted) with NO further filtering.
struct CompactedColumn {
    std::vector<double> compacted;  // raw values at Mi ∩ Mpartner (cov path)
    std::vector<double> ranks;      // fractional ranks of `compacted` (spearman path)
    bool ranked = false;
};

// Build a CompactedColumn for `column` against `partner_mask`. `need_ranks`
// controls whether the (Spearman) rank array is produced; `need_raw` keeps the
// compacted raw values (covariance). `order` is a caller-owned argsort scratch
// reused across builds. Byte-identical to the per-pair path's av + rank_a.
inline void build_compacted_column(
    std::span<const double> column,
    const FiniteMask& partner_mask,
    bool need_ranks,
    bool need_raw,
    std::vector<std::uint32_t>& order,
    CompactedColumn& out) {
    compact_against_mask(column, partner_mask, out.compacted);
    if (need_ranks) {
        fractional_rank_into(std::span<const double>(out.compacted), out.ranks, order);
        out.ranked = true;
    } else {
        out.ranked = false;
    }
    if (!need_raw) {
        // Covariance not needed: drop the raw payload once ranks are taken so a
        // Spearman-only pass never holds both (the ranks are the working set).
        out.compacted.clear();
        out.compacted.shrink_to_fit();
    }
}

// Spearman from two precompacted-and-ranked columns sharing the intersection
// mask. Byte-identical to spearman_correlation(col_i, col_j): SAME
// MIN_SPEARMAN_SAMPLES guard, SAME spearman_from_ranks arithmetic. The two rank
// arrays MUST have equal length (both compacted against the same intersection).
[[nodiscard]] inline double spearman_from_compacted(
    const CompactedColumn& a, const CompactedColumn& b) {
    if (a.ranks.size() < MIN_SPEARMAN_SAMPLES) {
        return 0.0;
    }
    return spearman_from_ranks(a.ranks, b.ranks);
}

// Pairwise covariance from two precompacted (raw) columns sharing the
// intersection mask. Byte-identical to pairwise_cov over the full dense columns
// BY CODE REUSE (TICKET_854): the compacted arrays are the exact surviving cells
// in the exact dense scan order, so calling the SAME pairwise_cov over them
// (every cell finite -> the is_finite guards all pass) produces the SAME
// instruction sequence and the SAME result. A hand-rewritten loop here would
// diverge at ULP level under -ffp-contract=fast / -march=native (the tight
// branchless loop FMA-contracts / auto-vectorizes differently than the
// branch-guarded dense loop) — breaking the AC4 bit-identity contract.
[[nodiscard]] inline double cov_from_compacted(
    const CompactedColumn& a, const CompactedColumn& b) {
    return pairwise_cov(std::span<const double>(a.compacted),
                        std::span<const double>(b.compacted));
}

} // namespace StratCraft::executor::statistics
