#pragma once

#include <cstddef>

#include "../types.hpp"
#include "Allocator.hpp"
#include "Move.hpp"
#include "Result.hpp"
#include "Span.hpp"
#include "Status.hpp"
#include "Str.hpp"
#include "Vec.hpp"

namespace rs {

// Arena for stable byte-string storage (STL-free).
//
// Core policy:
// - Callers allocate decoded cache strings here and store them as `Str` views.
// - Strings are copied verbatim (no encoding conversion).
// - A trailing '\0' is appended for convenience in tools/tests, but the owning type is `Str` (ptr+len).
class StringArena final {
public:
    explicit StringArena(Allocator& alloc, std::size_t defaultBlockSize = 4096) noexcept
        : alloc_(&alloc), defaultBlockSize_(defaultBlockSize), blocks_(alloc) {}

    StringArena() = default;

    StringArena(const StringArena&) = delete;
    StringArena& operator=(const StringArena&) = delete;

    StringArena(StringArena&& other) noexcept { *this = rs::move(other); }
    StringArena& operator=(StringArena&& other) noexcept {
        if (this == &other) {
            return *this;
        }
        release();
        alloc_ = other.alloc_;
        defaultBlockSize_ = other.defaultBlockSize_;
        blocks_ = rs::move(other.blocks_);
        other.alloc_ = nullptr;
        other.defaultBlockSize_ = 0;
        return *this;
    }

    ~StringArena() { release(); }

    Result<Str> copyBytes(Span<const u8> bytes) noexcept {
        if (!alloc_) {
            return Result<Str>::err(Status::InvalidArgument);
        }

        const std::size_t len = bytes.size();
        const std::size_t needed = len + 1; // trailing '\0' for convenience in tools/tests
        if (needed == 0) {
            return Result<Str>::err(Status::OutOfRange);
        }

        char* dst = nullptr;
        auto rr = allocBytes(needed, &dst);
        if (!rr.isOk()) {
            return Result<Str>::err(rr.status());
        }

        for (std::size_t i = 0; i < len; i++) {
            dst[i] = static_cast<char>(bytes[i]);
        }
        dst[len] = '\0';

        Str s{};
        s.data = dst;
        s.len = len;
        return Result<Str>::ok(s);
    }

    void reset() noexcept { release(); }

private:
    struct Block final {
        char* data = nullptr;
        std::size_t capacity = 0;
        std::size_t used = 0;
    };

    Allocator* alloc_ = nullptr;
    std::size_t defaultBlockSize_ = 0;
    Vec<Block> blocks_{};

    void release() noexcept {
        if (!alloc_) {
            blocks_.clear();
            return;
        }
        for (std::size_t i = 0; i < blocks_.size(); i++) {
            Block& b = blocks_[i];
            if (b.data) {
                alloc_->free(alloc_->ctx, b.data, alignof(char));
                b.data = nullptr;
            }
            b.capacity = 0;
            b.used = 0;
        }
        blocks_.clear();
    }

    Result<void> ensureBlock(std::size_t needed) noexcept {
        if (needed == 0) {
            return Result<void>::err(Status::InvalidArgument);
        }

        if (blocks_.size() > 0) {
            Block& b = blocks_[blocks_.size() - 1];
            if (b.data && (b.capacity - b.used) >= needed) {
                return Result<void>::ok();
            }
        }

        const std::size_t cap = (needed > defaultBlockSize_) ? needed : defaultBlockSize_;
        void* mem = alloc_->alloc(alloc_->ctx, cap, alignof(char));
        if (!mem) {
            return Result<void>::err(Status::OutOfMemory);
        }

        Block nb{};
        nb.data = static_cast<char*>(mem);
        nb.capacity = cap;
        nb.used = 0;

        auto pr = blocks_.emplaceBack(nb);
        if (!pr.isOk()) {
            alloc_->free(alloc_->ctx, mem, alignof(char));
            return Result<void>::err(pr.status());
        }

        return Result<void>::ok();
    }

    Result<void> allocBytes(std::size_t needed, char** out) noexcept {
        if (!out) {
            return Result<void>::err(Status::InvalidArgument);
        }
        *out = nullptr;

        auto er = ensureBlock(needed);
        if (!er.isOk()) {
            return er;
        }

        Block& b = blocks_[blocks_.size() - 1];
        char* p = b.data + b.used;
        b.used += needed;
        *out = p;
        return Result<void>::ok();
    }
};

} // namespace rs
