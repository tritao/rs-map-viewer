#include "../rs/types.hpp"
#include "../rs/map/NpcSpawnsDecode.hpp"
#include "../rs/map/TerrainConstants.hpp"
#include "../rs/map/TerrainSquareDecode.hpp"
#include "../rs/core/Allocator.hpp"
#include "../rs/core/Span.hpp"
#include "../rs/core/Vec.hpp"
#include "../rs/core/Status.hpp"
#include "../rs/cache/CacheInfo.hpp"
#include "../rs/config/TypeDecode.hpp"
#include "../rs/config/floortype/OverlayFloorType.hpp"
#include "../rs/config/loctype/LocType.hpp"
#include "../rs/config/objtype/ObjType.hpp"
#include "../rs/config/bastype/BasType.hpp"
#include "../rs/config/npctype/NpcType.hpp"
#include "../rs/config/seqtype/SeqType.hpp"
#include "../rs/config/vartype/VarBitType.hpp"
#include "../rs/core/StringArena.hpp"
#include "../rs/model/ModelData.hpp"
#include "../rs/model/LegacyModelLoader.hpp"
#include "../rs/model/seq/LegacySeqFrameLoader.hpp"
#include "../rs/model/seq/SeqFrame.hpp"
#include "../rs/model/seq/SeqFrameLoaderCommon.hpp"
#include "../rs/render/MapRenderRuntimeApi.hpp"
#include "../rs/render/SceneCommandBuilder.hpp"
#include "../rs/render/SceneCommandBuilderInternal.hpp"
#include "../rs/render/SceneCommandPack.hpp"
#include "../rs/scene/SceneBuildStages.hpp"
#include "MapRenderRuntimeBackendApi.hpp"
#include "MapRenderPacketStore.hpp"
#include "MapRenderRuntimeStore.hpp"
#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <limits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace {

static constexpr rs::i32 RS_TICK_STATE_PACKED_VERSION = 1;
static constexpr rs::i32 RS_TICK_STATE_PACKED_VERSION_V2_COMPACT = 2;
static constexpr rs::i32 RS_TICK_STATE_OUTPUT_PACKED_VERSION = 1;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_BUILD_STAGE_TIMINGS_LENGTH = 32;

enum MapRenderRuntimeBuildStageTimingIndex : rs::i32 {
    kBuildTimingTotalUs = 0,
    kBuildTimingCollectMapInputUs = 1,
    kBuildTimingSeedHashUs = 2,
    kBuildTimingBuildCommandStreamUs = 3,
    kBuildTimingRegisterTickStateUs = 4,
    kBuildTimingPlanPayloadUs = 5,
    kBuildTimingBuildPayloadUs = 6,
    kBuildTimingStorePayloadUs = 7,
    kBuildTimingBuildNpcUs = 8,
    kBuildTimingDeriveUsedTextureIdsUs = 9,
    kBuildTimingFinalizePayloadUs = 10,
    kBuildTimingCommandPrepareInputUs = 11,
    kBuildTimingCommandCoreBuildUs = 12,
    kBuildTimingCommandValidateUs = 13,
    kBuildTimingCommandCopyBuffersUs = 14,
    kBuildTimingCommandCopyDebugUs = 15,
    kBuildTimingCommandSetupUs = 16,
    kBuildTimingCommandSceneBuildUs = 17,
    kBuildTimingCommandTerrainUs = 18,
    kBuildTimingCommandLocUs = 19,
    kBuildTimingCommandObjUs = 20,
    kBuildTimingCommandFinalizeUs = 21,
    kBuildTimingCommandLocPlanUs = 22,
    kBuildTimingCommandLocPlanSortUs = 23,
    kBuildTimingCommandLocPlanMergeNormalsUs = 24,
    kBuildTimingCommandLocPlanPlacementLoopUs = 25,
    kBuildTimingCommandLocPlanRenderPlanUs = 26,
    kBuildTimingCommandLocPlanAnimatedOrderUs = 27,
    kBuildTimingCommandLocExecuteUs = 28,
    kBuildTimingCommandLocExecuteInstancedUs = 29,
    kBuildTimingCommandLocExecuteMergedUs = 30,
    kBuildTimingCommandFinalizeAnimatedLocUs = 31,
};

enum TickStateFieldIndex : rs::i32 {
    TICK_FIELD_LOC_FRAME_IDS = 0,
    TICK_FIELD_LOC_CYCLE_STARTS_FIXED = 1,
    TICK_FIELD_LOC_FRAME_STEPS = 2,
    TICK_FIELD_LOC_HAS_ANIM_MAYA = 3,
    TICK_FIELD_LOC_ANIM_MAYA_DURATIONS = 4,
    TICK_FIELD_LOC_FRAME_LENGTH_OFFSETS = 5,
    TICK_FIELD_LOC_FRAME_LENGTH_COUNTS = 6,
    TICK_FIELD_LOC_FRAME_LENGTHS_PACKED = 7,
    TICK_FIELD_LOC_DRAW_RANGE_INDICES_BASE = 8,
    TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_BASE = 9,
    TICK_FIELD_LOC_ANIM_FRAME_COUNTS_BASE = 10,
    TICK_FIELD_LOC_ANIM_FRAMES_BASE_PACKED = 11,
    TICK_FIELD_LOC_DRAW_RANGE_INDICES_ALPHA = 12,
    TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD = 13,
    TICK_FIELD_LOC_DRAW_RANGE_INDICES_LOD_ALPHA = 14,
    TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT = 15,
    TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_ALPHA = 16,
    TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD = 17,
    TICK_FIELD_LOC_DRAW_RANGE_INDICES_INTERACT_LOD_ALPHA = 18,
    TICK_FIELD_LOC_ANIM_FRAME_OFFSETS_ALPHA = 19,
    TICK_FIELD_LOC_ANIM_FRAME_COUNTS_ALPHA = 20,
    TICK_FIELD_LOC_ANIM_FRAMES_ALPHA_PACKED = 21,

    TICK_FIELD_NPC_X = 22,
    TICK_FIELD_NPC_Y = 23,
    TICK_FIELD_NPC_ORIENTATION = 24,
    TICK_FIELD_NPC_ROTATION = 25,
    TICK_FIELD_NPC_PATH_LENGTH = 26,
    TICK_FIELD_NPC_MOVEMENT_SEQ_ID = 27,
    TICK_FIELD_NPC_PATH_X_PACKED = 28,
    TICK_FIELD_NPC_PATH_Y_PACKED = 29,
    TICK_FIELD_NPC_PATH_MOVEMENT_TYPE_PACKED = 30,
    TICK_FIELD_NPC_SIZE = 31,
    TICK_FIELD_NPC_IS_CLICKABLE = 32,
    TICK_FIELD_NPC_ROTATION_SPEED = 33,
    TICK_FIELD_NPC_IDLE_SEQ_ID = 34,
    TICK_FIELD_NPC_WALK_SEQ_ID = 35,
    TICK_FIELD_NPC_HAS_WALK_ANIM = 36,
    TICK_FIELD_NPC_FRAME_IDS = 37,
    TICK_FIELD_NPC_FRAME_TICKS = 38,
    TICK_FIELD_NPC_MOVEMENT_LOOPS = 39,
    TICK_FIELD_NPC_IDLE_SEQ_VALID = 40,
    TICK_FIELD_NPC_IDLE_SEQ_HAS_ANIM_MAYA = 41,
    TICK_FIELD_NPC_IDLE_SEQ_ANIM_MAYA_DURATIONS = 42,
    TICK_FIELD_NPC_IDLE_SEQ_FRAME_STEPS = 43,
    TICK_FIELD_NPC_IDLE_SEQ_LOOPING = 44,
    TICK_FIELD_NPC_IDLE_SEQ_MAX_LOOPS = 45,
    TICK_FIELD_NPC_IDLE_SEQ_FRAME_ID_COUNTS = 46,
    TICK_FIELD_NPC_IDLE_SEQ_FRAME_LENGTH_OFFSETS = 47,
    TICK_FIELD_NPC_IDLE_SEQ_FRAME_LENGTH_COUNTS = 48,
    TICK_FIELD_NPC_WALK_SEQ_VALID = 49,
    TICK_FIELD_NPC_WALK_SEQ_HAS_ANIM_MAYA = 50,
    TICK_FIELD_NPC_WALK_SEQ_ANIM_MAYA_DURATIONS = 51,
    TICK_FIELD_NPC_WALK_SEQ_FRAME_STEPS = 52,
    TICK_FIELD_NPC_WALK_SEQ_LOOPING = 53,
    TICK_FIELD_NPC_WALK_SEQ_MAX_LOOPS = 54,
    TICK_FIELD_NPC_WALK_SEQ_FRAME_ID_COUNTS = 55,
    TICK_FIELD_NPC_WALK_SEQ_FRAME_LENGTH_OFFSETS = 56,
    TICK_FIELD_NPC_WALK_SEQ_FRAME_LENGTH_COUNTS = 57,
    TICK_FIELD_NPC_SEQ_FRAME_LENGTHS_PACKED = 58,
    TICK_FIELD_NPC_DRAW_RANGE_INDICES = 59,
    TICK_FIELD_NPC_IDLE_ANIM_FRAME_OFFSETS_BASE = 60,
    TICK_FIELD_NPC_IDLE_ANIM_FRAME_COUNTS_BASE = 61,
    TICK_FIELD_NPC_WALK_ANIM_FRAME_OFFSETS_BASE = 62,
    TICK_FIELD_NPC_WALK_ANIM_FRAME_COUNTS_BASE = 63,
    TICK_FIELD_NPC_ANIM_FRAMES_BASE_PACKED = 64,
    TICK_FIELD_NPC_IDLE_ANIM_FRAME_OFFSETS_ALPHA = 65,
    TICK_FIELD_NPC_IDLE_ANIM_FRAME_COUNTS_ALPHA = 66,
    TICK_FIELD_NPC_WALK_ANIM_FRAME_OFFSETS_ALPHA = 67,
    TICK_FIELD_NPC_WALK_ANIM_FRAME_COUNTS_ALPHA = 68,
    TICK_FIELD_NPC_ANIM_FRAMES_ALPHA_PACKED = 69,

    TICK_FIELD_COUNT = 70,
};

static constexpr rs::i32 RS_TICK_STATE_PACKED_FIELD_COUNT_V2 =
    TICK_FIELD_COUNT + 1;

struct MapRenderTickState {
    std::array<std::vector<rs::i32>, TICK_FIELD_COUNT> fields;
    rs::i32 locCount = 0;
    rs::i32 npcCount = 0;
    rs::i32 npcNullAlphaFrameOffset = 0;
};

struct MapRenderCachedCommandStream final {
    std::vector<rs::i32> cmdBucketIndices;
    std::vector<rs::i32> cmdOffsets;
    std::vector<rs::i32> cmdElements;
    std::vector<rs::i32> cmdInstanceCounts;
    std::vector<rs::i32> cmdPackedInstances;
    std::vector<rs::u8> vertices;
    std::vector<rs::i32> indices;
    std::vector<rs::i32> npcDrawRangesBase;
    std::vector<rs::i32> npcDrawRangesAlpha;
    std::vector<rs::u8> npcVertices;
    std::vector<rs::i32> npcIndices;
    std::vector<rs::i32> npcOrderKeys;
    rs::i32 debugTerrainTilesConsidered = 0;
    rs::i32 debugTerrainTilesEmitted = 0;
    rs::i32 debugTerrainFacesEmitted = 0;
    rs::i32 debugTerrainFacesUnderlayLevel0 = 0;
    rs::i32 debugTerrainFacesUnderlayLevel1 = 0;
    rs::i32 debugTerrainFacesUnderlayLevel2 = 0;
    rs::i32 debugTerrainFacesUnderlayLevel3 = 0;
    rs::i32 debugTerrainFacesOverlayLevel0 = 0;
    rs::i32 debugTerrainFacesOverlayLevel1 = 0;
    rs::i32 debugTerrainFacesOverlayLevel2 = 0;
    rs::i32 debugTerrainFacesOverlayLevel3 = 0;

    // Terrain digest (TS parity helper): see rs::SceneCommandStream debugTerrainDigest*.
    rs::i32 debugTerrainDigestHash = 0;
    rs::i32 debugTerrainDigestFacesTotal = 0;
    rs::i32 debugTerrainDigestVerticesTotal = 0;
    rs::i32 debugTerrainDigestLevelFaces0 = 0;
    rs::i32 debugTerrainDigestLevelFaces1 = 0;
    rs::i32 debugTerrainDigestLevelFaces2 = 0;
    rs::i32 debugTerrainDigestLevelFaces3 = 0;
    rs::i32 debugTerrainDigestLevelVertices0 = 0;
    rs::i32 debugTerrainDigestLevelVertices1 = 0;
    rs::i32 debugTerrainDigestLevelVertices2 = 0;
    rs::i32 debugTerrainDigestLevelVertices3 = 0;

    // Terrain digest sample records (parity/debug): copied from rs::SceneCommandStream.
    rs::i32 debugTerrainDigestSampleCount = 0;
    rs::i32 debugTerrainDigestSampleStrideInts = rs::SceneCommandStream::kDebugTerrainDigestSampleStrideInts;
    rs::i32 debugTerrainDigestSamplesPacked
        [rs::SceneCommandStream::kDebugTerrainDigestSampleVertexLimit *
         rs::SceneCommandStream::kDebugTerrainDigestSampleStrideInts]{};

    // Terrain tile probe (debug): copied from rs::SceneCommandStream.
    rs::i32 debugTerrainProbeHit = 0;
    rs::i32 debugTerrainProbeLevel = -1;
    rs::i32 debugTerrainProbeTileX = -1;
    rs::i32 debugTerrainProbeTileY = -1;
    rs::i32 debugTerrainProbePacked[64]{};

    // World height probe (debug): copied from rs::SceneCommandStream.
    rs::i32 debugWorldHeightProbeHit = 0;
    rs::i32 debugWorldHeightProbeLevel = -1;
    rs::i32 debugWorldHeightProbeWorldX = -1;
    rs::i32 debugWorldHeightProbeWorldZ = -1;
    rs::i32 debugWorldHeightProbeLocId = -1;
    rs::i32 debugPackedVertexProbeIndex = -1;
    rs::i32 debugWorldHeightProbePacked[32]{};

    // Scene command plan digest (TS parity helper): matches src/renderer/buffer/SceneCommandPlan.ts.
    rs::i32 debugSceneCommandPlanOpCount = 0;
    rs::i32 debugSceneCommandPlanMergedGroupOpCount = 0;
    rs::i32 debugSceneCommandPlanInstancedOpCount = 0;
    rs::i32 debugSceneCommandPlanInstancedFacesTotal = 0;
    rs::i32 debugSceneCommandPlanInstancedInstancesTotal = 0;
    rs::i32 debugSceneCommandPlanInstancedLodInstancesTotal = 0;
    rs::i32 debugSceneCommandPlanSeqHash = 0;
    rs::i32 debugSceneCommandPlanMultisetHashSum = 0;
    rs::i32 debugSceneCommandPlanMultisetHashXor = 0;
    std::vector<rs::i32> debugSceneCommandPlanOpsPacked;
    std::vector<rs::i32> debugSceneCommandPlanOpProvenancePacked;

    rs::i32 debugSceneBucketsCmdTotal = 0;
    rs::i32 debugSceneBucketsInstanceTotal = 0;
    rs::i32 debugSceneBucketsHash = 0;
    rs::i32 debugSceneBucketsCmdCount0 = 0;
    rs::i32 debugSceneBucketsCmdCount1 = 0;
    rs::i32 debugSceneBucketsCmdCount2 = 0;
    rs::i32 debugSceneBucketsCmdCount3 = 0;
    rs::i32 debugSceneBucketsCmdCount4 = 0;
    rs::i32 debugSceneBucketsCmdCount5 = 0;
    rs::i32 debugSceneBucketsCmdCount6 = 0;
    rs::i32 debugSceneBucketsCmdCount7 = 0;

