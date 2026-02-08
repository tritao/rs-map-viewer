#pragma once

#include <cstddef>

namespace rs {

// Non-owning string view for core code (STL-free).
//
// Core policy (port-friendly):
// - `Str` is a byte string: it is not guaranteed to be UTF-8.
// - `data` must remain valid for the lifetime of the consumer; config/type loaders
//   typically point into `StringArena` storage.
// - `data` may be null when `len == 0`.
// - Storage commonly includes a trailing '\0' for tooling convenience, but callers must
//   still respect `len` (embedded '\0' bytes are allowed by the type).
struct Str final {
    const char* data = nullptr;
    std::size_t len = 0;

    [[nodiscard]] bool isEmpty() const noexcept { return len == 0; }
};

} // namespace rs
