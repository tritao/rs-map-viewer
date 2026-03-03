import type { NpcSpawn } from "../data/npc/NpcSpawn";

export type MapRenderRuntimeHandle = number;

export type MapRenderRuntimePacket = Readonly<{
    packetVersion: number;
    bucketCmdCounts: Int32Array;
    bucketModelInfoLengths: Int32Array;
    drawRangesPacked: Int32Array;
    modelInfoTextureBuckets: ReadonlyArray<Uint16Array>;
    heightMapTextureData: Int16Array;
    vertices: Uint8Array;
    indices: Int32Array;
    usedTextureIds: Int32Array;
    npcDrawRangesBase?: Int32Array;
    npcDrawRangesAlpha?: Int32Array;
    npcVertices?: Uint8Array;
    npcIndices?: Int32Array;
    npcOrderKeys?: Int32Array;
    levels: number;
    sizeX: number;
    sizeY: number;
    unitsTileHeightBasis: number;
    totalModelInfoLength: number;
}>;

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

export type MapRenderRuntimeBuildStageTimings = Readonly<{
    totalUs: number;
    collectMapInputUs: number;
    seedHashUs: number;
    buildCommandStreamUs: number;
    registerTickStateUs: number;
    planPayloadUs: number;
    buildPayloadUs: number;
    storePayloadUs: number;
    buildNpcUs: number;
    deriveUsedTextureIdsUs: number;
    finalizePayloadUs: number;
    commandPrepareInputUs: number;
    commandCoreBuildUs: number;
    commandValidateUs: number;
    commandCopyBuffersUs: number;
    commandCopyDebugUs: number;
    commandSetupUs: number;
    commandSceneBuildUs: number;
    commandTerrainUs: number;
    commandLocUs: number;
    commandObjUs: number;
    commandFinalizeUs: number;
    commandLocPlanUs: number;
    commandLocPlanSortUs: number;
    commandLocPlanMergeNormalsUs: number;
    commandLocPlanPlacementLoopUs: number;
    commandLocPlanRenderPlanUs: number;
    commandLocPlanAnimatedOrderUs: number;
    commandLocExecuteUs: number;
    commandLocExecuteInstancedUs: number;
    commandLocExecuteMergedUs: number;
    commandFinalizeAnimatedLocUs: number;
}>;

export type MapRenderRuntimeBridgeV2 = Readonly<{
    initRuntime(): Promise<boolean>;
    createRuntimeWithConfig(
        config: MapRenderRuntimeCreateConfig,
    ): Promise<MapRenderRuntimeHandle | undefined>;
    destroyRuntime(runtimeHandle: MapRenderRuntimeHandle): void;
    resetRuntime(runtimeHandle: MapRenderRuntimeHandle): void;
    // Blob-store is the only cache surface. Clients should upload any resource bytes via (domain,group,file).
    cachePutBlobBatch(
        runtimeHandle: MapRenderRuntimeHandle,
        domain: number,
        groups: Int32Array,
        files: Int32Array,
        offsets: Int32Array,
        lengths: Int32Array,
        bytes: Uint8Array,
    ): Promise<number>;
    cacheClearBlobDomain(runtimeHandle: MapRenderRuntimeHandle, domain: number): Promise<number>;
    cacheClearAllBlobs(runtimeHandle: MapRenderRuntimeHandle): Promise<number>;
    debugGetLastBuildFailure?(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<
        Readonly<{ stage: number; status: number; detail0: number; detail1: number }> | undefined
    >;
    debugGetLastBuildStageTimings?(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<MapRenderRuntimeBuildStageTimings | undefined>;
    debugGetLastCollectMapInput?(runtimeHandle: MapRenderRuntimeHandle): Promise<
        | Readonly<{
              status: number;
              reason: number;
              mapStartX: number;
              mapStartY: number;
              mapEndX: number;
              mapEndY: number;
              expectedSquares: number;
              squaresWithAny: number;
              squaresWithTerrain: number;
              squaresWithLoc: number;
              firstPresentMapSquareId: number;
              firstMissingMapSquareId: number;
          }>
        | undefined
    >;
    debugGetLastCommandStreamStatus?(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<number | undefined>;
    debugGetLastLegacyModelLoad?(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<Readonly<{ modelId: number; status: number; missingFile: number }> | undefined>;
    debugGetLastMissingType?(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<Readonly<{ kind: number; id: number }> | undefined>;
    debugGetLastNpcBuildStats?(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<
        | Readonly<{
              status: number;
              spawnBytesLen: number;
              spawnsDecoded: number;
              spawnsInBounds: number;
              resolvedType: number;
              loginPropRenderable: number;
              modelDecodeOk: number;
              modelDecodeFailed: number;
              spawnsWithGeometry: number;
              drawRangeCount: number;
              vertexBytes: number;
              indexCount: number;
          }>
        | undefined
    >;
    cacheSetVarps(runtimeHandle: MapRenderRuntimeHandle, varps: Int32Array): Promise<number>;
    cacheSetBuildConfig(
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
    ): Promise<number>;
    getLastMissingBlobEntries(
        runtimeHandle: MapRenderRuntimeHandle,
    ): Promise<MapRenderRuntimeMissingBlobEntries | undefined>;
    debugBuildMapPlanFromCache?(
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
    ): Promise<boolean>;
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
    probeBuildMapPacketFromCacheStatus?(
        runtimeHandle: MapRenderRuntimeHandle,
        request: MapRenderRuntimeBuildRequest,
    ): Promise<number>;
    setTickState(runtimeHandle: MapRenderRuntimeHandle, stateKey: number, input: unknown): boolean;
    setTickStatePacked?(
        runtimeHandle: MapRenderRuntimeHandle,
        stateKey: number,
        packed: Int32Array,
    ): boolean;
    updateTickStateNpcPathPacked?(
        runtimeHandle: MapRenderRuntimeHandle,
        stateKey: number,
        packed: Int32Array,
    ): boolean;
    clearTickState(runtimeHandle: MapRenderRuntimeHandle, stateKey: number): void;
    hasTickState?(runtimeHandle: MapRenderRuntimeHandle, stateKey: number): boolean;
    tickMapsEmitPatchStreams?(
        runtimeHandle: MapRenderRuntimeHandle,
        stateKeys: Int32Array,
        cycleNowFixed: number,
        clientTickCount: number,
    ): Readonly<{ tickPatchCountsByMapId: Int32Array; tickPatchPacked: Int32Array }> | undefined;
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

export type MapRenderRuntimeMissingBlobEntries = Readonly<{
    domains: Int32Array;
    groups: Int32Array;
    files: Int32Array;
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
        debugSetWorldHeightProbe?(
            runtimeHandle: MapRenderRuntimeHandle,
            level: number,
            worldX: number,
            worldZ: number,
        ): Promise<boolean>;
        debugSetWorldHeightProbeLocFilter?(
            runtimeHandle: MapRenderRuntimeHandle,
            locId: number,
        ): Promise<boolean>;
        debugSetPackedVertexProbeIndex?(
            runtimeHandle: MapRenderRuntimeHandle,
            vertexIndex: number,
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
