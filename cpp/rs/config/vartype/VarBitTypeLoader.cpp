#include "VarBitTypeLoader.hpp"

#include <cstddef>

#include "../../cache/format/Archive.hpp"
#include "../../cache/format/ArchiveFile.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"
#include "VarBitType.hpp"

namespace rs {

static i32 computeMaxFileId(Span<const ArchiveFile> files) noexcept {
    i32 maxId = -1;
    for (std::size_t i = 0; i < files.size(); i++) {
        const i32 id = files[i].id;
        if (id > maxId) {
            maxId = id;
        }
    }
    return maxId;
}

Result<VarBitTypeLoader> VarBitTypeLoader::fromArchive(const CacheInfo& cacheInfo, const Archive& archive, Allocator& alloc) noexcept {
    const Span<const ArchiveFile> files = archive.files();
    const i32 maxId = computeMaxFileId(files);
    const i32 count = (maxId < 0) ? 0 : (maxId + 1);

    Vec<VarBitType> types(alloc);
    auto rr = types.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<VarBitTypeLoader>::err(rr.status());
    }
    for (i32 i = 0; i < count; i++) {
        types[static_cast<std::size_t>(i)] = VarBitType(i, cacheInfo);
    }

    Vec<u8> present(alloc);
    rr = present.resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return Result<VarBitTypeLoader>::err(rr.status());
    }
    for (std::size_t i = 0; i < present.size(); i++) {
        present[i] = 0;
    }

    for (std::size_t i = 0; i < files.size(); i++) {
        const ArchiveFile& f = files[i];
        if (f.id < 0) {
            continue;
        }
        const i32 id = f.id;
        if (id >= count) {
            continue;
        }
        const Span<const u8> bytes = f.data.span();
        Uint8ArrayReader reader(bytes, 0);
        TypeDecodeError err{};
        Status s = decodeType(types[static_cast<std::size_t>(id)], reader, &err);
        if (!ok(s)) {
            // Keep going; mark as absent so callers see NotFound for this id.
            present[static_cast<std::size_t>(id)] = 0;
            continue;
        }
        present[static_cast<std::size_t>(id)] = 1;
    }

    return Result<VarBitTypeLoader>::ok(VarBitTypeLoader(rs::move(types), rs::move(present), count));
}

Status VarBitTypeLoader::get(i32 id, const VarBitType** out) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    if (id < 0) {
        return Status::OutOfRange;
    }
    const std::size_t idx = static_cast<std::size_t>(id);
    if (idx >= present_.size() || present_[idx] == 0) {
        *out = nullptr;
        return Status::NotFound;
    }
    *out = &types_[idx];
    return Status::Ok;
}

} // namespace rs