    rs::i32 debugLocRenderPlacementDigestHash = 0;
    rs::i32 debugLocRenderPlacementCount = 0;
    rs::i32 debugLocPlacementsDecoded = 0;
    rs::i32 debugLocPlacementsInBounds = 0;
    rs::i32 debugLocPlacementsResolved = 0;
    rs::i32 debugLocResolveNotFound = 0;
    rs::i32 debugLocNoModelsForPlacement = 0;
    rs::i32 debugLocModelCandidates = 0;
    rs::i32 debugLocModelStatsDecodeFailed = 0;
    rs::i32 debugLocModelStatsNotFound = 0;
    rs::i32 debugLocModelStatsOtherError = 0;
    rs::i32 debugLocMissingModelSampleCount = 0;
    rs::i32 debugLocMissingModelSample0 = 0;
    rs::i32 debugLocMissingModelSample1 = 0;
    rs::i32 debugLocMissingModelSample2 = 0;
    rs::i32 debugLocMissingModelSample3 = 0;
    rs::i32 debugLocMissingModelLocTypeId = 0;
    rs::i32 debugLocMissingModelPlacementType = 0;
    rs::i32 debugLocMissingModelRotation = 0;
    rs::i32 debugLocModelStatsZeroFaces = 0;
    rs::i32 debugLocGroupStatsMismatch = 0;
    rs::i32 debugLocPlacementsQueuedAnyModel = 0;
    rs::i32 debugLocInstancesQueued = 0;
    rs::i32 debugLocAnimatedNoFaces = 0;
    rs::i32 debugLocAnimatedQueued = 0;
    rs::i32 debugObjSpawnsDecoded = 0;
    rs::i32 debugObjSpawnsInBounds = 0;
    rs::i32 debugObjModelCandidates = 0;
    rs::i32 debugObjInstancesQueued = 0;
    rs::i32 debugLocMergeByPlacementCount = 0;
    rs::i32 debugLocInstancedGroupCount = 0;
    rs::i32 debugLocVariantGroupsQueued = 0;
    rs::i32 debugLocVariantGroupsHash = 0;
    rs::i32 debugLocVariantType9Queued = 0;
    rs::i32 debugLocVariantType0Queued = 0;
    rs::i32 debugLocVariantId1651Type9Queued = 0;
    rs::i32 debugLocVariantId1651Type0Queued = 0;
    rs::i32 debugLocVariantCandidatesExpanded = 0;
    rs::i32 debugLocVariantDecodeFailed = 0;
    rs::i32 debugLocPreMergeGroupKeysQueued = 0;
    rs::i32 debugLocPreMergeGroupKeysHash = 0;
    rs::i32 debugLocMergedDummyCommandCount = 0;
    rs::i32 debugLocMergedDummyElementsTotal = 0;
    rs::i32 debugLocMergedDummyHash = 0;
    rs::i32 debugLocMergedDummyBaseCount = 0;
    rs::i32 debugLocMergedDummyAlphaCount = 0;
    rs::i32 debugLocMergedDummyLodCount = 0;
    rs::i32 debugLocMergedDummyLodAlphaCount = 0;
    rs::i32 debugGeometryElementMismatchCount = 0;
    rs::i32 debugGeometryElementMismatchTotalDelta = 0;
    rs::i32 debugGeometryElementMismatchMaxDelta = 0;
    rs::i32 debugGeometryElementMismatchSampleTypeId = 0;
    rs::i32 debugGeometryElementMismatchSamplePlacementType = 0;
    rs::i32 debugGeometryElementMismatchSampleRotation = 0;
    rs::i32 debugObjMergeByPlacementCount = 0;
    rs::i32 debugObjInstancedGroupCount = 0;

    std::vector<rs::u8> debugTerrainTileFaceCounts;
    std::vector<rs::i32> debugLocPreMergeGroupKeySignatures;
    std::vector<rs::i32> debugLocRenderPlacementEntriesPacked;
    std::vector<rs::i32> debugLocPreMergeGroupKeyEntriesPacked;
    std::vector<rs::i32> debugLocMergeDecisionEntriesPacked;
    std::vector<rs::i32> debugLocMergeEmitEntriesPacked;
    std::vector<rs::i32> debugLocMergeNormalsTraceEntriesPacked;
    std::vector<rs::i32> debugCommandProvenancePacked;
    rs::i32 debugTerrainTileFaceCountsLevels = 0;
    rs::i32 debugTerrainTileFaceCountsWidth = 0;
    rs::i32 debugTerrainTileFaceCountsHeight = 0;
    rs::i32 debugTerrainTileFaceCountsBorder = 0;
    rs::i32 baseX = 0;
    rs::i32 baseY = 0;
    rs::i32 sizeX = 0;
    rs::i32 sizeY = 0;
    rs::i32 locLoadType = 0;
    bool loaded = false;

    void clear() {
        cmdBucketIndices.clear();
        cmdOffsets.clear();
        cmdElements.clear();
        cmdInstanceCounts.clear();
        cmdPackedInstances.clear();
        vertices.clear();
        indices.clear();
        npcDrawRangesBase.clear();
        npcDrawRangesAlpha.clear();
        npcVertices.clear();
        npcIndices.clear();
        npcOrderKeys.clear();
        debugTerrainTileFaceCounts.clear();
        debugLocPreMergeGroupKeySignatures.clear();
        debugLocRenderPlacementEntriesPacked.clear();
        debugLocPreMergeGroupKeyEntriesPacked.clear();
        debugLocMergeDecisionEntriesPacked.clear();
        debugLocMergeEmitEntriesPacked.clear();
        debugLocMergeNormalsTraceEntriesPacked.clear();
        debugCommandProvenancePacked.clear();
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
        debugTerrainDigestHash = static_cast<rs::i32>(2166136261u);
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
        debugTerrainDigestSampleCount = 0;
        debugTerrainDigestSampleStrideInts = rs::SceneCommandStream::kDebugTerrainDigestSampleStrideInts;
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
        for (std::size_t i = 0; i < (sizeof(debugWorldHeightProbePacked) / sizeof(debugWorldHeightProbePacked[0])); i++) {
            debugWorldHeightProbePacked[i] = 0;
        }
        debugSceneCommandPlanOpCount = 0;
        debugSceneCommandPlanMergedGroupOpCount = 0;
        debugSceneCommandPlanInstancedOpCount = 0;
        debugSceneCommandPlanInstancedFacesTotal = 0;
        debugSceneCommandPlanInstancedInstancesTotal = 0;
        debugSceneCommandPlanInstancedLodInstancesTotal = 0;
        debugSceneCommandPlanSeqHash = static_cast<rs::i32>(2166136261u);
        debugSceneCommandPlanMultisetHashSum = 0;
        debugSceneCommandPlanMultisetHashXor = 0;
        debugSceneCommandPlanOpsPacked.clear();
        debugSceneCommandPlanOpProvenancePacked.clear();
        debugSceneBucketsCmdTotal = 0;
        debugSceneBucketsInstanceTotal = 0;
        debugSceneBucketsHash = static_cast<rs::i32>(2166136261u);
        debugSceneBucketsCmdCount0 = 0;
        debugSceneBucketsCmdCount1 = 0;
        debugSceneBucketsCmdCount2 = 0;
        debugSceneBucketsCmdCount3 = 0;
        debugSceneBucketsCmdCount4 = 0;
        debugSceneBucketsCmdCount5 = 0;
        debugSceneBucketsCmdCount6 = 0;
        debugSceneBucketsCmdCount7 = 0;
        debugLocRenderPlacementDigestHash = static_cast<rs::i32>(2166136261u);
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
        debugGeometryElementMismatchCount = 0;
        debugGeometryElementMismatchTotalDelta = 0;
        debugGeometryElementMismatchMaxDelta = 0;
        debugGeometryElementMismatchSampleTypeId = 0;
        debugGeometryElementMismatchSamplePlacementType = 0;
        debugGeometryElementMismatchSampleRotation = 0;
        debugObjMergeByPlacementCount = 0;
        debugObjInstancedGroupCount = 0;
        baseX = 0;
        baseY = 0;
        sizeX = 0;
        sizeY = 0;
        locLoadType = 0;
        loaded = false;
    }
};

struct MapRenderRuntimeCacheState final {
    struct BlobKey final {
        rs::i32 domain = 0;
        rs::i32 group = 0;
        rs::i32 file = 0;

        bool operator==(const BlobKey& other) const {
            return domain == other.domain && group == other.group && file == other.file;
        }
    };

    struct BlobKeyHash final {
        std::size_t operator()(const BlobKey& key) const noexcept {
            // Cheap, stable mixing for (domain,group,file). This is not crypto; it just reduces clustering.
            const std::uint64_t a = static_cast<std::uint32_t>(key.domain);
            const std::uint64_t b = static_cast<std::uint32_t>(key.group);
            const std::uint64_t c = static_cast<std::uint32_t>(key.file);
            std::uint64_t x = a;
            x = (x * 0x9E3779B185EBCA87ull) ^ (b + 0xC2B2AE3D27D4EB4Full + (x << 6) + (x >> 2));
            x = (x * 0x9E3779B185EBCA87ull) ^ (c + 0x165667B19E3779F9ull + (x << 6) + (x >> 2));
            return static_cast<std::size_t>(x);
        }
    };
    std::vector<rs::i32> varps;
    std::unordered_map<BlobKey, std::vector<rs::u8>, BlobKeyHash> blobEntries;
    std::size_t blobEntriesBytes = 0;
    // Dat (classic) seq frames: decoded from raw frame-map blobs (domain=3).
    std::unordered_set<rs::i32> decodedDatSeqFrameMapIds{};
    std::unordered_map<rs::i32, rs::SeqBase> datSeqFrameBaseByMapId{};
    std::unordered_map<rs::i32, rs::SeqFrame> datSeqFrameById{};
    std::unordered_map<rs::i32, rs::i32> datSeqFrameMapIdByFrameId{};
    // Legacy seq frames: decoded from raw base/frame named file blobs (domain=4).
    rs::LegacySeqFrameLoader legacySeqFrames{};
    bool legacySeqFramesLoaded = false;
    // Legacy models: decoded from raw legacy model named file blobs (domain=5).
    rs::LegacyModelLoader legacyModels{};
    bool legacyModelsLoaded = false;
    rs::i32 cacheGame = 0;
    rs::i32 cacheRevision = 0;
    rs::i32 sceneLevels = 4;
    rs::i32 unitsTileHeightBasis = 128;
    rs::i32 typeGeneration = 0;
    rs::i32 appliedTypeGeneration = -1;
    rs::i32 datSeqFrameMapGeneration = 0;
    rs::i32 appliedDatSeqFrameMapGeneration = -1;
    rs::i32 legacySeqFilesGeneration = 0;
    rs::i32 appliedLegacySeqFilesGeneration = -1;
    rs::i32 legacyModelFilesGeneration = 0;
    rs::i32 appliedLegacyModelFilesGeneration = -1;

    void clear() {
        varps.clear();
        blobEntries.clear();
        blobEntriesBytes = 0;
        decodedDatSeqFrameMapIds.clear();
        datSeqFrameBaseByMapId.clear();
        datSeqFrameById.clear();
        datSeqFrameMapIdByFrameId.clear();
        typeGeneration = 0;
        appliedTypeGeneration = -1;
        datSeqFrameMapGeneration = 0;
        appliedDatSeqFrameMapGeneration = -1;
        legacySeqFrames = rs::LegacySeqFrameLoader();
        legacySeqFramesLoaded = false;
        legacySeqFilesGeneration = 0;
        appliedLegacySeqFilesGeneration = -1;
        legacyModels = rs::LegacyModelLoader();
        legacyModelsLoaded = false;
        legacyModelFilesGeneration = 0;
        appliedLegacyModelFilesGeneration = -1;
    }
};

struct MapRenderRuntimeState {
    std::unordered_map<rs::i32, MapRenderTickState> tickStates;
    // Tick output scratch (FramePacket-compatible patch stream).
    // Layout matches src/renderer/packet/FramePacket.ts:
    // - counts: per-map tuples [mapId, <10 stream counts>] (stride=11)
    // - patches: concatenated by map, and within each map by stream index [0..9],
    //   where each patch tuple is [drawRangeIndex, offset, elements, instances] (stride=4).
    std::vector<rs::i32> tickPatchCountsByMapIdScratch;
    std::vector<rs::i32> tickPatchPackedScratch;
    rs::tooling::MapRenderLoadedPayloadState mapPayload;
    MapRenderRuntimeCacheState cache;
    MapRenderCachedCommandStream lastBuiltCommandStream;
    // Preserve the last *full geometry* build even when debug plan-only builds are run.
    // The parity pipeline calls `rs_map_render_runtime_debug_build_map_plan_from_cache`, which
    // overwrites `lastBuiltCommandStream` with a plan-only build (no geometry emit).
    // Some debug exports (loc merge emit entries, normals trace, etc.) are only meaningful for
    // the full build; store it separately to avoid "empty debug" false negatives.
    MapRenderCachedCommandStream lastBuiltCommandStreamFull;
    // Stable: blob keys missing during the last build attempt (packed [domain,group,file] triples).
    // Used by JS/TS to drive on-demand uploads without a separate type-demand pass.
    std::vector<rs::i32> lastMissingBlobTriples;
    rs::i32 payloadGeneration = 0;
    rs::i32 debugLastMapInputHashDirect = 0;
    rs::i32 debugLastMapInputHashCache = 0;
    rs::i32 debugLastCacheScratchHeightHash = 0;
    rs::i32 debugTerrainDigestSampleStartVertex = 0;
    rs::i32 debugTerrainProbeLevel = -1;
    rs::i32 debugTerrainProbeTileX = -1;
    rs::i32 debugTerrainProbeTileY = -1;
    rs::i32 debugWorldHeightProbeLevel = -1;
    rs::i32 debugWorldHeightProbeWorldX = -1;
    rs::i32 debugWorldHeightProbeWorldZ = -1;
    rs::i32 debugWorldHeightProbeLocId = -1;
    rs::i32 debugPackedVertexProbeIndex = -1;
    // Debug-only: last build failure summary for cache->packet builds.
    // stage=0 means last build succeeded (or hasn't run yet).
    rs::i32 debugLastBuildFailureStage = 0;
    rs::i32 debugLastBuildFailureStatus = 0;
    rs::i32 debugLastBuildFailureDetail0 = 0;
    rs::i32 debugLastBuildFailureDetail1 = 0;
    // Debug-only: last core Status from buildSceneCommandStream/PlanOnly (0=Ok).
    rs::i32 debugLastCommandStreamCoreStatus = 0;
    // Debug-only: legacy model loader observations (used to debug legacy cache support).
    rs::i32 debugLastLegacyModelId = -1;
    rs::i32 debugLastLegacyModelStatus = 0;
    rs::i32 debugLastLegacyModelMissingFile = -1;
    // Debug-only: last missing type info captured by SceneCommandBuilder.
    rs::i32 debugLastMissingTypeKind = 0;
    rs::i32 debugLastMissingTypeId = -1;
    // Debug-only: last collectRuntimeCachedMapInput diagnostics.
    rs::i32 debugLastCollectMapInputStatus = 0;
    rs::i32 debugLastCollectMapInputReason = 0;
    rs::i32 debugLastCollectMapInputMapStartX = 0;
    rs::i32 debugLastCollectMapInputMapStartY = 0;
    rs::i32 debugLastCollectMapInputMapEndX = 0;
    rs::i32 debugLastCollectMapInputMapEndY = 0;
    rs::i32 debugLastCollectMapInputExpectedSquares = 0;
    rs::i32 debugLastCollectMapInputSquaresWithAny = 0;
    rs::i32 debugLastCollectMapInputSquaresWithTerrain = 0;
    rs::i32 debugLastCollectMapInputSquaresWithLoc = 0;
    rs::i32 debugLastCollectMapInputFirstPresentMapSquareId = -1;
    rs::i32 debugLastCollectMapInputFirstMissingMapSquareId = -1;
    // Debug-only: last NPC build attempt counters.
    rs::i32 debugLastNpcBuildStatus = 0;
    rs::i32 debugLastNpcSpawnBytesLength = 0;
    rs::i32 debugLastNpcSpawnsDecoded = 0;
    rs::i32 debugLastNpcSpawnsInBounds = 0;
    rs::i32 debugLastNpcResolvedType = 0;
    rs::i32 debugLastNpcLoginPropRenderable = 0;
    rs::i32 debugLastNpcModelDecodeOk = 0;
    rs::i32 debugLastNpcModelDecodeFailed = 0;
    rs::i32 debugLastNpcSpawnsWithGeometry = 0;
    rs::i32 debugLastNpcDrawRangeCount = 0;
    rs::i32 debugLastNpcVertexBytes = 0;
    rs::i32 debugLastNpcIndexCount = 0;
    std::array<rs::i32, RS_MAP_RENDER_RUNTIME_BUILD_STAGE_TIMINGS_LENGTH>
        debugLastBuildStageTimingsUs{};
};

struct MapRenderPacketHandleState final {
    rs::i32 runtimeHandle = 0;
    rs::i32 payloadGeneration = -1;
};

static rs::tooling::RuntimeStore<MapRenderRuntimeState> gMapRenderRuntimes;
static rs::tooling::HandleStore<MapRenderPacketHandleState> gMapRenderPacketHandles;

enum MapRenderDebugBuildFailureStage : rs::i32 {
    kBuildFailNone = 0,
    kBuildFailInvalidArg = 1,
    kBuildFailCollectMapInput = 2,
    kBuildFailEnsureTypes = 3,
    kBuildFailCollision = 4,
    kBuildFailCommandStream = 5,
    kBuildFailPlanPayload = 6,
    kBuildFailBuildPayload = 7,
    kBuildFailStorePayload = 8,
};

enum MapRenderCollectMapInputReason : rs::i32 {
    kCollectMapInputReasonNone = 0,
    kCollectMapInputReasonOk = 1,
    kCollectMapInputReasonInvalidArg = 2,
    kCollectMapInputReasonNoSquaresInWindow = 3,
    kCollectMapInputReasonTerrainCapacity = 4,
    kCollectMapInputReasonLocCapacity = 5,
    kCollectMapInputReasonOther = 6,
};

static inline rs::i32 recordBuildFailure(
    MapRenderRuntimeState* runtime,
    rs::i32 stage,
    rs::i32 status,
    rs::i32 detail0 = 0,
    rs::i32 detail1 = 0) noexcept {
    if (runtime) {
        runtime->debugLastBuildFailureStage = stage;
        runtime->debugLastBuildFailureStatus = status;
        runtime->debugLastBuildFailureDetail0 = detail0;
        runtime->debugLastBuildFailureDetail1 = detail1;
    }
    return status;
}

static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_VERSION = 1;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_HEADER_LENGTH = 2;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_STRIDE = 3;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_MAX_ENTRIES = 4096;

