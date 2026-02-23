#pragma once

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"
#include "SceneCommandPlan.hpp"

namespace rs {

struct LocType;

// Native scene-command build input for byte-driven runtime map builds.
struct SceneCommandBuildInput final {
    i32 baseX = 0;
    i32 baseY = 0;
    i32 sizeX = 0;
    i32 sizeY = 0;
    bool smoothTerrain = true;
    bool minimizeDrawCalls = false;
    i32 locLoadType = 0;
    bool loadLocs = true;
    i32 cacheGame = 0;
    i32 cacheRevision = 0;
    i32 unitsTileHeightBasis = 0;

    Span<const i32> mapSquareIds{};
    Span<const i32> terrainOffsets{};
    Span<const i32> terrainLengths{};
    Span<const u8> terrainBytes{};
    Span<const i32> locOffsets{};
    Span<const i32> locLengths{};
    Span<const u8> locBytes{};
    Span<const i32> locTypeIds{};
    Span<const i32> locTypeOffsets{};
    Span<const i32> locTypeLengths{};
    Span<const u8> locTypeBytes{};
    Span<const i32> varbitIds{};
    Span<const i32> varbitOffsets{};
    Span<const i32> varbitLengths{};
    Span<const u8> varbitBytes{};
    Span<const i32> varpValues{};
    Span<const i32> modelIds{};
    Span<const i32> modelOffsets{};
    Span<const i32> modelLengths{};
    Span<const u8> modelBytes{};
    Span<const i32> objTypeIds{};
    Span<const i32> objTypeOffsets{};
    Span<const i32> objTypeLengths{};
    Span<const u8> objTypeBytes{};
    Span<const i32> objSpawnMapIds{};
    Span<const i32> objSpawnOffsets{};
    Span<const i32> objSpawnLengths{};
    Span<const u8> objSpawnBytes{};
    Span<const i32> textureTransparentIds{};
    Span<const i32> textureIds{};
    Span<const i32> underlayTypeIds{};
    Span<const i32> underlayTypeOffsets{};
    Span<const i32> underlayTypeLengths{};
    Span<const u8> underlayTypeBytes{};
    Span<const i32> overlayTypeIds{};
    Span<const i32> overlayTypeOffsets{};
    Span<const i32> overlayTypeLengths{};
    Span<const u8> overlayTypeBytes{};
    Span<const i32> seqTypeIds{};
    Span<const i32> seqTypeOffsets{};
    Span<const i32> seqTypeLengths{};
    Span<const u8> seqTypeBytes{};
    Span<const i32> seqFrameIds{};
    Span<const i32> seqFrameOffsets{};
    Span<const i32> seqFrameLengths{};
    Span<const u8> seqFrameBytes{};
    Span<const i32> seqAlphaHintIds{};
    Span<const i32> seqAlphaHintOffsets{};
    Span<const i32> seqAlphaHintLengths{};
    Span<const u8> seqAlphaHintBytes{};

};

// Runtime command stream shape consumed by command-stream packing.
struct SceneCommandStream final {
    Vec<i32> cmdBucketIndices{};
    Vec<i32> cmdOffsets{};
    Vec<i32> cmdElements{};
    Vec<i32> cmdInstanceCounts{};
    Vec<i32> cmdPackedInstances{};
    Vec<u8> vertices{};
    Vec<i32> indices{};

    i32 debugTerrainTilesConsidered = 0;
    i32 debugTerrainTilesEmitted = 0;
    i32 debugTerrainFacesEmitted = 0;
    i32 debugTerrainFacesUnderlayLevel0 = 0;
    i32 debugTerrainFacesUnderlayLevel1 = 0;
    i32 debugTerrainFacesUnderlayLevel2 = 0;
    i32 debugTerrainFacesUnderlayLevel3 = 0;
    i32 debugTerrainFacesOverlayLevel0 = 0;
    i32 debugTerrainFacesOverlayLevel1 = 0;
    i32 debugTerrainFacesOverlayLevel2 = 0;
    i32 debugTerrainFacesOverlayLevel3 = 0;

