#include "SceneCommandBuilder.hpp"
#include "SceneCommandBuilderInternal.hpp"

#include "../cache/CacheInfo.hpp"
#include "../config/TypeDecode.hpp"
#include "../config/floortype/OverlayFloorType.hpp"
#include "../config/floortype/UnderlayFloorType.hpp"
#include "../config/loctype/LocType.hpp"
#include "../config/vartype/VarBitType.hpp"
#include "../config/objtype/ObjType.hpp"
#include "../config/seqtype/SeqType.hpp"
#include "../core/StringArena.hpp"
#include "../core/StrUtil.hpp"
#include "../map/LocPlacementsDecode.hpp"
#include "../map/TerrainConstants.hpp"
#include "../map/TerrainSquareDecode.hpp"
#include "../model/ModelData.hpp"
#include "../util/ColorUtil.hpp"
#include "../util/HeightCalc.hpp"
#include "../scene/BuildSceneFromMapBytesProvider.hpp"
#include "SceneBuffer.hpp"
#include "PackedVertex.hpp"
#include "TerrainTileBuilder.hpp"
#include "TerrainTileSampler.hpp"

#include <cstdio>

#include "../../third_party/xxhash/xxhash.h"

namespace rs {

namespace scb {

static bool locPlacementIndexLess(const Vec<SceneLocPlacement>& placements, i32 a, i32 b) noexcept {
    if (a == b) {
        return false;
    }
    if (a < 0) return true;
    if (b < 0) return false;
    const SceneLocPlacement& pa = placements[static_cast<std::size_t>(a)];
    const SceneLocPlacement& pb = placements[static_cast<std::size_t>(b)];
    if (pa.level != pb.level) return pa.level < pb.level;
    if (pa.tileX != pb.tileX) return pa.tileX < pb.tileX;
    if (pa.tileY != pb.tileY) return pa.tileY < pb.tileY;

    const auto categoryOrder = [](i32 placementType) noexcept -> i32 {
        if (placementType == 22) {
            return 0;
        }
        if ((placementType >= 0 && placementType <= 3) || placementType == 9) {
            return 1;
        }
        if (placementType >= 4 && placementType <= 8) {
            return 2;
        }
        return 3;
    };

    const i32 catA = categoryOrder(pa.type);
    const i32 catB = categoryOrder(pb.type);
    if (catA != catB) return catA < catB;
    // Within the same tile category, preserve decode/insertion order.
    return a < b;
}

static void quickSortLocPlacementOrder(
    const Vec<SceneLocPlacement>& placements,
    i32* data,
    i32 left,
    i32 right) noexcept {
    i32 i = left;
    i32 j = right;
    const i32 pivot = data[(left + right) >> 1];
    while (i <= j) {
        while (locPlacementIndexLess(placements, data[i], pivot)) {
            i++;
        }
        while (locPlacementIndexLess(placements, pivot, data[j])) {
            j--;
        }
        if (i <= j) {
            rs::swap(data[i], data[j]);
            i++;
            j--;
        }
    }
    if (left < j) {
        quickSortLocPlacementOrder(placements, data, left, j);
    }
    if (i < right) {
        quickSortLocPlacementOrder(placements, data, i, right);
    }
}

static void sortLocPlacementOrder(Vec<i32>* order, const Vec<SceneLocPlacement>& placements) noexcept {
    if (!order) {
        return;
    }
    if (order->size() <= 1) {
        return;
    }
    if (order->size() > static_cast<std::size_t>(2147483647)) {
        return;
    }
    quickSortLocPlacementOrder(
        placements,
        order->data(),
        0,
        static_cast<i32>(order->size() - 1));
}

static constexpr i32 kLocMergeDecisionEntryPackedStride = 27;

static bool shouldCaptureLocMergeDecisionDebug(i32 locTypeId) noexcept {
    (void)locTypeId;
    return true;
}

Status appendLocMergeDecisionEntryPacked(
    SceneCommandStream* debugOut,
    i32 locTypeId,
    i32 placementType,
    i32 placementRotation,
    i32 variantType,
    i32 variantRotation,
    i32 level,
    i32 tileX,
    i32 tileY,
    i32 priority,
    bool forceMerge,
    bool includeLod,
    bool contourSensitive,
    i32 mergedSceneHeight,
    i32 contourSceneX,
    i32 contourSceneZ,
    i32 contourGround,
    i32 contourProfileHash,
    i32 modelSignature,
    i32 modelIdsHash,
    i32 foundGroupIndex,
    i32 chosenGroupIndex,
    bool createdNewGroup,
    i32 opaqueElementsPerInstance,
    i32 alphaElementsPerInstance,
    i32 placementCategory,
    i32 placementOrder,
    i32 modelCount) noexcept {
    if (!debugOut || !shouldCaptureLocMergeDecisionDebug(locTypeId)) {
        return Status::Ok;
    }
    const i32 packed[kLocMergeDecisionEntryPackedStride] = {
        locTypeId,
        placementType,
        placementRotation,
        variantType,
        variantRotation,
        level,
        tileX,
        tileY,
        priority,
        forceMerge ? 1 : 0,
        includeLod ? 1 : 0,
        contourSensitive ? 1 : 0,
        mergedSceneHeight,
        contourSceneX,
        contourSceneZ,
        contourGround,
        contourProfileHash,
        modelSignature,
        modelIdsHash,
        foundGroupIndex,
        chosenGroupIndex,
        createdNewGroup ? 1 : 0,
        opaqueElementsPerInstance,
        alphaElementsPerInstance,
        placementCategory,
        placementOrder,
        modelCount,
    };
    for (i32 i = 0; i < kLocMergeDecisionEntryPackedStride; i++) {
        auto rr = debugOut->debugLocMergeDecisionEntriesPacked.pushBack(packed[i]);
        if (!rr.isOk()) {
            return rr.status();
        }
    }
    return Status::Ok;
}

DebugCommandProvenance makeLocCommandProvenance(
    DebugCommandSourceKind sourceKind,
    i32 locTypeId,
    i32 placementType,
    i32 placementRotation,
    i32 variantType,
    i32 variantRotation,
    i32 pass,
    i32 mergePath,
    i32 splitSignature) noexcept {
    DebugCommandProvenance out{};
    out.sourceKind = static_cast<i32>(sourceKind);
    out.locTypeId = locTypeId;
    out.placementType = placementType;
    out.placementRotation = placementRotation;
    out.variantType = variantType;
    out.variantRotation = variantRotation;
    out.pass = pass;
    out.mergePath = mergePath;
    out.splitSignature = splitSignature;
    return out;
}

i32 hashSceneLocCommandGroupKeyForDebug(const SceneLocCommandGroupKey& key) noexcept {
    const auto mix = [](i32 hash, i32 value) noexcept -> i32 {
        const u32 h = (static_cast<u32>(hash) ^ static_cast<u32>(value)) * 16777619u;
        return static_cast<i32>(h);
    };
    i32 h = 2166136261u;
    h = mix(h, key.modelSignature);
    h = mix(h, key.modelIdsHash);
    h = mix(h, key.placementType);
    h = mix(h, key.rotation);
    h = mix(h, key.level);
    h = mix(h, key.priority);
    h = mix(h, key.forceMerge ? 1 : 0);
    h = mix(h, key.contourSensitive ? 1 : 0);
    if (key.contourSensitive) {
        h = mix(h, key.contourSceneHeight);
        h = mix(h, key.contourSceneX);
        h = mix(h, key.contourSceneZ);
        h = mix(h, key.contourGround);
        h = mix(h, key.contourProfileHash);
    }
    return h;
}

static u32 fnv1a32UpdateByteForDebug(u32 hash, u8 value) noexcept {
    hash ^= static_cast<u32>(value);
    hash *= 16777619u;
    return hash;
}

u32 fnv1a32UpdateI32ForDebug(u32 hash, i32 value) noexcept {
    const u32 v = static_cast<u32>(value);
    hash = fnv1a32UpdateByteForDebug(hash, static_cast<u8>(v & 0xffu));
    hash = fnv1a32UpdateByteForDebug(hash, static_cast<u8>((v >> 8) & 0xffu));
    hash = fnv1a32UpdateByteForDebug(hash, static_cast<u8>((v >> 16) & 0xffu));
    hash = fnv1a32UpdateByteForDebug(hash, static_cast<u8>((v >> 24) & 0xffu));
    return hash;
}

static u32 fnv1a32UpdateU32ForPlan(u32 hash, u32 value) noexcept {
    const u32 h = (hash ^ value) * 16777619u;
    return h;
}

static u32 hashSceneCommandPlanMergedGroupOp(
    bool transparent,
    bool lowDetail,
    i32 level,
    i32 priority,
    i32 modelCount) noexcept {
    u32 h = 2166136261u;
    h = fnv1a32UpdateU32ForPlan(h, 1u);
    h = fnv1a32UpdateU32ForPlan(h, transparent ? 1u : 0u);
    h = fnv1a32UpdateU32ForPlan(h, lowDetail ? 1u : 0u);
    h = fnv1a32UpdateU32ForPlan(h, static_cast<u32>(level));
    h = fnv1a32UpdateU32ForPlan(h, static_cast<u32>(priority));
    h = fnv1a32UpdateU32ForPlan(h, static_cast<u32>(modelCount));
    return h;
}

static u32 hashSceneCommandPlanInstancedOp(
    i32 modelHash,
    bool transparent,
    i32 faceCount,
    i32 instanceCount,
    i32 lodInstanceCount) noexcept {
    u32 h = 2166136261u;
    h = fnv1a32UpdateU32ForPlan(h, 2u);
    h = fnv1a32UpdateU32ForPlan(h, static_cast<u32>(modelHash));
    h = fnv1a32UpdateU32ForPlan(h, transparent ? 1u : 0u);
    h = fnv1a32UpdateU32ForPlan(h, static_cast<u32>(faceCount));
    h = fnv1a32UpdateU32ForPlan(h, static_cast<u32>(instanceCount));
    h = fnv1a32UpdateU32ForPlan(h, static_cast<u32>(lodInstanceCount));
    return h;
}

static void sceneCommandPlanDigestAddOp(SceneCommandStream* out, u32 opHash) noexcept {
    if (!out) {
        return;
    }
    if (out->debugSceneCommandPlanSeqHash == 0) {
        out->debugSceneCommandPlanSeqHash = static_cast<i32>(2166136261u);
    }
    const u32 seq = fnv1a32UpdateU32ForPlan(
        static_cast<u32>(out->debugSceneCommandPlanSeqHash),
        opHash);
    out->debugSceneCommandPlanSeqHash = static_cast<i32>(seq);

    const u32 sum = static_cast<u32>(out->debugSceneCommandPlanMultisetHashSum) + opHash;
    out->debugSceneCommandPlanMultisetHashSum = static_cast<i32>(sum);
    const u32 xo = static_cast<u32>(out->debugSceneCommandPlanMultisetHashXor) ^ opHash;
    out->debugSceneCommandPlanMultisetHashXor = static_cast<i32>(xo);
}

static void sceneCommandPlanDigestAddInstanced(
    SceneCommandStream* out,
    i32 modelHash,
    bool transparent,
    i32 faceCount,
    i32 instanceCount,
    i32 lodInstanceCount) noexcept {
    if (!out) {
        return;
    }
    out->debugSceneCommandPlanOpCount++;
    out->debugSceneCommandPlanInstancedOpCount++;
    out->debugSceneCommandPlanInstancedFacesTotal += (faceCount >= 0 ? faceCount : 0);
    out->debugSceneCommandPlanInstancedInstancesTotal += (instanceCount >= 0 ? instanceCount : 0);
    out->debugSceneCommandPlanInstancedLodInstancesTotal += (lodInstanceCount >= 0 ? lodInstanceCount : 0);
    const u32 opHash = hashSceneCommandPlanInstancedOp(
        modelHash,
        transparent,
        faceCount,
        instanceCount,
        lodInstanceCount);
    sceneCommandPlanDigestAddOp(out, opHash);
}

static void sceneCommandPlanDigestAddMergedGroup(
    SceneCommandStream* out,
    bool transparent,
    bool lowDetail,
    i32 level,
    i32 priority,
    i32 modelCount) noexcept {
    if (!out) {
        return;
    }
    out->debugSceneCommandPlanOpCount++;
    out->debugSceneCommandPlanMergedGroupOpCount++;
    const u32 opHash = hashSceneCommandPlanMergedGroupOp(
        transparent,
        lowDetail,
        level,
        priority,
        modelCount);
    sceneCommandPlanDigestAddOp(out, opHash);
}

using SceneCommandPlanDebugOpKind = scb::SceneCommandPlanDebugOpKind;
using SceneCommandPlanDebugOp = scb::SceneCommandPlanDebugOp;
using TerrainTileFaceCountGrid = scb::TerrainTileFaceCountGrid;

struct SceneBufferBucketsDigest final {
    i32 cmdTotal = 0;
    i32 instanceTotal = 0;
    i32 hash = 0;
    i32 bucketCmdCounts[kDrawBucketCount]{};
};

static SceneBufferBucketsDigest debugDigestSceneBufferBuckets(
    const SceneBuffer& buffer) noexcept {
    SceneBufferBucketsDigest out{};
    u32 h = 2166136261u;

    for (i32 bucket = 0; bucket < kDrawBucketCount; bucket++) {
        const DrawBucketKey key = static_cast<DrawBucketKey>(bucket);
        const Span<const DrawCommand> commands = buffer.bucketCommands(key);
        if (commands.size() > static_cast<std::size_t>(2147483647)) {
            continue;
        }
        const i32 cmdCount = static_cast<i32>(commands.size());
        out.bucketCmdCounts[bucket] = cmdCount;
        out.cmdTotal += cmdCount;

        for (std::size_t i = 0; i < commands.size(); i++) {
            const DrawCommand& cmd = commands[i];
            h = fnv1a32UpdateI32ForDebug(h, bucket);
            h = fnv1a32UpdateI32ForDebug(h, cmd.offset);
            h = fnv1a32UpdateI32ForDebug(h, cmd.elements);
            h = fnv1a32UpdateI32ForDebug(h, cmd.instanceCount);

            if (cmd.instanceCount > 0 && cmd.instanceStart >= 0) {
                out.instanceTotal += cmd.instanceCount;
                const std::size_t start = static_cast<std::size_t>(cmd.instanceStart);
                const std::size_t count = static_cast<std::size_t>(cmd.instanceCount);
                if (start + count > buffer.instances.size()) {
                    continue;
                }
                for (std::size_t ii = 0; ii < count; ii++) {
                    const ModelInfo& inst = buffer.instances[start + ii];
                    h = fnv1a32UpdateI32ForDebug(h, inst.sceneX);
                    h = fnv1a32UpdateI32ForDebug(h, inst.sceneZ);
                    h = fnv1a32UpdateI32ForDebug(h, inst.heightOffset);
                    h = fnv1a32UpdateI32ForDebug(h, inst.level);
                    h = fnv1a32UpdateI32ForDebug(h, inst.contourGround);
                    h = fnv1a32UpdateI32ForDebug(h, inst.priority);
                    h = fnv1a32UpdateI32ForDebug(h, inst.interactType);
                    h = fnv1a32UpdateI32ForDebug(h, inst.interactId);
                }
            }
        }
    }

    out.hash = static_cast<i32>(h);
    return out;
}

struct NullLocTypeService final : LocTypeService {
    Status tryLoad(i32, const LocType**) const noexcept override { return Status::NotFound; }
};

struct InputMapBytesProvider final : MapBytesProvider {
    Span<const i32> mapSquareIds{};
    Span<const i32> terrainOffsets{};
    Span<const i32> terrainLengths{};
    Span<const u8> terrainBytes{};
    Span<const i32> locOffsets{};
    Span<const i32> locLengths{};
    Span<const u8> locBytes{};

    [[nodiscard]] i32 mapId(i32 mapX, i32 mapY) const noexcept {
        return (mapX << 8) + mapY;
    }

    [[nodiscard]] i32 findMapIndex(i32 mapX, i32 mapY) const noexcept {
        const i32 id = mapId(mapX, mapY);
        for (std::size_t i = 0; i < mapSquareIds.size(); i++) {
            if (mapSquareIds[i] == id) {
                if (i > static_cast<std::size_t>(2147483647)) {
                    return -1;
                }
                return static_cast<i32>(i);
            }
        }
        return -1;
    }

    Status copySpanSlice(Span<const u8> source, i32 off, i32 len, Vec<u8>* out) const noexcept {
        if (!out) {
            return Status::InvalidArgument;
        }
        out->clear();
        if (off < 0 || len < 0) {
            return Status::NotFound;
        }
        if (off > static_cast<i32>(source.size()) || len > static_cast<i32>(source.size()) - off) {
            return Status::OutOfRange;
        }
        auto rr = out->resize(static_cast<std::size_t>(len));
        if (!rr.isOk()) {
            return rr.status();
        }
        for (i32 i = 0; i < len; i++) {
            (*out)[static_cast<std::size_t>(i)] = source[static_cast<std::size_t>(off + i)];
        }
        return Status::Ok;
    }

    Status tryLoadTerrainBytes(i32 mapX, i32 mapY, Vec<u8>* out) const noexcept override {
        const i32 mapIdx = findMapIndex(mapX, mapY);
        if (mapIdx < 0) {
            return Status::NotFound;
        }
        return copySpanSlice(
            terrainBytes,
            terrainOffsets[static_cast<std::size_t>(mapIdx)],
            terrainLengths[static_cast<std::size_t>(mapIdx)],
            out);
    }

    Status tryLoadLocBytes(i32 mapX, i32 mapY, Vec<u8>* out) const noexcept override {
        const i32 mapIdx = findMapIndex(mapX, mapY);
        if (mapIdx < 0) {
            return Status::NotFound;
        }
        return copySpanSlice(
            locBytes,
            locOffsets[static_cast<std::size_t>(mapIdx)],
            locLengths[static_cast<std::size_t>(mapIdx)],
            out);
    }

    Status tryLoadNpcSpawnBytes(i32, i32, Vec<u8>* out) const noexcept override {
        if (!out) {
            return Status::InvalidArgument;
        }
        out->clear();
        return Status::NotFound;
    }
};

i32 inferTerrainBorderSize(i32 sizeX, i32 sizeY) noexcept {
    const i32 minSize = (sizeX < sizeY) ? sizeX : sizeY;
    if (minSize <= 64) {
        return 0;
    }
    const i32 extra = minSize - 64;
    return extra > 0 ? (extra / 2) : 0;
}

static i32 terrainShapeFaceCount(i32 overlayIdMinusOne, i32 tileShapeRaw) noexcept {
    static constexpr i32 kShapeFaceCounts[] = {
        2, // underlay-only
        2, 2, 3, 3, 3, 3, 4, 4, 4, 6, 6, 6,
    };
    if (overlayIdMinusOne < 0) {
        return kShapeFaceCounts[0];
    }
    i32 shapeId = tileShapeRaw + 1;
                if (shapeId < 1 || shapeId > 12) {
        shapeId = 0;
    }
    return kShapeFaceCounts[static_cast<std::size_t>(shapeId)];
}

i32 floorDiv(i32 n, i32 d) noexcept {
    const i32 q = n / d;
    const i32 r = n % d;
    if (r != 0 && ((r < 0) != (d < 0))) {
        return static_cast<i32>(q - 1);
    }
    return q;
}

i32 ceilDiv(i32 n, i32 d) noexcept {
    const i32 q = n / d;
    const i32 r = n % d;
    if (r != 0 && ((r < 0) == (d < 0))) {
        return static_cast<i32>(q + 1);
    }
    return q;
}


static Status appendPackedVertex(
    Vec<u8>* outVertices,
    i32 x,
    i32 y,
    i32 z,
    i32 hsl,
    i32 alpha,
    float u,
    float v,
    i32 priority,
    i32 textureId = -1,
    i32 textureId1 = -1,
    float textureBlend = 0.0f) noexcept {
    return PackedVertex::append(
        outVertices,
        x,
        y,
        z,
        hsl,
        alpha,
        u,
        v,
        priority,
        textureId,
        textureId1,
        textureBlend);
}

static i32 modelAdjustLightness(i32 hsl, i32 lightness) noexcept {
    i32 outLightness = ((hsl & 127) * lightness) >> 7;
    if (outLightness < 2) {
        outLightness = 2;
    } else if (outLightness > 126) {
        outLightness = 126;
    }
    return (hsl & 0xff80) + outLightness;
}

static i32 modelClampLightness(i32 lightness) noexcept {
    if (lightness < 2) {
        return 2;
    }
    if (lightness > 126) {
        return 126;
    }
    return lightness;
}

static i32 modelFaceRenderType(const ModelData& model, i32 fi) noexcept {
    if (!model.hasFaceRenderTypes || fi < 0 || fi >= static_cast<i32>(model.faceRenderTypes.size())) {
        return 0;
    }
    return static_cast<i32>(model.faceRenderTypes[static_cast<std::size_t>(fi)]) & 0xff;
}


static i32 modelFaceRawTextureId(const ModelData& model, i32 fi) noexcept {
    if (!model.hasFaceTextures || fi < 0 || fi >= static_cast<i32>(model.faceTextures.size())) {
        return -1;
    }
    return static_cast<i32>(model.faceTextures[static_cast<std::size_t>(fi)]);
}

static i32 modelFaceRawAlpha(const ModelData& model, i32 fi) noexcept {
    if (!model.hasFaceAlphas || fi < 0 || fi >= static_cast<i32>(model.faceAlphas.size())) {
        return 0;
    }
    return static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(fi)]);
}
static i32 modelLightIntensity(i32 contrast) noexcept {
    constexpr i32 lightX = -50;
    constexpr i32 lightY = -10;
    constexpr i32 lightZ = -50;
    const i32 magnitude = static_cast<i32>(std::sqrt(
        static_cast<double>(lightX * lightX + lightY * lightY + lightZ * lightZ)));
    return (magnitude * contrast) >> 8;
}

Status initModelFaceLightingState(
    const ModelData& model,
    ModelFaceLightingState* out,
    Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }

    const i32 vertexCount = static_cast<i32>(model.verticesX.size());
    const i32 faceCount = model.faceCount;
    if (vertexCount < 0 || faceCount < 0) {
        return Status::BadFormat;
    }

    out->vertexNormalX = Vec<i32>(alloc);
    out->vertexNormalY = Vec<i32>(alloc);
    out->vertexNormalZ = Vec<i32>(alloc);
    out->vertexNormalMagnitude = Vec<i32>(alloc);
    out->faceNormalX = Vec<i32>(alloc);
    out->faceNormalY = Vec<i32>(alloc);
    out->faceNormalZ = Vec<i32>(alloc);
    // Merged normals are opt-in (mergeNormals scene prepass). Default to "not present".
    out->mergedVertexNormalX = Vec<i32>(alloc);
    out->mergedVertexNormalY = Vec<i32>(alloc);
    out->mergedVertexNormalZ = Vec<i32>(alloc);
    out->mergedVertexNormalMagnitude = Vec<i32>(alloc);
    out->mergedVertexPresent = Vec<u8>(alloc);

    auto rr = out->vertexNormalX.resize(static_cast<std::size_t>(vertexCount));
    if (!rr.isOk()) return rr.status();
    rr = out->vertexNormalY.resize(static_cast<std::size_t>(vertexCount));
    if (!rr.isOk()) return rr.status();
    rr = out->vertexNormalZ.resize(static_cast<std::size_t>(vertexCount));
    if (!rr.isOk()) return rr.status();
    rr = out->vertexNormalMagnitude.resize(static_cast<std::size_t>(vertexCount));
    if (!rr.isOk()) return rr.status();
    rr = out->faceNormalX.resize(static_cast<std::size_t>(faceCount));
    if (!rr.isOk()) return rr.status();
    rr = out->faceNormalY.resize(static_cast<std::size_t>(faceCount));
    if (!rr.isOk()) return rr.status();
    rr = out->faceNormalZ.resize(static_cast<std::size_t>(faceCount));
    if (!rr.isOk()) return rr.status();

    for (i32 i = 0; i < vertexCount; i++) {
        const std::size_t vi = static_cast<std::size_t>(i);
        out->vertexNormalX[vi] = 0;
        out->vertexNormalY[vi] = 0;
        out->vertexNormalZ[vi] = 0;
        out->vertexNormalMagnitude[vi] = 0;
    }
    for (i32 i = 0; i < faceCount; i++) {
        const std::size_t fi = static_cast<std::size_t>(i);
        out->faceNormalX[fi] = 0;
        out->faceNormalY[fi] = 0;
        out->faceNormalZ[fi] = 0;
    }

    // TS parity: normals and bounds use contourVerticesY when present.
    const Vec<i32>* verticesY = &model.verticesY;
    if (!model.contourVerticesY.empty() &&
        model.contourVerticesY.size() == model.verticesY.size()) {
        verticesY = &model.contourVerticesY;
    }

    for (i32 fi = 0; fi < faceCount; fi++) {
        if (fi >= static_cast<i32>(model.indices1.size()) ||
            fi >= static_cast<i32>(model.indices2.size()) ||
            fi >= static_cast<i32>(model.indices3.size())) {
            continue;
        }

        const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
        const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
        const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
        if (ia < 0 || ib < 0 || ic < 0 ||
            ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) {
            continue;
        }

        const i32 dxAB = model.verticesX[static_cast<std::size_t>(ib)] -
            model.verticesX[static_cast<std::size_t>(ia)];
        const i32 dyAB = (*verticesY)[static_cast<std::size_t>(ib)] -
            (*verticesY)[static_cast<std::size_t>(ia)];
        const i32 dzAB = model.verticesZ[static_cast<std::size_t>(ib)] -
            model.verticesZ[static_cast<std::size_t>(ia)];
        const i32 dxAC = model.verticesX[static_cast<std::size_t>(ic)] -
            model.verticesX[static_cast<std::size_t>(ia)];
        const i32 dyAC = (*verticesY)[static_cast<std::size_t>(ic)] -
            (*verticesY)[static_cast<std::size_t>(ia)];
        const i32 dzAC = model.verticesZ[static_cast<std::size_t>(ic)] -
            model.verticesZ[static_cast<std::size_t>(ia)];

        // Match TS `ModelData.calculateVertexNormals` numeric range by doing cross products in 64-bit.
        // JS numbers don't overflow here; signed 32-bit overflow in C++ would be UB and can cause
        // small lighting diffs.
        i64 normalX64 = static_cast<i64>(dyAB) * static_cast<i64>(dzAC) - static_cast<i64>(dyAC) * static_cast<i64>(dzAB);
        i64 normalY64 = static_cast<i64>(dzAB) * static_cast<i64>(dxAC) - static_cast<i64>(dzAC) * static_cast<i64>(dxAB);
        i64 normalZ64 = static_cast<i64>(dxAB) * static_cast<i64>(dyAC) - static_cast<i64>(dxAC) * static_cast<i64>(dyAB);

        while (normalX64 > 8192 || normalY64 > 8192 || normalZ64 > 8192 ||
               normalX64 < -8192 || normalY64 < -8192 || normalZ64 < -8192) {
            normalX64 >>= 1;
            normalY64 >>= 1;
            normalZ64 >>= 1;
        }

        const double nx = static_cast<double>(normalX64);
        const double ny = static_cast<double>(normalY64);
        const double nz = static_cast<double>(normalZ64);
        i32 normalLength = static_cast<i32>(std::trunc(std::sqrt(nx * nx + ny * ny + nz * nz)));
        if (normalLength <= 0) {
            normalLength = 1;
        }

        // TS uses Math.trunc((normal*256)/len). Use floating-point division + trunc to match.
        const i32 normalX = static_cast<i32>(std::trunc((nx * 256.0) / static_cast<double>(normalLength)));
        const i32 normalY = static_cast<i32>(std::trunc((ny * 256.0) / static_cast<double>(normalLength)));
        const i32 normalZ = static_cast<i32>(std::trunc((nz * 256.0) / static_cast<double>(normalLength)));

        const i32 renderType = modelFaceRenderType(model, fi);
        if (renderType == 0) {
            out->vertexNormalX[static_cast<std::size_t>(ia)] += normalX;
            out->vertexNormalY[static_cast<std::size_t>(ia)] += normalY;
            out->vertexNormalZ[static_cast<std::size_t>(ia)] += normalZ;
            out->vertexNormalMagnitude[static_cast<std::size_t>(ia)]++;

            out->vertexNormalX[static_cast<std::size_t>(ib)] += normalX;
            out->vertexNormalY[static_cast<std::size_t>(ib)] += normalY;
            out->vertexNormalZ[static_cast<std::size_t>(ib)] += normalZ;
            out->vertexNormalMagnitude[static_cast<std::size_t>(ib)]++;

            out->vertexNormalX[static_cast<std::size_t>(ic)] += normalX;
            out->vertexNormalY[static_cast<std::size_t>(ic)] += normalY;
            out->vertexNormalZ[static_cast<std::size_t>(ic)] += normalZ;
            out->vertexNormalMagnitude[static_cast<std::size_t>(ic)]++;
        } else if (renderType == 1) {
            out->faceNormalX[static_cast<std::size_t>(fi)] = normalX;
            out->faceNormalY[static_cast<std::size_t>(fi)] = normalY;
            out->faceNormalZ[static_cast<std::size_t>(fi)] = normalZ;
        }
    }

    return Status::Ok;
}