static constexpr rs::i32 RS_NPC_PATH_QUEUE_LEN_PACKED = 10;
static constexpr rs::i32 RS_MAP_RENDER_STATUS_OK = 1;
static constexpr rs::i32 RS_MAP_RENDER_STATUS_INVALID_ARG = -1;
static constexpr rs::i32 RS_MAP_RENDER_STATUS_NOT_FOUND = -2;
static constexpr rs::i32 RS_MAP_RENDER_STATUS_SIZE_MISMATCH = -3;
static constexpr rs::i32 RS_MAP_RENDER_STATUS_STATE = -4;
static constexpr rs::i32 RS_MAP_RENDER_STATUS_CAPACITY = -5;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_BUILD_DEBUG_STATS_LENGTH = 65;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_COMMAND_STREAM_DIGEST_LENGTH = 16;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_TERRAIN_TILE_FACE_COUNTS_META_LENGTH = 5;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_TERRAIN_DIGEST_LENGTH = 12;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_TERRAIN_DIGEST_SAMPLES_META_LENGTH = 3;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_TERRAIN_PROBE_LENGTH = 68;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_CACHED_TERRAIN_CELL_LENGTH = 16;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_WORLD_HEIGHT_PROBE_PACKED_LENGTH = 32;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_WORLD_HEIGHT_PROBE_LENGTH =
    4 + RS_MAP_RENDER_RUNTIME_WORLD_HEIGHT_PROBE_PACKED_LENGTH;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_SCENE_COMMAND_PLAN_OPS_PACKED_META_LENGTH = 1;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_LOC_RENDER_PLACEMENT_DIGEST_LENGTH = 2;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_LOC_RENDER_PLACEMENT_ENTRIES_META_LENGTH = 2;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_SCENE_COMMAND_PLAN_DIGEST_LENGTH = 9;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_SCENE_BUCKETS_DIGEST_LENGTH = 11;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MODEL_FACES_DIGEST_LENGTH = 4;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_DIGEST_LENGTH = 4;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_MAX_VERTS = 32;
// Layout:
// [0]=model.version
// [1]=model.verticesCount
// [2]=model.usedVertexCount
// [3]=model.faceCount
// [4]=writtenVertexCount (<= MAX_VERTS)
// [5..]=XYZ triples (i32) for written vertices.
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_META_LENGTH = 5;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_LENGTH =
    RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_META_LENGTH +
    (RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_MAX_VERTS * 3);
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_LOC_MODEL_VERTICES_SAMPLE_LENGTH =
    RS_MAP_RENDER_RUNTIME_MODEL_VERTICES_SAMPLE_LENGTH;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_LOC_PRE_MERGE_KEY_SIGNATURES_META_LENGTH = 1;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_LOC_PRE_MERGE_KEY_ENTRIES_META_LENGTH = 2;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_LOC_MERGE_DECISION_ENTRIES_META_LENGTH = 2;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_LOC_MERGE_EMIT_ENTRIES_META_LENGTH = 2;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_LOC_MERGE_NORMALS_TRACE_ENTRIES_META_LENGTH = 2;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_COMMAND_PROVENANCE_META_LENGTH = 2;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_COLLECT_MAP_INPUT_DEBUG_LENGTH = 12;
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_NPC_BUILD_DEBUG_LENGTH = 12;
// Type-entry blobs are stored as (domain, group, file) where:
// - domain is a stable "kind domain" in [101..116]
// - group is the type id
// - file is always 0
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_LOC = 101;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_VARBIT = 102;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL = 103;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_DEF = 104;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_SEQ_TYPE = 105;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_SEQ_FRAME = 106;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_NPC = 107;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_BAS = 108;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_UNDERLAY = 110;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_OVERLAY = 111;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_OBJ = 112;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_OBJ_SPAWNS = 113;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_SEQ_ALPHA_HINT = 114;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_SEQ_BASE = 115;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_SKELETAL_SEQ = 116;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MIN = RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_LOC;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MAX = RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_SKELETAL_SEQ;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_MAP_SQUARE = 2;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_MAP_SQUARE_FILE_TERRAIN = 0;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_MAP_SQUARE_FILE_LOC = 1;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_MAP_SQUARE_FILE_NPC = 2;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_DAT_SEQ_FRAME_MAP = 3;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DAT_SEQ_FRAME_MAP_FILE_BYTES = 0;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES = 4;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_SEQ_GROUP_GLOBAL = 0;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_BASE_HEAD = 0;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_BASE_TYPE = 1;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_BASE_LABEL = 2;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_HEAD = 3;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN1 = 4;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN2 = 5;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_DEL = 6;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_MODEL_FILES = 5;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_GROUP_GLOBAL = 0;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_HEAD = 0;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE1 = 1;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE2 = 2;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE3 = 3;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE4 = 4;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE5 = 5;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT1 = 6;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT2 = 7;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT3 = 8;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT4 = 9;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT5 = 10;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_VERTEX1 = 11;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_VERTEX2 = 12;
static constexpr rs::i32 RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_AXIS = 13;

static rs::i32 mapSquareId(const rs::i32 mapX, const rs::i32 mapY) noexcept {
    return (mapX << 8) + mapY;
}

static void collectBlobDomainGroup0IdsSortedUnique(
    const MapRenderRuntimeState* runtime,
    const rs::i32 domain,
    std::vector<rs::i32>* outIds) {
    if (!runtime || !outIds) {
        return;
    }
    outIds->clear();
    outIds->reserve(runtime->cache.blobEntries.size());
    for (const auto& kv : runtime->cache.blobEntries) {
        const MapRenderRuntimeCacheState::BlobKey& key = kv.first;
        if (key.domain != domain || key.group != 0 || key.file < 0) {
            continue;
        }
        outIds->push_back(key.file);
    }
    if (outIds->empty()) {
        return;
    }
    std::sort(outIds->begin(), outIds->end());
    outIds->erase(std::unique(outIds->begin(), outIds->end()), outIds->end());
}

static constexpr rs::i32 RS_MAP_RENDER_TYPE_ENTRY_ID_LIST_GROUP = 1;
static constexpr rs::i32 RS_MAP_RENDER_TYPE_ENTRY_ID_LIST_FILE = 0;

static void collectBlobDomainTypeListPreferPayloadOrKeys(
    const MapRenderRuntimeState* runtime,
    const rs::i32 domain,
    std::vector<rs::i32>* outIds) {
    if (!runtime || !outIds) {
        return;
    }
    // Prefer a single packed payload list:
    // - (domain, group=1, file=0) -> bytes: little-endian i32 ids
    // Fallback (legacy) is presence keys:
    // - (domain, group=0, file=id) with empty payload (orderless)
    MapRenderRuntimeCacheState::BlobKey key{};
    key.domain = domain;
    key.group = RS_MAP_RENDER_TYPE_ENTRY_ID_LIST_GROUP;
    key.file = RS_MAP_RENDER_TYPE_ENTRY_ID_LIST_FILE;
    const auto it = runtime->cache.blobEntries.find(key);
    if (it != runtime->cache.blobEntries.end()) {
        const std::vector<rs::u8>& bytes = it->second;
        outIds->clear();
        if (bytes.empty()) {
            return;
        }
        if (bytes.size() % 4u != 0u) {
            // Ignore malformed payloads and fall back to key scanning.
        } else {
            const auto readI32LE = [](const rs::u8* p) noexcept -> rs::i32 {
                return static_cast<rs::i32>(static_cast<rs::u32>(p[0]) |
                    (static_cast<rs::u32>(p[1]) << 8u) |
                    (static_cast<rs::u32>(p[2]) << 16u) |
                    (static_cast<rs::u32>(p[3]) << 24u));
            };
            const std::size_t n = bytes.size() / 4u;
            outIds->reserve(n);
            for (std::size_t i = 0; i < n; i++) {
                outIds->push_back(readI32LE(bytes.data() + (i * 4u)));
            }
            return;
        }
    }

    // (domain, group=0, file=id) presence keys (orderless). For dat/dat2 caches texture ids are
    // contiguous, so sorting matches the TS packing order.
    collectBlobDomainGroup0IdsSortedUnique(runtime, domain, outIds);
}

static MapRenderRuntimeState* getMapRenderRuntime(const rs::i32 handle) {
    return gMapRenderRuntimes.get(handle);
}

static const MapRenderRuntimeState* getMapRenderRuntimeConst(const rs::i32 handle) {
    return gMapRenderRuntimes.get(handle);
}

static void clearPacketHandlesForRuntime(const rs::i32 runtimeHandle) {
    gMapRenderPacketHandles.eraseIf([runtimeHandle](const MapRenderPacketHandleState& state) {
        return state.runtimeHandle == runtimeHandle;
    });
}

static rs::i32 allocateMapRenderPacketHandle(
    const rs::i32 runtimeHandle,
    const rs::i32 payloadGeneration) {
    return gMapRenderPacketHandles.create(
        MapRenderPacketHandleState{runtimeHandle, payloadGeneration});
}

#include "MapRenderRuntimeTypeDemandHelpers.inl"

static void runtimeRecordMissingBlobKey(
    MapRenderRuntimeState* runtime,
    const rs::i32 domain,
    const rs::i32 group,
    const rs::i32 file) noexcept {
    if (!runtime) {
        return;
    }
    if (domain < 0 || group < 0 || file < 0) {
        return;
    }
    std::vector<rs::i32>& out = runtime->lastMissingBlobTriples;
    if (out.size() / RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_STRIDE >=
        static_cast<std::size_t>(RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_MAX_ENTRIES)) {
        return;
    }
    for (std::size_t i = 0; i + 2 < out.size(); i += RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_STRIDE) {
        if (out[i] == domain && out[i + 1] == group && out[i + 2] == file) {
            return;
        }
    }
    out.push_back(domain);
    out.push_back(group);
    out.push_back(file);
}

static void clearRuntimeDatSeqFrameCache(MapRenderRuntimeCacheState* cache) noexcept {
    if (!cache) {
        return;
    }
    cache->decodedDatSeqFrameMapIds.clear();
    cache->datSeqFrameBaseByMapId.clear();
    cache->datSeqFrameById.clear();
    cache->datSeqFrameMapIdByFrameId.clear();
}

static void ensureRuntimeDatSeqFrameCacheGeneration(MapRenderRuntimeState* runtime) noexcept {
    if (!runtime) {
        return;
    }
    if (runtime->cache.appliedDatSeqFrameMapGeneration == runtime->cache.datSeqFrameMapGeneration) {
        return;
    }
    clearRuntimeDatSeqFrameCache(&runtime->cache);
    runtime->cache.appliedDatSeqFrameMapGeneration = runtime->cache.datSeqFrameMapGeneration;
}

static void clearRuntimeLegacySeqFrameCache(MapRenderRuntimeCacheState* cache) noexcept {
    if (!cache) {
        return;
    }
    cache->legacySeqFrames = rs::LegacySeqFrameLoader();
    cache->legacySeqFramesLoaded = false;
}

static void ensureRuntimeLegacySeqFrameCacheGeneration(MapRenderRuntimeState* runtime) noexcept {
    if (!runtime) {
        return;
    }
    if (runtime->cache.appliedLegacySeqFilesGeneration == runtime->cache.legacySeqFilesGeneration) {
        return;
    }
    clearRuntimeLegacySeqFrameCache(&runtime->cache);
    runtime->cache.appliedLegacySeqFilesGeneration = runtime->cache.legacySeqFilesGeneration;
}

static void clearRuntimeLegacyModelCache(MapRenderRuntimeCacheState* cache) noexcept {
    if (!cache) {
        return;
    }
    cache->legacyModels = rs::LegacyModelLoader();
    cache->legacyModelsLoaded = false;
}

static void ensureRuntimeLegacyModelCacheGeneration(MapRenderRuntimeState* runtime) noexcept {
    if (!runtime) {
        return;
    }
    if (runtime->cache.appliedLegacyModelFilesGeneration == runtime->cache.legacyModelFilesGeneration) {
        return;
    }
    clearRuntimeLegacyModelCache(&runtime->cache);
    runtime->cache.appliedLegacyModelFilesGeneration = runtime->cache.legacyModelFilesGeneration;
}

static rs::Status tryLoadDatSeqFrameFromRuntimeBlobs(
    MapRenderRuntimeState* runtime,
    const rs::i32 frameId,
    rs::SeqBase* outBase,
    rs::SeqFrame* outFrame,
    rs::Allocator& outAlloc) noexcept {
    if (!runtime || !outBase || !outFrame) {
        return rs::Status::InvalidArgument;
    }
    // Dat (classic) seq frames are u16 ids.
    if (frameId < 0 || frameId > 0xffff) {
        return rs::Status::NotFound;
    }

    ensureRuntimeDatSeqFrameCacheGeneration(runtime);

    const auto cachedIt = runtime->cache.datSeqFrameById.find(frameId);
    if (cachedIt != runtime->cache.datSeqFrameById.end()) {
        const auto mapIt = runtime->cache.datSeqFrameMapIdByFrameId.find(frameId);
        if (mapIt == runtime->cache.datSeqFrameMapIdByFrameId.end()) {
            return rs::Status::NotFound;
        }
        const rs::i32 mapId = mapIt->second;
        const auto baseIt = runtime->cache.datSeqFrameBaseByMapId.find(mapId);
        if (baseIt == runtime->cache.datSeqFrameBaseByMapId.end()) {
            return rs::Status::NotFound;
        }
        rs::Status bs = rs::cloneSeqBase(baseIt->second, outAlloc, outBase);
        if (!rs::ok(bs)) {
            return bs;
        }
        rs::Status fs = rs::cloneSeqFrame(cachedIt->second, outAlloc, outFrame);
        return fs;
    }

    rs::Allocator& cacheAlloc = rs::defaultAllocator();
    rs::SeqFrameDecodeScratch scratch(cacheAlloc);
    rs::Vec<rs::i32> decodedIds(cacheAlloc);
    rs::Vec<rs::SeqFrame> decodedFrames(cacheAlloc);

    // Decode each uploaded frame-map once until the requested frame id is materialized.
    for (const auto& kv : runtime->cache.blobEntries) {
        const MapRenderRuntimeCacheState::BlobKey& key = kv.first;
        if (key.domain != RS_MAP_RENDER_BLOB_DOMAIN_DAT_SEQ_FRAME_MAP ||
            key.file != RS_MAP_RENDER_BLOB_DAT_SEQ_FRAME_MAP_FILE_BYTES) {
            continue;
        }
        const rs::i32 mapId = key.group;
        if (runtime->cache.decodedDatSeqFrameMapIds.find(mapId) != runtime->cache.decodedDatSeqFrameMapIds.end()) {
            continue;
        }
        runtime->cache.decodedDatSeqFrameMapIds.insert(mapId);

        const std::vector<rs::u8>& bytes = kv.second;
        if (bytes.empty()) {
            continue;
        }

        const rs::Status ds = rs::decodeDatSeqFrameMap(
            rs::Span<const rs::u8>(bytes.data(), bytes.size()),
            &scratch,
            cacheAlloc,
            &decodedIds,
            &decodedFrames);
        if (!rs::ok(ds)) {
            continue;
        }

        rs::SeqBase base(-1, cacheAlloc);
        const rs::Status bs = rs::decodeDatSeqBaseFromFrameMapBytes(
            rs::Span<const rs::u8>(bytes.data(), bytes.size()),
            cacheAlloc,
            &base);
        if (!rs::ok(bs)) {
            continue;
        }

        runtime->cache.datSeqFrameBaseByMapId[mapId] = rs::move(base);

        const std::size_t n = decodedIds.size();
        for (std::size_t i = 0; i < n; i++) {
            const rs::i32 id = decodedIds[i];
            if (id < 0 || id > 0xffff) {
                continue;
            }
            runtime->cache.datSeqFrameMapIdByFrameId[id] = mapId;
            runtime->cache.datSeqFrameById[id] = rs::move(decodedFrames[i]);
        }

        const auto nowIt = runtime->cache.datSeqFrameById.find(frameId);
        if (nowIt != runtime->cache.datSeqFrameById.end()) {
            const auto mapIt = runtime->cache.datSeqFrameMapIdByFrameId.find(frameId);
            const auto baseIt = mapIt != runtime->cache.datSeqFrameMapIdByFrameId.end()
                ? runtime->cache.datSeqFrameBaseByMapId.find(mapIt->second)
                : runtime->cache.datSeqFrameBaseByMapId.end();
            if (mapIt == runtime->cache.datSeqFrameMapIdByFrameId.end() ||
                baseIt == runtime->cache.datSeqFrameBaseByMapId.end()) {
                return rs::Status::NotFound;
            }
            rs::Status outBs = rs::cloneSeqBase(baseIt->second, outAlloc, outBase);
            if (!rs::ok(outBs)) {
                return outBs;
            }
            rs::Status outFs = rs::cloneSeqFrame(nowIt->second, outAlloc, outFrame);
            return outFs;
        }
    }

    return rs::Status::NotFound;
}

