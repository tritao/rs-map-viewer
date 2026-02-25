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
#include "../rs/render/MapRenderRuntimeApi.hpp"
#include "../rs/render/SceneCommandBuilder.hpp"
#include "../rs/render/SceneCommandPack.hpp"
#include "../rs/scene/SceneBuildStages.hpp"
#include "MapRenderRuntimeBackendApi.hpp"
#include "MapRenderPacketStore.hpp"
#include "MapRenderRuntimeStore.hpp"
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

extern "C" rs::i32 rs_build_scene_render_seed_from_map_squares(
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
    rs::i32* outTileHeights,
    rs::i32 outTileHeightsLength,
    rs::u8* outTileRenderFlags,
    rs::i32 outTileRenderFlagsLength,
    rs::u16* outTileUnderlays,
    rs::i32 outTileUnderlaysLength,
    rs::i16* outTileOverlays,
    rs::i32 outTileOverlaysLength,
    rs::u8* outTileShapes,
    rs::i32 outTileShapesLength,
    rs::u8* outTileRotations,
    rs::i32 outTileRotationsLength,
    rs::u8* outBlockedByFloor,
    rs::i32 outBlockedByFloorLength,
    rs::u8* outTileMinLevels,
    rs::i32 outTileMinLevelsLength,
    rs::i32* outLocPlacements,
    rs::i32 outLocPlacementIntsCapacity);

extern "C" rs::i32 rs_resolve_loc_placements_and_collision_from_initialized_types(
    rs::i32 levels,
    rs::i32 sizeX,
    rs::i32 sizeY,
    const rs::u8* tileRenderFlags,
    rs::i32 tileRenderFlagsLength,
    const rs::u8* blockedByFloor,
    rs::i32 blockedByFloorLength,
    rs::i32* locPlacements,
    rs::i32 locPlacementIntsLength,
    const rs::i32* varpValues,
    rs::i32 varpValuesLength,
    rs::i32* outCollisionFlags,
    rs::i32 outCollisionFlagsLength);

namespace {

static constexpr rs::i32 RS_TICK_STATE_PACKED_VERSION = 1;
static constexpr rs::i32 RS_TICK_STATE_PACKED_VERSION_V2_COMPACT = 2;
static constexpr rs::i32 RS_TICK_STATE_OUTPUT_PACKED_VERSION = 1;

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

struct MapRenderCachedMapSquare final {
    std::vector<rs::u8> terrainBytes;
    std::vector<rs::u8> locBytes;
    std::vector<rs::u8> npcBytes;
    bool hasTerrain = false;
    bool hasLoc = false;
    bool hasNpc = false;
};

struct MapRenderCachedTypeBlob final {
    std::vector<rs::i32> ids;
    std::vector<rs::i32> offsets;
    std::vector<rs::i32> lengths;
    std::vector<rs::u8> bytes;
    bool loaded = false;

    void clear() {
        ids.clear();
        offsets.clear();
        lengths.clear();
        bytes.clear();
        loaded = false;
    }
};

struct MapRenderCachedTypeEntryStore final {
    std::unordered_map<rs::i32, std::vector<rs::u8>> entriesById;
    bool loaded = false;

    void clear() {
        entriesById.clear();
        loaded = false;
    }
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
    rs::i32 debugWorldHeightProbePacked[16]{};

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
    std::unordered_map<rs::i32, MapRenderCachedMapSquare> mapSquares;
    MapRenderCachedTypeBlob locTypes;
    MapRenderCachedTypeBlob varbits;
    MapRenderCachedTypeBlob models;
    MapRenderCachedTypeBlob textureTransparentIds;
    MapRenderCachedTypeBlob textureIds;
    MapRenderCachedTypeBlob underlays;
    MapRenderCachedTypeBlob overlays;
    MapRenderCachedTypeBlob seqTypes;
    MapRenderCachedTypeBlob seqFrames;
    MapRenderCachedTypeBlob seqAlphaHints;
    MapRenderCachedTypeBlob seqBases;
    MapRenderCachedTypeBlob skeletalSeqs;
    MapRenderCachedTypeBlob npcTypes;
    MapRenderCachedTypeBlob basTypes;
    MapRenderCachedTypeBlob objTypes;
    MapRenderCachedTypeBlob objSpawns;
    std::unordered_map<rs::i32, MapRenderCachedTypeEntryStore> typeEntriesByKind;
    bool typeEntriesDirty = false;
    std::unordered_map<rs::i32, std::vector<rs::i32>> textureArgbById;
    std::unordered_map<rs::i32, std::vector<rs::i32>> materialParamsById;
    std::vector<rs::i32> varps;
    rs::i32 cacheGame = 0;
    rs::i32 cacheRevision = 0;
    rs::i32 sceneLevels = 4;
    rs::i32 unitsTileHeightBasis = 128;
    rs::i32 typeGeneration = 0;
    rs::i32 appliedTypeGeneration = -1;

