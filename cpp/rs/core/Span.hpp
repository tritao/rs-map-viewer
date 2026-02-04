#pragma once

#include <cstddef>

namespace rs {

template <typename T>
class Span {
public:
    constexpr Span() noexcept = default;
    constexpr Span(T* data, std::size_t size) noexcept : data_(data), size_(size) {}

    [[nodiscard]] constexpr T* data() const noexcept { return data_; }
    [[nodiscard]] constexpr std::size_t size() const noexcept { return size_; }
    [[nodiscard]] constexpr bool empty() const noexcept { return size_ == 0; }

    [[nodiscard]] constexpr T& operator[](std::size_t i) const noexcept { return data_[i]; }

    [[nodiscard]] constexpr Span subspan(std::size_t offset, std::size_t length) const noexcept {
        return Span(data_ + offset, length);
    }

private:
    T* data_ = nullptr;
    std::size_t size_ = 0;
};

} // namespace rs