static rs::Status tryLoadLegacySeqFrameFromRuntimeBlobs(
    MapRenderRuntimeState* runtime,
    const rs::i32 frameId,
    rs::SeqBase* outBase,
    rs::SeqFrame* outFrame,
    rs::Allocator& outAlloc) noexcept {
    if (!runtime || !outBase || !outFrame) {
        return rs::Status::InvalidArgument;
    }

    ensureRuntimeLegacySeqFrameCacheGeneration(runtime);

    if (!runtime->cache.legacySeqFramesLoaded) {
        const auto findBlob = [&](rs::i32 file) -> const std::vector<rs::u8>* {
            const MapRenderRuntimeCacheState::BlobKey key{
                RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES,
                RS_MAP_RENDER_BLOB_LEGACY_SEQ_GROUP_GLOBAL,
                file,
            };
            auto it = runtime->cache.blobEntries.find(key);
            if (it == runtime->cache.blobEntries.end()) {
                return nullptr;
            }
            return &it->second;
        };

        const std::vector<rs::u8>* baseHead = findBlob(RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_BASE_HEAD);
        const std::vector<rs::u8>* baseType = findBlob(RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_BASE_TYPE);
        const std::vector<rs::u8>* baseLabel = findBlob(RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_BASE_LABEL);
        const std::vector<rs::u8>* frameHead = findBlob(RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_HEAD);
        const std::vector<rs::u8>* frameTran1 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN1);
        const std::vector<rs::u8>* frameTran2 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN2);
        const std::vector<rs::u8>* frameDel = findBlob(RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_DEL);

        if (!baseHead || !baseType || !baseLabel || !frameHead || !frameTran1 || !frameTran2 || !frameDel) {
            if (!baseHead) {
                runtimeRecordMissingBlobKey(
                    runtime,
                    RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_GROUP_GLOBAL,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_BASE_HEAD);
            }
            if (!baseType) {
                runtimeRecordMissingBlobKey(
                    runtime,
                    RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_GROUP_GLOBAL,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_BASE_TYPE);
            }
            if (!baseLabel) {
                runtimeRecordMissingBlobKey(
                    runtime,
                    RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_GROUP_GLOBAL,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_BASE_LABEL);
            }
            if (!frameHead) {
                runtimeRecordMissingBlobKey(
                    runtime,
                    RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_GROUP_GLOBAL,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_HEAD);
            }
            if (!frameTran1) {
                runtimeRecordMissingBlobKey(
                    runtime,
                    RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_GROUP_GLOBAL,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN1);
            }
            if (!frameTran2) {
                runtimeRecordMissingBlobKey(
                    runtime,
                    RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_GROUP_GLOBAL,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_TRAN2);
            }
            if (!frameDel) {
                runtimeRecordMissingBlobKey(
                    runtime,
                    RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_SEQ_FILES,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_GROUP_GLOBAL,
                    RS_MAP_RENDER_BLOB_LEGACY_SEQ_FILE_FRAME_DEL);
            }
            return rs::Status::NotFound;
        }
        if (baseHead->empty() || baseType->empty() || baseLabel->empty() || frameHead->empty() ||
            frameTran1->empty() || frameTran2->empty() || frameDel->empty()) {
            return rs::Status::BadFormat;
        }

        rs::Allocator& cacheAlloc = rs::defaultAllocator();
        auto res = rs::LegacySeqFrameLoader::createFromBytes(
            rs::Span<const rs::u8>(baseHead->data(), baseHead->size()),
            rs::Span<const rs::u8>(baseType->data(), baseType->size()),
            rs::Span<const rs::u8>(baseLabel->data(), baseLabel->size()),
            rs::Span<const rs::u8>(frameHead->data(), frameHead->size()),
            rs::Span<const rs::u8>(frameTran1->data(), frameTran1->size()),
            rs::Span<const rs::u8>(frameTran2->data(), frameTran2->size()),
            rs::Span<const rs::u8>(frameDel->data(), frameDel->size()),
            cacheAlloc);
        if (!res.isOk()) {
            return res.status();
        }
        runtime->cache.legacySeqFrames = rs::move(res.value());
        runtime->cache.legacySeqFramesLoaded = true;
    }

    return runtime->cache.legacySeqFrames.tryLoadWithBase(frameId, outBase, outFrame, outAlloc);
}

static rs::Status tryLoadLegacyModelFromRuntimeBlobs(
    MapRenderRuntimeState* runtime,
    const rs::i32 modelId,
    rs::ModelData* outModel,
    rs::Allocator& outAlloc) noexcept {
    if (!runtime || !outModel) {
        return rs::Status::InvalidArgument;
    }

    ensureRuntimeLegacyModelCacheGeneration(runtime);

    if (!runtime->cache.legacyModelsLoaded) {
        const auto findBlob = [&](rs::i32 file) -> const std::vector<rs::u8>* {
            const MapRenderRuntimeCacheState::BlobKey key{
                RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_MODEL_FILES,
                RS_MAP_RENDER_BLOB_LEGACY_MODEL_GROUP_GLOBAL,
                file,
            };
            auto it = runtime->cache.blobEntries.find(key);
            if (it == runtime->cache.blobEntries.end()) {
                return nullptr;
            }
            return &it->second;
        };

        const std::vector<rs::u8>* head = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_HEAD);
        const std::vector<rs::u8>* face1 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE1);
        const std::vector<rs::u8>* face2 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE2);
        const std::vector<rs::u8>* face3 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE3);
        const std::vector<rs::u8>* face4 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE4);
        const std::vector<rs::u8>* face5 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE5);
        const std::vector<rs::u8>* point1 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT1);
        const std::vector<rs::u8>* point2 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT2);
        const std::vector<rs::u8>* point3 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT3);
        const std::vector<rs::u8>* point4 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT4);
        const std::vector<rs::u8>* point5 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT5);
        const std::vector<rs::u8>* vertex1 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_VERTEX1);
        const std::vector<rs::u8>* vertex2 = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_VERTEX2);
        const std::vector<rs::u8>* axis = findBlob(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_AXIS);

        auto missingFile = [&](rs::i32 file) noexcept -> rs::Status {
            runtime->debugLastLegacyModelMissingFile = file;
            runtimeRecordMissingBlobKey(
                runtime,
                RS_MAP_RENDER_BLOB_DOMAIN_LEGACY_MODEL_FILES,
                RS_MAP_RENDER_BLOB_LEGACY_MODEL_GROUP_GLOBAL,
                file);
            return rs::Status::NotFound;
        };
        if (!head) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_HEAD);
        if (!face1) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE1);
        if (!face2) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE2);
        if (!face3) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE3);
        if (!face4) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE4);
        if (!face5) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_FACE5);
        if (!point1) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT1);
        if (!point2) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT2);
        if (!point3) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT3);
        if (!point4) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT4);
        if (!point5) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_POINT5);
        if (!vertex1) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_VERTEX1);
        if (!vertex2) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_VERTEX2);
        if (!axis) return missingFile(RS_MAP_RENDER_BLOB_LEGACY_MODEL_FILE_AXIS);

        if (head->empty() || face1->empty() || face2->empty() || face3->empty() || face4->empty() ||
            face5->empty() || point1->empty() || point2->empty() || point3->empty() || point4->empty() ||
            point5->empty() || vertex1->empty() || vertex2->empty() || axis->empty()) {
            return rs::Status::BadFormat;
        }

        rs::Allocator& cacheAlloc = rs::defaultAllocator();
        auto res = rs::LegacyModelLoader::createFromBytes(
            rs::Span<const rs::u8>(head->data(), head->size()),
            rs::Span<const rs::u8>(face1->data(), face1->size()),
            rs::Span<const rs::u8>(face2->data(), face2->size()),
            rs::Span<const rs::u8>(face3->data(), face3->size()),
            rs::Span<const rs::u8>(face4->data(), face4->size()),
            rs::Span<const rs::u8>(face5->data(), face5->size()),
            rs::Span<const rs::u8>(point1->data(), point1->size()),
            rs::Span<const rs::u8>(point2->data(), point2->size()),
            rs::Span<const rs::u8>(point3->data(), point3->size()),
            rs::Span<const rs::u8>(point4->data(), point4->size()),
            rs::Span<const rs::u8>(point5->data(), point5->size()),
            rs::Span<const rs::u8>(vertex1->data(), vertex1->size()),
            rs::Span<const rs::u8>(vertex2->data(), vertex2->size()),
            rs::Span<const rs::u8>(axis->data(), axis->size()),
            cacheAlloc);
        if (!res.isOk()) {
            return res.status();
        }
        runtime->cache.legacyModels = rs::move(res.value());
        runtime->cache.legacyModelsLoaded = true;
    }

    rs::ModelData model(outAlloc);
    const rs::Status s = runtime->cache.legacyModels.tryLoad(modelId, &model);
    if (!rs::ok(s)) {
        return s;
    }
    *outModel = rs::move(model);
    return rs::Status::Ok;
}

static rs::Status runtimeTryLoadDatSeqFrameFromRuntimeCtx(
    const void* ctx,
    const rs::i32 frameId,
    rs::SeqBase* outBase,
    rs::SeqFrame* outFrame,
    rs::Allocator& alloc) noexcept {
    auto* runtime = reinterpret_cast<MapRenderRuntimeState*>(const_cast<void*>(ctx));
    if (!runtime) {
        return rs::Status::InvalidArgument;
    }
    return tryLoadDatSeqFrameFromRuntimeBlobs(runtime, frameId, outBase, outFrame, alloc);
}

static rs::Status runtimeTryLoadLegacySeqFrameFromRuntimeCtx(
    const void* ctx,
    const rs::i32 frameId,
    rs::SeqBase* outBase,
    rs::SeqFrame* outFrame,
    rs::Allocator& alloc) noexcept {
    auto* runtime = reinterpret_cast<MapRenderRuntimeState*>(const_cast<void*>(ctx));
    if (!runtime) {
        return rs::Status::InvalidArgument;
    }
    return tryLoadLegacySeqFrameFromRuntimeBlobs(runtime, frameId, outBase, outFrame, alloc);
}

static rs::Status runtimeTryLoadLegacyModelFromRuntimeCtx(
    const void* ctx,
    const rs::i32 modelId,
    rs::ModelData* outModel,
    rs::Allocator& alloc) noexcept {
    auto* runtime = reinterpret_cast<MapRenderRuntimeState*>(const_cast<void*>(ctx));
    if (!runtime) {
        return rs::Status::InvalidArgument;
    }
    runtime->debugLastLegacyModelId = modelId;
    runtime->debugLastLegacyModelMissingFile = -1;
    const rs::Status s = tryLoadLegacyModelFromRuntimeBlobs(runtime, modelId, outModel, alloc);
    runtime->debugLastLegacyModelStatus = static_cast<rs::i32>(s);
    return s;
}

static void runtimeRecordMissingTypeFromRuntimeCtx(
    const void* ctx,
    const rs::i32 kind,
    const rs::i32 id) noexcept {
    auto* runtime = reinterpret_cast<MapRenderRuntimeState*>(const_cast<void*>(ctx));
    if (!runtime) {
        return;
    }
    if (runtime->debugLastMissingTypeKind == 0) {
        runtime->debugLastMissingTypeKind = kind;
        runtime->debugLastMissingTypeId = id;
    }
    if (kind > 0 && id >= 0) {
        // MapRender runtime type-entry convention: domain = 100 + kind, group=0, file=id.
        runtimeRecordMissingBlobKey(runtime, 100 + kind, 0, id);
    }
}

static rs::Status runtimeTryGetTypeEntryBytesFromRuntimeCtx(
    const void* ctx,
    const rs::i32 kind,
    const rs::i32 id,
    rs::Span<const rs::u8>* outBytes) noexcept {
    if (!outBytes) {
        return rs::Status::InvalidArgument;
    }
    *outBytes = rs::Span<const rs::u8>();
    if (kind <= 0 || id < 0) {
        return rs::Status::NotFound;
    }
    const auto* runtime = reinterpret_cast<const MapRenderRuntimeState*>(ctx);
    if (!runtime) {
        return rs::Status::InvalidArgument;
    }
    // Some resources are not representable as per-id raw bytes in legacy/dat caches:
    // - Models: legacy caches decode from named-file blobs (domain=5).
    // - Seq frames: legacy caches decode from named-file blobs (domain=4), dat caches decode from
    //   frame-map blobs (domain=3).
    // Avoid recording (domain=100+kind,group=0,file=id) as missing for these cache types, otherwise
    // the worker/parity upload loop will spin trying to upload unfulfillable entries.
    if (kind == 3 || kind == 6 || kind == 4) {
        rs::CacheInfo cacheInfo{};
        cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
        cacheInfo.revision = runtime->cache.cacheRevision;
        const rs::CacheType cacheType = rs::detectCacheType(cacheInfo);
        if (kind == 3 && cacheType == rs::CacheType::Legacy) {
            return rs::Status::NotFound;
        }
        if (kind == 6 && (cacheType == rs::CacheType::Legacy || cacheType == rs::CacheType::Dat)) {
            return rs::Status::NotFound;
        }
        // Texture definition bytes (kind=4) are only available for Dat2 caches. Other cache types
        // would require multi-file sprite inputs (e.g. index.dat) and aren't currently supported
        // in the runtime-cache v2 seam.
        if (kind == 4 && cacheType != rs::CacheType::Dat2) {
            return rs::Status::NotFound;
        }
    }
    // MapRender runtime type-entry convention: domain = 100 + kind, group=0, file=id.
    const rs::i32 domain = 100 + kind;
    const std::vector<rs::u8>* payload = tryGetRuntimeCacheBlobBytes(*runtime, domain, 0, id);
    if (!payload) {
        // Obj spawns (kind=13) are ephemeral/optional and sourced from the TS worker input list,
        // not cache bytes. Missing entries should not cause rebuild loops.
        if (kind == 13) {
            return rs::Status::NotFound;
        }
        runtimeRecordMissingBlobKey(
            reinterpret_cast<MapRenderRuntimeState*>(const_cast<MapRenderRuntimeState*>(runtime)),
            domain,
            0,
            id);
        return rs::Status::NotFound;
    }
    // Treat empty bytes as NotFound for real type decode paths, except:
    // - kind=4 (texture def): empty means "known missing", used to avoid rebuild loops for invalid ids.
    if (payload->empty() &&
        kind != 4) {
        if (kind == 13) {
            return rs::Status::NotFound;
        }
        runtimeRecordMissingBlobKey(
            reinterpret_cast<MapRenderRuntimeState*>(const_cast<MapRenderRuntimeState*>(runtime)),
            domain,
            0,
            id);
        return rs::Status::NotFound;
    }
    *outBytes = rs::Span<const rs::u8>(payload->data(), payload->size());
    return rs::Status::Ok;
}

static rs::u32 fnv1a32UpdateByte(rs::u32 hash, rs::u8 value) noexcept {
    hash ^= static_cast<rs::u32>(value);
    hash *= 16777619u;
    return hash;
}

static rs::u32 fnv1a32UpdateI32(rs::u32 hash, rs::i32 value) noexcept {
    const rs::u32 v = static_cast<rs::u32>(value);
    hash = fnv1a32UpdateByte(hash, static_cast<rs::u8>(v & 0xffu));
    hash = fnv1a32UpdateByte(hash, static_cast<rs::u8>((v >> 8) & 0xffu));
    hash = fnv1a32UpdateByte(hash, static_cast<rs::u8>((v >> 16) & 0xffu));
    hash = fnv1a32UpdateByte(hash, static_cast<rs::u8>((v >> 24) & 0xffu));
    return hash;
}

static rs::u32 fnv1a32SpanI32(const std::vector<rs::i32>& data) noexcept {
    rs::u32 hash = 2166136261u;
    for (const rs::i32 value : data) {
        hash = fnv1a32UpdateI32(hash, value);
    }
    return hash;
}

static rs::u32 fnv1a32SpanU8(const std::vector<rs::u8>& data) noexcept {
    rs::u32 hash = 2166136261u;
    for (const rs::u8 value : data) {
        hash = fnv1a32UpdateByte(hash, value);
    }
    return hash;
}

static rs::u32 fnv1a32SpanI16(const std::vector<rs::i16>& data) noexcept {
    rs::u32 hash = 2166136261u;
    for (const rs::i16 value : data) {
        hash = fnv1a32UpdateI32(hash, static_cast<rs::i32>(value));
    }
    return hash;
}

