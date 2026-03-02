#pragma once

#include "../core/Allocator.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"
#include "SceneBuffer.hpp"
#include "SceneCommandBuilder.hpp"

namespace rs {

struct SceneData;
struct LocType;
struct ObjType;
struct UnderlayFloorType;
struct OverlayFloorType;
struct LocPlacement;
struct VarBitType;
struct SeqType;
struct ModelData;
struct SeqBase;
struct SeqFrame;
struct ModelFaceStats final {
    i32 opaqueElements = 0;
    i32 alphaElements = 0;
    i32 modelHash = 0;
    bool hasBounds = false;
    i32 minX = 0;
    i32 maxX = 0;
    i32 minZ = 0;
    i32 maxZ = 0;
};

namespace scb {

// Shared small helpers used across split TUs (LocEmit/ObjEmit/SceneCommandBuilder).
i32 fnv1aMixI32(i32 hash, i32 value) noexcept;
u32 fnv1a32UpdateI32ForDebug(u32 hash, i32 value) noexcept;
bool isWithinHeightBounds(const SceneData& scene, i32 level, i32 tileX, i32 tileY) noexcept;

static inline Status tryGetTypeEntryBytesSpan(
    const SceneCommandBuildInput& input,
    i32 kind,
    i32 id,
    Span<const u8>* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    *out = Span<const u8>();
    if (id < 0) {
        return Status::NotFound;
    }
    if (!input.tryGetTypeEntryBytes) {
        return Status::NotFound;
    }
    return input.tryGetTypeEntryBytes(input.typeEntryBytesCtx, kind, id, out);
}

// Loc animation helpers (classic seq frames) shared between build and debug tooling.
// Implemented in `LocEmit.cpp`.
Status tryDecodeBridgeSeqFrameFromBlob(
    const SceneCommandBuildInput& input,
    i32 frameId,
    SeqBase* outBase,
    SeqFrame* outFrame,
    Allocator& alloc) noexcept;

// Apply a classic seq frame to a decoded model, matching TS `transformModel` semantics used for
// loc animated frames. This applies the frame transform ops; callers handle any rotation/diagonal
// rotation steps around it.
Status applyClassicSeqFrameToModelDataTS(
    ModelData* model,
    const SeqBase& base,
    const SeqFrame& frame,
    Allocator& alloc) noexcept;

// TS animated-loc grouping. These are planned during loc planning, but their frame geometry is appended
// after all static scene geometry (locs + objs) so animated frame ranges match TS buffer layout.
struct LocAnimatedPlaceholder final {
    ModelInfo instance{};
    // Ordering key matching TS `getSceneLocs` tile scan:
    // (level,tileX,tileY,categoryOrder) where categoryOrder is floorDec < wall < wallDecor < loc.
    i32 sortKey = 0;
    // Group key: rotation + (type<<3) + (locTypeId<<10)
    i32 groupKey = 0;
    bool includeLod = false;
    bool hasAlpha = false;
};

struct LocAnimatedGroupPlan final {
    // TS createLocAnimatedGroupKey(rotation, type, locTypeId): rotation + (type<<3) + (locTypeId<<10)
    i32 groupKey = 0;
    // Minimum placeholder sortKey among members; used to sort groups in TS-first-seen order.
    i32 firstSortKey = 0x7fffffff;
    i32 seqId = -1;
    i32 locTypeId = -1;
    i32 placementType = 0;
    i32 rotation = 0;
    bool hasAlpha = false;
};

// Model lighting state aligned with TS `ModelData.calculateVertexNormals()` + face normals for type==1.
// This is shared between emitters (e.g., mergeNormals preprocessing) and geometry/hash emission.
struct ModelFaceLightingState final {
    Vec<i32> vertexNormalX;
    Vec<i32> vertexNormalY;
    Vec<i32> vertexNormalZ;
    Vec<i32> vertexNormalMagnitude;
    Vec<i32> faceNormalX;
    Vec<i32> faceNormalY;
    Vec<i32> faceNormalZ;

    // Optional merged normals (TS `mergedNormals`). When `mergedVertexPresent[i] != 0`, shading should
    // use `mergedVertexNormal*` instead of `vertexNormal*` for that vertex.
    Vec<i32> mergedVertexNormalX;
    Vec<i32> mergedVertexNormalY;
    Vec<i32> mergedVertexNormalZ;
    Vec<i32> mergedVertexNormalMagnitude;
    Vec<u8> mergedVertexPresent;

