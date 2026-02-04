#pragma once

#include <cstddef>
#include <cstdlib>

namespace rs {

struct Allocator {
    void* ctx = nullptr;

    void* (*alloc)(void* ctx, std::size_t size, std::size_t alignment) = nullptr;
    void* (*realloc)(void* ctx, void* ptr, std::size_t newSize, std::size_t alignment) = nullptr;
    void (*free)(void* ctx, void* ptr, std::size_t alignment) = nullptr;
};

inline void* mallocAlloc(void*, std::size_t size, std::size_t) {
    return std::malloc(size);
}

inline void* mallocRealloc(void*, void* ptr, std::size_t newSize, std::size_t) {
    return std::realloc(ptr, newSize);
}

inline void mallocFree(void*, void* ptr, std::size_t) {
    std::free(ptr);
}

inline Allocator& defaultAllocator() {
    static Allocator a{
        nullptr,
        &mallocAlloc,
        &mallocRealloc,
        &mallocFree,
    };
    return a;
}

} // namespace rs

