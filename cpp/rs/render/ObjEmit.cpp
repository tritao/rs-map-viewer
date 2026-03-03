#include "SceneCommandBuilderInternal.hpp"

#include "../config/floortype/OverlayFloorType.hpp"
#include "../config/floortype/UnderlayFloorType.hpp"
#include "../config/objtype/ObjType.hpp"
#include "../core/StrUtil.hpp"
#include "../map/TerrainConstants.hpp"
#include "../scene/SceneData.hpp"
#include "TerrainTileBuilder.hpp"
#include "TerrainTileSampler.hpp"

#include <new>

namespace rs {
namespace scb {

struct ObjSpawnRecord final {
    i32 id = -1;
    i32 count = 1;
    i32 x = 0;
    i32 y = 0;
    i32 plane = 0;
};

static Status readI32Le(Span<const u8> bytes, i32 off, i32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    if (off < 0 || off > static_cast<i32>(bytes.size()) - 4) {
        return Status::OutOfRange;
    }
    const u32 b0 = static_cast<u32>(bytes[static_cast<std::size_t>(off + 0)]);
    const u32 b1 = static_cast<u32>(bytes[static_cast<std::size_t>(off + 1)]);
    const u32 b2 = static_cast<u32>(bytes[static_cast<std::size_t>(off + 2)]);
    const u32 b3 = static_cast<u32>(bytes[static_cast<std::size_t>(off + 3)]);
    const u32 v = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    *out = static_cast<i32>(v);
    return Status::Ok;
}

static Status decodeObjSpawnsForMap(
    const SceneCommandBuildInput& input,
    i32 mapId,
    Vec<ObjSpawnRecord>* outSpawns) noexcept {
    if (!outSpawns) {
        return Status::InvalidArgument;
    }
    outSpawns->clear();
    Span<const u8> bytes{};
    const Status bs = tryGetTypeEntryBytesSpan(input, 13, mapId, &bytes);
    if (!ok(bs) || bytes.size() <= 0) {
        return Status::NotFound;
    }
    const i32 len = static_cast<i32>(bytes.size());
    if ((len % 20) != 0) {
        return Status::BadFormat;
    }

    const i32 count = len / 20;
    auto rr = outSpawns->resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return rr.status();
    }

    for (i32 i = 0; i < count; i++) {
        const i32 b = i * 20;
        ObjSpawnRecord rec{};
        Status rs = readI32Le(bytes, b + 0, &rec.id);
        if (!ok(rs)) {
            return rs;
        }
        rs = readI32Le(bytes, b + 4, &rec.count);
        if (!ok(rs)) {
            return rs;
        }
        rs = readI32Le(bytes, b + 8, &rec.x);
        if (!ok(rs)) {
            return rs;
        }
        rs = readI32Le(bytes, b + 12, &rec.y);
        if (!ok(rs)) {
            return rs;
        }
        rs = readI32Le(bytes, b + 16, &rec.plane);
        if (!ok(rs)) {
            return rs;
        }
        if (rec.count <= 0) {
            rec.count = 1;
        }
        (*outSpawns)[static_cast<std::size_t>(i)] = rec;
    }

    return Status::Ok;
}

struct ObjCommandGroup final {
    i32 objTypeId = -1;
    i32 interactId = -1;
    i32 modelId = -1;
    i32 modelHash = 0;
    i32 level = 0;
    i32 priority = 10;
    bool includeLod = true;
    i32 opaqueElementsPerInstance = 0;
    i32 alphaElementsPerInstance = 0;
    Vec<ModelInfo> mergedInstances;
    Vec<ModelInfo> interactInstances;
    Vec<i32> sceneHeights;

    explicit ObjCommandGroup(Allocator& alloc) noexcept
        : mergedInstances(alloc), interactInstances(alloc), sceneHeights(alloc) {}
};

enum class ObjRenderOpKind : i32 {
    Instanced = 1,
    MergeByPlacement = 2,
};

struct ObjRenderOp final {
    ObjRenderOpKind kind = ObjRenderOpKind::Instanced;
    i32 groupIndex = -1;
    bool transparent = false;
    i32 elementsPerInstance = 0;
};

struct ObjCommandPlan final {
    Vec<ObjCommandGroup> groups;
    Vec<ObjRenderOp> ops;

