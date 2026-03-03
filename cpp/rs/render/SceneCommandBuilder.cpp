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

#include <chrono>
#include <cstdio>
#include <limits>

#include "../../third_party/xxhash/xxhash.h"

namespace rs {

namespace scb {

using BuildClock = std::chrono::steady_clock;

static i32 elapsedUs(const BuildClock::time_point start) noexcept {
    const auto us = std::chrono::duration_cast<std::chrono::microseconds>(BuildClock::now() - start);
    if (us.count() > static_cast<long long>(std::numeric_limits<i32>::max())) {
        return std::numeric_limits<i32>::max();
    }
    if (us.count() < 0) {
        return 0;
    }
    return static_cast<i32>(us.count());
}

static Status tryDecodeModelDataById(
    const SceneCommandBuildInput& input,
    i32 modelId,
    ModelData* outModel,
    Allocator& alloc) noexcept {
    if (!outModel) {
        return Status::InvalidArgument;
    }
    if (modelId < 0) {
        return Status::NotFound;
    }

    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 3, modelId, &bytes);
    if (ok(bs) && bytes.size() > 0) {
        return decodeModelData(bytes, outModel, alloc);
    }

    if (input.tryLoadModelData) {
        return input.tryLoadModelData(input.modelDataCtx, modelId, outModel, alloc);
    }
    return Status::NotFound;
}

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
    // TS parity: do not early-return on denom==0 (JS produces +/-Inf and NaNs here).
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
    // TS parity: do not early-return on denom==0 (JS produces +/-Inf and NaNs here).
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

static void computeCylindricalUv(
    i32 vx,
    i32 vy,
    i32 vz,
    i32 centerX,
    i32 centerY,
    i32 centerZ,
    const float* transform9,
    float scaleZ,
    i32 direction,
    float speed,
    float* outU,
    float* outV) noexcept {
    if (!transform9 || !outU || !outV) {
        return;
    }
    // TS parity: do math in double (JS numbers are 64-bit floats, even when sourced from Float32Array).
    const double x = static_cast<double>(vx - centerX);
    const double y = static_cast<double>(vy - centerY);
    const double z = static_cast<double>(vz - centerZ);
    const double localX =
        x * static_cast<double>(transform9[0]) +
        y * static_cast<double>(transform9[1]) +
        z * static_cast<double>(transform9[2]);
    const double localY =
        x * static_cast<double>(transform9[3]) +
        y * static_cast<double>(transform9[4]) +
        z * static_cast<double>(transform9[5]);
    const double localZ =
        x * static_cast<double>(transform9[6]) +
        y * static_cast<double>(transform9[7]) +
        z * static_cast<double>(transform9[8]);
    double u = std::atan2(localX, localZ) / 6.2831855 + 0.5;
    if (scaleZ != 1.0f) {
        u *= static_cast<double>(scaleZ);
    }
    double v = localY + 0.5 + static_cast<double>(speed);
    if (direction == 1) {
        const double uPrev = u;
        u = -v;
        v = uPrev;
    } else if (direction == 2) {
        u = -u;
        v = -v;
    } else if (direction == 3) {
        const double uPrev = u;
        u = v;
        v = -uPrev;
    }
    *outU = static_cast<float>(u);
    *outV = static_cast<float>(v);
}

static i32 getDominantAxisFace(double x, double y, double z) noexcept {
    const double absX = x < 0.0 ? -x : x;
    const double absY = y < 0.0 ? -y : y;
    const double absZ = z < 0.0 ? -z : z;
    if (absY > absX && absY > absZ) {
        return y > 0.0 ? 0 : 1;
    }
    if (absZ > absX && absZ > absY) {
        return z > 0.0 ? 2 : 3;
    }
    return x > 0.0 ? 4 : 5;
}

static void computeBoxProjectedUv(
    i32 vx,
    i32 vy,
    i32 vz,
    i32 centerX,
    i32 centerY,
    i32 centerZ,
    i32 cubeFace,
    const float* transform9,
    i32 direction,
    float speed,
    float uOffset,
    float vOffset,
    float* outU,
    float* outV) noexcept {
    if (!transform9 || !outU || !outV) {
        return;
    }
    const double x = static_cast<double>(vx - centerX);
    const double y = static_cast<double>(vy - centerY);
    const double z = static_cast<double>(vz - centerZ);
    const double localX =
        x * static_cast<double>(transform9[0]) +
        y * static_cast<double>(transform9[1]) +
        z * static_cast<double>(transform9[2]);
    const double localY =
        x * static_cast<double>(transform9[3]) +
        y * static_cast<double>(transform9[4]) +
        z * static_cast<double>(transform9[5]);
    const double localZ =
        x * static_cast<double>(transform9[6]) +
        y * static_cast<double>(transform9[7]) +
        z * static_cast<double>(transform9[8]);
    double u = 0.0;
    double v = 0.0;
    const double speedD = static_cast<double>(speed);
    const double uOffsetD = static_cast<double>(uOffset);
    const double vOffsetD = static_cast<double>(vOffset);
    if (cubeFace == 0) {
        u = localX + speedD + 0.5;
        v = -localZ + vOffsetD + 0.5;
    } else if (cubeFace == 1) {
        u = localX + speedD + 0.5;
        v = localZ + vOffsetD + 0.5;
    } else if (cubeFace == 2) {
        u = -localX + speedD + 0.5;
        v = -localY + uOffsetD + 0.5;
    } else if (cubeFace == 3) {
        u = localX + speedD + 0.5;
        v = -localY + uOffsetD + 0.5;
    } else if (cubeFace == 4) {
        u = localZ + vOffsetD + 0.5;
        v = -localY + uOffsetD + 0.5;
    } else {
        u = -localZ + vOffsetD + 0.5;
        v = -localY + uOffsetD + 0.5;
    }
    if (direction == 1) {
        const double uPrev = u;
        u = -v;
        v = uPrev;
    } else if (direction == 2) {
        u = -u;
        v = -v;
    } else if (direction == 3) {
        const double uPrev = u;
        u = v;
        v = -uPrev;
    }
    *outU = static_cast<float>(u);
    *outV = static_cast<float>(v);
}

static void computeSphericalUv(
    i32 vx,
    i32 vy,
    i32 vz,
    i32 centerX,
    i32 centerY,
    i32 centerZ,
    const float* transform9,
    i32 direction,
    float speed,
    float* outU,
    float* outV) noexcept {
    if (!transform9 || !outU || !outV) {
        return;
    }
    const double x = static_cast<double>(vx - centerX);
    const double y = static_cast<double>(vy - centerY);
    const double z = static_cast<double>(vz - centerZ);
    const double localX =
        x * static_cast<double>(transform9[0]) +
        y * static_cast<double>(transform9[1]) +
        z * static_cast<double>(transform9[2]);
    const double localY =
        x * static_cast<double>(transform9[3]) +
        y * static_cast<double>(transform9[4]) +
        z * static_cast<double>(transform9[5]);
    const double localZ =
        x * static_cast<double>(transform9[6]) +
        y * static_cast<double>(transform9[7]) +
        z * static_cast<double>(transform9[8]);
    const double localLen = std::sqrt(localX * localX + localY * localY + localZ * localZ);
    double u = std::atan2(localX, localZ) / 6.2831855 + 0.5;
    double v = 0.0;
    if (localLen != 0.0) {
        v = std::asin(localY / localLen) / 3.1415927 + 0.5 + static_cast<double>(speed);
    } else {
        v = 0.5 + static_cast<double>(speed);
    }
    if (direction == 1) {
        const double uPrev = u;
        u = -v;
        v = uPrev;
    } else if (direction == 2) {
        u = -u;
        v = -v;
    } else if (direction == 3) {
        const double uPrev = u;
        u = v;
        v = -uPrev;
    }
    *outU = static_cast<float>(u);
    *outV = static_cast<float>(v);
}

static void buildTextureTransformMatrix(
    i32 p,
    i32 m,
    i32 n,
    i32 rotation,
    float scaleX,
    float scaleY,
    float scaleZ,
    float* out9) noexcept {
    if (!out9) {
        return;
    }
    // TS parity: replicate Float32Array round-trips by computing in double and then storing to float.
    double axisX = 1.0;
    double axisZ = 0.0;
    double cosAngle = static_cast<double>(m) / 32767.0;
    double sinAngle = -std::sqrt(1.0 - cosAngle * cosAngle);
    double oneMinusCosAngle = 1.0 - cosAngle;
    const double axisLenXZ =
        std::sqrt(static_cast<double>(p) * static_cast<double>(p) +
                  static_cast<double>(n) * static_cast<double>(n));
    if (axisLenXZ != 0.0) {
        axisX = -static_cast<double>(n) / axisLenXZ;
        axisZ = static_cast<double>(p) / axisLenXZ;
    }

    // Base matrix is stored into a Float32Array in TS, so each element is rounded to float32.
    const float baseF[9] = {
        static_cast<float>(cosAngle + axisX * axisX * oneMinusCosAngle),
        static_cast<float>(axisZ * sinAngle),
        static_cast<float>(axisZ * axisX * oneMinusCosAngle),
        static_cast<float>(-axisZ * sinAngle),
        static_cast<float>(cosAngle),
        static_cast<float>(axisX * sinAngle),
        static_cast<float>(axisX * axisZ * oneMinusCosAngle),
        static_cast<float>(-axisX * sinAngle),
        static_cast<float>(cosAngle + axisZ * axisZ * oneMinusCosAngle),
    };

    const double angle = static_cast<double>(rotation) * 0.024543693;
    cosAngle = std::cos(angle);
    sinAngle = std::sin(angle);

    // yRotationMatrix is also a Float32Array in TS.
    const float yRotF[9] = {
        static_cast<float>(cosAngle), 0.0f, static_cast<float>(sinAngle),
        0.0f, 1.0f, 0.0f,
        static_cast<float>(-sinAngle), 0.0f, static_cast<float>(cosAngle),
    };

    // Combined matrix multiplies float32 values, but JS does the arithmetic in double.
    const double b0 = static_cast<double>(baseF[0]);
    const double b1 = static_cast<double>(baseF[1]);
    const double b2 = static_cast<double>(baseF[2]);
    const double b3 = static_cast<double>(baseF[3]);
    const double b4 = static_cast<double>(baseF[4]);
    const double b5 = static_cast<double>(baseF[5]);
    const double b6 = static_cast<double>(baseF[6]);
    const double b7 = static_cast<double>(baseF[7]);
    const double b8 = static_cast<double>(baseF[8]);

    const double y0 = static_cast<double>(yRotF[0]);
    const double y1 = static_cast<double>(yRotF[1]);
    const double y2 = static_cast<double>(yRotF[2]);
    const double y3 = static_cast<double>(yRotF[3]);
    const double y4 = static_cast<double>(yRotF[4]);
    const double y5 = static_cast<double>(yRotF[5]);
    const double y6 = static_cast<double>(yRotF[6]);
    const double y7 = static_cast<double>(yRotF[7]);
    const double y8 = static_cast<double>(yRotF[8]);

    double combined[9]{};
    combined[0] = y0 * b0 + y1 * b3 + y2 * b6;
    combined[1] = y0 * b1 + y1 * b4 + y2 * b7;
    combined[2] = y0 * b2 + y1 * b5 + y2 * b8;
    combined[3] = y3 * b0 + y4 * b3 + y5 * b6;
    combined[4] = y3 * b1 + y4 * b4 + y5 * b7;
    combined[5] = y3 * b2 + y4 * b5 + y5 * b8;
    combined[6] = y6 * b0 + y7 * b3 + y8 * b6;
    combined[7] = y6 * b1 + y7 * b4 + y8 * b7;
    combined[8] = y6 * b2 + y7 * b5 + y8 * b8;

    combined[0] *= static_cast<double>(scaleX);
    combined[1] *= static_cast<double>(scaleX);
    combined[2] *= static_cast<double>(scaleX);
    combined[3] *= static_cast<double>(scaleY);
    combined[4] *= static_cast<double>(scaleY);
    combined[5] *= static_cast<double>(scaleY);
    combined[6] *= static_cast<double>(scaleZ);
    combined[7] *= static_cast<double>(scaleZ);
    combined[8] *= static_cast<double>(scaleZ);

    for (int i = 0; i < 9; i++) {
        out9[i] = static_cast<float>(combined[i]);
    }
}

struct ModelTextureScales final {
    Vec<i32> centerX;
    Vec<i32> centerY;
    Vec<i32> centerZ;
    Vec<float> matrices9; // flat: texCoord * 9 + col
    bool ready = false;
    explicit ModelTextureScales(Allocator& alloc) noexcept
        : centerX(alloc), centerY(alloc), centerZ(alloc), matrices9(alloc) {}
};

static Status computeModelTextureScales(
    const ModelData& model,
    ModelTextureScales* out,
    Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    out->ready = false;
    if (!model.hasTextureCoords || model.textureFaceCount <= 0) {
        return Status::Ok;
    }
    const i32 texFaceCount = model.textureFaceCount;
    if (texFaceCount <= 0) {
        return Status::Ok;
    }
    const std::size_t tN = static_cast<std::size_t>(texFaceCount);
    if (model.textureRenderTypes.size() < tN ||
        model.textureMappingP.size() < tN ||
        model.textureMappingM.size() < tN ||
        model.textureMappingN.size() < tN ||
        model.textureScaleX.size() < tN ||
        model.textureScaleY.size() < tN ||
        model.textureScaleZ.size() < tN ||
        model.textureRotation.size() < tN ||
        model.textureDirection.size() < tN ||
        model.textureSpeed.size() < tN) {
        return Status::OutOfRange;
    }

    Vec<i32> minX(alloc);
    Vec<i32> maxX(alloc);
    Vec<i32> minY(alloc);
    Vec<i32> maxY(alloc);
    Vec<i32> minZ(alloc);
    Vec<i32> maxZ(alloc);
    auto rr = minX.resize(tN);
    if (!rr.isOk()) return rr.status();
    rr = maxX.resize(tN);
    if (!rr.isOk()) return rr.status();
    rr = minY.resize(tN);
    if (!rr.isOk()) return rr.status();
    rr = maxY.resize(tN);
    if (!rr.isOk()) return rr.status();
    rr = minZ.resize(tN);
    if (!rr.isOk()) return rr.status();
    rr = maxZ.resize(tN);
    if (!rr.isOk()) return rr.status();
    for (std::size_t i = 0; i < tN; i++) {
        minX[i] = 2147483647;
        maxX[i] = -2147483647;
        minY[i] = 2147483647;
        maxY[i] = -2147483647;
        minZ[i] = 2147483647;
        maxZ[i] = -2147483647;
    }

    // Compute bounds for each texCoord referenced by any face.
    for (i32 fi = 0; fi < model.faceCount; fi++) {
        if (fi < 0 || fi >= static_cast<i32>(model.textureCoords.size())) {
            continue;
        }
        const i8 raw = model.textureCoords[static_cast<std::size_t>(fi)];
        if (raw == static_cast<i8>(-1)) {
            continue;
        }
        const i32 tc = static_cast<i32>(raw) & 0xff;
        if (tc < 0 || tc >= texFaceCount) {
            continue;
        }
        if (fi >= static_cast<i32>(model.indices1.size()) ||
            fi >= static_cast<i32>(model.indices2.size()) ||
            fi >= static_cast<i32>(model.indices3.size())) {
            continue;
        }
        const i32 idxs[3] = {
            model.indices1[static_cast<std::size_t>(fi)],
            model.indices2[static_cast<std::size_t>(fi)],
            model.indices3[static_cast<std::size_t>(fi)],
        };
        for (int v = 0; v < 3; v++) {
            const i32 vi = idxs[v];
            if (vi < 0 ||
                static_cast<std::size_t>(vi) >= model.verticesX.size() ||
                static_cast<std::size_t>(vi) >= model.verticesY.size() ||
                static_cast<std::size_t>(vi) >= model.verticesZ.size()) {
                continue;
            }
            const i32 vx = model.verticesX[static_cast<std::size_t>(vi)];
            const i32 vy = model.verticesY[static_cast<std::size_t>(vi)];
            const i32 vz = model.verticesZ[static_cast<std::size_t>(vi)];
            const std::size_t sti = static_cast<std::size_t>(tc);
            if (minX[sti] > vx) minX[sti] = vx;
            if (vx > maxX[sti]) maxX[sti] = vx;
            if (minY[sti] > vy) minY[sti] = vy;
            if (vy > maxY[sti]) maxY[sti] = vy;
            if (minZ[sti] > vz) minZ[sti] = vz;
            if (vz > maxZ[sti]) maxZ[sti] = vz;
        }
    }

    rr = out->centerX.resize(tN);
    if (!rr.isOk()) return rr.status();
    rr = out->centerY.resize(tN);
    if (!rr.isOk()) return rr.status();
    rr = out->centerZ.resize(tN);
    if (!rr.isOk()) return rr.status();
    rr = out->matrices9.resize(tN * 9);
    if (!rr.isOk()) return rr.status();
    // Default to identity.
    for (std::size_t i = 0; i < tN; i++) {
        const std::size_t base = i * 9;
        out->matrices9[base + 0] = 1.0f;
        out->matrices9[base + 1] = 0.0f;
        out->matrices9[base + 2] = 0.0f;
        out->matrices9[base + 3] = 0.0f;
        out->matrices9[base + 4] = 1.0f;
        out->matrices9[base + 5] = 0.0f;
        out->matrices9[base + 6] = 0.0f;
        out->matrices9[base + 7] = 0.0f;
        out->matrices9[base + 8] = 1.0f;
    }

    for (std::size_t i = 0; i < tN; i++) {
        const i32 type = static_cast<i32>(model.textureRenderTypes[i]) & 0xff;
        if (type <= 0) {
            out->centerX[i] = 0;
            out->centerY[i] = 0;
            out->centerZ[i] = 0;
            continue;
        }
        out->centerX[i] = (minX[i] + maxX[i]) / 2;
        out->centerY[i] = (minY[i] + maxY[i]) / 2;
        out->centerZ[i] = (minZ[i] + maxZ[i]) / 2;

        float scaleX = 1.0f;
        float scaleY = 1.0f;
        float scaleZ = 1.0f;
        if (type == 1) {
            const i32 scaleX0 = model.textureScaleX[i];
            // TS parity: allow division by zero to yield +/-inf (JS semantics).
            scaleY = 64.0f / static_cast<float>(model.textureScaleY[i]);
            if (scaleX0 == 0) {
                scaleZ = 1.0f;
                scaleX = 1.0f;
            } else if (scaleX0 <= 0) {
                scaleZ = 1.0f;
                scaleX = static_cast<float>(-scaleX0) / 1024.0f;
            } else {
                scaleX = 1.0f;
                scaleZ = static_cast<float>(scaleX0) / 1024.0f;
            }
        } else if (type == 2) {
            // TS parity: allow division by zero to yield +/-inf (JS semantics).
            scaleX = 64.0f / static_cast<float>(model.textureScaleX[i]);
            scaleY = 64.0f / static_cast<float>(model.textureScaleY[i]);
            scaleZ = 64.0f / static_cast<float>(model.textureScaleZ[i]);
        } else {
            scaleX = static_cast<float>(model.textureScaleX[i]) / 1024.0f;
            scaleY = static_cast<float>(model.textureScaleY[i]) / 1024.0f;
            scaleZ = static_cast<float>(model.textureScaleZ[i]) / 1024.0f;
        }
        const i32 p = static_cast<i32>(model.textureMappingP[i]);
        const i32 m = static_cast<i32>(model.textureMappingM[i]);
        const i32 n = static_cast<i32>(model.textureMappingN[i]);
        const i32 rot = static_cast<i32>(model.textureRotation[i]) & 0xff;
        buildTextureTransformMatrix(p, m, n, rot, scaleX, scaleY, scaleZ, &out->matrices9[i * 9]);
    }

    out->ready = true;
    (void)alloc;
    return Status::Ok;
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

// TS createSdTexturePacking slices to 2047 entries, so packed indices are 0..2046.
// Keep this aligned to TS so "packable" textures match exactly across caches with >2k textures.
static constexpr i32 RS_SD_TEXTURE_PACK_LIMIT = 2047;

static bool isTextureSd(
    Span<const i32> textureSdIds,
    i32 textureId) noexcept {
    if (textureId < 0) {
        return false;
    }
    return findTypeBlobIndex(textureSdIds, textureId) >= 0;
}

i32 mapTextureIdToPackedIndex(Span<const i32> textureIds, i32 textureId) noexcept {
    if (textureId < 0) {
        return -1;
    }
    const i32 index = findTypeBlobIndex(textureIds, textureId);
    if (index < 0) {
        return -1;
    }
    // Packed texture indices match TS: 0-based index into the cache's SD texture list, truncated to 2048.
    // Indices beyond the pack limit must be treated as "untextured" so vertex packing/shaders stay consistent.
    return index < RS_SD_TEXTURE_PACK_LIMIT ? index : -1;
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
    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 10, underlayId, &bytes);
    if (!ok(bs) || bytes.size() <= 0) {
        if (input.debugRecordMissingType) {
            input.debugRecordMissingType(input.debugMissingTypeCtx, 10, underlayId);
        }
        return Status::NotFound;
    }
    DecodedUnderlayTypeCache::Entry entry{};
    entry.id = underlayId;
    CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<GameType>(input.cacheGame);
    cacheInfo.revision = input.cacheRevision;
    entry.value = UnderlayFloorType(underlayId, cacheInfo);
    const auto decodeFloLikeIntoUnderlay = [&]() -> Status {
        OverlayFloorType floLike(underlayId, cacheInfo);
        Uint8ArrayReader floReader(
            bytes,
            0);
        TypeDecodeError floErr{};
        TypeDecodeContext floCtx{cacheInfo, nullptr, &alloc};
        const Status floStatus = decodeType(floLike, floReader, &floErr, &floCtx);
        if (!ok(floStatus)) {
            return floStatus;
        }
        floLike.post();
        entry.value.rgbColor = floLike.primaryRgb;
        // TS blend path calls `getHueBlend()` on the shared flo loader, which maps to
        // OverlayFloorType.hueBlend (not hue).
        entry.value.hue = floLike.hueBlend;
        entry.value.saturation = floLike.saturation;
        entry.value.lightness = floLike.lightness;
        entry.value.hueMultiplier = floLike.hueMultiplier;
        entry.value.textureId = floLike.textureId;
        entry.value.textureSize = floLike.textureSize;
        entry.value.blockShadow = floLike.blockShadow;
        return Status::Ok;
    };

    const CacheType cacheType = detectCacheType(cacheInfo);
    if (cacheType == CacheType::Dat2) {
        Uint8ArrayReader reader(
            bytes,
            0);
        TypeDecodeError err{};
        TypeDecodeContext ctx{entry.value.cacheInfo, nullptr, &alloc};
        const Status ds = decodeType(entry.value, reader, &err, &ctx);
        if (!ok(ds)) {
            // Keep fallback for mixed/invalid inputs.
            const Status floStatus = decodeFloLikeIntoUnderlay();
            if (!ok(floStatus)) {
                return ds;
            }
        } else {
            entry.value.post();
        }
    } else {
        // TS dat/legacy loader behavior: underlay uses the shared flo decoder.
        const Status floStatus = decodeFloLikeIntoUnderlay();
        if (!ok(floStatus)) {
            return floStatus;
        }
    }
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
    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 11, overlayId, &bytes);
    if (!ok(bs) || bytes.size() <= 0) {
        if (input.debugRecordMissingType) {
            input.debugRecordMissingType(input.debugMissingTypeCtx, 11, overlayId);
        }
        return Status::NotFound;
    }
    DecodedOverlayTypeCache::Entry entry{};
    entry.id = overlayId;
    CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<GameType>(input.cacheGame);
    cacheInfo.revision = input.cacheRevision;
    entry.value = OverlayFloorType(overlayId, cacheInfo);
    Uint8ArrayReader reader(
        bytes,
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

    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 12, objTypeId, &bytes);
    if (!ok(bs) || bytes.size() <= 0) {
        if (input.debugRecordMissingType) {
            input.debugRecordMissingType(input.debugMissingTypeCtx, 12, objTypeId);
        }
        return Status::NotFound;
    }