static i32 modelVertexShade(
    const ModelFaceLightingState& lighting,
    i32 vertexIdx,
    i32 ambient,
    i32 lightIntensity) noexcept {
    constexpr i32 lightX = -50;
    constexpr i32 lightY = -10;
    constexpr i32 lightZ = -50;

    bool useMerged = false;
    if (vertexIdx >= 0) {
        const std::size_t vi = static_cast<std::size_t>(vertexIdx);
        if (vi < lighting.mergedVertexPresent.size() && lighting.mergedVertexPresent[vi] != 0) {
            useMerged = true;
        }
    }

    const std::size_t vi = static_cast<std::size_t>(vertexIdx);
    const i32 vnMag = useMerged
        ? lighting.mergedVertexNormalMagnitude[vi]
        : lighting.vertexNormalMagnitude[vi];
    const i64 denom = static_cast<i64>(lightIntensity) * static_cast<i64>(vnMag);
    i32 shade = ambient;
    if (denom != 0) {
        const i64 numer =
            static_cast<i64>(lightY) * static_cast<i64>(useMerged ? lighting.mergedVertexNormalY[vi] : lighting.vertexNormalY[vi]) +
            static_cast<i64>(lightZ) * static_cast<i64>(useMerged ? lighting.mergedVertexNormalZ[vi] : lighting.vertexNormalZ[vi]) +
            static_cast<i64>(lightX) * static_cast<i64>(useMerged ? lighting.mergedVertexNormalX[vi] : lighting.vertexNormalX[vi]);
        shade += static_cast<i32>(numer / denom);
    }
    return shade;
}

// TS parity: in the "textured" lighting path, TS uses floating-point division and truncates only
// at the end via clampLightness(). Integer division here can differ by 1 for negative fractions.
static i32 modelVertexLightnessTextured(
    const ModelFaceLightingState& lighting,
    i32 vertexIdx,
    i32 ambient,
    i32 lightIntensity) noexcept {
    constexpr i32 lightX = -50;
    constexpr i32 lightY = -10;
    constexpr i32 lightZ = -50;

    bool useMerged = false;
    if (vertexIdx >= 0) {
        const std::size_t vi = static_cast<std::size_t>(vertexIdx);
        if (vi < lighting.mergedVertexPresent.size() && lighting.mergedVertexPresent[vi] != 0) {
            useMerged = true;
        }
    }

    const std::size_t vi = static_cast<std::size_t>(vertexIdx);
    const i32 vnMag = useMerged
        ? lighting.mergedVertexNormalMagnitude[vi]
        : lighting.vertexNormalMagnitude[vi];
    const i64 denom = static_cast<i64>(lightIntensity) * static_cast<i64>(vnMag);
    if (denom == 0) {
        return modelClampLightness(ambient);
    }
    const i64 numer =
        static_cast<i64>(lightY) * static_cast<i64>(useMerged ? lighting.mergedVertexNormalY[vi] : lighting.vertexNormalY[vi]) +
        static_cast<i64>(lightZ) * static_cast<i64>(useMerged ? lighting.mergedVertexNormalZ[vi] : lighting.vertexNormalZ[vi]) +
        static_cast<i64>(lightX) * static_cast<i64>(useMerged ? lighting.mergedVertexNormalX[vi] : lighting.vertexNormalX[vi]);

    const double lightnessF =
        static_cast<double>(ambient) +
        static_cast<double>(numer) / static_cast<double>(denom);
    // Match TS clampLightness semantics (clamp then trunc).
    double clamped = lightnessF;
    if (clamped < 2.0) clamped = 2.0;
    if (clamped > 126.0) clamped = 126.0;
    return static_cast<i32>(std::trunc(clamped));
}

static i32 modelFaceShade(
    const ModelFaceLightingState& lighting,
    i32 faceIdx,
    i32 ambient,
    i32 lightIntensity) noexcept {
    constexpr i32 lightX = -50;
    constexpr i32 lightY = -10;
    constexpr i32 lightZ = -50;

    const i64 denom = static_cast<i64>((lightIntensity >> 1) + lightIntensity);
    i32 shade = ambient;
    if (denom != 0) {
        const i64 numer =
            static_cast<i64>(lightY) * static_cast<i64>(lighting.faceNormalY[static_cast<std::size_t>(faceIdx)]) +
            static_cast<i64>(lightZ) * static_cast<i64>(lighting.faceNormalZ[static_cast<std::size_t>(faceIdx)]) +
            static_cast<i64>(lightX) * static_cast<i64>(lighting.faceNormalX[static_cast<std::size_t>(faceIdx)]);
        shade += static_cast<i32>(numer / denom);
    }
    return shade;
}

static i32 modelFaceLightnessTextured(
    const ModelFaceLightingState& lighting,
    i32 faceIdx,
    i32 ambient,
    i32 lightIntensity) noexcept {
    constexpr i32 lightX = -50;
    constexpr i32 lightY = -10;
    constexpr i32 lightZ = -50;

    const i64 denom = static_cast<i64>((lightIntensity >> 1) + lightIntensity);
    if (denom == 0) {
        return modelClampLightness(ambient);
    }
    const i64 numer =
        static_cast<i64>(lightY) * static_cast<i64>(lighting.faceNormalY[static_cast<std::size_t>(faceIdx)]) +
        static_cast<i64>(lightZ) * static_cast<i64>(lighting.faceNormalZ[static_cast<std::size_t>(faceIdx)]) +
        static_cast<i64>(lightX) * static_cast<i64>(lighting.faceNormalX[static_cast<std::size_t>(faceIdx)]);

    const double lightnessF =
        static_cast<double>(ambient) +
        static_cast<double>(numer) / static_cast<double>(denom);
    double clamped = lightnessF;
    if (clamped < 2.0) clamped = 2.0;
    if (clamped > 126.0) clamped = 126.0;
    return static_cast<i32>(std::trunc(clamped));
}

static void computeModelFaceUvType0(
    const ModelData& model,
    i32 fi,
    i32 texCoord,
    float* outU0,
    float* outV0,
    float* outU1,
    float* outV1,
    float* outU2,
    float* outV2) noexcept {
    if (!outU0 || !outV0 || !outU1 || !outV1 || !outU2 || !outV2) {
        return;
    }

    *outU0 = 0.0f;
    *outV0 = 0.0f;
    *outU1 = 0.0f;
    *outV1 = 0.0f;
    *outU2 = 0.0f;
    *outV2 = 0.0f;

    if (fi < 0 ||
        fi >= static_cast<i32>(model.indices1.size()) ||
        fi >= static_cast<i32>(model.indices2.size()) ||
        fi >= static_cast<i32>(model.indices3.size())) {
        return;
    }

    const i32 index0 = model.indices1[static_cast<std::size_t>(fi)];
    const i32 index1 = model.indices2[static_cast<std::size_t>(fi)];
    const i32 index2 = model.indices3[static_cast<std::size_t>(fi)];
    if (index0 < 0 || index1 < 0 || index2 < 0 ||
        index0 >= static_cast<i32>(model.verticesX.size()) ||
        index1 >= static_cast<i32>(model.verticesX.size()) ||
        index2 >= static_cast<i32>(model.verticesX.size()) ||
        index0 >= static_cast<i32>(model.verticesY.size()) ||
        index1 >= static_cast<i32>(model.verticesY.size()) ||
        index2 >= static_cast<i32>(model.verticesY.size()) ||
        index0 >= static_cast<i32>(model.verticesZ.size()) ||
        index1 >= static_cast<i32>(model.verticesZ.size()) ||
        index2 >= static_cast<i32>(model.verticesZ.size())) {
        return;
    }

    i32 p = index0;
    i32 m = index1;
    i32 n = index2;
    if (texCoord != -1) {
        const i32 tc = texCoord & 0xff;
        if (tc >= 0 &&
            tc < static_cast<i32>(model.textureMappingP.size()) &&
            tc < static_cast<i32>(model.textureMappingM.size()) &&
            tc < static_cast<i32>(model.textureMappingN.size())) {
            p = static_cast<i32>(static_cast<u16>(model.textureMappingP[static_cast<std::size_t>(tc)]));
            m = static_cast<i32>(static_cast<u16>(model.textureMappingM[static_cast<std::size_t>(tc)]));
            n = static_cast<i32>(static_cast<u16>(model.textureMappingN[static_cast<std::size_t>(tc)]));
        }
    }

    if (p < 0 || m < 0 || n < 0 ||
        p >= static_cast<i32>(model.verticesX.size()) ||
        m >= static_cast<i32>(model.verticesX.size()) ||
        n >= static_cast<i32>(model.verticesX.size()) ||
        p >= static_cast<i32>(model.verticesY.size()) ||
        m >= static_cast<i32>(model.verticesY.size()) ||
        n >= static_cast<i32>(model.verticesY.size()) ||
        p >= static_cast<i32>(model.verticesZ.size()) ||
        m >= static_cast<i32>(model.verticesZ.size()) ||
        n >= static_cast<i32>(model.verticesZ.size())) {
        return;
    }

    const i32 vx = model.verticesX[static_cast<std::size_t>(p)];
    const i32 vy = model.verticesY[static_cast<std::size_t>(p)];
    const i32 vz = model.verticesZ[static_cast<std::size_t>(p)];

    const i32 edgeMx = model.verticesX[static_cast<std::size_t>(m)] - vx;
    const i32 edgeMy = model.verticesY[static_cast<std::size_t>(m)] - vy;
    const i32 edgeMz = model.verticesZ[static_cast<std::size_t>(m)] - vz;
    const i32 edgeNx = model.verticesX[static_cast<std::size_t>(n)] - vx;
    const i32 edgeNy = model.verticesY[static_cast<std::size_t>(n)] - vy;
    const i32 edgeNz = model.verticesZ[static_cast<std::size_t>(n)] - vz;

    const i32 v0x = model.verticesX[static_cast<std::size_t>(index0)] - vx;
    const i32 v0y = model.verticesY[static_cast<std::size_t>(index0)] - vy;
    const i32 v0z = model.verticesZ[static_cast<std::size_t>(index0)] - vz;
    const i32 v1x = model.verticesX[static_cast<std::size_t>(index1)] - vx;
    const i32 v1y = model.verticesY[static_cast<std::size_t>(index1)] - vy;
    const i32 v1z = model.verticesZ[static_cast<std::size_t>(index1)] - vz;
    const i32 v2x = model.verticesX[static_cast<std::size_t>(index2)] - vx;
    const i32 v2y = model.verticesY[static_cast<std::size_t>(index2)] - vy;
    const i32 v2z = model.verticesZ[static_cast<std::size_t>(index2)] - vz;

    const i32 crossX = edgeMy * edgeNz - edgeMz * edgeNy;
    const i32 crossY = edgeMz * edgeNx - edgeMx * edgeNz;
    const i32 crossZ = edgeMx * edgeNy - edgeMy * edgeNx;

    const i32 uBasisX = edgeNy * crossZ - edgeNz * crossY;
    const i32 uBasisY = edgeNz * crossX - edgeNx * crossZ;
    const i32 uBasisZ = edgeNx * crossY - edgeNy * crossX;
    const double uDenom = static_cast<double>(uBasisX) * static_cast<double>(edgeMx) +
        static_cast<double>(uBasisY) * static_cast<double>(edgeMy) +
        static_cast<double>(uBasisZ) * static_cast<double>(edgeMz);
    if (uDenom == 0.0) {
        return;
    }
    const double invUDenom = 1.0 / uDenom;

    double u0 = (static_cast<double>(uBasisX) * static_cast<double>(v0x) +
        static_cast<double>(uBasisY) * static_cast<double>(v0y) +
        static_cast<double>(uBasisZ) * static_cast<double>(v0z)) * invUDenom;
    double u1 = (static_cast<double>(uBasisX) * static_cast<double>(v1x) +
        static_cast<double>(uBasisY) * static_cast<double>(v1y) +
        static_cast<double>(uBasisZ) * static_cast<double>(v1z)) * invUDenom;
    double u2 = (static_cast<double>(uBasisX) * static_cast<double>(v2x) +
        static_cast<double>(uBasisY) * static_cast<double>(v2y) +
        static_cast<double>(uBasisZ) * static_cast<double>(v2z)) * invUDenom;

    const i32 vBasisX = edgeMy * crossZ - edgeMz * crossY;
    const i32 vBasisY = edgeMz * crossX - edgeMx * crossZ;
    const i32 vBasisZ = edgeMx * crossY - edgeMy * crossX;
    const double vDenom = static_cast<double>(vBasisX) * static_cast<double>(edgeNx) +
        static_cast<double>(vBasisY) * static_cast<double>(edgeNy) +
        static_cast<double>(vBasisZ) * static_cast<double>(edgeNz);
    if (vDenom == 0.0) {
        return;
    }
    const double invVDenom = 1.0 / vDenom;

    const double v0 = (static_cast<double>(vBasisX) * static_cast<double>(v0x) +
        static_cast<double>(vBasisY) * static_cast<double>(v0y) +
        static_cast<double>(vBasisZ) * static_cast<double>(v0z)) * invVDenom;
    const double v1 = (static_cast<double>(vBasisX) * static_cast<double>(v1x) +
        static_cast<double>(vBasisY) * static_cast<double>(v1y) +
        static_cast<double>(vBasisZ) * static_cast<double>(v1z)) * invVDenom;
    const double v2 = (static_cast<double>(vBasisX) * static_cast<double>(v2x) +
        static_cast<double>(vBasisY) * static_cast<double>(v2y) +
        static_cast<double>(vBasisZ) * static_cast<double>(v2z)) * invVDenom;

    if (u1 - u0 > 0.99 && u1 - u0 < 1.1) u1 = 1.0;
    if (u2 - u1 > 0.99 && u2 - u1 < 1.1) u2 = 1.0;
    if (u0 - u2 > 0.99 && u0 - u2 < 1.1) u0 = 1.0;
    if (u0 - u1 > 0.99 && u0 - u1 < 1.1) u0 = 1.0;
    if (u1 - u2 > 0.99 && u1 - u2 < 1.1) u1 = 1.0;
    if (u2 - u0 > 0.99 && u2 - u0 < 1.1) u2 = 1.0;

    *outU0 = static_cast<float>(u0);
    *outV0 = static_cast<float>(v0);
    *outU1 = static_cast<float>(u1);
    *outV1 = static_cast<float>(v1);
    *outU2 = static_cast<float>(u2);
    *outV2 = static_cast<float>(v2);
}
// Terrain emission is implemented in TerrainEmit.cpp.
static Status hasInBoundsLocPlacements(
    const SceneCommandBuildInput& input,
    bool* outHasPlacements,
    Allocator& alloc) noexcept {
    if (!outHasPlacements) {
        return Status::InvalidArgument;
    }
    *outHasPlacements = false;
    const i32 mapStartX = floorDiv(input.baseX, TerrainConstants::MAP_SQUARE_SIZE);
    const i32 mapStartY = floorDiv(input.baseY, TerrainConstants::MAP_SQUARE_SIZE);
    const i32 mapEndX = ceilDiv(
        static_cast<i32>(input.baseX + input.sizeX),
        TerrainConstants::MAP_SQUARE_SIZE);
    const i32 mapEndY = ceilDiv(
        static_cast<i32>(input.baseY + input.sizeY),
        TerrainConstants::MAP_SQUARE_SIZE);

    Vec<u8> mapLocBytes(alloc);
    Vec<LocPlacement> placements(alloc);
    for (i32 mx = mapStartX; mx < mapEndX; mx++) {
        for (i32 my = mapStartY; my < mapEndY; my++) {
            i32 mapIdx = -1;
            const i32 mapId = (mx << 8) + my;
            for (std::size_t i = 0; i < input.mapSquareIds.size(); i++) {
                if (input.mapSquareIds[i] == mapId) {
                    mapIdx = static_cast<i32>(i);
                    break;
                }
            }
            if (mapIdx < 0) {
                continue;
            }
            const i32 off = input.locOffsets[static_cast<std::size_t>(mapIdx)];
            const i32 len = input.locLengths[static_cast<std::size_t>(mapIdx)];
            if (off < 0 || len <= 0) {
                continue;
            }
            auto rr = mapLocBytes.resize(static_cast<std::size_t>(len));
            if (!rr.isOk()) {
                return rr.status();
            }
            for (i32 i = 0; i < len; i++) {
                mapLocBytes[static_cast<std::size_t>(i)] =
                    input.locBytes[static_cast<std::size_t>(off + i)];
            }
            const Status ds = decodeLocPlacementsFromBytes(
                Span<const u8>(mapLocBytes.data(), mapLocBytes.size()),
                &placements,
                alloc);
            if (!ok(ds)) {
                return ds;
            }
            const i32 offsetX = mx * TerrainConstants::MAP_SQUARE_SIZE - input.baseX;
            const i32 offsetY = my * TerrainConstants::MAP_SQUARE_SIZE - input.baseY;
            for (std::size_t i = 0; i < placements.size(); i++) {
                const LocPlacement& p = placements[i];
                const i32 sceneX = p.localX + offsetX;
                const i32 sceneY = p.localY + offsetY;
                if (sceneX > 0 && sceneY > 0 &&
                    sceneX < input.sizeX - 1 &&
                    sceneY < input.sizeY - 1) {
                    *outHasPlacements = true;
                    return Status::Ok;
                }
            }
        }
    }

    return Status::Ok;
}

struct DecodedLocTypeCache final {
    struct Entry final {
        i32 id = -1;
        LocType value{};
    };
    CacheInfo cacheInfo{};
    StringArena strings;
    Vec<Entry> entries;

    DecodedLocTypeCache(const CacheInfo& info, Allocator& alloc) noexcept
        : cacheInfo(info), strings(alloc), entries(alloc) {}
};

struct DecodedVarBitTypeCache final {
    struct Entry final {
        i32 id = -1;
        VarBitType value{};
    };
    CacheInfo cacheInfo{};
    Vec<Entry> entries;

    DecodedVarBitTypeCache(const CacheInfo& info, Allocator& alloc) noexcept
        : cacheInfo(info), entries(alloc) {}
};

struct DecodedSeqTypeCache final {
    struct Entry final {
        i32 id = -1;
        SeqType value{};
    };
    CacheInfo cacheInfo{};
    StringArena strings;
    Vec<Entry> entries;

    DecodedSeqTypeCache(const CacheInfo& info, Allocator& alloc) noexcept
        : cacheInfo(info), strings(alloc), entries(alloc) {}
};

struct DecodedUnderlayTypeCache final {
    struct Entry final {
        i32 id = -1;
        UnderlayFloorType value{};
    };
    Vec<Entry> entries;

    explicit DecodedUnderlayTypeCache(Allocator& alloc) noexcept : entries(alloc) {}
};

struct DecodedOverlayTypeCache final {
    struct Entry final {
        i32 id = -1;
        OverlayFloorType value{};
    };
    Vec<Entry> entries;

    explicit DecodedOverlayTypeCache(Allocator& alloc) noexcept : entries(alloc) {}
};

struct DecodedObjTypeCache final {
    struct Entry final {
        i32 id = -1;
        ObjType value{};
    };
    CacheInfo cacheInfo{};
    StringArena strings;
    Vec<Entry> entries;

    DecodedObjTypeCache(const CacheInfo& info, Allocator& alloc) noexcept
        : cacheInfo(info), strings(alloc), entries(alloc) {}
};

struct DecodedModelFaceStatsCache final {
    struct Entry final {
        i32 id = -1;
        i32 remapHash = 0;
        i32 lightingHash = 0;
        i32 placementType = -1;
        i32 rotation = 0;
        bool isLoc = false;
        ModelFaceStats stats{};
    };
    Vec<Entry> entries;

    explicit DecodedModelFaceStatsCache(Allocator& alloc) noexcept : entries(alloc) {}
};

i32 findTypeBlobIndex(Span<const i32> ids, i32 id) noexcept {
    for (std::size_t i = 0; i < ids.size(); i++) {
        if (ids[i] == id) {
            return static_cast<i32>(i);
        }
    }
    return -1;
}

static bool isTextureTransparent(
    Span<const i32> textureTransparentIds,
    i32 textureId) noexcept {
    if (textureId < 0) {
        return false;
    }
    return findTypeBlobIndex(textureTransparentIds, textureId) >= 0;
}

i32 mapTextureIdToPackedIndex(Span<const i32> textureIds, i32 textureId) noexcept {
    if (textureId < 0) {
        return -1;
    }
    const i32 index = findTypeBlobIndex(textureIds, textureId);
    if (index < 0) {
        return -1;
    }
    // Packed texture indices match TS: 0-based index into the runtime `textureIds` list.
    return index;
}