    explicit ObjCommandPlan(Allocator& alloc) noexcept
        : groups(alloc),
          ops(alloc) {}
};

static Status planObjCommandsFromPackedSpawns(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const TerrainTileFaceCountGrid* terrainFaceGrid,
    DecodedUnderlayTypeCache* underlayCache,
    DecodedOverlayTypeCache* overlayCache,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedObjTypeCache* objTypeCache,
    DecodedModelFaceStatsCache* objModelCache,
    SceneCommandStream* debugOut,
    ObjCommandPlan* outPlan,
    Allocator& alloc) noexcept;

static Status executeObjCommandsFromPlan(
    const SceneCommandBuildInput& input,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedObjTypeCache* objTypeCache,
    SceneCommandStream* debugOut,
    ObjCommandPlan* plan,
    Allocator& alloc) noexcept;

static i32 findObjCommandGroupIndex(
    Span<const ObjCommandGroup> groups,
    i32 objTypeId,
    i32 interactId,
    i32 modelId,
    i32 level,
    i32 priority,
    bool includeLod) noexcept {
    for (std::size_t i = 0; i < groups.size(); i++) {
        const ObjCommandGroup& group = groups[i];
        if (group.objTypeId == objTypeId &&
            group.interactId == interactId &&
            group.modelId == modelId &&
            group.level == level &&
            group.priority == priority &&
            group.includeLod == includeLod) {
            if (i > static_cast<std::size_t>(2147483647)) {
                return -1;
            }
            return static_cast<i32>(i);
        }
    }
    return -1;
}

static Status buildObjRenderCommandPlan(
    const SceneCommandBuildInput& input,
    const Vec<ObjCommandGroup>& groups,
    Vec<ObjRenderOp>* outOps,
    Vec<SceneCommandPlanDebugOp>* planOps,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!outOps) {
        return Status::InvalidArgument;
    }
    (void)alloc;
    outOps->clear();

    for (std::size_t gi = 0; gi < groups.size(); gi++) {
        const ObjCommandGroup& group = groups[gi];
        if (group.mergedInstances.empty()) {
            continue;
        }

        if (group.mergedInstances.size() != group.interactInstances.size() ||
            group.mergedInstances.size() != group.sceneHeights.size()) {
            return Status::SizeMismatch;
        }

        for (i32 pass = 0; pass < 2; pass++) {
            const bool transparent = pass == 1;
            const i32 elementsPerInstance = transparent
                ? group.alphaElementsPerInstance
                : group.opaqueElementsPerInstance;
            if (elementsPerInstance <= 0) {
                continue;
            }

            const SceneModelMergeDecision mergeDecision = decideSceneModelMergeStrategy(
                static_cast<i32>(group.mergedInstances.size()),
                group.opaqueElementsPerInstance / 3,
                group.alphaElementsPerInstance / 3,
                input.minimizeDrawCalls);
            const bool mergeByPlacement =
                (transparent ? mergeDecision.mergeTransparent : mergeDecision.mergeOpaque);

            if (debugOut) {
                if (mergeByPlacement) {
                    debugOut->debugObjMergeByPlacementCount++;
                } else {
                    debugOut->debugObjInstancedGroupCount++;
                }
            }

            if (planOps) {
                const i32 faceCount = elementsPerInstance / 3;
                if (faceCount > 0) {
                    SceneCommandPlanDebugOp op{};
                    op.transparent = transparent;
                    op.sourceKind = 2; // obj
                    op.typeId = group.objTypeId;
                    op.placementTypeHint = -1;
                    op.placementRotationHint = 0;
                    op.modelIdHint = group.modelId;
                    op.modelIdsHashHint = 0;
                    if (mergeByPlacement) {
                        op.kind = SceneCommandPlanDebugOpKind::MergedGroup;
                        op.lowDetail = !group.includeLod;
                        op.level = group.level;
                        op.priority = group.priority;
                        op.modelCount = static_cast<i32>(group.mergedInstances.size());
                    } else {
                        op.kind = SceneCommandPlanDebugOpKind::Instanced;
                        op.level = group.level;
                        op.priority = group.priority;
                        op.modelHash = group.modelHash;
                        op.faceCount = faceCount;
                        op.instanceCount = static_cast<i32>(group.interactInstances.size());
                        op.lodInstanceCount = group.includeLod ? op.instanceCount : 0;
                    }
                    auto rrOp = planOps->pushBack(op);
                    if (!rrOp.isOk()) {
                        return rrOp.status();
                    }
                }
            }

            ObjRenderOp op{};
            op.kind = mergeByPlacement ? ObjRenderOpKind::MergeByPlacement : ObjRenderOpKind::Instanced;
            op.groupIndex = static_cast<i32>(gi);
            op.transparent = transparent;
            op.elementsPerInstance = elementsPerInstance;
            auto rr = outOps->pushBack(op);
            if (!rr.isOk()) {
                return rr.status();
            }
        }
    }

    return Status::Ok;
}

