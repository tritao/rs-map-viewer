#pragma once

#include "../rs/types.hpp"
#include <unordered_map>
#include <utility>

namespace rs::tooling {

template <typename State>
class RuntimeStore final {
public:
    i32 create() {
        for (i32 attempts = 0; attempts < 1000000; attempts++) {
            const i32 handle = nextHandle_++;
            if (handle <= 0) {
                nextHandle_ = 1;
                continue;
            }
            auto [it, inserted] = states_.emplace(handle, State{});
            if (inserted) {
                return it->first;
            }
        }
        return 0;
    }

    State* get(i32 handle) {
        if (handle <= 0) return nullptr;
        auto it = states_.find(handle);
        if (it == states_.end()) return nullptr;
        return &it->second;
    }

    const State* get(i32 handle) const {
        if (handle <= 0) return nullptr;
        const auto it = states_.find(handle);
        if (it == states_.end()) return nullptr;
        return &it->second;
    }

    bool destroy(i32 handle) {
        if (handle <= 0) return false;
        return states_.erase(handle) > 0;
    }

    bool isValid(i32 handle) const {
        return get(handle) != nullptr;
    }

private:
    std::unordered_map<i32, State> states_{};
    i32 nextHandle_ = 1;
};

template <typename Entry>
class HandleStore final {
public:
    i32 create(const Entry& entry) {
        for (i32 attempts = 0; attempts < 1000000; attempts++) {
            const i32 handle = nextHandle_++;
            if (handle <= 0) {
                nextHandle_ = 1;
                continue;
            }
            auto [it, inserted] = entries_.emplace(handle, entry);
            if (inserted) {
                return it->first;
            }
        }
        return 0;
    }

    Entry* get(i32 handle) {
        if (handle <= 0) return nullptr;
        auto it = entries_.find(handle);
        if (it == entries_.end()) return nullptr;
        return &it->second;
    }

    const Entry* get(i32 handle) const {
        if (handle <= 0) return nullptr;
        const auto it = entries_.find(handle);
        if (it == entries_.end()) return nullptr;
        return &it->second;
    }

    bool destroy(i32 handle) {
        if (handle <= 0) return false;
        return entries_.erase(handle) > 0;
    }

    template <typename Predicate>
    void eraseIf(Predicate&& pred) {
        for (auto it = entries_.begin(); it != entries_.end();) {
            if (pred(it->second)) {
                it = entries_.erase(it);
            } else {
                ++it;
            }
        }
    }

private:
    std::unordered_map<i32, Entry> entries_{};
    i32 nextHandle_ = 1;
};

} // namespace rs::tooling