Status tryDecodeUnderlayTypeFromBlob(
    const SceneCommandBuildInput& input,
    i32 underlayId,
    DecodedUnderlayTypeCache* cache,
    const UnderlayFloorType** outType,
    Allocator& alloc) noexcept {
    if (!cache || !outType) {
        return Status::InvalidArgument;
    }
    *outType = nullptr;
    for (std::size_t i = 0; i < cache->entries.size(); i++) {
        if (cache->entries[i].id == underlayId) {
            *outType = &cache->entries[i].value;
            return Status::Ok;
        }
    }
    const i32 idx = findTypeBlobIndex(input.underlayTypeIds, underlayId);
    if (idx < 0) {
        return Status::NotFound;
    }
    if (idx >= static_cast<i32>(input.underlayTypeOffsets.size()) ||
        idx >= static_cast<i32>(input.underlayTypeLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.underlayTypeOffsets[static_cast<std::size_t>(idx)];
    const i32 len = input.underlayTypeLengths[static_cast<std::size_t>(idx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.underlayTypeBytes.size()) ||
        len > static_cast<i32>(input.underlayTypeBytes.size()) - off) {
        return Status::OutOfRange;
    }
    DecodedUnderlayTypeCache::Entry entry{};
    entry.id = underlayId;
    CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<GameType>(input.cacheGame);
    cacheInfo.revision = input.cacheRevision;
    entry.value = UnderlayFloorType(underlayId, cacheInfo);
    Uint8ArrayReader reader(
        Span<const u8>(input.underlayTypeBytes.data() + off, static_cast<std::size_t>(len)),
        0);
    TypeDecodeError err{};
    TypeDecodeContext ctx{entry.value.cacheInfo, nullptr, &alloc};
    const Status ds = decodeType(entry.value, reader, &err, &ctx);
    if (!ok(ds)) {
        return ds;
    }
    entry.value.post();
    auto rr = cache->entries.pushBack(entry);
    if (!rr.isOk()) {
        return rr.status();
    }
    *outType = &cache->entries[cache->entries.size() - 1].value;
    return Status::Ok;
}

Status tryDecodeOverlayTypeFromBlob(
    const SceneCommandBuildInput& input,
    i32 overlayId,
    DecodedOverlayTypeCache* cache,
    const OverlayFloorType** outType,
    Allocator& alloc) noexcept {
    if (!cache || !outType) {
        return Status::InvalidArgument;
    }
    *outType = nullptr;
    for (std::size_t i = 0; i < cache->entries.size(); i++) {
        if (cache->entries[i].id == overlayId) {
            *outType = &cache->entries[i].value;
            return Status::Ok;
        }
    }
    const i32 idx = findTypeBlobIndex(input.overlayTypeIds, overlayId);
    if (idx < 0) {
        return Status::NotFound;
    }
    if (idx >= static_cast<i32>(input.overlayTypeOffsets.size()) ||
        idx >= static_cast<i32>(input.overlayTypeLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.overlayTypeOffsets[static_cast<std::size_t>(idx)];
    const i32 len = input.overlayTypeLengths[static_cast<std::size_t>(idx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.overlayTypeBytes.size()) ||
        len > static_cast<i32>(input.overlayTypeBytes.size()) - off) {
        return Status::OutOfRange;
    }
    DecodedOverlayTypeCache::Entry entry{};
    entry.id = overlayId;
    CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<GameType>(input.cacheGame);
    cacheInfo.revision = input.cacheRevision;
    entry.value = OverlayFloorType(overlayId, cacheInfo);
    Uint8ArrayReader reader(
        Span<const u8>(input.overlayTypeBytes.data() + off, static_cast<std::size_t>(len)),
        0);
    TypeDecodeError err{};
    TypeDecodeContext ctx{entry.value.cacheInfo, nullptr, &alloc};
    const Status ds = decodeType(entry.value, reader, &err, &ctx);
    if (!ok(ds)) {
        return ds;
    }
    entry.value.post();
    auto rr = cache->entries.pushBack(entry);
    if (!rr.isOk()) {
        return rr.status();
    }
    *outType = &cache->entries[cache->entries.size() - 1].value;
    return Status::Ok;
}

static i32 hashObjTextureRemap(const ObjType& objType) noexcept {
    i32 h = 2166136261u;
    const auto mix = [](i32 hash, i32 v) noexcept -> i32 {
        i32 x = hash;
        const u32 uv = static_cast<u32>(v);
        x ^= static_cast<i32>(uv & 0xffu);
        x *= 16777619u;
        x ^= static_cast<i32>((uv >> 8) & 0xffu);
        x *= 16777619u;
        x ^= static_cast<i32>((uv >> 16) & 0xffu);
        x *= 16777619u;
        x ^= static_cast<i32>((uv >> 24) & 0xffu);
        x *= 16777619u;
        return x;
    };
    h = mix(h, objType.cacheInfo.game == GameType::Runescape ? 1 : 0);
    h = mix(h, objType.cacheInfo.revision);
    h = mix(h, objType.resizeX);
    h = mix(h, objType.resizeY);
    h = mix(h, objType.resizeZ);
    for (std::size_t i = 0; i < objType.recolorFrom.size(); i++) {
        h = mix(h, objType.recolorFrom[i]);
        h = mix(h, i < objType.recolorTo.size() ? objType.recolorTo[i] : 0);
    }
    for (std::size_t i = 0; i < objType.retextureFrom.size(); i++) {
        h = mix(h, objType.retextureFrom[i]);
        h = mix(h, i < objType.retextureTo.size() ? objType.retextureTo[i] : 0);
    }
    return h;
}

[[maybe_unused]] static i32 remapObjTextureId(const ObjType& objType, i32 textureId) noexcept {
    if (textureId < 0) {
        return textureId;
    }
    i32 out = textureId;
    const bool recolorAsRetexture =
        objType.cacheInfo.game == GameType::Runescape && objType.cacheInfo.revision <= 377;
    if (recolorAsRetexture) {
        for (std::size_t i = 0; i < objType.recolorFrom.size(); i++) {
            const i32 from = objType.recolorFrom[i];
            const i32 to = i < objType.recolorTo.size() ? objType.recolorTo[i] : from;
            if (out == from) {
                out = to;
            }
        }
    }
    for (std::size_t i = 0; i < objType.retextureFrom.size(); i++) {
        const i32 from = objType.retextureFrom[i];
        const i32 to = i < objType.retextureTo.size() ? objType.retextureTo[i] : from;
        if (out == from) {
            out = to;
        }
    }
    return out;
}

static void applyObjModelMutations(ModelData* model, const ObjType& objType) noexcept {
    if (!model) {
        return;
    }
    if (objType.resizeX != 128 || objType.resizeY != 128 || objType.resizeZ != 128) {
        model->resize(objType.resizeX, objType.resizeY, objType.resizeZ);
    }

    if (!objType.recolorFrom.empty()) {
        const bool recolorAsRetexture =
            objType.cacheInfo.game == GameType::Runescape &&
            objType.cacheInfo.revision <= 377;
        for (std::size_t i = 0; i < objType.recolorFrom.size(); i++) {
            const i32 from = objType.recolorFrom[i];
            const i32 to = i < objType.recolorTo.size() ? objType.recolorTo[i] : from;
            model->recolor(from, to);
            if (recolorAsRetexture) {
                model->retexture(from, to);
            }
        }
    }

    for (std::size_t i = 0; i < objType.retextureFrom.size(); i++) {
        const i32 from = objType.retextureFrom[i];
        const i32 to = i < objType.retextureTo.size() ? objType.retextureTo[i] : from;
        model->retexture(from, to);
    }
}

Status tryDecodeObjTypeFromBlob(
    const SceneCommandBuildInput& input,
    DecodedObjTypeCache* cache,
    i32 objTypeId,
    const ObjType** outObjType,
    Allocator& alloc) noexcept {
    if (!cache || !outObjType) {
        return Status::InvalidArgument;
    }
    *outObjType = nullptr;
    for (std::size_t i = 0; i < cache->entries.size(); i++) {
        if (cache->entries[i].id == objTypeId) {
            *outObjType = &cache->entries[i].value;
            return Status::Ok;
        }
    }

    const i32 blobIdx = findTypeBlobIndex(input.objTypeIds, objTypeId);
    if (blobIdx < 0) {
        return Status::NotFound;
    }
    if (blobIdx >= static_cast<i32>(input.objTypeOffsets.size()) ||
        blobIdx >= static_cast<i32>(input.objTypeLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.objTypeOffsets[static_cast<std::size_t>(blobIdx)];
    const i32 len = input.objTypeLengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.objTypeBytes.size()) ||
        len > static_cast<i32>(input.objTypeBytes.size()) - off) {
        return Status::OutOfRange;
    }

    ObjType decoded(objTypeId, cache->cacheInfo);
    Uint8ArrayReader reader(
        Span<const u8>(input.objTypeBytes.data() + off, static_cast<std::size_t>(len)),
        0);
    TypeDecodeError err{};
    TypeDecodeContext ctx{cache->cacheInfo, &cache->strings, &alloc};
    const Status ds = decodeType(decoded, reader, &err, &ctx);
    if (!ok(ds)) {
        return ds;
    }

    DecodedObjTypeCache::Entry e{};
    e.id = objTypeId;
    e.value = rs::move(decoded);
    auto rr = cache->entries.pushBack(rs::move(e));
    if (!rr.isOk()) {
        return rr.status();
    }
    *outObjType = &cache->entries[cache->entries.size() - 1].value;
    return Status::Ok;
}

const ObjType* resolveObjTypeForCount(
    const SceneCommandBuildInput& input,
    DecodedObjTypeCache* objTypeCache,
    i32 objTypeId,
    i32 count,
    Allocator& alloc) noexcept {
    const ObjType* current = nullptr;
    Status s = tryDecodeObjTypeFromBlob(input, objTypeCache, objTypeId, &current, alloc);
    if (!ok(s) || !current) {
        return nullptr;
    }

    i32 currentId = objTypeId;
    i32 currentCount = count;
    for (i32 depth = 0; depth < 16; depth++) {
        i32 nextId = -1;
        if (currentCount > 1 && !current->countObj.empty() && !current->countCo.empty()) {
            const std::size_t n =
                current->countObj.size() < current->countCo.size()
                    ? current->countObj.size()
                    : current->countCo.size();
            const std::size_t limit = n < 10 ? n : 10;
            for (std::size_t i = 0; i < limit; i++) {
                const i32 threshold = current->countCo[i];
                if (threshold != 0 && currentCount >= threshold) {
                    nextId = current->countObj[i];
                }
            }
        }
        if (nextId < 0 || nextId == currentId) {
            break;
        }
        const ObjType* next = nullptr;
        s = tryDecodeObjTypeFromBlob(input, objTypeCache, nextId, &next, alloc);
        if (!ok(s) || !next) {
            break;
        }
        current = next;
        currentId = nextId;
        currentCount = 1;
    }

    return current;
}

static i32 hashLocTextureRemap(const LocType& locType) noexcept {
    i32 h = 2166136261u;
    const auto mix = [](i32 hash, i32 v) noexcept -> i32 {
        i32 x = hash;
        const u32 uv = static_cast<u32>(v);
        x ^= static_cast<i32>(uv & 0xffu);
        x *= 16777619u;
        x ^= static_cast<i32>((uv >> 8) & 0xffu);
        x *= 16777619u;
        x ^= static_cast<i32>((uv >> 16) & 0xffu);
        x *= 16777619u;
        x ^= static_cast<i32>((uv >> 24) & 0xffu);
        x *= 16777619u;
        return x;
    };
    h = mix(h, locType.cacheInfo.game == GameType::Runescape ? 1 : 0);
    h = mix(h, locType.cacheInfo.revision);
    h = mix(h, locType.isRotated ? 1 : 0);
    h = mix(h, locType.modelSizeX);
    h = mix(h, locType.modelSizeHeight);
    h = mix(h, locType.modelSizeY);
    h = mix(h, locType.offsetX);
    h = mix(h, locType.offsetHeight);
    h = mix(h, locType.offsetY);
    for (std::size_t i = 0; i < locType.recolorFrom.size(); i++) {
        h = mix(h, locType.recolorFrom[i]);
        h = mix(h, i < locType.recolorTo.size() ? locType.recolorTo[i] : 0);
    }
    for (std::size_t i = 0; i < locType.retextureFrom.size(); i++) {
        h = mix(h, locType.retextureFrom[i]);
        h = mix(h, i < locType.retextureTo.size() ? locType.retextureTo[i] : 0);
    }
    return h;
}

[[maybe_unused]] static i32 remapLocTextureId(const LocType& locType, i32 textureId) noexcept {
    if (textureId < 0) {
        return textureId;
    }
    i32 out = textureId;
    const bool recolorAsRetexture =
        locType.cacheInfo.game == GameType::Runescape && locType.cacheInfo.revision <= 377;
    if (recolorAsRetexture) {
        const std::size_t n = locType.recolorFrom.size();
        for (std::size_t i = 0; i < n; i++) {
            const i32 from = locType.recolorFrom[i];
            const i32 to = i < locType.recolorTo.size() ? locType.recolorTo[i] : from;
            if (out == from) {
                out = to;
            }
        }
    }
    for (std::size_t i = 0; i < locType.retextureFrom.size(); i++) {
        const i32 from = locType.retextureFrom[i];
        const i32 to = i < locType.retextureTo.size() ? locType.retextureTo[i] : from;
        if (out == from) {
            out = to;
        }
    }
    return out;
}

static void applyLocModelMirrorForPlacement(
    ModelData* model,
    const LocType& locType,
    i32 placementType,
    i32 rotation) noexcept {
    if (!model) {
        return;
    }

    const bool mirrored =
        locType.isRotated ||
        (placementType == 2 && rotation > 3); // WALL_CORNER
    if (mirrored) {
        model->mirror();
    }
}

static void applyLocModelPostMergeMutationsForPlacement(
    ModelData* model,
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    bool applyDiagonalNormalVariantRotation) noexcept {
    if (!model) {
        return;
    }

    if (placementType == 4 && rotation > 3) { // WALL_DECORATION_INSIDE
        model->rotate(256);
        model->translate(45, 0, -45);
    }

    const i32 sceneRot = rotation & 3;
    if (sceneRot == 1) {
        model->rotate90();
    } else if (sceneRot == 2) {
        model->rotate180();
    } else if (sceneRot == 3) {
        model->rotate270();
    }

    if (!locType.recolorFrom.empty()) {
        const bool recolorAsRetexture =
            locType.cacheInfo.game == GameType::Runescape &&
            locType.cacheInfo.revision <= 377;
        for (std::size_t i = 0; i < locType.recolorFrom.size(); i++) {
            const i32 from = locType.recolorFrom[i];
            const i32 to = i < locType.recolorTo.size() ? locType.recolorTo[i] : from;
            model->recolor(from, to);
            if (recolorAsRetexture) {
                model->retexture(from, to);
            }
        }
    }

    for (std::size_t i = 0; i < locType.retextureFrom.size(); i++) {
        const i32 from = locType.retextureFrom[i];
        const i32 to = i < locType.retextureTo.size() ? locType.retextureTo[i] : from;
        model->retexture(from, to);
    }

    if (locType.modelSizeX != 128 ||
        locType.modelSizeHeight != 128 ||
        locType.modelSizeY != 128) {
        model->resize(locType.modelSizeX, locType.modelSizeHeight, locType.modelSizeY);
    }

    if (locType.offsetX != 0 || locType.offsetHeight != 0 || locType.offsetY != 0) {
        model->translate(locType.offsetX, locType.offsetHeight, locType.offsetY);
    }

    if (applyDiagonalNormalVariantRotation && placementType == 10 && rotation > 3) { // NORMAL diagonal variant
        model->rotate(256);
    }
}

static void applyLocModelMutationsForPlacement(
    ModelData* model,
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    bool applyDiagonalNormalVariantRotation) noexcept {
    applyLocModelMirrorForPlacement(model, locType, placementType, rotation);
    applyLocModelPostMergeMutationsForPlacement(
        model,
        locType,
        placementType,
        rotation,
        applyDiagonalNormalVariantRotation);
}

Status tryDecodeLocTypeFromBlob(
    const SceneCommandBuildInput& input,
    DecodedLocTypeCache* cache,
    i32 locTypeId,
    const LocType** outLocType,
    Allocator& alloc) noexcept {
    if (!cache || !outLocType) {
        return Status::InvalidArgument;
    }
    *outLocType = nullptr;
    for (std::size_t i = 0; i < cache->entries.size(); i++) {
        if (cache->entries[i].id == locTypeId) {
            *outLocType = &cache->entries[i].value;
            return Status::Ok;
        }
    }

    const i32 blobIdx = findTypeBlobIndex(input.locTypeIds, locTypeId);
    if (blobIdx < 0) {
        return Status::NotFound;
    }
    if (blobIdx >= static_cast<i32>(input.locTypeOffsets.size()) ||
        blobIdx >= static_cast<i32>(input.locTypeLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.locTypeOffsets[static_cast<std::size_t>(blobIdx)];
    const i32 len = input.locTypeLengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.locTypeBytes.size()) ||
        len > static_cast<i32>(input.locTypeBytes.size()) - off) {
        return Status::OutOfRange;
    }

    LocType decoded(locTypeId, cache->cacheInfo);
    Uint8ArrayReader reader(
        Span<const u8>(input.locTypeBytes.data() + off, static_cast<std::size_t>(len)),
        0);
    TypeDecodeError err{};
    TypeDecodeContext ctx{cache->cacheInfo, &cache->strings, &alloc};
    const Status ds = decodeType(decoded, reader, &err, &ctx);
    if (!ok(ds)) {
        return ds;
    }
    decoded.post();
    DecodedLocTypeCache::Entry e{};
    e.id = locTypeId;
    e.value = rs::move(decoded);
    auto rr = cache->entries.pushBack(rs::move(e));
    if (!rr.isOk()) {
        return rr.status();
    }
    *outLocType = &cache->entries[cache->entries.size() - 1].value;
    return Status::Ok;
}

Status tryDecodeVarBitTypeFromBlob(
    const SceneCommandBuildInput& input,
    DecodedVarBitTypeCache* cache,
    i32 varbitId,
    const VarBitType** outVarBit) noexcept {
    if (!cache || !outVarBit) {
        return Status::InvalidArgument;
    }
    *outVarBit = nullptr;
    for (std::size_t i = 0; i < cache->entries.size(); i++) {
        if (cache->entries[i].id == varbitId) {
            *outVarBit = &cache->entries[i].value;
            return Status::Ok;
        }
    }

    const i32 blobIdx = findTypeBlobIndex(input.varbitIds, varbitId);
    if (blobIdx < 0) {
        return Status::NotFound;
    }
    if (blobIdx >= static_cast<i32>(input.varbitOffsets.size()) ||
        blobIdx >= static_cast<i32>(input.varbitLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.varbitOffsets[static_cast<std::size_t>(blobIdx)];
    const i32 len = input.varbitLengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.varbitBytes.size()) ||
        len > static_cast<i32>(input.varbitBytes.size()) - off) {
        return Status::OutOfRange;
    }

    VarBitType decoded(varbitId, cache->cacheInfo);
    Uint8ArrayReader reader(
        Span<const u8>(input.varbitBytes.data() + off, static_cast<std::size_t>(len)),
        0);
    TypeDecodeError err{};
    const Status ds = decodeType(decoded, reader, &err, nullptr);
    if (!ok(ds)) {
        return ds;
    }

    DecodedVarBitTypeCache::Entry e{};
    e.id = varbitId;
    e.value = decoded;
    auto rr = cache->entries.pushBack(e);
    if (!rr.isOk()) {
        return rr.status();
    }
    *outVarBit = &cache->entries[cache->entries.size() - 1].value;
    return Status::Ok;
}

Status tryDecodeSeqTypeFromBlob(
    const SceneCommandBuildInput& input,
    DecodedSeqTypeCache* cache,
    i32 seqTypeId,
    const SeqType** outSeqType,
    Allocator& alloc) noexcept {
    if (!cache || !outSeqType) {
        return Status::InvalidArgument;
    }
    *outSeqType = nullptr;
    for (std::size_t i = 0; i < cache->entries.size(); i++) {
        if (cache->entries[i].id == seqTypeId) {
            *outSeqType = &cache->entries[i].value;
            return Status::Ok;
        }
    }

    const i32 blobIdx = findTypeBlobIndex(input.seqTypeIds, seqTypeId);
    if (blobIdx < 0) {
        return Status::NotFound;
    }
    if (blobIdx >= static_cast<i32>(input.seqTypeOffsets.size()) ||
        blobIdx >= static_cast<i32>(input.seqTypeLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.seqTypeOffsets[static_cast<std::size_t>(blobIdx)];
    const i32 len = input.seqTypeLengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.seqTypeBytes.size()) ||
        len > static_cast<i32>(input.seqTypeBytes.size()) - off) {
        return Status::OutOfRange;
    }

    SeqType decoded(seqTypeId, cache->cacheInfo);
    Uint8ArrayReader reader(
        Span<const u8>(input.seqTypeBytes.data() + off, static_cast<std::size_t>(len)),
        0);
    TypeDecodeError err{};
    TypeDecodeContext ctx{cache->cacheInfo, &cache->strings, &alloc};
    const Status ds = decodeType(decoded, reader, &err, &ctx);
    if (!ok(ds)) {
        return ds;
    }
    DecodedSeqTypeCache::Entry e{};
    e.id = seqTypeId;
    e.value = rs::move(decoded);
    auto rr = cache->entries.pushBack(rs::move(e));
    if (!rr.isOk()) {
        return rr.status();
    }
    *outSeqType = &cache->entries[cache->entries.size() - 1].value;
    return Status::Ok;
}

bool tryGetSeqAlphaHintFromBlob(
    const SceneCommandBuildInput& input,
    i32 seqTypeId,
    bool* outHasAlpha) noexcept {
    if (!outHasAlpha) {
        return false;
    }
    *outHasAlpha = false;
    const i32 blobIdx = findTypeBlobIndex(input.seqAlphaHintIds, seqTypeId);
    if (blobIdx < 0) {
        return false;
    }
    if (blobIdx >= static_cast<i32>(input.seqAlphaHintOffsets.size()) ||
        blobIdx >= static_cast<i32>(input.seqAlphaHintLengths.size())) {
        return false;
    }
    const i32 off = input.seqAlphaHintOffsets[static_cast<std::size_t>(blobIdx)];
    const i32 len = input.seqAlphaHintLengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return false;
    }
    if (off > static_cast<i32>(input.seqAlphaHintBytes.size()) ||
        len > static_cast<i32>(input.seqAlphaHintBytes.size()) - off) {
        return false;
    }
    *outHasAlpha = input.seqAlphaHintBytes[static_cast<std::size_t>(off)] != 0;
    return true;
}

static i32 getVarpValue(Span<const i32> varps, i32 varpId) noexcept {
    if (varpId < 0 || static_cast<std::size_t>(varpId) >= varps.size()) {
        return 0;
    }
    return varps[static_cast<std::size_t>(varpId)];
}

static i32 getVarbitValue(
    const SceneCommandBuildInput& input,
    DecodedVarBitTypeCache* varbitCache,
    i32 varbitId) noexcept {
    const VarBitType* varbit = nullptr;
    const Status s = tryDecodeVarBitTypeFromBlob(input, varbitCache, varbitId, &varbit);
    if (!ok(s) || !varbit) {
        return 0;
    }
    const i32 value = getVarpValue(input.varpValues, varbit->baseVar);
    const i32 bitCount = varbit->endBit - varbit->startBit;
    if (bitCount <= 0 || bitCount > 31) {
        return 0;
    }
    const i32 mask = (1 << bitCount) - 1;
    return (value >> varbit->startBit) & mask;
}

static const LocType* resolveLocTypeForPlacement(
    const SceneCommandBuildInput& input,
    DecodedLocTypeCache* locTypeCache,
    DecodedVarBitTypeCache* varbitCache,
    i32 locTypeId,
    bool* outBaseHadTransforms,
    Allocator& alloc) noexcept {
    if (outBaseHadTransforms) {
        *outBaseHadTransforms = false;
    }

    const LocType* base = nullptr;
    const Status bs = tryDecodeLocTypeFromBlob(input, locTypeCache, locTypeId, &base, alloc);
    if (!ok(bs) || !base) {
        return nullptr;
    }

    const bool baseHadTransforms = !base->transforms.empty();
    if (outBaseHadTransforms) {
        *outBaseHadTransforms = baseHadTransforms;
    }

    if (!baseHadTransforms) {
        return base;
    }

    i32 transformIndex = -1;
    if (base->transformVarbit != -1) {
        transformIndex = getVarbitValue(input, varbitCache, base->transformVarbit);
    } else if (base->transformVarp != -1) {
        transformIndex = getVarpValue(input.varpValues, base->transformVarp);
    }

    i32 transformId = base->transforms[base->transforms.size() - 1];
    if (transformIndex >= 0 &&
        transformIndex < static_cast<i32>(base->transforms.size()) - 1 &&
        base->transforms[static_cast<std::size_t>(transformIndex)] != -1) {
        transformId = base->transforms[static_cast<std::size_t>(transformIndex)];
    }
    if (transformId == -1) {
        return nullptr;
    }

    const LocType* transformed = nullptr;
    const Status ts = tryDecodeLocTypeFromBlob(input, locTypeCache, transformId, &transformed, alloc);
    if (!ok(ts) || !transformed) {
        return nullptr;
    }
    return transformed;
}

static const Vec<i32>* findLocTypeModelGroupForType(
    const LocType& locType,
    i32 modelType) noexcept {
    if (locType.models.empty()) {
        return nullptr;
    }
    if (locType.types.empty()) {
        if (modelType != 10) {
            return nullptr;
        }
        return &locType.models[0];
    }
    for (std::size_t i = 0; i < locType.types.size(); i++) {
        if (locType.types[i] == modelType) {
            return &locType.models[i];
        }
    }
    return nullptr;
}

bool collectLocTypeModelIdsForVariant(
    const LocType& locType,
    i32 modelType,
    Vec<i32>* outModelIds) noexcept {
    if (!outModelIds) {
        return false;
    }
    outModelIds->clear();
    const Vec<i32>* group = findLocTypeModelGroupForType(locType, modelType);
    if (!group || group->empty()) {
        return false;
    }
    auto rrResize = outModelIds->resize(group->size());
    if (!rrResize.isOk()) {
        return false;
    }
    for (std::size_t i = 0; i < group->size(); i++) {
        (*outModelIds)[i] = (*group)[i];
    }
    return true;
}

static bool appendLocTypeModelRefs(
    const LocType& locType,
    i32 modelType,
    i32 rotation,
    Vec<LocModelVariantRef>* outModelRefs) noexcept {
    if (!outModelRefs) {
        return false;
    }
    const Vec<i32>* group = findLocTypeModelGroupForType(locType, modelType);
    if (!group || group->empty()) {
        return false;
    }

    for (std::size_t i = 0; i < group->size(); i++) {
        LocModelVariantRef ref{};
        ref.modelId = (*group)[i];
        ref.placementType = modelType;
        ref.rotation = rotation;
        auto rr = outModelRefs->pushBack(ref);
        if (!rr.isOk()) {
            return false;
        }
    }
    return true;
}

bool collectLocTypeModelRefs(
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    Vec<LocModelVariantRef>* outModelRefs) noexcept {
    if (!outModelRefs) {
        return false;
    }
    outModelRefs->clear();

    SceneLocPlacementModelVariant variants[2]{};
    const i32 variantCount = expandSceneLocPlacementModelVariants(
        placementType,
        rotation,
        variants,
        2);

    bool added = false;
    for (i32 i = 0; i < variantCount; i++) {
        added = appendLocTypeModelRefs(
            locType,
            variants[static_cast<std::size_t>(i)].placementType,
            variants[static_cast<std::size_t>(i)].rotation,
            outModelRefs) || added;
    }
    return added;
}

i32 fnv1aMixI32(i32 hash, i32 value) noexcept {
    i32 x = hash;
    const u32 uv = static_cast<u32>(value);
    x ^= static_cast<i32>(uv & 0xffu);
    x *= 16777619u;
    x ^= static_cast<i32>((uv >> 8) & 0xffu);
    x *= 16777619u;
    x ^= static_cast<i32>((uv >> 16) & 0xffu);
    x *= 16777619u;
    x ^= static_cast<i32>((uv >> 24) & 0xffu);
    x *= 16777619u;
    return x;
}

static i32 hashModelLightingParams(i32 ambient, i32 contrast) noexcept {
    i32 h = 2166136261u;
    h = fnv1aMixI32(h, ambient);
    h = fnv1aMixI32(h, contrast);
    return h;
}

static void recomputeLocMergedDummyDebugStatsFromPackedCommands(SceneCommandStream* out) noexcept {
    if (!out) {
        return;
    }

    out->debugLocMergedDummyCommandCount = 0;
    out->debugLocMergedDummyElementsTotal = 0;
    out->debugLocMergedDummyHash = 0;
    out->debugLocMergedDummyBaseCount = 0;
    out->debugLocMergedDummyAlphaCount = 0;
    out->debugLocMergedDummyLodCount = 0;
    out->debugLocMergedDummyLodAlphaCount = 0;

    i32 hash = 2166136261u;
    i32 instanceBase = 0;
    const std::size_t cmdCount = out->cmdBucketIndices.size();
    for (std::size_t cmdIndex = 0; cmdIndex < cmdCount; cmdIndex++) {
        const i32 bucket = out->cmdBucketIndices[cmdIndex];
        const i32 instanceCount =
            cmdIndex < out->cmdInstanceCounts.size() ? out->cmdInstanceCounts[cmdIndex] : 0;
        const i32 packedOff = instanceBase * 8;

        if (bucket >= 0 &&
            bucket <= 3 &&
            instanceCount == 1 &&
            packedOff >= 0 &&
            static_cast<std::size_t>(packedOff + 7) < out->cmdPackedInstances.size()) {
            const i32 sceneX = out->cmdPackedInstances[static_cast<std::size_t>(packedOff + 0)];
            const i32 sceneZ = out->cmdPackedInstances[static_cast<std::size_t>(packedOff + 1)];
            const i32 heightOffset = out->cmdPackedInstances[static_cast<std::size_t>(packedOff + 2)];
            const i32 level = out->cmdPackedInstances[static_cast<std::size_t>(packedOff + 3)];
            const i32 contour = out->cmdPackedInstances[static_cast<std::size_t>(packedOff + 4)];
            const i32 priority = out->cmdPackedInstances[static_cast<std::size_t>(packedOff + 5)];
            const i32 interactType = out->cmdPackedInstances[static_cast<std::size_t>(packedOff + 6)];
            const u32 interactId = static_cast<u32>(
                out->cmdPackedInstances[static_cast<std::size_t>(packedOff + 7)]);

            if (sceneX == 0 &&
                sceneZ == 0 &&
                heightOffset == 0 &&
                contour == static_cast<i32>(ContourGroundType::None) &&
                priority > 0 &&
                interactType == static_cast<i32>(InteractType::None) &&
                interactId == 0xffffu) {
                out->debugLocMergedDummyCommandCount++;

                const i32 elements =
                    cmdIndex < out->cmdElements.size() ? out->cmdElements[cmdIndex] : 0;
                out->debugLocMergedDummyElementsTotal += elements;

                if (bucket == static_cast<i32>(DrawBucketKey::Base)) {
                    out->debugLocMergedDummyBaseCount++;
                } else if (bucket == static_cast<i32>(DrawBucketKey::Alpha)) {
                    out->debugLocMergedDummyAlphaCount++;
                } else if (bucket == static_cast<i32>(DrawBucketKey::Lod)) {
                    out->debugLocMergedDummyLodCount++;
                } else if (bucket == static_cast<i32>(DrawBucketKey::LodAlpha)) {
                    out->debugLocMergedDummyLodAlphaCount++;
                }

                const i32 offsetWords =
                    (cmdIndex < out->cmdOffsets.size() ? out->cmdOffsets[cmdIndex] : 0) >> 2;
                hash = fnv1aMixI32(hash, bucket);
                hash = fnv1aMixI32(hash, offsetWords);
                hash = fnv1aMixI32(hash, elements);
                hash = fnv1aMixI32(hash, level);
                hash = fnv1aMixI32(hash, priority);
            }
        }

        instanceBase += instanceCount;
    }

    out->debugLocMergedDummyHash =
        out->debugLocMergedDummyCommandCount > 0 ? hash : 0;
}

static i32 hashLocModelVariantSignature(
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    Span<const LocModelVariantRef> refs) noexcept {
    i32 h = 2166136261u;
    h = fnv1aMixI32(h, locType.cacheInfo.game == GameType::Runescape ? 1 : 0);
    h = fnv1aMixI32(h, locType.cacheInfo.revision);
    h = fnv1aMixI32(h, locType.id);
    h = fnv1aMixI32(h, placementType);
    h = fnv1aMixI32(h, rotation);
    h = fnv1aMixI32(h, locType.isRotated ? 1 : 0);
    h = fnv1aMixI32(h, locType.modelSizeX);
    h = fnv1aMixI32(h, locType.modelSizeHeight);
    h = fnv1aMixI32(h, locType.modelSizeY);
    h = fnv1aMixI32(h, locType.offsetX);
    h = fnv1aMixI32(h, locType.offsetHeight);
    h = fnv1aMixI32(h, locType.offsetY);
    h = fnv1aMixI32(h, hashLocTextureRemap(locType));
    for (std::size_t i = 0; i < refs.size(); i++) {
        h = fnv1aMixI32(h, refs[i].modelId);
    }
    return h;
}

static void xxh32UpdateI32Span(XXH32_state_t* state, Span<const i32> values) noexcept {
    if (!state || values.empty()) {
        return;
    }
    const std::size_t bytes = values.size() * sizeof(i32);
    XXH32_update(state, values.data(), bytes);
}

// TS parity: ModelData.light() filters faceTextures to "SD-only" before lighting and before model hashing.
// In TS this is `textureId !== -1 && textureLoader.isSd(textureId)` else texture=-1.
// Here, `input.textureIds` is the runtime SD texture id list; anything not present must be treated as -1.
static inline i32 filterSdTextureId(const SceneCommandBuildInput& input, i32 textureId) noexcept {
    if (textureId < 0) {
        return -1;
    }
    return mapTextureIdToPackedIndex(input.textureIds, textureId) >= 0 ? textureId : -1;
}

static Status computeLitModelHashForGrouping(
    const SceneCommandBuildInput& input,
    ModelData& model,
    i32 ambient,
    i32 contrast,
    i32 placementType,
    i32 rotation,
    const LocType* locType,
    const ObjType* objType,
    i32* outHash,
    Allocator& alloc) noexcept {
    if (!outHash) {
        return Status::InvalidArgument;
    }
    *outHash = 0;

    Vec<i32> faceColors1(alloc);
    Vec<i32> faceColors2(alloc);
    Vec<i32> faceColors3(alloc);
    Vec<i32> textureIds(alloc);
    const std::size_t faceCount = static_cast<std::size_t>(model.faceCount < 0 ? 0 : model.faceCount);
    (void)locType;
    (void)objType;

    auto rr = faceColors1.resize(faceCount);
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = faceColors2.resize(faceCount);
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = faceColors3.resize(faceCount);
    if (!rr.isOk()) {
        return rr.status();
    }
    if (model.hasFaceTextures) {
        rr = textureIds.resize(model.faceTextures.size());
        if (!rr.isOk()) {
            return rr.status();
        }
        for (std::size_t ti = 0; ti < model.faceTextures.size(); ti++) {
            const i32 rawTextureId = static_cast<i32>(model.faceTextures[ti]);
            textureIds[ti] = filterSdTextureId(input, rawTextureId);
        }
    }

    ModelFaceLightingState lighting(alloc);
    const Status ls = initModelFaceLightingState(model, &lighting, alloc);
    if (!ok(ls)) {
        return ls;
    }
    const i32 lightIntensity = modelLightIntensity(contrast);

    for (i32 fi = 0; fi < model.faceCount; fi++) {
        i32 faceType = modelFaceRenderType(model, fi);
        const i32 rawTextureId = modelFaceRawTextureId(model, fi);
        const i32 rawAlphaSigned = modelFaceRawAlpha(model, fi);
        if (rawAlphaSigned == -2) {
            faceType = 3;
        } else if (rawAlphaSigned == -1) {
            faceType = 2;
        }

        // TS parity: "textured" depends on SD-availability filtering (see filterSdTextureId()).
        const i32 textureId = filterSdTextureId(input, rawTextureId);
        const bool hasTexture = textureId != -1;

        const bool hasIndices =
            fi >= 0 &&
            fi < static_cast<i32>(model.indices1.size()) &&
            fi < static_cast<i32>(model.indices2.size()) &&
            fi < static_cast<i32>(model.indices3.size());

        const i32 baseColor =
            (fi >= 0 && fi < static_cast<i32>(model.faceColors.size()))
                ? static_cast<i32>(model.faceColors[static_cast<std::size_t>(fi)] & 0xffffu)
                : 0;

        i32 c1 = 0;
        i32 c2 = 0;
        i32 c3 = 0;

        if (!hasTexture) {
            if (faceType == 0 && hasIndices) {
                const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
                const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
                const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
                const i32 shadeA = modelVertexShade(lighting, ia, ambient, lightIntensity);
                const i32 shadeB = modelVertexShade(lighting, ib, ambient, lightIntensity);
                const i32 shadeC = modelVertexShade(lighting, ic, ambient, lightIntensity);
                const i32 shadeA17 = static_cast<i32>(static_cast<u32>(shadeA) << 17);
                const i32 shadeB17 = static_cast<i32>(static_cast<u32>(shadeB) << 17);
                const i32 shadeC17 = static_cast<i32>(static_cast<u32>(shadeC) << 17);
                c1 = static_cast<i32>(static_cast<u32>(shadeA17) |
                                      static_cast<u32>(modelAdjustLightness(baseColor, shadeA)));
                c2 = static_cast<i32>(static_cast<u32>(shadeB17) |
                                      static_cast<u32>(modelAdjustLightness(baseColor, shadeB)));
                c3 = static_cast<i32>(static_cast<u32>(shadeC17) |
                                      static_cast<u32>(modelAdjustLightness(baseColor, shadeC)));
            } else if (faceType == 1 && hasIndices) {
                const i32 shade = modelFaceShade(lighting, fi, ambient, lightIntensity);
                const i32 shade17 = static_cast<i32>(static_cast<u32>(shade) << 17);
                c1 = static_cast<i32>(static_cast<u32>(shade17) |
                                      static_cast<u32>(modelAdjustLightness(baseColor, shade)));
                c3 = -1;
            } else if (faceType == 3) {
                c1 = 128;
                c3 = -1;
            } else {
                c3 = -2;
            }
        } else {
            if (faceType == 0 && hasIndices) {
                const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
                const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
                const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
                c1 = modelVertexLightnessTextured(lighting, ia, ambient, lightIntensity);
                c2 = modelVertexLightnessTextured(lighting, ib, ambient, lightIntensity);
                c3 = modelVertexLightnessTextured(lighting, ic, ambient, lightIntensity);
            } else if (faceType == 1 && hasIndices) {
                c1 = modelFaceLightnessTextured(lighting, fi, ambient, lightIntensity);
                c3 = -1;
            } else {
                c3 = -2;
            }
        }

        faceColors1[static_cast<std::size_t>(fi)] = c1;
        faceColors2[static_cast<std::size_t>(fi)] = c2;
        faceColors3[static_cast<std::size_t>(fi)] = c3;
    }

    XXH32_state_t* state = XXH32_createState();
    if (!state) {
        return Status::OutOfMemory;
    }

    XXH32_reset(state, 0);
    xxh32UpdateI32Span(state, Span<const i32>(faceColors1.data(), faceColors1.size()));
    xxh32UpdateI32Span(state, Span<const i32>(faceColors2.data(), faceColors2.size()));
    xxh32UpdateI32Span(state, Span<const i32>(faceColors3.data(), faceColors3.size()));
    xxh32UpdateI32Span(state, Span<const i32>(model.verticesX.data(), model.verticesX.size()));
    xxh32UpdateI32Span(state, Span<const i32>(model.verticesY.data(), model.verticesY.size()));
    xxh32UpdateI32Span(state, Span<const i32>(model.verticesZ.data(), model.verticesZ.size()));
    xxh32UpdateI32Span(state, Span<const i32>(textureIds.data(), textureIds.size()));

    *outHash = static_cast<i32>(XXH32_digest(state));
    XXH32_freeState(state);
    return Status::Ok;
}

Status computeLitModelHashForGroupingWithLightingState(
    const SceneCommandBuildInput& input,
    ModelData& model,
    const ModelFaceLightingState& lighting,
    i32 ambient,
    i32 contrast,
    i32 placementType,
    i32 rotation,
    const LocType* locType,
    const ObjType* objType,
    i32* outHash,
    Allocator& alloc) noexcept {
    (void)locType;
    (void)objType;
    if (!outHash) {
        return Status::InvalidArgument;
    }
    *outHash = 0;

    Vec<i32> faceColors1(alloc);
    Vec<i32> faceColors2(alloc);
    Vec<i32> faceColors3(alloc);
    Vec<i32> textureIds(alloc);
    const std::size_t faceCount = static_cast<std::size_t>(model.faceCount < 0 ? 0 : model.faceCount);

    auto rr = faceColors1.resize(faceCount);
    if (!rr.isOk()) return rr.status();
    rr = faceColors2.resize(faceCount);
    if (!rr.isOk()) return rr.status();
    rr = faceColors3.resize(faceCount);
    if (!rr.isOk()) return rr.status();
    if (model.hasFaceTextures) {
        rr = textureIds.resize(model.faceTextures.size());
        if (!rr.isOk()) return rr.status();
        for (std::size_t ti = 0; ti < model.faceTextures.size(); ti++) {
            const i32 rawTextureId = static_cast<i32>(model.faceTextures[ti]);
            textureIds[ti] = filterSdTextureId(input, rawTextureId);
        }
    }

    const i32 lightIntensity = modelLightIntensity(contrast);

    for (i32 fi = 0; fi < model.faceCount; fi++) {
        i32 faceType = modelFaceRenderType(model, fi);
        const i32 rawTextureId = modelFaceRawTextureId(model, fi);
        const i32 rawAlphaSigned = modelFaceRawAlpha(model, fi);
        if (rawAlphaSigned == -2) {
            faceType = 3;
        } else if (rawAlphaSigned == -1) {
            faceType = 2;
        }

        const i32 textureId = filterSdTextureId(input, rawTextureId);
        const bool hasTexture = textureId != -1;

        const bool hasIndices =
            fi >= 0 &&
            fi < static_cast<i32>(model.indices1.size()) &&
            fi < static_cast<i32>(model.indices2.size()) &&
            fi < static_cast<i32>(model.indices3.size());

        const i32 baseColor =
            (fi >= 0 && fi < static_cast<i32>(model.faceColors.size()))
                ? static_cast<i32>(model.faceColors[static_cast<std::size_t>(fi)] & 0xffffu)
                : 0;

        i32 c1 = 0;
        i32 c2 = 0;
        i32 c3 = 0;

        if (!hasTexture) {
            if (faceType == 0 && hasIndices) {
                const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
                const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
                const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
                const i32 shadeA = modelVertexShade(lighting, ia, ambient, lightIntensity);
                const i32 shadeB = modelVertexShade(lighting, ib, ambient, lightIntensity);
                const i32 shadeC = modelVertexShade(lighting, ic, ambient, lightIntensity);
                const i32 shadeA17 = static_cast<i32>(static_cast<u32>(shadeA) << 17);
                const i32 shadeB17 = static_cast<i32>(static_cast<u32>(shadeB) << 17);
                const i32 shadeC17 = static_cast<i32>(static_cast<u32>(shadeC) << 17);
                c1 = static_cast<i32>(static_cast<u32>(shadeA17) |
                                      static_cast<u32>(modelAdjustLightness(baseColor, shadeA)));
                c2 = static_cast<i32>(static_cast<u32>(shadeB17) |
                                      static_cast<u32>(modelAdjustLightness(baseColor, shadeB)));
                c3 = static_cast<i32>(static_cast<u32>(shadeC17) |
                                      static_cast<u32>(modelAdjustLightness(baseColor, shadeC)));
            } else if (faceType == 1 && hasIndices) {
                const i32 shade = modelFaceShade(lighting, fi, ambient, lightIntensity);
                const i32 shade17 = static_cast<i32>(static_cast<u32>(shade) << 17);
                c1 = static_cast<i32>(static_cast<u32>(shade17) |
                                      static_cast<u32>(modelAdjustLightness(baseColor, shade)));
                c3 = -1;
            } else if (faceType == 3) {
                c1 = 128;
                c3 = -1;
            } else {
                c3 = -2;
            }
        } else {
            if (faceType == 0 && hasIndices) {
                const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
                const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
                const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
                c1 = modelVertexLightnessTextured(lighting, ia, ambient, lightIntensity);
                c2 = modelVertexLightnessTextured(lighting, ib, ambient, lightIntensity);
                c3 = modelVertexLightnessTextured(lighting, ic, ambient, lightIntensity);
            } else if (faceType == 1 && hasIndices) {
                c1 = modelFaceLightnessTextured(lighting, fi, ambient, lightIntensity);
                c3 = -1;
            } else {
                c3 = -2;
            }
        }

        faceColors1[static_cast<std::size_t>(fi)] = c1;
        faceColors2[static_cast<std::size_t>(fi)] = c2;
        faceColors3[static_cast<std::size_t>(fi)] = c3;
    }

    XXH32_state_t* state = XXH32_createState();
    if (!state) {
        return Status::OutOfMemory;
    }
    XXH32_reset(state, 0);
    xxh32UpdateI32Span(state, Span<const i32>(faceColors1.data(), faceColors1.size()));
    xxh32UpdateI32Span(state, Span<const i32>(faceColors2.data(), faceColors2.size()));
    xxh32UpdateI32Span(state, Span<const i32>(faceColors3.data(), faceColors3.size()));
    xxh32UpdateI32Span(state, Span<const i32>(model.verticesX.data(), model.verticesX.size()));
    xxh32UpdateI32Span(state, Span<const i32>(model.verticesY.data(), model.verticesY.size()));
    xxh32UpdateI32Span(state, Span<const i32>(model.verticesZ.data(), model.verticesZ.size()));
    xxh32UpdateI32Span(state, Span<const i32>(textureIds.data(), textureIds.size()));
    *outHash = static_cast<i32>(XXH32_digest(state));
    XXH32_freeState(state);
    return Status::Ok;
}

Status computeLocVariantModelHashForGroupingFromBlob(
    const SceneCommandBuildInput& input,
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    Span<const i32> modelIds,
    i32* outHash,
    Allocator& alloc) noexcept {
    if (!outHash) {
        return Status::InvalidArgument;
    }
    *outHash = 0;
    if (modelIds.empty()) {
        return Status::Ok;
    }

    const i32 ambient = locType.ambient + 64;
    const i32 contrast = locType.contrast + 768;
    const i32 lightIntensity = modelLightIntensity(contrast);

    Vec<i32> mergedFaceColors1(alloc);
    Vec<i32> mergedFaceColors2(alloc);
    Vec<i32> mergedFaceColors3(alloc);
    Vec<i32> mergedVerticesX(alloc);
    Vec<i32> mergedVerticesY(alloc);
    Vec<i32> mergedVerticesZ(alloc);
    Vec<i32> mergedTextureIds(alloc);

    for (std::size_t mi = 0; mi < modelIds.size(); mi++) {
        const i32 modelId = modelIds[mi];

        const i32 blobIdx = findTypeBlobIndex(input.modelIds, modelId);
        if (blobIdx < 0) {
            return Status::NotFound;
        }
        if (blobIdx >= static_cast<i32>(input.modelOffsets.size()) ||
            blobIdx >= static_cast<i32>(input.modelLengths.size())) {
            return Status::SizeMismatch;
        }
        const i32 off = input.modelOffsets[static_cast<std::size_t>(blobIdx)];
        const i32 len = input.modelLengths[static_cast<std::size_t>(blobIdx)];
        if (off < 0 || len <= 0) {
            return Status::NotFound;
        }
        if (off > static_cast<i32>(input.modelBytes.size()) ||
            len > static_cast<i32>(input.modelBytes.size()) - off) {
            return Status::OutOfRange;
        }

        ModelData model(alloc);
        const Status ds = decodeModelData(
            Span<const u8>(input.modelBytes.data() + off, static_cast<std::size_t>(len)),
            &model,
            alloc);
        if (!ok(ds)) {
            return ds;
        }
        applyLocModelMutationsForPlacement(
            &model,
            locType,
            placementType,
            rotation,
            /*applyDiagonalNormalVariantRotation=*/true);

        const std::size_t faceCount = static_cast<std::size_t>(model.faceCount < 0 ? 0 : model.faceCount);
        Vec<i32> faceColors1(alloc);
        Vec<i32> faceColors2(alloc);
        Vec<i32> faceColors3(alloc);
        Vec<i32> textureIds(alloc);

        auto rr = faceColors1.resize(faceCount);
        if (!rr.isOk()) return rr.status();
        rr = faceColors2.resize(faceCount);
        if (!rr.isOk()) return rr.status();
        rr = faceColors3.resize(faceCount);
        if (!rr.isOk()) return rr.status();
        if (model.hasFaceTextures) {
            rr = textureIds.resize(model.faceTextures.size());
            if (!rr.isOk()) return rr.status();
            for (std::size_t ti = 0; ti < model.faceTextures.size(); ti++) {
                const i32 rawTextureId = static_cast<i32>(model.faceTextures[ti]);
                textureIds[ti] = filterSdTextureId(input, rawTextureId);
            }
        }

        ModelFaceLightingState lighting(alloc);
        const Status ls = initModelFaceLightingState(model, &lighting, alloc);
        if (!ok(ls)) {
            return ls;
        }

    for (i32 fi = 0; fi < model.faceCount; fi++) {
        i32 faceType = modelFaceRenderType(model, fi);
        const i32 rawTextureId = modelFaceRawTextureId(model, fi);
        const i32 rawAlphaSigned = modelFaceRawAlpha(model, fi);
            if (rawAlphaSigned == -2) {
                faceType = 3;
            } else if (rawAlphaSigned == -1) {
                faceType = 2;
            }

            const i32 textureId = filterSdTextureId(input, rawTextureId);
            const bool hasTexture = textureId != -1;

            const bool hasIndices =
                fi >= 0 &&
                fi < static_cast<i32>(model.indices1.size()) &&
                fi < static_cast<i32>(model.indices2.size()) &&
                fi < static_cast<i32>(model.indices3.size());

            const i32 baseColor =
                (fi >= 0 && fi < static_cast<i32>(model.faceColors.size()))
                    ? static_cast<i32>(model.faceColors[static_cast<std::size_t>(fi)] & 0xffffu)
                    : 0;

            i32 c1 = 0;
            i32 c2 = 0;
            i32 c3 = 0;

            if (!hasTexture) {
                if (faceType == 0 && hasIndices) {
                    const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
                    const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
                    const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
                    const i32 shadeA = modelVertexShade(lighting, ia, ambient, lightIntensity);
                    const i32 shadeB = modelVertexShade(lighting, ib, ambient, lightIntensity);
                    const i32 shadeC = modelVertexShade(lighting, ic, ambient, lightIntensity);
                    const i32 shadeA17 = static_cast<i32>(static_cast<u32>(shadeA) << 17);
                    const i32 shadeB17 = static_cast<i32>(static_cast<u32>(shadeB) << 17);
                    const i32 shadeC17 = static_cast<i32>(static_cast<u32>(shadeC) << 17);
                    c1 = static_cast<i32>(static_cast<u32>(shadeA17) |
                                          static_cast<u32>(modelAdjustLightness(baseColor, shadeA)));
                    c2 = static_cast<i32>(static_cast<u32>(shadeB17) |
                                          static_cast<u32>(modelAdjustLightness(baseColor, shadeB)));
                    c3 = static_cast<i32>(static_cast<u32>(shadeC17) |
                                          static_cast<u32>(modelAdjustLightness(baseColor, shadeC)));
                } else if (faceType == 1 && hasIndices) {
                    const i32 shade = modelFaceShade(lighting, fi, ambient, lightIntensity);
                    const i32 shade17 = static_cast<i32>(static_cast<u32>(shade) << 17);
                    c1 = static_cast<i32>(static_cast<u32>(shade17) |
                                          static_cast<u32>(modelAdjustLightness(baseColor, shade)));
                    c3 = -1;
                } else if (faceType == 3) {
                    c1 = 128;
                    c3 = -1;
                } else {
                    c3 = -2;
                }
            } else {
                if (faceType == 0 && hasIndices) {
                    const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
                    const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
                    const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
                    c1 = modelVertexLightnessTextured(lighting, ia, ambient, lightIntensity);
                    c2 = modelVertexLightnessTextured(lighting, ib, ambient, lightIntensity);
                    c3 = modelVertexLightnessTextured(lighting, ic, ambient, lightIntensity);
                } else if (faceType == 1 && hasIndices) {
                    c1 = modelFaceLightnessTextured(lighting, fi, ambient, lightIntensity);
                    c3 = -1;
                } else {
                    c3 = -2;
                }
            }

            faceColors1[static_cast<std::size_t>(fi)] = c1;
            faceColors2[static_cast<std::size_t>(fi)] = c2;
            faceColors3[static_cast<std::size_t>(fi)] = c3;
        }

        // Append in TS getModelHash field order (field-major concatenation).
        for (std::size_t i = 0; i < faceColors1.size(); i++) {
            auto rrPush = mergedFaceColors1.pushBack(faceColors1[i]);
            if (!rrPush.isOk()) return rrPush.status();
        }
        for (std::size_t i = 0; i < faceColors2.size(); i++) {
            auto rrPush = mergedFaceColors2.pushBack(faceColors2[i]);
            if (!rrPush.isOk()) return rrPush.status();
        }
        for (std::size_t i = 0; i < faceColors3.size(); i++) {
            auto rrPush = mergedFaceColors3.pushBack(faceColors3[i]);
            if (!rrPush.isOk()) return rrPush.status();
        }
        for (std::size_t i = 0; i < model.verticesX.size(); i++) {
            auto rrPush = mergedVerticesX.pushBack(model.verticesX[i]);
            if (!rrPush.isOk()) return rrPush.status();
        }
        for (std::size_t i = 0; i < model.verticesY.size(); i++) {
            auto rrPush = mergedVerticesY.pushBack(model.verticesY[i]);
            if (!rrPush.isOk()) return rrPush.status();
        }
        for (std::size_t i = 0; i < model.verticesZ.size(); i++) {
            auto rrPush = mergedVerticesZ.pushBack(model.verticesZ[i]);
            if (!rrPush.isOk()) return rrPush.status();
        }
        for (std::size_t i = 0; i < textureIds.size(); i++) {
            auto rrPush = mergedTextureIds.pushBack(textureIds[i]);
            if (!rrPush.isOk()) return rrPush.status();
        }
    }

    XXH32_state_t* state = XXH32_createState();
    if (!state) {
        return Status::OutOfMemory;
    }
    XXH32_reset(state, 0);
    xxh32UpdateI32Span(state, Span<const i32>(mergedFaceColors1.data(), mergedFaceColors1.size()));
    xxh32UpdateI32Span(state, Span<const i32>(mergedFaceColors2.data(), mergedFaceColors2.size()));
    xxh32UpdateI32Span(state, Span<const i32>(mergedFaceColors3.data(), mergedFaceColors3.size()));
    xxh32UpdateI32Span(state, Span<const i32>(mergedVerticesX.data(), mergedVerticesX.size()));
    xxh32UpdateI32Span(state, Span<const i32>(mergedVerticesY.data(), mergedVerticesY.size()));
    xxh32UpdateI32Span(state, Span<const i32>(mergedVerticesZ.data(), mergedVerticesZ.size()));
    xxh32UpdateI32Span(state, Span<const i32>(mergedTextureIds.data(), mergedTextureIds.size()));
    *outHash = static_cast<i32>(XXH32_digest(state));
    XXH32_freeState(state);
    return Status::Ok;
}

Status tryDecodeModelFaceStatsFromBlob(
    const SceneCommandBuildInput& input,
    DecodedModelFaceStatsCache* cache,
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    i32 modelId,
    const ModelFaceStats** outStats,
    Allocator& alloc) noexcept {
    if (!cache || !outStats) {
        return Status::InvalidArgument;
    }
    const i32 remapHash = hashLocTextureRemap(locType);
    const i32 ambient = locType.ambient + 64;
    const i32 contrast = locType.contrast + 768;
    const i32 lightingHash = hashModelLightingParams(ambient, contrast);
    *outStats = nullptr;
    for (std::size_t i = 0; i < cache->entries.size(); i++) {
        if (cache->entries[i].id == modelId &&
            cache->entries[i].remapHash == remapHash &&
            cache->entries[i].lightingHash == lightingHash &&
            cache->entries[i].isLoc &&
            cache->entries[i].placementType == placementType &&
            cache->entries[i].rotation == rotation) {
            *outStats = &cache->entries[i].stats;
            return Status::Ok;
        }
    }

    const i32 blobIdx = findTypeBlobIndex(input.modelIds, modelId);
    if (blobIdx < 0) {
        return Status::NotFound;
    }
    if (blobIdx >= static_cast<i32>(input.modelOffsets.size()) ||
        blobIdx >= static_cast<i32>(input.modelLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.modelOffsets[static_cast<std::size_t>(blobIdx)];
    const i32 len = input.modelLengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.modelBytes.size()) ||
        len > static_cast<i32>(input.modelBytes.size()) - off) {
        return Status::OutOfRange;
    }

    ModelData model(alloc);
    const Status ds = decodeModelData(
        Span<const u8>(input.modelBytes.data() + off, static_cast<std::size_t>(len)),
        &model,
        alloc);
    if (!ok(ds)) {
        return ds;
    }
    applyLocModelMutationsForPlacement(
        &model,
        locType,
        placementType,
        rotation,
        /*applyDiagonalNormalVariantRotation=*/true);

    ModelFaceStats stats{};
    // Match TS contour-bounds behavior from the lit model shape.
    // Restricting to usedVertexCount can miss vertices that affect contour decisions.
    const i32 boundsCount = static_cast<i32>(model.verticesX.size());
    if (boundsCount > 0 &&
        boundsCount <= static_cast<i32>(model.verticesX.size()) &&
        boundsCount <= static_cast<i32>(model.verticesZ.size())) {
        stats.hasBounds = true;
        stats.minX = model.verticesX[0];
        stats.maxX = model.verticesX[0];
        stats.minZ = model.verticesZ[0];
        stats.maxZ = model.verticesZ[0];
        for (i32 vi = 1; vi < boundsCount; vi++) {
            const i32 vx = model.verticesX[static_cast<std::size_t>(vi)];
            const i32 vz = model.verticesZ[static_cast<std::size_t>(vi)];
            if (vx < stats.minX) stats.minX = vx;
            if (vx > stats.maxX) stats.maxX = vx;
            if (vz < stats.minZ) stats.minZ = vz;
            if (vz > stats.maxZ) stats.maxZ = vz;
        }
    }

    for (i32 i = 0; i < model.faceCount; i++) {
        i32 faceType = modelFaceRenderType(model, i);
        i32 textureId = modelFaceRawTextureId(model, i);
        const i32 rawAlphaSigned = modelFaceRawAlpha(model, i);
        if (rawAlphaSigned == -2) {
            faceType = 3;
        } else if (rawAlphaSigned == -1) {
            faceType = 2;
        }

        const i32 packedTextureId = mapTextureIdToPackedIndex(input.textureIds, textureId);
        if (packedTextureId < 0) {
            textureId = -1;
        }
        const bool hasTexture = textureId != -1;
        const bool textureAlpha =
            hasTexture &&
            isTextureTransparent(input.textureTransparentIds, textureId);

        i32 alpha = 0xff;
        if (!hasTexture &&
            model.hasFaceAlphas &&
            i < static_cast<i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(i)]) & 0xff);
        }
        if (alpha == 0 || alpha == 1) {
            continue;
        }

        if (!hasTexture) {
            if (faceType != 0 && faceType != 1 && faceType != 3) {
                continue;
            }
        } else {
            if (faceType != 0 && faceType != 1) {
                continue;
            }
        }

        if (alpha < 0xff || textureAlpha) {
            stats.alphaElements += 3;
        } else {
            stats.opaqueElements += 3;
        }
    }

    i32 modelHash = 0;
    const Status hs = computeLitModelHashForGrouping(
        input,
        model,
        ambient,
        contrast,
        placementType,
        rotation,
        &locType,
        nullptr,
        &modelHash,
        alloc);
    if (ok(hs)) {
        stats.modelHash = modelHash;
    }

    DecodedModelFaceStatsCache::Entry e{};
    e.id = modelId;
    e.remapHash = remapHash;
    e.lightingHash = lightingHash;
    e.placementType = placementType;
    e.rotation = rotation;
    e.isLoc = true;
    e.stats = stats;
    auto rr = cache->entries.pushBack(e);
    if (!rr.isOk()) {
        return rr.status();
    }
    *outStats = &cache->entries[cache->entries.size() - 1].stats;
    return Status::Ok;
}