static Status executeObjRenderOpMergeByPlacement(
    const SceneCommandBuildInput& input,
    const ObjType& resolved,
    const ObjCommandGroup& group,
    bool transparent,
    i32 elementsPerInstance,
    SceneBuffer* buffer,
    i32* indexCount,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount) {
        return Status::InvalidArgument;
    }
    if (elementsPerInstance <= 0) {
        return Status::InvalidArgument;
    }
    if (group.mergedInstances.size() != group.interactInstances.size() ||
        group.mergedInstances.size() != group.sceneHeights.size()) {
        return Status::SizeMismatch;
    }

    const i32 mergedOffsetBytes = (*indexCount) * 4;
    i32 mergedElements = 0;

    for (std::size_t ii = 0; ii < group.mergedInstances.size(); ii++) {
        const ModelInfo& mergedInst = group.mergedInstances[ii];
        const i32 modelOffsetBytes = (*indexCount) * 4;
        i32 generatedElements = 0;
        const Status gs = appendObjPlacementGeometry(
            input,
            resolved,
            group.modelId,
            mergedInst.sceneX,
            mergedInst.sceneZ,
            group.sceneHeights[ii],
            transparent,
            &buffer->vertices,
            &buffer->indices,
            &generatedElements,
            alloc);
        if (!ok(gs)) {
            return gs;
        }
        if (generatedElements != elementsPerInstance) {
            if (debugOut) {
                const i32 delta = elementsPerInstance - generatedElements;
                debugOut->debugGeometryElementMismatchCount++;
                debugOut->debugGeometryElementMismatchTotalDelta += (delta >= 0) ? delta : -delta;
                if ((delta >= 0 ? delta : -delta) > debugOut->debugGeometryElementMismatchMaxDelta) {
                    debugOut->debugGeometryElementMismatchMaxDelta = (delta >= 0) ? delta : -delta;
                    debugOut->debugGeometryElementMismatchSampleTypeId = group.objTypeId;
                    debugOut->debugGeometryElementMismatchSamplePlacementType = 0;
                    debugOut->debugGeometryElementMismatchSampleRotation = 0;
                }
            }
        }

        const i32 effectiveElements = generatedElements;

        ModelInfo interactDummy = group.interactInstances[ii];
        interactDummy.sceneX = 0;
        interactDummy.sceneZ = 0;
        interactDummy.heightOffset = 0;
        interactDummy.contourGround = static_cast<i32>(ContourGroundType::None);
        Span<const ModelInfo> interactSpan(&interactDummy, 1);
        const Status is = buffer->emitInteractCommand(
            modelOffsetBytes,
            effectiveElements,
            interactSpan,
            transparent,
            group.includeLod,
            /*defer=*/false);
        if (!ok(is)) {
            return is;
        }

        *indexCount += effectiveElements;
        mergedElements += elementsPerInstance;
    }

    ModelInfo mergedDummy{};
    mergedDummy.level = group.level;
    mergedDummy.contourGround = static_cast<i32>(ContourGroundType::None);
    mergedDummy.priority = group.priority;
    mergedDummy.interactType = static_cast<i32>(InteractType::None);
    mergedDummy.interactId = 0xffff;
    const Status ms = buffer->emitMergedCommand(
        mergedOffsetBytes,
        mergedElements,
        Span<const ModelInfo>(&mergedDummy, 1),
        transparent,
        group.includeLod,
        /*defer=*/false);
    if (!ok(ms)) {
        return ms;
    }

    return Status::Ok;
}

static Status executeObjRenderOpInstanced(
    const SceneCommandBuildInput& input,
    const ObjType& resolved,
    const ObjCommandGroup& group,
    bool transparent,
    i32 elementsPerInstance,
    SceneBuffer* buffer,
    i32* indexCount,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount) {
        return Status::InvalidArgument;
    }
    if (elementsPerInstance <= 0) {
        return Status::InvalidArgument;
    }
    const i32 modelOffsetBytes = (*indexCount) * 4;
    i32 generatedElements = 0;
    const Status gs = appendObjPlacementGeometry(
        input,
        resolved,
        group.modelId,
        0,
        0,
        // TS writes instanced geometry in model-space and relies on per-instance contouring/offset,
        // so the shared geometry must not bake in a specific terrain center-height.
        0,
        transparent,
        &buffer->vertices,
        &buffer->indices,
        &generatedElements,
        alloc);
    if (!ok(gs)) {
        return gs;
    }
    if (generatedElements != elementsPerInstance) {
        if (debugOut) {
            const i32 delta = elementsPerInstance - generatedElements;
            debugOut->debugGeometryElementMismatchCount++;
            debugOut->debugGeometryElementMismatchTotalDelta += (delta >= 0) ? delta : -delta;
            if ((delta >= 0 ? delta : -delta) > debugOut->debugGeometryElementMismatchMaxDelta) {
                debugOut->debugGeometryElementMismatchMaxDelta = (delta >= 0) ? delta : -delta;
                debugOut->debugGeometryElementMismatchSampleTypeId = group.objTypeId;
                debugOut->debugGeometryElementMismatchSamplePlacementType = 0;
                debugOut->debugGeometryElementMismatchSampleRotation = 0;
            }
        }
    }

    const i32 effectiveElements = generatedElements;
    const Status ms = buffer->emitMergedCommand(
        modelOffsetBytes,
        effectiveElements,
        Span<const ModelInfo>(group.interactInstances.data(), group.interactInstances.size()),
        transparent,
        group.includeLod);
    if (!ok(ms)) {
        return ms;
    }
    const Status is = buffer->emitInteractCommand(
        modelOffsetBytes,
        effectiveElements,
        Span<const ModelInfo>(group.interactInstances.data(), group.interactInstances.size()),
        transparent,
        group.includeLod);
    if (!ok(is)) {
        return is;
    }
    *indexCount += elementsPerInstance;

    return Status::Ok;
}

