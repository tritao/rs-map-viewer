#pragma once

#include <new>
#include <type_traits>

#include "Status.hpp"
#include "Move.hpp"

namespace rs {

template <typename T>
class Result {
public:
    Result(const Result&) = delete;
    Result& operator=(const Result&) = delete;

    Result(Result&& other) noexcept : status_(other.status_), hasValue_(other.hasValue_) {
        if (hasValue_) {
            new (&storage_) T(rs::move(other.value()));
            other.destroyValue();
            other.status_ = Status::Ok;
        }
    }

    Result& operator=(Result&& other) noexcept {
        if (this == &other) {
            return *this;
        }
        destroyValue();
        status_ = other.status_;
        hasValue_ = other.hasValue_;
        if (hasValue_) {
            new (&storage_) T(rs::move(other.value()));
            other.destroyValue();
            other.status_ = Status::Ok;
        }
        return *this;
    }

    ~Result() { destroyValue(); }

    [[nodiscard]] static Result ok(T v) noexcept(std::is_nothrow_move_constructible_v<T>) {
        return Result(Status::Ok, rs::move(v));
    }

    [[nodiscard]] static Result err(Status s) noexcept {
        return Result(s);
    }

    [[nodiscard]] Status status() const noexcept { return status_; }
    [[nodiscard]] bool isOk() const noexcept { return status_ == Status::Ok; }

    [[nodiscard]] T& value() noexcept { return *reinterpret_cast<T*>(&storage_); }
    [[nodiscard]] const T& value() const noexcept { return *reinterpret_cast<const T*>(&storage_); }

private:
    using Storage = std::aligned_storage_t<sizeof(T), alignof(T)>;

    explicit Result(Status s) noexcept : status_(s), hasValue_(false) {}
    Result(Status s, T&& v) noexcept(std::is_nothrow_move_constructible_v<T>) : status_(s), hasValue_(true) {
        new (&storage_) T(rs::move(v));
    }

    void destroyValue() noexcept {
        if (!hasValue_) {
            return;
        }
        hasValue_ = false;
        value().~T();
    }

    Status status_ = Status::Ok;
    bool hasValue_ = false;
    Storage storage_{};
};

template <>
class Result<void> {
public:
    [[nodiscard]] static Result ok() noexcept { return Result(Status::Ok); }
    [[nodiscard]] static Result err(Status s) noexcept { return Result(s); }

    [[nodiscard]] Status status() const noexcept { return status_; }
    [[nodiscard]] bool isOk() const noexcept { return status_ == Status::Ok; }

private:
    explicit Result(Status s) noexcept : status_(s) {}
    Status status_ = Status::Ok;
};

// Helper macros: explicit return type required to keep control flow obvious without exceptions.
#define RS_TRY_ASSIGN(ReturnResultType, name, expr) \
    auto name##_result = (expr);                    \
    if (!name##_result.isOk()) {                    \
        return ReturnResultType::err(name##_result.status()); \
    }                                               \
    auto name = rs::move(name##_result.value())

#define RS_TRY_STATUS(name, expr) \
    do {                          \
        const rs::Status name = (expr); \
        if (!rs::ok(name)) {      \
            return name;          \
        }                         \
    } while (0)

} // namespace rs