Status tryDecodeObjModelFaceStatsFromBlob(
    const SceneCommandBuildInput& input,
    DecodedModelFaceStatsCache* cache,
    const ObjType& objType,
    i32 modelId,
    const ModelFaceStats** outStats,
    Allocator& alloc) noexcept {
    if (!cache || !outStats) {
        return Status::InvalidArgument;
    }
    const i32 remapHash = hashObjTextureRemap(objType);
    const i32 ambient = objType.ambient + 64;
    const i32 contrast = objType.contrast + 768;
    const i32 lightingHash = hashModelLightingParams(ambient, contrast);
    *outStats = nullptr;
    for (std::size_t i = 0; i < cache->entries.size(); i++) {
        if (cache->entries[i].id == modelId &&
            cache->entries[i].remapHash == remapHash &&
            cache->entries[i].lightingHash == lightingHash &&
            !cache->entries[i].isLoc) {
            *outStats = &cache->entries[i].stats;
            return Status::Ok;
        }
    }

    const i32 blobIdx = findTypeBlobIndex(input.modelIds, modelId);
    if (blobIdx < 0) {
        return Status::NotFound;
    }
    if (blobIdx >= static_cast<i32>(input.modelOffsets.size()) ||
        blobIdx >= static_cast<i32>(input.modelLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.modelOffsets[static_cast<std::size_t>(blobIdx)];
    const i32 len = input.modelLengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.modelBytes.size()) ||
        len > static_cast<i32>(input.modelBytes.size()) - off) {
        return Status::OutOfRange;
    }

    ModelData model(alloc);
    const Status ds = decodeModelData(
        Span<const u8>(input.modelBytes.data() + off, static_cast<std::size_t>(len)),
        &model,
        alloc);
    if (!ok(ds)) {
        return ds;
    }
    applyObjModelMutations(&model, objType);

    ModelFaceStats stats{};
    for (i32 i = 0; i < model.faceCount; i++) {
        i32 renderType = modelFaceRenderType(model, i);
        i32 textureId = modelFaceRawTextureId(model, i);
        const i32 rawAlphaSigned = modelFaceRawAlpha(model, i);
        if (rawAlphaSigned == -2) {
            renderType = 3;
        } else if (rawAlphaSigned == -1) {
            renderType = 2;
        }

        const i32 packedTextureId = mapTextureIdToPackedIndex(input.textureIds, textureId);
        if (packedTextureId < 0) {
            textureId = -1;
        }
        const bool hasTexture = textureId != -1;

        i32 alpha = 0xff;
        if (model.hasFaceAlphas &&
            !hasTexture &&
            i < static_cast<i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(i)]) & 0xff);
        }
        if (alpha == 0 || alpha == 1) {
            continue;
        }

        if (!hasTexture) {
            if (renderType != 0 && renderType != 1 && renderType != 3) {
                continue;
            }
        } else {
            if (renderType != 0 && renderType != 1) {
                continue;
            }
        }

        if (alpha < 0xff ||
            (hasTexture &&
             isTextureTransparent(input.textureTransparentIds, textureId))) {
            stats.alphaElements += 3;
        } else {
            stats.opaqueElements += 3;
        }
    }

    i32 modelHash = 0;
    const Status hs = computeLitModelHashForGrouping(
        input,
        model,
        ambient,
        contrast,
        -1,
        0,
        nullptr,
        &objType,
        &modelHash,
        alloc);
    if (ok(hs)) {
        stats.modelHash = modelHash;
    }

    DecodedModelFaceStatsCache::Entry e{};
    e.id = modelId;
    e.remapHash = remapHash;
    e.lightingHash = lightingHash;
    e.isLoc = false;
    e.stats = stats;
    auto rr = cache->entries.pushBack(e);
    if (!rr.isOk()) {
        return rr.status();
    }
    *outStats = &cache->entries[cache->entries.size() - 1].stats;
    return Status::Ok;
}

