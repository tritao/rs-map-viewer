#pragma once

#include "../rs/types.hpp"
#include <array>
#include <cstdint>
#include <utility>
#include <vector>

namespace rs::tooling {

inline constexpr i32 kMapRenderStatusOk = 1;
inline constexpr i32 kMapRenderStatusInvalidArg = -1;
inline constexpr i32 kMapRenderStatusNotFound = -2;
inline constexpr i32 kMapRenderStatusSizeMismatch = -3;
inline constexpr i32 kMapRenderRuntimePacketMetaInts = 44;
inline constexpr i32 kMapRenderRuntimePacketVersion = 3;
inline constexpr i32 kMapRenderRuntimeDrawBucketCount = 8;

struct MapRenderLoadedPayloadState {
    std::vector<i32> bucketCmdCounts;
    std::vector<i32> bucketModelInfoLengths;
    std::vector<i32> drawRangesPacked;
    std::array<std::vector<u16>, static_cast<std::size_t>(kMapRenderRuntimeDrawBucketCount)>
        modelInfoTextureBuckets;
    std::vector<i16> heightMap;
    std::vector<u8> vertices;
    std::vector<i32> indices;
    std::vector<i32> npcDrawRangesBase;
    std::vector<i32> npcDrawRangesAlpha;
    std::vector<u8> npcVertices;
    std::vector<i32> npcIndices;
    std::vector<i32> npcOrderKeys;
    i32 totalModelInfoLength = 0;
    i32 levels = 0;
    i32 sizeX = 0;
    i32 sizeY = 0;
    i32 unitsTileHeightBasis = 0;
    bool loaded = false;

