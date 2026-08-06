#pragma once

#include <nonabt/data/data_feed.hpp>

#include <chrono>
#include <cstddef>
#include <expected>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

namespace nonabt {

/// Column mapping for CSV files
struct CsvColumnMap {
    int datetime = 0;
    int time = -1; // -1 means no separate time column
    int open = 1;
    int high = 2;
    int low = 3;
    int close = 4;
    int volume = 5;
    int openinterest = 6;
};

/// CsvData - CSV file data feed.
/// Reads OHLCV data from CSV files with configurable column mapping.
class CsvData : public DataFeed {
public:
    struct Params {
        std::string filename;
        CsvColumnMap columns;
        std::string date_format = "%Y-%m-%d";
        std::string time_format = "%H:%M:%S";
        char separator = ',';
        bool has_headers = true;
        std::optional<DateTime> fromdate;
        std::optional<DateTime> todate;
    };

    explicit CsvData(Params params)
        : params_(std::move(params)) {}

    /// Clone this data feed (creates a fresh CsvData from the same params)
    [[nodiscard]] std::unique_ptr<DataFeed> clone() const override {
        return std::make_unique<CsvData>(params_);
    }

    /// Load all data from the CSV file
    [[nodiscard]] bool load() override {
        if (loaded_) return false;
        loaded_ = true;

        std::ifstream file(params_.filename);
        if (!file.is_open()) return false;

        std::string line_str;

        // Skip header if present
        if (params_.has_headers && !std::getline(file, line_str)) {
            return false;
        }

        while (std::getline(file, line_str)) {
            auto fields = split(line_str, params_.separator);
            if (fields.empty()) continue;

            auto max_col = max_column();
            if (fields.size() <= static_cast<std::size_t>(max_col)) continue;

            // Parse datetime
            DateTime dt;
            if (params_.columns.time >= 0 && 
                static_cast<std::size_t>(params_.columns.time) < fields.size()) {
                dt = parse_datetime(fields[static_cast<std::size_t>(params_.columns.datetime)],
                                    fields[static_cast<std::size_t>(params_.columns.time)]);
            } else {
                dt = parse_datetime(fields[static_cast<std::size_t>(params_.columns.datetime)]);
            }

            // Apply date filtering
            if (params_.fromdate && dt < *params_.fromdate) continue;
            if (params_.todate && dt > *params_.todate) continue;

            datetime_.forward(dt);
            open_.forward(parse_double(fields[static_cast<std::size_t>(params_.columns.open)]));
            high_.forward(parse_double(fields[static_cast<std::size_t>(params_.columns.high)]));
            low_.forward(parse_double(fields[static_cast<std::size_t>(params_.columns.low)]));
            close_.forward(parse_double(fields[static_cast<std::size_t>(params_.columns.close)]));

            if (params_.columns.volume >= 0 &&
                static_cast<std::size_t>(params_.columns.volume) < fields.size()) {
                volume_.forward(parse_double(fields[static_cast<std::size_t>(params_.columns.volume)]));
            } else {
                volume_.forward(0.0);
            }

            if (params_.columns.openinterest >= 0 &&
                static_cast<std::size_t>(params_.columns.openinterest) < fields.size()) {
                openinterest_.forward(parse_double(fields[static_cast<std::size_t>(params_.columns.openinterest)]));
            } else {
                openinterest_.forward(0.0);
            }
        }

        // Reset to beginning after loading
        datetime_.home();
        open_.home();
        high_.home();
        low_.home();
        close_.home();
        volume_.home();
        openinterest_.home();

        return size() > 0;
    }

private:
    /// Maximum required column index (excludes optional volume/openinterest
    /// which are bounds-checked individually during parsing)
    [[nodiscard]] int max_column() const noexcept {
        int m = params_.columns.datetime;
        m = std::max(m, params_.columns.open);
        m = std::max(m, params_.columns.high);
        m = std::max(m, params_.columns.low);
        m = std::max(m, params_.columns.close);
        return m;
    }

    [[nodiscard]] static std::vector<std::string> split(const std::string& s, char delim) {
        std::vector<std::string> result;
        std::istringstream stream(s);
        std::string token;
        while (std::getline(stream, token, delim)) {
            result.push_back(token);
        }
        return result;
    }

    [[nodiscard]] static double parse_double(const std::string& s) {
        try {
            return std::stod(s);
        } catch (...) {
            return 0.0;
        }
    }

    [[nodiscard]] DateTime parse_datetime(const std::string& date_str, 
                                          const std::string& time_str = "") const {
        std::tm tm = {};
        std::istringstream ss(date_str);
        ss >> std::get_time(&tm, params_.date_format.c_str());
        if (ss.fail()) {
            return DateTime{};
        }

        if (!time_str.empty()) {
            std::istringstream ss_time(time_str);
            ss_time >> std::get_time(&tm, params_.time_format.c_str());
        }

        auto time = std::mktime(&tm);
        return std::chrono::system_clock::from_time_t(time);
    }

    Params params_;
    bool loaded_ = false;
};

} // namespace nonabt