static Status planObjCommandsFromPackedSpawns(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const TerrainTileFaceCountGrid* terrainFaceGrid,
    DecodedUnderlayTypeCache* underlayCache,
    DecodedOverlayTypeCache* overlayCache,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedObjTypeCache* objTypeCache,
    DecodedModelFaceStatsCache* objModelCache,
    SceneCommandStream* debugOut,
    ObjCommandPlan* outPlan,
    Allocator& alloc) noexcept {
    if (!objTypeCache || !objModelCache || !outPlan) {
        return Status::InvalidArgument;
    }
    outPlan->groups.clear();
    outPlan->ops.clear();

    const i32 mapStartX = floorDiv(input.baseX, TerrainConstants::MAP_SQUARE_SIZE);
    const i32 mapStartY = floorDiv(input.baseY, TerrainConstants::MAP_SQUARE_SIZE);
    const i32 mapEndX = ceilDiv(
        static_cast<i32>(input.baseX + input.sizeX),
        TerrainConstants::MAP_SQUARE_SIZE);
    const i32 mapEndY = ceilDiv(
        static_cast<i32>(input.baseY + input.sizeY),
        TerrainConstants::MAP_SQUARE_SIZE);

    Vec<ObjSpawnRecord> spawns(alloc);
    Vec<ObjCommandGroup> groups(alloc);

    const i32 border = inferTerrainBorderSize(input.sizeX, input.sizeY);
    const i32 vertexOffset = border * -kTerrainTileSize;

    // TS gates obj scene-models on `tile.tileModel.faces.length > 0`. For core tiles we can use the
    // precomputed face-grid. For border tiles (and plan-only builds without the grid) we compute the
    // terrain-tile face count on-demand via the same append path as terrain emission (discarding geometry).
    if (!underlayCache || !overlayCache) {
        return Status::InvalidArgument;
    }

    struct TerrainSamplerCtx final {
        const SceneCommandBuildInput* input = nullptr;
        DecodedUnderlayTypeCache* underlayCache = nullptr;
        DecodedOverlayTypeCache* overlayCache = nullptr;
        Allocator* alloc = nullptr;
    };

    auto tryLoadUnderlayCb = [](void* c, i32 underlayIdMinusOne, const UnderlayFloorType** outType) noexcept -> Status {
        if (!c || !outType) {
            return Status::InvalidArgument;
        }
        *outType = nullptr;
        TerrainSamplerCtx* ctx = static_cast<TerrainSamplerCtx*>(c);
        return tryDecodeUnderlayTypeFromBlob(
            *ctx->input,
            underlayIdMinusOne,
            ctx->underlayCache,
            outType,
            *ctx->alloc);
    };

    auto tryLoadOverlayCb = [](void* c, i32 overlayIdMinusOne, const OverlayFloorType** outType) noexcept -> Status {
        if (!c || !outType) {
            return Status::InvalidArgument;
        }
        *outType = nullptr;
        TerrainSamplerCtx* ctx = static_cast<TerrainSamplerCtx*>(c);
        return tryDecodeOverlayTypeFromBlob(
            *ctx->input,
            overlayIdMinusOne,
            ctx->overlayCache,
            outType,
            *ctx->alloc);
    };

    TerrainSamplerCtx samplerCtx{&input, underlayCache, overlayCache, &alloc};
    TerrainTypeProvider samplerProvider{&samplerCtx, tryLoadUnderlayCb, tryLoadOverlayCb};
    Vec<u8> scratchVertices(alloc);
    Vec<i32> scratchIndices(alloc);

    const auto tryComputeTerrainTileFaces =
        [&](i32 level, i32 tileX, i32 tileY, i32* outFaces) noexcept -> Status {
        if (!outFaces) {
            return Status::InvalidArgument;
        }
        *outFaces = 0;
        if (!scene.isWithinBounds(level, tileX, tileY)) {
            return Status::Ok;
        }
        if (tileX + 1 >= scene.sizeX || tileY + 1 >= scene.sizeY) {
            return Status::Ok;
        }

        TerrainTileSample tileSample{};
        const Status ss = sampleTerrainTile(
            scene,
            input.cacheGame,
            input.cacheRevision,
            input.textureIds,
            samplerProvider,
            level,
            tileX,
            tileY,
            input.smoothTerrain,
            &tileSample);
        if (!ok(ss)) {
            return ss;
        }

        const i32 underlayRaw = static_cast<i32>(scene.underlay(level, tileX, tileY));
        const bool hasUnderlay = underlayRaw > 0;
        const bool hasOverlay = tileSample.hasOverlay;
        if (!hasUnderlay && !hasOverlay) {
            return Status::Ok;
        }

        const bool useOverlayEdgeHsls = tileSample.useOverlayEdgeHsls;
        const i32 underlayTexturePacked = tileSample.underlayTexturePacked;
        const i32 underlayTextureSize = tileSample.underlayTextureSize;
        const i32 underlayBlendSw = tileSample.underlayBlendSw;
        const i32 underlayBlendSe = tileSample.underlayBlendSe;
        const i32 underlayBlendNe = tileSample.underlayBlendNe;
        const i32 underlayBlendNw = tileSample.underlayBlendNw;
        const i32* overlayCornerBaseHsl = tileSample.overlayCornerBaseHsl;
        const i32* overlayEdgeBaseHsl = tileSample.overlayEdgeBaseHsl;
        const i32* overlayCornerTexturePacked = tileSample.overlayCornerTexturePacked;
        const i32* overlayCornerTextureSize = tileSample.overlayCornerTextureSize;
        const i32* overlayEdgeTexturePacked = tileSample.overlayEdgeTexturePacked;
        const i32* overlayEdgeTextureSize = tileSample.overlayEdgeTextureSize;

        const i32 lightSw = static_cast<i32>(scene.lightValue(level, tileX, tileY));
        const i32 lightSe = static_cast<i32>(scene.lightValue(level, tileX + 1, tileY));
        const i32 lightNe = static_cast<i32>(scene.lightValue(level, tileX + 1, tileY + 1));
        const i32 lightNw = static_cast<i32>(scene.lightValue(level, tileX, tileY + 1));

        const i32 underlayHslSw = adjustUnderlayLight(underlayBlendSw, lightSw);
        const i32 underlayHslSe = adjustUnderlayLight(underlayBlendSe, lightSe);
        const i32 underlayHslNe = adjustUnderlayLight(underlayBlendNe, lightNe);
        const i32 underlayHslNw = adjustUnderlayLight(underlayBlendNw, lightNw);

        const i32 overlayHslSw = adjustOverlayLight(overlayCornerBaseHsl[0], lightSw);
        const i32 overlayHslSe = adjustOverlayLight(overlayCornerBaseHsl[1], lightSe);
        const i32 overlayHslNe = adjustOverlayLight(overlayCornerBaseHsl[2], lightNe);
        const i32 overlayHslNw = adjustOverlayLight(overlayCornerBaseHsl[3], lightNw);
        const i32 lightS = (lightSw + lightSe) >> 1;
        const i32 lightE = (lightSe + lightNe) >> 1;
        const i32 lightN = (lightNe + lightNw) >> 1;
        const i32 lightW = (lightNw + lightSw) >> 1;
        const i32 overlayHslSAvg = adjustOverlayLight(overlayEdgeBaseHsl[0], lightS);
        const i32 overlayHslEAvg = adjustOverlayLight(overlayEdgeBaseHsl[1], lightE);
        const i32 overlayHslNAvg = adjustOverlayLight(overlayEdgeBaseHsl[2], lightN);
        const i32 overlayHslWAvg = adjustOverlayLight(overlayEdgeBaseHsl[3], lightW);

        i32 shapeId = 0;
        i32 rotation = 0;
        if (hasOverlay) {
            shapeId = static_cast<i32>(scene.shape(level, tileX, tileY)) + 1;
            if (shapeId < 1 || shapeId > 12) {
                shapeId = 0;
            }
            rotation = static_cast<i32>(scene.rotation(level, tileX, tileY)) & 3;
        }

        bool tileFaceColorsAAllValid = true;
        i32 scratchElements = 0;
        scratchVertices.clear();
        scratchIndices.clear();
        const Status gs = appendTerrainTileGeometry(
            scene,
            level,
            tileX,
            tileY,
            vertexOffset,
            shapeId,
            rotation,
            hasOverlay,
            hasUnderlay,
            underlayHslSw,
            underlayHslSe,
            underlayHslNe,
            underlayHslNw,
            overlayHslSw,
            overlayHslSe,
            overlayHslNe,
            overlayHslNw,
            overlayHslSAvg,
            overlayHslEAvg,
            overlayHslNAvg,
            overlayHslWAvg,
            useOverlayEdgeHsls,
            underlayTexturePacked,
            underlayTextureSize,
            overlayCornerTexturePacked,
            overlayCornerTextureSize,
            overlayEdgeTexturePacked,
            overlayEdgeTextureSize,
            &tileFaceColorsAAllValid,
            /*debugOut=*/nullptr,
            &scratchVertices,
            &scratchIndices,
            &scratchElements);
        if (!ok(gs)) {
            return gs;
        }
        *outFaces = (scratchElements > 0) ? (scratchElements / 3) : 0;
        return Status::Ok;
    };

    for (i32 mx = mapStartX; mx < mapEndX; mx++) {
        for (i32 my = mapStartY; my < mapEndY; my++) {
            const i32 mapId = (mx << 8) + my;
            const Status ds = decodeObjSpawnsForMap(input, mapId, &spawns);
            if (ds == Status::NotFound) {
                continue;
            }
            if (!ok(ds)) {
                return ds;
            }
            if (debugOut && spawns.size() <= static_cast<std::size_t>(2147483647)) {
                debugOut->debugObjSpawnsDecoded += static_cast<i32>(spawns.size());
            }

            const i32 offsetX = mx * TerrainConstants::MAP_SQUARE_SIZE - input.baseX;
            const i32 offsetY = my * TerrainConstants::MAP_SQUARE_SIZE - input.baseY;

            for (std::size_t i = 0; i < spawns.size(); i++) {
                const ObjSpawnRecord& spawn = spawns[i];
                if (spawn.id < 0) {
                    continue;
                }
                const i32 localX = spawn.x - (mx * TerrainConstants::MAP_SQUARE_SIZE);
                const i32 localY = spawn.y - (my * TerrainConstants::MAP_SQUARE_SIZE);
                const i32 tileX = localX + offsetX;
                const i32 tileY = localY + offsetY;
                if (!(tileX > 0 && tileY > 0 && tileX < input.sizeX - 1 && tileY < input.sizeY - 1)) {
                    continue;
                }

                i32 renderLevel = spawn.plane;
                if (renderLevel < 0 || renderLevel >= scene.levels) {
                    continue;
                }
                if (renderLevel < 3 &&
                    scene.isWithinBounds(1, tileX, tileY) &&
                    (scene.renderFlag(1, tileX, tileY) &
                     static_cast<u8>(SceneTileRenderFlag::Bridge)) != 0) {
                    renderLevel = renderLevel + 1;
                }
                if (!scene.isWithinBounds(renderLevel, tileX, tileY)) {
                    continue;
                }
                // Match TS `createObjSceneModel`: obj scene-models are only created when the target
                // tile has a terrain tile-model with at least one visible face.
                //
                // In TS, this is `tile.tileModel.faces.length > 0` (faces are skipped when their
                // colors/textures are invalid/hidden). The C++ terrain emitter already knows the
                // emitted face count per tile, so prefer that when available.
                bool hasVisibleTerrainFaces = false;
                if (terrainFaceGrid && !terrainFaceGrid->counts.empty()) {
                    const i32 lx = tileX - border;
                    const i32 ly = tileY - border;
                    if (lx >= 0 && ly >= 0 &&
                        lx < terrainFaceGrid->width && ly < terrainFaceGrid->height) {
                        hasVisibleTerrainFaces = terrainFaceGrid->get(renderLevel, lx, ly) > 0;
                    }
                }
                if (!hasVisibleTerrainFaces) {
                    i32 faces = 0;
                    const Status fs = tryComputeTerrainTileFaces(renderLevel, tileX, tileY, &faces);
                    if (!ok(fs) || faces <= 0) {
                        continue;
                    }
                    hasVisibleTerrainFaces = true;
                }
                if (debugOut) {
                    debugOut->debugObjSpawnsInBounds++;
                }

                // Match TS `createObjSceneModel` gating:
                // - first gate on the *base* obj type name ("null" spawns are skipped before count transforms)
                // - then resolve count transforms (ObjModelLoader.getModel recursion) for the actual model/type.
                const ObjType* baseType = nullptr;
                const Status baseStatus = tryDecodeObjTypeFromBlob(
                    input,
                    objTypeCache,
                    spawn.id,
                    &baseType,
                    alloc);
                if (!ok(baseStatus) || !baseType) {
                    continue;
                }
                if (equalsIgnoreCaseAscii(baseType->name, "null")) {
                    continue;
                }

                const ObjType* resolved = resolveObjTypeForCount(
                    input,
                    objTypeCache,
                    spawn.id,
                    spawn.count,
                    alloc);
                if (!resolved) {
                    continue;
                }

                const i32 modelId = resolved->model;
                if (modelId < 0) {
                    continue;
                }
                if (debugOut) {
                    debugOut->debugObjModelCandidates++;
                }

                const i32 sceneHeight = (
                    scene.height(renderLevel, tileX, tileY) +
                    scene.height(renderLevel, tileX + 1, tileY) +
                    scene.height(renderLevel, tileX, tileY + 1) +
                    scene.height(renderLevel, tileX + 1, tileY + 1)) >> 2;

                const ModelFaceStats* stats = nullptr;
                const Status ms = tryDecodeObjModelFaceStatsFromBlob(
                    input,
                    objModelCache,
                    *resolved,
                    modelId,
                    &stats,
                    alloc);
                if (!ok(ms) || !stats) {
                    continue;
                }
                if (stats->opaqueElements <= 0 && stats->alphaElements <= 0) {
                    continue;
                }

                const i32 priority = 10;
                const bool includeLod = true;
                const i32 groupIndex = findObjCommandGroupIndex(
                    Span<const ObjCommandGroup>(groups.data(), groups.size()),
                    resolved->id,
                    spawn.id,
                    modelId,
                    renderLevel,
                    priority,
                    includeLod);

                i32 targetGroupIndex = groupIndex;
                if (targetGroupIndex < 0) {
                    ObjCommandGroup group(alloc);
                    group.objTypeId = resolved->id;
                    group.interactId = spawn.id;
                    group.modelId = modelId;
                    group.modelHash = stats->modelHash;
                    group.level = renderLevel;
                    group.priority = priority;
                    group.includeLod = includeLod;
                    group.opaqueElementsPerInstance = stats->opaqueElements;
                    group.alphaElementsPerInstance = stats->alphaElements;
                    auto rrGroup = groups.pushBack(rs::move(group));
                    if (!rrGroup.isOk()) {
                        return rrGroup.status();
                    }
                    targetGroupIndex = static_cast<i32>(groups.size() - 1);
                }

                if (targetGroupIndex < 0 ||
                    targetGroupIndex >= static_cast<i32>(groups.size())) {
                    return Status::OutOfRange;
                }

                ObjCommandGroup& group = groups[static_cast<std::size_t>(targetGroupIndex)];
                if (group.modelHash != stats->modelHash ||
                    group.opaqueElementsPerInstance != stats->opaqueElements ||
                    group.alphaElementsPerInstance != stats->alphaElements) {
                    continue;
                }

                ModelInfo mergedInst{};
                mergedInst.sceneX = (tileX - border) * 128 + 64;
                mergedInst.sceneZ = (tileY - border) * 128 + 64;
                mergedInst.heightOffset = 0;
                mergedInst.level = renderLevel;
                mergedInst.contourGround = static_cast<i32>(ContourGroundType::CenterTile);
                mergedInst.priority = priority;
                mergedInst.interactType = static_cast<i32>(InteractType::None);
                mergedInst.interactId = 0xffff;
                auto rrMerged = group.mergedInstances.pushBack(mergedInst);
                if (!rrMerged.isOk()) {
                    return rrMerged.status();
                }
                if (debugOut) {
                    debugOut->debugObjInstancesQueued++;
                }

                ModelInfo interactInst = mergedInst;
                interactInst.interactType = static_cast<i32>(InteractType::Obj);
                interactInst.interactId = spawn.id;
                auto rrInteract = group.interactInstances.pushBack(interactInst);
                if (!rrInteract.isOk()) {
                    return rrInteract.status();
                }

                auto rrHeight = group.sceneHeights.pushBack(sceneHeight);
                if (!rrHeight.isOk()) {
                    return rrHeight.status();
                }
            }
        }
    }

    Vec<ObjRenderOp> ops(alloc);
    const Status ps = buildObjRenderCommandPlan(
        input,
        groups,
        &ops,
        planOps,
        debugOut,
        alloc);
    if (!ok(ps)) {
        return ps;
    }

    outPlan->groups = rs::move(groups);
    outPlan->ops = rs::move(ops);
    return Status::Ok;
}