    void clear() {
        bucketCmdCounts.clear();
        bucketModelInfoLengths.clear();
        drawRangesPacked.clear();
        for (auto& bucket : modelInfoTextureBuckets) {
            bucket.clear();
        }
        heightMap.clear();
        vertices.clear();
        indices.clear();
        npcDrawRangesBase.clear();
        npcDrawRangesAlpha.clear();
        npcVertices.clear();
        npcIndices.clear();
        npcOrderKeys.clear();
        totalModelInfoLength = 0;
        levels = 0;
        sizeX = 0;
        sizeY = 0;
        unitsTileHeightBasis = 0;
        loaded = false;
    }
};

inline i32 storeLoadedPayload(
    MapRenderLoadedPayloadState* payload,
    const i32* outBucketCmdCounts,
    const i32 outBucketCmdCountsLength,
    const i32* outBucketModelInfoLengths,
    const i32 outBucketModelInfoLengthsLength,
    const i32* outTotalModelInfoLength,
    const i32* drawRangesPacked,
    const i32 drawRangesPackedLength,
    const u16* outModelInfoTextureConcat,
    const i32 outModelInfoTextureConcatLength,
    const i16* outHeightMap,
    const i32 outHeightMapLength,
    const u8* outVertices,
    const i32 outVerticesLength,
    const i32* outIndices,
    const i32 outIndicesLength,
    const i32 levels,
    const i32 sizeX,
    const i32 sizeY,
    const i32 unitsTileHeightBasis) {
    if (!payload) {
        return kMapRenderStatusInvalidArg;
    }
    if (!outTotalModelInfoLength ||
        (outBucketCmdCountsLength > 0 && !outBucketCmdCounts) ||
        (outBucketModelInfoLengthsLength > 0 && !outBucketModelInfoLengths) ||
        (drawRangesPackedLength > 0 && !drawRangesPacked) ||
        (outModelInfoTextureConcatLength > 0 && !outModelInfoTextureConcat) ||
        (outHeightMapLength > 0 && !outHeightMap) ||
        outVerticesLength < 0 ||
        outIndicesLength < 0 ||
        (outVerticesLength > 0 && !outVertices) ||
        (outIndicesLength > 0 && !outIndices)) {
        payload->clear();
        return kMapRenderStatusInvalidArg;
    }

    const i32 totalModelInfoLength = *outTotalModelInfoLength;
    if (totalModelInfoLength < 0 || totalModelInfoLength > outModelInfoTextureConcatLength) {
        payload->clear();
        return kMapRenderStatusNotFound;
    }

    MapRenderLoadedPayloadState loaded{};
    loaded.bucketCmdCounts.assign(
        outBucketCmdCounts,
        outBucketCmdCounts + static_cast<std::size_t>(outBucketCmdCountsLength));
    loaded.bucketModelInfoLengths.assign(
        outBucketModelInfoLengths,
        outBucketModelInfoLengths + static_cast<std::size_t>(outBucketModelInfoLengthsLength));
    loaded.drawRangesPacked.assign(
        drawRangesPacked,
        drawRangesPacked + static_cast<std::size_t>(drawRangesPackedLength));
    i32 modelInfoCursor = 0;
    for (i32 bucket = 0; bucket < kMapRenderRuntimeDrawBucketCount; bucket++) {
        const i32 bucketLen = loaded.bucketModelInfoLengths[static_cast<std::size_t>(bucket)];
        if (bucketLen < 0 || modelInfoCursor > totalModelInfoLength - bucketLen) {
            payload->clear();
            return kMapRenderStatusNotFound;
        }
        auto& outBucket = loaded.modelInfoTextureBuckets[static_cast<std::size_t>(bucket)];
        outBucket.assign(
            outModelInfoTextureConcat + static_cast<std::size_t>(modelInfoCursor),
            outModelInfoTextureConcat + static_cast<std::size_t>(modelInfoCursor + bucketLen));
        modelInfoCursor += bucketLen;
    }
    if (modelInfoCursor != totalModelInfoLength) {
        payload->clear();
        return kMapRenderStatusNotFound;
    }
    loaded.heightMap.assign(outHeightMap, outHeightMap + static_cast<std::size_t>(outHeightMapLength));
    loaded.vertices.clear();
    if (outVerticesLength > 0) {
        loaded.vertices.assign(outVertices, outVertices + static_cast<std::size_t>(outVerticesLength));
    }
    loaded.indices.clear();
    if (outIndicesLength > 0) {
        loaded.indices.assign(outIndices, outIndices + static_cast<std::size_t>(outIndicesLength));
    }
    loaded.totalModelInfoLength = totalModelInfoLength;
    loaded.levels = levels;
    loaded.sizeX = sizeX;
    loaded.sizeY = sizeY;
    loaded.unitsTileHeightBasis = unitsTileHeightBasis;
    loaded.loaded = true;
    *payload = std::move(loaded);
    return kMapRenderStatusOk;
}

inline i32 packRenderPacketMeta(
    const MapRenderLoadedPayloadState& payload,
    i32* outMeta,
    const i32 outMetaLength) {
    if (!outMeta || outMetaLength < kMapRenderRuntimePacketMetaInts) {
        return kMapRenderStatusSizeMismatch;
    }
    if (!payload.loaded) {
        return kMapRenderStatusNotFound;
    }

    outMeta[0] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.bucketCmdCounts.data()));
    outMeta[1] = static_cast<i32>(payload.bucketCmdCounts.size());
    outMeta[2] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.bucketModelInfoLengths.data()));
    outMeta[3] = static_cast<i32>(payload.bucketModelInfoLengths.size());
    outMeta[4] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.heightMap.data()));
    outMeta[5] = static_cast<i32>(payload.heightMap.size());
    outMeta[6] = payload.levels;
    outMeta[7] = payload.sizeX;
    outMeta[8] = payload.sizeY;
    outMeta[9] = payload.unitsTileHeightBasis;
    outMeta[10] = payload.totalModelInfoLength;
    outMeta[11] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.drawRangesPacked.data()));
    outMeta[12] = static_cast<i32>(payload.drawRangesPacked.size());

    for (i32 bucket = 0; bucket < kMapRenderRuntimeDrawBucketCount; bucket++) {
        const auto& bucketData = payload.modelInfoTextureBuckets[static_cast<std::size_t>(bucket)];
        const i32 bucketLen = static_cast<i32>(bucketData.size());
        const u16* bucketPtr = bucketLen > 0 ? bucketData.data() : nullptr;
        outMeta[13 + bucket] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(bucketPtr));
        outMeta[21 + bucket] = bucketLen;
    }
    outMeta[29] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.vertices.data()));
    outMeta[30] = static_cast<i32>(payload.vertices.size());
    outMeta[31] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.indices.data()));
    outMeta[32] = static_cast<i32>(payload.indices.size());
    outMeta[33] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.npcDrawRangesBase.data()));
    outMeta[34] = static_cast<i32>(payload.npcDrawRangesBase.size());
    outMeta[35] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.npcDrawRangesAlpha.data()));
    outMeta[36] = static_cast<i32>(payload.npcDrawRangesAlpha.size());
    outMeta[37] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.npcVertices.data()));
    outMeta[38] = static_cast<i32>(payload.npcVertices.size());
    outMeta[39] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.npcIndices.data()));
    outMeta[40] = static_cast<i32>(payload.npcIndices.size());
    outMeta[41] = static_cast<i32>(reinterpret_cast<std::uintptr_t>(payload.npcOrderKeys.data()));
    outMeta[42] = static_cast<i32>(payload.npcOrderKeys.size());
    outMeta[43] = kMapRenderRuntimePacketVersion;
    return kMapRenderStatusOk;
}

} // namespace rs::tooling

