#pragma once

#include <type_traits>

namespace rs {

template <typename T>
[[nodiscard]] constexpr T&& move(T& v) noexcept {
    return static_cast<T&&>(v);
}

template <typename T>
[[nodiscard]] constexpr T&& forward(std::remove_reference_t<T>& v) noexcept {
    return static_cast<T&&>(v);
}

template <typename T>
[[nodiscard]] constexpr T&& forward(std::remove_reference_t<T>&& v) noexcept {
    static_assert(!std::is_lvalue_reference_v<T>, "rs::forward called with lvalue reference type");
    return static_cast<T&&>(v);
}

template <typename T>
constexpr void swap(T& a, T& b) noexcept {
    T tmp = move(a);
    a = move(b);
    b = move(tmp);
}

} // namespace rs