    // Terrain geometry digest (TS parity helper): based on emitted terrain vertices (pre-pack).
    // Hash matches TS `summarizeTerrainGeometry` (FNV-1a over x,y,z,hsl,quantized u/v, tex0/tex1, texBlend).
    i32 debugTerrainDigestHash = 0;
    i32 debugTerrainDigestFacesTotal = 0;
    i32 debugTerrainDigestVerticesTotal = 0;
    i32 debugTerrainDigestLevelFaces0 = 0;
    i32 debugTerrainDigestLevelFaces1 = 0;
    i32 debugTerrainDigestLevelFaces2 = 0;
    i32 debugTerrainDigestLevelFaces3 = 0;
    i32 debugTerrainDigestLevelVertices0 = 0;
    i32 debugTerrainDigestLevelVertices1 = 0;
    i32 debugTerrainDigestLevelVertices2 = 0;
    i32 debugTerrainDigestLevelVertices3 = 0;

    // Scene command plan digest (TS parity helper): matches src/renderer/buffer/SceneCommandPlan.ts.
    i32 debugSceneCommandPlanOpCount = 0;
    i32 debugSceneCommandPlanMergedGroupOpCount = 0;
    i32 debugSceneCommandPlanInstancedOpCount = 0;
    i32 debugSceneCommandPlanInstancedFacesTotal = 0;
    i32 debugSceneCommandPlanInstancedInstancesTotal = 0;
    i32 debugSceneCommandPlanInstancedLodInstancesTotal = 0;
    i32 debugSceneCommandPlanSeqHash = 0;
    i32 debugSceneCommandPlanMultisetHashSum = 0;
    i32 debugSceneCommandPlanMultisetHashXor = 0;
    // Packed plan ops (TS parity helper) to chase the first divergence.
    // Stride=6 i32:
    //   [0]=kind (1 instanced, 2 mergedGroup)
    //   [1]=transparent (0/1)
    //   instanced: [2]=modelHash [3]=faceCount [4]=instanceCount [5]=lodInstanceCount
    //   mergedGroup: [2]=lowDetail (0/1) [3]=level [4]=priority [5]=modelCount
    Vec<i32> debugSceneCommandPlanOpsPacked{};

    // SceneBuffer command-bucket digest (TS parity helper): pre-pack bucket content.
    // Hash is FNV-1a 32-bit updated per-int with multiplication (matches TS fnv1a32UpdateInt).
    i32 debugSceneBucketsCmdTotal = 0;
    i32 debugSceneBucketsInstanceTotal = 0;
    i32 debugSceneBucketsHash = 0;
    i32 debugSceneBucketsCmdCount0 = 0;
    i32 debugSceneBucketsCmdCount1 = 0;
    i32 debugSceneBucketsCmdCount2 = 0;
    i32 debugSceneBucketsCmdCount3 = 0;
    i32 debugSceneBucketsCmdCount4 = 0;
    i32 debugSceneBucketsCmdCount5 = 0;
    i32 debugSceneBucketsCmdCount6 = 0;
    i32 debugSceneBucketsCmdCount7 = 0;