    void clear() {
        mapSquares.clear();
        locTypes.clear();
        varbits.clear();
        models.clear();
        textureTransparentIds.clear();
        textureIds.clear();
        underlays.clear();
        overlays.clear();
        seqTypes.clear();
        seqFrames.clear();
        seqAlphaHints.clear();
        seqBases.clear();
        skeletalSeqs.clear();
        npcTypes.clear();
        basTypes.clear();
        objTypes.clear();
        objSpawns.clear();
        typeEntriesByKind.clear();
        typeEntriesDirty = false;
        textureArgbById.clear();
        materialParamsById.clear();
        varps.clear();
        typeGeneration = 0;
        appliedTypeGeneration = -1;
    }
};

struct MapRenderRuntimeState {
    std::unordered_map<rs::i32, MapRenderTickState> tickStates;
    rs::tooling::MapRenderLoadedPayloadState mapPayload;
    MapRenderRuntimeCacheState cache;
    MapRenderCachedCommandStream lastBuiltCommandStream;
    std::vector<rs::i32> debugLastCollisionFlags;
    rs::i32 debugLastCollisionLevels = 0;
    rs::i32 debugLastCollisionSizeX = 0;
    rs::i32 debugLastCollisionSizeY = 0;
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
};

struct MapRenderPacketHandleState final {
    rs::i32 runtimeHandle = 0;
    rs::i32 payloadGeneration = -1;
};

static rs::tooling::RuntimeStore<MapRenderRuntimeState> gMapRenderRuntimes;
static rs::tooling::HandleStore<MapRenderPacketHandleState> gMapRenderPacketHandles;

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
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_WORLD_HEIGHT_PROBE_PACKED_LENGTH = 16;
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
static constexpr rs::i32 RS_MAP_RENDER_RUNTIME_COLLISION_FLAGS_META_LENGTH = 4;

enum MapRenderTypeBlobKind : rs::i32 {
    RS_MAP_RENDER_TYPE_BLOB_LOC = 1,
    RS_MAP_RENDER_TYPE_BLOB_VARBIT = 2,
    RS_MAP_RENDER_TYPE_BLOB_MODEL = 3,
    RS_MAP_RENDER_TYPE_BLOB_TEXTURE_TRANSPARENT = 4,
    RS_MAP_RENDER_TYPE_BLOB_SEQ_TYPE = 5,
    RS_MAP_RENDER_TYPE_BLOB_SEQ_FRAME = 6,
    RS_MAP_RENDER_TYPE_BLOB_NPC = 7,
    RS_MAP_RENDER_TYPE_BLOB_BAS = 8,
    RS_MAP_RENDER_TYPE_BLOB_TEXTURE_IDS = 9,
    RS_MAP_RENDER_TYPE_BLOB_UNDERLAY = 10,
    RS_MAP_RENDER_TYPE_BLOB_OVERLAY = 11,
    RS_MAP_RENDER_TYPE_BLOB_OBJ = 12,
    RS_MAP_RENDER_TYPE_BLOB_OBJ_SPAWNS = 13,
    RS_MAP_RENDER_TYPE_BLOB_SEQ_ALPHA_HINT = 14,
    RS_MAP_RENDER_TYPE_BLOB_SEQ_BASE = 15,
    RS_MAP_RENDER_TYPE_BLOB_SKELETAL_SEQ = 16,
};

static MapRenderCachedTypeBlob* resolveRuntimeTypeBlob(
    MapRenderRuntimeState* runtime,
    const rs::i32 blobKind) {
    if (!runtime) {
        return nullptr;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_LOC) {
        return &runtime->cache.locTypes;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_VARBIT) {
        return &runtime->cache.varbits;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_MODEL) {
        return &runtime->cache.models;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_TEXTURE_TRANSPARENT) {
        return &runtime->cache.textureTransparentIds;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_SEQ_TYPE) {
        return &runtime->cache.seqTypes;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_SEQ_FRAME) {
        return &runtime->cache.seqFrames;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_SEQ_ALPHA_HINT) {
        return &runtime->cache.seqAlphaHints;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_SEQ_BASE) {
        return &runtime->cache.seqBases;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_SKELETAL_SEQ) {
        return &runtime->cache.skeletalSeqs;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_NPC) {
        return &runtime->cache.npcTypes;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_BAS) {
        return &runtime->cache.basTypes;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_TEXTURE_IDS) {
        return &runtime->cache.textureIds;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_UNDERLAY) {
        return &runtime->cache.underlays;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_OVERLAY) {
        return &runtime->cache.overlays;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_OBJ) {
        return &runtime->cache.objTypes;
    }
    if (blobKind == RS_MAP_RENDER_TYPE_BLOB_OBJ_SPAWNS) {
        return &runtime->cache.objSpawns;
    }
    return nullptr;
}

static rs::i32 materializeRuntimeTypeEntryStoreIntoBlob(
    const MapRenderCachedTypeEntryStore& entries,
    MapRenderCachedTypeBlob* outBlob) {
    if (!outBlob) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outBlob->clear();
    outBlob->loaded = entries.loaded;
    if (!entries.loaded) {
        return RS_MAP_RENDER_STATUS_OK;
    }
    if (entries.entriesById.empty()) {
        return RS_MAP_RENDER_STATUS_OK;
    }

    std::vector<rs::i32> ids;
    ids.reserve(entries.entriesById.size());
    for (const auto& it : entries.entriesById) {
        ids.push_back(it.first);
    }
    std::sort(ids.begin(), ids.end());

    outBlob->ids.reserve(ids.size());
    outBlob->offsets.reserve(ids.size());
    outBlob->lengths.reserve(ids.size());

    rs::i32 cursor = 0;
    for (std::size_t i = 0; i < ids.size(); i++) {
        const rs::i32 id = ids[i];
        const auto it = entries.entriesById.find(id);
        if (it == entries.entriesById.end()) {
            continue;
        }
        const std::vector<rs::u8>& bytes = it->second;
        if (cursor > static_cast<rs::i32>(2147483647 - static_cast<rs::i32>(bytes.size()))) {
            return RS_MAP_RENDER_STATUS_CAPACITY;
        }
        outBlob->ids.push_back(id);
        outBlob->offsets.push_back(cursor);
        outBlob->lengths.push_back(static_cast<rs::i32>(bytes.size()));
        if (!bytes.empty()) {
            outBlob->bytes.insert(outBlob->bytes.end(), bytes.begin(), bytes.end());
            cursor += static_cast<rs::i32>(bytes.size());
        }
    }
    return RS_MAP_RENDER_STATUS_OK;
}

static rs::i32 materializeRuntimeTypeEntriesIfDirty(MapRenderRuntimeState* runtime) {
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    if (!runtime->cache.typeEntriesDirty) {
        return RS_MAP_RENDER_STATUS_OK;
    }
    for (auto& byKind : runtime->cache.typeEntriesByKind) {
        MapRenderCachedTypeBlob* blob = resolveRuntimeTypeBlob(runtime, byKind.first);
        if (!blob) {
            return RS_MAP_RENDER_STATUS_INVALID_ARG;
        }
        const rs::i32 status = materializeRuntimeTypeEntryStoreIntoBlob(byKind.second, blob);
        if (status != RS_MAP_RENDER_STATUS_OK) {
            return status;
        }
    }
    runtime->cache.typeEntriesDirty = false;
    return RS_MAP_RENDER_STATUS_OK;
}

static rs::i32 mapSquareId(const rs::i32 mapX, const rs::i32 mapY) noexcept {
    return (mapX << 8) + mapY;
}

static MapRenderRuntimeState* getMapRenderRuntime(const rs::i32 handle) {
    return gMapRenderRuntimes.get(handle);
}

static const MapRenderRuntimeState* getMapRenderRuntimeConst(const rs::i32 handle) {
    return gMapRenderRuntimes.get(handle);
}

#include "MapRenderRuntimeCollision.inl"

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

static rs::i32 findTypeBlobIndex(const std::vector<rs::i32>& ids, const rs::i32 id) {
    for (std::size_t i = 0; i < ids.size(); i++) {
        if (ids[i] == id) {
            return static_cast<rs::i32>(i);
        }
    }
    return -1;
}

static rs::i32 mapTextureIdToPackedIndex(
    const std::vector<rs::i32>& textureIds,
    const rs::i32 textureId) {
    if (textureId < 0) {
        return -1;
    }
    const rs::i32 packed = findTypeBlobIndex(textureIds, textureId);
    if (packed < 0) {
        return -1;
    }
    // Packed texture index 0 is reserved as untextured in the renderer.
    return packed + 1;
}

static rs::Status tryDecodeSeqTypeFromBlob(
    const MapRenderCachedTypeBlob& blob,
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
    if (!blob.loaded) {
        return rs::Status::NotFound;
    }
    const rs::i32 blobIdx = findTypeBlobIndex(blob.ids, seqId);
    if (blobIdx < 0) {
        return rs::Status::NotFound;
    }
    if (blobIdx >= static_cast<rs::i32>(blob.offsets.size()) ||
        blobIdx >= static_cast<rs::i32>(blob.lengths.size())) {
        return rs::Status::SizeMismatch;
    }
    const rs::i32 off = blob.offsets[static_cast<std::size_t>(blobIdx)];
    const rs::i32 len = blob.lengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return rs::Status::NotFound;
    }
    if (off > static_cast<rs::i32>(blob.bytes.size()) ||
        len > static_cast<rs::i32>(blob.bytes.size()) - off) {
        return rs::Status::OutOfRange;
    }
    DecodedSeqTypeCacheEntry entry{};
    entry.id = seqId;
    entry.seq = rs::SeqType(seqId, cacheInfo);
    rs::Uint8ArrayReader reader(
        rs::Span<const rs::u8>(blob.bytes.data() + off, static_cast<std::size_t>(len)),
        0);
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
            runtime->cache.seqTypes,
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
    MapRenderCachedCommandStream* outStream) {
    if (!runtime || !outStream) {
        return RuntimeCommandStreamBuildResult::Failed;
    }

    const bool includeLocs = loadLocs != 0;
    const bool includeObjs = loadObjs != 0;

    rs::SceneCommandBuildInput input{};
    input.baseX = baseX;
    input.baseY = baseY;
    input.sizeX = sizeX;
    input.sizeY = sizeY;
    input.smoothTerrain = smoothTerrain != 0;
    input.locLoadType = locLoadType;
    input.minimizeDrawCalls = minimizeDrawCalls != 0;
    input.loadLocs = includeLocs;
    input.cacheGame = runtime->cache.cacheGame;
    input.cacheRevision = runtime->cache.cacheRevision;
    input.unitsTileHeightBasis = runtime->cache.unitsTileHeightBasis;
    input.debugTerrainDigestSampleStartVertex =
        runtime->debugTerrainDigestSampleStartVertex > 0 ? runtime->debugTerrainDigestSampleStartVertex : 0;
    input.debugTerrainProbeLevel = runtime->debugTerrainProbeLevel;
    input.debugTerrainProbeTileX = runtime->debugTerrainProbeTileX;
    input.debugTerrainProbeTileY = runtime->debugTerrainProbeTileY;
    input.debugWorldHeightProbeLevel = runtime->debugWorldHeightProbeLevel;
    input.debugWorldHeightProbeWorldX = runtime->debugWorldHeightProbeWorldX;
    input.debugWorldHeightProbeWorldZ = runtime->debugWorldHeightProbeWorldZ;
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
    input.locTypeIds = rs::Span<const rs::i32>(
        runtime->cache.locTypes.loaded && !runtime->cache.locTypes.ids.empty()
            ? runtime->cache.locTypes.ids.data()
            : nullptr,
        runtime->cache.locTypes.loaded ? runtime->cache.locTypes.ids.size() : 0);
    input.locTypeOffsets = rs::Span<const rs::i32>(
        runtime->cache.locTypes.loaded && !runtime->cache.locTypes.offsets.empty()
            ? runtime->cache.locTypes.offsets.data()
            : nullptr,
        runtime->cache.locTypes.loaded ? runtime->cache.locTypes.offsets.size() : 0);
    input.locTypeLengths = rs::Span<const rs::i32>(
        runtime->cache.locTypes.loaded && !runtime->cache.locTypes.lengths.empty()
            ? runtime->cache.locTypes.lengths.data()
            : nullptr,
        runtime->cache.locTypes.loaded ? runtime->cache.locTypes.lengths.size() : 0);
    input.locTypeBytes = rs::Span<const rs::u8>(
        runtime->cache.locTypes.loaded && !runtime->cache.locTypes.bytes.empty()
            ? runtime->cache.locTypes.bytes.data()
            : nullptr,
        runtime->cache.locTypes.loaded ? runtime->cache.locTypes.bytes.size() : 0);
    input.varbitIds = rs::Span<const rs::i32>(
        runtime->cache.varbits.loaded && !runtime->cache.varbits.ids.empty()
            ? runtime->cache.varbits.ids.data()
            : nullptr,
        runtime->cache.varbits.loaded ? runtime->cache.varbits.ids.size() : 0);
    input.varbitOffsets = rs::Span<const rs::i32>(
        runtime->cache.varbits.loaded && !runtime->cache.varbits.offsets.empty()
            ? runtime->cache.varbits.offsets.data()
            : nullptr,
        runtime->cache.varbits.loaded ? runtime->cache.varbits.offsets.size() : 0);
    input.varbitLengths = rs::Span<const rs::i32>(
        runtime->cache.varbits.loaded && !runtime->cache.varbits.lengths.empty()
            ? runtime->cache.varbits.lengths.data()
            : nullptr,
        runtime->cache.varbits.loaded ? runtime->cache.varbits.lengths.size() : 0);
    input.varbitBytes = rs::Span<const rs::u8>(
        runtime->cache.varbits.loaded && !runtime->cache.varbits.bytes.empty()
            ? runtime->cache.varbits.bytes.data()
            : nullptr,
        runtime->cache.varbits.loaded ? runtime->cache.varbits.bytes.size() : 0);
    input.varpValues = rs::Span<const rs::i32>(
        runtime->cache.varps.empty() ? nullptr : runtime->cache.varps.data(),
        runtime->cache.varps.size());
    input.modelIds = rs::Span<const rs::i32>(
        runtime->cache.models.loaded && !runtime->cache.models.ids.empty()
            ? runtime->cache.models.ids.data()
            : nullptr,
        runtime->cache.models.loaded ? runtime->cache.models.ids.size() : 0);
    input.modelOffsets = rs::Span<const rs::i32>(
        runtime->cache.models.loaded && !runtime->cache.models.offsets.empty()
            ? runtime->cache.models.offsets.data()
            : nullptr,
        runtime->cache.models.loaded ? runtime->cache.models.offsets.size() : 0);
    input.modelLengths = rs::Span<const rs::i32>(
        runtime->cache.models.loaded && !runtime->cache.models.lengths.empty()
            ? runtime->cache.models.lengths.data()
            : nullptr,
        runtime->cache.models.loaded ? runtime->cache.models.lengths.size() : 0);
    input.modelBytes = rs::Span<const rs::u8>(
        runtime->cache.models.loaded && !runtime->cache.models.bytes.empty()
            ? runtime->cache.models.bytes.data()
            : nullptr,
        runtime->cache.models.loaded ? runtime->cache.models.bytes.size() : 0);
    input.objTypeIds = rs::Span<const rs::i32>(
        includeObjs && runtime->cache.objTypes.loaded && !runtime->cache.objTypes.ids.empty()
            ? runtime->cache.objTypes.ids.data()
            : nullptr,
        includeObjs && runtime->cache.objTypes.loaded ? runtime->cache.objTypes.ids.size() : 0);
    input.objTypeOffsets = rs::Span<const rs::i32>(
        includeObjs && runtime->cache.objTypes.loaded && !runtime->cache.objTypes.offsets.empty()
            ? runtime->cache.objTypes.offsets.data()
            : nullptr,
        includeObjs && runtime->cache.objTypes.loaded ? runtime->cache.objTypes.offsets.size() : 0);
    input.objTypeLengths = rs::Span<const rs::i32>(
        includeObjs && runtime->cache.objTypes.loaded && !runtime->cache.objTypes.lengths.empty()
            ? runtime->cache.objTypes.lengths.data()
            : nullptr,
        includeObjs && runtime->cache.objTypes.loaded ? runtime->cache.objTypes.lengths.size() : 0);
    input.objTypeBytes = rs::Span<const rs::u8>(
        includeObjs && runtime->cache.objTypes.loaded && !runtime->cache.objTypes.bytes.empty()
            ? runtime->cache.objTypes.bytes.data()
            : nullptr,
        includeObjs && runtime->cache.objTypes.loaded ? runtime->cache.objTypes.bytes.size() : 0);
    input.objSpawnMapIds = rs::Span<const rs::i32>(
        includeObjs && runtime->cache.objSpawns.loaded && !runtime->cache.objSpawns.ids.empty()
            ? runtime->cache.objSpawns.ids.data()
            : nullptr,
        includeObjs && runtime->cache.objSpawns.loaded ? runtime->cache.objSpawns.ids.size() : 0);
    input.objSpawnOffsets = rs::Span<const rs::i32>(
        includeObjs && runtime->cache.objSpawns.loaded && !runtime->cache.objSpawns.offsets.empty()
            ? runtime->cache.objSpawns.offsets.data()
            : nullptr,
        includeObjs && runtime->cache.objSpawns.loaded ? runtime->cache.objSpawns.offsets.size() : 0);
    input.objSpawnLengths = rs::Span<const rs::i32>(
        includeObjs && runtime->cache.objSpawns.loaded && !runtime->cache.objSpawns.lengths.empty()
            ? runtime->cache.objSpawns.lengths.data()
            : nullptr,
        includeObjs && runtime->cache.objSpawns.loaded ? runtime->cache.objSpawns.lengths.size() : 0);
    input.objSpawnBytes = rs::Span<const rs::u8>(
        includeObjs && runtime->cache.objSpawns.loaded && !runtime->cache.objSpawns.bytes.empty()
            ? runtime->cache.objSpawns.bytes.data()
            : nullptr,
        includeObjs && runtime->cache.objSpawns.loaded ? runtime->cache.objSpawns.bytes.size() : 0);
    input.textureTransparentIds = rs::Span<const rs::i32>(
        runtime->cache.textureTransparentIds.loaded &&
                !runtime->cache.textureTransparentIds.ids.empty()
            ? runtime->cache.textureTransparentIds.ids.data()
            : nullptr,
        runtime->cache.textureTransparentIds.loaded
            ? runtime->cache.textureTransparentIds.ids.size()
            : 0);
    input.textureIds = rs::Span<const rs::i32>(
        runtime->cache.textureIds.loaded &&
                !runtime->cache.textureIds.ids.empty()
            ? runtime->cache.textureIds.ids.data()
            : nullptr,
        runtime->cache.textureIds.loaded
            ? runtime->cache.textureIds.ids.size()
            : 0);
    input.underlayTypeIds = rs::Span<const rs::i32>(
        runtime->cache.underlays.loaded && !runtime->cache.underlays.ids.empty()
            ? runtime->cache.underlays.ids.data()
            : nullptr,
        runtime->cache.underlays.loaded ? runtime->cache.underlays.ids.size() : 0);
    input.underlayTypeOffsets = rs::Span<const rs::i32>(
        runtime->cache.underlays.loaded && !runtime->cache.underlays.offsets.empty()
            ? runtime->cache.underlays.offsets.data()
            : nullptr,
        runtime->cache.underlays.loaded ? runtime->cache.underlays.offsets.size() : 0);
    input.underlayTypeLengths = rs::Span<const rs::i32>(
        runtime->cache.underlays.loaded && !runtime->cache.underlays.lengths.empty()
            ? runtime->cache.underlays.lengths.data()
            : nullptr,
        runtime->cache.underlays.loaded ? runtime->cache.underlays.lengths.size() : 0);
    input.underlayTypeBytes = rs::Span<const rs::u8>(
        runtime->cache.underlays.loaded && !runtime->cache.underlays.bytes.empty()
            ? runtime->cache.underlays.bytes.data()
            : nullptr,
        runtime->cache.underlays.loaded ? runtime->cache.underlays.bytes.size() : 0);
    input.overlayTypeIds = rs::Span<const rs::i32>(
        runtime->cache.overlays.loaded && !runtime->cache.overlays.ids.empty()
            ? runtime->cache.overlays.ids.data()
            : nullptr,
        runtime->cache.overlays.loaded ? runtime->cache.overlays.ids.size() : 0);
    input.overlayTypeOffsets = rs::Span<const rs::i32>(
        runtime->cache.overlays.loaded && !runtime->cache.overlays.offsets.empty()
            ? runtime->cache.overlays.offsets.data()
            : nullptr,
        runtime->cache.overlays.loaded ? runtime->cache.overlays.offsets.size() : 0);
    input.overlayTypeLengths = rs::Span<const rs::i32>(
        runtime->cache.overlays.loaded && !runtime->cache.overlays.lengths.empty()
            ? runtime->cache.overlays.lengths.data()
            : nullptr,
        runtime->cache.overlays.loaded ? runtime->cache.overlays.lengths.size() : 0);
    input.overlayTypeBytes = rs::Span<const rs::u8>(
        runtime->cache.overlays.loaded && !runtime->cache.overlays.bytes.empty()
            ? runtime->cache.overlays.bytes.data()
            : nullptr,
        runtime->cache.overlays.loaded ? runtime->cache.overlays.bytes.size() : 0);
    input.seqTypeIds = rs::Span<const rs::i32>(
        runtime->cache.seqTypes.loaded && !runtime->cache.seqTypes.ids.empty()
            ? runtime->cache.seqTypes.ids.data()
            : nullptr,
        runtime->cache.seqTypes.loaded ? runtime->cache.seqTypes.ids.size() : 0);
    input.seqTypeOffsets = rs::Span<const rs::i32>(
        runtime->cache.seqTypes.loaded && !runtime->cache.seqTypes.offsets.empty()
            ? runtime->cache.seqTypes.offsets.data()
            : nullptr,
        runtime->cache.seqTypes.loaded ? runtime->cache.seqTypes.offsets.size() : 0);
    input.seqTypeLengths = rs::Span<const rs::i32>(
        runtime->cache.seqTypes.loaded && !runtime->cache.seqTypes.lengths.empty()
            ? runtime->cache.seqTypes.lengths.data()
            : nullptr,
        runtime->cache.seqTypes.loaded ? runtime->cache.seqTypes.lengths.size() : 0);
    input.seqTypeBytes = rs::Span<const rs::u8>(
        runtime->cache.seqTypes.loaded && !runtime->cache.seqTypes.bytes.empty()
            ? runtime->cache.seqTypes.bytes.data()
            : nullptr,
        runtime->cache.seqTypes.loaded ? runtime->cache.seqTypes.bytes.size() : 0);
    input.seqFrameIds = rs::Span<const rs::i32>(
        runtime->cache.seqFrames.loaded && !runtime->cache.seqFrames.ids.empty()
            ? runtime->cache.seqFrames.ids.data()
            : nullptr,
        runtime->cache.seqFrames.loaded ? runtime->cache.seqFrames.ids.size() : 0);
    input.seqFrameOffsets = rs::Span<const rs::i32>(
        runtime->cache.seqFrames.loaded && !runtime->cache.seqFrames.offsets.empty()
            ? runtime->cache.seqFrames.offsets.data()
            : nullptr,
        runtime->cache.seqFrames.loaded ? runtime->cache.seqFrames.offsets.size() : 0);
    input.seqFrameLengths = rs::Span<const rs::i32>(
        runtime->cache.seqFrames.loaded && !runtime->cache.seqFrames.lengths.empty()
            ? runtime->cache.seqFrames.lengths.data()
            : nullptr,
        runtime->cache.seqFrames.loaded ? runtime->cache.seqFrames.lengths.size() : 0);
    input.seqFrameBytes = rs::Span<const rs::u8>(
        runtime->cache.seqFrames.loaded && !runtime->cache.seqFrames.bytes.empty()
            ? runtime->cache.seqFrames.bytes.data()
            : nullptr,
        runtime->cache.seqFrames.loaded ? runtime->cache.seqFrames.bytes.size() : 0);
    input.seqAlphaHintIds = rs::Span<const rs::i32>(
        runtime->cache.seqAlphaHints.loaded && !runtime->cache.seqAlphaHints.ids.empty()
            ? runtime->cache.seqAlphaHints.ids.data()
            : nullptr,
        runtime->cache.seqAlphaHints.loaded ? runtime->cache.seqAlphaHints.ids.size() : 0);
    input.seqAlphaHintOffsets = rs::Span<const rs::i32>(
        runtime->cache.seqAlphaHints.loaded && !runtime->cache.seqAlphaHints.offsets.empty()
            ? runtime->cache.seqAlphaHints.offsets.data()
            : nullptr,
        runtime->cache.seqAlphaHints.loaded ? runtime->cache.seqAlphaHints.offsets.size() : 0);
    input.seqAlphaHintLengths = rs::Span<const rs::i32>(
        runtime->cache.seqAlphaHints.loaded && !runtime->cache.seqAlphaHints.lengths.empty()
            ? runtime->cache.seqAlphaHints.lengths.data()
            : nullptr,
        runtime->cache.seqAlphaHints.loaded ? runtime->cache.seqAlphaHints.lengths.size() : 0);
    input.seqAlphaHintBytes = rs::Span<const rs::u8>(
        runtime->cache.seqAlphaHints.loaded && !runtime->cache.seqAlphaHints.bytes.empty()
            ? runtime->cache.seqAlphaHints.bytes.data()
            : nullptr,
        runtime->cache.seqAlphaHints.loaded ? runtime->cache.seqAlphaHints.bytes.size() : 0);
    input.seqBaseIds = rs::Span<const rs::i32>(
        runtime->cache.seqBases.loaded && !runtime->cache.seqBases.ids.empty()
            ? runtime->cache.seqBases.ids.data()
            : nullptr,
        runtime->cache.seqBases.loaded ? runtime->cache.seqBases.ids.size() : 0);
    input.seqBaseOffsets = rs::Span<const rs::i32>(
        runtime->cache.seqBases.loaded && !runtime->cache.seqBases.offsets.empty()
            ? runtime->cache.seqBases.offsets.data()
            : nullptr,
        runtime->cache.seqBases.loaded ? runtime->cache.seqBases.offsets.size() : 0);
    input.seqBaseLengths = rs::Span<const rs::i32>(
        runtime->cache.seqBases.loaded && !runtime->cache.seqBases.lengths.empty()
            ? runtime->cache.seqBases.lengths.data()
            : nullptr,
        runtime->cache.seqBases.loaded ? runtime->cache.seqBases.lengths.size() : 0);
    input.seqBaseBytes = rs::Span<const rs::u8>(
        runtime->cache.seqBases.loaded && !runtime->cache.seqBases.bytes.empty()
            ? runtime->cache.seqBases.bytes.data()
            : nullptr,
        runtime->cache.seqBases.loaded ? runtime->cache.seqBases.bytes.size() : 0);
    input.skeletalSeqIds = rs::Span<const rs::i32>(
        runtime->cache.skeletalSeqs.loaded && !runtime->cache.skeletalSeqs.ids.empty()
            ? runtime->cache.skeletalSeqs.ids.data()
            : nullptr,
        runtime->cache.skeletalSeqs.loaded ? runtime->cache.skeletalSeqs.ids.size() : 0);
    input.skeletalSeqOffsets = rs::Span<const rs::i32>(
        runtime->cache.skeletalSeqs.loaded && !runtime->cache.skeletalSeqs.offsets.empty()
            ? runtime->cache.skeletalSeqs.offsets.data()
            : nullptr,
        runtime->cache.skeletalSeqs.loaded ? runtime->cache.skeletalSeqs.offsets.size() : 0);
    input.skeletalSeqLengths = rs::Span<const rs::i32>(
        runtime->cache.skeletalSeqs.loaded && !runtime->cache.skeletalSeqs.lengths.empty()
            ? runtime->cache.skeletalSeqs.lengths.data()
            : nullptr,
        runtime->cache.skeletalSeqs.loaded ? runtime->cache.skeletalSeqs.lengths.size() : 0);
    input.skeletalSeqBytes = rs::Span<const rs::u8>(
        runtime->cache.skeletalSeqs.loaded && !runtime->cache.skeletalSeqs.bytes.empty()
            ? runtime->cache.skeletalSeqs.bytes.data()
            : nullptr,
        runtime->cache.skeletalSeqs.loaded ? runtime->cache.skeletalSeqs.bytes.size() : 0);
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::SceneCommandStream nativeStream{};
    const rs::Status buildStatus = planOnly
        ? rs::buildSceneCommandPlanOnly(input, &nativeStream, alloc)
        : rs::buildSceneCommandStream(input, &nativeStream, alloc);
    if (!rs::ok(buildStatus)) {
        return RuntimeCommandStreamBuildResult::Failed;
    }

    const rs::i32 totalCmdCount = static_cast<rs::i32>(nativeStream.cmdOffsets.size());
    if (nativeStream.cmdBucketIndices.size() != nativeStream.cmdOffsets.size() ||
        nativeStream.cmdElements.size() != nativeStream.cmdOffsets.size() ||
        nativeStream.cmdInstanceCounts.size() != nativeStream.cmdOffsets.size()) {
        return RuntimeCommandStreamBuildResult::Failed;
    }
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

static constexpr rs::i32 RS_MAP_RENDER_CAP_HEIGHTMAP = 1 << 0;
static constexpr rs::i32 RS_MAP_RENDER_CAP_NPC_DECODE = 1 << 1;
static constexpr rs::i32 RS_MAP_RENDER_CAP_DRAW_RANGE_PATCH = 1 << 4;
static constexpr rs::i32 RS_MAP_RENDER_CAP_ANIMATION_ADVANCE = 1 << 5;
static constexpr rs::i32 RS_MAP_RENDER_CAP_TICK_ADVANCE_AND_PATCH = 1 << 6;
static constexpr rs::i32 RS_MAP_RENDER_CAP_RUNTIME_STATE = 1 << 9;
static constexpr rs::i32 RS_MAP_RENDER_CAP_RUNTIME_CACHE_V2 = 1 << 10;
static constexpr rs::i32 RS_MAP_RENDER_CAP_RUNTIME_PACKET_V2_ONLY = 1 << 11;
static constexpr rs::i32 RS_DRAW_BUCKET_COUNT = 8;
static constexpr rs::i32 RS_SCENE_LEVELS = 4;
static constexpr rs::i32 RS_LOC_CYCLE_SCALE = 1024;
static constexpr rs::i32 RS_NPC_PATH_QUEUE_LEN = 10;
static constexpr rs::i32 RS_MOVEMENT_TYPE_CRAWL = 0;
static constexpr rs::i32 RS_MOVEMENT_TYPE_RUN = 2;

RS_WASM_KEEPALIVE void rs_scene_types_reset();
RS_WASM_KEEPALIVE rs::i32 rs_scene_types_init(
    rs::i32 cacheGame,
    rs::i32 cacheRevision,
    const rs::i32* locTypeIds,
    rs::i32 locTypeCount,
    const rs::i32* locTypeOffsets,
    const rs::i32* locTypeLengths,
    const rs::u8* locTypeBytes,
    rs::i32 locTypeBytesLength,
    const rs::i32* varbitIds,
    rs::i32 varbitCount,
    const rs::i32* varbitOffsets,
    const rs::i32* varbitLengths,
    const rs::u8* varbitBytes,
    rs::i32 varbitBytesLength);

RS_WASM_KEEPALIVE rs::i32 rs_map_render_bridge_abi_version() {
    return 2;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_bridge_capabilities() {
    return RS_MAP_RENDER_CAP_HEIGHTMAP |
           RS_MAP_RENDER_CAP_NPC_DECODE |
           RS_MAP_RENDER_CAP_DRAW_RANGE_PATCH |
           RS_MAP_RENDER_CAP_ANIMATION_ADVANCE |
           RS_MAP_RENDER_CAP_TICK_ADVANCE_AND_PATCH |
           RS_MAP_RENDER_CAP_RUNTIME_STATE |
           RS_MAP_RENDER_CAP_RUNTIME_CACHE_V2 |
           RS_MAP_RENDER_CAP_RUNTIME_PACKET_V2_ONLY;
}

#include "MapRenderRuntimeLifecycle.inl"

#include "MapRenderRuntimeCacheV2Api.inl"

#include "MapRenderRuntimeTypeDemandApi.inl"

#include "MapRenderRuntimeDebugExports.inl"

static rs::i32 ensureRuntimeSceneTypesInitialized(MapRenderRuntimeState* runtime) {
    if (!runtime) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    const rs::i32 materializeStatus = materializeRuntimeTypeEntriesIfDirty(runtime);
    if (materializeStatus != RS_MAP_RENDER_STATUS_OK) {
        return materializeStatus;
    }
    if (runtime->cache.appliedTypeGeneration == runtime->cache.typeGeneration) {
        return RS_MAP_RENDER_STATUS_OK;
    }

    const MapRenderCachedTypeBlob& locTypes = runtime->cache.locTypes;
    const MapRenderCachedTypeBlob& varbits = runtime->cache.varbits;
    rs_scene_types_reset();
    const rs::i32 initStatus = rs_scene_types_init(
        runtime->cache.cacheGame,
        runtime->cache.cacheRevision,
        locTypes.loaded ? locTypes.ids.data() : nullptr,
        locTypes.loaded ? static_cast<rs::i32>(locTypes.ids.size()) : 0,
        locTypes.loaded ? locTypes.offsets.data() : nullptr,
        locTypes.loaded ? locTypes.lengths.data() : nullptr,
        locTypes.loaded ? locTypes.bytes.data() : nullptr,
        locTypes.loaded ? static_cast<rs::i32>(locTypes.bytes.size()) : 0,
        varbits.loaded ? varbits.ids.data() : nullptr,
        varbits.loaded ? static_cast<rs::i32>(varbits.ids.size()) : 0,
        varbits.loaded ? varbits.offsets.data() : nullptr,
        varbits.loaded ? varbits.lengths.data() : nullptr,
        varbits.loaded ? varbits.bytes.data() : nullptr,
        varbits.loaded ? static_cast<rs::i32>(varbits.bytes.size()) : 0);
    if (initStatus != RS_MAP_RENDER_STATUS_OK) {
        runtime->cache.appliedTypeGeneration = -1;
        return RS_MAP_RENDER_STATUS_STATE;
    }

    runtime->cache.appliedTypeGeneration = runtime->cache.typeGeneration;
    return RS_MAP_RENDER_STATUS_OK;
}

#include "MapRenderRuntimeTickStateSet.inl"

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

    if (textureId >= 2048) {
        textureId = -1;
    }
    if (textureId1 >= 2048) {
        textureId1 = -1;
    }

    if (textureBlend < 0.0f) textureBlend = 0.0f;
    if (textureBlend > 1.0f) textureBlend = 1.0f;

    const bool isTextured = textureId != -1;
    if (isTextured) {
        hsl &= 127;
        hsl |= (textureId & 0x1ff) << 7;
    }

    const bool hasBlend =
        isTextured &&
        textureId1 != -1 &&
        textureId1 != textureId &&
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
    const rs::i32 tex1Lo = hasBlend ? clampI32(textureId1, 0, 0x3ff) : 0;
    const rs::i32 tex0Hi = (textureId >> 10) & 0x1;
    const rs::i32 tex1Hi = (textureId1 >> 10) & 0x1;

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
        (static_cast<rs::u32>(isTextured ? ((textureId >> 9) & 0x1) : 0) << 5) |
        static_cast<rs::u32>(uPacked >> 6);
    const rs::u32 v3 =
        static_cast<rs::u32>(tex1Lo) |
        (static_cast<rs::u32>(hasBlend ? 1 : 0) << 10) |
        (static_cast<rs::u32>(blend8) << 11) |
        (static_cast<rs::u32>(tex0Hi) << 19) |
        (static_cast<rs::u32>(tex1Hi) << 20);

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

static rs::i32 runtimeBuildNpcPacketFromCacheInternal(
    const rs::i32 runtimeHandle,
    const rs::i32 mapX,
    const rs::i32 mapY,
    const rs::i32 borderSize,
    const rs::i32 sizeX,
    const rs::i32 sizeY) {
#include "MapRenderRuntimeBuildNpcBody.inl"
}

#include "MapRenderRuntimePacketApi.inl"

#include "MapRenderRuntimeAnimationTickExports.inl"
#include "MapRenderRuntimeTickAdvance.inl"

} // extern "C"