    explicit ModelFaceLightingState(Allocator& alloc) noexcept
        : vertexNormalX(alloc),
          vertexNormalY(alloc),
          vertexNormalZ(alloc),
          vertexNormalMagnitude(alloc),
          faceNormalX(alloc),
          faceNormalY(alloc),
          faceNormalZ(alloc),
          mergedVertexNormalX(alloc),
          mergedVertexNormalY(alloc),
          mergedVertexNormalZ(alloc),
          mergedVertexNormalMagnitude(alloc),
          mergedVertexPresent(alloc) {}
};

Status initModelFaceLightingState(
    const ModelData& model,
    ModelFaceLightingState* out,
    Allocator& alloc) noexcept;

// TS `ModelHashBuffer`-compatible hash for grouping, but using a caller-supplied lighting state.
// This is needed for mergeNormals models: TS computes normals, merges, then hides occluded faces
// without recomputing normals before lighting/hash.
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
    Allocator& alloc) noexcept;
bool tryGetSeqAlphaHintFromBlob(
    const SceneCommandBuildInput& input,
    i32 seqTypeId,
    bool* outHasAlpha) noexcept;

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
    i32 modelCount) noexcept;

DebugCommandProvenance makeLocCommandProvenance(
    DebugCommandSourceKind sourceKind,
    i32 locTypeId,
    i32 placementType,
    i32 placementRotation,
    i32 variantType,
    i32 variantRotation,
    i32 pass,
    i32 mergePath,
    i32 splitSignature = 0) noexcept;

i32 hashSceneLocCommandGroupKeyForDebug(const SceneLocCommandGroupKey& key) noexcept;

struct SceneModelMergeDecision final {
    bool mergeOpaque = false;
    bool mergeTransparent = false;
};

SceneModelMergeDecision decideSceneModelMergeStrategy(
    i32 instanceCount,
    i32 opaqueFaceCount,
    i32 transparentFaceCount,
    bool minimizeDrawCalls) noexcept;

// TS-plan digest ops are built in the top-level builder and appended to by loc/obj emitters.
enum class SceneCommandPlanDebugOpKind : u8 {
    Instanced = 1,
    MergedGroup = 2,
};

struct SceneCommandPlanDebugOp final {
    SceneCommandPlanDebugOpKind kind = SceneCommandPlanDebugOpKind::Instanced;
    bool transparent = false;

    // Debug provenance (not part of the TS parity digest).
    // sourceKind: 0 unknown, 1 loc, 2 obj.
    i32 sourceKind = 0;
    i32 typeId = -1;
    i32 placementTypeHint = -1;
    i32 placementRotationHint = -1;
    i32 modelIdHint = -1;
    i32 modelIdsHashHint = 0;

    // Instanced op fields.
    i32 modelHash = 0;
    i32 faceCount = 0;
    i32 instanceCount = 0;
    i32 lodInstanceCount = 0;

    // Merged-group op fields.
    bool lowDetail = false;
    i32 level = 0;
    i32 priority = 0;
    i32 modelCount = 0;
};

struct TerrainTileFaceCountGrid final {
    Vec<u8> counts;
    i32 levels = 0;
    i32 width = 0;
    i32 height = 0;
    i32 border = 0;

    explicit TerrainTileFaceCountGrid(Allocator& alloc) noexcept : counts(alloc) {}

    Status ensure(i32 levels_, i32 width_, i32 height_, i32 border_) noexcept {
        if (levels_ <= 0 || width_ <= 0 || height_ <= 0) {
            counts.clear();
            levels = 0;
            width = 0;
            height = 0;
            border = 0;
            return Status::Ok;
        }

        const std::size_t need =
            static_cast<std::size_t>(levels_) *
            static_cast<std::size_t>(width_) *
            static_cast<std::size_t>(height_);

        if (counts.size() != need) {
            auto rr = counts.resize(need);
            if (!rr.isOk()) {
                return rr.status();
            }
        }
        for (std::size_t i = 0; i < need; i++) {
            counts[i] = 0;
        }
        levels = levels_;
        width = width_;
        height = height_;
        border = border_;
        return Status::Ok;
    }