    // Loc render placement stage digest (TS parity helper): see scripts/cache/map-render-runtime-cache-v2-parity.ts.
    i32 debugLocRenderPlacementDigestHash = 0;
    i32 debugLocRenderPlacementCount = 0;
    i32 debugLocPlacementsDecoded = 0;
    i32 debugLocPlacementsInBounds = 0;
    i32 debugLocPlacementsResolved = 0;
    i32 debugLocResolveNotFound = 0;
    i32 debugLocNoModelsForPlacement = 0;
    i32 debugLocModelCandidates = 0;
    i32 debugLocModelStatsDecodeFailed = 0;
    i32 debugLocModelStatsNotFound = 0;
    i32 debugLocModelStatsOtherError = 0;
    i32 debugLocMissingModelSampleCount = 0;
    i32 debugLocMissingModelSample0 = 0;
    i32 debugLocMissingModelSample1 = 0;
    i32 debugLocMissingModelSample2 = 0;
    i32 debugLocMissingModelSample3 = 0;
    i32 debugLocMissingModelLocTypeId = 0;
    i32 debugLocMissingModelPlacementType = 0;
    i32 debugLocMissingModelRotation = 0;
    i32 debugLocModelStatsZeroFaces = 0;
    i32 debugLocGroupStatsMismatch = 0;
    i32 debugLocPlacementsQueuedAnyModel = 0;
    i32 debugLocInstancesQueued = 0;
    i32 debugLocAnimatedNoFaces = 0;
    i32 debugLocAnimatedQueued = 0;
    i32 debugObjSpawnsDecoded = 0;
    i32 debugObjSpawnsInBounds = 0;
    i32 debugObjModelCandidates = 0;
    i32 debugObjInstancesQueued = 0;
    i32 debugLocMergeByPlacementCount = 0;
    i32 debugLocInstancedGroupCount = 0;
    i32 debugLocVariantGroupsQueued = 0;
    i32 debugLocVariantGroupsHash = 0;
    i32 debugLocVariantType9Queued = 0;
    i32 debugLocVariantType0Queued = 0;
    i32 debugLocVariantId1651Type9Queued = 0;
    i32 debugLocVariantId1651Type0Queued = 0;
    i32 debugLocVariantCandidatesExpanded = 0;
    i32 debugLocVariantDecodeFailed = 0;
    i32 debugLocPreMergeGroupKeysQueued = 0;
    i32 debugLocPreMergeGroupKeysHash = 0;
    i32 debugLocMergedDummyCommandCount = 0;
    i32 debugLocMergedDummyElementsTotal = 0;
    i32 debugLocMergedDummyHash = 0;
    i32 debugLocMergedDummyBaseCount = 0;
    i32 debugLocMergedDummyAlphaCount = 0;
    i32 debugLocMergedDummyLodCount = 0;
    i32 debugLocMergedDummyLodAlphaCount = 0;
    i32 debugObjMergeByPlacementCount = 0;
    i32 debugObjInstancedGroupCount = 0;
    i32 debugGeometryElementMismatchCount = 0;
    i32 debugGeometryElementMismatchTotalDelta = 0;
    i32 debugGeometryElementMismatchMaxDelta = 0;
    i32 debugGeometryElementMismatchSampleTypeId = 0;
    i32 debugGeometryElementMismatchSamplePlacementType = 0;
    i32 debugGeometryElementMismatchSampleRotation = 0;

    Vec<u8> debugTerrainTileFaceCounts{};
    Vec<i32> debugLocPreMergeGroupKeySignatures{};
    Vec<i32> debugLocPreMergeGroupKeyEntriesPacked{};
    Vec<i32> debugLocMergeDecisionEntriesPacked{};
    Vec<i32> debugCommandProvenancePacked{};
    i32 debugTerrainTileFaceCountsLevels = 0;
    i32 debugTerrainTileFaceCountsWidth = 0;
    i32 debugTerrainTileFaceCountsHeight = 0;
    i32 debugTerrainTileFaceCountsBorder = 0;

    Result<void> init(Allocator& alloc) noexcept {
        cmdBucketIndices = Vec<i32>(alloc);
        cmdOffsets = Vec<i32>(alloc);
        cmdElements = Vec<i32>(alloc);
        cmdInstanceCounts = Vec<i32>(alloc);
        cmdPackedInstances = Vec<i32>(alloc);
        vertices = Vec<u8>(alloc);
        indices = Vec<i32>(alloc);
        debugTerrainTileFaceCounts = Vec<u8>(alloc);
        debugLocPreMergeGroupKeySignatures = Vec<i32>(alloc);
        debugLocPreMergeGroupKeyEntriesPacked = Vec<i32>(alloc);
        debugLocMergeDecisionEntriesPacked = Vec<i32>(alloc);
        debugCommandProvenancePacked = Vec<i32>(alloc);
        debugSceneCommandPlanOpsPacked = Vec<i32>(alloc);
        return Result<void>::ok();
    }