static Status executeObjCommandsFromPlan(
    const SceneCommandBuildInput& input,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedObjTypeCache* objTypeCache,
    SceneCommandStream* debugOut,
    ObjCommandPlan* plan,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !objTypeCache || !plan) {
        return Status::InvalidArgument;
    }

    Vec<const ObjType*> resolvedTypes(alloc);
    auto rrResolved = resolvedTypes.resize(plan->groups.size());
    if (!rrResolved.isOk()) {
        return rrResolved.status();
    }
    for (std::size_t i = 0; i < resolvedTypes.size(); i++) {
        resolvedTypes[i] = nullptr;
    }

    for (std::size_t oi = 0; oi < plan->ops.size(); oi++) {
        const ObjRenderOp& op = plan->ops[oi];
        if (op.groupIndex < 0 || op.groupIndex >= static_cast<i32>(plan->groups.size())) {
            return Status::OutOfRange;
        }
        const ObjCommandGroup& group = plan->groups[static_cast<std::size_t>(op.groupIndex)];
        if (group.mergedInstances.empty()) {
            continue;
        }

        const std::size_t gi = static_cast<std::size_t>(op.groupIndex);
        const ObjType* resolved = resolvedTypes[gi];
        if (!resolved) {
            const Status ts = tryDecodeObjTypeFromBlob(
                input,
                objTypeCache,
                group.objTypeId,
                &resolved,
                alloc);
            if (!ok(ts) || !resolved) {
                continue;
            }
            resolvedTypes[gi] = resolved;
        }

        Status s = Status::Ok;
        if (op.kind == ObjRenderOpKind::MergeByPlacement) {
            s = executeObjRenderOpMergeByPlacement(
                input,
                *resolved,
                group,
                op.transparent,
                op.elementsPerInstance,
                buffer,
                indexCount,
                debugOut,
                alloc);
        } else {
            s = executeObjRenderOpInstanced(
                input,
                *resolved,
                group,
                op.transparent,
                op.elementsPerInstance,
                buffer,
                indexCount,
                debugOut,
                alloc);
        }
        if (!ok(s)) {
            return s;
        }
    }

    return Status::Ok;
}

