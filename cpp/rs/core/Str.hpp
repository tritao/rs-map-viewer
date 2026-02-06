#pragma once

#include <cstddef>

namespace rs {

// Non-owning string view for core code (STL-free).
// Intended to point into memory owned by StringArena (or other stable storage).
struct Str final {
    const char* data = nullptr;
    std::size_t len = 0;

    [[nodiscard]] bool isEmpty() const noexcept { return len == 0; }
};

} // namespace rs