static Status tryDecodeObjModelFromBlob(
    const SceneCommandBuildInput& input,
    const ObjType& objType,
    i32 modelId,
    ModelData* outModel,
    Allocator& alloc) noexcept {
    if (!outModel) {
        return Status::InvalidArgument;
    }
    const i32 blobIdx = findTypeBlobIndex(input.modelIds, modelId);
    if (blobIdx < 0) {
        return Status::NotFound;
    }
    if (blobIdx >= static_cast<i32>(input.modelOffsets.size()) ||
        blobIdx >= static_cast<i32>(input.modelLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.modelOffsets[static_cast<std::size_t>(blobIdx)];
    const i32 len = input.modelLengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.modelBytes.size()) ||
        len > static_cast<i32>(input.modelBytes.size()) - off) {
        return Status::OutOfRange;
    }

    ModelData model(alloc);
    const Status ds = decodeModelData(
        Span<const u8>(input.modelBytes.data() + off, static_cast<std::size_t>(len)),
        &model,
        alloc);
    if (!ok(ds)) {
        return ds;
    }
    applyObjModelMutations(&model, objType);
    *outModel = rs::move(model);
    return Status::Ok;
}

static Status tryDecodeLocModelFromBlob(
    const SceneCommandBuildInput& input,
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    i32 modelId,
    ModelData* outModel,
    bool applyDiagonalNormalVariantRotation,
    Allocator& alloc) noexcept {
    if (!outModel) {
        return Status::InvalidArgument;
    }
    const i32 blobIdx = findTypeBlobIndex(input.modelIds, modelId);
    if (blobIdx < 0) {
        return Status::NotFound;
    }
    if (blobIdx >= static_cast<i32>(input.modelOffsets.size()) ||
        blobIdx >= static_cast<i32>(input.modelLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.modelOffsets[static_cast<std::size_t>(blobIdx)];
    const i32 len = input.modelLengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.modelBytes.size()) ||
        len > static_cast<i32>(input.modelBytes.size()) - off) {
        return Status::OutOfRange;
    }

    ModelData model(alloc);
    const Status ds = decodeModelData(
        Span<const u8>(input.modelBytes.data() + off, static_cast<std::size_t>(len)),
        &model,
        alloc);
    if (!ok(ds)) {
        return ds;
    }
    applyLocModelMutationsForPlacement(&model, locType, placementType, rotation, applyDiagonalNormalVariantRotation);
    *outModel = rs::move(model);
    return Status::Ok;
}

Status decodeLocModelFromBlobForPlacement(
    const SceneCommandBuildInput& input,
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    i32 modelId,
    ModelData* outModel,
    bool applyDiagonalNormalVariantRotation,
    Allocator& alloc) noexcept {
    return tryDecodeLocModelFromBlob(
        input,
        locType,
        placementType,
        rotation,
        modelId,
        outModel,
        applyDiagonalNormalVariantRotation,
        alloc);
}

bool sampleSceneHeightAtWorld(
    const SceneData& scene,
    i32 level,
    i32 worldX,
    i32 worldZ,
    i32* outHeight) noexcept;

static i32 sampleSceneHeightAtWorldOrZero(
    const SceneData& scene,
    i32 level,
    i32 worldX,
    i32 worldZ) noexcept {
    i32 outHeight = 0;
    if (sampleSceneHeightAtWorld(scene, level, worldX, worldZ, &outHeight)) {
        return outHeight;
    }
    return 0;
}

static void rotateModelDataX(ModelData* model, i32 angle) noexcept {
    if (!model || model->verticesY.empty() || model->verticesZ.empty()) {
        return;
    }
    // Match TS `Model.rotateX` exactly by using the fixed Q16 trig tables.
    const i32 normalized = angle & 2047;
    const Span<const i32> cosine = HeightCalc::cosine65536();
    const i64 cosQ16 = static_cast<i64>(cosine[static_cast<std::size_t>(normalized)]);
    const i64 sinQ16 =
        static_cast<i64>(cosine[static_cast<std::size_t>((normalized - 512) & 2047)]);
    const std::size_t vertexCount =
        model->verticesY.size() < model->verticesZ.size() ? model->verticesY.size() : model->verticesZ.size();
    for (std::size_t i = 0; i < vertexCount; i++) {
        const i64 y = static_cast<i64>(model->verticesY[i]);
        const i64 z = static_cast<i64>(model->verticesZ[i]);
        const i64 yNumerator = y * cosQ16 - z * sinQ16;
        const i64 zNumerator = y * sinQ16 + z * cosQ16;
        model->verticesY[i] = static_cast<i32>(yNumerator >> 16);
        model->verticesZ[i] = static_cast<i32>(zNumerator >> 16);
    }
}

static void rotateModelDataZ(ModelData* model, i32 angle) noexcept {
    if (!model || model->verticesX.empty() || model->verticesY.empty()) {
        return;
    }
    // Match TS `Model.rotateZ` exactly by using the fixed Q16 trig tables.
    const i32 normalized = angle & 2047;
    const Span<const i32> cosine = HeightCalc::cosine65536();
    const i64 cosQ16 = static_cast<i64>(cosine[static_cast<std::size_t>(normalized)]);
    const i64 sinQ16 =
        static_cast<i64>(cosine[static_cast<std::size_t>((normalized - 512) & 2047)]);
    const std::size_t vertexCount =
        model->verticesX.size() < model->verticesY.size() ? model->verticesX.size() : model->verticesY.size();
    for (std::size_t i = 0; i < vertexCount; i++) {
        const i64 x = static_cast<i64>(model->verticesX[i]);
        const i64 y = static_cast<i64>(model->verticesY[i]);
        const i64 xNumerator = x * cosQ16 - y * sinQ16;
        const i64 yNumerator = x * sinQ16 + y * cosQ16;
        model->verticesX[i] = static_cast<i32>(xNumerator >> 16);
        model->verticesY[i] = static_cast<i32>(yNumerator >> 16);
    }
}
Status appendLocPlacementGeometry(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const LocType& resolved,
    const LocPlacement& placement,
    i32 scenePxX,
    i32 scenePxZ,
    i32 contourPxX,
    i32 contourPxZ,
    i32 sceneHeight,
    bool applyContour,
    Span<const i32> modelIds,
    bool transparentOnly,
    Vec<u8>* outVertices,
    Vec<i32>* outIndices,
    i32* outElements,
    Allocator& alloc) noexcept {
    if (!outVertices || !outIndices || !outElements) {
        return Status::InvalidArgument;
    }
    *outElements = 0;
    const i32 ambient = resolved.ambient + 64;
    const i32 contrast = resolved.contrast + 768;

    const i32 renderX = scenePxX;
    const i32 renderZ = scenePxZ;
    const i32 contourX = contourPxX;
    const i32 contourZ = contourPxZ;

    const auto decodeModelRawById = [&](i32 modelId, ModelData* outModel) noexcept -> Status {
        if (!outModel) {
            return Status::InvalidArgument;
        }
        const i32 blobIdx = findTypeBlobIndex(input.modelIds, modelId);
        if (blobIdx < 0) {
            return Status::NotFound;
        }
        if (blobIdx >= static_cast<i32>(input.modelOffsets.size()) ||
            blobIdx >= static_cast<i32>(input.modelLengths.size())) {
            return Status::SizeMismatch;
        }
        const i32 off = input.modelOffsets[static_cast<std::size_t>(blobIdx)];
        const i32 len = input.modelLengths[static_cast<std::size_t>(blobIdx)];
        if (off < 0 || len <= 0) {
            return Status::NotFound;
        }
        if (off > static_cast<i32>(input.modelBytes.size()) ||
            len > static_cast<i32>(input.modelBytes.size()) - off) {
            return Status::OutOfRange;
        }
        return decodeModelData(
            Span<const u8>(input.modelBytes.data() + off, static_cast<std::size_t>(len)),
            outModel,
            alloc);
    };

    Vec<ModelData> decodedModels(alloc);
    auto rrDecodedReserve = decodedModels.reserve(modelIds.size());
    if (!rrDecodedReserve.isOk()) {
        return rrDecodedReserve.status();
    }
    for (std::size_t mi = 0; mi < modelIds.size(); mi++) {
        ModelData model(alloc);
        const Status ms = decodeModelRawById(modelIds[mi], &model);
        if (!ok(ms)) {
            continue;
        }
        // TS LocModelLoader.getLocModelData: mirror per source model before merge.
        applyLocModelMirrorForPlacement(&model, resolved, placement.type, placement.rotation);
        auto rrDecoded = decodedModels.pushBack(rs::move(model));
        if (!rrDecoded.isOk()) {
            return rrDecoded.status();
        }
    }

    // TS parity: LocModelLoader merges all model IDs for a loc variant before contour/light emit.
    if (decodedModels.size() > 1) {
        ModelData mergedModel(alloc);
        const Status mergeStatus = mergeModelDataTS(
            Span<const ModelData>(decodedModels.data(), decodedModels.size()),
            static_cast<i32>(decodedModels.size()),
            &mergedModel,
            alloc);
        if (!ok(mergeStatus)) {
            return mergeStatus;
        }
        decodedModels.clear();
        auto rrMerged = decodedModels.pushBack(rs::move(mergedModel));
        if (!rrMerged.isOk()) {
            return rrMerged.status();
        }
    }

    // TS LocModelLoader.getLocModelData: apply placement-level mutations after merge.
    for (std::size_t mi = 0; mi < decodedModels.size(); mi++) {
        applyLocModelPostMergeMutationsForPlacement(
            &decodedModels[mi],
            resolved,
            placement.type,
            placement.rotation,
            /*applyDiagonalNormalVariantRotation=*/true);
    }

    for (std::size_t mi = 0; mi < decodedModels.size(); mi++) {
        ModelData& model = decodedModels[mi];

        Vec<i32> contourVerticesY(alloc);
        const Vec<i32>* modelVerticesY = &model.verticesY;
        const auto shouldContourTs = [&](i32 contourType) noexcept -> bool {
            if (contourType <= 0) return false;
            if (model.verticesX.empty() || model.verticesY.empty() || model.verticesZ.empty()) return false;
            i32 vertexCount = static_cast<i32>(model.verticesY.size());
            if (vertexCount < 0) vertexCount = 0;
            i32 usedVertexCount = model.usedVertexCount;
            if (usedVertexCount <= 0 || usedVertexCount > vertexCount) {
                usedVertexCount = vertexCount;
            }
            if (usedVertexCount <= 0) return false;

            // TS parity: `ModelData.contourGround` decides to early-return based on model bounds and
            // the four sampled heights at the bounds corners.
            i32 minX = 999999;
            i32 maxX = -999999;
            i32 minZ = 999999;
            i32 maxZ = -999999;
            for (i32 vi = 0; vi < usedVertexCount; vi++) {
                const std::size_t i = static_cast<std::size_t>(vi);
                const i32 vx = model.verticesX[i];
                const i32 vz = model.verticesZ[i];
                if (vx < minX) minX = vx;
                if (vx > maxX) maxX = vx;
                if (vz < minZ) minZ = vz;
                if (vz > maxZ) maxZ = vz;
            }

            const i32 startWorldX = contourX + minX;
            const i32 endWorldX = contourX + maxX;
            const i32 startWorldZ = contourZ + minZ;
            const i32 endWorldZ = contourZ + maxZ;

            const i32 heightMapWidth = scene.sizeX + 1;
            const i32 heightMapHeight = scene.sizeY + 1;
            const i32 endXTile = (endWorldX + 128) >> 7;
            const i32 endZTile = (endWorldZ + 128) >> 7;
            if ((contourType == 1 || contourType == 2 || contourType == 3 || contourType == 4 || contourType == 5) &&
                (startWorldX < 0 ||
                 startWorldZ < 0 ||
                 endXTile >= heightMapWidth ||
                 endZTile >= heightMapHeight)) {
                return false;
            }
            if (contourType == 4 || contourType == 5) {
                const i32 above = placement.level + 1;
                if (above < 0 || above >= scene.levels) {
                    return false;
                }
                return true;
            }

            const i32 sx = startWorldX >> 7;
            const i32 ex = (endWorldX + 127) >> 7;
            const i32 sz = startWorldZ >> 7;
            const i32 ez = (endWorldZ + 127) >> 7;
            if (!isWithinHeightBounds(scene, placement.level, sx, sz) ||
                !isWithinHeightBounds(scene, placement.level, ex, sz) ||
                !isWithinHeightBounds(scene, placement.level, sx, ez) ||
                !isWithinHeightBounds(scene, placement.level, ex, ez)) {
                return false;
            }
            if (scene.height(placement.level, sx, sz) == sceneHeight &&
                scene.height(placement.level, ex, sz) == sceneHeight &&
                scene.height(placement.level, sx, ez) == sceneHeight &&
                scene.height(placement.level, ex, ez) == sceneHeight) {
                return false;
            }
            return true;
        };

        if (applyContour && resolved.contourGroundType > 0 && shouldContourTs(resolved.contourGroundType)) {
            auto rrContour = contourVerticesY.resize(modelVerticesY->size());
            if (rrContour.isOk()) {
                for (std::size_t vi = 0; vi < modelVerticesY->size(); vi++) {
                    contourVerticesY[vi] = model.verticesY[vi];
                }
                i32 contourVertexCount = static_cast<i32>(modelVerticesY->size());
                if (contourVertexCount < 0) {
                    contourVertexCount = 0;
                }
                i32 usedVertexCount = model.usedVertexCount;
                if (usedVertexCount <= 0 || usedVertexCount > contourVertexCount) {
                    usedVertexCount = contourVertexCount;
                }

                i32 minY = 0;
                i32 maxY = 0;
                if (usedVertexCount > 0) {
                    minY = model.verticesY[0];
                    maxY = model.verticesY[0];
                }
                for (i32 vi = 1; vi < usedVertexCount; vi++) {
                    const i32 vy = model.verticesY[static_cast<std::size_t>(vi)];
                    if (vy < minY) minY = vy;
                    if (vy > maxY) maxY = vy;
                }
                const i32 deltaY = maxY - minY;
                const i32 contourType = resolved.contourGroundType;
                const i32 contourParam = resolved.contourGroundParam;

                if (contourType == 3) {
                    const i32 paramU16 = contourParam & 0xffff;
                    const i32 sizeX = (paramU16 & 0xff) * 4;
                    const i32 sizeZ = ((paramU16 >> 8) & 0xff) * 4;
                    const i32 halfSizeX = sizeX / 2;
                    const i32 halfSizeZ = sizeZ / 2;

                    const i32 h00 = sampleSceneHeightAtWorldOrZero(
                        scene,
                        placement.level,
                        contourX - halfSizeX,
                        contourZ - halfSizeZ);
                    const i32 h10 = sampleSceneHeightAtWorldOrZero(
                        scene,
                        placement.level,
                        contourX + halfSizeX,
                        contourZ - halfSizeZ);
                    const i32 h01 = sampleSceneHeightAtWorldOrZero(
                        scene,
                        placement.level,
                        contourX - halfSizeX,
                        contourZ + halfSizeZ);
                    const i32 h11 = sampleSceneHeightAtWorldOrZero(
                        scene,
                        placement.level,
                        contourX + halfSizeX,
                        contourZ + halfSizeZ);

                    const i32 minTop = h00 < h10 ? h00 : h10;
                    const i32 minBottom = h01 < h11 ? h01 : h11;
                    const i32 minRight = h10 < h11 ? h10 : h11;
                    const i32 minLeft = h00 < h01 ? h00 : h01;

                    const double angleFactor = 2048.0 / (2.0 * 3.14159265358979323846);
                    if (sizeZ != 0) {
                        const i32 pitch =
                            (static_cast<i32>(std::atan2(
                                 static_cast<double>(minTop - minBottom),
                                 static_cast<double>(sizeZ)) *
                             angleFactor)) &
                            0x7ff;
                        if (pitch != 0) {
                            rotateModelDataX(&model, pitch);
                        }
                    }
                    if (sizeX != 0) {
                        const i32 roll =
                            (static_cast<i32>(std::atan2(
                                 static_cast<double>(minLeft - minRight),
                                 static_cast<double>(sizeX)) *
                             angleFactor)) &
                            0x7ff;
                        if (roll != 0) {
                            rotateModelDataZ(&model, roll);
                        }
                    }

                    i32 diagSumMin = h00 + h11;
                    const i32 otherDiagSum = h10 + h01;
                    if (otherDiagSum < diagSumMin) {
                        diagSumMin = otherDiagSum;
                    }
                    const i32 yOffset = (diagSumMin >> 1) - sceneHeight;
                    if (yOffset != 0) {
                        model.translate(0, yOffset, 0);
                    }
                    modelVerticesY = &model.verticesY;
                } else {
                for (std::size_t vi = 0; vi < modelVerticesY->size(); vi++) {
                    const i32 baseY = model.verticesY[vi];
                    const i32 worldX = contourX + model.verticesX[vi];
                    const i32 worldZ = contourZ + model.verticesZ[vi];

                    i32 h = 0;
                    i32 hAbove = 0;
                    const bool hasH = sampleSceneHeightAtWorld(scene, placement.level, worldX, worldZ, &h);
                    const bool hasHAbove = sampleSceneHeightAtWorld(scene, placement.level + 1, worldX, worldZ, &hAbove);

                    i32 outY = baseY;
                    if (contourType == 1) {
                        if (hasH) {
                            outY = baseY + h - sceneHeight;
                        }
                    } else if (contourType == 2) {
                        if (contourParam != 0 && minY != 0) {
                            // TS parity: JS `baseY << 16` is a wrapping 32-bit shift; avoid UB on signed shift in C++.
                            const i32 yRatio = static_cast<i32>(static_cast<u32>(baseY) << 16) / minY;
                            if (yRatio < contourParam && hasH) {
                                outY = baseY + ((h - sceneHeight) * (contourParam - yRatio)) / contourParam;
                            }
                        }
                    } else if (contourType == 4) {
                        if (hasHAbove) {
                            outY = baseY + hAbove - sceneHeight + deltaY;
                        }
                    } else if (contourType == 5) {
                        if (deltaY != 0 && hasH && hasHAbove) {
                            const i32 deltaHeight = h - hAbove;
                            // TS parity: JS `baseY << 8` is a wrapping 32-bit shift; avoid UB on signed shift in C++.
                            const i32 yScale = static_cast<i32>(static_cast<u32>(baseY) << 8) / deltaY;
                            const i32 yOffset = (yScale * deltaHeight) >> 8;
                            outY = yOffset - (sceneHeight - h);
                        }
                    }

                    contourVerticesY[vi] = outY;
                }
                modelVerticesY = &contourVerticesY;
                }
            }
        }
        ModelFaceLightingState lighting(alloc);
        const Status ls = initModelFaceLightingState(model, &lighting, alloc);
        if (!ok(ls)) {
            continue;
        }
        const i32 lightIntensity = modelLightIntensity(contrast);

        for (i32 fi = 0; fi < model.faceCount; fi++) {
            i32 faceType = modelFaceRenderType(model, fi);
            i32 textureId = modelFaceRawTextureId(model, fi);
            const i32 rawAlphaSigned = modelFaceRawAlpha(model, fi);
            if (rawAlphaSigned == -2) {
            faceType = 3;
        } else if (rawAlphaSigned == -1) {
            faceType = 2;
        }

            const i32 packedTextureId = mapTextureIdToPackedIndex(input.textureIds, textureId);
            if (packedTextureId < 0) {
                textureId = -1;
            }
            const bool hasTexture = textureId != -1;
            const bool textureAlpha =
                hasTexture &&
                isTextureTransparent(input.textureTransparentIds, textureId);

            i32 alpha = 0xff;
            if (!hasTexture &&
                model.hasFaceAlphas &&
                fi < static_cast<i32>(model.faceAlphas.size())) {
                alpha = 0xff - (static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(fi)]) & 0xff);
            }
            if (alpha == 0 || alpha == 1) {
                continue;
            }

            if (!hasTexture) {
                if (faceType != 0 && faceType != 1 && faceType != 3) {
                    continue;
                }
            } else {
                if (faceType != 0 && faceType != 1) {
                    continue;
                }
            }

            const bool transparent =
                alpha < 0xff ||
                textureAlpha;
            if (transparent != transparentOnly) {
                continue;
            }

            if (fi >= static_cast<i32>(model.indices1.size()) ||
                fi >= static_cast<i32>(model.indices2.size()) ||
                fi >= static_cast<i32>(model.indices3.size()) ||
                fi >= static_cast<i32>(model.faceColors.size())) {
                continue;
            }
            const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
            const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
            const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
            if (ia < 0 || ib < 0 || ic < 0 ||
                ia >= static_cast<i32>(model.verticesX.size()) ||
                ib >= static_cast<i32>(model.verticesX.size()) ||
                ic >= static_cast<i32>(model.verticesX.size()) ||
                ia >= static_cast<i32>(modelVerticesY->size()) ||
                ib >= static_cast<i32>(modelVerticesY->size()) ||
                ic >= static_cast<i32>(modelVerticesY->size()) ||
                ia >= static_cast<i32>(model.verticesZ.size()) ||
                ib >= static_cast<i32>(model.verticesZ.size()) ||
                ic >= static_cast<i32>(model.verticesZ.size())) {
                continue;
            }

            i32 priority = 0;
            if (fi < static_cast<i32>(model.faceRenderPriorities.size())) {
                priority = static_cast<i32>(model.faceRenderPriorities[static_cast<std::size_t>(fi)]);
            } else if (model.hasFaceRenderPriorities) {
                priority = model.priority;
            }

            const i32 baseColor = static_cast<i32>(model.faceColors[static_cast<std::size_t>(fi)] & 0xffffu);
            i32 hslA = baseColor;
            i32 hslB = baseColor;
            i32 hslC = baseColor;
            if (faceType == 0) {
                if (!hasTexture) {
                    const i32 shadeA = modelVertexShade(lighting, ia, ambient, lightIntensity);
                    const i32 shadeB = modelVertexShade(lighting, ib, ambient, lightIntensity);
                    const i32 shadeC = modelVertexShade(lighting, ic, ambient, lightIntensity);
                    hslA = modelAdjustLightness(baseColor, shadeA);
                    hslB = modelAdjustLightness(baseColor, shadeB);
                    hslC = modelAdjustLightness(baseColor, shadeC);
                } else {
                    hslA = modelVertexLightnessTextured(lighting, ia, ambient, lightIntensity);
                    hslB = modelVertexLightnessTextured(lighting, ib, ambient, lightIntensity);
                    hslC = modelVertexLightnessTextured(lighting, ic, ambient, lightIntensity);
                }
            } else if (faceType == 1) {
                if (!hasTexture) {
                    const i32 shade = modelFaceShade(lighting, fi, ambient, lightIntensity);
                    hslA = modelAdjustLightness(baseColor, shade);
                } else {
                    hslA = modelFaceLightnessTextured(lighting, fi, ambient, lightIntensity);
                }
                hslB = hslA;
                hslC = hslA;
            } else if (faceType == 3) {
                hslA = 128;
                hslB = 128;
                hslC = 128;
            }

            float u0 = 0.0f;
            float v0 = 0.0f;
            float u1 = 0.0f;
            float v1 = 0.0f;
            float u2 = 0.0f;
            float v2 = 0.0f;
            if (hasTexture) {
                i32 texCoord = -1;
                if (model.hasTextureCoords && fi < static_cast<i32>(model.textureCoords.size())) {
                    texCoord = static_cast<i32>(model.textureCoords[static_cast<std::size_t>(fi)]);
                }
                i32 textureRenderType = 0;
                if (texCoord != -1) {
                    const i32 tc = texCoord & 0xff;
                    if (tc >= 0 && tc < static_cast<i32>(model.textureRenderTypes.size())) {
                        textureRenderType =
                            static_cast<i32>(model.textureRenderTypes[static_cast<std::size_t>(tc)]) & 0xff;
                    }
                }
                if (textureRenderType == 0) {
                    computeModelFaceUvType0(
                        model,
                        fi,
                        texCoord,
                        &u0,
                        &v0,
                        &u1,
                        &v1,
                        &u2,
                        &v2);
                }
            }

            const i32 baseVertex = static_cast<i32>(outVertices->size() / 16);
            Status vs = appendPackedVertex(
                outVertices,
                renderX + model.verticesX[static_cast<std::size_t>(ia)],
                sceneHeight + (*modelVerticesY)[static_cast<std::size_t>(ia)],
                renderZ + model.verticesZ[static_cast<std::size_t>(ia)],
                hslA,
                alpha,
                u0,
                v0,
                priority + 1,
                packedTextureId);
            if (!ok(vs)) return vs;
            vs = appendPackedVertex(
                outVertices,
                renderX + model.verticesX[static_cast<std::size_t>(ib)],
                sceneHeight + (*modelVerticesY)[static_cast<std::size_t>(ib)],
                renderZ + model.verticesZ[static_cast<std::size_t>(ib)],
                hslB,
                alpha,
                u1,
                v1,
                priority + 1,
                packedTextureId);
            if (!ok(vs)) return vs;
            vs = appendPackedVertex(
                outVertices,
                renderX + model.verticesX[static_cast<std::size_t>(ic)],
                sceneHeight + (*modelVerticesY)[static_cast<std::size_t>(ic)],
                renderZ + model.verticesZ[static_cast<std::size_t>(ic)],
                hslC,
                alpha,
                u2,
                v2,
                priority + 1,
                packedTextureId);
            if (!ok(vs)) return vs;

            auto rr = outIndices->pushBack(baseVertex);
            if (!rr.isOk()) return rr.status();
            rr = outIndices->pushBack(baseVertex + 1);
            if (!rr.isOk()) return rr.status();
            rr = outIndices->pushBack(baseVertex + 2);
            if (!rr.isOk()) return rr.status();
            *outElements += 3;
        }
    }

    return Status::Ok;
}

