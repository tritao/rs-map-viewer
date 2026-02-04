#include "ReferenceTable.hpp"

#include <cstddef>

#include "../ArchiveMeta.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/ByteSourceReader.hpp"
#include "../../types.hpp"

namespace rs {

static std::size_t lowerBoundIndex(Span<const i32> ids, i32 needle) noexcept {
    std::size_t lo = 0;
    std::size_t hi = ids.size();
    while (lo < hi) {
        const std::size_t mid = lo + (hi - lo) / 2;
        if (ids[mid] < needle) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

Result<ReferenceTable> ReferenceTable::decodeFromReader(ByteSourceReader& reader, Allocator& alloc) noexcept {
    ReferenceTable t;
    t.archiveIds_ = Vec<i32>(alloc);
    t.archiveNameHashes_ = Vec<i32>(alloc);
    t.archiveFileCounts_ = Vec<i32>(alloc);
    t.archiveLastFileIds_ = Vec<i32>(alloc);
    t.archiveFileIds_ = Vec<Vec<i32>>(alloc);
    t.archiveFileNameHashes_ = Vec<Vec<i32>>(alloc);

    u8 protocolU8 = 0;
    Status s = reader.readUnsignedByte(&protocolU8);
    if (!ok(s)) {
        return Result<ReferenceTable>::err(s);
    }
    if (protocolU8 < 5 || protocolU8 > 7) {
        return Result<ReferenceTable>::err(Status::BadFormat);
    }
    t.protocol_ = static_cast<i32>(protocolU8);

    if (protocolU8 > 5) {
        i32 revision = 0;
        s = reader.readInt(&revision);
        if (!ok(s)) {
            return Result<ReferenceTable>::err(s);
        }
        t.revision_ = revision;
    } else {
        t.revision_ = 0;
    }

    u8 flag = 0;
    s = reader.readUnsignedByte(&flag);
    if (!ok(s)) {
        return Result<ReferenceTable>::err(s);
    }
    t.named_ = (flag & 0x1u) != 0;
    t.usesWhirlpool_ = (flag & 0x2u) != 0;

    i32 archiveCount = 0;
    if (protocolU8 == 7) {
        s = reader.readBigSmart(&archiveCount);
        if (!ok(s)) {
            return Result<ReferenceTable>::err(s);
        }
    } else {
        u16 v = 0;
        s = reader.readUnsignedShort(&v);
        if (!ok(s)) {
            return Result<ReferenceTable>::err(s);
        }
        archiveCount = static_cast<i32>(v);
    }
    if (archiveCount < 0) {
        return Result<ReferenceTable>::err(Status::BadFormat);
    }
    t.archiveCount_ = archiveCount;

    auto r = t.archiveIds_.resize(static_cast<std::size_t>(archiveCount));
    if (!r.isOk()) {
        return Result<ReferenceTable>::err(r.status());
    }

    i32 lastArchiveId = 0;
    if (protocolU8 == 7) {
        for (i32 i = 0; i < archiveCount; i++) {
            i32 delta = 0;
            s = reader.readBigSmart(&delta);
            if (!ok(s)) {
                return Result<ReferenceTable>::err(s);
            }
            lastArchiveId += delta;
            t.archiveIds_[static_cast<std::size_t>(i)] = lastArchiveId;
        }
    } else {
        for (i32 i = 0; i < archiveCount; i++) {
            u16 delta = 0;
            s = reader.readUnsignedShort(&delta);
            if (!ok(s)) {
                return Result<ReferenceTable>::err(s);
            }
            lastArchiveId += static_cast<i32>(delta);
            t.archiveIds_[static_cast<std::size_t>(i)] = lastArchiveId;
        }
    }
    t.lastArchiveId_ = lastArchiveId;

    // Optional archive name hashes (used for `getArchiveId(name)` lookups).
    if (t.named_) {
        r = t.archiveNameHashes_.resize(static_cast<std::size_t>(archiveCount));
        if (!r.isOk()) {
            return Result<ReferenceTable>::err(r.status());
        }
        for (i32 i = 0; i < archiveCount; i++) {
            i32 h = 0;
            s = reader.readInt(&h);
            if (!ok(s)) {
                return Result<ReferenceTable>::err(s);
            }
            t.archiveNameHashes_[static_cast<std::size_t>(i)] = h;
        }
    }

    // Optional whirlpool digests (unused by our current model, but must consume).
    if (t.usesWhirlpool_) {
        u8 tmp[64];
        for (i32 i = 0; i < archiveCount; i++) {
            s = reader.readBytesInto(Span<u8>(tmp, sizeof(tmp)));
            if (!ok(s)) {
                return Result<ReferenceTable>::err(s);
            }
        }
    }

    // CRCs (unused) + revisions (unused).
    for (i32 i = 0; i < archiveCount; i++) {
        i32 ignore = 0;
        s = reader.readInt(&ignore);
        if (!ok(s)) {
            return Result<ReferenceTable>::err(s);
        }
    }
    for (i32 i = 0; i < archiveCount; i++) {
        i32 ignore = 0;
        s = reader.readInt(&ignore);
        if (!ok(s)) {
            return Result<ReferenceTable>::err(s);
        }
    }

    r = t.archiveFileCounts_.resize(static_cast<std::size_t>(archiveCount));
    if (!r.isOk()) {
        return Result<ReferenceTable>::err(r.status());
    }
    r = t.archiveLastFileIds_.resize(static_cast<std::size_t>(archiveCount));
    if (!r.isOk()) {
        return Result<ReferenceTable>::err(r.status());
    }
    r = t.archiveFileIds_.resize(static_cast<std::size_t>(archiveCount));
    if (!r.isOk()) {
        return Result<ReferenceTable>::err(r.status());
    }
    if (t.named_) {
        r = t.archiveFileNameHashes_.resize(static_cast<std::size_t>(archiveCount));
        if (!r.isOk()) {
            return Result<ReferenceTable>::err(r.status());
        }
    }

    for (i32 i = 0; i < archiveCount; i++) {
        i32 fileCount = 0;
        if (protocolU8 == 7) {
            s = reader.readBigSmart(&fileCount);
        } else {
            u16 v = 0;
            s = reader.readUnsignedShort(&v);
            fileCount = static_cast<i32>(v);
        }
        if (!ok(s)) {
            return Result<ReferenceTable>::err(s);
        }
        if (fileCount < 0) {
            return Result<ReferenceTable>::err(Status::BadFormat);
        }
        t.archiveFileCounts_[static_cast<std::size_t>(i)] = fileCount;
    }

    // File ids per archive (delta-coded).
    for (i32 archiveIdx = 0; archiveIdx < archiveCount; archiveIdx++) {
        const std::size_t a = static_cast<std::size_t>(archiveIdx);
        const i32 fileCount = t.archiveFileCounts_[a];

        Vec<i32> ids(alloc);
        r = ids.resize(static_cast<std::size_t>(fileCount));
        if (!r.isOk()) {
            return Result<ReferenceTable>::err(r.status());
        }

        i32 lastFileId = 0;
        for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
            i32 delta = 0;
            if (protocolU8 == 7) {
                s = reader.readBigSmart(&delta);
            } else {
                u16 v = 0;
                s = reader.readUnsignedShort(&v);
                delta = static_cast<i32>(v);
            }
            if (!ok(s)) {
                return Result<ReferenceTable>::err(s);
            }
            lastFileId += delta;
            ids[static_cast<std::size_t>(fileIdx)] = lastFileId;
        }

        t.archiveLastFileIds_[a] = lastFileId;
        t.archiveFileIds_[a] = rs::move(ids);
    }

    // File name hashes per archive (optional).
    if (t.named_) {
        for (i32 archiveIdx = 0; archiveIdx < archiveCount; archiveIdx++) {
            const std::size_t a = static_cast<std::size_t>(archiveIdx);
            const i32 fileCount = t.archiveFileCounts_[a];

            Vec<i32> hashes(alloc);
            r = hashes.resize(static_cast<std::size_t>(fileCount));
            if (!r.isOk()) {
                return Result<ReferenceTable>::err(r.status());
            }

            for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                i32 h = 0;
                s = reader.readInt(&h);
                if (!ok(s)) {
                    return Result<ReferenceTable>::err(s);
                }
                hashes[static_cast<std::size_t>(fileIdx)] = h;
            }

            t.archiveFileNameHashes_[a] = rs::move(hashes);
        }
    }

    return Result<ReferenceTable>::ok(rs::move(t));
}

bool ReferenceTable::archiveExists(i32 id) const noexcept {
    const Span<const i32> ids = archiveIds();
    const std::size_t idx = lowerBoundIndex(ids, id);
    return idx < ids.size() && ids[idx] == id;
}

i32 ReferenceTable::getArchiveIdByNameHash(i32 nameHash) const noexcept {
    if (!named_) {
        return -1;
    }
    // Linear scan: name lookups are infrequent, and this keeps the core STL-free.
    const std::size_t n = archiveIds_.size();
    if (archiveNameHashes_.size() != n) {
        return -1;
    }
    for (std::size_t i = 0; i < n; i++) {
        if (archiveNameHashes_[i] == nameHash) {
            return archiveIds_[i];
        }
    }
    return -1;
}

Status ReferenceTable::getArchiveMeta(i32 id, ArchiveMeta* out) const noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Span<const i32> ids = archiveIds();
    const std::size_t idx = lowerBoundIndex(ids, id);
    if (idx >= ids.size() || ids[idx] != id) {
        return Status::NotFound;
    }

    ArchiveMeta m;
    m.id = id;
    m.fileCount = archiveFileCounts_[idx];
    m.lastFileId = archiveLastFileIds_[idx];
    m.fileIds = archiveFileIds_[idx].span();
    if (named_ && idx < archiveFileNameHashes_.size()) {
        m.fileNameHashes = archiveFileNameHashes_[idx].span();
    } else {
        m.fileNameHashes = Span<const i32>();
    }
    *out = m;
    return Status::Ok;
}

} // namespace rs
