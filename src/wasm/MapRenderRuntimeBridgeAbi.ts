import type { NpcSpawn } from "../data/npc/NpcSpawn";
import type { MapRenderRuntimePacket } from "../worker/MapRenderDataContract";

export type MapRenderRuntimeHandle = number;

export type MapRenderRuntimeCreateConfig = Readonly<{
    cacheGame: number;
    cacheRevision: number;
    sceneLevels: number;
    unitsTileHeightBasis: number;
}>;

export type MapRenderRuntimeBuildRequest = Readonly<{
    mapX: number;
    mapY: number;
    borderSize: number;
    sizeX: number;
    sizeY: number;
    cacheGame?: number;
    cacheRevision?: number;
    unitsTileHeightBasis?: number;
    smoothTerrain: boolean;
    locLoadType: number;
    minimizeDrawCalls?: boolean;
    loadLocs?: boolean;
    loadObjs?: boolean;
    loadNpcs?: boolean;
}>;

export type MapRenderRuntimeMapSquareEntry = Readonly<{
    mapX: number;
    mapY: number;
    terrainBytes?: Uint8Array;
    locBytes?: Uint8Array;
    npcBytes?: Uint8Array;
}>;

export type MapRenderNpcDecodeInput = Readonly<{
    tileRenderFlagsLevel1: Uint8Array[];
    borderSize: number;
    mapX: number;
    mapY: number;
    data: Uint8Array;
    npcLoginScreenPropsById?: Uint8Array;
    requiredLoginScreenPropsMask?: number;
}>;

export type MapRenderRuntimeLastBuildStats = Readonly<{
    terrainTilesConsidered: number;
    terrainTilesEmitted: number;
    terrainFacesEmitted: number;
    locPlacementsDecoded: number;
    locPlacementsInBounds: number;
    locPlacementsResolved: number;
    locResolveNotFound: number;
    locNoModelsForPlacement: number;
    locModelCandidates: number;
    locModelStatsDecodeFailed: number;
    locModelStatsNotFound: number;
    locModelStatsOtherError: number;
    locMissingModelSampleCount: number;
    locMissingModelSample0: number;
    locMissingModelSample1: number;
    locMissingModelSample2: number;
    locMissingModelSample3: number;
    locMissingModelLocTypeId: number;
    locMissingModelPlacementType: number;
    locMissingModelRotation: number;
    locModelStatsZeroFaces: number;
    locGroupStatsMismatch: number;
    locPlacementsQueuedAnyModel: number;
    locInstancesQueued: number;
    locAnimatedNoFaces: number;
    locAnimatedQueued: number;
    objSpawnsDecoded: number;
    objSpawnsInBounds: number;
    objModelCandidates: number;
    objInstancesQueued: number;
    locMergeByPlacementCount: number;
    locInstancedGroupCount: number;
    locVariantGroupsQueued: number;
    locVariantGroupsHash: number;
    locVariantType9Queued: number;
    locVariantType0Queued: number;
    locVariantId1651Type9Queued: number;
    locVariantId1651Type0Queued: number;
    locVariantCandidatesExpanded: number;
    locVariantDecodeFailed: number;
    objMergeByPlacementCount: number;
    objInstancedGroupCount: number;
    terrainFacesUnderlayLevel0: number;
    terrainFacesUnderlayLevel1: number;
    terrainFacesUnderlayLevel2: number;
    terrainFacesUnderlayLevel3: number;
    terrainFacesOverlayLevel0: number;
    terrainFacesOverlayLevel1: number;
    terrainFacesOverlayLevel2: number;
    terrainFacesOverlayLevel3: number;
    locMergedDummyCommandCount: number;
    locMergedDummyElementsTotal: number;
    locMergedDummyHash: number;
    locMergedDummyBaseCount: number;
    locMergedDummyAlphaCount: number;
    locMergedDummyLodCount: number;
    locMergedDummyLodAlphaCount: number;
    geometryElementMismatchCount: number;
    geometryElementMismatchTotalDelta: number;
    geometryElementMismatchMaxDelta: number;
    geometryElementMismatchSampleTypeId: number;
    geometryElementMismatchSamplePlacementType: number;
    geometryElementMismatchSampleRotation: number;
    locPreMergeGroupKeysQueued: number;
    locPreMergeGroupKeysHash: number;
}>;

