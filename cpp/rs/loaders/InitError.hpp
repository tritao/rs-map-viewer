#pragma once

#include "../core/Status.hpp"
#include "../types.hpp"

namespace rs {

enum class InitErrorCode : u8 {
    Unsupported,
    MissingIndex,
    MissingArchive,
    MissingFile,
    DecodeFailed,
    InvalidArgument,
};

struct InitError final {
    InitErrorCode code = InitErrorCode::Unsupported;
    Status status = Status::Ok;

    // Optional context for debugging/diagnostics (use only string literals).
    const char* context = nullptr;

    // Optional ids (use -1 when not applicable).
    i32 indexId = -1;
    i32 archiveId = -1;
    i32 fileId = -1;

    static InitError unsupported(const char* ctx = nullptr) noexcept {
        InitError e{};
        e.code = InitErrorCode::Unsupported;
        e.status = Status::Unsupported;
        e.context = ctx;
        return e;
    }

    static InitError invalidArgument(const char* ctx = nullptr) noexcept {
        InitError e{};
        e.code = InitErrorCode::InvalidArgument;
        e.status = Status::InvalidArgument;
        e.context = ctx;
        return e;
    }

    static InitError missingIndex(i32 id, Status s = Status::NotFound, const char* ctx = nullptr) noexcept {
        InitError e{};
        e.code = InitErrorCode::MissingIndex;
        e.status = s;
        e.context = ctx;
        e.indexId = id;
        return e;
    }

    static InitError missingArchive(i32 index, i32 archive, Status s = Status::NotFound, const char* ctx = nullptr) noexcept {
        InitError e{};
        e.code = InitErrorCode::MissingArchive;
        e.status = s;
        e.context = ctx;
        e.indexId = index;
        e.archiveId = archive;
        return e;
    }

    static InitError missingFile(i32 index, i32 archive, i32 file, Status s = Status::NotFound, const char* ctx = nullptr) noexcept {
        InitError e{};
        e.code = InitErrorCode::MissingFile;
        e.status = s;
        e.context = ctx;
        e.indexId = index;
        e.archiveId = archive;
        e.fileId = file;
        return e;
    }

    static InitError decodeFailed(Status s, const char* ctx = nullptr) noexcept {
        InitError e{};
        e.code = InitErrorCode::DecodeFailed;
        e.status = s;
        e.context = ctx;
        return e;
    }
};

} // namespace rs