    void set(i32 level, i32 lx, i32 ly, i32 faces) noexcept {
        if (counts.empty() || width <= 0 || height <= 0) {
            return;
        }
        if (level < 0 || level >= levels || lx < 0 || ly < 0 || lx >= width || ly >= height) {
            return;
        }
        const std::size_t idx =
            static_cast<std::size_t>(level) *
                static_cast<std::size_t>(width) * static_cast<std::size_t>(height) +
            static_cast<std::size_t>(lx) * static_cast<std::size_t>(height) +
            static_cast<std::size_t>(ly);
        if (idx >= counts.size()) {
            return;
        }
        const i32 clipped = (faces > 255) ? 255 : (faces < 0 ? 0 : faces);
        counts[idx] = static_cast<u8>(clipped);
    }
};

struct DecodedLocTypeCache;
struct DecodedVarBitTypeCache;
struct DecodedSeqTypeCache;
struct DecodedUnderlayTypeCache;
struct DecodedOverlayTypeCache;
struct DecodedObjTypeCache;
struct DecodedModelFaceStatsCache;

i32 locPlacementCategoryForSceneOrder(i32 placementType) noexcept;

i32 resolveLocInstanceContourGround(
    const SceneData& scene,
    const LocType& locType,
    i32 level,
    i32 tileX,
    i32 tileY) noexcept;

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
    i32 maxZ) noexcept;

struct ResolvedLocRenderPlacement final {
    const LocType* locType = nullptr;
    i32 seqId = -1;
    i32 priority = 1;
    i32 interactId = -1;
    bool includeLod = false;
    bool forceMerge = false;
    bool sourceIsEntity = false;
};

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
    Allocator& alloc) noexcept;

i32 inferTerrainBorderSize(i32 sizeX, i32 sizeY) noexcept;
i32 floorDiv(i32 n, i32 d) noexcept;
i32 ceilDiv(i32 n, i32 d) noexcept;

i32 findTypeBlobIndex(Span<const i32> ids, i32 id) noexcept;

i32 mapTextureIdToPackedIndex(Span<const i32> textureIds, i32 textureId) noexcept;

// Decode a loc model and apply TS-equivalent loc mutations (rotate/recolor/retexture/resize/offset, etc.)
// for a specific placement variant.
Status decodeLocModelFromBlobForPlacement(
    const SceneCommandBuildInput& input,
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    i32 modelId,
    ModelData* outModel,
    bool applyDiagonalNormalVariantRotation,
    Allocator& alloc) noexcept;

Status tryDecodeUnderlayTypeFromBlob(
    const SceneCommandBuildInput& input,
    i32 underlayId,
    DecodedUnderlayTypeCache* cache,
    const UnderlayFloorType** outType,
    Allocator& alloc) noexcept;

Status tryDecodeOverlayTypeFromBlob(
    const SceneCommandBuildInput& input,
    i32 overlayId,
    DecodedOverlayTypeCache* cache,
    const OverlayFloorType** outType,
    Allocator& alloc) noexcept;

Status tryDecodeObjTypeFromBlob(
    const SceneCommandBuildInput& input,
    DecodedObjTypeCache* cache,
    i32 objTypeId,
    const ObjType** outObjType,
    Allocator& alloc) noexcept;

const ObjType* resolveObjTypeForCount(
    const SceneCommandBuildInput& input,
    DecodedObjTypeCache* cache,
    i32 objTypeId,
    i32 count,
    Allocator& alloc) noexcept;

Status tryDecodeLocTypeFromBlob(
    const SceneCommandBuildInput& input,
    DecodedLocTypeCache* cache,
    i32 locTypeId,
    const LocType** outLocType,
    Allocator& alloc) noexcept;

Status tryDecodeVarBitTypeFromBlob(
    const SceneCommandBuildInput& input,
    DecodedVarBitTypeCache* cache,
    i32 varbitId,
    const VarBitType** outType,
    Allocator& alloc) noexcept;

Status tryDecodeSeqTypeFromBlob(
    const SceneCommandBuildInput& input,
    DecodedSeqTypeCache* cache,
    i32 seqTypeId,
    const SeqType** outType,
    Allocator& alloc) noexcept;

Status tryDecodeModelFaceStatsFromBlob(
    const SceneCommandBuildInput& input,
    DecodedModelFaceStatsCache* cache,
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    i32 modelId,
    const ModelFaceStats** outStats,
    Allocator& alloc) noexcept;

// TS-compatible modelHash for a loc variant that may span multiple modelIds.
// Matches the ordering used by TS `getModelHash()` (field-major concatenation).
Status computeLocVariantModelHashForGroupingFromBlob(
    const SceneCommandBuildInput& input,
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    Span<const i32> modelIds,
    i32* outHash,
    Allocator& alloc) noexcept;

