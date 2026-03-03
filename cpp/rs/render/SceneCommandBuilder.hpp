#pragma once

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../types.hpp"
#include "RuntimeCommandStreamPlan.hpp"

namespace rs {

struct LocType;
struct SeqBase;
struct SeqFrame;
struct ModelData;

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
    bool loadObjs = true;
    i32 cacheGame = 0;
    i32 cacheRevision = 0;
    i32 unitsTileHeightBasis = 0;
    // Keep expensive debug-only post passes disabled in runtime hot paths.
    bool enableExpensiveDebugStats = true;
    // Debug only: when collecting terrain digest samples, skip this many vertices
    // (hash still includes skipped vertices; this only affects which 512 vertices are captured).
    i32 debugTerrainDigestSampleStartVertex = 0;
    // Debug only: capture computed terrain inputs for a single tile (level,x,y) during build.
    // Use -1 to disable.
    i32 debugTerrainProbeLevel = -1;
    i32 debugTerrainProbeTileX = -1;
    i32 debugTerrainProbeTileY = -1;
    // Debug only: capture a single world-height bilinear sample (used by contouring and other
    // height lookups). When worldX/worldZ are -1, the first sample on the requested level is captured.
    // Use level=-1 to disable.
    i32 debugWorldHeightProbeLevel = -1;
    i32 debugWorldHeightProbeWorldX = -1;
    i32 debugWorldHeightProbeWorldZ = -1;
    // Debug only: optional loc-type filter for vertex probes, so parity can avoid hitting unrelated
    // locs that share the same output coordinate.
    i32 debugWorldHeightProbeLocId = -1;
    // Debug only: optional packed-vertex index probe (global vertex index in the packed vertex stream).
    // When set, vertex-probe capture triggers on the exact emitted packed vertex index, avoiding
    // coordinate collisions.
    i32 debugPackedVertexProbeIndex = -1;

    Span<const i32> mapSquareIds{};
    Span<const i32> terrainOffsets{};
    Span<const i32> terrainLengths{};
    Span<const u8> terrainBytes{};
    Span<const i32> locOffsets{};
    Span<const i32> locLengths{};
    Span<const u8> locBytes{};
    Span<const i32> varpValues{};

    // Byte-driven resource provider (blob-store backed in wasm runtime).
    //
    // `kind` matches the (100+kind) domain convention used by the runtime cache:
    //   1=loc 2=varbit 3=model 5=seqType 6=seqFrame 8=bas 10=underlay 11=overlay
    //   12=obj 13=objSpawns 14=seqAlphaHint 15=seqBase 16=skeletalSeq
    // Implementations may return empty spans for presence-only kinds (e.g., textures), but
    // core decode paths treat empty bytes as NotFound for real types.
    const void* typeEntryBytesCtx = nullptr;
    Status (*tryGetTypeEntryBytes)(
        const void* ctx,
        i32 kind,
        i32 id,
        Span<const u8>* outBytes) = nullptr;

    // Texture presence lists (blob-store-backed, presence encoded by domain/group/file ids).
    //
    // TS parity notes:
    // - ModelData.light() considers a face "textured" iff `textureId != -1 && textureLoader.isSd(textureId)`.
    // - Packed texture indices stored in vertices use `createSdTexturePacking(...).textureIds`, which is
    //   the SD texture id list truncated to the first 2047 entries; ids beyond that still count as "textured"
    //   for transparency decisions, but pack as -1 in vertex data.
    Span<const i32> textureTransparentIds{};
    // Ordered list of all SD texture ids (not truncated to 2047). Packed index is `index < 2047 ? index : -1`.
    Span<const i32> textureIds{};

    // Optional fallback for dat (classic) seq frames: these do not have stable per-frame
    // raw bytes, so the runtime can provide decoded base+frame directly from frame-map blobs.
    const void* datSeqFrameCtx = nullptr;
    Status (*tryLoadDatSeqFrame)(
        const void* ctx,
        i32 frameId,
        SeqBase* outBase,
        SeqFrame* outFrame,
        Allocator& alloc) = nullptr;