static rs::i32 computeSeedTileHeightsHashFromMapInput(
    const rs::i32 baseX,
    const rs::i32 baseY,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 smoothTerrain,
    const rs::i32 locLoadType,
    const rs::i32 cacheGame,
    const rs::i32 cacheRevision,
    const rs::i32 mapCount,
    const rs::i32* mapSquareIds,
    const rs::i32* terrainOffsets,
    const rs::i32* terrainLengths,
    const rs::u8* terrainBytes,
    const rs::i32 terrainBytesLength,
    const rs::i32* locOffsets,
    const rs::i32* locLengths,
    const rs::u8* locBytes,
    const rs::i32 locBytesLength,
    rs::i32* outSeedHash) {
    if (!outSeedHash || sizeX <= 0 || sizeY <= 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (mapCount < 0 || terrainBytesLength < 0 || locBytesLength < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if ((mapCount > 0) &&
        (!mapSquareIds || !terrainOffsets || !terrainLengths || !locOffsets || !locLengths)) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if ((terrainBytesLength > 0 && !terrainBytes) || (locBytesLength > 0 && !locBytes)) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    rs::u32 hash = 2166136261u;
    hash = fnv1a32UpdateI32(hash, baseX);
    hash = fnv1a32UpdateI32(hash, baseY);
    hash = fnv1a32UpdateI32(hash, sizeX);
    hash = fnv1a32UpdateI32(hash, sizeY);
    hash = fnv1a32UpdateI32(hash, smoothTerrain);
    hash = fnv1a32UpdateI32(hash, locLoadType);
    hash = fnv1a32UpdateI32(hash, cacheGame);
    hash = fnv1a32UpdateI32(hash, cacheRevision);
    hash = fnv1a32UpdateI32(hash, mapCount);
    for (rs::i32 i = 0; i < mapCount; i++) {
        hash = fnv1a32UpdateI32(hash, mapSquareIds[i]);
        hash = fnv1a32UpdateI32(hash, terrainOffsets[i]);
        hash = fnv1a32UpdateI32(hash, terrainLengths[i]);
        hash = fnv1a32UpdateI32(hash, locOffsets[i]);
        hash = fnv1a32UpdateI32(hash, locLengths[i]);
    }
    for (rs::i32 i = 0; i < terrainBytesLength; i++) {
        hash = fnv1a32UpdateByte(hash, terrainBytes[i]);
    }
    for (rs::i32 i = 0; i < locBytesLength; i++) {
        hash = fnv1a32UpdateByte(hash, locBytes[i]);
    }
    *outSeedHash = static_cast<rs::i32>(hash);
    return RS_MAP_RENDER_STATUS_OK;
}

static bool requireFieldLengthEquals(
    const rs::i32* lengths,
    const rs::i32 index,
    const rs::i32 expected) {
    return lengths[index] == expected;
}

struct DecodedSeqTypeCacheEntry final {
    rs::i32 id = -1;
    rs::SeqType seq{};
};

static rs::Status tryDecodeSeqTypeFromBlob(
    const MapRenderRuntimeState* runtime,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 seqId,
    std::vector<DecodedSeqTypeCacheEntry>* cache,
    const rs::SeqType** outSeq) {
    if (!cache || !outSeq) {
        return rs::Status::InvalidArgument;
    }
    *outSeq = nullptr;
    for (std::size_t i = 0; i < cache->size(); i++) {
        if ((*cache)[i].id == seqId) {
            *outSeq = &(*cache)[i].seq;
            return rs::Status::Ok;
        }
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_SEQ_TYPE,
        seqId,
        &bytes);
    if (!rs::ok(ss)) {
        return ss;
    }
    DecodedSeqTypeCacheEntry entry{};
    entry.id = seqId;
    entry.seq = rs::SeqType(seqId, cacheInfo);
    rs::Uint8ArrayReader reader(bytes, 0);
    rs::TypeDecodeError err{};
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::TypeDecodeContext ctx{cacheInfo, nullptr, &alloc};
    const rs::Status ds = rs::decodeType(entry.seq, reader, &err, &ctx);
    if (!rs::ok(ds)) {
        return ds;
    }
    cache->push_back(std::move(entry));
    *outSeq = &cache->back().seq;
    return rs::Status::Ok;
}

static rs::i32 deriveLocSeqMetadataFromCompactIds(
    const MapRenderRuntimeState* runtime,
    const std::vector<rs::i32>& locSeqIds,
    std::vector<rs::i32>* outFrameSteps,
    std::vector<rs::i32>* outHasAnimMaya,
    std::vector<rs::i32>* outAnimMayaDurations,
    std::vector<rs::i32>* outFrameLengthOffsets,
    std::vector<rs::i32>* outFrameLengthCounts,
    std::vector<rs::i32>* outFrameLengthsPacked) {
    if (!runtime ||
        !outFrameSteps ||
        !outHasAnimMaya ||
        !outAnimMayaDurations ||
        !outFrameLengthOffsets ||
        !outFrameLengthCounts ||
        !outFrameLengthsPacked) {
        return -1;
    }
    const std::size_t locCount = locSeqIds.size();
    outFrameSteps->assign(locCount, -1);
    outHasAnimMaya->assign(locCount, 0);
    outAnimMayaDurations->assign(locCount, 0);
    outFrameLengthOffsets->assign(locCount, -1);
    outFrameLengthCounts->assign(locCount, 0);
    outFrameLengthsPacked->clear();

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
    cacheInfo.revision = runtime->cache.cacheRevision;
    const rs::CacheType cacheType = rs::detectCacheType(cacheInfo);
    std::vector<DecodedSeqTypeCacheEntry> seqCache{};
    seqCache.reserve(128);
    for (std::size_t i = 0; i < locCount; i++) {
        const rs::i32 seqId = locSeqIds[i];
        if (seqId < 0) {
            continue;
        }
        const rs::SeqType* seq = nullptr;
        const rs::Status s = tryDecodeSeqTypeFromBlob(
            runtime,
            cacheInfo,
            seqId,
            &seqCache,
            &seq);
        if (!rs::ok(s) || !seq) {
            return -2;
        }
        (*outFrameSteps)[i] = seq->frameStep;
        (*outHasAnimMaya)[i] = seq->animMayaId >= 0 ? 1 : 0;
        (*outAnimMayaDurations)[i] = seq->animMayaEnd - seq->animMayaStart;
        const std::size_t frameCount = seq->frameLengths.size();
        if (frameCount <= 0) {
            continue;
        }
        (*outFrameLengthOffsets)[i] = static_cast<rs::i32>(outFrameLengthsPacked->size());
        (*outFrameLengthCounts)[i] = static_cast<rs::i32>(frameCount);
        for (std::size_t f = 0; f < frameCount; f++) {
            rs::i32 frameLen = seq->frameLengths[f];
            if ((cacheType == rs::CacheType::Dat || cacheType == rs::CacheType::Legacy) &&
                frameLen == 0) {
                frameLen = 1;
            }
            outFrameLengthsPacked->push_back(frameLen);
        }
    }
    return 1;
}

enum class RuntimeCommandStreamBuildResult : rs::i32 {
    Built = 1,
    Failed = -1,
};

static RuntimeCommandStreamBuildResult tryBuildRuntimeCommandStreamFromBytes(
    MapRenderRuntimeState* runtime,
    const rs::i32 baseX,
    const rs::i32 baseY,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 smoothTerrain,
    const rs::i32 locLoadType,
    const rs::i32 minimizeDrawCalls,
    const rs::i32 loadLocs,
    const rs::i32 loadObjs,
    const std::vector<rs::i32>& mapSquareIds,
    const std::vector<rs::i32>& terrainOffsets,
    const std::vector<rs::i32>& terrainLengths,
    const std::vector<rs::u8>& terrainBytes,
    const std::vector<rs::i32>& locOffsets,
    const std::vector<rs::i32>& locLengths,
    const std::vector<rs::u8>& locBytes,
    const bool planOnly,
    MapRenderCachedCommandStream* outStream,
    rs::Status* outBuildStatus,
    rs::SceneLocAnimatedTickInit* outLocTickInit) {
    if (!runtime || !outStream) {
        if (outBuildStatus) {
            *outBuildStatus = rs::Status::InvalidArgument;
        }
        return RuntimeCommandStreamBuildResult::Failed;
    }
    runtime->debugLastCommandStreamCoreStatus = 0;
    runtime->debugLastMissingTypeKind = 0;
    runtime->debugLastMissingTypeId = -1;
    runtime->debugLastLegacyModelId = -1;
    runtime->debugLastLegacyModelStatus = 0;
    runtime->debugLastLegacyModelMissingFile = -1;
    runtime->lastMissingBlobTriples.clear();
    if (outLocTickInit) {
        outLocTickInit->clear();
    }
    if (outBuildStatus) {
        *outBuildStatus = rs::Status::Ok;
    }

    using CommandClock = std::chrono::steady_clock;
    const auto elapsedUs = [](const CommandClock::time_point start) noexcept -> rs::i32 {
        const auto us = std::chrono::duration_cast<std::chrono::microseconds>(
            CommandClock::now() - start);
        if (us.count() > static_cast<long long>(std::numeric_limits<rs::i32>::max())) {
            return std::numeric_limits<rs::i32>::max();
        }
        if (us.count() < 0) {
            return 0;
        }
        return static_cast<rs::i32>(us.count());
    };
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandPrepareInputUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandCoreBuildUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandValidateUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandCopyBuffersUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandCopyDebugUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandSetupUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandSceneBuildUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandTerrainUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandObjUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandFinalizeUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanSortUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanMergeNormalsUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanPlacementLoopUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanRenderPlanUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanAnimatedOrderUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocExecuteUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocExecuteInstancedUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocExecuteMergedUs)] = 0;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandFinalizeAnimatedLocUs)] = 0;

    const auto prepareInputStart = CommandClock::now();
    const bool includeLocs = loadLocs != 0;

    rs::SceneCommandBuildInput input{};
    input.baseX = baseX;
    input.baseY = baseY;
    input.sizeX = sizeX;
    input.sizeY = sizeY;
    input.smoothTerrain = smoothTerrain != 0;
    input.locLoadType = locLoadType;
    input.minimizeDrawCalls = minimizeDrawCalls != 0;
    input.loadLocs = includeLocs;
    input.loadObjs = loadObjs != 0;
    input.cacheGame = runtime->cache.cacheGame;
    input.cacheRevision = runtime->cache.cacheRevision;
    input.unitsTileHeightBasis = runtime->cache.unitsTileHeightBasis;
    input.enableExpensiveDebugStats = false;
    input.debugTerrainDigestSampleStartVertex =
        runtime->debugTerrainDigestSampleStartVertex > 0 ? runtime->debugTerrainDigestSampleStartVertex : 0;
    input.debugTerrainProbeLevel = runtime->debugTerrainProbeLevel;
    input.debugTerrainProbeTileX = runtime->debugTerrainProbeTileX;
    input.debugTerrainProbeTileY = runtime->debugTerrainProbeTileY;
    input.debugWorldHeightProbeLevel = runtime->debugWorldHeightProbeLevel;
    input.debugWorldHeightProbeWorldX = runtime->debugWorldHeightProbeWorldX;
    input.debugWorldHeightProbeWorldZ = runtime->debugWorldHeightProbeWorldZ;
    input.debugWorldHeightProbeLocId = runtime->debugWorldHeightProbeLocId;
    input.debugPackedVertexProbeIndex = runtime->debugPackedVertexProbeIndex;
    input.mapSquareIds = rs::Span<const rs::i32>(
        mapSquareIds.empty() ? nullptr : mapSquareIds.data(),
        mapSquareIds.size());
    input.terrainOffsets = rs::Span<const rs::i32>(
        terrainOffsets.empty() ? nullptr : terrainOffsets.data(),
        terrainOffsets.size());
    input.terrainLengths = rs::Span<const rs::i32>(
        terrainLengths.empty() ? nullptr : terrainLengths.data(),
        terrainLengths.size());
    input.terrainBytes = rs::Span<const rs::u8>(
        terrainBytes.empty() ? nullptr : terrainBytes.data(),
        terrainBytes.size());
    input.locOffsets = rs::Span<const rs::i32>(
        !locOffsets.empty() ? locOffsets.data() : nullptr,
        locOffsets.size());
    input.locLengths = rs::Span<const rs::i32>(
        !locLengths.empty() ? locLengths.data() : nullptr,
        locLengths.size());
    input.locBytes = rs::Span<const rs::u8>(
        !locBytes.empty() ? locBytes.data() : nullptr,
        locBytes.size());
    input.varpValues = rs::Span<const rs::i32>(
        runtime->cache.varps.empty() ? nullptr : runtime->cache.varps.data(),
        runtime->cache.varps.size());
    input.typeEntryBytesCtx = runtime;
    input.tryGetTypeEntryBytes = runtimeTryGetTypeEntryBytesFromRuntimeCtx;
    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
    cacheInfo.revision = runtime->cache.cacheRevision;
    const rs::CacheType cacheType = rs::detectCacheType(cacheInfo);

    // Only enable classic/legacy fallbacks for cache types that need them. For Dat2 caches, all
    // resources should be satisfied via per-id raw bytes in type-entry domains.
    if (cacheType == rs::CacheType::Dat) {
        input.datSeqFrameCtx = runtime;
        input.tryLoadDatSeqFrame = runtimeTryLoadDatSeqFrameFromRuntimeCtx;
    } else if (cacheType == rs::CacheType::Legacy) {
        input.legacySeqFrameCtx = runtime;
        input.tryLoadLegacySeqFrame = runtimeTryLoadLegacySeqFrameFromRuntimeCtx;
        input.modelDataCtx = runtime;
        input.tryLoadModelData = runtimeTryLoadLegacyModelFromRuntimeCtx;
    }
    input.debugMissingTypeCtx = runtime;
    input.debugRecordMissingType = runtimeRecordMissingTypeFromRuntimeCtx;
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::SceneCommandStream nativeStream{};
    rs::Status buildStatus = rs::Status::Ok;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandPrepareInputUs)] =
        elapsedUs(prepareInputStart);

    const auto coreBuildStart = CommandClock::now();
    if (planOnly) {
        buildStatus = rs::buildSceneCommandPlanOnly(input, &nativeStream, alloc);
    } else if (outLocTickInit) {
        // Capture loc-animation tick init data during build so the runtime can own tick state.
        const auto initRes = outLocTickInit->init(alloc);
        if (!initRes.isOk()) {
            buildStatus = initRes.status();
        } else {
            buildStatus = rs::buildSceneCommandStreamWithLocAnimatedTickInit(
                input,
                &nativeStream,
                outLocTickInit,
                alloc);
        }
    } else {
        buildStatus = rs::buildSceneCommandStream(input, &nativeStream, alloc);
    }
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandCoreBuildUs)] =
        elapsedUs(coreBuildStart);
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandSetupUs)] =
        nativeStream.debugBuildSetupUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandSceneBuildUs)] =
        nativeStream.debugBuildSceneBuildUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandTerrainUs)] =
        nativeStream.debugBuildTerrainUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocUs)] =
        nativeStream.debugBuildLocUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandObjUs)] =
        nativeStream.debugBuildObjUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandFinalizeUs)] =
        nativeStream.debugBuildFinalizeUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanUs)] =
        nativeStream.debugLocPlanTotalUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanSortUs)] =
        nativeStream.debugLocPlanSortPlacementsUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanMergeNormalsUs)] =
        nativeStream.debugLocPlanMergeNormalsUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanPlacementLoopUs)] =
        nativeStream.debugLocPlanPlacementLoopUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanRenderPlanUs)] =
        nativeStream.debugLocPlanRenderPlanUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocPlanAnimatedOrderUs)] =
        nativeStream.debugLocPlanAnimatedOrderUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocExecuteUs)] =
        nativeStream.debugLocExecuteTotalUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocExecuteInstancedUs)] =
        nativeStream.debugLocExecuteInstancedUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandLocExecuteMergedUs)] =
        nativeStream.debugLocExecuteMergedUs;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandFinalizeAnimatedLocUs)] =
        nativeStream.debugBuildFinalizeAnimatedLocUs;

    const auto validateStart = CommandClock::now();
    if (!rs::ok(buildStatus)) {
        if (outBuildStatus) {
            *outBuildStatus = buildStatus;
        }
        runtime->debugLastCommandStreamCoreStatus = static_cast<rs::i32>(buildStatus);
        return RuntimeCommandStreamBuildResult::Failed;
    }

    const rs::i32 totalCmdCount = static_cast<rs::i32>(nativeStream.cmdOffsets.size());
    if (nativeStream.cmdBucketIndices.size() != nativeStream.cmdOffsets.size() ||
        nativeStream.cmdElements.size() != nativeStream.cmdOffsets.size() ||
        nativeStream.cmdInstanceCounts.size() != nativeStream.cmdOffsets.size()) {
        if (outBuildStatus) {
            *outBuildStatus = rs::Status::SizeMismatch;
        }
        runtime->debugLastCommandStreamCoreStatus = static_cast<rs::i32>(rs::Status::SizeMismatch);
        return RuntimeCommandStreamBuildResult::Failed;
    }
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandValidateUs)] =
        elapsedUs(validateStart);

    const auto copyBuffersStart = CommandClock::now();
    outStream->clear();
    if (totalCmdCount > 0) {
        outStream->cmdBucketIndices.assign(
            nativeStream.cmdBucketIndices.data(),
            nativeStream.cmdBucketIndices.data() + nativeStream.cmdBucketIndices.size());
        outStream->cmdOffsets.assign(
            nativeStream.cmdOffsets.data(),
            nativeStream.cmdOffsets.data() + nativeStream.cmdOffsets.size());
        outStream->cmdElements.assign(
            nativeStream.cmdElements.data(),
            nativeStream.cmdElements.data() + nativeStream.cmdElements.size());
        outStream->cmdInstanceCounts.assign(
            nativeStream.cmdInstanceCounts.data(),
            nativeStream.cmdInstanceCounts.data() + nativeStream.cmdInstanceCounts.size());
    }
    if (!nativeStream.cmdPackedInstances.empty()) {
        outStream->cmdPackedInstances.assign(
            nativeStream.cmdPackedInstances.data(),
            nativeStream.cmdPackedInstances.data() + nativeStream.cmdPackedInstances.size());
    }
    if (!nativeStream.vertices.empty()) {
        outStream->vertices.assign(
            nativeStream.vertices.data(),
            nativeStream.vertices.data() + nativeStream.vertices.size());
    }
    if (!nativeStream.indices.empty()) {
        outStream->indices.assign(
            nativeStream.indices.data(),
            nativeStream.indices.data() + nativeStream.indices.size());
    }
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandCopyBuffersUs)] =
        elapsedUs(copyBuffersStart);

    const auto copyDebugStart = CommandClock::now();
    outStream->debugTerrainTilesConsidered = nativeStream.debugTerrainTilesConsidered;
    outStream->debugTerrainTilesEmitted = nativeStream.debugTerrainTilesEmitted;
    outStream->debugTerrainFacesEmitted = nativeStream.debugTerrainFacesEmitted;
    outStream->debugTerrainFacesUnderlayLevel0 = nativeStream.debugTerrainFacesUnderlayLevel0;
    outStream->debugTerrainFacesUnderlayLevel1 = nativeStream.debugTerrainFacesUnderlayLevel1;
    outStream->debugTerrainFacesUnderlayLevel2 = nativeStream.debugTerrainFacesUnderlayLevel2;
    outStream->debugTerrainFacesUnderlayLevel3 = nativeStream.debugTerrainFacesUnderlayLevel3;
    outStream->debugTerrainFacesOverlayLevel0 = nativeStream.debugTerrainFacesOverlayLevel0;
    outStream->debugTerrainFacesOverlayLevel1 = nativeStream.debugTerrainFacesOverlayLevel1;
    outStream->debugTerrainFacesOverlayLevel2 = nativeStream.debugTerrainFacesOverlayLevel2;
    outStream->debugTerrainFacesOverlayLevel3 = nativeStream.debugTerrainFacesOverlayLevel3;
    outStream->debugTerrainDigestHash = nativeStream.debugTerrainDigestHash;
    outStream->debugTerrainDigestFacesTotal = nativeStream.debugTerrainDigestFacesTotal;
    outStream->debugTerrainDigestVerticesTotal = nativeStream.debugTerrainDigestVerticesTotal;
    outStream->debugTerrainDigestLevelFaces0 = nativeStream.debugTerrainDigestLevelFaces0;
    outStream->debugTerrainDigestLevelFaces1 = nativeStream.debugTerrainDigestLevelFaces1;
    outStream->debugTerrainDigestLevelFaces2 = nativeStream.debugTerrainDigestLevelFaces2;
    outStream->debugTerrainDigestLevelFaces3 = nativeStream.debugTerrainDigestLevelFaces3;
    outStream->debugTerrainDigestLevelVertices0 = nativeStream.debugTerrainDigestLevelVertices0;
    outStream->debugTerrainDigestLevelVertices1 = nativeStream.debugTerrainDigestLevelVertices1;
    outStream->debugTerrainDigestLevelVertices2 = nativeStream.debugTerrainDigestLevelVertices2;
    outStream->debugTerrainDigestLevelVertices3 = nativeStream.debugTerrainDigestLevelVertices3;
    outStream->debugTerrainDigestSampleCount = nativeStream.debugTerrainDigestSampleCount;
    outStream->debugTerrainDigestSampleStrideInts = nativeStream.debugTerrainDigestSampleStrideInts;
    {
        const rs::i32 count = outStream->debugTerrainDigestSampleCount;
        const rs::i32 stride = outStream->debugTerrainDigestSampleStrideInts;
        const rs::i32 limit = rs::SceneCommandStream::kDebugTerrainDigestSampleVertexLimit;
        const rs::i32 capInts =
            rs::SceneCommandStream::kDebugTerrainDigestSampleVertexLimit *
            rs::SceneCommandStream::kDebugTerrainDigestSampleStrideInts;
        const rs::i32 intsToCopy = (count > 0 && stride > 0)
            ? ((count * stride) > capInts ? capInts : (count * stride))
            : 0;
        if (intsToCopy > 0 &&
            intsToCopy <= capInts &&
            nativeStream.debugTerrainDigestSampleStrideInts ==
                rs::SceneCommandStream::kDebugTerrainDigestSampleStrideInts &&
            nativeStream.debugTerrainDigestSampleCount >= 0 &&
            nativeStream.debugTerrainDigestSampleCount <= limit) {
            std::memcpy(
                outStream->debugTerrainDigestSamplesPacked,
                nativeStream.debugTerrainDigestSamplesPacked,
                static_cast<std::size_t>(intsToCopy) * sizeof(rs::i32));
        } else {
            outStream->debugTerrainDigestSampleCount = 0;
            outStream->debugTerrainDigestSampleStrideInts =
                rs::SceneCommandStream::kDebugTerrainDigestSampleStrideInts;
        }
    }
    outStream->debugTerrainProbeHit = nativeStream.debugTerrainProbeHit;
    outStream->debugTerrainProbeLevel = nativeStream.debugTerrainProbeLevel;
    outStream->debugTerrainProbeTileX = nativeStream.debugTerrainProbeTileX;
    outStream->debugTerrainProbeTileY = nativeStream.debugTerrainProbeTileY;
    for (rs::i32 i = 0; i < 64; i++) {
        outStream->debugTerrainProbePacked[static_cast<std::size_t>(i)] =
            nativeStream.debugTerrainProbePacked[static_cast<std::size_t>(i)];
    }
    outStream->debugWorldHeightProbeHit = nativeStream.debugWorldHeightProbeHit;
    outStream->debugWorldHeightProbeLevel = nativeStream.debugWorldHeightProbeLevel;
    outStream->debugWorldHeightProbeWorldX = nativeStream.debugWorldHeightProbeWorldX;
    outStream->debugWorldHeightProbeWorldZ = nativeStream.debugWorldHeightProbeWorldZ;
    for (rs::i32 i = 0; i < RS_MAP_RENDER_RUNTIME_WORLD_HEIGHT_PROBE_PACKED_LENGTH; i++) {
        outStream->debugWorldHeightProbePacked[static_cast<std::size_t>(i)] =
            nativeStream.debugWorldHeightProbePacked[static_cast<std::size_t>(i)];
    }
    outStream->debugSceneCommandPlanOpCount = nativeStream.debugSceneCommandPlanOpCount;
    outStream->debugSceneCommandPlanMergedGroupOpCount = nativeStream.debugSceneCommandPlanMergedGroupOpCount;
    outStream->debugSceneCommandPlanInstancedOpCount = nativeStream.debugSceneCommandPlanInstancedOpCount;
    outStream->debugSceneCommandPlanInstancedFacesTotal = nativeStream.debugSceneCommandPlanInstancedFacesTotal;
    outStream->debugSceneCommandPlanInstancedInstancesTotal = nativeStream.debugSceneCommandPlanInstancedInstancesTotal;
    outStream->debugSceneCommandPlanInstancedLodInstancesTotal = nativeStream.debugSceneCommandPlanInstancedLodInstancesTotal;
    outStream->debugSceneCommandPlanSeqHash = nativeStream.debugSceneCommandPlanSeqHash;
    outStream->debugSceneCommandPlanMultisetHashSum = nativeStream.debugSceneCommandPlanMultisetHashSum;
    outStream->debugSceneCommandPlanMultisetHashXor = nativeStream.debugSceneCommandPlanMultisetHashXor;
    if (!nativeStream.debugSceneCommandPlanOpsPacked.empty()) {
        outStream->debugSceneCommandPlanOpsPacked.assign(
            nativeStream.debugSceneCommandPlanOpsPacked.data(),
            nativeStream.debugSceneCommandPlanOpsPacked.data() + nativeStream.debugSceneCommandPlanOpsPacked.size());
    }
    if (!nativeStream.debugSceneCommandPlanOpProvenancePacked.empty()) {
        outStream->debugSceneCommandPlanOpProvenancePacked.assign(
            nativeStream.debugSceneCommandPlanOpProvenancePacked.data(),
            nativeStream.debugSceneCommandPlanOpProvenancePacked.data() + nativeStream.debugSceneCommandPlanOpProvenancePacked.size());
    }
    outStream->debugSceneBucketsCmdTotal = nativeStream.debugSceneBucketsCmdTotal;
    outStream->debugSceneBucketsInstanceTotal = nativeStream.debugSceneBucketsInstanceTotal;
    outStream->debugSceneBucketsHash = nativeStream.debugSceneBucketsHash;
    outStream->debugSceneBucketsCmdCount0 = nativeStream.debugSceneBucketsCmdCount0;
    outStream->debugSceneBucketsCmdCount1 = nativeStream.debugSceneBucketsCmdCount1;
    outStream->debugSceneBucketsCmdCount2 = nativeStream.debugSceneBucketsCmdCount2;
    outStream->debugSceneBucketsCmdCount3 = nativeStream.debugSceneBucketsCmdCount3;
    outStream->debugSceneBucketsCmdCount4 = nativeStream.debugSceneBucketsCmdCount4;
    outStream->debugSceneBucketsCmdCount5 = nativeStream.debugSceneBucketsCmdCount5;
    outStream->debugSceneBucketsCmdCount6 = nativeStream.debugSceneBucketsCmdCount6;
    outStream->debugSceneBucketsCmdCount7 = nativeStream.debugSceneBucketsCmdCount7;
    outStream->debugLocRenderPlacementDigestHash = nativeStream.debugLocRenderPlacementDigestHash;
    outStream->debugLocRenderPlacementCount = nativeStream.debugLocRenderPlacementCount;
    outStream->debugLocPlacementsDecoded = nativeStream.debugLocPlacementsDecoded;
    outStream->debugLocPlacementsInBounds = nativeStream.debugLocPlacementsInBounds;
    outStream->debugLocPlacementsResolved = nativeStream.debugLocPlacementsResolved;
    outStream->debugLocResolveNotFound = nativeStream.debugLocResolveNotFound;
    outStream->debugLocNoModelsForPlacement = nativeStream.debugLocNoModelsForPlacement;
    outStream->debugLocModelCandidates = nativeStream.debugLocModelCandidates;
    outStream->debugLocModelStatsDecodeFailed = nativeStream.debugLocModelStatsDecodeFailed;
    outStream->debugLocModelStatsNotFound = nativeStream.debugLocModelStatsNotFound;
    outStream->debugLocModelStatsOtherError = nativeStream.debugLocModelStatsOtherError;
    outStream->debugLocMissingModelSampleCount = nativeStream.debugLocMissingModelSampleCount;
    outStream->debugLocMissingModelSample0 = nativeStream.debugLocMissingModelSample0;
    outStream->debugLocMissingModelSample1 = nativeStream.debugLocMissingModelSample1;
    outStream->debugLocMissingModelSample2 = nativeStream.debugLocMissingModelSample2;
    outStream->debugLocMissingModelSample3 = nativeStream.debugLocMissingModelSample3;
    outStream->debugLocMissingModelLocTypeId = nativeStream.debugLocMissingModelLocTypeId;
    outStream->debugLocMissingModelPlacementType = nativeStream.debugLocMissingModelPlacementType;
    outStream->debugLocMissingModelRotation = nativeStream.debugLocMissingModelRotation;
    outStream->debugLocModelStatsZeroFaces = nativeStream.debugLocModelStatsZeroFaces;
    outStream->debugLocGroupStatsMismatch = nativeStream.debugLocGroupStatsMismatch;
    outStream->debugLocPlacementsQueuedAnyModel = nativeStream.debugLocPlacementsQueuedAnyModel;
    outStream->debugLocInstancesQueued = nativeStream.debugLocInstancesQueued;
    outStream->debugLocAnimatedNoFaces = nativeStream.debugLocAnimatedNoFaces;
    outStream->debugLocAnimatedQueued = nativeStream.debugLocAnimatedQueued;
    outStream->debugObjSpawnsDecoded = nativeStream.debugObjSpawnsDecoded;
    outStream->debugObjSpawnsInBounds = nativeStream.debugObjSpawnsInBounds;
    outStream->debugObjModelCandidates = nativeStream.debugObjModelCandidates;
    outStream->debugObjInstancesQueued = nativeStream.debugObjInstancesQueued;
    outStream->debugLocMergeByPlacementCount = nativeStream.debugLocMergeByPlacementCount;
    outStream->debugLocInstancedGroupCount = nativeStream.debugLocInstancedGroupCount;
    outStream->debugLocVariantGroupsQueued = nativeStream.debugLocVariantGroupsQueued;
    outStream->debugLocVariantGroupsHash = nativeStream.debugLocVariantGroupsHash;
    outStream->debugLocVariantType9Queued = nativeStream.debugLocVariantType9Queued;
    outStream->debugLocVariantType0Queued = nativeStream.debugLocVariantType0Queued;
    outStream->debugLocVariantId1651Type9Queued = nativeStream.debugLocVariantId1651Type9Queued;
    outStream->debugLocVariantId1651Type0Queued = nativeStream.debugLocVariantId1651Type0Queued;
    outStream->debugLocVariantCandidatesExpanded = nativeStream.debugLocVariantCandidatesExpanded;
    outStream->debugLocVariantDecodeFailed = nativeStream.debugLocVariantDecodeFailed;
    outStream->debugLocPreMergeGroupKeysQueued = nativeStream.debugLocPreMergeGroupKeysQueued;
    outStream->debugLocPreMergeGroupKeysHash = nativeStream.debugLocPreMergeGroupKeysHash;
    outStream->debugLocMergedDummyCommandCount = nativeStream.debugLocMergedDummyCommandCount;
    outStream->debugLocMergedDummyElementsTotal = nativeStream.debugLocMergedDummyElementsTotal;
    outStream->debugLocMergedDummyHash = nativeStream.debugLocMergedDummyHash;
    outStream->debugLocMergedDummyBaseCount = nativeStream.debugLocMergedDummyBaseCount;
    outStream->debugLocMergedDummyAlphaCount = nativeStream.debugLocMergedDummyAlphaCount;
    outStream->debugLocMergedDummyLodCount = nativeStream.debugLocMergedDummyLodCount;
    outStream->debugLocMergedDummyLodAlphaCount = nativeStream.debugLocMergedDummyLodAlphaCount;
    outStream->debugGeometryElementMismatchCount = nativeStream.debugGeometryElementMismatchCount;
    outStream->debugGeometryElementMismatchTotalDelta = nativeStream.debugGeometryElementMismatchTotalDelta;
    outStream->debugGeometryElementMismatchMaxDelta = nativeStream.debugGeometryElementMismatchMaxDelta;
    outStream->debugGeometryElementMismatchSampleTypeId = nativeStream.debugGeometryElementMismatchSampleTypeId;
    outStream->debugGeometryElementMismatchSamplePlacementType = nativeStream.debugGeometryElementMismatchSamplePlacementType;
    outStream->debugGeometryElementMismatchSampleRotation = nativeStream.debugGeometryElementMismatchSampleRotation;
    outStream->debugObjMergeByPlacementCount = nativeStream.debugObjMergeByPlacementCount;
    outStream->debugObjInstancedGroupCount = nativeStream.debugObjInstancedGroupCount;
    if (!nativeStream.debugTerrainTileFaceCounts.empty()) {
        outStream->debugTerrainTileFaceCounts.assign(
            nativeStream.debugTerrainTileFaceCounts.data(),
            nativeStream.debugTerrainTileFaceCounts.data() + nativeStream.debugTerrainTileFaceCounts.size());
    }
    outStream->debugTerrainTileFaceCountsLevels = nativeStream.debugTerrainTileFaceCountsLevels;
    if (!nativeStream.debugLocPreMergeGroupKeySignatures.empty()) {
        outStream->debugLocPreMergeGroupKeySignatures.assign(
            nativeStream.debugLocPreMergeGroupKeySignatures.data(),
            nativeStream.debugLocPreMergeGroupKeySignatures.data() + nativeStream.debugLocPreMergeGroupKeySignatures.size());
    }
    if (!nativeStream.debugLocRenderPlacementEntriesPacked.empty()) {
        outStream->debugLocRenderPlacementEntriesPacked.assign(
            nativeStream.debugLocRenderPlacementEntriesPacked.data(),
            nativeStream.debugLocRenderPlacementEntriesPacked.data() + nativeStream.debugLocRenderPlacementEntriesPacked.size());
    }
    if (!nativeStream.debugLocPreMergeGroupKeyEntriesPacked.empty()) {
        outStream->debugLocPreMergeGroupKeyEntriesPacked.assign(
            nativeStream.debugLocPreMergeGroupKeyEntriesPacked.data(),
            nativeStream.debugLocPreMergeGroupKeyEntriesPacked.data() + nativeStream.debugLocPreMergeGroupKeyEntriesPacked.size());
    }
    if (!nativeStream.debugLocMergeDecisionEntriesPacked.empty()) {
        outStream->debugLocMergeDecisionEntriesPacked.assign(
            nativeStream.debugLocMergeDecisionEntriesPacked.data(),
            nativeStream.debugLocMergeDecisionEntriesPacked.data() + nativeStream.debugLocMergeDecisionEntriesPacked.size());
    }
    if (!nativeStream.debugLocMergeEmitEntriesPacked.empty()) {
        outStream->debugLocMergeEmitEntriesPacked.assign(
            nativeStream.debugLocMergeEmitEntriesPacked.data(),
            nativeStream.debugLocMergeEmitEntriesPacked.data() + nativeStream.debugLocMergeEmitEntriesPacked.size());
    }
    if (!nativeStream.debugLocMergeNormalsTraceEntriesPacked.empty()) {
        outStream->debugLocMergeNormalsTraceEntriesPacked.assign(
            nativeStream.debugLocMergeNormalsTraceEntriesPacked.data(),
            nativeStream.debugLocMergeNormalsTraceEntriesPacked.data() + nativeStream.debugLocMergeNormalsTraceEntriesPacked.size());
    }
    if (!nativeStream.debugCommandProvenancePacked.empty()) {
        outStream->debugCommandProvenancePacked.assign(
            nativeStream.debugCommandProvenancePacked.data(),
            nativeStream.debugCommandProvenancePacked.data() + nativeStream.debugCommandProvenancePacked.size());
    }
    outStream->debugTerrainTileFaceCountsWidth = nativeStream.debugTerrainTileFaceCountsWidth;
    outStream->debugTerrainTileFaceCountsHeight = nativeStream.debugTerrainTileFaceCountsHeight;
    outStream->debugTerrainTileFaceCountsBorder = nativeStream.debugTerrainTileFaceCountsBorder;
    outStream->baseX = baseX;
    outStream->baseY = baseY;
    outStream->sizeX = sizeX;
    outStream->sizeY = sizeY;
    outStream->locLoadType = locLoadType;
    outStream->loaded = true;
    runtime->debugLastBuildStageTimingsUs[static_cast<std::size_t>(kBuildTimingCommandCopyDebugUs)] =
        elapsedUs(copyDebugStart);
    return RuntimeCommandStreamBuildResult::Built;
}

} // namespace

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define RS_WASM_KEEPALIVE EMSCRIPTEN_KEEPALIVE
#else
#define RS_WASM_KEEPALIVE
#endif