Status appendLocPlacementGeometryFromDecodedModelWithLightingState(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const LocType& resolved,
    const LocPlacement& placement,
    i32 scenePxX,
    i32 scenePxZ,
    i32 contourPxX,
    i32 contourPxZ,
    i32 sceneHeight,
    bool applyContour,
    const ModelData& model,
    const ModelFaceLightingState& lighting,
    bool transparentOnly,
    SceneCommandStream* debugOut,
    Vec<u8>* outVertices,
    Vec<i32>* outIndices,
    i32* outElements,
    Allocator& alloc) noexcept {
    if (!outVertices || !outIndices || !outElements) {
        return Status::InvalidArgument;
    }
    *outElements = 0;

    const i32 ambient = resolved.ambient + 64;
    const i32 contrast = resolved.contrast + 768;
    const i32 lightIntensity = modelLightIntensity(contrast);

    const i32 renderX = scenePxX;
    const i32 renderZ = scenePxZ;
    const i32 contourX = contourPxX;
    const i32 contourZ = contourPxZ;

    Vec<i32> contourVerticesY(alloc);
    const Vec<i32>* modelVerticesY = &model.verticesY;
    bool doContour = applyContour;
    // Only reuse a pre-contoured Y array when the caller explicitly disabled contouring.
    // For mergeNormals buckets, models may carry contourVerticesY from preprocessing, but the
    // correct contour sample origin is instance-specific at emit time.
    if (!applyContour &&
        !model.contourVerticesY.empty() &&
        model.contourVerticesY.size() == model.verticesY.size()) {
        modelVerticesY = &model.contourVerticesY;
        doContour = false;
    }
    const auto shouldContourTs = [&](i32 contourType) noexcept -> bool {
        if (contourType <= 0) return false;
        if (model.verticesX.empty() || model.verticesY.empty() || model.verticesZ.empty()) return false;
        i32 vertexCount = static_cast<i32>(model.verticesY.size());
        if (vertexCount < 0) vertexCount = 0;
        i32 usedVertexCount = model.usedVertexCount;
        if (usedVertexCount <= 0 || usedVertexCount > vertexCount) {
            usedVertexCount = vertexCount;
        }
        if (usedVertexCount <= 0) return false;

        i32 minX = 999999;
        i32 maxX = -999999;
        i32 minZ = 999999;
        i32 maxZ = -999999;
        for (i32 vi = 0; vi < usedVertexCount; vi++) {
            const std::size_t i = static_cast<std::size_t>(vi);
            const i32 vx = model.verticesX[i];
            const i32 vz = model.verticesZ[i];
            if (vx < minX) minX = vx;
            if (vx > maxX) maxX = vx;
            if (vz < minZ) minZ = vz;
            if (vz > maxZ) maxZ = vz;
        }

        const i32 startWorldX = contourX + minX;
        const i32 endWorldX = contourX + maxX;
        const i32 startWorldZ = contourZ + minZ;
        const i32 endWorldZ = contourZ + maxZ;

        const i32 heightMapWidth = scene.sizeX + 1;
        const i32 heightMapHeight = scene.sizeY + 1;
        const i32 endXTile = (endWorldX + 128) >> 7;
        const i32 endZTile = (endWorldZ + 128) >> 7;
        if ((contourType == 1 || contourType == 2 || contourType == 3 || contourType == 4 || contourType == 5) &&
            (startWorldX < 0 ||
             startWorldZ < 0 ||
             endXTile >= heightMapWidth ||
             endZTile >= heightMapHeight)) {
            return false;
        }
        if (contourType == 4 || contourType == 5) {
            const i32 above = placement.level + 1;
            if (above < 0 || above >= scene.levels) {
                return false;
            }
            return true;
        }

        const i32 sx = startWorldX >> 7;
        const i32 ex = (endWorldX + 127) >> 7;
        const i32 sz = startWorldZ >> 7;
        const i32 ez = (endWorldZ + 127) >> 7;
        if (!isWithinHeightBounds(scene, placement.level, sx, sz) ||
            !isWithinHeightBounds(scene, placement.level, ex, sz) ||
            !isWithinHeightBounds(scene, placement.level, sx, ez) ||
            !isWithinHeightBounds(scene, placement.level, ex, ez)) {
            return false;
        }
        if (scene.height(placement.level, sx, sz) == sceneHeight &&
            scene.height(placement.level, ex, sz) == sceneHeight &&
            scene.height(placement.level, sx, ez) == sceneHeight &&
            scene.height(placement.level, ex, ez) == sceneHeight) {
            return false;
        }
        return true;
    };

    if (doContour && resolved.contourGroundType > 0 && shouldContourTs(resolved.contourGroundType)) {
        const i32 contourType = resolved.contourGroundType;
        // Contour types that require rotating/translating the model mutate vertices in TS; this
        // helper is used by mergeNormals and assumes the decoded model is immutable.
        if (contourType == 3) {
            return Status::Unsupported;
        }
        auto rrContour = contourVerticesY.resize(model.verticesY.size());
        if (!rrContour.isOk()) {
            return rrContour.status();
        }
        for (std::size_t vi = 0; vi < model.verticesY.size(); vi++) {
            contourVerticesY[vi] = model.verticesY[vi];
        }
        modelVerticesY = &contourVerticesY;

        i32 contourVertexCount = static_cast<i32>(model.verticesY.size());
        if (contourVertexCount < 0) {
            contourVertexCount = 0;
        }
        i32 usedVertexCount = model.usedVertexCount;
        if (usedVertexCount <= 0 || usedVertexCount > contourVertexCount) {
            usedVertexCount = contourVertexCount;
        }

        i32 minY = 0;
        i32 maxY = 0;
        if (usedVertexCount > 0) {
            minY = model.verticesY[0];
            maxY = model.verticesY[0];
        }
        for (i32 vi = 1; vi < usedVertexCount; vi++) {
            const i32 vy = model.verticesY[static_cast<std::size_t>(vi)];
            if (vy < minY) minY = vy;
            if (vy > maxY) maxY = vy;
        }
        const i32 deltaY = maxY - minY;
        const i32 contourParam = resolved.contourGroundParam;

        auto maybeRecordWorldHeightProbe = [&](i32 level, i32 worldX, i32 worldZ, i32 baseY) noexcept {
            if (!debugOut || debugOut->debugWorldHeightProbeHit != 0) {
                return;
            }
            if (debugOut->debugWorldHeightProbeLevel < 0) {
                return;
            }
            if (level != debugOut->debugWorldHeightProbeLevel) {
                return;
            }
            const bool firstSampleMode =
                debugOut->debugWorldHeightProbeWorldX == -1 &&
                debugOut->debugWorldHeightProbeWorldZ == -1;
            if (!firstSampleMode &&
                (worldX != debugOut->debugWorldHeightProbeWorldX ||
                 worldZ != debugOut->debugWorldHeightProbeWorldZ)) {
                return;
            }

            // Mirror sampleSceneHeightAtWorld() math and record the intermediate values.
            const i32 tx = worldX >> 7;
            const i32 tz = worldZ >> 7;
            const i32 rx = worldX & 0x7f;
            const i32 rz = worldZ & 0x7f;
            const auto within = [&](i32 lvl, i32 x, i32 y) noexcept {
                return lvl >= 0 &&
                       lvl < scene.levels &&
                       x >= 0 &&
                       x <= scene.sizeX &&
                       y >= 0 &&
                       y <= scene.sizeY;
            };
            bool okSample =
                within(level, tx, tz) &&
                within(level, tx + 1, tz) &&
                within(level, tx, tz + 1) &&
                within(level, tx + 1, tz + 1);

            debugOut->debugWorldHeightProbeHit = okSample ? 1 : -1;
            debugOut->debugWorldHeightProbeLevel = level;
            debugOut->debugWorldHeightProbeWorldX = worldX;
            debugOut->debugWorldHeightProbeWorldZ = worldZ;

            debugOut->debugWorldHeightProbePacked[0] = okSample ? 1 : 0;
            debugOut->debugWorldHeightProbePacked[1] = tx;
            debugOut->debugWorldHeightProbePacked[2] = tz;
            debugOut->debugWorldHeightProbePacked[3] = rx;
            debugOut->debugWorldHeightProbePacked[4] = rz;
            if (!okSample) {
                return;
            }
            const i32 h00 = scene.height(level, tx, tz);
            const i32 h10 = scene.height(level, tx + 1, tz);
            const i32 h01 = scene.height(level, tx, tz + 1);
            const i32 h11 = scene.height(level, tx + 1, tz + 1);
            const i32 h0Numerator = h00 * (128 - rx) + h10 * rx;
            const i32 h0 = h0Numerator >> 7;
            const i32 h1Numerator = h01 * (128 - rx) + h11 * rx;
            const i32 h1 = h1Numerator >> 7;
            const i32 hNumerator = h0 * (128 - rz) + h1 * rz;
            const i32 h = hNumerator >> 7;

            debugOut->debugWorldHeightProbePacked[5] = h00;
            debugOut->debugWorldHeightProbePacked[6] = h10;
            debugOut->debugWorldHeightProbePacked[7] = h01;
            debugOut->debugWorldHeightProbePacked[8] = h11;
            debugOut->debugWorldHeightProbePacked[9] = h0Numerator;
            debugOut->debugWorldHeightProbePacked[10] = h0;
            debugOut->debugWorldHeightProbePacked[11] = h1Numerator;
            debugOut->debugWorldHeightProbePacked[12] = h1;
            debugOut->debugWorldHeightProbePacked[13] = hNumerator;
            debugOut->debugWorldHeightProbePacked[14] = h;
            debugOut->debugWorldHeightProbePacked[15] = baseY;
        };

        for (std::size_t vi = 0; vi < model.verticesY.size(); vi++) {
            const i32 baseY = model.verticesY[vi];
            const i32 worldX = contourX + model.verticesX[vi];
            const i32 worldZ = contourZ + model.verticesZ[vi];

            i32 h = 0;
            i32 hAbove = 0;
            const bool hasH = sampleSceneHeightAtWorld(scene, placement.level, worldX, worldZ, &h);
            maybeRecordWorldHeightProbe(placement.level, worldX, worldZ, baseY);
            const bool hasHAbove =
                sampleSceneHeightAtWorld(scene, placement.level + 1, worldX, worldZ, &hAbove);

            i32 outY = baseY;
            if (contourType == 1) {
                if (hasH) {
                    outY = baseY + h - sceneHeight;
                }
            } else if (contourType == 2) {
                if (contourParam != 0 && minY != 0) {
                    // TS parity: JS `baseY << 16` is a wrapping 32-bit shift; avoid UB on signed shift in C++.
                    const i32 yRatio = static_cast<i32>(static_cast<u32>(baseY) << 16) / minY;
                    if (yRatio < contourParam && hasH) {
                        outY = baseY + ((h - sceneHeight) * (contourParam - yRatio)) / contourParam;
                    }
                }
            } else if (contourType == 4) {
                if (hasHAbove) {
                    outY = baseY + hAbove - sceneHeight + deltaY;
                }
            } else if (contourType == 5) {
                if (deltaY != 0 && hasH && hasHAbove) {
                    const i32 deltaHeight = h - hAbove;
                    // TS parity: JS `baseY << 8` is a wrapping 32-bit shift; avoid UB on signed shift in C++.
                    const i32 yScale = static_cast<i32>(static_cast<u32>(baseY) << 8) / deltaY;
                    const i32 yOffset = (yScale * deltaHeight) >> 8;
                    outY = yOffset - (sceneHeight - h);
                }
            }

            contourVerticesY[vi] = outY;
        }
    }

    for (i32 fi = 0; fi < model.faceCount; fi++) {
        i32 faceType = modelFaceRenderType(model, fi);
        i32 textureId = modelFaceRawTextureId(model, fi);
        const i32 rawAlphaSigned = modelFaceRawAlpha(model, fi);
        if (rawAlphaSigned == -2) {
            faceType = 3;
        } else if (rawAlphaSigned == -1) {
            faceType = 2;
        }

        i32 packedTextureId = mapTextureIdToPackedIndex(input.textureIds, textureId);
        if (packedTextureId < 0) {
            textureId = -1;
        }
        const bool hasTexture = textureId != -1;
        const bool textureAlpha =
            hasTexture &&
            isTextureTransparent(input.textureTransparentIds, textureId);

        i32 alpha = 0xff;
        if (!hasTexture &&
            model.hasFaceAlphas &&
            fi < static_cast<i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(fi)]) & 0xff);
        }
        if (alpha == 0 || alpha == 1) {
            continue;
        }

        if (!hasTexture) {
            if (faceType != 0 && faceType != 1 && faceType != 3) {
                continue;
            }
        } else {
            if (faceType != 0 && faceType != 1) {
                continue;
            }
        }

        const bool transparent =
            alpha < 0xff ||
            textureAlpha;
        if (transparent != transparentOnly) {
            continue;
        }

        if (fi >= static_cast<i32>(model.indices1.size()) ||
            fi >= static_cast<i32>(model.indices2.size()) ||
            fi >= static_cast<i32>(model.indices3.size()) ||
            fi >= static_cast<i32>(model.faceColors.size())) {
            continue;
        }
        const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
        const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
        const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
        if (ia < 0 || ib < 0 || ic < 0 ||
            ia >= static_cast<i32>(model.verticesX.size()) ||
            ib >= static_cast<i32>(model.verticesX.size()) ||
            ic >= static_cast<i32>(model.verticesX.size()) ||
            ia >= static_cast<i32>(modelVerticesY->size()) ||
            ib >= static_cast<i32>(modelVerticesY->size()) ||
            ic >= static_cast<i32>(modelVerticesY->size()) ||
            ia >= static_cast<i32>(model.verticesZ.size()) ||
            ib >= static_cast<i32>(model.verticesZ.size()) ||
            ic >= static_cast<i32>(model.verticesZ.size())) {
            continue;
        }

        i32 priority = 0;
        if (fi < static_cast<i32>(model.faceRenderPriorities.size())) {
            priority = static_cast<i32>(model.faceRenderPriorities[static_cast<std::size_t>(fi)]);
        }

        const i32 baseColor = static_cast<i32>(model.faceColors[static_cast<std::size_t>(fi)] & 0xffffu);
        i32 hslA = baseColor;
        i32 hslB = baseColor;
        i32 hslC = baseColor;
        if (faceType == 0) {
            if (!hasTexture) {
                const i32 shadeA = modelVertexShade(lighting, ia, ambient, lightIntensity);
                const i32 shadeB = modelVertexShade(lighting, ib, ambient, lightIntensity);
                const i32 shadeC = modelVertexShade(lighting, ic, ambient, lightIntensity);
                hslA = modelAdjustLightness(baseColor, shadeA);
                hslB = modelAdjustLightness(baseColor, shadeB);
                hslC = modelAdjustLightness(baseColor, shadeC);
            } else {
                hslA = modelVertexLightnessTextured(lighting, ia, ambient, lightIntensity);
                hslB = modelVertexLightnessTextured(lighting, ib, ambient, lightIntensity);
                hslC = modelVertexLightnessTextured(lighting, ic, ambient, lightIntensity);
            }
        } else if (faceType == 1) {
            if (!hasTexture) {
                const i32 shade = modelFaceShade(lighting, fi, ambient, lightIntensity);
                hslA = modelAdjustLightness(baseColor, shade);
            } else {
                hslA = modelFaceLightnessTextured(lighting, fi, ambient, lightIntensity);
            }
            hslB = hslA;
            hslC = hslA;
        } else if (faceType == 3) {
            hslA = 128;
            hslB = 128;
            hslC = 128;
        }

        float u0 = 0.0f;
        float v0 = 0.0f;
        float u1 = 0.0f;
        float v1 = 0.0f;
        float u2 = 0.0f;
        float v2 = 0.0f;
        if (hasTexture) {
            i32 texCoord = -1;
            if (model.hasTextureCoords && fi < static_cast<i32>(model.textureCoords.size())) {
                texCoord = static_cast<i32>(model.textureCoords[static_cast<std::size_t>(fi)]);
            }
            i32 textureRenderType = 0;
            if (texCoord != -1) {
                const i32 tc = texCoord & 0xff;
                if (tc >= 0 && tc < static_cast<i32>(model.textureRenderTypes.size())) {
                    textureRenderType =
                        static_cast<i32>(model.textureRenderTypes[static_cast<std::size_t>(tc)]) & 0xff;
                }
            }
            if (textureRenderType == 0) {
                computeModelFaceUvType0(
                    model,
                    fi,
                    texCoord,
                    &u0,
                    &v0,
                    &u1,
                    &v1,
                    &u2,
                    &v2);
            }
        }

        const i32 baseVertex = static_cast<i32>(outVertices->size() / 16);
        Status vs = appendPackedVertex(
            outVertices,
            renderX + model.verticesX[static_cast<std::size_t>(ia)],
            sceneHeight + (*modelVerticesY)[static_cast<std::size_t>(ia)],
            renderZ + model.verticesZ[static_cast<std::size_t>(ia)],
            hslA,
            alpha,
            u0,
            v0,
            priority + 1,
            packedTextureId);
        if (!ok(vs)) return vs;
        vs = appendPackedVertex(
            outVertices,
            renderX + model.verticesX[static_cast<std::size_t>(ib)],
            sceneHeight + (*modelVerticesY)[static_cast<std::size_t>(ib)],
            renderZ + model.verticesZ[static_cast<std::size_t>(ib)],
            hslB,
            alpha,
            u1,
            v1,
            priority + 1,
            packedTextureId);
        if (!ok(vs)) return vs;
        vs = appendPackedVertex(
            outVertices,
            renderX + model.verticesX[static_cast<std::size_t>(ic)],
            sceneHeight + (*modelVerticesY)[static_cast<std::size_t>(ic)],
            renderZ + model.verticesZ[static_cast<std::size_t>(ic)],
            hslC,
            alpha,
            u2,
            v2,
            priority + 1,
            packedTextureId);
        if (!ok(vs)) return vs;

        auto rr = outIndices->pushBack(baseVertex);
        if (!rr.isOk()) return rr.status();
        rr = outIndices->pushBack(baseVertex + 1);
        if (!rr.isOk()) return rr.status();
        rr = outIndices->pushBack(baseVertex + 2);
        if (!rr.isOk()) return rr.status();
        *outElements += 3;
    }

    return Status::Ok;
}

Status appendObjPlacementGeometry(
    const SceneCommandBuildInput& input,
    const ObjType& objType,
    i32 modelId,
    i32 sceneX,
    i32 sceneZ,
    i32 sceneHeight,
    bool transparentOnly,
    Vec<u8>* outVertices,
    Vec<i32>* outIndices,
    i32* outElements,
    Allocator& alloc) noexcept {
    if (!outVertices || !outIndices || !outElements) {
        return Status::InvalidArgument;
    }
    *outElements = 0;

    ModelData model(alloc);
    const Status ms = tryDecodeObjModelFromBlob(input, objType, modelId, &model, alloc);
    if (!ok(ms)) {
        return ms;
    }

    const i32 ambient = objType.ambient + 64;
    const i32 contrast = objType.contrast + 768;
    const i32 lightIntensity = modelLightIntensity(contrast);

    ModelFaceLightingState lighting(alloc);
    const Status ls = initModelFaceLightingState(model, &lighting, alloc);
    if (!ok(ls)) {
        return ls;
    }

    for (i32 fi = 0; fi < model.faceCount; fi++) {
        i32 renderType = modelFaceRenderType(model, fi);
        const i32 textureId = modelFaceRawTextureId(model, fi);
        const i32 rawAlphaSigned = modelFaceRawAlpha(model, fi);
        if (rawAlphaSigned == -2) {
            renderType = 3;
        } else if (rawAlphaSigned == -1) {
            renderType = 2;
        }

        const i32 packedTextureId = mapTextureIdToPackedIndex(input.textureIds, textureId);
        const bool hasTexture = textureId != -1;

        i32 alpha = 0xff;
        if (model.hasFaceAlphas &&
            !hasTexture &&
            fi < static_cast<i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(fi)]) & 0xff);
        }
        if (alpha == 0 || alpha == 1) {
            continue;
        }

        if (!hasTexture) {
            if (renderType != 0 && renderType != 1 && renderType != 3) {
                continue;
            }
        } else {
            if (renderType != 0 && renderType != 1) {
                continue;
            }
        }

        const bool textureAlpha =
            hasTexture &&
            isTextureTransparent(input.textureTransparentIds, textureId);
        const bool transparent =
            alpha < 0xff ||
            textureAlpha;
        if (transparent != transparentOnly) {
            continue;
        }

        if (fi >= static_cast<i32>(model.indices1.size()) ||
            fi >= static_cast<i32>(model.indices2.size()) ||
            fi >= static_cast<i32>(model.indices3.size()) ||
            fi >= static_cast<i32>(model.faceColors.size())) {
            continue;
        }
        const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
        const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
        const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
        if (ia < 0 || ib < 0 || ic < 0 ||
            ia >= static_cast<i32>(model.verticesX.size()) ||
            ib >= static_cast<i32>(model.verticesX.size()) ||
            ic >= static_cast<i32>(model.verticesX.size()) ||
            ia >= static_cast<i32>(model.verticesY.size()) ||
            ib >= static_cast<i32>(model.verticesY.size()) ||
            ic >= static_cast<i32>(model.verticesY.size()) ||
            ia >= static_cast<i32>(model.verticesZ.size()) ||
            ib >= static_cast<i32>(model.verticesZ.size()) ||
            ic >= static_cast<i32>(model.verticesZ.size())) {
            continue;
        }

        i32 priority = 0;
        if (fi < static_cast<i32>(model.faceRenderPriorities.size())) {
            priority = static_cast<i32>(model.faceRenderPriorities[static_cast<std::size_t>(fi)]);
        }

        const i32 baseColor = static_cast<i32>(model.faceColors[static_cast<std::size_t>(fi)] & 0xffffu);
        i32 hslA = baseColor;
        i32 hslB = baseColor;
        i32 hslC = baseColor;
        if (renderType == 0) {
            if (!hasTexture) {
                const i32 shadeA = modelVertexShade(lighting, ia, ambient, lightIntensity);
                const i32 shadeB = modelVertexShade(lighting, ib, ambient, lightIntensity);
                const i32 shadeC = modelVertexShade(lighting, ic, ambient, lightIntensity);
                hslA = modelAdjustLightness(baseColor, shadeA);
                hslB = modelAdjustLightness(baseColor, shadeB);
                hslC = modelAdjustLightness(baseColor, shadeC);
            } else {
                hslA = modelVertexLightnessTextured(lighting, ia, ambient, lightIntensity);
                hslB = modelVertexLightnessTextured(lighting, ib, ambient, lightIntensity);
                hslC = modelVertexLightnessTextured(lighting, ic, ambient, lightIntensity);
            }
        } else if (renderType == 1) {
            if (!hasTexture) {
                const i32 shade = modelFaceShade(lighting, fi, ambient, lightIntensity);
                hslA = modelAdjustLightness(baseColor, shade);
            } else {
                hslA = modelFaceLightnessTextured(lighting, fi, ambient, lightIntensity);
            }
            hslB = hslA;
            hslC = hslA;
        } else if (renderType == 3) {
            hslA = 128;
            hslB = 128;
            hslC = 128;
        }

        float u0 = 0.0f;
        float v0 = 0.0f;
        float u1 = 0.0f;
        float v1 = 0.0f;
        float u2 = 0.0f;
        float v2 = 0.0f;
        if (hasTexture) {
            i32 texCoord = -1;
            if (model.hasTextureCoords && fi < static_cast<i32>(model.textureCoords.size())) {
                texCoord = static_cast<i32>(model.textureCoords[static_cast<std::size_t>(fi)]);
            }
            i32 textureRenderType = 0;
            if (texCoord != -1) {
                const i32 tc = texCoord & 0xff;
                if (tc >= 0 && tc < static_cast<i32>(model.textureRenderTypes.size())) {
                    textureRenderType =
                        static_cast<i32>(model.textureRenderTypes[static_cast<std::size_t>(tc)]) & 0xff;
                }
            }
            if (textureRenderType == 0) {
                computeModelFaceUvType0(
                    model,
                    fi,
                    texCoord,
                    &u0,
                    &v0,
                    &u1,
                    &v1,
                    &u2,
                    &v2);
            }
        }

        const i32 baseVertex = static_cast<i32>(outVertices->size() / 16);
        Status vs = appendPackedVertex(
            outVertices,
            sceneX + model.verticesX[static_cast<std::size_t>(ia)],
            sceneHeight + model.verticesY[static_cast<std::size_t>(ia)],
            sceneZ + model.verticesZ[static_cast<std::size_t>(ia)],
            hslA,
            alpha,
            u0,
            v0,
            priority + 1,
            packedTextureId);
        if (!ok(vs)) return vs;
        vs = appendPackedVertex(
            outVertices,
            sceneX + model.verticesX[static_cast<std::size_t>(ib)],
            sceneHeight + model.verticesY[static_cast<std::size_t>(ib)],
            sceneZ + model.verticesZ[static_cast<std::size_t>(ib)],
            hslB,
            alpha,
            u1,
            v1,
            priority + 1,
            packedTextureId);
        if (!ok(vs)) return vs;
        vs = appendPackedVertex(
            outVertices,
            sceneX + model.verticesX[static_cast<std::size_t>(ic)],
            sceneHeight + model.verticesY[static_cast<std::size_t>(ic)],
            sceneZ + model.verticesZ[static_cast<std::size_t>(ic)],
            hslC,
            alpha,
            u2,
            v2,
            priority + 1,
            packedTextureId);
        if (!ok(vs)) return vs;

        auto rr = outIndices->pushBack(baseVertex);
        if (!rr.isOk()) return rr.status();
        rr = outIndices->pushBack(baseVertex + 1);
        if (!rr.isOk()) return rr.status();
        rr = outIndices->pushBack(baseVertex + 2);
        if (!rr.isOk()) return rr.status();
        *outElements += 3;
    }

    return Status::Ok;
}

