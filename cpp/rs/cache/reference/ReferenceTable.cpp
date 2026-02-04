#include "ReferenceTable.hpp"

#include <stdexcept>

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
    t.archiveIdIndexMap_.reserve(static_cast<std::size_t>(archiveCount));

    i32 lastArchiveId = 0;
    if (protocol == 7) {
        for (i32 i = 0; i < archiveCount; i++) {
            lastArchiveId += reader.readBigSmart();
            t.archiveIds_[static_cast<std::size_t>(i)] = lastArchiveId;
            t.archiveIdIndexMap_.emplace(lastArchiveId, i);
        }
    } else {
        for (i32 i = 0; i < archiveCount; i++) {
            lastArchiveId += static_cast<i32>(reader.readUnsignedShort());
            t.archiveIds_[static_cast<std::size_t>(i)] = lastArchiveId;
            t.archiveIdIndexMap_.emplace(lastArchiveId, i);
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
            const auto bytes = reader.readBytes(64);
            t.archiveWhirlpools_[static_cast<std::size_t>(i)] = std::vector<u8>(bytes.begin(), bytes.end());
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
    return archiveIdIndexMap_.find(id) != archiveIdIndexMap_.end();
}

const ArchiveReference* ReferenceTable::getArchiveReference(i32 id) const {
    const auto it = archiveIdIndexMap_.find(id);
    if (it == archiveIdIndexMap_.end()) {
        return nullptr;
    }
    const i32 idx = it->second;

    if (archiveReferenceCache_.empty()) {
        archiveReferenceCache_.resize(archiveIds_.size());
    }

    auto& slot = archiveReferenceCache_[static_cast<std::size_t>(idx)];
    if (!slot) {
        ArchiveReference r;
        r.id = id;
        r.nameHash = (named_ ? archiveNameHashes_[static_cast<std::size_t>(idx)] : 0);
        r.whirlpool = (usesWhirlpool_ ? archiveWhirlpools_[static_cast<std::size_t>(idx)] : std::vector<u8>{});
        r.crc = archiveCrcs_[static_cast<std::size_t>(idx)];
        r.revision = archiveRevisions_[static_cast<std::size_t>(idx)];
        r.fileCount = archiveFileCounts_[static_cast<std::size_t>(idx)];
        r.lastFileId = archiveLastFileIds_[static_cast<std::size_t>(idx)];
        r.fileIds = archiveFileIds_[static_cast<std::size_t>(idx)];
        r.fileNameHashes = (named_ ? archiveFileNameHashes_[static_cast<std::size_t>(idx)] : std::vector<i32>{});
        slot = std::move(r);
    }

    return &(*slot);
}

} // namespace rs