extern "C" {

static constexpr rs::i32 RS_DRAW_BUCKET_COUNT = 8;
static constexpr rs::i32 RS_SCENE_LEVELS = 4;
static constexpr rs::i32 RS_LOC_CYCLE_SCALE = 1024;
static constexpr rs::i32 RS_NPC_PATH_QUEUE_LEN = 10;
static constexpr rs::i32 RS_MOVEMENT_TYPE_CRAWL = 0;
static constexpr rs::i32 RS_MOVEMENT_TYPE_RUN = 2;

    RS_WASM_KEEPALIVE rs::i32 rs_map_render_bridge_abi_version() {
        return 2;
    }

#include "MapRenderRuntimeLifecycle.inl"

#include "MapRenderRuntimeCacheV2Api.inl"

RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_get_last_missing_blob_entries_packed(
    const rs::i32 runtimeHandle,
    rs::i32* outPacked,
    const rs::i32 outPackedLength) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime || outPackedLength < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    const rs::i32 entryCount =
        static_cast<rs::i32>(
            runtime->lastMissingBlobTriples.size() /
            static_cast<std::size_t>(RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_STRIDE));
    const rs::i32 neededLength =
        RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_HEADER_LENGTH +
        (entryCount * RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_STRIDE);
    if (!outPacked || outPackedLength < neededLength) {
        return neededLength;
    }
    outPacked[0] = RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_VERSION;
    outPacked[1] = entryCount;
    if (entryCount > 0) {
        std::memcpy(
            outPacked + RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_HEADER_LENGTH,
            runtime->lastMissingBlobTriples.data(),
            static_cast<std::size_t>(entryCount * RS_MAP_RENDER_RUNTIME_MISSING_BLOB_ENTRIES_PACKED_STRIDE) *
                sizeof(rs::i32));
    }
    return neededLength;
}

    #include "MapRenderRuntimeDebugExports.inl"

	    #include "MapRenderRuntimeTickStateSet.inl"