export type MapRenderRuntimeBridgeV2 = Readonly<{
    initRuntime(): Promise<boolean>;
    createRuntimeWithConfig(
        config: MapRenderRuntimeCreateConfig,
    ): Promise<MapRenderRuntimeHandle | undefined>;
    destroyRuntime(runtimeHandle: MapRenderRuntimeHandle): void;
    resetRuntime(runtimeHandle: MapRenderRuntimeHandle): void;
    cachePutTextureArgb(
        runtimeHandle: MapRenderRuntimeHandle,
        textureId: number,
        argb: Int32Array,
    ): Promise<number>;
    cacheClearTextureArgb(runtimeHandle: MapRenderRuntimeHandle): Promise<number>;
    cachePutMaterialParams(
        runtimeHandle: MapRenderRuntimeHandle,
        materialId: number,
        params: Int32Array,
    ): Promise<number>;
    cacheClearMaterialParams(runtimeHandle: MapRenderRuntimeHandle): Promise<number>;
    cacheGetResourceCounts(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<Readonly<{ textureCount: number; materialCount: number }> | undefined>;
    cacheSetVarps(runtimeHandle: MapRenderRuntimeHandle, varps: Int32Array): Promise<number>;
    setGeometrySeed(
        runtimeHandle: MapRenderRuntimeHandle,
        vertices: Uint8Array,
        indices: Int32Array,
    ): Promise<number>;
    clearGeometrySeed(runtimeHandle: MapRenderRuntimeHandle): Promise<number>;
    cacheSetBuildConfig(
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
    ): Promise<number>;
    cacheClearMapSquares(runtimeHandle: MapRenderRuntimeHandle): Promise<number>;
    cachePutMapSquaresPacked(
        runtimeHandle: MapRenderRuntimeHandle,
        entries: ReadonlyArray<MapRenderRuntimeMapSquareEntry>,
    ): Promise<number>;
    cacheClearTypeKind(
        runtimeHandle: MapRenderRuntimeHandle,
        kind: number,
    ): Promise<number>;
    cachePutTypeEntry(
        runtimeHandle: MapRenderRuntimeHandle,
        kind: number,
        id: number,
        bytes: Uint8Array,
    ): Promise<number>;
    collectRequiredPrimaryTypeIds(
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
    ): Promise<MapRenderRuntimeRequiredTypeIds | undefined>;
    collectRequiredExpandedTypeIds(
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
    ): Promise<MapRenderRuntimeRequiredTypeIds | undefined>;
    getRuntimeCachedCommandStreamDigest?(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<MapRenderRuntimeCachedCommandStreamDigest | undefined>;
    getRuntimeCachedCommandStreamArrays?(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<MapRenderRuntimeCachedCommandStreamArrays | undefined>;
    debugGetRuntimeLastBuildStats?(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<MapRenderRuntimeLastBuildStats | undefined>;
    buildMapPacketFromCache(
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
    ): Promise<MapRenderRuntimePacket | undefined>;
    buildNpcPacketFromCache?(
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
    ): Promise<MapRenderRuntimePacket | undefined>;
    releasePacket?(packet: MapRenderRuntimePacket | undefined): boolean;
    setTickState(runtimeHandle: MapRenderRuntimeHandle, stateKey: number, input: unknown): boolean;
    clearTickState(runtimeHandle: MapRenderRuntimeHandle, stateKey: number): void;
    tickAdvanceAndEmitBasePatchesForState(
        runtimeHandle: MapRenderRuntimeHandle,
        stateKey: number,
        cycleNowFixed: number,
        clientTickCount: number,
    ): unknown;
    decodeNpcSpawnsFromBytes(
        tileRenderFlagsLevel1: Uint8Array[],
        borderSize: number,
        mapX: number,
        mapY: number,
        data: Uint8Array,
        npcLoginScreenPropsById?: Uint8Array,
        requiredLoginScreenPropsMask?: number,
    ): Promise<NpcSpawn[] | undefined>;
    reset(): void;
}>;

export type MapRenderRuntimeDebugLocType = Readonly<{
    id: number;
    resolvedId: number;
    mergeNormals: boolean;
    resolvedMergeNormals: boolean;
    contourGroundType: number;
    resolvedContourGroundType: number;
    contouredGround: number;
    resolvedContouredGround: number;
    contourGroundParam: number;
    resolvedContourGroundParam: number;
    hasTypes: boolean;
    resolvedHasTypes: boolean;
    typeCount: number;
    resolvedTypeCount: number;
    modelGroupCount: number;
    resolvedModelGroupCount: number;
    modelIdCount: number;
    resolvedModelIdCount: number;
    firstType: number;
    resolvedFirstType: number;
    firstModelId: number;
    resolvedFirstModelId: number;
    transformsCount: number;
    transformVarbit: number;
    transformVarp: number;
    transformIndex: number;
    transformId: number;
    resolvedFromTransform: boolean;
}>;

export type MapRenderRuntimeTerrainDigest = Readonly<{
    levels: number;
    facesTotal: number;
    verticesTotal: number;
    levelFaces: ReadonlyArray<number>;
    levelVertices: ReadonlyArray<number>;
    hash: number;
}>;

export type MapRenderRuntimeWorldHeightProbe = Readonly<{
    rawHit: number;
    hit: boolean;
    level: number;
    worldX: number;
    worldZ: number;
    packed: Int32Array;
}>;

export type MapRenderRuntimeSceneCommandPlanDigest = Readonly<{
    opCount: number;
    mergedGroupOpCount: number;
    instancedOpCount: number;
    instancedFacesTotal: number;
    instancedInstancesTotal: number;
    instancedLodInstancesTotal: number;
    seqHash: number;
    multisetHashSum: number;
    multisetHashXor: number;
}>;

export type MapRenderRuntimeSceneBucketsDigest = Readonly<{
    cmdTotal: number;
    instanceTotal: number;
    hash: number;
    bucketCmdCounts: ReadonlyArray<number>;
}>;

export type MapRenderRuntimeModelFacesDigest = Readonly<{
    faceCount: number;
    opaqueCount: number;
    transparentCount: number;
    hash: number;
}>;

export type MapRenderRuntimeModelVerticesDigest = Readonly<{
    verticesCount: number;
    usedVertexCount: number;
    faceCount: number;
    hash: number;
}>;

export type MapRenderRuntimeModelVerticesSample = Readonly<{
    version: number;
    verticesCount: number;
    usedVertexCount: number;
    faceCount: number;
    written: number;
    xyz: Int32Array;
}>;

export type MapRenderRuntimeLocRenderPlacementDigest = Readonly<{
    count: number;
    hash: number;
}>;

export type MapRenderRuntimeRequiredTypeIds = Readonly<{
    locTypeIds: ReadonlyArray<number>;
    objTypeIds: ReadonlyArray<number>;
    npcTypeIds: ReadonlyArray<number>;
    varbitTypeIds: ReadonlyArray<number>;
    modelIds: ReadonlyArray<number>;
    seqTypeIds: ReadonlyArray<number>;
    basTypeIds: ReadonlyArray<number>;
    underlayTypeIds: ReadonlyArray<number>;
    overlayTypeIds: ReadonlyArray<number>;
    typeIdsByKind: ReadonlyMap<number, ReadonlyArray<number>>;
}>;

export type MapRenderRuntimeCachedCommandStreamDigest = Readonly<{
    totalCmdCount: number;
    cmdBucketIndicesHash: number;
    cmdOffsetsHash: number;
    cmdElementsHash: number;
    cmdInstanceCountsHash: number;
    cmdPackedInstancesHash: number;
    verticesHash: number;
    indicesHash: number;
    bucketCmdCounts: ReadonlyArray<number>;
}>;

export type MapRenderRuntimeCachedCommandStreamArrays = Readonly<{
    cmdBucketIndices: Int32Array;
    cmdOffsets: Int32Array;
    cmdElements: Int32Array;
    cmdInstanceCounts: Int32Array;
    cmdPackedInstances: Int32Array;
    vertices: Uint8Array;
    indices: Int32Array;
}>;

export type MapRenderRuntimeDebugBridgeV2 = MapRenderRuntimeBridgeV2 &
    Readonly<{
        debugCollectCachedMapInputDigest(
            runtimeHandle: MapRenderRuntimeHandle,
            sceneBuildInput: unknown,
        ): Promise<unknown>;
        debugGetRuntimeCacheConfig(runtimeHandle: MapRenderRuntimeHandle): Promise<unknown>;
        debugGetRuntimeLoadedHeightHash(runtimeHandle: MapRenderRuntimeHandle): Promise<unknown>;
        debugDecodeCachedTerrainCell?(
            runtimeHandle: MapRenderRuntimeHandle,
            mapX: number,
            mapY: number,
            level: number,
            localX: number,
            localY: number,
        ): Promise<unknown>;
        debugGetRuntimeMapInputHashes(runtimeHandle: MapRenderRuntimeHandle): Promise<unknown>;
        debugCollectRequiredPrimaryTypeIds?(
            runtimeHandle: MapRenderRuntimeHandle,
            sceneBuildInput: unknown,
        ): Promise<MapRenderRuntimeRequiredTypeIds | undefined>;
        debugCollectRequiredExpandedTypeIds?(
            runtimeHandle: MapRenderRuntimeHandle,
            sceneBuildInput: unknown,
        ): Promise<MapRenderRuntimeRequiredTypeIds | undefined>;
        debugGetRuntimeCachedCommandStreamDigest(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<MapRenderRuntimeCachedCommandStreamDigest | undefined>;
        debugGetRuntimeCachedCommandStreamArrays?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<MapRenderRuntimeCachedCommandStreamArrays | undefined>;
        debugGetRuntimeLastBuildStats(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<MapRenderRuntimeLastBuildStats | undefined>;
        debugGetRuntimeLastLocPreMergeGroupKeySignatures?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<Int32Array | undefined>;
        debugGetRuntimeLastLocPreMergeGroupKeyEntriesPacked?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<Int32Array | undefined>;
        debugGetRuntimeLastLocMergeDecisionEntriesPacked?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<Int32Array | undefined>;
        debugGetRuntimeLastLocMergeEmitEntriesPacked?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<Int32Array | undefined>;
        debugGetRuntimeLastLocMergeNormalsTraceEntriesPacked?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<Int32Array | undefined>;
        debugGetRuntimeLastCommandProvenancePacked?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<Int32Array | undefined>;
        debugBuildMapPlanFromCache?(
            runtimeHandle: MapRenderRuntimeHandle,
            request: MapRenderRuntimeBuildRequest,
        ): Promise<boolean>;
        debugGetRuntimeLastTerrainDigest?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<MapRenderRuntimeTerrainDigest | undefined>;
        debugGetRuntimeLastCollisionFlags?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<
            | Readonly<{
                  levels: number;
                  sizeX: number;
                  sizeY: number;
                  flags: Int32Array;
              }>
            | undefined
        >;
        debugSetWorldHeightProbe?(
            runtimeHandle: MapRenderRuntimeHandle,
            level: number,
            worldX: number,
            worldZ: number,
        ): Promise<boolean>;
        debugGetRuntimeLastWorldHeightProbe?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<MapRenderRuntimeWorldHeightProbe | undefined>;
        debugGetRuntimeLastSceneCommandPlanDigest?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<MapRenderRuntimeSceneCommandPlanDigest | undefined>;
        debugGetRuntimeLastSceneCommandPlanOpsPacked?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<Int32Array | undefined>;
        debugGetRuntimeLastSceneCommandPlanOpProvenancePacked?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<Int32Array | undefined>;
        debugGetRuntimeLastSceneBucketsDigest?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<MapRenderRuntimeSceneBucketsDigest | undefined>;
        debugGetRuntimeLastLocRenderPlacementDigest?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<MapRenderRuntimeLocRenderPlacementDigest | undefined>;
        debugGetRuntimeLastLocRenderPlacementEntriesPacked?(
            runtimeHandle: MapRenderRuntimeHandle,
        ): Promise<Int32Array | undefined>;
        debugGetRuntimeModelFacesDigest?(
            runtimeHandle: MapRenderRuntimeHandle,
            modelId: number,
        ): Promise<MapRenderRuntimeModelFacesDigest | undefined>;
        debugGetRuntimeModelVerticesDigest?(
            runtimeHandle: MapRenderRuntimeHandle,
            modelId: number,
        ): Promise<MapRenderRuntimeModelVerticesDigest | undefined>;
        debugGetRuntimeModelVerticesSample?(
            runtimeHandle: MapRenderRuntimeHandle,
            modelId: number,
        ): Promise<MapRenderRuntimeModelVerticesSample | undefined>;
        debugGetRuntimeModelVerticesSampleRange?(
            runtimeHandle: MapRenderRuntimeHandle,
            modelId: number,
            startVertex: number,
        ): Promise<MapRenderRuntimeModelVerticesSample | undefined>;
        debugGetRuntimeLocModelVerticesSample?(
            runtimeHandle: MapRenderRuntimeHandle,
            locTypeId: number,
            placementType: number,
            rotation: number,
            modelId: number,
        ): Promise<MapRenderRuntimeModelVerticesSample | undefined>;
        debugDecodeRuntimeLocType?(
            runtimeHandle: MapRenderRuntimeHandle,
            locTypeId: number,
        ): Promise<MapRenderRuntimeDebugLocType | undefined>;
    }>;
