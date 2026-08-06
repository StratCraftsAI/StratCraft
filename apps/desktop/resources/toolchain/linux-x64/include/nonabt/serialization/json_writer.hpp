#pragma once

#include <cmath>
#include <cstddef>
#include <sstream>
#include <string>
#include <string_view>

namespace nonabt {

/// Minimal JSON writer for result serialization.
/// Produces compact JSON without external dependencies.
class JsonWriter {
public:
    JsonWriter() { ss_ << std::fixed; }

    void begin_object() { comma_if_needed(); ss_ << '{'; needs_comma_.push_back(false); }
    void end_object() { needs_comma_.pop_back(); ss_ << '}'; mark_written(); }

    void begin_array() { comma_if_needed(); ss_ << '['; needs_comma_.push_back(false); }
    void end_array() { needs_comma_.pop_back(); ss_ << ']'; mark_written(); }

    void key(std::string_view k) {
        comma_if_needed();
        write_string(k);
        ss_ << ':';
        // Reset comma flag — the upcoming value is part of this key:value pair,
        // not a separate element that needs a leading comma.
        if (!needs_comma_.empty()) {
            needs_comma_.back() = false;
        }
    }

    void value_string(std::string_view v) {
        comma_if_needed();
        write_string(v);
        mark_written();
    }

    void value_bool(bool v) {
        comma_if_needed();
        ss_ << (v ? "true" : "false");
        mark_written();
    }

    void value_null() {
        comma_if_needed();
        ss_ << "null";
        mark_written();
    }

    void value_int(long long v) {
        comma_if_needed();
        ss_ << v;
        mark_written();
    }

    void value_uint(unsigned long long v) {
        comma_if_needed();
        ss_ << v;
        mark_written();
    }

    void value_double(double v, int precision = 6) {
        comma_if_needed();
        if (std::isnan(v) || std::isinf(v)) {
            ss_ << "null";
        } else {
            auto old_prec = ss_.precision(precision);
            ss_ << v;
            ss_.precision(old_prec);
        }
        mark_written();
    }

    /// Write key:value pairs (convenience)
    void kv_string(std::string_view k, std::string_view v) { key(k); value_string(v); }
    void kv_bool(std::string_view k, bool v) { key(k); value_bool(v); }
    void kv_int(std::string_view k, long long v) { key(k); value_int(v); }
    void kv_uint(std::string_view k, unsigned long long v) { key(k); value_uint(v); }
    void kv_double(std::string_view k, double v, int prec = 6) { key(k); value_double(v, prec); }

    [[nodiscard]] std::string str() const { return ss_.str(); }

private:
    void comma_if_needed() {
        if (!needs_comma_.empty() && needs_comma_.back()) {
            ss_ << ',';
        }
    }

    void mark_written() {
        if (!needs_comma_.empty()) {
            needs_comma_.back() = true;
        }
    }

    void write_string(std::string_view s) {
        ss_ << '"';
        for (char c : s) {
            switch (c) {
                case '"': ss_ << "\\\""; break;
                case '\\': ss_ << "\\\\"; break;
                case '\n': ss_ << "\\n"; break;
                case '\r': ss_ << "\\r"; break;
                case '\t': ss_ << "\\t"; break;
                default:
                    if (static_cast<unsigned char>(c) < 0x20) {
                        // Control character — skip
                    } else {
                        ss_ << c;
                    }
                    break;
            }
        }
        ss_ << '"';
    }

    std::ostringstream ss_;
    std::vector<bool> needs_comma_;
};

} // namespace nonabt