    // Optional fallback for legacy seq frames: upload raw legacy base/frame named files once,
    // then let runtime decode+cache classic base+frame per id.
    const void* legacySeqFrameCtx = nullptr;
    Status (*tryLoadLegacySeqFrame)(
        const void* ctx,
        i32 frameId,
        SeqBase* outBase,
        SeqFrame* outFrame,
        Allocator& alloc) = nullptr;

    // Optional fallback for classic (legacy) model decoding when per-model raw bytes are not available.
    // Used by the wasm runtime-cache path for legacy caches (models are stored in split .dat tables).
    const void* modelDataCtx = nullptr;
    Status (*tryLoadModelData)(
        const void* ctx,
        i32 modelId,
        ModelData* outModel,
        Allocator& alloc) = nullptr;

    // Debug-only: record the first missing type entry encountered during command-stream build.
    const void* debugMissingTypeCtx = nullptr;
    void (*debugRecordMissingType)(const void* ctx, i32 kind, i32 id) = nullptr;
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

    // Terrain digest sample records (parity/debug): first N vertex records used for the digest.
    // Stride=10 i32:
    //   [0]=x [1]=y [2]=z [3]=hsl [4]=quantU4096 [5]=quantV4096
    //   [6]=tex0Packed [7]=tex1Packed [8]=texBlendInt [9]=hashAfterVertex
    static constexpr i32 kDebugTerrainDigestSampleVertexLimit = 512;
    static constexpr i32 kDebugTerrainDigestSampleStrideInts = 10;
    i32 debugTerrainDigestSampleCount = 0;
    i32 debugTerrainDigestSampleStrideInts = kDebugTerrainDigestSampleStrideInts;
    i32 debugTerrainDigestSampleStartVertex = 0;
    i32 debugTerrainDigestVertexCursor = 0;
    i32 debugTerrainDigestSamplesPacked
        [kDebugTerrainDigestSampleVertexLimit * kDebugTerrainDigestSampleStrideInts]{};

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

    // Debug-only: a single terrain tile probe captured during terrain emission.
    // Packed i32 payload (length=32) is interpreted by parity/debug scripts.
    i32 debugTerrainProbeHit = 0;
    i32 debugTerrainProbeLevel = -1;
    i32 debugTerrainProbeTileX = -1;
    i32 debugTerrainProbeTileY = -1;
    // Debug-only probe payload. Size is intentionally generous so we can evolve
    // diagnostics without touching the runtime vertex/index contracts.
    i32 debugTerrainProbePacked[64]{};

    // Debug-only: a single bilinear height sample probe captured from world sampling.
    // Set via SceneCommandBuildInput debugWorldHeightProbe*.
    // Packed payload (length=16):
    //   [0]=ok(0/1)
    //   [1]=tx [2]=tz [3]=rx [4]=rz
    //   [5]=h00 [6]=h10 [7]=h01 [8]=h11
    //   [9]=h0Numerator [10]=h0 [11]=h1Numerator [12]=h1
    //   [13]=hNumerator [14]=height [15]=baseY (vertex Y before contour)
    i32 debugWorldHeightProbeHit = 0;
    i32 debugWorldHeightProbeLevel = -1;
    i32 debugWorldHeightProbeWorldX = -1;
    i32 debugWorldHeightProbeWorldZ = -1;
    i32 debugWorldHeightProbeLocId = -1;
    i32 debugPackedVertexProbeIndex = -1;
    // Packed payload for world-height sample probe and (optionally) a vertex-probe overlay.
    // The first 16 entries match the original layout; extra entries are debug-only extensions.
    i32 debugWorldHeightProbePacked[32]{};

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
    // Packed plan op provenance (debug only): one entry per plan op in the same order.
    // Stride=8 i32:
    //   [0]=sourceKind (0 unknown, 1 loc, 2 obj)
    //   [1]=typeId (locTypeId/objTypeId or -1)
    //   [2]=placementTypeHint
    //   [3]=placementRotationHint
    //   [4]=modelIdHint
    //   [5]=modelIdsHashHint
    //   [6]=levelHint
    //   [7]=priorityHint
    Vec<i32> debugSceneCommandPlanOpProvenancePacked{};

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
    i32 debugLocPlanTotalUs = 0;
    i32 debugLocPlanSortPlacementsUs = 0;
    i32 debugLocPlanMergeNormalsUs = 0;
    i32 debugLocPlanPlacementLoopUs = 0;
    i32 debugLocPlanRenderPlanUs = 0;
    i32 debugLocPlanAnimatedOrderUs = 0;
    i32 debugLocExecuteTotalUs = 0;
    i32 debugLocExecuteInstancedUs = 0;
    i32 debugLocExecuteMergedUs = 0;
    i32 debugBuildFinalizeAnimatedLocUs = 0;

