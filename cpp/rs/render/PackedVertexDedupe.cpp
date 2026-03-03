#include "PackedVertexDedupe.hpp"

namespace rs {

namespace {

struct PackedVertexKey final {
    u32 v0 = 0;
    u32 v1 = 0;
    u32 v2 = 0;
    u32 v3 = 0;
};

struct PackedVertexMapEntry final {
    PackedVertexKey key{};
    i32 newIndex = -1;
    i32 next = -1;
};

static inline bool packedVertexKeyEq(const PackedVertexKey& a, const PackedVertexKey& b) noexcept {
    return a.v0 == b.v0 && a.v1 == b.v1 && a.v2 == b.v2 && a.v3 == b.v3;
}

static inline u32 packedVertexKeyHash(const PackedVertexKey& key) noexcept {
    u32 h = 2166136261u;
    auto mix = [&](u32 v) noexcept {
        h ^= v;
        h *= 16777619u;
    };
    mix(key.v0);
    mix(key.v1);
    mix(key.v2);
    mix(key.v3);
    return h;
}

static inline u32 readU32Le(const Vec<u8>& vertices, std::size_t off) noexcept {
    return static_cast<u32>(vertices[off + 0]) |
           (static_cast<u32>(vertices[off + 1]) << 8) |
           (static_cast<u32>(vertices[off + 2]) << 16) |
           (static_cast<u32>(vertices[off + 3]) << 24);
}

static i32 nextPow2AtLeast(i32 value) noexcept {
    if (value <= 1) {
        return 1;
    }
    u32 v = static_cast<u32>(value - 1);
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    if (v == 0xffffffffu) {
        return 0;
    }
    return static_cast<i32>(v + 1u);
}

} // namespace

Status dedupePackedVerticesAndRemapIndices(
    Vec<u8>* vertices,
    Vec<i32>* indices,
    i32 debugProbeFinalIndex,
    i32* outProbeOldIndex,
    i32* outProbeVertexU32,
    Allocator& alloc) noexcept {
    if (!vertices || !indices) {
        return Status::InvalidArgument;
    }
    if ((vertices->size() % 16u) != 0u) {
        return Status::BadFormat;
    }
    if (vertices->empty() || indices->empty()) {
        return Status::Ok;
    }
    if ((vertices->size() / 16u) > static_cast<std::size_t>(2147483647)) {
        return Status::OutOfRange;
    }

    const i32 vertexCount = static_cast<i32>(vertices->size() / 16u);

    if (outProbeOldIndex) {
        *outProbeOldIndex = -1;
    }
    if (outProbeVertexU32) {
        // 4x u32 stored as i32 for easy export.
        for (int i = 0; i < 4; i++) {
            outProbeVertexU32[i] = 0;
        }
    }

    Vec<i32> remap(alloc);
    auto rrRemap = remap.resize(static_cast<std::size_t>(vertexCount));
    if (!rrRemap.isOk()) {
        return rrRemap.status();
    }

    Vec<u8> dedupVertices(alloc);
    auto rrReserve = dedupVertices.reserve(vertices->size());
    if (!rrReserve.isOk()) {
        return rrReserve.status();
    }

    const i32 targetBuckets = (vertexCount > (2147483647 / 2)) ? 2147483647 : (vertexCount * 2);
    i32 bucketCount = nextPow2AtLeast(targetBuckets > 16 ? targetBuckets : 16);
    if (bucketCount <= 0) {
        return Status::OutOfRange;
    }

    Vec<i32> bucketHeads(alloc);
    auto rrBuckets = bucketHeads.resize(static_cast<std::size_t>(bucketCount));
    if (!rrBuckets.isOk()) {
        return rrBuckets.status();
    }
    for (std::size_t i = 0; i < bucketHeads.size(); i++) {
        bucketHeads[i] = -1;
    }

    Vec<PackedVertexMapEntry> entries(alloc);
    auto rrEntriesReserve = entries.reserve(static_cast<std::size_t>(vertexCount));
    if (!rrEntriesReserve.isOk()) {
        return rrEntriesReserve.status();
    }

    const u32 bucketMask = static_cast<u32>(bucketCount - 1);

    for (i32 vi = 0; vi < vertexCount; vi++) {
        const std::size_t off = static_cast<std::size_t>(vi) * 16u;
        PackedVertexKey key{};
        key.v0 = readU32Le(*vertices, off + 0u);
        key.v1 = readU32Le(*vertices, off + 4u);
        key.v2 = readU32Le(*vertices, off + 8u);
        key.v3 = readU32Le(*vertices, off + 12u);

        const i32 bucketIndex = static_cast<i32>(packedVertexKeyHash(key) & bucketMask);
        i32 foundNewIndex = -1;

        i32 entryIndex = bucketHeads[static_cast<std::size_t>(bucketIndex)];
        while (entryIndex >= 0) {
            const PackedVertexMapEntry& entry = entries[static_cast<std::size_t>(entryIndex)];
            if (packedVertexKeyEq(entry.key, key)) {
                foundNewIndex = entry.newIndex;
                break;
            }
            entryIndex = entry.next;
        }

        if (foundNewIndex < 0) {
            if ((dedupVertices.size() / 16u) > static_cast<std::size_t>(2147483647)) {
                return Status::OutOfRange;
            }

            const i32 newIndex = static_cast<i32>(dedupVertices.size() / 16u);
            auto rrGrow = dedupVertices.resize(dedupVertices.size() + 16u);
            if (!rrGrow.isOk()) {
                return rrGrow.status();
            }
            for (std::size_t b = 0; b < 16u; b++) {
                dedupVertices[dedupVertices.size() - 16u + b] = (*vertices)[off + b];
            }

            if (debugProbeFinalIndex >= 0 && newIndex == debugProbeFinalIndex) {
                if (outProbeOldIndex) {
                    *outProbeOldIndex = vi;
                }
                if (outProbeVertexU32) {
                    outProbeVertexU32[0] = static_cast<i32>(key.v0);
                    outProbeVertexU32[1] = static_cast<i32>(key.v1);
                    outProbeVertexU32[2] = static_cast<i32>(key.v2);
                    outProbeVertexU32[3] = static_cast<i32>(key.v3);
                }
            }

            PackedVertexMapEntry newEntry{};
            newEntry.key = key;
            newEntry.newIndex = newIndex;
            newEntry.next = bucketHeads[static_cast<std::size_t>(bucketIndex)];
            auto rrPush = entries.pushBack(newEntry);
            if (!rrPush.isOk()) {
                return rrPush.status();
            }
            const i32 insertedIndex = static_cast<i32>(entries.size() - 1);
            bucketHeads[static_cast<std::size_t>(bucketIndex)] = insertedIndex;
            foundNewIndex = newIndex;
        }

        remap[static_cast<std::size_t>(vi)] = foundNewIndex;
    }

    for (std::size_t i = 0; i < indices->size(); i++) {
        const i32 oldIndex = (*indices)[i];
        if (oldIndex < 0 || oldIndex >= vertexCount) {
            return Status::OutOfRange;
        }
        (*indices)[i] = remap[static_cast<std::size_t>(oldIndex)];
    }

    *vertices = rs::move(dedupVertices);
    return Status::Ok;
}

} // namespace rs