    ObjType decoded(objTypeId, cache->cacheInfo);
    Uint8ArrayReader reader(
        bytes,
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

    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 1, locTypeId, &bytes);
    if (!ok(bs) || bytes.size() <= 0) {
        if (input.debugRecordMissingType) {
            input.debugRecordMissingType(input.debugMissingTypeCtx, 1, locTypeId);
        }
        return Status::NotFound;
    }

    LocType decoded(locTypeId, cache->cacheInfo);
    Uint8ArrayReader reader(
        bytes,
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

    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 2, varbitId, &bytes);
    if (!ok(bs) || bytes.size() <= 0) {
        if (input.debugRecordMissingType) {
            input.debugRecordMissingType(input.debugMissingTypeCtx, 2, varbitId);
        }
        return Status::NotFound;
    }

    VarBitType decoded(varbitId, cache->cacheInfo);
    Uint8ArrayReader reader(
        bytes,
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

    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 5, seqTypeId, &bytes);
    if (!ok(bs) || bytes.size() <= 0) {
        if (input.debugRecordMissingType) {
            input.debugRecordMissingType(input.debugMissingTypeCtx, 5, seqTypeId);
        }
        return Status::NotFound;
    }

    SeqType decoded(seqTypeId, cache->cacheInfo);
    Uint8ArrayReader reader(
        bytes,
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
    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 14, seqTypeId, &bytes);
    if (!ok(bs) || bytes.size() <= 0) {
        return false;
    }
    *outHasAlpha = bytes[0] != 0;
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

// TS parity: ModelData.merge allocates vertex arrays to a fixed length (sum of input vertex counts),
// then dedupes by writing only the first verticesCount entries and leaving the rest as 0. TS model
// hashing includes the full array length, so for merged models we must pad with zeros for hashing.
static void xxh32UpdateI32VecWithTsPadding(
    XXH32_state_t* state,
    const Vec<i32>& values,
    i32 tsAllocCount) noexcept {
    if (!state) {
        return;
    }
    const std::size_t n = values.size();
    std::size_t target = n;
    if (tsAllocCount > 0) {
        const std::size_t t = static_cast<std::size_t>(tsAllocCount);
        if (t > target) {
            target = t;
        }
    }
    if (target == 0) {
        return;
    }
    const std::size_t use = target < n ? target : n;
    if (use > 0) {
        XXH32_update(state, values.data(), use * sizeof(i32));
    }
    if (target > n) {
        std::size_t remaining = target - n;
        // Chunked zero padding to avoid large stack buffers.
        static constexpr std::size_t kChunkI32 = 64;
        i32 zeros[kChunkI32]{};
        while (remaining > 0) {
            const std::size_t chunk = remaining < kChunkI32 ? remaining : kChunkI32;
            XXH32_update(state, zeros, chunk * sizeof(i32));
            remaining -= chunk;
        }
    }
}

// TS parity: ModelData.light() filters faceTextures to "SD-only" before lighting and before model hashing.
// In TS this is `textureId !== -1 && textureLoader.isSd(textureId)` else texture=-1.
// Here, `input.textureIds` is the runtime SD texture id list; anything not present must be treated as -1.
static inline i32 filterSdTextureId(const SceneCommandBuildInput& input, i32 textureId) noexcept {
    if (textureId < 0) {
        return -1;
    }
    // TS parity: SD filtering is independent of packed index truncation; textures beyond the pack
    // limit still remain "textured" (textureId != -1) but pack as -1 later.
    return isTextureSd(input.textureIds, textureId) ? textureId : -1;
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

        // TS parity: "textured" depends on SD-availability filtering (see filterSdTextureId()).
        const i32 textureId = filterSdTextureId(input, rawTextureId);
        const bool hasTexture = isTextureSd(input.textureIds, textureId);

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
    xxh32UpdateI32VecWithTsPadding(state, model.verticesX, model.tsVerticesAllocCount);
    xxh32UpdateI32VecWithTsPadding(state, model.verticesY, model.tsVerticesAllocCount);
    xxh32UpdateI32VecWithTsPadding(state, model.verticesZ, model.tsVerticesAllocCount);
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

        const i32 textureId = filterSdTextureId(input, rawTextureId);
        const bool hasTexture = isTextureSd(input.textureIds, textureId);

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
    xxh32UpdateI32VecWithTsPadding(state, model.verticesX, model.tsVerticesAllocCount);
    xxh32UpdateI32VecWithTsPadding(state, model.verticesY, model.tsVerticesAllocCount);
    xxh32UpdateI32VecWithTsPadding(state, model.verticesZ, model.tsVerticesAllocCount);
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

    // TS parity: merge all model IDs for this loc variant before applying post-merge mutations and
    // lighting/hash. This matches LocModelLoader.getLocModelData + ModelData.light + getModelHash.
    Vec<ModelData> decodedModels(alloc);
    auto rrReserve = decodedModels.reserve(modelIds.size());
    if (!rrReserve.isOk()) {
        return rrReserve.status();
    }
    for (std::size_t mi = 0; mi < modelIds.size(); mi++) {
        ModelData model(alloc);
        const Status ds = tryDecodeModelDataById(input, modelIds[mi], &model, alloc);
        if (!ok(ds)) {
            return ds;
        }
        applyLocModelMirrorForPlacement(&model, locType, placementType, rotation);
        auto rrPush = decodedModels.pushBack(rs::move(model));
        if (!rrPush.isOk()) {
            return rrPush.status();
        }
    }
    if (decodedModels.empty()) {
        return Status::NotFound;
    }

    if (decodedModels.size() > 1) {
        ModelData merged(alloc);
        const Status ms = mergeModelDataTS(
            Span<const ModelData>(decodedModels.data(), decodedModels.size()),
            static_cast<i32>(decodedModels.size()),
            &merged,
            alloc);
        if (!ok(ms)) {
            return ms;
        }
        decodedModels.clear();
        auto rrMerged = decodedModels.pushBack(rs::move(merged));
        if (!rrMerged.isOk()) {
            return rrMerged.status();
        }
    }

    applyLocModelPostMergeMutationsForPlacement(
        &decodedModels[0],
        locType,
        placementType,
        rotation,
        /*applyDiagonalNormalVariantRotation=*/true);

    return computeLitModelHashForGrouping(
        input,
        decodedModels[0],
        ambient,
        contrast,
        placementType,
        rotation,
        &locType,
        nullptr,
        outHash,
        alloc);
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

    ModelData model(alloc);
    const Status ds = tryDecodeModelDataById(input, modelId, &model, alloc);
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

    // TS parity: match src/runtime/build/SceneBuffer.ts getModelFaces() + isModelFaceTransparentById().
    for (i32 fi = 0; fi < model.faceCount; fi++) {
        if (fi < 0 ||
            fi >= static_cast<i32>(model.faceColors.size())) {
            // Defensive: malformed model.
            continue;
        }
        const i32 hslC = model.faceColors[static_cast<std::size_t>(fi)];
        if (hslC == -2) {
            continue;
        }

        const i32 textureId = modelFaceRawTextureId(model, fi);
        i32 alpha = 0xff;
        if (textureId == -1 &&
            model.hasFaceAlphas &&
            fi >= 0 &&
            fi < static_cast<i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(fi)]) & 0xff);
        }
        if (alpha == 0 || alpha == 1) {
            continue;
        }

        const bool isTransparent =
            (alpha < 0xff) ||
            (textureId != -1 && isTextureTransparent(input.textureTransparentIds, textureId));
        if (isTransparent) {
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

    ModelData model(alloc);
    const Status ds = tryDecodeModelDataById(input, modelId, &model, alloc);
    if (!ok(ds)) {
        return ds;
    }
    applyObjModelMutations(&model, objType);

    ModelFaceStats stats{};
    // TS parity: match src/runtime/build/SceneBuffer.ts getModelFaces() + isModelFaceTransparentById().
    for (i32 fi = 0; fi < model.faceCount; fi++) {
        if (fi < 0 ||
            fi >= static_cast<i32>(model.faceColors.size())) {
            continue;
        }
        const i32 hslC = model.faceColors[static_cast<std::size_t>(fi)];
        if (hslC == -2) {
            continue;
        }

        const i32 textureId = modelFaceRawTextureId(model, fi);
        i32 alpha = 0xff;
        if (textureId == -1 &&
            model.hasFaceAlphas &&
            fi < static_cast<i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(fi)]) & 0xff);
        }
        if (alpha == 0 || alpha == 1) {
            continue;
        }

        const bool isTransparent =
            (alpha < 0xff) ||
            (textureId != -1 && isTextureTransparent(input.textureTransparentIds, textureId));
        if (isTransparent) {
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
    ModelData model(alloc);
    const Status ds = tryDecodeModelDataById(input, modelId, &model, alloc);
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
    ModelData model(alloc);
    const Status ds = tryDecodeModelDataById(input, modelId, &model, alloc);
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

    const i32 renderX = scenePxX;
    const i32 renderZ = scenePxZ;
    const i32 contourX = contourPxX;
    const i32 contourZ = contourPxZ;

    const auto decodeModelRawById = [&](i32 modelId, ModelData* outModel) noexcept -> Status {
        return tryDecodeModelDataById(input, modelId, outModel, alloc);
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
                auto maybeRecordWorldHeightProbe = [&](i32 level,
                                                       i32 worldX,
                                                       i32 worldZ,
                                                       i32 outX,
                                                       i32 outZ,
                                                       i32 baseY) noexcept {
                    if (!debugOut || debugOut->debugWorldHeightProbeHit != 0) {
                        return;
                    }
                    if (debugOut->debugWorldHeightProbeLevel < 0) {
                        return;
                    }
                    if (level != debugOut->debugWorldHeightProbeLevel) {
                        return;
                    }
                    const i32 probeX = debugOut->debugWorldHeightProbeWorldX;
                    const i32 probeZ = debugOut->debugWorldHeightProbeWorldZ;
                    const bool firstSampleMode = probeX == -1 && probeZ == -1;
                    if (!firstSampleMode) {
                        const bool matchSample = worldX == probeX && worldZ == probeZ;
                        const bool matchOutput = outX == probeX && outZ == probeZ;
                        if (!matchSample && !matchOutput) {
                            return;
                        }
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

                for (std::size_t vi = 0; vi < modelVerticesY->size(); vi++) {
                    const i32 baseY = model.verticesY[vi];
                    const i32 worldX = contourX + model.verticesX[vi];
                    const i32 worldZ = contourZ + model.verticesZ[vi];
                    const i32 outX = renderX + model.verticesX[vi];
                    const i32 outZ = renderZ + model.verticesZ[vi];

                    i32 h = 0;
                    i32 hAbove = 0;
                    const bool hasH = sampleSceneHeightAtWorld(scene, placement.level, worldX, worldZ, &h);
                    maybeRecordWorldHeightProbe(placement.level, worldX, worldZ, outX, outZ, baseY);
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
                                // TS parity:
                                //   contourVerticesY[i] = toI32(baseY + numer/param)
                                // and the final ToInt32 truncates toward zero *after* adding the fractional part.
                                // Doing `baseY + (numer/param)` in integer math truncates too early for negative
                                // baseY, causing off-by-one (e.g. -71 + 0.68 -> -70 in TS but -71 here).
                                const i64 numer =
                                    static_cast<i64>(h - sceneHeight) *
                                    static_cast<i64>(contourParam - yRatio);
                                const i64 totalNumer =
                                    static_cast<i64>(baseY) * static_cast<i64>(contourParam) + numer;
                                outY = static_cast<i32>(totalNumer / static_cast<i64>(contourParam));
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
	        ModelTextureScales texScales(alloc);
	        const Status tss = computeModelTextureScales(model, &texScales, alloc);
	        // UV mapping is best-effort; if scale computation fails, fall back to type0 UVs only.
	        if (!ok(tss)) {
	            texScales.ready = false;
	        }

	        for (i32 fi = 0; fi < model.faceCount; fi++) {
	            i32 faceType = modelFaceRenderType(model, fi);
	            i32 textureId = modelFaceRawTextureId(model, fi);
	            const i32 rawAlphaSigned = modelFaceRawAlpha(model, fi);
	            // TS parity: ModelData.light() treats faceAlphas -2/-1 as renderType overrides.
	            if (rawAlphaSigned == -2) {
	                faceType = 3;
	            } else if (rawAlphaSigned == -1) {
	                faceType = 2;
	            }

	            const bool hasTexture = isTextureSd(input.textureIds, textureId);
            i32 packedTextureId = hasTexture ? mapTextureIdToPackedIndex(input.textureIds, textureId) : -1;
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
                } else if (texScales.ready && texCoord != -1) {
                    const i32 tc = texCoord & 0xff;
                    if (tc >= 0 && tc < model.textureFaceCount) {
                        const std::size_t sti = static_cast<std::size_t>(tc);
                        const i32 centerX = texScales.centerX[sti];
                        const i32 centerY = texScales.centerY[sti];
                        const i32 centerZ = texScales.centerZ[sti];
                        const float* transform = &texScales.matrices9[sti * 9];
                        const i32 direction = static_cast<i32>(model.textureDirection[sti]);
                        const float speed = static_cast<float>(model.textureSpeed[sti]) / 256.0f;
                        if (textureRenderType == 1) {
                            const float scaleZ =
                                static_cast<float>(model.textureScaleZ[sti]) / 1024.0f;
                            computeCylindricalUv(
                                model.verticesX[static_cast<std::size_t>(ia)],
                                model.verticesY[static_cast<std::size_t>(ia)],
                                model.verticesZ[static_cast<std::size_t>(ia)],
                                centerX,
                                centerY,
                                centerZ,
                                transform,
                                scaleZ,
                                direction,
                                speed,
                                &u0,
                                &v0);
                            computeCylindricalUv(
                                model.verticesX[static_cast<std::size_t>(ib)],
                                model.verticesY[static_cast<std::size_t>(ib)],
                                model.verticesZ[static_cast<std::size_t>(ib)],
                                centerX,
                                centerY,
                                centerZ,
                                transform,
                                scaleZ,
                                direction,
                                speed,
                                &u1,
                                &v1);
                            computeCylindricalUv(
                                model.verticesX[static_cast<std::size_t>(ic)],
                                model.verticesY[static_cast<std::size_t>(ic)],
                                model.verticesZ[static_cast<std::size_t>(ic)],
                                centerX,
                                centerY,
                                centerZ,
                                transform,
                                scaleZ,
                                direction,
                                speed,
                                &u2,
                                &v2);
                            const float scaleZHalf = scaleZ / 2.0f;
                            if ((direction & 0x1) == 0) {
                                if (u1 - u0 > scaleZHalf) u1 -= scaleZ;
                                else if (u0 - u1 > scaleZHalf) u1 += scaleZ;
                                if (u2 - u0 > scaleZHalf) u2 -= scaleZ;
                                else if (u0 - u2 > scaleZHalf) u2 += scaleZ;
                            } else {
                                if (v1 - v0 > scaleZHalf) v1 -= scaleZ;
                                else if (v0 - v1 > scaleZHalf) v1 += scaleZ;
                                if (v2 - v0 > scaleZHalf) v2 -= scaleZ;
                                else if (v0 - v2 > scaleZHalf) v2 += scaleZ;
                            }
                        } else if (textureRenderType == 2) {
                            const double uOffset =
                                model.textureTransU.size() > sti
                                    ? static_cast<double>(model.textureTransU[sti]) / 256.0
                                    : 0.0;
                            const double vOffset =
                                model.textureTransV.size() > sti
                                    ? static_cast<double>(model.textureTransV[sti]) / 256.0
                                    : 0.0;
                            const i32 dx1 =
                                model.verticesX[static_cast<std::size_t>(ib)] -
                                model.verticesX[static_cast<std::size_t>(ia)];
                            const i32 dy1 =
                                model.verticesY[static_cast<std::size_t>(ib)] -
                                model.verticesY[static_cast<std::size_t>(ia)];
                            const i32 dz1 =
                                model.verticesZ[static_cast<std::size_t>(ib)] -
                                model.verticesZ[static_cast<std::size_t>(ia)];
                            const i32 dx2 =
                                model.verticesX[static_cast<std::size_t>(ic)] -
                                model.verticesX[static_cast<std::size_t>(ia)];
                            const i32 dy2 =
                                model.verticesY[static_cast<std::size_t>(ic)] -
                                model.verticesY[static_cast<std::size_t>(ia)];
                            const i32 dz2 =
                                model.verticesZ[static_cast<std::size_t>(ic)] -
                                model.verticesZ[static_cast<std::size_t>(ia)];
                            // TS parity: do these products in 64-bit (JS doesn't overflow i32 here).
                            const i64 vx64 =
                                static_cast<i64>(dy1) * static_cast<i64>(dz2) -
                                static_cast<i64>(dy2) * static_cast<i64>(dz1);
                            const i64 vy64 =
                                static_cast<i64>(dz1) * static_cast<i64>(dx2) -
                                static_cast<i64>(dz2) * static_cast<i64>(dx1);
                            const i64 vz64 =
                                static_cast<i64>(dx1) * static_cast<i64>(dy2) -
                                static_cast<i64>(dx2) * static_cast<i64>(dy1);
                            const double vx = static_cast<double>(vx64);
                            const double vy = static_cast<double>(vy64);
                            const double vz = static_cast<double>(vz64);
                            const double scaleX =
                                64.0 / static_cast<double>(model.textureScaleX[sti]);
                            const double scaleY =
                                64.0 / static_cast<double>(model.textureScaleY[sti]);
                            const double scaleZ =
                                64.0 / static_cast<double>(model.textureScaleZ[sti]);
                            const double t0 = static_cast<double>(transform[0]);
                            const double t1 = static_cast<double>(transform[1]);
                            const double t2 = static_cast<double>(transform[2]);
                            const double t3 = static_cast<double>(transform[3]);
                            const double t4 = static_cast<double>(transform[4]);
                            const double t5 = static_cast<double>(transform[5]);
                            const double t6 = static_cast<double>(transform[6]);
                            const double t7 = static_cast<double>(transform[7]);
                            const double t8 = static_cast<double>(transform[8]);
                            const double scaledNormalX =
                                (vx * t0 + vy * t1 + vz * t2) / scaleX;
                            const double scaledNormalY =
                                (vx * t3 + vy * t4 + vz * t5) / scaleY;
                            const double scaledNormalZ =
                                (vx * t6 + vy * t7 + vz * t8) / scaleZ;
                            const i32 cubeFace = getDominantAxisFace(
                                scaledNormalX,
                                scaledNormalY,
                                scaledNormalZ);
                            computeBoxProjectedUv(
                                model.verticesX[static_cast<std::size_t>(ia)],
                                model.verticesY[static_cast<std::size_t>(ia)],
                                model.verticesZ[static_cast<std::size_t>(ia)],
                                centerX,
                                centerY,
                                centerZ,
                                cubeFace,
                                transform,
                                direction,
                                speed,
                                static_cast<float>(uOffset),
                                static_cast<float>(vOffset),
                                &u0,
                                &v0);
                            computeBoxProjectedUv(
                                model.verticesX[static_cast<std::size_t>(ib)],
                                model.verticesY[static_cast<std::size_t>(ib)],
                                model.verticesZ[static_cast<std::size_t>(ib)],
                                centerX,
                                centerY,
                                centerZ,
                                cubeFace,
                                transform,
                                direction,
                                speed,
                                static_cast<float>(uOffset),
                                static_cast<float>(vOffset),
                                &u1,
                                &v1);
                            computeBoxProjectedUv(
                                model.verticesX[static_cast<std::size_t>(ic)],
                                model.verticesY[static_cast<std::size_t>(ic)],
                                model.verticesZ[static_cast<std::size_t>(ic)],
                                centerX,
                                centerY,
                                centerZ,
                                cubeFace,
                                transform,
                                direction,
                                speed,
                                static_cast<float>(uOffset),
                                static_cast<float>(vOffset),
                                &u2,
                                &v2);
                        } else if (textureRenderType == 3) {
                            computeSphericalUv(
                                model.verticesX[static_cast<std::size_t>(ia)],
                                model.verticesY[static_cast<std::size_t>(ia)],
                                model.verticesZ[static_cast<std::size_t>(ia)],
                                centerX,
                                centerY,
                                centerZ,
                                transform,
                                direction,
                                speed,
                                &u0,
                                &v0);
                            computeSphericalUv(
                                model.verticesX[static_cast<std::size_t>(ib)],
                                model.verticesY[static_cast<std::size_t>(ib)],
                                model.verticesZ[static_cast<std::size_t>(ib)],
                                centerX,
                                centerY,
                                centerZ,
                                transform,
                                direction,
                                speed,
                                &u1,
                                &v1);
                            computeSphericalUv(
                                model.verticesX[static_cast<std::size_t>(ic)],
                                model.verticesY[static_cast<std::size_t>(ic)],
                                model.verticesZ[static_cast<std::size_t>(ic)],
                                centerX,
                                centerY,
                                centerZ,
                                transform,
                                direction,
                                speed,
                                &u2,
                                &v2);
                            if ((direction & 0x1) == 0) {
                                if (u1 - u0 > 0.5f) u1 -= 1.0f;
                                else if (u0 - u1 > 0.0f) u1 += 1.0f;
                                if (u2 - u0 > 0.5f) u2 -= 1.0f;
                                else if (u0 - u2 > 0.5f) u2 += 1.0f;
                            } else {
                                if (v1 - v0 > 0.5f) v1 -= 1.0f;
                                else if (v0 - v1 > 0.5f) v1 += 1.0f;
                                if (v2 - v0 > 0.5f) v2 -= 1.0f;
                                else if (v0 - v2 > 0.5f) v2 += 1.0f;
                            }
                        }
                    }
                }
            }

            const i32 baseVertex = static_cast<i32>(outVertices->size() / 16);

            // Debug-only: allow probing by output vertex X/Z to capture the underlying model vertex,
            // whether contouring was applied, and the sampled height at the contour sample coordinate.
            auto maybeRecordVertexProbe = [&](i32 outX, i32 outZ, i32 vertexIndex) noexcept {
                if (!debugOut) {
                    return;
                }
                // Allow the vertex-probe (marker=2) to overwrite a prior height-probe (marker=1),
                // otherwise the contour sampling probe will always win and we can't debug the final
                // vertex packing state.
                if (debugOut->debugWorldHeightProbeHit == 2) {
                    return;
                }
                if (debugOut->debugWorldHeightProbeLevel < 0 ||
                    placement.level != debugOut->debugWorldHeightProbeLevel) {
                    return;
                }
                if (debugOut->debugWorldHeightProbeWorldX < 0 ||
                    debugOut->debugWorldHeightProbeWorldZ < 0) {
                    return;
                }
                if (outX != debugOut->debugWorldHeightProbeWorldX ||
                    outZ != debugOut->debugWorldHeightProbeWorldZ) {
                    return;
                }
                if (vertexIndex < 0 ||
                    vertexIndex >= static_cast<i32>(model.verticesY.size()) ||
                    vertexIndex >= static_cast<i32>(model.verticesX.size()) ||
                    vertexIndex >= static_cast<i32>(model.verticesZ.size()) ||
                    vertexIndex >= static_cast<i32>(modelVerticesY->size())) {
                    return;
                }

                const i32 baseY = model.verticesY[static_cast<std::size_t>(vertexIndex)];
                const i32 usedY = (*modelVerticesY)[static_cast<std::size_t>(vertexIndex)];
                const i32 outY = sceneHeight + usedY;

                const i32 sampleX = contourX + model.verticesX[static_cast<std::size_t>(vertexIndex)];
                const i32 sampleZ = contourZ + model.verticesZ[static_cast<std::size_t>(vertexIndex)];
                i32 sampledH = 0;
                const bool okH = sampleSceneHeightAtWorld(scene, placement.level, sampleX, sampleZ, &sampledH);

                debugOut->debugWorldHeightProbeHit = 2; // "vertex probe hit"
                debugOut->debugWorldHeightProbeLevel = placement.level;
                debugOut->debugWorldHeightProbeWorldX = outX;
                debugOut->debugWorldHeightProbeWorldZ = outZ;

                debugOut->debugWorldHeightProbePacked[0] = 2;
                debugOut->debugWorldHeightProbePacked[1] = vertexIndex;
                debugOut->debugWorldHeightProbePacked[2] = model.verticesX[static_cast<std::size_t>(vertexIndex)];
                debugOut->debugWorldHeightProbePacked[3] = baseY;
                debugOut->debugWorldHeightProbePacked[4] = model.verticesZ[static_cast<std::size_t>(vertexIndex)];
                debugOut->debugWorldHeightProbePacked[5] = usedY;
                debugOut->debugWorldHeightProbePacked[6] = sceneHeight;
                debugOut->debugWorldHeightProbePacked[7] = outY;
                debugOut->debugWorldHeightProbePacked[8] = contourX;
                debugOut->debugWorldHeightProbePacked[9] = contourZ;
                debugOut->debugWorldHeightProbePacked[10] = sampleX;
                debugOut->debugWorldHeightProbePacked[11] = sampleZ;
                debugOut->debugWorldHeightProbePacked[12] = okH ? 1 : 0;
                debugOut->debugWorldHeightProbePacked[13] = sampledH;
                debugOut->debugWorldHeightProbePacked[14] = modelIds.empty() ? -1 : modelIds[0];
                debugOut->debugWorldHeightProbePacked[15] = (modelVerticesY != &model.verticesY) ? 1 : 0;
            };

            const i32 outXa = renderX + model.verticesX[static_cast<std::size_t>(ia)];
            const i32 outZa = renderZ + model.verticesZ[static_cast<std::size_t>(ia)];
            maybeRecordVertexProbe(outXa, outZa, ia);
            Status vs = appendPackedVertex(
                outVertices,
                outXa,
                sceneHeight + (*modelVerticesY)[static_cast<std::size_t>(ia)],
                outZa,
                hslA,
                alpha,
                u0,
                v0,
                priority + 1,
                packedTextureId);
            if (!ok(vs)) return vs;
            const i32 outXb = renderX + model.verticesX[static_cast<std::size_t>(ib)];
            const i32 outZb = renderZ + model.verticesZ[static_cast<std::size_t>(ib)];
            maybeRecordVertexProbe(outXb, outZb, ib);
            vs = appendPackedVertex(
                outVertices,
                outXb,
                sceneHeight + (*modelVerticesY)[static_cast<std::size_t>(ib)],
                outZb,
                hslB,
                alpha,
                u1,
                v1,
                priority + 1,
                packedTextureId);
            if (!ok(vs)) return vs;
            const i32 outXc = renderX + model.verticesX[static_cast<std::size_t>(ic)];
            const i32 outZc = renderZ + model.verticesZ[static_cast<std::size_t>(ic)];
            maybeRecordVertexProbe(outXc, outZc, ic);
            vs = appendPackedVertex(
                outVertices,
                outXc,
                sceneHeight + (*modelVerticesY)[static_cast<std::size_t>(ic)],
                outZc,
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

    struct TextureLookupCacheEntry final {
        i32 textureId = -1;
        i32 packedTextureId = -1;
        u8 hasTexture = 0;
        u8 textureAlpha = 0;
    };
    constexpr i32 kTextureLookupCacheCapacity = 64;
    TextureLookupCacheEntry textureLookupCache[kTextureLookupCacheCapacity];
    i32 textureLookupCount = 0;
    const auto resolveTextureLookup =
        [&](i32 textureId, bool* outHasTexture, bool* outTextureAlpha, i32* outPackedTextureId) noexcept -> Status {
            if (!outHasTexture || !outTextureAlpha || !outPackedTextureId) {
                return Status::InvalidArgument;
            }
            if (textureId < 0) {
                *outHasTexture = false;
                *outTextureAlpha = false;
                *outPackedTextureId = -1;
                return Status::Ok;
            }
            for (i32 i = 0; i < textureLookupCount; i++) {
                const TextureLookupCacheEntry& e = textureLookupCache[static_cast<std::size_t>(i)];
                if (e.textureId == textureId) {
                    *outHasTexture = e.hasTexture != 0;
                    *outTextureAlpha = e.textureAlpha != 0;
                    *outPackedTextureId = e.packedTextureId;
                    return Status::Ok;
                }
            }

            const i32 sdIndex = findTypeBlobIndex(input.textureIds, textureId);
            const bool hasTexture = sdIndex >= 0;
            const i32 packedTextureId =
                hasTexture && sdIndex < RS_SD_TEXTURE_PACK_LIMIT ? sdIndex : -1;
            const bool textureAlpha =
                hasTexture &&
                findTypeBlobIndex(input.textureTransparentIds, textureId) >= 0;

            if (textureLookupCount < kTextureLookupCacheCapacity) {
                TextureLookupCacheEntry& entry =
                    textureLookupCache[static_cast<std::size_t>(textureLookupCount++)];
                entry.textureId = textureId;
                entry.packedTextureId = packedTextureId;
                entry.hasTexture = static_cast<u8>(hasTexture ? 1 : 0);
                entry.textureAlpha = static_cast<u8>(textureAlpha ? 1 : 0);
            }

            *outHasTexture = hasTexture;
            *outTextureAlpha = textureAlpha;
            *outPackedTextureId = packedTextureId;
            return Status::Ok;
        };

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
                        // See contourType==2 comment above (must truncate after the add, not before).
                        const i64 numer =
                            static_cast<i64>(h - sceneHeight) *
                            static_cast<i64>(contourParam - yRatio);
                        const i64 totalNumer =
                            static_cast<i64>(baseY) * static_cast<i64>(contourParam) + numer;
                        outY = static_cast<i32>(totalNumer / static_cast<i64>(contourParam));
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

    bool needsAdvancedTextureScales = false;
    if (model.textureFaceCount > 0 &&
        model.hasTextureCoords &&
        model.hasFaceTextures &&
        !model.faceTextures.empty() &&
        !model.textureRenderTypes.empty()) {
        for (i32 fi = 0; fi < model.faceCount; fi++) {
            const i32 textureId = modelFaceRawTextureId(model, fi);
            bool hasTexture = false;
            bool textureAlpha = false;
            i32 packedTextureId = -1;
            const Status rs = resolveTextureLookup(
                textureId,
                &hasTexture,
                &textureAlpha,
                &packedTextureId);
            if (!ok(rs)) {
                return rs;
            }
            (void)textureAlpha;
            (void)packedTextureId;
            if (!hasTexture) {
                continue;
            }
            i32 texCoord = -1;
            if (fi >= 0 &&
                model.hasTextureCoords &&
                fi < static_cast<i32>(model.textureCoords.size())) {
                texCoord = static_cast<i32>(model.textureCoords[static_cast<std::size_t>(fi)]);
            }
            if (texCoord == -1) {
                continue;
            }
            const i32 tc = texCoord & 0xff;
            if (tc < 0 || tc >= static_cast<i32>(model.textureRenderTypes.size())) {
                continue;
            }
            const i32 textureRenderType =
                static_cast<i32>(model.textureRenderTypes[static_cast<std::size_t>(tc)]) & 0xff;
            if (textureRenderType != 0) {
                needsAdvancedTextureScales = true;
                break;
            }
        }
    }

    ModelTextureScales texScales(alloc);
    if (needsAdvancedTextureScales) {
        const Status tss = computeModelTextureScales(model, &texScales, alloc);
        // UV mapping is best-effort; if scale computation fails, fall back to type0 UVs only.
        if (!ok(tss)) {
            texScales.ready = false;
        }
    }

	    for (i32 fi = 0; fi < model.faceCount; fi++) {
	        i32 faceType = modelFaceRenderType(model, fi);
	        i32 textureId = modelFaceRawTextureId(model, fi);
	        const i32 rawAlphaSigned = modelFaceRawAlpha(model, fi);
	        // TS parity: ModelData.light() treats faceAlphas -2/-1 as renderType overrides.
	        if (rawAlphaSigned == -2) {
	            faceType = 3;
	        } else if (rawAlphaSigned == -1) {
	            faceType = 2;
	        }

            bool hasTexture = false;
            bool textureAlpha = false;
            i32 packedTextureId = -1;
            const Status rs = resolveTextureLookup(
                textureId,
                &hasTexture,
                &textureAlpha,
                &packedTextureId);
            if (!ok(rs)) {
                return rs;
            }

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
            } else if (texScales.ready && texCoord != -1) {
                const i32 tc = texCoord & 0xff;
                if (tc >= 0 && tc < model.textureFaceCount) {
                    const std::size_t sti = static_cast<std::size_t>(tc);
                    const i32 centerX = texScales.centerX[sti];
                    const i32 centerY = texScales.centerY[sti];
                    const i32 centerZ = texScales.centerZ[sti];
                    const float* transform = &texScales.matrices9[sti * 9];
                    const i32 direction = static_cast<i32>(model.textureDirection[sti]);
                    const float speed = static_cast<float>(model.textureSpeed[sti]) / 256.0f;
                    if (textureRenderType == 1) {
                        const float scaleZ =
                            static_cast<float>(model.textureScaleZ[sti]) / 1024.0f;
                        computeCylindricalUv(
                            model.verticesX[static_cast<std::size_t>(ia)],
                            model.verticesY[static_cast<std::size_t>(ia)],
                            model.verticesZ[static_cast<std::size_t>(ia)],
                            centerX,
                            centerY,
                            centerZ,
                            transform,
                            scaleZ,
                            direction,
                            speed,
                            &u0,
                            &v0);
                        computeCylindricalUv(
                            model.verticesX[static_cast<std::size_t>(ib)],
                            model.verticesY[static_cast<std::size_t>(ib)],
                            model.verticesZ[static_cast<std::size_t>(ib)],
                            centerX,
                            centerY,
                            centerZ,
                            transform,
                            scaleZ,
                            direction,
                            speed,
                            &u1,
                            &v1);
                        computeCylindricalUv(
                            model.verticesX[static_cast<std::size_t>(ic)],
                            model.verticesY[static_cast<std::size_t>(ic)],
                            model.verticesZ[static_cast<std::size_t>(ic)],
                            centerX,
                            centerY,
                            centerZ,
                            transform,
                            scaleZ,
                            direction,
                            speed,
                            &u2,
                            &v2);
                        const float scaleZHalf = scaleZ / 2.0f;
                        if ((direction & 0x1) == 0) {
                            if (u1 - u0 > scaleZHalf) u1 -= scaleZ;
                            else if (u0 - u1 > scaleZHalf) u1 += scaleZ;
                            if (u2 - u0 > scaleZHalf) u2 -= scaleZ;
                            else if (u0 - u2 > scaleZHalf) u2 += scaleZ;
                        } else {
                            if (v1 - v0 > scaleZHalf) v1 -= scaleZ;
                            else if (v0 - v1 > scaleZHalf) v1 += scaleZ;
                            if (v2 - v0 > scaleZHalf) v2 -= scaleZ;
                            else if (v0 - v2 > scaleZHalf) v2 += scaleZ;
                        }
                    } else if (textureRenderType == 2) {
                        const double uOffset =
                            model.textureTransU.size() > sti
                                ? static_cast<double>(model.textureTransU[sti]) / 256.0
                                : 0.0;
                        const double vOffset =
                            model.textureTransV.size() > sti
                                ? static_cast<double>(model.textureTransV[sti]) / 256.0
                                : 0.0;
                        const i32 dx1 =
                            model.verticesX[static_cast<std::size_t>(ib)] -
                            model.verticesX[static_cast<std::size_t>(ia)];
                        const i32 dy1 =
                            model.verticesY[static_cast<std::size_t>(ib)] -
                            model.verticesY[static_cast<std::size_t>(ia)];
                        const i32 dz1 =
                            model.verticesZ[static_cast<std::size_t>(ib)] -
                            model.verticesZ[static_cast<std::size_t>(ia)];
                        const i32 dx2 =
                            model.verticesX[static_cast<std::size_t>(ic)] -
                            model.verticesX[static_cast<std::size_t>(ia)];
                        const i32 dy2 =
                            model.verticesY[static_cast<std::size_t>(ic)] -
                            model.verticesY[static_cast<std::size_t>(ia)];
                        const i32 dz2 =
                            model.verticesZ[static_cast<std::size_t>(ic)] -
                            model.verticesZ[static_cast<std::size_t>(ia)];
                        // TS parity: do these products in 64-bit (JS doesn't overflow i32 here).
                        const i64 vx64 =
                            static_cast<i64>(dy1) * static_cast<i64>(dz2) -
                            static_cast<i64>(dy2) * static_cast<i64>(dz1);
                        const i64 vy64 =
                            static_cast<i64>(dz1) * static_cast<i64>(dx2) -
                            static_cast<i64>(dz2) * static_cast<i64>(dx1);
                        const i64 vz64 =
                            static_cast<i64>(dx1) * static_cast<i64>(dy2) -
                            static_cast<i64>(dx2) * static_cast<i64>(dy1);
                        const double vx = static_cast<double>(vx64);
                        const double vy = static_cast<double>(vy64);
                        const double vz = static_cast<double>(vz64);
                        const double scaleX =
                            64.0 / static_cast<double>(model.textureScaleX[sti]);
                        const double scaleY =
                            64.0 / static_cast<double>(model.textureScaleY[sti]);
                        const double scaleZ =
                            64.0 / static_cast<double>(model.textureScaleZ[sti]);
                        const double t0 = static_cast<double>(transform[0]);
                        const double t1 = static_cast<double>(transform[1]);
                        const double t2 = static_cast<double>(transform[2]);
                        const double t3 = static_cast<double>(transform[3]);
                        const double t4 = static_cast<double>(transform[4]);
                        const double t5 = static_cast<double>(transform[5]);
                        const double t6 = static_cast<double>(transform[6]);
                        const double t7 = static_cast<double>(transform[7]);
                        const double t8 = static_cast<double>(transform[8]);
                        const double scaledNormalX =
                            (vx * t0 + vy * t1 + vz * t2) / scaleX;
                        const double scaledNormalY =
                            (vx * t3 + vy * t4 + vz * t5) / scaleY;
                        const double scaledNormalZ =
                            (vx * t6 + vy * t7 + vz * t8) / scaleZ;
                        const i32 cubeFace = getDominantAxisFace(
                            scaledNormalX,
                            scaledNormalY,
                            scaledNormalZ);
                        computeBoxProjectedUv(
                            model.verticesX[static_cast<std::size_t>(ia)],
                            model.verticesY[static_cast<std::size_t>(ia)],
                            model.verticesZ[static_cast<std::size_t>(ia)],
                            centerX,
                            centerY,
                            centerZ,
                            cubeFace,
                            transform,
                            direction,
                            speed,
                            static_cast<float>(uOffset),
                            static_cast<float>(vOffset),
                            &u0,
                            &v0);
                        computeBoxProjectedUv(
                            model.verticesX[static_cast<std::size_t>(ib)],
                            model.verticesY[static_cast<std::size_t>(ib)],
                            model.verticesZ[static_cast<std::size_t>(ib)],
                            centerX,
                            centerY,
                            centerZ,
                            cubeFace,
                            transform,
                            direction,
                            speed,
                            static_cast<float>(uOffset),
                            static_cast<float>(vOffset),
                            &u1,
                            &v1);
                        computeBoxProjectedUv(
                            model.verticesX[static_cast<std::size_t>(ic)],
                            model.verticesY[static_cast<std::size_t>(ic)],
                            model.verticesZ[static_cast<std::size_t>(ic)],
                            centerX,
                            centerY,
                            centerZ,
                            cubeFace,
                            transform,
                            direction,
                            speed,
                            static_cast<float>(uOffset),
                            static_cast<float>(vOffset),
                            &u2,
                            &v2);
                    } else if (textureRenderType == 3) {
                        computeSphericalUv(
                            model.verticesX[static_cast<std::size_t>(ia)],
                            model.verticesY[static_cast<std::size_t>(ia)],
                            model.verticesZ[static_cast<std::size_t>(ia)],
                            centerX,
                            centerY,
                            centerZ,
                            transform,
                            direction,
                            speed,
                            &u0,
                            &v0);
                        computeSphericalUv(
                            model.verticesX[static_cast<std::size_t>(ib)],
                            model.verticesY[static_cast<std::size_t>(ib)],
                            model.verticesZ[static_cast<std::size_t>(ib)],
                            centerX,
                            centerY,
                            centerZ,
                            transform,
                            direction,
                            speed,
                            &u1,
                            &v1);
                        computeSphericalUv(
                            model.verticesX[static_cast<std::size_t>(ic)],
                            model.verticesY[static_cast<std::size_t>(ic)],
                            model.verticesZ[static_cast<std::size_t>(ic)],
                            centerX,
                            centerY,
                            centerZ,
                            transform,
                            direction,
                            speed,
                            &u2,
                            &v2);
                        if ((direction & 0x1) == 0) {
                            if (u1 - u0 > 0.5f) u1 -= 1.0f;
                            else if (u0 - u1 > 0.0f) u1 += 1.0f;
                            if (u2 - u0 > 0.5f) u2 -= 1.0f;
                            else if (u0 - u2 > 0.5f) u2 += 1.0f;
                        } else {
                            if (v1 - v0 > 0.5f) v1 -= 1.0f;
                            else if (v0 - v1 > 0.5f) v1 += 1.0f;
                            if (v2 - v0 > 0.5f) v2 -= 1.0f;
                            else if (v0 - v2 > 0.5f) v2 += 1.0f;
                        }
                    }
                }
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
		        // TS parity: ModelData.light() treats faceAlphas -2/-1 as renderType overrides.
		        if (rawAlphaSigned == -2) {
		            renderType = 3;
		        } else if (rawAlphaSigned == -1) {
		            renderType = 2;
		        }

		        const bool hasTexture = isTextureSd(input.textureIds, textureId);
	        i32 packedTextureId = hasTexture ? mapTextureIdToPackedIndex(input.textureIds, textureId) : -1;

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
    SceneLocAnimatedTickInit* outTickInit,
    SceneCommandBuildMode mode,
    Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    if (outTickInit) {
        outTickInit->clear();
    }
    i32 buildSetupUs = 0;
    i32 buildSceneBuildUs = 0;
    i32 buildTerrainUs = 0;
    i32 buildLocUs = 0;
    i32 buildObjUs = 0;
    i32 buildFinalizeUs = 0;
    const auto buildTotalStart = BuildClock::now();
    struct BuildTimingCommit final {
        SceneCommandStream* out = nullptr;
        const BuildClock::time_point* totalStart = nullptr;
        const i32* setupUs = nullptr;
        const i32* sceneBuildUs = nullptr;
        const i32* terrainUs = nullptr;
        const i32* locUs = nullptr;
        const i32* objUs = nullptr;
        const i32* finalizeUs = nullptr;

        ~BuildTimingCommit() {
            if (!out || !totalStart) {
                return;
            }
            out->debugBuildSetupUs = setupUs ? *setupUs : 0;
            out->debugBuildSceneBuildUs = sceneBuildUs ? *sceneBuildUs : 0;
            out->debugBuildTerrainUs = terrainUs ? *terrainUs : 0;
            out->debugBuildLocUs = locUs ? *locUs : 0;
            out->debugBuildObjUs = objUs ? *objUs : 0;
            out->debugBuildFinalizeUs = finalizeUs ? *finalizeUs : 0;
            out->debugBuildTotalUs = elapsedUs(*totalStart);
        }
    } buildTimingCommit{
        out,
        &buildTotalStart,
        &buildSetupUs,
        &buildSceneBuildUs,
        &buildTerrainUs,
        &buildLocUs,
        &buildObjUs,
        &buildFinalizeUs,
    };
    (void)buildTimingCommit;
    const auto setupStart = BuildClock::now();
    // `out` is allocated+cleared in buildSceneCommandStream(); keep this function phase-focused.
    const bool emitGeometry = mode == SceneCommandBuildMode::FullStream;

    bool hasLocPlacements = false;
    if (input.locLoadType == 0) {
        const Status hs = hasInBoundsLocPlacements(input, &hasLocPlacements, alloc);
        if (!ok(hs)) {
            return hs;
        }
        if (hasLocPlacements &&
            (input.tryGetTypeEntryBytes == nullptr)) {
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
            // TS Model.calculateBoundsCylinder() iterates `usedVertexCount`.
            const i32 vertexCount =
                model.usedVertexCount > 0 ? model.usedVertexCount : model.verticesCount;
            std::size_t count = 0;
            if (vertexCount > 0) {
                count = static_cast<std::size_t>(vertexCount);
            }
            if (count > model.verticesX.size()) {
                count = model.verticesX.size();
            }
            if (count > model.verticesZ.size()) {
                count = model.verticesZ.size();
            }
            for (std::size_t i = 0; i < count; i++) {
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

            // TS parity: LocModelLoader merges all model IDs for a loc variant before applying
            // post-merge mutations (rotate/resize/translate). This matters for XZ radius because
            // locType offsets can expand the final bounds relative to any single source model.
            Vec<ModelData> decodedModels(*alloc);
            auto rrReserve = decodedModels.reserve(refs.size());
            if (!rrReserve.isOk()) {
                return rrReserve.status();
            }
            for (std::size_t i = 0; i < refs.size(); i++) {
                ModelData model(*alloc);
                const Status s = tryDecodeModelDataById(*input, refs[i].modelId, &model, *alloc);
                if (!ok(s)) {
                    return s;
                }
                // Mirror per source model before merge (TS LocModelLoader.getLocModelData).
                applyLocModelMirrorForPlacement(&model, locType, refs[i].placementType, refs[i].rotation);
                auto rrPush = decodedModels.pushBack(rs::move(model));
                if (!rrPush.isOk()) {
                    return rrPush.status();
                }
            }

            if (decodedModels.empty()) {
                return Status::NotFound;
            }

            // Merge before applying placement-level mutations (TS parity).
            if (decodedModels.size() > 1) {
                ModelData merged(*alloc);
                const Status ms = mergeModelDataTS(
                    Span<const ModelData>(decodedModels.data(), decodedModels.size()),
                    static_cast<i32>(decodedModels.size()),
                    &merged,
                    *alloc);
                if (!ok(ms)) {
                    return ms;
                }
                decodedModels.clear();
                auto rrMerged = decodedModels.pushBack(rs::move(merged));
                if (!rrMerged.isOk()) {
                    return rrMerged.status();
                }
            }

            applyLocModelPostMergeMutationsForPlacement(
                &decodedModels[0],
                locType,
                variants[0].placementType,
                variants[0].rotation,
                /*applyDiagonalNormalVariantRotation=*/true);

            *outRadius = computeModelXzRadius(decodedModels[0]);
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

    buildSetupUs = elapsedUs(setupStart);

    const auto sceneBuildStart = BuildClock::now();
    SceneData scene{};
    const Status sceneStatus = buildSceneFromMapBytesProvider(
        services,
        bytesProvider,
        context,
        &scene,
        alloc);
    buildSceneBuildUs = elapsedUs(sceneBuildStart);
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

    const auto terrainStart = BuildClock::now();
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
    buildTerrainUs = elapsedUs(terrainStart);

    Vec<LocAnimatedGroupPlan> locAnimatedGroups(alloc);
    Vec<LocAnimatedPlaceholder> locAnimatedEntries(alloc);
    DecodedLocTypeCache locTypeCache(cacheInfo, alloc);
    DecodedVarBitTypeCache varbitTypeCache(cacheInfo, alloc);
    DecodedSeqTypeCache seqTypeCache(cacheInfo, alloc);
    DecodedModelFaceStatsCache modelFaceCache(alloc);

    const bool shouldEmitLocs =
        input.locLoadType == 0 && input.loadLocs && hasLocPlacements;
    const auto locStart = BuildClock::now();
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
    buildLocUs = elapsedUs(locStart);

    const auto objStart = BuildClock::now();
    if (input.loadObjs) {
        // Obj-spawn bytes are optional (runtime kind=13). If absent, obj commands are skipped.
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
    buildObjUs = elapsedUs(objStart);

    const auto finalizeStart = BuildClock::now();
    i32 finalizeAnimatedLocUs = 0;
    // TS buffer layout: animated loc frame geometry is appended after *all* static scene geometry
    // (locs + objs), and placeholders are appended after the frames.
    if (emitGeometry && shouldEmitLocs && (!locAnimatedGroups.empty() || !locAnimatedEntries.empty())) {
        const auto finalizeAnimatedLocStart = BuildClock::now();
        const Status as = scb::emitLocAnimatedFramesAndPlaceholdersFromPlannedGroups(
            input,
            scene,
            Span<const LocAnimatedGroupPlan>(locAnimatedGroups.data(), locAnimatedGroups.size()),
            Span<const LocAnimatedPlaceholder>(locAnimatedEntries.data(), locAnimatedEntries.size()),
            &buffer,
            &indexCount,
            &locTypeCache,
            &seqTypeCache,
            outTickInit,
            alloc);
        finalizeAnimatedLocUs = elapsedUs(finalizeAnimatedLocStart);
        if (!ok(as)) {
            return as;
        }
    }
    out->debugBuildFinalizeAnimatedLocUs = finalizeAnimatedLocUs;

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

    // Parity/debug: these "merged dummy" stats are compared against TS by scanning the final packed
    // command stream arrays. Keep them correct regardless of whether other expensive debug passes
    // are enabled.
    if (emitGeometry) {
        recomputeLocMergedDummyDebugStatsFromPackedCommands(out);
    }
    buildFinalizeUs = elapsedUs(finalizeStart);

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
    // Match TS render-data backend: force-merge all contoured-ground placements.
    out->forceMerge = resolved.contourGroundType > 0;
    // Match TS render-data backend: treat a placement as "entity-driven" when it has an active seq,
    // or when either the base or resolved type participates in transforms, or when we explicitly
    // requested a no-model build.
    out->sourceIsEntity =
        (seqId != -1) ||
        input.baseHadTransforms ||
        !resolved.transforms.empty() ||
        (input.locLoadType == 1);
    // Match TS: interact id is the original placement loc type id (pre-transform).
    out->interactId = input.placementId;
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
        input.mapSquareIds.size() != input.locLengths.size()) {
        return Status::SizeMismatch;
    }

    Status s = validateOffsetLengthPairs(
        input.terrainOffsets,
        input.terrainLengths,
        input.terrainBytes.size());
    if (!ok(s)) return s;
    s = validateOffsetLengthPairs(input.locOffsets, input.locLengths, input.locBytes.size());
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
    return scb::buildSceneCommandStreamFromBytesNoSeed(input, out, nullptr, mode, alloc);
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

Status buildSceneCommandStreamWithLocAnimatedTickInit(
    const SceneCommandBuildInput& input,
    SceneCommandStream* out,
    SceneLocAnimatedTickInit* outTickInit,
    Allocator& alloc) noexcept {
    if (!out || !outTickInit) {
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
    rr = outTickInit->init(alloc);
    if (!rr.isOk()) {
        return rr.status();
    }
    out->clear();
    outTickInit->clear();
    out->debugTerrainDigestSampleStartVertex =
        input.debugTerrainDigestSampleStartVertex > 0 ? input.debugTerrainDigestSampleStartVertex : 0;
    out->debugTerrainProbeLevel = input.debugTerrainProbeLevel;
    out->debugTerrainProbeTileX = input.debugTerrainProbeTileX;
    out->debugTerrainProbeTileY = input.debugTerrainProbeTileY;
    out->debugWorldHeightProbeLevel = input.debugWorldHeightProbeLevel;
    out->debugWorldHeightProbeWorldX = input.debugWorldHeightProbeWorldX;
    out->debugWorldHeightProbeWorldZ = input.debugWorldHeightProbeWorldZ;
    return scb::buildSceneCommandStreamFromBytesNoSeed(
        input,
        out,
        outTickInit,
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