    Vec<u8> debugTerrainTileFaceCounts{};
    Vec<i32> debugLocPreMergeGroupKeySignatures{};
    Vec<i32> debugLocRenderPlacementEntriesPacked{};
    Vec<i32> debugLocPreMergeGroupKeyEntriesPacked{};
    Vec<i32> debugLocMergeDecisionEntriesPacked{};
    // Loc merged-command emission records (debug): stride=13 i32.
    // [0]=offsetElements [1]=elements [2]=locTypeId [3]=placementType [4]=placementRotation
    // [5]=level [6]=priority [7]=transparent(0/1) [8]=includeLod(0/1)
    // [9]=groupIndex [10]=instanceIndex
    // [11]=hasFaceRenderPriorities(0/1/-1 unknown)
    // [12]=faceRenderPrioritiesLength(-1 unknown)
    Vec<i32> debugLocMergeEmitEntriesPacked{};
    // Loc mergeNormals trace entries (debug): stride=22 i32.
    // [0..7]  A{locTypeId,placementType,rotation,level,tileX,tileY,sizeX,sizeY}
    // [8..15] B{locTypeId,placementType,rotation,level,tileX,tileY,sizeX,sizeY}
    // [16..20] offX,offY,offZ,hideOccluded(0/1),mergedCount
    // [21] callKind: 1=mergeLargeLocNormals, 2=wallPair, 3=mergeFloorNormals
    Vec<i32> debugLocMergeNormalsTraceEntriesPacked{};
    Vec<i32> debugCommandProvenancePacked{};
    i32 debugTerrainTileFaceCountsLevels = 0;
    i32 debugTerrainTileFaceCountsWidth = 0;
    i32 debugTerrainTileFaceCountsHeight = 0;
    i32 debugTerrainTileFaceCountsBorder = 0;
    i32 debugBuildSetupUs = 0;
    i32 debugBuildSceneBuildUs = 0;
    i32 debugBuildTerrainUs = 0;
    i32 debugBuildLocUs = 0;
    i32 debugBuildObjUs = 0;
    i32 debugBuildFinalizeUs = 0;
    i32 debugBuildTotalUs = 0;

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
        debugLocRenderPlacementEntriesPacked = Vec<i32>(alloc);
        debugLocPreMergeGroupKeyEntriesPacked = Vec<i32>(alloc);
        debugLocMergeDecisionEntriesPacked = Vec<i32>(alloc);
        debugLocMergeEmitEntriesPacked = Vec<i32>(alloc);
        debugLocMergeNormalsTraceEntriesPacked = Vec<i32>(alloc);
        debugCommandProvenancePacked = Vec<i32>(alloc);
        debugSceneCommandPlanOpsPacked = Vec<i32>(alloc);
        debugSceneCommandPlanOpProvenancePacked = Vec<i32>(alloc);
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
        debugLocRenderPlacementEntriesPacked.clear();
        debugLocPreMergeGroupKeyEntriesPacked.clear();
        debugLocMergeDecisionEntriesPacked.clear();
        debugLocMergeEmitEntriesPacked.clear();
        debugLocMergeNormalsTraceEntriesPacked.clear();
        debugCommandProvenancePacked.clear();
        debugSceneCommandPlanOpsPacked.clear();
        debugSceneCommandPlanOpProvenancePacked.clear();
        debugTerrainTileFaceCountsLevels = 0;
        debugTerrainTileFaceCountsWidth = 0;
        debugTerrainTileFaceCountsHeight = 0;
        debugTerrainTileFaceCountsBorder = 0;
        debugBuildSetupUs = 0;
        debugBuildSceneBuildUs = 0;
        debugBuildTerrainUs = 0;
        debugBuildLocUs = 0;
        debugBuildObjUs = 0;
        debugBuildFinalizeUs = 0;
        debugBuildTotalUs = 0;

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