// Query whether a runtime tick state exists for a given key (we use mapId as the key in TS).
RS_WASM_KEEPALIVE rs::i32 rs_map_render_runtime_has_tick_state(
    const rs::i32 runtimeHandle,
    const rs::i32 stateKey) {
    MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
    if (!runtime) {
        return 0;
    }
    return runtime->tickStates.find(stateKey) != runtime->tickStates.end() ? 1 : 0;
}

	RS_WASM_KEEPALIVE rs::i32 rs_heightmap_from_scene_tile_heights(
	    const rs::i32* tileHeights,
	    rs::i32 levels,
	    rs::i32 sizeX,
    rs::i32 sizeY,
    rs::i32 unitsTileHeightBasis,
    rs::i16* outHeightMap,
    rs::i32 outLength) {
    if (!tileHeights || !outHeightMap) {
        return 0;
    }
    if (levels <= 0 || sizeX <= 0 || sizeY <= 0 || unitsTileHeightBasis <= 0) {
        return 0;
    }

    const rs::i32 expectedOutLength = levels * sizeX * sizeY;
    if (outLength != expectedOutLength) {
        return 0;
    }

    rs::i32 outIndex = 0;
    for (rs::i32 level = 0; level < levels; level++) {
        const rs::i32 levelOffset = level * (sizeX + 1) * (sizeY + 1);
        // Match TS payload contract ordering: level -> y -> x.
        for (rs::i32 y = 0; y < sizeY; y++) {
            for (rs::i32 x = 0; x < sizeX; x++) {
                const rs::i32 src = levelOffset + x * (sizeY + 1) + y;
                const rs::i32 h = tileHeights[src];
                outHeightMap[outIndex++] = static_cast<rs::i16>((-h) / unitsTileHeightBasis);
            }
        }
    }
    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_decode_npc_spawns_from_bytes(
    const rs::u8* tileRenderFlagsLevel1,
    rs::i32 flagsWidth,
    rs::i32 flagsLength,
    rs::i32 borderSize,
    rs::i32 mapX,
    rs::i32 mapY,
    const rs::u8* data,
    rs::i32 dataLength,
    const rs::u8* npcLoginScreenPropsById,
    rs::i32 npcLoginScreenPropsByIdLength,
    rs::i32 requiredLoginScreenPropsMask,
    rs::i32* outPacked,
    rs::i32 outPackedIntLength) {
    if (!tileRenderFlagsLevel1 || !data || flagsLength < 0 || dataLength < 0 || outPackedIntLength < 0) {
        return -1;
    }
    if (npcLoginScreenPropsByIdLength < 0) {
        return -1;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::Vec<rs::NpcSpawn> decoded(alloc);
    const rs::Status s = rs::decodeNpcSpawnsFromBytes(
        rs::Span<const rs::u8>(tileRenderFlagsLevel1, static_cast<std::size_t>(flagsLength)),
        flagsWidth,
        borderSize,
        mapX,
        mapY,
        rs::Span<const rs::u8>(data, static_cast<std::size_t>(dataLength)),
        &decoded,
        alloc);
    if (!rs::ok(s)) {
        return -1;
    }

    const bool useLoginScreenPropsFilter =
        npcLoginScreenPropsById &&
        npcLoginScreenPropsByIdLength > 0 &&
        requiredLoginScreenPropsMask != 0;

    rs::i32 count = 0;
    for (std::size_t i = 0; i < decoded.size(); i++) {
        const rs::NpcSpawn& spawn = decoded[i];
        if (useLoginScreenPropsFilter) {
            const rs::i32 id = spawn.id;
            if (id < 0 || id >= npcLoginScreenPropsByIdLength) {
                continue;
            }
            const rs::i32 loginScreenProps = static_cast<rs::i32>(npcLoginScreenPropsById[id]);
            if ((loginScreenProps & requiredLoginScreenPropsMask) == 0) {
                continue;
            }
        }
        count++;
    }

    const rs::i32 requiredPackedInts = count * 4;
    if (!outPacked) {
        return count;
    }
    if (outPackedIntLength < requiredPackedInts) {
        return -2;
    }

    rs::i32 outCount = 0;
    for (std::size_t i = 0; i < decoded.size(); i++) {
        const rs::NpcSpawn& spawn = decoded[i];
        if (useLoginScreenPropsFilter) {
            const rs::i32 id = spawn.id;
            if (id < 0 || id >= npcLoginScreenPropsByIdLength) {
                continue;
            }
            const rs::i32 loginScreenProps = static_cast<rs::i32>(npcLoginScreenPropsById[id]);
            if ((loginScreenProps & requiredLoginScreenPropsMask) == 0) {
                continue;
            }
        }

        const rs::i32 off = outCount * 4;
        outPacked[off + 0] = spawn.id;
        outPacked[off + 1] = spawn.x;
        outPacked[off + 2] = spawn.y;
        outPacked[off + 3] = spawn.level;
        outCount++;
    }
    return outCount;
}

static rs::i32 mapRenderStatusFromCoreStatus(const rs::Status s) noexcept {
    if (s == rs::Status::SizeMismatch || s == rs::Status::OutOfRange) {
        return -2;
    }
    return -1;
}

static rs::i32 modelInfoTextureLengthFromCounts(
    const rs::i32 cmdCount,
    const rs::i32 instanceCount) noexcept {
    const rs::i32 dataLengthRounded = ((cmdCount * 4 + instanceCount + 15) / 16) * 16;
    return (dataLengthRounded > 16 ? dataLengthRounded : 16) * 4;
}

static rs::i32 roundHeightOffsetDiv8Js(const rs::i32 heightOffset) noexcept {
    if (heightOffset >= 0) {
        return (heightOffset + 4) / 8;
    }
    return -(((-heightOffset) + 3) / 8);
}

static rs::i32 clampI32(const rs::i32 value, const rs::i32 minValue, const rs::i32 maxValue) noexcept {
    if (value < minValue) {
        return minValue;
    }
    if (value > maxValue) {
        return maxValue;
    }
    return value;
}

static rs::i32 packFloat11Js(const float v) noexcept {
    return static_cast<rs::i32>(1024 - static_cast<rs::i32>(v * 64.0f + (v >= 0.0f ? 0.5f : -0.5f)));
}

static rs::Status appendPackedVertex(
    std::vector<rs::u8>* outVertices,
    const rs::i32 x,
    const rs::i32 y,
    const rs::i32 z,
    rs::i32 hsl,
    const rs::i32 alpha,
    const float u,
    const float v,
    const rs::i32 priority,
    rs::i32 textureId = -1,
    rs::i32 textureId1 = -1,
    float textureBlend = 0.0f) noexcept {
    if (!outVertices) {
        return rs::Status::InvalidArgument;
    }
    if (outVertices->size() > static_cast<std::size_t>(2147483647 - 16)) {
        return rs::Status::OutOfRange;
    }

    // Packed format stores raw cache texture ids as 16-bit `textureIdPlus1` (0 reserved).
    if (textureId > 0xfffe) {
        textureId = -1;
    }
    if (textureId1 > 0xfffe) {
        textureId1 = -1;
    }

    if (textureBlend < 0.0f) textureBlend = 0.0f;
    if (textureBlend > 1.0f) textureBlend = 1.0f;

    const rs::i32 tex0 = textureId != -1 ? (textureId + 1) : 0;
    const rs::i32 tex1 = textureId1 != -1 ? (textureId1 + 1) : 0;

    const bool isTextured = tex0 != 0;
    if (isTextured) {
        hsl &= 127;
        hsl |= (tex0 & 0x1ff) << 7;
    }

    const bool hasBlend =
        isTextured &&
        tex1 != 0 &&
        tex1 != tex0 &&
        textureBlend > 0.0f;

    const rs::i32 xPos = clampI32(x + 0x4000, 0, 0x8000);
    const rs::i32 yPos = clampI32(-y + 0x4000, 0, 0x8000);
    const rs::i32 zPos = clampI32(z + 0x4000, 0, 0x8000);
    const rs::i32 alphaClamped = clampI32(alpha, 0, 0xff);
    const rs::i32 priorityClamped = (priority & 0x7);

    const rs::i32 uPacked = clampI32(packFloat11Js(u), 0, 0x7ff);
    const rs::i32 vPacked = clampI32(packFloat11Js(v), 0, 0x7ff);

    const rs::i32 blend8 =
        hasBlend ? clampI32(static_cast<rs::i32>(textureBlend * 255.0f + 0.5f), 0, 0xff) : 0;
    const rs::i32 tex0High7 = isTextured ? ((tex0 >> 9) & 0x7f) : 0;
    const rs::i32 tex1Low10 = hasBlend ? (tex1 & 0x3ff) : 0;
    const rs::i32 tex1High6 = hasBlend ? ((tex1 >> 10) & 0x3f) : 0;

    const rs::u32 v0 =
        (static_cast<rs::u32>(xPos) << 17) |
        ((static_cast<rs::u32>(uPacked) & 0x3fu) << 11) |
        static_cast<rs::u32>(vPacked);
    const rs::u32 v1 =
        static_cast<rs::u32>(yPos) |
        (static_cast<rs::u32>(hsl & 0xffff) << 15) |
        (static_cast<rs::u32>(isTextured ? 1 : 0) << 31);
    const rs::u32 v2 =
        (static_cast<rs::u32>(zPos) << 17) |
        (static_cast<rs::u32>(alphaClamped) << 9) |
        (static_cast<rs::u32>(priorityClamped) << 6) |
        static_cast<rs::u32>(uPacked >> 6);
    const rs::u32 v3 =
        static_cast<rs::u32>(tex1Low10) |
        (static_cast<rs::u32>(hasBlend ? 1 : 0) << 10) |
        (static_cast<rs::u32>(blend8) << 11) |
        (static_cast<rs::u32>(tex0High7) << 19) |
        (static_cast<rs::u32>(tex1High6) << 26);

    const std::size_t off = outVertices->size();
    outVertices->resize(off + 16);
    auto writeU32LE = [&](const std::size_t byteOff, const rs::u32 value) {
        (*outVertices)[byteOff + 0] = static_cast<rs::u8>(value & 0xffu);
        (*outVertices)[byteOff + 1] = static_cast<rs::u8>((value >> 8) & 0xffu);
        (*outVertices)[byteOff + 2] = static_cast<rs::u8>((value >> 16) & 0xffu);
        (*outVertices)[byteOff + 3] = static_cast<rs::u8>((value >> 24) & 0xffu);
    };

    writeU32LE(off + 0, v0);
    writeU32LE(off + 4, v1);
    writeU32LE(off + 8, v2);
    writeU32LE(off + 12, v3);
    return rs::Status::Ok;
}

static rs::i32 planCommandStreamBucketsAndModelInfo(
    const rs::i32* cmdBucketIndices,
    const rs::i32* cmdInstanceCounts,
    rs::i32 totalCmdCount,
    rs::i32* outBucketCmdCounts,
    rs::i32 outBucketCmdCountsLength,
    rs::i32* outBucketModelInfoLengths,
    rs::i32 outBucketModelInfoLengthsLength,
    rs::i32* outTotalModelInfoLength) {
    if (!outBucketCmdCounts || !outBucketModelInfoLengths || !outTotalModelInfoLength) {
        return -1;
    }
    if (totalCmdCount < 0 ||
        outBucketCmdCountsLength != RS_DRAW_BUCKET_COUNT ||
        outBucketModelInfoLengthsLength != RS_DRAW_BUCKET_COUNT) {
        return -1;
    }
    if (totalCmdCount > 0 && (!cmdBucketIndices || !cmdInstanceCounts)) {
        return -1;
    }

    rs::i32 bucketCmdCounts[RS_DRAW_BUCKET_COUNT]{};
    rs::i32 bucketInstanceCounts[RS_DRAW_BUCKET_COUNT]{};
    for (rs::i32 i = 0; i < totalCmdCount; i++) {
        const rs::i32 bucket = cmdBucketIndices[i];
        const rs::i32 instanceCount = cmdInstanceCounts[i];
        if (bucket < 0 || bucket >= RS_DRAW_BUCKET_COUNT || instanceCount < 0) {
            return -2;
        }
        bucketCmdCounts[bucket]++;
        bucketInstanceCounts[bucket] += instanceCount;
    }

    for (rs::i32 bucket = 0; bucket < RS_DRAW_BUCKET_COUNT; bucket++) {
        outBucketCmdCounts[bucket] = bucketCmdCounts[bucket];
        outBucketModelInfoLengths[bucket] =
            modelInfoTextureLengthFromCounts(bucketCmdCounts[bucket], bucketInstanceCounts[bucket]);
    }
    rs::i32 totalModelInfoLength = 0;
    for (rs::i32 bucket = 0; bucket < RS_DRAW_BUCKET_COUNT; bucket++) {
        totalModelInfoLength += outBucketModelInfoLengths[bucket];
    }
    *outTotalModelInfoLength = totalModelInfoLength;
    return 1;
}

struct PackedTerrainMapBytesProvider final : rs::MapBytesProvider {
    rs::Span<const rs::i32> mapSquareIds{};
    rs::Span<const rs::i32> terrainOffsets{};
    rs::Span<const rs::i32> terrainLengths{};
    rs::Span<const rs::u8> terrainBytes{};

    [[nodiscard]] rs::i32 mapId(const rs::i32 mapX, const rs::i32 mapY) const noexcept {
        return (mapX << 8) + mapY;
    }

    [[nodiscard]] rs::i32 findMapIndex(const rs::i32 mapX, const rs::i32 mapY) const noexcept {
        const rs::i32 id = mapId(mapX, mapY);
        for (std::size_t i = 0; i < mapSquareIds.size(); i++) {
            if (mapSquareIds[i] == id) {
                if (i > static_cast<std::size_t>(2147483647)) {
                    return -1;
                }
                return static_cast<rs::i32>(i);
            }
        }
        return -1;
    }

    rs::Status copySpanSlice(
        const rs::Span<const rs::u8> source,
        const rs::i32 off,
        const rs::i32 len,
        rs::Vec<rs::u8>* out) const noexcept {
        if (!out) {
            return rs::Status::InvalidArgument;
        }
        out->clear();
        if ((off < 0) != (len < 0)) {
            return rs::Status::BadFormat;
        }
        if (off < 0 || len == 0) {
            return rs::Status::NotFound;
        }
        if (off > static_cast<rs::i32>(source.size()) ||
            len > static_cast<rs::i32>(source.size()) - off) {
            return rs::Status::OutOfRange;
        }
        auto rr = out->resize(static_cast<std::size_t>(len));
        if (!rr.isOk()) {
            return rr.status();
        }
        for (rs::i32 i = 0; i < len; i++) {
            (*out)[static_cast<std::size_t>(i)] = source[static_cast<std::size_t>(off + i)];
        }
        return rs::Status::Ok;
    }

    rs::Status tryLoadTerrainBytes(
        const rs::i32 mapX,
        const rs::i32 mapY,
        rs::Vec<rs::u8>* out) const noexcept override {
        const rs::i32 mapIdx = findMapIndex(mapX, mapY);
        if (mapIdx < 0) {
            return rs::Status::NotFound;
        }
        return copySpanSlice(
            terrainBytes,
            terrainOffsets[static_cast<std::size_t>(mapIdx)],
            terrainLengths[static_cast<std::size_t>(mapIdx)],
            out);
    }

    rs::Status tryLoadLocBytes(rs::i32, rs::i32, rs::Vec<rs::u8>* out) const noexcept override {
        if (!out) {
            return rs::Status::InvalidArgument;
        }
        out->clear();
        return rs::Status::NotFound;
    }

    rs::Status tryLoadNpcSpawnBytes(rs::i32, rs::i32, rs::Vec<rs::u8>* out) const noexcept override {
        if (!out) {
            return rs::Status::InvalidArgument;
        }
        out->clear();
        return rs::Status::NotFound;
    }
};

static rs::i32 buildTileHeightsFromMapSquaresCpp(
    rs::i32 baseX,
    rs::i32 baseY,
    rs::i32 sizeX,
    rs::i32 sizeY,
    rs::i32 cacheGame,
    rs::i32 cacheRevision,
    rs::i32 mapCount,
    const rs::i32* mapSquareIds,
    const rs::i32* terrainOffsets,
    const rs::i32* terrainLengths,
    const rs::u8* terrainBytes,
    rs::i32 terrainBytesLength,
    rs::Vec<rs::i32>* outTileHeights) {
    if (!outTileHeights || sizeX <= 0 || sizeY <= 0 || mapCount < 0 || terrainBytesLength < 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (mapCount > 0 && (!mapSquareIds || !terrainOffsets || !terrainLengths)) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (terrainBytesLength > 0 && !terrainBytes) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::SceneData scene{};
    auto rr = scene.init(RS_SCENE_LEVELS, sizeX, sizeY, alloc);
    if (!rr.isOk()) {
        return mapRenderStatusFromCoreStatus(rr.status());
    }

    rs::SceneBuildScratch scratch{};
    rr = scratch.init(alloc);
    if (!rr.isOk()) {
        return mapRenderStatusFromCoreStatus(rr.status());
    }

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(cacheGame);
    cacheInfo.revision = cacheRevision;

    rs::SceneRuntimeServices services{};
    services.cacheInfo = &cacheInfo;
    const rs::SceneBuildContext context = rs::createSceneBuildContext(
        baseX,
        baseY,
        sizeX,
        sizeY,
        rs::SceneLocLoadType::NoModels);

    PackedTerrainMapBytesProvider provider{};
    provider.mapSquareIds = rs::Span<const rs::i32>(
        mapSquareIds,
        static_cast<std::size_t>(mapCount));
    provider.terrainOffsets = rs::Span<const rs::i32>(
        terrainOffsets,
        static_cast<std::size_t>(mapCount));
    provider.terrainLengths = rs::Span<const rs::i32>(
        terrainLengths,
        static_cast<std::size_t>(mapCount));
    provider.terrainBytes = rs::Span<const rs::u8>(
        terrainBytes,
        static_cast<std::size_t>(terrainBytesLength));

    rs::Status s = rs::decodeTerrainStage(services, provider, context, &scene, &scratch);
    if (!rs::ok(s)) {
        return mapRenderStatusFromCoreStatus(s);
    }
    s = rs::fillEmptyTerrainStage(services, context, &scene, &scratch);
    if (!rs::ok(s)) {
        return mapRenderStatusFromCoreStatus(s);
    }

    rr = outTileHeights->resize(scene.tileHeights.size());
    if (!rr.isOk()) {
        return mapRenderStatusFromCoreStatus(rr.status());
    }
    for (std::size_t i = 0; i < scene.tileHeights.size(); i++) {
        (*outTileHeights)[i] = scene.tileHeights[i];
    }
    return RS_MAP_RENDER_STATUS_OK;
}

static rs::i32 rs_build_render_payload_from_command_stream_input(
    const rs::i32* tileHeights,
    rs::i32 levels,
    rs::i32 sizeX,
    rs::i32 sizeY,
    rs::i32 unitsTileHeightBasis,
    const rs::i32* cmdBucketIndices,
    const rs::i32* cmdOffsets,
    const rs::i32* cmdElements,
    const rs::i32* cmdInstanceCounts,
    rs::i32 totalCmdCount,
    const rs::i32* cmdPackedInstances,
    rs::i32 cmdPackedInstancesLength,
    rs::i32* outDrawRanges,
    rs::i32 outDrawRangesLength,
    rs::u16* outModelInfoTextureConcat,
    rs::i32 outModelInfoTextureConcatLength,
    rs::i16* outHeightMap,
    rs::i32 outHeightMapLength) {
    if (!tileHeights || !outModelInfoTextureConcat || !outHeightMap) {
        return -1;
    }
    if (levels <= 0 || sizeX <= 0 || sizeY <= 0 || unitsTileHeightBasis <= 0) {
        return -1;
    }
    if (totalCmdCount < 0 || cmdPackedInstancesLength < 0 || outDrawRangesLength < 0 || outModelInfoTextureConcatLength < 0) {
        return -1;
    }
    if (totalCmdCount > 0 && (!cmdBucketIndices || !cmdOffsets || !cmdElements || !cmdInstanceCounts)) {
        return -1;
    }
    if (cmdPackedInstancesLength > 0 && !cmdPackedInstances) {
        return -1;
    }
    if (outDrawRangesLength > 0 && !outDrawRanges) {
        return -1;
    }

    const rs::i32 expectedHeightMapLength = levels * sizeX * sizeY;
    if (outHeightMapLength != expectedHeightMapLength) {
        return -2;
    }
    if (outDrawRangesLength != 0 && outDrawRangesLength != totalCmdCount * 3) {
        return -2;
    }
    if (rs_heightmap_from_scene_tile_heights(
            tileHeights,
            levels,
            sizeX,
            sizeY,
            unitsTileHeightBasis,
            outHeightMap,
            outHeightMapLength) != 1) {
        return -1;
    }
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::Vec<rs::i32> bucketCmdCounts(alloc);
    rs::Vec<rs::i32> packedCmdOffsets(alloc);
    rs::Vec<rs::i32> packedCmdElements(alloc);
    rs::Vec<rs::i32> packedCmdInstanceCounts(alloc);
    rs::Vec<rs::i32> packedInstances(alloc);

    auto rr = bucketCmdCounts.resize(static_cast<std::size_t>(RS_DRAW_BUCKET_COUNT));
    if (!rr.isOk()) {
        return mapRenderStatusFromCoreStatus(rr.status());
    }
    rr = packedCmdOffsets.resize(static_cast<std::size_t>(totalCmdCount));
    if (!rr.isOk()) {
        return mapRenderStatusFromCoreStatus(rr.status());
    }
    rr = packedCmdElements.resize(static_cast<std::size_t>(totalCmdCount));
    if (!rr.isOk()) {
        return mapRenderStatusFromCoreStatus(rr.status());
    }
    rr = packedCmdInstanceCounts.resize(static_cast<std::size_t>(totalCmdCount));
    if (!rr.isOk()) {
        return mapRenderStatusFromCoreStatus(rr.status());
    }
    rr = packedInstances.resize(static_cast<std::size_t>(cmdPackedInstancesLength));
    if (!rr.isOk()) {
        return mapRenderStatusFromCoreStatus(rr.status());
    }

    const rs::Status packInputStatus = rs::packRuntimeInputFromCommandStream(
        rs::Span<const rs::i32>(cmdBucketIndices, static_cast<std::size_t>(totalCmdCount)),
        rs::Span<const rs::i32>(cmdOffsets, static_cast<std::size_t>(totalCmdCount)),
        rs::Span<const rs::i32>(cmdElements, static_cast<std::size_t>(totalCmdCount)),
        rs::Span<const rs::i32>(cmdInstanceCounts, static_cast<std::size_t>(totalCmdCount)),
        rs::Span<const rs::i32>(
            cmdPackedInstances,
            static_cast<std::size_t>(cmdPackedInstancesLength)),
        rs::Span<rs::i32>(bucketCmdCounts.data(), bucketCmdCounts.size()),
        rs::Span<rs::i32>(packedCmdOffsets.data(), packedCmdOffsets.size()),
        rs::Span<rs::i32>(packedCmdElements.data(), packedCmdElements.size()),
        rs::Span<rs::i32>(packedCmdInstanceCounts.data(), packedCmdInstanceCounts.size()),
        rs::Span<rs::i32>(packedInstances.data(), packedInstances.size()),
        alloc);
    if (!rs::ok(packInputStatus)) {
        return mapRenderStatusFromCoreStatus(packInputStatus);
    }

    rs::i32 bucketModelInfoLengths[RS_DRAW_BUCKET_COUNT]{};
    rs::i32 totalModelInfoLength = 0;
    rs::i32 cmdCursorForPlan = 0;
    for (rs::i32 bucket = 0; bucket < RS_DRAW_BUCKET_COUNT; bucket++) {
        const rs::i32 cmdCount = bucketCmdCounts[static_cast<std::size_t>(bucket)];
        rs::i32 bucketInstanceCount = 0;
        for (rs::i32 i = 0; i < cmdCount; i++) {
            bucketInstanceCount += packedCmdInstanceCounts[static_cast<std::size_t>(cmdCursorForPlan + i)];
        }
        bucketModelInfoLengths[bucket] = modelInfoTextureLengthFromCounts(cmdCount, bucketInstanceCount);
        totalModelInfoLength += bucketModelInfoLengths[bucket];
        cmdCursorForPlan += cmdCount;
    }
    if (outModelInfoTextureConcatLength != totalModelInfoLength) {
        return -2;
    }

    rs::i32 cmdCursor = 0;
    rs::i32 instanceCursor = 0;
    rs::i32 modelInfoCursor = 0;
    for (rs::i32 bucket = 0; bucket < RS_DRAW_BUCKET_COUNT; bucket++) {
        const rs::i32 cmdCount = bucketCmdCounts[static_cast<std::size_t>(bucket)];
        const rs::i32 modelInfoLength = bucketModelInfoLengths[bucket];

        for (rs::i32 i = 0; i < modelInfoLength; i++) {
            outModelInfoTextureConcat[static_cast<std::size_t>(modelInfoCursor + i)] = 0;
        }

        rs::i32 dataOffset = 0;
        rs::i32 bucketInstanceCount = 0;
        for (rs::i32 i = 0; i < cmdCount; i++) {
            const rs::i32 cmdIndex = cmdCursor + i;
            const rs::i32 instanceCount =
                packedCmdInstanceCounts[static_cast<std::size_t>(cmdIndex)];
            if (outDrawRanges) {
                const rs::i32 drawRangeOffset = cmdIndex * 3;
                outDrawRanges[static_cast<std::size_t>(drawRangeOffset + 0)] =
                    packedCmdOffsets[static_cast<std::size_t>(cmdIndex)];
                outDrawRanges[static_cast<std::size_t>(drawRangeOffset + 1)] =
                    packedCmdElements[static_cast<std::size_t>(cmdIndex)];
                outDrawRanges[static_cast<std::size_t>(drawRangeOffset + 2)] = instanceCount;
            }
            outModelInfoTextureConcat[static_cast<std::size_t>(modelInfoCursor + i * 4)] =
                static_cast<rs::u16>(cmdCount + dataOffset);
            dataOffset += instanceCount;
            bucketInstanceCount += instanceCount;
        }

        for (rs::i32 i = 0; i < bucketInstanceCount; i++) {
            const rs::i32 inOff = (instanceCursor + i) * rs::kSceneCommandInstanceStrideInts;
            const rs::i32 sceneX = packedInstances[static_cast<std::size_t>(inOff + 0)];
            const rs::i32 sceneZ = packedInstances[static_cast<std::size_t>(inOff + 1)];
            const rs::i32 heightOffset = packedInstances[static_cast<std::size_t>(inOff + 2)];
            const rs::i32 level = packedInstances[static_cast<std::size_t>(inOff + 3)];
            const rs::i32 contourGround = packedInstances[static_cast<std::size_t>(inOff + 4)];
            const rs::i32 priority = packedInstances[static_cast<std::size_t>(inOff + 5)];
            const rs::i32 interactType = packedInstances[static_cast<std::size_t>(inOff + 6)];
            const rs::i32 interactId = packedInstances[static_cast<std::size_t>(inOff + 7)];

            const rs::i32 outOff = modelInfoCursor + cmdCount * 4 + i * 4;
            outModelInfoTextureConcat[static_cast<std::size_t>(outOff + 0)] =
                static_cast<rs::u16>(sceneX | (level << 14));
            outModelInfoTextureConcat[static_cast<std::size_t>(outOff + 1)] =
                static_cast<rs::u16>(sceneZ | (contourGround << 14));
            const rs::i32 packed3 =
                (priority & 0x7) |
                ((interactId >> 16) << 3) |
                (interactType << 4) |
                (roundHeightOffsetDiv8Js(heightOffset) << 6);
            outModelInfoTextureConcat[static_cast<std::size_t>(outOff + 2)] =
                static_cast<rs::u16>(packed3);
            outModelInfoTextureConcat[static_cast<std::size_t>(outOff + 3)] =
                static_cast<rs::u16>(interactId);
        }

        cmdCursor += cmdCount;
        instanceCursor += bucketInstanceCount;
        modelInfoCursor += modelInfoLength;
    }
    if (cmdCursor != totalCmdCount ||
        instanceCursor * rs::kSceneCommandInstanceStrideInts != cmdPackedInstancesLength ||
        modelInfoCursor != totalModelInfoLength) {
        return -2;
    }

    return 1;
}

static rs::i32 rs_build_map_payload_from_map_squares_and_command_stream_internal(
    rs::i32 baseX,
    rs::i32 baseY,
    rs::i32 sizeX,
    rs::i32 sizeY,
    rs::i32 locLoadType,
    rs::i32 cacheGame,
    rs::i32 cacheRevision,
    rs::i32 mapCount,
    const rs::i32* mapSquareIds,
    const rs::i32* terrainOffsets,
    const rs::i32* terrainLengths,
    const rs::u8* terrainBytes,
    rs::i32 terrainBytesLength,
    const rs::i32* locOffsets,
    const rs::i32* locLengths,
    const rs::u8* locBytes,
    rs::i32 locBytesLength,
    rs::i32 unitsTileHeightBasis,
    const rs::i32* cmdBucketIndices,
    const rs::i32* cmdOffsets,
    const rs::i32* cmdElements,
    const rs::i32* cmdInstanceCounts,
    rs::i32 totalCmdCount,
    const rs::i32* cmdPackedInstances,
    rs::i32 cmdPackedInstancesLength,
    rs::i32* outBucketCmdCounts,
    rs::i32 outBucketCmdCountsLength,
    rs::i32* outBucketModelInfoLengths,
    rs::i32 outBucketModelInfoLengthsLength,
    rs::i32* outTotalModelInfoLength,
    rs::i32* outDrawRanges,
    rs::i32 outDrawRangesLength,
    rs::u16* outModelInfoTextureConcat,
    rs::i32 outModelInfoTextureConcatLength,
    rs::i16* outHeightMap,
    rs::i32 outHeightMapLength) {
    if (sizeX <= 0 || sizeY <= 0 || unitsTileHeightBasis <= 0) {
        return -1;
    }
    if (mapCount < 0 || terrainBytesLength < 0 || locBytesLength < 0) {
        return -1;
    }
    if (totalCmdCount < 0 || cmdPackedInstancesLength < 0) {
        return -1;
    }
    if ((mapCount > 0) &&
        (!mapSquareIds || !terrainOffsets || !terrainLengths || !locOffsets || !locLengths)) {
        return -1;
    }
    if ((terrainBytesLength > 0 && !terrainBytes) || (locBytesLength > 0 && !locBytes)) {
        return -1;
    }
    if (totalCmdCount > 0 && (!cmdBucketIndices || !cmdOffsets || !cmdElements || !cmdInstanceCounts)) {
        return -1;
    }
    if (cmdPackedInstancesLength > 0 && !cmdPackedInstances) {
        return -1;
    }

    const rs::i32 tileHeightsLength = RS_SCENE_LEVELS * (sizeX + 1) * (sizeY + 1);
    if (tileHeightsLength <= 0) {
        return -1;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::Vec<rs::i32> tileHeights(alloc);
    const rs::i32 tileHeightsStatus = buildTileHeightsFromMapSquaresCpp(
        baseX,
        baseY,
        sizeX,
        sizeY,
        cacheGame,
        cacheRevision,
        mapCount,
        mapSquareIds,
        terrainOffsets,
        terrainLengths,
        terrainBytes,
        terrainBytesLength,
        &tileHeights);
    if (tileHeightsStatus != RS_MAP_RENDER_STATUS_OK) {
        return tileHeightsStatus;
    }
    if (static_cast<rs::i32>(tileHeights.size()) != tileHeightsLength) {
        return RS_MAP_RENDER_STATUS_STATE;
    }

    if (!outBucketCmdCounts || !outBucketModelInfoLengths || !outTotalModelInfoLength) {
        return -1;
    }
    if (outBucketCmdCountsLength != RS_DRAW_BUCKET_COUNT ||
        outBucketModelInfoLengthsLength != RS_DRAW_BUCKET_COUNT) {
        return -1;
    }
    const rs::i32 planStatus = planCommandStreamBucketsAndModelInfo(
        cmdBucketIndices,
        cmdInstanceCounts,
        totalCmdCount,
        outBucketCmdCounts,
        outBucketCmdCountsLength,
        outBucketModelInfoLengths,
        outBucketModelInfoLengthsLength,
        outTotalModelInfoLength);
    if (planStatus != 1) {
        return planStatus;
    }
    const rs::i32 requiredModelInfoLength = *outTotalModelInfoLength;
    if (!outModelInfoTextureConcat || outModelInfoTextureConcatLength < requiredModelInfoLength) {
        return -2;
    }
    return rs_build_render_payload_from_command_stream_input(
        tileHeights.data(),
        RS_SCENE_LEVELS,
        sizeX,
        sizeY,
        unitsTileHeightBasis,
        cmdBucketIndices,
        cmdOffsets,
        cmdElements,
        cmdInstanceCounts,
        totalCmdCount,
        cmdPackedInstances,
        cmdPackedInstancesLength,
        outDrawRanges,
        outDrawRangesLength,
        outModelInfoTextureConcat,
        requiredModelInfoLength,
        outHeightMap,
        outHeightMapLength);
}

#include "MapRenderRuntimeNpcBuildHelpers.inl"

static rs::i32 runtimeBuildMapFromCacheInternal(
    const rs::i32 runtimeHandle,
    const rs::i32 mapX,
    const rs::i32 mapY,
    const rs::i32 borderSize,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 smoothTerrain,
    const rs::i32 locLoadType,
    const rs::i32 minimizeDrawCalls,
    const rs::i32 loadLocs,
    const rs::i32 loadObjs,
    const rs::i32 loadNpcs,
    const bool buildPayload) {
#include "MapRenderRuntimeBuildMapBody.inl"
}

#include "MapRenderRuntimePacketApi.inl"

#include "MapRenderRuntimeAnimationTickExports.inl"
#include "MapRenderRuntimeTickAdvance.inl"

} // extern "C"
