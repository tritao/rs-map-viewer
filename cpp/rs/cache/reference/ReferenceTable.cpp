#include "ReferenceTable.hpp"

#include <algorithm>
#include <cstddef>
#include <stdexcept>
#include <utility>
#include <vector>

#include "../../io/ByteReader.hpp"
#include "../../types.hpp"
#include "ArchiveReference.hpp"

namespace rs {

ReferenceTable ReferenceTable::decodeFromReader(ByteReader& reader) {
    ReferenceTable t;

    const u8 protocol = reader.readUnsignedByte();
    if (protocol < 5 || protocol > 7) {
        throw std::runtime_error("ReferenceTable: invalid protocol");
    }
    t.protocol_ = protocol;
    t.revision_ = (protocol > 5) ? reader.readInt() : 0;

    const u8 flag = reader.readUnsignedByte();
    t.named_ = (flag & 0x1) != 0;
    t.usesWhirlpool_ = (flag & 0x2) != 0;

    const i32 archiveCount = (protocol == 7) ? reader.readBigSmart() : static_cast<i32>(reader.readUnsignedShort());
    t.archiveCount_ = archiveCount;

    t.archiveIds_.resize(static_cast<std::size_t>(archiveCount));

    i32 lastArchiveId = 0;
    if (protocol == 7) {
        for (i32 i = 0; i < archiveCount; i++) {
            lastArchiveId += reader.readBigSmart();
            t.archiveIds_[static_cast<std::size_t>(i)] = lastArchiveId;
        }
    } else {
        for (i32 i = 0; i < archiveCount; i++) {
            lastArchiveId += static_cast<i32>(reader.readUnsignedShort());
            t.archiveIds_[static_cast<std::size_t>(i)] = lastArchiveId;
        }
    }
    t.lastArchiveId_ = lastArchiveId;

    t.archiveNameHashes_.assign(static_cast<std::size_t>(archiveCount), 0);
    if (t.named_) {
        for (i32 i = 0; i < archiveCount; i++) {
            t.archiveNameHashes_[static_cast<std::size_t>(i)] = reader.readInt();
        }
    }

    t.archiveWhirlpools_.resize(static_cast<std::size_t>(archiveCount));
    if (t.usesWhirlpool_) {
        for (i32 i = 0; i < archiveCount; i++) {
            auto& dst = t.archiveWhirlpools_[static_cast<std::size_t>(i)];
            dst.resize(64);
            reader.readBytesInto(dst.data(), dst.size());
        }
    }

    t.archiveCrcs_.assign(static_cast<std::size_t>(archiveCount), 0);
    for (i32 i = 0; i < archiveCount; i++) {
        t.archiveCrcs_[static_cast<std::size_t>(i)] = reader.readInt();
    }

    t.archiveRevisions_.assign(static_cast<std::size_t>(archiveCount), 0);
    for (i32 i = 0; i < archiveCount; i++) {
        t.archiveRevisions_[static_cast<std::size_t>(i)] = reader.readInt();
    }

    t.archiveFileCounts_.assign(static_cast<std::size_t>(archiveCount), 0);
    for (i32 i = 0; i < archiveCount; i++) {
        t.archiveFileCounts_[static_cast<std::size_t>(i)] =
            (protocol == 7) ? reader.readBigSmart() : static_cast<i32>(reader.readUnsignedShort());
    }

    t.archiveFileIds_.resize(static_cast<std::size_t>(archiveCount));
    t.archiveLastFileIds_.assign(static_cast<std::size_t>(archiveCount), 0);

    for (i32 i = 0; i < archiveCount; i++) {
        t.archiveFileIds_[static_cast<std::size_t>(i)].assign(
            static_cast<std::size_t>(t.archiveFileCounts_[static_cast<std::size_t>(i)]),
            0);
    }

    for (i32 archiveIdx = 0; archiveIdx < archiveCount; archiveIdx++) {
        i32 lastFileId = 0;
        const i32 fileCount = t.archiveFileCounts_[static_cast<std::size_t>(archiveIdx)];
        for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
            lastFileId += (protocol == 7) ? reader.readBigSmart() : static_cast<i32>(reader.readUnsignedShort());
            t.archiveFileIds_[static_cast<std::size_t>(archiveIdx)][static_cast<std::size_t>(fileIdx)] = lastFileId;
        }
        t.archiveLastFileIds_[static_cast<std::size_t>(archiveIdx)] = lastFileId;
    }

    if (t.named_) {
        t.archiveFileNameHashes_.resize(static_cast<std::size_t>(archiveCount));
        for (i32 i = 0; i < archiveCount; i++) {
            t.archiveFileNameHashes_[static_cast<std::size_t>(i)].assign(
                static_cast<std::size_t>(t.archiveFileCounts_[static_cast<std::size_t>(i)]),
                0);
        }
        for (i32 archiveIdx = 0; archiveIdx < archiveCount; archiveIdx++) {
            const i32 fileCount = t.archiveFileCounts_[static_cast<std::size_t>(archiveIdx)];
            for (i32 fileIdx = 0; fileIdx < fileCount; fileIdx++) {
                t.archiveFileNameHashes_[static_cast<std::size_t>(archiveIdx)][static_cast<std::size_t>(fileIdx)] =
                    reader.readInt();
            }
        }
    }

    return t;
}

bool ReferenceTable::archiveExists(i32 id) const {
    const auto it = std::lower_bound(archiveIds_.begin(), archiveIds_.end(), id);
    return it != archiveIds_.end() && *it == id;
}

const ArchiveReference* ReferenceTable::getArchiveReference(i32 id) const {
    const auto it = std::lower_bound(archiveIds_.begin(), archiveIds_.end(), id);
    if (it == archiveIds_.end() || *it != id) {
        return nullptr;
    }
    const auto idx = static_cast<std::size_t>(it - archiveIds_.begin());

    if (archiveReferenceCache_.empty()) {
        archiveReferenceCache_.resize(archiveIds_.size());
    }

    auto& slot = archiveReferenceCache_[idx];
    if (!slot) {
        ArchiveReference r;
        r.id = id;
        r.nameHash = (named_ ? archiveNameHashes_[idx] : 0);
        r.whirlpool = (usesWhirlpool_ ? archiveWhirlpools_[idx] : std::vector<u8>{});
        r.crc = archiveCrcs_[idx];
        r.revision = archiveRevisions_[idx];
        r.fileCount = archiveFileCounts_[idx];
        r.lastFileId = archiveLastFileIds_[idx];
        r.fileIds = archiveFileIds_[idx];
        r.fileNameHashes = (named_ ? archiveFileNameHashes_[idx] : std::vector<i32>{});
        slot = std::move(r);
    }

    return &(*slot);
}

} // namespace rs