Status emitObjCommandsFromPackedSpawns(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const TerrainTileFaceCountGrid* terrainFaceGrid,
    DecodedUnderlayTypeCache* underlayCache,
    DecodedOverlayTypeCache* overlayCache,
    Vec<SceneCommandPlanDebugOp>* planOps,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedObjTypeCache* objTypeCache,
    DecodedModelFaceStatsCache* objModelCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !objTypeCache || !objModelCache) {
        return Status::InvalidArgument;
    }

    ObjCommandPlan plan(alloc);
    const Status ps = planObjCommandsFromPackedSpawns(
        input,
        scene,
        terrainFaceGrid,
        underlayCache,
        overlayCache,
        planOps,
        objTypeCache,
        objModelCache,
        debugOut,
        &plan,
        alloc);
    if (!ok(ps)) {
        return ps;
    }

    return executeObjCommandsFromPlan(
        input,
        buffer,
        indexCount,
        objTypeCache,
        debugOut,
        &plan,
        alloc);
}

Status appendObjPlanOpsFromPackedSpawns(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const TerrainTileFaceCountGrid* terrainFaceGrid,
    DecodedUnderlayTypeCache* underlayCache,
    DecodedOverlayTypeCache* overlayCache,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedObjTypeCache* objTypeCache,
    DecodedModelFaceStatsCache* objModelCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!objTypeCache || !objModelCache) {
        return Status::InvalidArgument;
    }
    ObjCommandPlan plan(alloc);
    return planObjCommandsFromPackedSpawns(
        input,
        scene,
        terrainFaceGrid,
        underlayCache,
        overlayCache,
        planOps,
        objTypeCache,
        objModelCache,
        debugOut,
        &plan,
        alloc);
}