Status tryDecodeObjModelFaceStatsFromBlob(
    const SceneCommandBuildInput& input,
    DecodedModelFaceStatsCache* cache,
    const ObjType& objType,
    i32 modelId,
    const ModelFaceStats** outStats,
    Allocator& alloc) noexcept;

bool sampleSceneHeightAtWorld(
    const SceneData& scene,
    i32 level,
    i32 worldX,
    i32 worldZ,
    i32* outHeight) noexcept;

bool collectLocTypeModelIdsForVariant(
    const LocType& locType,
    i32 placementType,
    Vec<i32>* outModelIds) noexcept;

struct LocModelVariantRef final {
    i32 modelId = -1;
    i32 placementType = 0;
    i32 rotation = 0;
};

bool collectLocTypeModelRefs(
    const LocType& locType,
    i32 placementType,
    i32 rotation,
    Vec<LocModelVariantRef>* outModelRefs) noexcept;

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
    Allocator& alloc) noexcept;

// Append geometry for a single decoded loc model using a caller-supplied lighting state.
// Used for mergeNormals: normals are computed/merged first, then faces may be hidden without recomputing normals.
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
    Allocator& alloc) noexcept;

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
    Allocator& alloc) noexcept;

Status appendTerrainFallbackGeometryForLevel(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    i32 level,
    i32 startX,
    i32 startY,
    i32 endX,
    i32 endY,
    i32 border,
    SceneCommandStream* debugOut,
    TerrainTileFaceCountGrid* debugGrid,
    Vec<u8>* outTileHasValidFaceColorsAForLowDetail,
    SceneBuffer* buffer,
    i32* outLevelElements,
    DecodedUnderlayTypeCache* underlayCache,
    DecodedOverlayTypeCache* overlayCache,
    Allocator& alloc) noexcept;

// Computes `tileHasValidFaceColorsAForLowDetail` without emitting terrain geometry.
// This is used by plan-only builds so loc low-detail decisions match full builds.
Status analyzeTerrainLowDetailTileFlags(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    i32 startX,
    i32 startY,
    i32 endX,
    i32 endY,
    i32 border,
    Vec<u8>* outTileHasValidFaceColorsAForLowDetail,
    DecodedUnderlayTypeCache* underlayCache,
    DecodedOverlayTypeCache* overlayCache,
    Allocator& alloc) noexcept;

Status emitLocCommandsFromMapLocBytes(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const Vec<u8>* tileHasValidFaceColorsAForLowDetail,
    Vec<SceneCommandPlanDebugOp>* planOps,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    DecodedVarBitTypeCache* varbitCache,
    DecodedSeqTypeCache* seqTypeCache,
    DecodedModelFaceStatsCache* modelCache,
    SceneCommandStream* debugOut,
    Vec<LocAnimatedGroupPlan>* outAnimatedGroups,
    Vec<LocAnimatedPlaceholder>* outAnimatedEntries,
    Allocator& alloc) noexcept;

// Append animated loc frame geometry and emit placeholder commands (offset=0/elements=0) after the static
// geometry has been emitted. The runtime tick-state patcher later overwrites placeholder offsets.
Status emitLocAnimatedFramesAndPlaceholdersFromPlannedGroups(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Span<const LocAnimatedGroupPlan> groups,
    Span<const LocAnimatedPlaceholder> entries,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedLocTypeCache* locTypeCache,
    DecodedSeqTypeCache* seqTypeCache,
    SceneLocAnimatedTickInit* outTickInit,
    Allocator& alloc) noexcept;

Status appendLocPlanOpsFromMapLocBytes(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    const Vec<u8>* tileHasValidFaceColorsAForLowDetail,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedLocTypeCache* locTypeCache,
    DecodedVarBitTypeCache* varbitCache,
    DecodedSeqTypeCache* seqTypeCache,
    DecodedModelFaceStatsCache* modelCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept;

Status emitObjCommandsFromPackedSpawns(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Vec<SceneCommandPlanDebugOp>* planOps,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedObjTypeCache* objTypeCache,
    DecodedModelFaceStatsCache* objModelCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept;

Status appendObjPlanOpsFromPackedSpawns(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Vec<SceneCommandPlanDebugOp>* planOps,
    DecodedObjTypeCache* objTypeCache,
    DecodedModelFaceStatsCache* objModelCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept;

} // namespace scb
} // namespace rs