static i32 locPlacementPriority(const i32 placementType) noexcept {
    if (placementType == 22) {
        return 3;
    }
    if (placementType >= 4 && placementType <= 8) {
        return 10;
    }
    return 1;
}

i32 locPlacementCategoryForSceneOrder(const i32 placementType) noexcept {
    if (placementType == 22) {
        return 0; // floor decoration
    }
    if (placementType >= 0 && placementType <= 3) {
        return 1; // wall
    }
    if (placementType >= 4 && placementType <= 8) {
        return 2; // wall decoration
    }
    return 3; // generic locs
}

static bool isScenePlayerLevel(
    const SceneData& scene,
    const i32 level,
    const i32 tileX,
    const i32 tileY,
    const i32 playerLevel) noexcept {
    if (!scene.isWithinBounds(level, tileX, tileY) ||
        !scene.isWithinBounds(0, tileX, tileY)) {
        return false;
    }
    if ((scene.renderFlag(0, tileX, tileY) &
         static_cast<u8>(SceneTileRenderFlag::Bridge)) != 0) {
        return level == 0;
    }
    if ((scene.renderFlag(level, tileX, tileY) &
         static_cast<u8>(SceneTileRenderFlag::ExcludeFromPlayerLevel)) != 0) {
        return false;
    }
    return level == playerLevel;
}

static bool isLowDetailLocPlacement(
    const SceneData& scene,
    const Vec<u8>* tileHasValidFaceColorsAForLowDetail,
    const LocType& locType,
    const i32 placementType,
    const i32 level,
    const i32 tileX,
    const i32 tileY) noexcept {
    if (!scene.isWithinBounds(level, tileX, tileY)) {
        return false;
    }

    bool hasTileModel = scene.modelPresent(level, tileX, tileY) != 0;
    if (tileHasValidFaceColorsAForLowDetail) {
        const std::size_t idx = scene.tileIdx(level, tileX, tileY);
        if (idx < tileHasValidFaceColorsAForLowDetail->size()) {
            hasTileModel = (*tileHasValidFaceColorsAForLowDetail)[idx] != 0;
        }
    }
    if (placementType == 22 &&
        locType.isInteractive == 0 &&
        locType.clipType != 1 &&
        !locType.obstructsGround &&
        hasTileModel) {
        return true;
    }

    const bool isWallDecoration = placementType >= 4 && placementType <= 8;
    if ((placementType == 10 || placementType == 11 || isWallDecoration) &&
        locType.isInteractive == 1) {
        return (scene.renderFlag(level, tileX, tileY) &
                static_cast<u8>(SceneTileRenderFlag::Inside)) != 0;
    }

    return false;
}

bool isWithinHeightBounds(
    const SceneData& scene,
    i32 level,
    i32 tileX,
    i32 tileY) noexcept {
    return level >= 0 &&
           level < scene.levels &&
           tileX >= 0 &&
           tileX <= scene.sizeX &&
           tileY >= 0 &&
           tileY <= scene.sizeY;
}

bool sampleSceneHeightAtWorld(
    const SceneData& scene,
    i32 level,
    i32 worldX,
    i32 worldZ,
    i32* outHeight) noexcept {
    if (!outHeight) {
        return false;
    }
    const i32 tx = worldX >> 7;
    const i32 tz = worldZ >> 7;
    if (!isWithinHeightBounds(scene, level, tx, tz) ||
        !isWithinHeightBounds(scene, level, tx + 1, tz) ||
        !isWithinHeightBounds(scene, level, tx, tz + 1) ||
        !isWithinHeightBounds(scene, level, tx + 1, tz + 1)) {
        return false;
    }

    const i32 rx = worldX & 0x7f;
    const i32 rz = worldZ & 0x7f;
    const i32 h0Numerator =
        scene.height(level, tx, tz) * (128 - rx) +
        scene.height(level, tx + 1, tz) * rx;
    const i32 h0 = h0Numerator >> 7;
    const i32 h1Numerator =
        scene.height(level, tx, tz + 1) * (128 - rx) +
        scene.height(level, tx + 1, tz + 1) * rx;
    const i32 h1 = h1Numerator >> 7;
    const i32 hNumerator = h0 * (128 - rz) + h1 * rz;
    *outHeight = hNumerator >> 7;
    return true;
}

i32 resolveLocInstanceContourGround(
    const SceneData& scene,
    const LocType& locType,
    i32 level,
    i32 tileX,
    i32 tileY) noexcept {
    if (locType.contourGroundType <= 0) {
        return static_cast<i32>(ContourGroundType::CenterTile);
    }
    // TS runtime command stream can still carry vertex contour for AlignToSlope (type=3)
    // depending on source path; keep it as vertex.
    if (locType.contourGroundType == 3) {
        return static_cast<i32>(ContourGroundType::Vertex);
    }

    if (!isWithinHeightBounds(scene, level, tileX, tileY) ||
        !isWithinHeightBounds(scene, level, tileX + 1, tileY) ||
        !isWithinHeightBounds(scene, level, tileX, tileY + 1) ||
        !isWithinHeightBounds(scene, level, tileX + 1, tileY + 1)) {
        return static_cast<i32>(ContourGroundType::CenterTile);
    }

    // Warp-to-plane-above / between-planes require plane+1 heightmap.
    if (locType.contourGroundType == 4 || locType.contourGroundType == 5) {
        const i32 above = level + 1;
        if (!isWithinHeightBounds(scene, above, tileX, tileY) ||
            !isWithinHeightBounds(scene, above, tileX + 1, tileY) ||
            !isWithinHeightBounds(scene, above, tileX, tileY + 1) ||
            !isWithinHeightBounds(scene, above, tileX + 1, tileY + 1)) {
            return static_cast<i32>(ContourGroundType::CenterTile);
        }
        return static_cast<i32>(ContourGroundType::Vertex);
    }

    const i32 h00 = scene.height(level, tileX, tileY);
    const i32 h10 = scene.height(level, tileX + 1, tileY);
    const i32 h01 = scene.height(level, tileX, tileY + 1);
    const i32 h11 = scene.height(level, tileX + 1, tileY + 1);
    const i32 centerHeight = (h00 + h10 + h01 + h11) >> 2;
    if (h00 == centerHeight && h10 == centerHeight && h01 == centerHeight && h11 == centerHeight) {
        return static_cast<i32>(ContourGroundType::CenterTile);
    }
    return static_cast<i32>(ContourGroundType::Vertex);
}

i32 resolveLocInstanceContourGroundWithBounds(
    const SceneData& scene,
    const LocType& locType,
    i32 level,
    i32 tileX,
    i32 tileY,
    i32 rotation,
    bool hasBounds,
    i32 minX,
    i32 maxX,
    i32 minZ,
    i32 maxZ) noexcept {
    if (!hasBounds) {
        return resolveLocInstanceContourGround(scene, locType, level, tileX, tileY);
    }

    const i32 contourType = locType.contourGroundType;
    if (contourType <= 0) {
        return static_cast<i32>(ContourGroundType::CenterTile);
    }
    // TS runtime command stream can still carry vertex contour for AlignToSlope (type=3)
    // depending on source path; keep it as vertex.
    if (contourType == 3) {
        return static_cast<i32>(ContourGroundType::Vertex);
    }

    i32 sizeX = locType.sizeX;
    i32 sizeY = locType.sizeY;
    if ((rotation & 1) != 0) {
        const i32 swap = sizeX;
        sizeX = sizeY;
        sizeY = swap;
    }

    i32 cStartX = 0;
    i32 cEndX = 0;
    if (tileX + sizeX <= scene.sizeX) {
        cStartX = (sizeX >> 1) + tileX;
        cEndX = ((sizeX + 1) >> 1) + tileX;
    } else {
        cStartX = tileX;
        cEndX = tileX + 1;
    }

    i32 cStartY = 0;
    i32 cEndY = 0;
    if (tileY + sizeY <= scene.sizeY) {
        cStartY = (sizeY >> 1) + tileY;
        cEndY = ((sizeY + 1) >> 1) + tileY;
    } else {
        cStartY = tileY;
        cEndY = tileY + 1;
    }

    if (!isWithinHeightBounds(scene, level, cStartX, cStartY) ||
        !isWithinHeightBounds(scene, level, cEndX, cStartY) ||
        !isWithinHeightBounds(scene, level, cStartX, cEndY) ||
        !isWithinHeightBounds(scene, level, cEndX, cEndY)) {
        return static_cast<i32>(ContourGroundType::CenterTile);
    }

    const i32 centerHeight = (
        scene.height(level, cEndX, cEndY) +
        scene.height(level, cStartX, cEndY) +
        scene.height(level, cStartX, cStartY) +
        scene.height(level, cEndX, cStartY)) >> 2;

    const i32 entityX = (tileX << 7) + (sizeX << 6);
    const i32 entityZ = (tileY << 7) + (sizeY << 6);
    const i32 startX = entityX + minX;
    const i32 endX = entityX + maxX;
    const i32 startZ = entityZ + minZ;
    const i32 endZ = entityZ + maxZ;
    const i32 endXTile = (endX + 128) >> 7;
    const i32 endZTile = (endZ + 128) >> 7;

    if ((contourType == 1 || contourType == 2 || contourType == 3 || contourType == 5) &&
        (startX < 0 || endXTile > scene.sizeX || startZ < 0 || endZTile > scene.sizeY)) {
        return static_cast<i32>(ContourGroundType::CenterTile);
    }

    if (contourType == 4 || contourType == 5) {
        const i32 above = level + 1;
        if (above >= scene.levels ||
            startX < 0 || endXTile > scene.sizeX || startZ < 0 || endZTile > scene.sizeY) {
            return static_cast<i32>(ContourGroundType::CenterTile);
        }
        return static_cast<i32>(ContourGroundType::Vertex);
    }

    const i32 sx = startX >> 7;
    const i32 ex = (endX + 127) >> 7;
    const i32 sz = startZ >> 7;
    const i32 ez = (endZ + 127) >> 7;
    if (!isWithinHeightBounds(scene, level, sx, sz) ||
        !isWithinHeightBounds(scene, level, ex, sz) ||
        !isWithinHeightBounds(scene, level, sx, ez) ||
        !isWithinHeightBounds(scene, level, ex, ez)) {
        return static_cast<i32>(ContourGroundType::CenterTile);
    }

    if (scene.height(level, sx, sz) == centerHeight &&
        scene.height(level, ex, sz) == centerHeight &&
        scene.height(level, sx, ez) == centerHeight &&
        scene.height(level, ex, ez) == centerHeight) {
        return static_cast<i32>(ContourGroundType::CenterTile);
    }

    return static_cast<i32>(ContourGroundType::Vertex);
}

SceneModelMergeDecision decideSceneModelMergeStrategy(
    i32 instanceCount,
    i32 opaqueFaceCount,
    i32 transparentFaceCount,
    bool minimizeDrawCalls) noexcept {
    if (instanceCount < 0) {
        instanceCount = 0;
    }
    if (opaqueFaceCount < 0) {
        opaqueFaceCount = 0;
    }
    if (transparentFaceCount < 0) {
        transparentFaceCount = 0;
    }

    const bool forceMerge = minimizeDrawCalls || instanceCount == 1;
    constexpr i64 kMergeThreshold = 100;
    const i64 opaqueWork = static_cast<i64>(instanceCount) * static_cast<i64>(opaqueFaceCount);
    const i64 transparentWork =
        static_cast<i64>(instanceCount) * static_cast<i64>(transparentFaceCount);

    SceneModelMergeDecision out{};
    out.mergeOpaque = forceMerge || opaqueWork < kMergeThreshold;
    out.mergeTransparent = forceMerge || transparentWork < kMergeThreshold;
    return out;
}

Status resolveLocRenderPlacement(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const Vec<u8>* tileHasValidFaceColorsAForLowDetail,
    DecodedLocTypeCache* locTypeCache,
    DecodedVarBitTypeCache* varbitCache,
    const LocPlacement& placement,
    i32 sceneX,
    i32 sceneY,
    ResolvedLocRenderPlacement* outPlacement,
    Allocator& alloc) noexcept {
    if (!locTypeCache || !varbitCache || !outPlacement) {
        return Status::InvalidArgument;
    }
    *outPlacement = ResolvedLocRenderPlacement{};

    if (!scene.isWithinBounds(placement.level, sceneX, sceneY)) {
        return Status::NotFound;
    }

    const i32 maxLevel = 3;
    if (scene.minLevel(placement.level, sceneX, sceneY) > maxLevel &&
        !isScenePlayerLevel(scene, placement.level, sceneX, sceneY, maxLevel)) {
        return Status::NotFound;
    }
    bool baseHadTransforms = false;
    const LocType* resolved =
        resolveLocTypeForPlacement(
            input,
            locTypeCache,
            varbitCache,
            placement.id,
            &baseHadTransforms,
            alloc);
    if (!resolved) {
        return Status::NotFound;
    }

    SceneLocRenderPlacementStageOutput stage{};
    const SceneLocRenderPlacementStageInput stageInput{
        .resolvedLocType = resolved,
        .placementId = placement.id,
        .placementType = placement.type,
        .locLoadType = input.locLoadType,
        .baseHadTransforms = baseHadTransforms,
        .lowDetailPlacement =
            isLowDetailLocPlacement(scene, tileHasValidFaceColorsAForLowDetail, *resolved, placement.type, placement.level, sceneX, sceneY),
    };
    const Status stageStatus = deriveSceneLocRenderPlacementStage(stageInput, &stage);
    if (!ok(stageStatus)) {
        return stageStatus;
    }

    outPlacement->locType = resolved;
    outPlacement->seqId = stage.seqId;
    outPlacement->priority = stage.priority;
    outPlacement->interactId = stage.interactId;
    outPlacement->includeLod = stage.includeLod;
    outPlacement->forceMerge = stage.forceMerge;
    outPlacement->sourceIsEntity = stage.sourceIsEntity;
    return Status::Ok;
}

enum class SceneCommandBuildMode : u8 {
    FullStream = 0,
    PlanOnly = 1,
};

static Status appendSceneCommandPlanDebugDigest(
    SceneCommandStream* out,
    Span<const SceneCommandPlanDebugOp> planOps,
    Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    out->debugSceneCommandPlanOpCount = 0;
    out->debugSceneCommandPlanMergedGroupOpCount = 0;
    out->debugSceneCommandPlanInstancedOpCount = 0;
    out->debugSceneCommandPlanInstancedFacesTotal = 0;
    out->debugSceneCommandPlanInstancedInstancesTotal = 0;
    out->debugSceneCommandPlanInstancedLodInstancesTotal = 0;
    out->debugSceneCommandPlanSeqHash = static_cast<i32>(2166136261u);
    out->debugSceneCommandPlanMultisetHashSum = 0;
    out->debugSceneCommandPlanMultisetHashXor = 0;

    Vec<i32> planOpsPacked(alloc);
    Vec<i32> planOpProvPacked(alloc);
    if (!planOps.empty()) {
        if (planOps.size() > static_cast<std::size_t>(2147483647 / 6)) {
            return Status::OutOfRange;
        }
        auto rrOpsPacked = planOpsPacked.reserve(planOps.size() * 6);
        if (!rrOpsPacked.isOk()) {
            return rrOpsPacked.status();
        }
        auto rrProv = planOpProvPacked.reserve(planOps.size() * 8);
        if (!rrProv.isOk()) {
            return rrProv.status();
        }
    }

    for (std::size_t i = 0; i < planOps.size(); i++) {
        const SceneCommandPlanDebugOp& op = planOps[i];
        {
            // Keep provenance aligned 1:1 with planOpsPacked (one record per op).
            auto rrP = planOpProvPacked.pushBack(op.sourceKind);
            if (!rrP.isOk()) return rrP.status();
            rrP = planOpProvPacked.pushBack(op.typeId);
            if (!rrP.isOk()) return rrP.status();
            rrP = planOpProvPacked.pushBack(op.placementTypeHint);
            if (!rrP.isOk()) return rrP.status();
            rrP = planOpProvPacked.pushBack(op.placementRotationHint);
            if (!rrP.isOk()) return rrP.status();
            rrP = planOpProvPacked.pushBack(op.modelIdHint);
            if (!rrP.isOk()) return rrP.status();
            rrP = planOpProvPacked.pushBack(op.modelIdsHashHint);
            if (!rrP.isOk()) return rrP.status();
            rrP = planOpProvPacked.pushBack(op.level);
            if (!rrP.isOk()) return rrP.status();
            rrP = planOpProvPacked.pushBack(op.priority);
            if (!rrP.isOk()) return rrP.status();
        }

        if (op.kind == SceneCommandPlanDebugOpKind::MergedGroup) {
            auto rr0 = planOpsPacked.pushBack(2);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.transparent ? 1 : 0);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.lowDetail ? 1 : 0);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.level);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.priority);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.modelCount);
            if (!rr0.isOk()) return rr0.status();
            sceneCommandPlanDigestAddMergedGroup(
                out,
                op.transparent,
                op.lowDetail,
                op.level,
                op.priority,
                op.modelCount);
        } else {
            auto rr0 = planOpsPacked.pushBack(1);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.transparent ? 1 : 0);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.modelHash);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.faceCount);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.instanceCount);
            if (!rr0.isOk()) return rr0.status();
            rr0 = planOpsPacked.pushBack(op.lodInstanceCount);
            if (!rr0.isOk()) return rr0.status();
            sceneCommandPlanDigestAddInstanced(
                out,
                op.modelHash,
                op.transparent,
                op.faceCount,
                op.instanceCount,
                op.lodInstanceCount);
        }
    }

    auto rrRestorePlanOpsPacked = out->debugSceneCommandPlanOpsPacked.resize(planOpsPacked.size());
    if (!rrRestorePlanOpsPacked.isOk()) {
        return rrRestorePlanOpsPacked.status();
    }
    for (std::size_t i = 0; i < planOpsPacked.size(); i++) {
        out->debugSceneCommandPlanOpsPacked[i] = planOpsPacked[i];
    }

    auto rrRestoreProv = out->debugSceneCommandPlanOpProvenancePacked.resize(planOpProvPacked.size());
    if (!rrRestoreProv.isOk()) {
        return rrRestoreProv.status();
    }
    for (std::size_t i = 0; i < planOpProvPacked.size(); i++) {
        out->debugSceneCommandPlanOpProvenancePacked[i] = planOpProvPacked[i];
    }

    return Status::Ok;
}