struct ObjDeferredPlan final {
    ObjCommandPlan plan;
    explicit ObjDeferredPlan(Allocator& alloc) noexcept : plan(alloc) {}
};

Status createObjDeferredPlanFromPackedSpawns(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const TerrainTileFaceCountGrid* terrainFaceGrid,
    DecodedUnderlayTypeCache* underlayCache,
    DecodedOverlayTypeCache* overlayCache,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedObjTypeCache* objTypeCache,
    DecodedModelFaceStatsCache* objModelCache,
    SceneCommandStream* debugOut,
    ObjDeferredPlan** outPlan,
    Allocator& alloc) noexcept {
    if (!outPlan || !objTypeCache || !objModelCache) {
        return Status::InvalidArgument;
    }
    *outPlan = nullptr;

    void* mem = alloc.alloc ? alloc.alloc(alloc.ctx, sizeof(ObjDeferredPlan), alignof(ObjDeferredPlan)) : nullptr;
    if (!mem) {
        return Status::OutOfMemory;
    }
    ObjDeferredPlan* plan = new (mem) ObjDeferredPlan(alloc);

    const Status ps = planObjCommandsFromPackedSpawns(
        input,
        scene,
        terrainFaceGrid,
        underlayCache,
        overlayCache,
        planOps,
        objTypeCache,
        objModelCache,
        debugOut,
        &plan->plan,
        alloc);
    if (!ok(ps)) {
        plan->~ObjDeferredPlan();
        if (alloc.free) alloc.free(alloc.ctx, mem, alignof(ObjDeferredPlan));
        return ps;
    }

    *outPlan = plan;
    return Status::Ok;
}

