#pragma once

#include <cstddef>
#include <new>
#include <type_traits>

#include "../types.hpp"
#include "Move.hpp"

namespace rs {

template <typename T, typename E>
class Expected {
public:
    Expected(const Expected&) = delete;
    Expected& operator=(const Expected&) = delete;

    Expected(Expected&& other) noexcept : hasValue_(other.hasValue_) {
        if (hasValue_) {
            new (&storage_) T(rs::move(other.value()));
        } else {
            new (&storage_) E(rs::move(other.error()));
        }
    }

    Expected& operator=(Expected&& other) noexcept {
        if (this == &other) {
            return *this;
        }
        destroyActive();
        hasValue_ = other.hasValue_;
        if (hasValue_) {
            new (&storage_) T(rs::move(other.value()));
        } else {
            new (&storage_) E(rs::move(other.error()));
        }
        return *this;
    }

    ~Expected() { destroyActive(); }

    [[nodiscard]] static Expected ok(T v) noexcept(std::is_nothrow_move_constructible_v<T>) {
        return Expected(true, rs::move(v));
    }

    [[nodiscard]] static Expected err(E e) noexcept(std::is_nothrow_move_constructible_v<E>) {
        return Expected(false, rs::move(e));
    }

    [[nodiscard]] bool isOk() const noexcept { return hasValue_; }

    [[nodiscard]] T& value() noexcept { return *reinterpret_cast<T*>(&storage_); }
    [[nodiscard]] const T& value() const noexcept { return *reinterpret_cast<const T*>(&storage_); }

    [[nodiscard]] E& error() noexcept { return *reinterpret_cast<E*>(&storage_); }
    [[nodiscard]] const E& error() const noexcept { return *reinterpret_cast<const E*>(&storage_); }

private:
    static constexpr size_t kSize = (sizeof(T) > sizeof(E)) ? sizeof(T) : sizeof(E);
    static constexpr size_t kAlign = (alignof(T) > alignof(E)) ? alignof(T) : alignof(E);
    using Storage = std::aligned_storage_t<kSize, kAlign>;

    Expected(bool hasValue, T&& v) noexcept(std::is_nothrow_move_constructible_v<T>) : hasValue_(hasValue) {
        new (&storage_) T(rs::move(v));
    }

    Expected(bool hasValue, E&& e) noexcept(std::is_nothrow_move_constructible_v<E>) : hasValue_(hasValue) {
        new (&storage_) E(rs::move(e));
    }

    void destroyActive() noexcept {
        if (hasValue_) {
            destroyValue();
        } else {
            destroyError();
        }
    }

    void destroyValue() noexcept {
        if (!hasValue_) {
            return;
        }
        hasValue_ = false;
        value().~T();
    }

    void destroyError() noexcept {
        if (hasValue_) {
            return;
        }
        error().~E();
    }

    bool hasValue_ = false;
    Storage storage_{};
};

template <typename E>
class Expected<void, E> {
public:
    Expected(const Expected&) = delete;
    Expected& operator=(const Expected&) = delete;

    Expected(Expected&& other) noexcept : isOk_(other.isOk_) {
        if (!isOk_) {
            new (&storage_) E(rs::move(other.error()));
        }
    }

    Expected& operator=(Expected&& other) noexcept {
        if (this == &other) {
            return *this;
        }
        destroyError();
        isOk_ = other.isOk_;
        if (!isOk_) {
            new (&storage_) E(rs::move(other.error()));
        }
        return *this;
    }

    ~Expected() { destroyError(); }

    [[nodiscard]] static Expected ok() noexcept { return Expected(true); }
    [[nodiscard]] static Expected err(E e) noexcept(std::is_nothrow_move_constructible_v<E>) { return Expected(false, rs::move(e)); }

    [[nodiscard]] bool isOk() const noexcept { return isOk_; }

    [[nodiscard]] E& error() noexcept { return *reinterpret_cast<E*>(&storage_); }
    [[nodiscard]] const E& error() const noexcept { return *reinterpret_cast<const E*>(&storage_); }

private:
    using Storage = std::aligned_storage_t<sizeof(E), alignof(E)>;

    explicit Expected(bool ok) noexcept : isOk_(ok) {}
    Expected(bool ok, E&& e) noexcept(std::is_nothrow_move_constructible_v<E>) : isOk_(ok) { new (&storage_) E(rs::move(e)); }

    void destroyError() noexcept {
        if (isOk_) {
            return;
        }
        error().~E();
        isOk_ = true;
    }

    bool isOk_ = true;
    Storage storage_{};
};

} // namespace rs
