#pragma once

#include "Move.hpp"

namespace rs {

template <typename F>
class ScopeGuard final {
public:
    explicit ScopeGuard(F&& fn) noexcept : fn_(rs::move(fn)), active_(true) {}

    ScopeGuard(const ScopeGuard&) = delete;
    ScopeGuard& operator=(const ScopeGuard&) = delete;

    ScopeGuard(ScopeGuard&& other) noexcept : fn_(rs::move(other.fn_)), active_(other.active_) {
        other.active_ = false;
    }

    ScopeGuard& operator=(ScopeGuard&& other) noexcept {
        if (this == &other) {
            return *this;
        }
        if (active_) {
            fn_();
        }
        fn_ = rs::move(other.fn_);
        active_ = other.active_;
        other.active_ = false;
        return *this;
    }

    ~ScopeGuard() {
        if (active_) {
            fn_();
        }
    }

    void dismiss() noexcept { active_ = false; }

private:
    F fn_;
    bool active_ = false;
};

template <typename F>
[[nodiscard]] inline ScopeGuard<F> makeScopeGuard(F&& fn) noexcept {
    return ScopeGuard<F>(rs::forward<F>(fn));
}

} // namespace rs

