#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace nonabt {

/// Commission scheme types
enum class CommissionType : std::uint8_t {
    Percentage,   // Percentage of trade value
    Fixed,        // Fixed amount per trade
    PerShare,     // Fixed amount per share/contract
};

/// Commission scheme configuration
struct CommissionInfo {
    CommissionType type = CommissionType::Percentage;
    double commission = 0.0;     // Rate or fixed amount
    double min_commission = 0.0; // Minimum commission per trade

    /// Calculate commission for a given trade
    [[nodiscard]] double calculate(double size, double price) const noexcept {
        double comm = 0.0;
        double abs_size = std::abs(size);

        switch (type) {
            case CommissionType::Percentage:
                comm = abs_size * price * commission;
                break;
            case CommissionType::Fixed:
                comm = commission;
                break;
            case CommissionType::PerShare:
                comm = abs_size * commission;
                break;
        }

        return std::max(comm, min_commission);
    }
};

/// Tiered commission — volume-based commission tiers.
/// Lower tiers apply first; once a tier threshold is exceeded, the next tier's rate applies
/// to the excess volume.
struct TieredCommission {
    struct Tier {
        double threshold;  // Volume threshold (cumulative shares/contracts)
        double rate;       // Commission rate for volume within this tier
    };

    std::vector<Tier> tiers;        // Must be sorted by threshold ascending
    CommissionType tier_type = CommissionType::PerShare; // How rate is applied
    double min_commission = 0.0;

    /// Calculate tiered commission
    [[nodiscard]] double calculate(double size, double price) const noexcept {
        double abs_size = std::abs(size);
        double comm = 0.0;
        double remaining = abs_size;

        double prev_threshold = 0.0;
        for (const auto& tier : tiers) {
            double tier_volume = tier.threshold - prev_threshold;
            double applicable = std::min(remaining, tier_volume);
            if (applicable <= 0.0) break;

            switch (tier_type) {
                case CommissionType::PerShare:
                    comm += applicable * tier.rate;
                    break;
                case CommissionType::Percentage:
                    comm += applicable * price * tier.rate;
                    break;
                case CommissionType::Fixed:
                    comm += tier.rate;
                    remaining = 0.0;
                    break;
            }

            remaining -= applicable;
            prev_threshold = tier.threshold;
            if (remaining <= 0.0) break;
        }

        // Any remaining volume uses the last tier rate
        if (remaining > 0.0 && !tiers.empty()) {
            switch (tier_type) {
                case CommissionType::PerShare:
                    comm += remaining * tiers.back().rate;
                    break;
                case CommissionType::Percentage:
                    comm += remaining * price * tiers.back().rate;
                    break;
                case CommissionType::Fixed:
                    break;
            }
        }

        return std::max(comm, min_commission);
    }
};

/// Interactive Brokers commission scheme.
/// Per-share with min/max cap per order.
struct IBCommission {
    double per_share = 0.005;     // Default IB rate: $0.005 per share
    double min_per_order = 1.0;   // Minimum $1.00 per order
    double max_pct_of_value = 0.01; // Maximum 1% of trade value

    /// Calculate IB-style commission
    [[nodiscard]] double calculate(double size, double price) const noexcept {
        double abs_size = std::abs(size);
        double comm = abs_size * per_share;

        // Apply minimum
        comm = std::max(comm, min_per_order);

        // Apply maximum (percentage of trade value)
        double max_comm = abs_size * price * max_pct_of_value;
        comm = std::min(comm, max_comm);

        return comm;
    }
};

} // namespace nonabt