        debugTerrainDigestSampleCount = 0;
        debugTerrainDigestSampleStrideInts = kDebugTerrainDigestSampleStrideInts;
        debugTerrainDigestSampleStartVertex = 0;
        debugTerrainDigestVertexCursor = 0;

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

        debugTerrainProbeHit = 0;
        debugTerrainProbeLevel = -1;
        debugTerrainProbeTileX = -1;
        debugTerrainProbeTileY = -1;
        for (std::size_t i = 0; i < (sizeof(debugTerrainProbePacked) / sizeof(debugTerrainProbePacked[0])); i++) {
            debugTerrainProbePacked[i] = 0;
        }

        debugWorldHeightProbeHit = 0;
        debugWorldHeightProbeLevel = -1;
        debugWorldHeightProbeWorldX = -1;
        debugWorldHeightProbeWorldZ = -1;
        debugWorldHeightProbeLocId = -1;
        debugPackedVertexProbeIndex = -1;
        for (std::size_t i = 0; i < (sizeof(debugWorldHeightProbePacked) / sizeof(debugWorldHeightProbePacked[0])); i++) {
            debugWorldHeightProbePacked[i] = 0;
        }
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
        debugLocPlanTotalUs = 0;
        debugLocPlanSortPlacementsUs = 0;
        debugLocPlanMergeNormalsUs = 0;
        debugLocPlanPlacementLoopUs = 0;
        debugLocPlanRenderPlanUs = 0;
        debugLocPlanAnimatedOrderUs = 0;
        debugLocExecuteTotalUs = 0;
        debugLocExecuteInstancedUs = 0;
        debugLocExecuteMergedUs = 0;
        debugBuildFinalizeAnimatedLocUs = 0;
    }
};

// Function-level loc placement stage output (resolved type already known).
struct SceneLocRenderPlacementStageInput final {
    const LocType* resolvedLocType = nullptr;
    i32 placementId = -1;
    i32 placementType = 0;
    // Mirrors TS SceneBuilder LocLoadType (0=MODELS, 1=NO_MODELS).
    i32 locLoadType = 0;
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

// Optional loc-animation tick-state init produced during scene command stream build.
// This is used by the wasm runtime to register per-map tick state without TS packing.
//
// Layout mirrors the tick backend contracts in cpp/tools/rs_map_render_backend.cpp:
// - Per-loc arrays have length=locCount (entries.size()) and align to animated placeholder order.
// - Anim frame tables are packed as [offsetBytes, elements, instances] tuples (stride=3) concatenated
//   by group; per-loc offsets/counts reference into these packed arrays.
struct SceneLocAnimatedTickInit final {
    // Per-loc metadata.
    Vec<i32> locSeqIds{};
    Vec<i32> locRandomStart{}; // 0/1
    Vec<i32> locSortKeys{}; // stable ordering key (used for deterministic random start)

    // Per-loc placeholder draw-range indices by bucket (or -1 when absent).
    Vec<i32> locDrawRangeIndicesBase{};
    Vec<i32> locDrawRangeIndicesAlpha{};
    Vec<i32> locDrawRangeIndicesLod{};
    Vec<i32> locDrawRangeIndicesLodAlpha{};
    Vec<i32> locDrawRangeIndicesInteract{};
    Vec<i32> locDrawRangeIndicesInteractAlpha{};
    Vec<i32> locDrawRangeIndicesInteractLod{};
    Vec<i32> locDrawRangeIndicesInteractLodAlpha{};