    void clear() noexcept {
        cmdBucketIndices.clear();
        cmdOffsets.clear();
        cmdElements.clear();
        cmdInstanceCounts.clear();
        cmdPackedInstances.clear();
        vertices.clear();
        indices.clear();
        debugTerrainTileFaceCounts.clear();
        debugLocPreMergeGroupKeySignatures.clear();
        debugLocPreMergeGroupKeyEntriesPacked.clear();
        debugLocMergeDecisionEntriesPacked.clear();
        debugCommandProvenancePacked.clear();
        debugSceneCommandPlanOpsPacked.clear();
        debugTerrainTileFaceCountsLevels = 0;
        debugTerrainTileFaceCountsWidth = 0;
        debugTerrainTileFaceCountsHeight = 0;
        debugTerrainTileFaceCountsBorder = 0;

        debugTerrainTilesConsidered = 0;
        debugTerrainTilesEmitted = 0;
        debugTerrainFacesEmitted = 0;
        debugTerrainFacesUnderlayLevel0 = 0;
        debugTerrainFacesUnderlayLevel1 = 0;
        debugTerrainFacesUnderlayLevel2 = 0;
        debugTerrainFacesUnderlayLevel3 = 0;
        debugTerrainFacesOverlayLevel0 = 0;
        debugTerrainFacesOverlayLevel1 = 0;
        debugTerrainFacesOverlayLevel2 = 0;
        debugTerrainFacesOverlayLevel3 = 0;

        // FNV-1a 32-bit offset basis.
        debugTerrainDigestHash = static_cast<i32>(2166136261u);
        debugTerrainDigestFacesTotal = 0;
        debugTerrainDigestVerticesTotal = 0;
        debugTerrainDigestLevelFaces0 = 0;
        debugTerrainDigestLevelFaces1 = 0;
        debugTerrainDigestLevelFaces2 = 0;
        debugTerrainDigestLevelFaces3 = 0;
        debugTerrainDigestLevelVertices0 = 0;
        debugTerrainDigestLevelVertices1 = 0;
        debugTerrainDigestLevelVertices2 = 0;
        debugTerrainDigestLevelVertices3 = 0;
        debugSceneCommandPlanOpCount = 0;
        debugSceneCommandPlanMergedGroupOpCount = 0;
        debugSceneCommandPlanInstancedOpCount = 0;
        debugSceneCommandPlanInstancedFacesTotal = 0;
        debugSceneCommandPlanInstancedInstancesTotal = 0;
        debugSceneCommandPlanInstancedLodInstancesTotal = 0;
        debugSceneCommandPlanSeqHash = static_cast<i32>(2166136261u);
        debugSceneCommandPlanMultisetHashSum = 0;
        debugSceneCommandPlanMultisetHashXor = 0;
        debugSceneBucketsCmdTotal = 0;
        debugSceneBucketsInstanceTotal = 0;
        debugSceneBucketsHash = static_cast<i32>(2166136261u);
        debugSceneBucketsCmdCount0 = 0;
        debugSceneBucketsCmdCount1 = 0;
        debugSceneBucketsCmdCount2 = 0;
        debugSceneBucketsCmdCount3 = 0;
        debugSceneBucketsCmdCount4 = 0;
        debugSceneBucketsCmdCount5 = 0;
        debugSceneBucketsCmdCount6 = 0;
        debugSceneBucketsCmdCount7 = 0;
        // FNV-1a 32-bit offset basis.
        debugLocRenderPlacementDigestHash = static_cast<i32>(2166136261u);
        debugLocRenderPlacementCount = 0;
        debugLocPlacementsDecoded = 0;
        debugLocPlacementsInBounds = 0;
        debugLocPlacementsResolved = 0;
        debugLocResolveNotFound = 0;
        debugLocNoModelsForPlacement = 0;
        debugLocModelCandidates = 0;
        debugLocModelStatsDecodeFailed = 0;
        debugLocModelStatsNotFound = 0;
        debugLocModelStatsOtherError = 0;
        debugLocMissingModelSampleCount = 0;
        debugLocMissingModelSample0 = 0;
        debugLocMissingModelSample1 = 0;
        debugLocMissingModelSample2 = 0;
        debugLocMissingModelSample3 = 0;
        debugLocMissingModelLocTypeId = 0;
        debugLocMissingModelPlacementType = 0;
        debugLocMissingModelRotation = 0;
        debugLocModelStatsZeroFaces = 0;
        debugLocGroupStatsMismatch = 0;
        debugLocPlacementsQueuedAnyModel = 0;
        debugLocInstancesQueued = 0;
        debugLocAnimatedNoFaces = 0;
        debugLocAnimatedQueued = 0;
        debugObjSpawnsDecoded = 0;
        debugObjSpawnsInBounds = 0;
        debugObjModelCandidates = 0;
        debugObjInstancesQueued = 0;
        debugLocMergeByPlacementCount = 0;
        debugLocInstancedGroupCount = 0;
        debugLocVariantGroupsQueued = 0;
        debugLocVariantGroupsHash = 0;
        debugLocVariantType9Queued = 0;
        debugLocVariantType0Queued = 0;
        debugLocVariantId1651Type9Queued = 0;
        debugLocVariantId1651Type0Queued = 0;
        debugLocVariantCandidatesExpanded = 0;
        debugLocVariantDecodeFailed = 0;
        debugLocPreMergeGroupKeysQueued = 0;
        debugLocPreMergeGroupKeysHash = 0;
        debugLocMergedDummyCommandCount = 0;
        debugLocMergedDummyElementsTotal = 0;
        debugLocMergedDummyHash = 0;
        debugLocMergedDummyBaseCount = 0;
        debugLocMergedDummyAlphaCount = 0;
        debugLocMergedDummyLodCount = 0;
        debugLocMergedDummyLodAlphaCount = 0;
        debugObjMergeByPlacementCount = 0;
        debugObjInstancedGroupCount = 0;
        debugGeometryElementMismatchCount = 0;
        debugGeometryElementMismatchTotalDelta = 0;
        debugGeometryElementMismatchMaxDelta = 0;
        debugGeometryElementMismatchSampleTypeId = 0;
        debugGeometryElementMismatchSamplePlacementType = 0;
        debugGeometryElementMismatchSampleRotation = 0;
    }
};

// Function-level loc placement stage output (resolved type already known).
struct SceneLocRenderPlacementStageInput final {
    const LocType* resolvedLocType = nullptr;
    i32 placementId = -1;
    i32 placementType = 0;
    bool baseHadTransforms = false;
    bool lowDetailPlacement = false;
};

struct SceneLocRenderPlacementStageOutput final {
    i32 seqId = -1;
    i32 priority = 1;
    i32 interactId = -1;
    bool includeLod = false;
    bool forceMerge = false;
    bool sourceIsEntity = false;
};

Status deriveSceneLocRenderPlacementStage(
    const SceneLocRenderPlacementStageInput& input,
    SceneLocRenderPlacementStageOutput* out) noexcept;

struct SceneLocPlacementModelVariant final {
    i32 placementType = 0;
    i32 rotation = 0;
};

i32 expandSceneLocPlacementModelVariants(
    i32 placementType,
    i32 rotation,
    SceneLocPlacementModelVariant* outVariants,
    i32 outCapacity) noexcept;

struct SceneLocCommandGroupKey final {
    i32 modelSignature = 0;
    i32 modelIdsHash = 0;
    i32 placementType = 0;
    i32 rotation = 0;
    i32 level = 0;
    i32 priority = 0;
    bool forceMerge = false;
    bool contourSensitive = false;
    i32 contourSceneHeight = 0;
    i32 contourSceneX = 0;
    i32 contourSceneZ = 0;
    i32 contourGround = 0;
    i32 contourProfileHash = 0;
};

bool sceneLocCommandGroupKeysEqual(
    const SceneLocCommandGroupKey& a,
    const SceneLocCommandGroupKey& b) noexcept;

// Builds runtime command stream from byte-driven scene inputs.
Status buildSceneCommandStream(
    const SceneCommandBuildInput& input,
    SceneCommandStream* out,
    Allocator& alloc = defaultAllocator()) noexcept;

} // namespace rs