// Loc/obj emission is implemented in LocEmit.cpp / ObjEmit.cpp.
static Status buildSceneCommandStreamFromBytesNoSeed(
    const SceneCommandBuildInput& input,
    SceneCommandStream* out,
    SceneCommandBuildMode mode,
    Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    // `out` is allocated+cleared in buildSceneCommandStream(); keep this function phase-focused.
    const bool emitGeometry = mode == SceneCommandBuildMode::FullStream;

    bool hasLocPlacements = false;
    if (input.locLoadType == 0) {
        const Status hs = hasInBoundsLocPlacements(input, &hasLocPlacements, alloc);
        if (!ok(hs)) {
            return hs;
        }
        if (hasLocPlacements &&
            (input.locTypeIds.size() == 0 ||
             input.locTypeOffsets.size() == 0 ||
             input.locTypeLengths.size() == 0 ||
             input.locTypeBytes.size() == 0 ||
             input.modelIds.size() == 0 ||
             input.modelOffsets.size() == 0 ||
             input.modelLengths.size() == 0 ||
             input.modelBytes.size() == 0)) {
            return Status::NotFound;
        }
    } else if (input.locLoadType != 1) {
        return Status::InvalidArgument;
    }

    CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<GameType>(input.cacheGame);
    cacheInfo.revision = input.cacheRevision;

    DecodedLocTypeCache sceneLocTypeCache(cacheInfo, alloc);
    DecodedVarBitTypeCache sceneVarbitTypeCache(cacheInfo, alloc);
    DecodedUnderlayTypeCache underlayTypeCache(alloc);

    struct InputLocTypeService final : LocTypeService {
        const SceneCommandBuildInput* input = nullptr;
        DecodedLocTypeCache* cache = nullptr;
        Allocator* alloc = nullptr;

        Status tryLoad(i32 id, const LocType** out) const noexcept override {
            if (!input || !cache || !alloc) {
                return Status::InvalidArgument;
            }
            return tryDecodeLocTypeFromBlob(*input, cache, id, out, *alloc);
        }
    };

    struct InputVarProvider final : VarProvider {
        const SceneCommandBuildInput* input = nullptr;
        DecodedVarBitTypeCache* varbitCache = nullptr;

        i32 getVarp(i32 id) const noexcept override {
            if (!input) {
                return 0;
            }
            return getVarpValue(input->varpValues, id);
        }

        i32 getVarbit(i32 id) const noexcept override {
            if (!input || !varbitCache) {
                return 0;
            }
            return getVarbitValue(*input, varbitCache, id);
        }
    };

    struct InputLocModelService final : LocModelService {
        const SceneCommandBuildInput* input = nullptr;
        Allocator* alloc = nullptr;

        static i32 computeModelXzRadius(const ModelData& model) noexcept {
            i64 maxRadiusSq = 0;
            const std::size_t count = model.verticesX.size();
            for (std::size_t i = 0; i < count && i < model.verticesZ.size(); i++) {
                const i64 x = static_cast<i64>(model.verticesX[i]);
                const i64 z = static_cast<i64>(model.verticesZ[i]);
                const i64 radiusSq = x * x + z * z;
                if (radiusSq > maxRadiusSq) {
                    maxRadiusSq = radiusSq;
                }
            }
            const double radius = std::sqrt(static_cast<double>(maxRadiusSq));
            return static_cast<i32>(std::floor(radius + 0.99));
        }

        Status tryValidateStaticModelPlacement(
            const LocType& locType,
            i32 placementType,
            i32 rotation) const noexcept override {
            if (!input || !alloc) {
                return Status::InvalidArgument;
            }
            Vec<LocModelVariantRef> refs(*alloc);
            if (!collectLocTypeModelRefs(locType, placementType, rotation, &refs) || refs.empty()) {
                return Status::NotFound;
            }
            for (std::size_t i = 0; i < refs.size(); i++) {
                ModelData model(*alloc);
                const Status s = tryDecodeLocModelFromBlob(
                    *input,
                    locType,
                    refs[i].placementType,
                    refs[i].rotation,
                    refs[i].modelId,
                    &model,
                    /*applyDiagonalNormalVariantRotation=*/true,
                    *alloc);
                if (!ok(s)) {
                    return s;
                }
            }
            return Status::Ok;
        }

        Status tryGetStaticModelXZRadius(
            const LocType& locType,
            i32 placementType,
            i32 rotation,
            i32* outRadius) const noexcept override {
            if (!input || !alloc || !outRadius) {
                return Status::InvalidArgument;
            }
            *outRadius = -1;

            // TS SceneBuilder uses only the *first* expanded model variant for NORMAL/NORMAL_DIAGONAL
            // when computing light occlusion from `entity.tryGetXZRadius()`. If we take the max across
            // all expanded variants here, we can over-occlude terrain lighting and diverge.
            // See `src/rs/scene/SceneBuilder.ts` (NORMAL/NORMAL_DIAGIONAL branch).
            Vec<LocModelVariantRef> refs(*alloc);
            refs.clear();
            SceneLocPlacementModelVariant variants[2]{};
            const i32 variantCount =
                expandSceneLocPlacementModelVariants(placementType, rotation, variants, 2);
            if (variantCount <= 0) {
                return Status::NotFound;
            }
            if (!appendLocTypeModelRefs(
                    locType,
                    variants[0].placementType,
                    variants[0].rotation,
                    &refs) ||
                refs.empty()) {
                return Status::NotFound;
            }

            i32 maxRadius = -1;
            for (std::size_t i = 0; i < refs.size(); i++) {
                ModelData model(*alloc);
                const Status s = tryDecodeLocModelFromBlob(
                    *input,
                    locType,
                    refs[i].placementType,
                    refs[i].rotation,
                    refs[i].modelId,
                    &model,
                    /*applyDiagonalNormalVariantRotation=*/true,
                    *alloc);
                if (!ok(s)) {
                    return s;
                }
                if (!locType.mergeNormals) {
                    const i32 radius = computeModelXzRadius(model);
                    if (radius > maxRadius) {
                        maxRadius = radius;
                    }
                }
            }

            *outRadius = maxRadius;
            return Status::Ok;
        }
    };

    struct InputUnderlayTypeService final : UnderlayTypeService {
        const SceneCommandBuildInput* input = nullptr;
        DecodedUnderlayTypeCache* cache = nullptr;
        Allocator* alloc = nullptr;

        Status tryLoad(i32 id, const UnderlayFloorType** out) const noexcept override {
            if (!input || !cache || !alloc) {
                return Status::InvalidArgument;
            }
            return tryDecodeUnderlayTypeFromBlob(*input, id, cache, out, *alloc);
        }
    };


    InputLocTypeService inputLocTypes{};
    inputLocTypes.input = &input;
    inputLocTypes.cache = &sceneLocTypeCache;
    inputLocTypes.alloc = &alloc;

    InputVarProvider inputVarProvider{};
    inputVarProvider.input = &input;
    inputVarProvider.varbitCache = &sceneVarbitTypeCache;

    InputLocModelService inputLocModels{};
    inputLocModels.input = &input;
    inputLocModels.alloc = &alloc;

    InputUnderlayTypeService inputUnderlays{};
    inputUnderlays.input = &input;
    inputUnderlays.cache = &underlayTypeCache;
    inputUnderlays.alloc = &alloc;

    SceneRuntimeServices services{};
    services.cacheInfo = &cacheInfo;
    services.underlayTypes = &inputUnderlays;
    services.locTypes = &inputLocTypes;
    services.varProvider = &inputVarProvider;
    services.locModels = &inputLocModels;
    InputMapBytesProvider bytesProvider{};
    bytesProvider.mapSquareIds = input.mapSquareIds;
    bytesProvider.terrainOffsets = input.terrainOffsets;
    bytesProvider.terrainLengths = input.terrainLengths;
    bytesProvider.terrainBytes = input.terrainBytes;
    bytesProvider.locOffsets = input.locOffsets;
    bytesProvider.locLengths = input.locLengths;
    bytesProvider.locBytes = input.locBytes;

    const SceneLocLoadType sceneLocLoadType =
        (input.locLoadType == 1) ? SceneLocLoadType::NoModels : SceneLocLoadType::Models;

    const SceneBuildContext context = createSceneBuildContext(
        input.baseX,
        input.baseY,
        input.sizeX,
        input.sizeY,
        sceneLocLoadType);

    SceneData scene{};
    const Status sceneStatus = buildSceneFromMapBytesProvider(
        services,
        bytesProvider,
        context,
        &scene,
        alloc);
    if (!ok(sceneStatus)) {
        return sceneStatus;
    }

    // Deep terrain-probe diagnostics: verify whether runtime cache map-square bytes are reachable
    // for the probed tile and what raw underlay/overlay decode from those bytes produces.
    if (out->debugTerrainProbeLevel >= 0 &&
        out->debugTerrainProbeTileX >= 0 &&
        out->debugTerrainProbeTileY >= 0 &&
        out->debugTerrainProbeTileX < input.sizeX &&
        out->debugTerrainProbeTileY < input.sizeY) {
        const i32 probeLevel = out->debugTerrainProbeLevel;
        const i32 probeTileX = out->debugTerrainProbeTileX;
        const i32 probeTileY = out->debugTerrainProbeTileY;
        const i32 worldTileX = input.baseX + probeTileX;
        const i32 worldTileY = input.baseY + probeTileY;
        const i32 probeMapX = floorDiv(worldTileX, TerrainConstants::MAP_SQUARE_SIZE);
        const i32 probeMapY = floorDiv(worldTileY, TerrainConstants::MAP_SQUARE_SIZE);
        const i32 localTileX = worldTileX - probeMapX * TerrainConstants::MAP_SQUARE_SIZE;
        const i32 localTileY = worldTileY - probeMapY * TerrainConstants::MAP_SQUARE_SIZE;
        const i32 probeMapIdx = bytesProvider.findMapIndex(probeMapX, probeMapY);
        const i32 probeTerrainOffset =
            (probeMapIdx >= 0 && static_cast<std::size_t>(probeMapIdx) < bytesProvider.terrainOffsets.size())
                ? bytesProvider.terrainOffsets[static_cast<std::size_t>(probeMapIdx)]
                : -1;
        const i32 probeTerrainLength =
            (probeMapIdx >= 0 && static_cast<std::size_t>(probeMapIdx) < bytesProvider.terrainLengths.size())
                ? bytesProvider.terrainLengths[static_cast<std::size_t>(probeMapIdx)]
                : -1;

        Vec<u8> probeTerrainBytes(alloc);
        const Status probeLoadStatus =
            bytesProvider.tryLoadTerrainBytes(probeMapX, probeMapY, &probeTerrainBytes);

        i32 decodedProbeOverlay = -1;
        i32 decodedProbeUnderlay = -1;
        i32 decodedProbeShape = -1;
        i32 decodeStatusI32 = static_cast<i32>(Status::NotFound);
        if (ok(probeLoadStatus) && !probeTerrainBytes.empty() &&
            probeLevel >= 0 && probeLevel < TerrainConstants::MAX_LEVELS &&
            localTileX >= 0 && localTileX < TerrainConstants::MAP_SQUARE_SIZE &&
            localTileY >= 0 && localTileY < TerrainConstants::MAP_SQUARE_SIZE) {
            TerrainSquare probeDecoded{};
            auto rr = probeDecoded.init(alloc);
            if (rr.isOk()) {
                const bool newTerrainFormat =
                    cacheInfo.game == GameType::Oldschool && cacheInfo.revision >= 209;
                const Status ds = decodeTerrainSquareFromBytesInto(
                    probeDecoded,
                    Span<const u8>(probeTerrainBytes.data(), probeTerrainBytes.size()),
                    newTerrainFormat,
                    probeMapX * TerrainConstants::MAP_SQUARE_SIZE,
                    probeMapY * TerrainConstants::MAP_SQUARE_SIZE);
                decodeStatusI32 = static_cast<i32>(ds);
                if (ok(ds)) {
                    decodedProbeOverlay =
                        static_cast<i32>(probeDecoded.overlay(probeLevel, localTileX, localTileY));
                    decodedProbeUnderlay =
                        static_cast<i32>(probeDecoded.underlay(probeLevel, localTileX, localTileY));
                    decodedProbeShape =
                        static_cast<i32>(probeDecoded.shape(probeLevel, localTileX, localTileY));
                }
            }
        }

        // [45..63] reserved for SceneCommandBuilder pre-emit terrain probe diagnostics.
        out->debugTerrainProbePacked[45] = worldTileX;
        out->debugTerrainProbePacked[46] = worldTileY;
        out->debugTerrainProbePacked[47] = probeMapX;
        out->debugTerrainProbePacked[48] = probeMapY;
        out->debugTerrainProbePacked[49] = localTileX;
        out->debugTerrainProbePacked[50] = localTileY;
        out->debugTerrainProbePacked[51] = probeMapIdx;
        out->debugTerrainProbePacked[52] = probeTerrainOffset;
        out->debugTerrainProbePacked[53] = probeTerrainLength;
        out->debugTerrainProbePacked[54] = static_cast<i32>(probeLoadStatus);
        out->debugTerrainProbePacked[55] = static_cast<i32>(probeTerrainBytes.size());
        out->debugTerrainProbePacked[56] = decodeStatusI32;
        out->debugTerrainProbePacked[57] = decodedProbeUnderlay;
        out->debugTerrainProbePacked[58] = decodedProbeOverlay;
        out->debugTerrainProbePacked[59] = decodedProbeShape;
    }

    // Debug: allow probing the scene heightmap directly, without relying on contouring codepaths.
    // This helps debug packed-vertex Y mismatches where the suspect coordinate might not be sampled by any loc.
    if (out->debugWorldHeightProbeHit == 0 &&
        out->debugWorldHeightProbeLevel >= 0 &&
        out->debugWorldHeightProbeWorldX >= 0 &&
        out->debugWorldHeightProbeWorldZ >= 0) {
        const i32 level = out->debugWorldHeightProbeLevel;
        const i32 worldX = out->debugWorldHeightProbeWorldX;
        const i32 worldZ = out->debugWorldHeightProbeWorldZ;
        const i32 tx = worldX >> 7;
        const i32 tz = worldZ >> 7;
        const i32 rx = worldX & 0x7f;
        const i32 rz = worldZ & 0x7f;
        const auto within = [&](i32 lvl, i32 x, i32 y) noexcept {
            return lvl >= 0 &&
                   lvl < scene.levels &&
                   x >= 0 &&
                   x <= scene.sizeX &&
                   y >= 0 &&
                   y <= scene.sizeY;
        };
        const bool okSample =
            within(level, tx, tz) &&
            within(level, tx + 1, tz) &&
            within(level, tx, tz + 1) &&
            within(level, tx + 1, tz + 1);
        out->debugWorldHeightProbeHit = okSample ? 1 : -1;
        out->debugWorldHeightProbePacked[0] = okSample ? 1 : 0;
        out->debugWorldHeightProbePacked[1] = tx;
        out->debugWorldHeightProbePacked[2] = tz;
        out->debugWorldHeightProbePacked[3] = rx;
        out->debugWorldHeightProbePacked[4] = rz;
        if (okSample) {
            const i32 h00 = scene.height(level, tx, tz);
            const i32 h10 = scene.height(level, tx + 1, tz);
            const i32 h01 = scene.height(level, tx, tz + 1);
            const i32 h11 = scene.height(level, tx + 1, tz + 1);
            const i32 h0Numerator = h00 * (128 - rx) + h10 * rx;
            const i32 h0 = h0Numerator >> 7;
            const i32 h1Numerator = h01 * (128 - rx) + h11 * rx;
            const i32 h1 = h1Numerator >> 7;
            const i32 hNumerator = h0 * (128 - rz) + h1 * rz;
            const i32 h = hNumerator >> 7;
            out->debugWorldHeightProbePacked[5] = h00;
            out->debugWorldHeightProbePacked[6] = h10;
            out->debugWorldHeightProbePacked[7] = h01;
            out->debugWorldHeightProbePacked[8] = h11;
            out->debugWorldHeightProbePacked[9] = h0Numerator;
            out->debugWorldHeightProbePacked[10] = h0;
            out->debugWorldHeightProbePacked[11] = h1Numerator;
            out->debugWorldHeightProbePacked[12] = h1;
            out->debugWorldHeightProbePacked[13] = hNumerator;
            out->debugWorldHeightProbePacked[14] = h;
            out->debugWorldHeightProbePacked[15] = 0; // baseY not applicable for direct probe
        }
    }

    SceneBuffer buffer{};
    if (emitGeometry) {
        auto rr = buffer.init(alloc);
        if (!rr.isOk()) {
            return rr.status();
        }
    }

    const i32 border = inferTerrainBorderSize(input.sizeX, input.sizeY);
    const i32 startX = border;
    const i32 startY = border;
    const i32 endX = input.sizeX - border;
    const i32 endY = input.sizeY - border;

    Vec<SceneCommandPlanDebugOp> planOps(alloc);
    DecodedOverlayTypeCache overlayTypeCache(alloc);
    TerrainTileFaceCountGrid terrainFaceGrid(alloc);
    Vec<u8> tileHasValidFaceColorsAForLowDetail(alloc);

    if (startX >= endX || startY >= endY) {
        if (emitGeometry) {
            const Status cs = buffer.appendCommandStream(out, alloc);
            if (!ok(cs)) {
                return cs;
            }
        }
        return Status::Ok;
    }

    const std::size_t tileCount =
        static_cast<std::size_t>(scene.levels) *
        static_cast<std::size_t>(scene.sizeX) *
        static_cast<std::size_t>(scene.sizeY);
    auto rrTileFaceColors = tileHasValidFaceColorsAForLowDetail.resize(tileCount);
    if (!rrTileFaceColors.isOk()) {
        return rrTileFaceColors.status();
    }
    for (std::size_t i = 0; i < tileHasValidFaceColorsAForLowDetail.size(); i++) {
        tileHasValidFaceColorsAForLowDetail[i] = 0;
    }

    if (!emitGeometry) {
        const Status ts = scb::analyzeTerrainLowDetailTileFlags(
            input,
            scene,
            startX,
            startY,
            endX,
            endY,
            border,
            &tileHasValidFaceColorsAForLowDetail,
            &underlayTypeCache,
            &overlayTypeCache,
            alloc);
        if (!ok(ts)) {
            return ts;
        }
    }

    i32 indexCount = 0;
    if (emitGeometry) {
        for (i32 level = 0; level < scene.levels; level++) {
            i32 levelElements = 0;
            const Status gs = scb::appendTerrainFallbackGeometryForLevel(
                input,
                scene,
                level,
                startX,
                startY,
                endX,
                endY,
                border,
                out,
                &terrainFaceGrid,
                &tileHasValidFaceColorsAForLowDetail,
                &buffer,
                &levelElements,
                &underlayTypeCache,
                &overlayTypeCache,
                alloc);
            if (!ok(gs)) {
                return gs;
            }
            if (levelElements <= 0) {
                continue;
            }

            ModelInfo terrainInst{};
            terrainInst.sceneX = 0;
            terrainInst.sceneZ = 0;
            terrainInst.heightOffset = 0;
            terrainInst.level = level;
            terrainInst.contourGround = static_cast<i32>(ContourGroundType::None);
            terrainInst.priority = 0;
            terrainInst.interactType = static_cast<i32>(InteractType::None);
            terrainInst.interactId = 0xffff;
            const Span<const ModelInfo> instanceSpan(&terrainInst, 1);

            const i32 offsetBytes = indexCount * 4;
            const DebugCommandProvenance terrainProvenance = makeLocCommandProvenance(
                DebugCommandSourceKind::Terrain,
                -1,
                -1,
                -1,
                -1,
                -1,
                0,
                0);
            Status s = buffer.emitMergedCommand(
                offsetBytes,
                levelElements,
                instanceSpan,
                /*transparent=*/false,
                /*includeLod=*/true,
                &terrainProvenance);
            if (!ok(s)) {
                return s;
            }
            s = buffer.emitInteractCommand(
                offsetBytes,
                levelElements,
                instanceSpan,
                /*transparent=*/false,
                /*includeLod=*/true,
                &terrainProvenance);
            if (!ok(s)) {
                return s;
            }
            indexCount += levelElements;
        }
    }

    Vec<LocAnimatedGroupPlan> locAnimatedGroups(alloc);
    Vec<LocAnimatedPlaceholder> locAnimatedEntries(alloc);
    DecodedLocTypeCache locTypeCache(cacheInfo, alloc);
    DecodedVarBitTypeCache varbitTypeCache(cacheInfo, alloc);
    DecodedSeqTypeCache seqTypeCache(cacheInfo, alloc);
    DecodedModelFaceStatsCache modelFaceCache(alloc);

    const bool shouldEmitLocs =
        input.locLoadType == 0 && input.loadLocs && hasLocPlacements;
    if (shouldEmitLocs) {
        Status ls = Status::Ok;
        if (emitGeometry) {
            ls = scb::emitLocCommandsFromMapLocBytes(
                input,
                scene,
                &tileHasValidFaceColorsAForLowDetail,
                &planOps,
                &buffer,
                &indexCount,
                &locTypeCache,
                &varbitTypeCache,
                &seqTypeCache,
                &modelFaceCache,
                out,
                &locAnimatedGroups,
                &locAnimatedEntries,
                alloc);
        } else {
            ls = scb::appendLocPlanOpsFromMapLocBytes(
                input,
                scene,
                &tileHasValidFaceColorsAForLowDetail,
                &planOps,
                &locTypeCache,
                &varbitTypeCache,
                &seqTypeCache,
                &modelFaceCache,
                out,
                alloc);
        }
        if (!ok(ls)) {
            return ls;
        }
    }

    if (input.objTypeIds.size() > 0 && input.objSpawnMapIds.size() > 0) {
        DecodedObjTypeCache objTypeCache(cacheInfo, alloc);
        DecodedModelFaceStatsCache objModelCache(alloc);
        Status os = Status::Ok;
        if (emitGeometry) {
            os = scb::emitObjCommandsFromPackedSpawns(
                input,
                scene,
                &planOps,
                &buffer,
                &indexCount,
                &objTypeCache,
                &objModelCache,
                out,
                alloc);
        } else {
            os = scb::appendObjPlanOpsFromPackedSpawns(
                input,
                scene,
                &planOps,
                &objTypeCache,
                &objModelCache,
                out,
                alloc);
        }
        if (!ok(os)) {
            return os;
        }
    }

    // TS buffer layout: animated loc frame geometry is appended after *all* static scene geometry
    // (locs + objs), and placeholders are appended after the frames.
    if (emitGeometry && shouldEmitLocs && (!locAnimatedGroups.empty() || !locAnimatedEntries.empty())) {
        const Status as = scb::emitLocAnimatedFramesAndPlaceholdersFromPlannedGroups(
            input,
            scene,
            Span<const LocAnimatedGroupPlan>(locAnimatedGroups.data(), locAnimatedGroups.size()),
            Span<const LocAnimatedPlaceholder>(locAnimatedEntries.data(), locAnimatedEntries.size()),
            &buffer,
            &indexCount,
            &locTypeCache,
            &seqTypeCache,
            alloc);
        if (!ok(as)) {
            return as;
        }
    }

    if (emitGeometry) {
        const SceneBufferBucketsDigest bucketsDigest = debugDigestSceneBufferBuckets(buffer);
        out->debugSceneBucketsCmdTotal = bucketsDigest.cmdTotal;
        out->debugSceneBucketsInstanceTotal = bucketsDigest.instanceTotal;
        out->debugSceneBucketsHash = bucketsDigest.hash;
        out->debugSceneBucketsCmdCount0 = bucketsDigest.bucketCmdCounts[0];
        out->debugSceneBucketsCmdCount1 = bucketsDigest.bucketCmdCounts[1];
        out->debugSceneBucketsCmdCount2 = bucketsDigest.bucketCmdCounts[2];
        out->debugSceneBucketsCmdCount3 = bucketsDigest.bucketCmdCounts[3];
        out->debugSceneBucketsCmdCount4 = bucketsDigest.bucketCmdCounts[4];
        out->debugSceneBucketsCmdCount5 = bucketsDigest.bucketCmdCounts[5];
        out->debugSceneBucketsCmdCount6 = bucketsDigest.bucketCmdCounts[6];
        out->debugSceneBucketsCmdCount7 = bucketsDigest.bucketCmdCounts[7];
    }

    const Status pds = appendSceneCommandPlanDebugDigest(
        out,
        Span<const SceneCommandPlanDebugOp>(planOps.data(), planOps.size()),
        alloc);
    if (!ok(pds)) {
        return pds;
    }

    if (emitGeometry) {
        const Status fs = buffer.finalizeGeometry(indexCount, alloc);
        if (!ok(fs)) {
            return fs;
        }
        const Status cs = buffer.appendCommandStream(out, alloc);
        if (!ok(cs)) {
            return cs;
        }
    }

    if (emitGeometry && !terrainFaceGrid.counts.empty()) {
        auto rrGrid = out->debugTerrainTileFaceCounts.resize(terrainFaceGrid.counts.size());
        if (!rrGrid.isOk()) {
            return rrGrid.status();
        }
        for (std::size_t i = 0; i < terrainFaceGrid.counts.size(); i++) {
            out->debugTerrainTileFaceCounts[i] = terrainFaceGrid.counts[i];
        }
        out->debugTerrainTileFaceCountsLevels = terrainFaceGrid.levels;
        out->debugTerrainTileFaceCountsWidth = terrainFaceGrid.width;
        out->debugTerrainTileFaceCountsHeight = terrainFaceGrid.height;
        out->debugTerrainTileFaceCountsBorder = terrainFaceGrid.border;
    }

    if (emitGeometry) {
        recomputeLocMergedDummyDebugStatsFromPackedCommands(out);
    }

    return Status::Ok;
}

} // namespace scb

Status deriveSceneLocRenderPlacementStage(
    const SceneLocRenderPlacementStageInput& input,
    SceneLocRenderPlacementStageOutput* out) noexcept {
    if (!input.resolvedLocType || !out) {
        return Status::InvalidArgument;
    }

    const LocType& resolved = *input.resolvedLocType;
    i32 seqId = resolved.seqId;
    if (seqId == -1 && !resolved.randomSeqIds.empty()) {
        seqId = resolved.randomSeqIds[0];
    }

    out->seqId = seqId;
    out->priority = scb::locPlacementPriority(input.placementType);
    out->includeLod = !input.lowDetailPlacement;
    // Any contoured-ground model differs per placement; force per-placement merge.
    // Low-detail placements skip contouring, so they can merge normally.
    out->forceMerge = resolved.contourGroundType > 0 && !input.lowDetailPlacement;
    // Match TS render-data backend: treat a placement as "entity-driven" when it has an active seq,
    // or when either the base or resolved type participates in transforms, or when we explicitly
    // requested a no-model build.
    out->sourceIsEntity =
        (seqId != -1) ||
        input.baseHadTransforms ||
        !resolved.transforms.empty() ||
        (input.locLoadType == 1);
    // Match TS render-data backend: interact id is the resolved loc type id (post-transform).
    out->interactId = resolved.id;
    return Status::Ok;
}

i32 expandSceneLocPlacementModelVariants(
    i32 placementType,
    i32 rotation,
    SceneLocPlacementModelVariant* outVariants,
    i32 outCapacity) noexcept {
    if (!outVariants || outCapacity <= 0) {
        return 0;
    }

    switch (placementType) {
        case 11: {
            outVariants[0].placementType = 10;
            outVariants[0].rotation = rotation + 4;
            return 1;
        }
        case 2: {
            outVariants[0].placementType = 2;
            outVariants[0].rotation = rotation + 4;
            if (outCapacity > 1) {
                outVariants[1].placementType = 2;
                outVariants[1].rotation = (rotation + 1) & 3;
                return 2;
            }
            return 1;
        }
        case 5: {
            outVariants[0].placementType = 4;
            outVariants[0].rotation = rotation;
            return 1;
        }
        case 6: {
            outVariants[0].placementType = 4;
            outVariants[0].rotation = rotation + 4;
            return 1;
        }
        case 7: {
            const i32 insideRotation = (rotation + 2) & 3;
            outVariants[0].placementType = 4;
            outVariants[0].rotation = insideRotation + 4;
            return 1;
        }
        case 8: {
            const i32 insideRotation = (rotation + 2) & 3;
            outVariants[0].placementType = 4;
            outVariants[0].rotation = rotation + 4;
            if (outCapacity > 1) {
                outVariants[1].placementType = 4;
                outVariants[1].rotation = insideRotation + 4;
                return 2;
            }
            return 1;
        }
        default: {
            outVariants[0].placementType = placementType;
            outVariants[0].rotation = rotation;
            return 1;
        }
    }
}

bool sceneLocCommandGroupKeysEqual(
    const SceneLocCommandGroupKey& a,
    const SceneLocCommandGroupKey& b) noexcept {
    if (a.modelSignature != b.modelSignature ||
        a.modelIdsHash != b.modelIdsHash ||
        a.placementType != b.placementType ||
        a.rotation != b.rotation ||
        a.level != b.level ||
        a.priority != b.priority ||
        a.forceMerge != b.forceMerge ||
        a.contourSensitive != b.contourSensitive) {
        return false;
    }

    if (!a.contourSensitive) {
        return true;
    }

    if (!a.forceMerge) {
        return a.contourSceneHeight == b.contourSceneHeight &&
               a.contourGround == b.contourGround &&
               a.contourProfileHash == b.contourProfileHash;
    }

    return a.contourSceneHeight == b.contourSceneHeight &&
           a.contourSceneX == b.contourSceneX &&
           a.contourSceneZ == b.contourSceneZ &&
           a.contourGround == b.contourGround &&
           a.contourProfileHash == b.contourProfileHash;
}

static Status validateOffsetLengthPairs(
    Span<const i32> offsets,
    Span<const i32> lengths,
    std::size_t bytesSize) noexcept {
    if (offsets.size() != lengths.size()) {
        return Status::SizeMismatch;
    }
    for (std::size_t i = 0; i < offsets.size(); i++) {
        const i32 off = offsets[i];
        const i32 len = lengths[i];
        if ((off < 0) != (len < 0)) {
            return Status::BadFormat;
        }
        if (off >= 0) {
            if (off > static_cast<i32>(bytesSize) ||
                len > static_cast<i32>(bytesSize) - off) {
                return Status::OutOfRange;
            }
        }
    }
    return Status::Ok;
}

static Status validateSceneCommandBuildInput(const SceneCommandBuildInput& input) noexcept {
    if (input.sizeX <= 0 || input.sizeY <= 0 || input.unitsTileHeightBasis <= 0) {
        return Status::InvalidArgument;
    }
    if (input.mapSquareIds.size() != input.terrainOffsets.size() ||
        input.mapSquareIds.size() != input.terrainLengths.size() ||
        input.mapSquareIds.size() != input.locOffsets.size() ||
        input.mapSquareIds.size() != input.locLengths.size() ||
        input.locTypeIds.size() != input.locTypeOffsets.size() ||
        input.locTypeIds.size() != input.locTypeLengths.size() ||
        input.varbitIds.size() != input.varbitOffsets.size() ||
        input.varbitIds.size() != input.varbitLengths.size() ||
        input.seqTypeIds.size() != input.seqTypeOffsets.size() ||
        input.seqTypeIds.size() != input.seqTypeLengths.size() ||
        input.seqFrameIds.size() != input.seqFrameOffsets.size() ||
        input.seqFrameIds.size() != input.seqFrameLengths.size() ||
        input.seqAlphaHintIds.size() != input.seqAlphaHintOffsets.size() ||
        input.seqAlphaHintIds.size() != input.seqAlphaHintLengths.size() ||
        input.seqBaseIds.size() != input.seqBaseOffsets.size() ||
        input.seqBaseIds.size() != input.seqBaseLengths.size() ||
        input.skeletalSeqIds.size() != input.skeletalSeqOffsets.size() ||
        input.skeletalSeqIds.size() != input.skeletalSeqLengths.size() ||
        input.modelIds.size() != input.modelOffsets.size() ||
        input.modelIds.size() != input.modelLengths.size() ||
        input.objTypeIds.size() != input.objTypeOffsets.size() ||
        input.objTypeIds.size() != input.objTypeLengths.size() ||
        input.objSpawnMapIds.size() != input.objSpawnOffsets.size() ||
        input.objSpawnMapIds.size() != input.objSpawnLengths.size()) {
        return Status::SizeMismatch;
    }

    Status s = validateOffsetLengthPairs(
        input.terrainOffsets,
        input.terrainLengths,
        input.terrainBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.locOffsets, input.locLengths, input.locBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.locTypeOffsets, input.locTypeLengths, input.locTypeBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.objTypeOffsets, input.objTypeLengths, input.objTypeBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.objSpawnOffsets, input.objSpawnLengths, input.objSpawnBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.varbitOffsets, input.varbitLengths, input.varbitBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.seqTypeOffsets, input.seqTypeLengths, input.seqTypeBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.seqFrameOffsets, input.seqFrameLengths, input.seqFrameBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(
        input.seqAlphaHintOffsets,
        input.seqAlphaHintLengths,
        input.seqAlphaHintBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.seqBaseOffsets, input.seqBaseLengths, input.seqBaseBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(
        input.skeletalSeqOffsets,
        input.skeletalSeqLengths,
        input.skeletalSeqBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.modelOffsets, input.modelLengths, input.modelBytes.size());
    if (!ok(s)) return s;
    return Status::Ok;
}

static Status buildSceneCommandStreamByMode(
    const SceneCommandBuildInput& input,
    SceneCommandStream* out,
    scb::SceneCommandBuildMode mode,
    Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    const Status vs = validateSceneCommandBuildInput(input);
    if (!ok(vs)) {
        return vs;
    }

    auto rr = out->init(alloc);
    if (!rr.isOk()) {
        return rr.status();
    }
    out->clear();
    out->debugTerrainDigestSampleStartVertex =
        input.debugTerrainDigestSampleStartVertex > 0 ? input.debugTerrainDigestSampleStartVertex : 0;
    out->debugTerrainProbeLevel = input.debugTerrainProbeLevel;
    out->debugTerrainProbeTileX = input.debugTerrainProbeTileX;
    out->debugTerrainProbeTileY = input.debugTerrainProbeTileY;
    out->debugWorldHeightProbeLevel = input.debugWorldHeightProbeLevel;
    out->debugWorldHeightProbeWorldX = input.debugWorldHeightProbeWorldX;
    out->debugWorldHeightProbeWorldZ = input.debugWorldHeightProbeWorldZ;
    return scb::buildSceneCommandStreamFromBytesNoSeed(input, out, mode, alloc);
}

Status buildSceneCommandStream(
    const SceneCommandBuildInput& input,
    SceneCommandStream* out,
    Allocator& alloc) noexcept {
    return buildSceneCommandStreamByMode(
        input,
        out,
        scb::SceneCommandBuildMode::FullStream,
        alloc);
}

Status buildSceneCommandPlanOnly(
    const SceneCommandBuildInput& input,
    SceneCommandStream* out,
    Allocator& alloc) noexcept {
    return buildSceneCommandStreamByMode(
        input,
        out,
        scb::SceneCommandBuildMode::PlanOnly,
        alloc);
}

} // namespace rs