    // Per-loc offsets/counts into packed anim frame tables.
    Vec<i32> locAnimFrameOffsetsBase{};
    Vec<i32> locAnimFrameCountsBase{};
    Vec<i32> locAnimFrameOffsetsAlpha{};
    Vec<i32> locAnimFrameCountsAlpha{};

    // Packed frame tables (stride=3): [offsetBytes, elements, instances]
    Vec<i32> locAnimFramesBasePacked{};
    Vec<i32> locAnimFramesAlphaPacked{};

    Result<void> init(Allocator& alloc) noexcept {
        locSeqIds = Vec<i32>(alloc);
        locRandomStart = Vec<i32>(alloc);
        locSortKeys = Vec<i32>(alloc);
        locDrawRangeIndicesBase = Vec<i32>(alloc);
        locDrawRangeIndicesAlpha = Vec<i32>(alloc);
        locDrawRangeIndicesLod = Vec<i32>(alloc);
        locDrawRangeIndicesLodAlpha = Vec<i32>(alloc);
        locDrawRangeIndicesInteract = Vec<i32>(alloc);
        locDrawRangeIndicesInteractAlpha = Vec<i32>(alloc);
        locDrawRangeIndicesInteractLod = Vec<i32>(alloc);
        locDrawRangeIndicesInteractLodAlpha = Vec<i32>(alloc);
        locAnimFrameOffsetsBase = Vec<i32>(alloc);
        locAnimFrameCountsBase = Vec<i32>(alloc);
        locAnimFrameOffsetsAlpha = Vec<i32>(alloc);
        locAnimFrameCountsAlpha = Vec<i32>(alloc);
        locAnimFramesBasePacked = Vec<i32>(alloc);
        locAnimFramesAlphaPacked = Vec<i32>(alloc);
        return Result<void>::ok();
    }

    void clear() noexcept {
        locSeqIds.clear();
        locRandomStart.clear();
        locSortKeys.clear();
        locDrawRangeIndicesBase.clear();
        locDrawRangeIndicesAlpha.clear();
        locDrawRangeIndicesLod.clear();
        locDrawRangeIndicesLodAlpha.clear();
        locDrawRangeIndicesInteract.clear();
        locDrawRangeIndicesInteractAlpha.clear();
        locDrawRangeIndicesInteractLod.clear();
        locDrawRangeIndicesInteractLodAlpha.clear();
        locAnimFrameOffsetsBase.clear();
        locAnimFrameCountsBase.clear();
        locAnimFrameOffsetsAlpha.clear();
        locAnimFrameCountsAlpha.clear();
        locAnimFramesBasePacked.clear();
        locAnimFramesAlphaPacked.clear();
    }
};

bool sceneLocCommandGroupKeysEqual(
    const SceneLocCommandGroupKey& a,
    const SceneLocCommandGroupKey& b) noexcept;

// Builds runtime command stream from byte-driven scene inputs.
Status buildSceneCommandStream(
    const SceneCommandBuildInput& input,
    SceneCommandStream* out,
    Allocator& alloc = defaultAllocator()) noexcept;

// Builds runtime command stream and also captures loc-animation tick init data (if any).
Status buildSceneCommandStreamWithLocAnimatedTickInit(
    const SceneCommandBuildInput& input,
    SceneCommandStream* out,
    SceneLocAnimatedTickInit* outTickInit,
    Allocator& alloc = defaultAllocator()) noexcept;

// Builds only scene plan/debug outputs (no vertex/index or command bucket emission).
Status buildSceneCommandPlanOnly(
    const SceneCommandBuildInput& input,
    SceneCommandStream* out,
    Allocator& alloc = defaultAllocator()) noexcept;

} // namespace rs
