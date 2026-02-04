#pragma once

#include <cstddef>
#include <new>

#include "Allocator.hpp"
#include "Move.hpp"
#include "Result.hpp"
#include "Span.hpp"

namespace rs {

template <typename T>
class Vec {
public:
    explicit Vec(Allocator& alloc = defaultAllocator()) noexcept : alloc_(&alloc) {}

    Vec(const Vec&) = delete;
    Vec& operator=(const Vec&) = delete;

    Vec(Vec&& other) noexcept
        : alloc_(other.alloc_), data_(other.data_), size_(other.size_), capacity_(other.capacity_) {
        other.data_ = nullptr;
        other.size_ = 0;
        other.capacity_ = 0;
    }

    Vec& operator=(Vec&& other) noexcept {
        if (this == &other) {
            return *this;
        }
        destroyAll();
        release();
        alloc_ = other.alloc_;
        data_ = other.data_;
        size_ = other.size_;
        capacity_ = other.capacity_;
        other.data_ = nullptr;
        other.size_ = 0;
        other.capacity_ = 0;
        return *this;
    }

    ~Vec() {
        destroyAll();
        release();
    }

    [[nodiscard]] std::size_t size() const noexcept { return size_; }
    [[nodiscard]] bool empty() const noexcept { return size_ == 0; }
    [[nodiscard]] T* data() noexcept { return data_; }
    [[nodiscard]] const T* data() const noexcept { return data_; }

    [[nodiscard]] T& operator[](std::size_t i) noexcept { return data_[i]; }
    [[nodiscard]] const T& operator[](std::size_t i) const noexcept { return data_[i]; }

    [[nodiscard]] Span<T> span() noexcept { return Span<T>(data_, size_); }
    [[nodiscard]] Span<const T> span() const noexcept { return Span<const T>(data_, size_); }

    void clear() noexcept {
        destroyAll();
        size_ = 0;
    }

    Result<void> reserve(std::size_t newCapacity) noexcept {
        if (newCapacity <= capacity_) {
            return Result<void>::ok();
        }
        return growTo(newCapacity);
    }

    Result<void> resize(std::size_t newSize) noexcept {
        if (newSize < size_) {
            for (std::size_t i = newSize; i < size_; i++) {
                data_[i].~T();
            }
            size_ = newSize;
            return Result<void>::ok();
        }
        if (newSize > capacity_) {
            const std::size_t target = (newSize > capacity_ * 2) ? newSize : (capacity_ == 0 ? newSize : capacity_ * 2);
            auto r = growTo(target);
            if (!r.isOk()) {
                return r;
            }
        }
        for (std::size_t i = size_; i < newSize; i++) {
            new (&data_[i]) T();
        }
        size_ = newSize;
        return Result<void>::ok();
    }

    Result<void> pushBack(T v) noexcept {
        if (size_ == capacity_) {
            const std::size_t target = (capacity_ == 0) ? 8 : (capacity_ * 2);
            auto r = growTo(target);
            if (!r.isOk()) {
                return r;
            }
        }
        new (&data_[size_]) T(rs::move(v));
        size_++;
        return Result<void>::ok();
    }

    template <typename... Args>
    Result<T*> emplaceBack(Args&&... args) noexcept {
        if (size_ == capacity_) {
            const std::size_t target = (capacity_ == 0) ? 8 : (capacity_ * 2);
            auto r = growTo(target);
            if (!r.isOk()) {
                return Result<T*>::err(r.status());
            }
        }
        new (&data_[size_]) T(rs::forward<Args>(args)...);
        T* out = &data_[size_];
        size_++;
        return Result<T*>::ok(out);
    }

private:
    Allocator* alloc_ = nullptr;
    T* data_ = nullptr;
    std::size_t size_ = 0;
    std::size_t capacity_ = 0;

    void destroyAll() noexcept {
        for (std::size_t i = 0; i < size_; i++) {
            data_[i].~T();
        }
    }

    void release() noexcept {
        if (!data_) {
            return;
        }
        alloc_->free(alloc_->ctx, data_, alignof(T));
        data_ = nullptr;
        capacity_ = 0;
    }

    Result<void> growTo(std::size_t newCapacity) noexcept {
        const std::size_t bytes = newCapacity * sizeof(T);
        void* mem = alloc_->alloc(alloc_->ctx, bytes, alignof(T));
        if (!mem) {
            return Result<void>::err(Status::OutOfMemory);
        }
        T* newData = reinterpret_cast<T*>(mem);
        for (std::size_t i = 0; i < size_; i++) {
            new (&newData[i]) T(rs::move(data_[i]));
            data_[i].~T();
        }
        if (data_) {
            alloc_->free(alloc_->ctx, data_, alignof(T));
        }
        data_ = newData;
        capacity_ = newCapacity;
        return Result<void>::ok();
    }
};

} // namespace rs

