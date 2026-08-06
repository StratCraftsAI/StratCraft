/**
 * Live Engine Event Bus
 *
 * TICKET_613: Typed event dispatch for Actor Model.
 * subscribe(EventType, Handler) / publish(Event) pattern.
 */

#pragma once

#include "event_types.hpp"

#include <vector>
#include <functional>
#include <unordered_map>

namespace StratCraft::executor::live {

class EventBus {
public:
    using Handler = std::function<void(const Event&)>;

    void subscribe(EventType type, Handler handler) {
        handlers_[type].push_back(std::move(handler));
    }

    void publish(const Event& event) {
        EventType type = static_cast<EventType>(event.index());
        if (auto it = handlers_.find(type); it != handlers_.end()) {
            for (auto& handler : it->second) {
                handler(event);
            }
        }
    }

    void clear() {
        handlers_.clear();
    }

    [[nodiscard]] std::size_t handler_count(EventType type) const {
        auto it = handlers_.find(type);
        return it != handlers_.end() ? it->second.size() : 0;
    }

private:
    std::unordered_map<EventType, std::vector<Handler>> handlers_;
};

} // namespace StratCraft::executor::live