static Status executeObjDeferredPlanPhase(
    const SceneCommandBuildInput& input,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedObjTypeCache* objTypeCache,
    ObjDeferredPlan* plan,
    SceneCommandStream* debugOut,
    ObjRenderOpKind wantKind,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !objTypeCache || !plan) {
        return Status::InvalidArgument;
    }

    Vec<const ObjType*> resolvedTypes(alloc);
    auto rrResolved = resolvedTypes.resize(plan->plan.groups.size());
    if (!rrResolved.isOk()) {
        return rrResolved.status();
    }
    for (std::size_t i = 0; i < resolvedTypes.size(); i++) {
        resolvedTypes[i] = nullptr;
    }

    for (std::size_t oi = 0; oi < plan->plan.ops.size(); oi++) {
        const ObjRenderOp& op = plan->plan.ops[oi];
        if (op.kind != wantKind) {
            continue;
        }
        if (op.groupIndex < 0 || op.groupIndex >= static_cast<i32>(plan->plan.groups.size())) {
            return Status::OutOfRange;
        }
        const ObjCommandGroup& group = plan->plan.groups[static_cast<std::size_t>(op.groupIndex)];
        if (group.mergedInstances.empty()) {
            continue;
        }

        const std::size_t gi = static_cast<std::size_t>(op.groupIndex);
        const ObjType* resolved = resolvedTypes[gi];
        if (!resolved) {
            const Status ts = tryDecodeObjTypeFromBlob(
                input,
                objTypeCache,
                group.objTypeId,
                &resolved,
                alloc);
            if (!ok(ts) || !resolved) {
                continue;
            }
            resolvedTypes[gi] = resolved;
        }

        Status s = Status::Ok;
        if (op.kind == ObjRenderOpKind::MergeByPlacement) {
            s = executeObjRenderOpMergeByPlacement(
                input,
                *resolved,
                group,
                op.transparent,
                op.elementsPerInstance,
                buffer,
                indexCount,
                debugOut,
                alloc);
        } else {
            s = executeObjRenderOpInstanced(
                input,
                *resolved,
                group,
                op.transparent,
                op.elementsPerInstance,
                buffer,
                indexCount,
                debugOut,
                alloc);
        }
        if (!ok(s)) {
            return s;
        }
    }

    return Status::Ok;
}

Status executeObjDeferredPlanInstanced(
    const SceneCommandBuildInput& input,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedObjTypeCache* objTypeCache,
    ObjDeferredPlan* plan,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    return executeObjDeferredPlanPhase(
        input,
        buffer,
        indexCount,
        objTypeCache,
        plan,
        debugOut,
        ObjRenderOpKind::Instanced,
        alloc);
}

Status executeObjDeferredPlanMerged(
    const SceneCommandBuildInput& input,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedObjTypeCache* objTypeCache,
    ObjDeferredPlan* plan,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    return executeObjDeferredPlanPhase(
        input,
        buffer,
        indexCount,
        objTypeCache,
        plan,
        debugOut,
        ObjRenderOpKind::MergeByPlacement,
        alloc);
}

Status destroyObjDeferredPlan(ObjDeferredPlan* plan, Allocator& alloc) noexcept {
    if (!plan) return Status::Ok;
    plan->~ObjDeferredPlan();
    if (alloc.free) {
        alloc.free(alloc.ctx, plan, alignof(ObjDeferredPlan));
    }
    return Status::Ok;
}

} // namespace scb
} // namespace rs
