#pragma once

namespace rs {

enum class Status : int {
    Ok = 0,

    InvalidArgument,
    OutOfRange,
    Truncated,
    NotFound,
    Unsupported,

    IoError,
    OutOfMemory,

    BadFormat,
    DecompressFailed,
    ChecksumMismatch,
    SizeMismatch,
};

[[nodiscard]] constexpr bool ok(Status s) noexcept {
    return s == Status::Ok;
}

} // namespace rs

