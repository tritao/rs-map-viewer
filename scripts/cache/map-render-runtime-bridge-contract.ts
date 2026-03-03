import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { tryCreateCacheSession } from "../../src/rs/loaders/CacheSession";
import {
    WasmCacheUploader,
    createByteDrivenSceneBuildInput,
    createSceneBuildCacheProvider,
    uploadRuntimeCacheForBuildRequest,
} from "../../src/maprender/wasm/WasmCacheUploader";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
} from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import type { MapRenderRuntimePacket } from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import { runtimePacketToPayloadOverlay } from "./runtimePacketOverlay";
import { loadCache, loadCacheInfos } from "./load-util";

type RuntimeBridge = MapRenderRuntimeBridgeV2;

function pickFirstRenderableSquare(mapFileIndex: {
    tryGetTerrainArchiveId(x: number, y: number): number | undefined;
    tryGetLocArchiveId(x: number, y: number): number | undefined;
}): Readonly<{ mapX: number; mapY: number }> {
    for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (mapFileIndex.tryGetTerrainArchiveId(mapX, mapY) === undefined) {
                continue;
            }
            if (mapFileIndex.tryGetLocArchiveId(mapX, mapY) === undefined) {
                continue;
            }
            return { mapX, mapY };
        }
    }
    throw new Error("no renderable map squares found");
}

function buildRuntimeRequest(sceneBuildInput: {
    baseX: number;
    baseY: number;
    sizeX: number;
    sizeY: number;
    cacheGame?: number;
    cacheRevision?: number;
    unitsTileHeightBasis?: number;
    smoothTerrain: boolean;
    locLoadType: number;
    loadLocs?: boolean;
    loadObjs?: boolean;
    loadNpcs?: boolean;
}): MapRenderRuntimeBuildRequest | undefined {
    const mapSquareSize = 64;
    const sizeX = sceneBuildInput.sizeX | 0;
    const sizeY = sceneBuildInput.sizeY | 0;
    if (sizeX <= 0 || sizeY <= 0) {
        return undefined;
    }
    const borderX = ((sizeX - mapSquareSize) / 2) | 0;
    const borderY = ((sizeY - mapSquareSize) / 2) | 0;
    if (
        borderX < 0 ||
        borderY < 0 ||
        borderX !== borderY ||
        sizeX !== mapSquareSize + borderX * 2 ||
        sizeY !== mapSquareSize + borderY * 2
    ) {
        return undefined;
    }
    const borderSize = borderX;
    return {
        mapX: Math.floor(((sceneBuildInput.baseX | 0) + borderSize) / mapSquareSize),
        mapY: Math.floor(((sceneBuildInput.baseY | 0) + borderSize) / mapSquareSize),
        borderSize,
        sizeX,
        sizeY,
        cacheGame: (sceneBuildInput.cacheGame ?? 0) | 0,
        cacheRevision: (sceneBuildInput.cacheRevision ?? 0) | 0,
        unitsTileHeightBasis: (sceneBuildInput.unitsTileHeightBasis ?? 0) | 0,
        smoothTerrain: !!sceneBuildInput.smoothTerrain,
        locLoadType: sceneBuildInput.locLoadType | 0,
        loadLocs: sceneBuildInput.loadLocs !== false,
        loadObjs: sceneBuildInput.loadObjs !== false,
        loadNpcs: sceneBuildInput.loadNpcs !== false,
    };
}

async function buildRuntimeLifecycleFixture(): Promise<
    Readonly<{
        request: Readonly<{
            mapX: number;
            mapY: number;
            borderSize: number;
            sizeX: number;
            sizeY: number;
            smoothTerrain: boolean;
            locLoadType: number;
        }>;
        sceneBuildInput: ReturnType<typeof createByteDrivenSceneBuildInput>;
    }>
> {
    const cacheInfos = loadCacheInfos();
    const cacheInfo = cacheInfos[0];
    if (!cacheInfo) {
        throw new Error("no caches available for lifecycle contract test");
    }
    const loadedCache = loadCache(cacheInfo);
    const sessionResult = tryCreateCacheSession(loadedCache as any, new JSCompressionHandler());
    if (!sessionResult.ok) {
        throw new Error(`failed to create cache session: ${cacheInfo.name}`);
    }
    const session = sessionResult.value;
    const square = pickFirstRenderableSquare(session.loaders.mapFileLoader.mapFileIndex as any);
    const mapBytesProvider = new MapFileBytesProvider(
        session.loaders.mapFileLoader,
        loadedCache.xteas as any,
    );
    const varProvider = new VarManagerProvider(session.varManager);
    const cacheProvider = createSceneBuildCacheProvider({
        mapBytesProvider,
        locTypeLoader: session.loaders.locTypeLoader,
        objTypeLoader: session.loaders.objTypeLoader,
        modelLoader: session.loaders.modelLoader,
        seqTypeLoader: session.loaders.seqTypeLoader,
        seqFrameLoader: session.loaders.seqFrameLoader,
        skeletalSeqLoader: session.loaders.skeletalSeqLoader,
        npcTypeLoader: session.loaders.npcTypeLoader,
        basTypeLoader: session.loaders.basTypeLoader,
        underlayTypeLoader: session.loaders.underlayTypeLoader,
        overlayTypeLoader: session.loaders.overlayTypeLoader,
        varbitLoader: session.varManager.varbitLoader,
    });
    const allTextureIds = session.loaders.textureLoader.getTextureIds();
    const textureIdLists = {
        sdTextureIds: allTextureIds.filter((id) => session.loaders.textureLoader.isSd(id | 0)),
        transparentTextureIds: allTextureIds.filter((id) =>
            session.loaders.textureLoader.isTransparent(id | 0),
        ),
    };
    const sceneBuildInput = createByteDrivenSceneBuildInput(
        {
            mapX: square.mapX,
            mapY: square.mapY,
            maxLevel: 0,
            loadObjs: true,
            loadNpcs: true,
            loadLocs: true,
            smoothTerrain: false,
            minimizeDrawCalls: false,
            loadedTextureIds: new Int32Array(0),
        },
        {
            cacheGame: loadedCache.info.game,
            cacheRevision: loadedCache.info.revision,
            cacheProvider,
            textureIdLists,
            varpValues: new Int32Array(varProvider.varManager.values),
        },
    );
    const request = buildRuntimeRequest(sceneBuildInput);
    if (!request) {
        throw new Error("failed to build runtime request from fixture input");
    }
    return { request, sceneBuildInput };
}

function assertFn(target: Record<string, unknown>, key: string): void {
    assert.equal(
        typeof target[key],
        "function",
        `expected function export "${key}" in runtime bridge`,
    );
}

function assertNpcSlotMetadataContract(
    packet: MapRenderRuntimePacket,
    label: string,
): void {
    const ranges = packet.npcDrawRangesBase;
    if (!(ranges instanceof Int32Array) || (ranges.length | 0) <= 0) {
        return;
    }
    assert.equal(
        (ranges.length % 3) | 0,
        0,
        `${label}: npcDrawRangesBase length must be a multiple of 3`,
    );
    const slotCount = (ranges.length / 3) | 0;
    assert.ok(packet.npcOrderKeys instanceof Int32Array, `${label}: missing npcOrderKeys`);
    assert.equal(
        (packet.npcOrderKeys as Int32Array).length | 0,
        slotCount,
        `${label}: npcOrderKeys length must match npc draw-range slot count`,
    );
}

async function buildMapPacketWithPreparedRuntime(
    bridge: RuntimeBridge,
    cacheUploader: WasmCacheUploader,
    runtimeHandle: number,
    request: MapRenderRuntimeBuildRequest,
    sceneBuildInput: ReturnType<typeof createByteDrivenSceneBuildInput>,
    label: string,
): Promise<MapRenderRuntimePacket | undefined> {
    const prepared = await cacheUploader.prepareAndBuildMapPacketFromCacheDetailed(
        bridge,
        runtimeHandle,
        request,
        sceneBuildInput,
    );
    assert.equal(prepared.ok, true, `${label}: expected runtime prepare to succeed`);
    return prepared.packet;
}

async function main(): Promise<void> {
    const runtimeBridgeModuleUrl = pathToFileURL(
        path.resolve(process.cwd(), "src/wasm/rs_map_runtime_bridge.mjs"),
    ).href;
    const runtimeMod = (await import(runtimeBridgeModuleUrl)) as Record<string, unknown>;
    assert.deepEqual(
        Object.keys(runtimeMod).sort(),
        ["mapRenderRuntimeBridge", "tryLoadBackendModule"],
        "bridge module export surface changed",
    );
    const runtimeBridgeCandidate = runtimeMod.mapRenderRuntimeBridge;
    assert.equal(
        typeof runtimeMod.mapRenderRuntimeDebugBridge,
        "undefined",
        "bridge module must not export a separate debug bridge",
    );
    assert.equal(
        typeof runtimeMod.mapRenderDataBridge,
        "undefined",
        "runtime module must not export legacy helper bridge",
    );
    assert.ok(
        runtimeBridgeCandidate && typeof runtimeBridgeCandidate === "object",
        "missing mapRenderRuntimeBridge export",
    );
    const runtimeBridge = runtimeBridgeCandidate as Record<string, unknown>;
    assertFn(runtimeBridge, "initRuntime");
    assertFn(runtimeBridge, "createRuntimeWithConfig");
    assertFn(runtimeBridge, "destroyRuntime");
    assertFn(runtimeBridge, "resetRuntime");
    assertFn(runtimeBridge, "cachePutBlobBatch");
    assertFn(runtimeBridge, "cacheClearAllBlobs");
    assertFn(runtimeBridge, "cacheClearBlobDomain");
    assertFn(runtimeBridge, "cacheSetBuildConfig");
    assertFn(runtimeBridge, "getLastMissingBlobEntries");
    assertFn(runtimeBridge, "cacheSetVarps");
    assertFn(runtimeBridge, "buildMapPacketFromCache");
    // Packets are deep-copied out of wasm and released before returning.
    assertFn(runtimeBridge, "setTickState");
    assertFn(runtimeBridge, "updateTickStateNpcPathPacked");
    assertFn(runtimeBridge, "clearTickState");
    assertFn(runtimeBridge, "tickAdvanceAndEmitBasePatchesForState");
    assertFn(runtimeBridge, "decodeNpcSpawnsFromBytes");
    assertFn(runtimeBridge, "reset");
    assert.equal(
        typeof runtimeBridge.cacheClearBlobGroup,
        "undefined",
        "runtime bridge must not expose cacheClearBlobGroup (debug-only)",
    );
    assert.equal(
        typeof runtimeBridge.cacheGetBlobStats,
        "undefined",
        "runtime bridge must not expose cacheGetBlobStats (debug-only)",
    );
    assert.equal(
        typeof runtimeBridge.collectRequiredPrimaryTypeIds,
        "undefined",
        "runtime bridge must not expose collectRequiredPrimaryTypeIds (legacy/unused)",
    );
    assert.equal(
        typeof runtimeBridge.uploadCacheInputs,
        "undefined",
        "runtime bridge must not expose legacy uploadCacheInputs API",
    );
    assert.equal(
        typeof runtimeBridge.buildMapPacketFromSceneInput,
        "undefined",
        "runtime bridge must not expose legacy buildMapPacketFromSceneInput API",
    );
    assert.equal(
        typeof runtimeBridge.debugCollectCachedMapInputDigest,
        "undefined",
        "runtime bridge must not expose debug cache digest API",
    );
    assert.equal(
        typeof runtimeBridge.debugGetRuntimeCacheConfig,
        "undefined",
        "runtime bridge must not expose debug cache-config API",
    );
    assert.equal(
        typeof runtimeBridge.debugGetRuntimeLoadedHeightHash,
        "undefined",
        "runtime bridge must not expose debug loaded-height-hash API",
    );
    assert.equal(
        typeof runtimeBridge.debugGetRuntimeMapInputHashes,
        "undefined",
        "runtime bridge must not expose debug map-input-hashes API",
    );
    assert.equal(
        typeof runtimeBridge.emitDrawRangePatchesFromFrames,
        "undefined",
        "runtime bridge must not expose legacy split tick helper API",
    );
    assert.equal(
        typeof runtimeBridge.advanceLocFramesFixed,
        "undefined",
        "runtime bridge must not expose legacy split tick helper API",
    );
    assert.equal(
        typeof runtimeBridge.advanceNpcFramesFromSeqState,
        "undefined",
        "runtime bridge must not expose legacy split tick helper API",
    );
    assert.equal(
        typeof runtimeBridge.tickAdvanceAndEmitBasePatches,
        "undefined",
        "runtime bridge must not expose legacy combined tick helper API",
    );
    assert.equal(
        typeof runtimeBridge.buildScenePackPayloadFromCommandStream,
        "undefined",
        "runtime bridge must not expose legacy packed-command API",
    );
    assert.equal(
        typeof runtimeBridge.buildMapFromCache,
        "undefined",
        "runtime bridge must not expose legacy packet-handle build API",
    );
    assert.equal(
        typeof runtimeBridge.getRenderPacket,
        "undefined",
        "runtime bridge must not expose legacy packet-handle read API",
    );
    assert.equal(
        typeof runtimeBridge.releaseRenderPacket,
        "undefined",
        "runtime bridge must not expose legacy packet-handle release API",
    );

    const bridge = runtimeBridgeCandidate as RuntimeBridge;
    const runtimeReady = await bridge.initRuntime();
    assert.equal(runtimeReady, true, "runtime bridge init failed");

    const runtimeHandle = await bridge.createRuntimeWithConfig({
        cacheGame: 0,
        cacheRevision: 0,
        sceneLevels: 4,
        unitsTileHeightBasis: 8,
    });
    assert.ok(
        Number.isInteger(runtimeHandle) && (runtimeHandle as number) > 0,
        "createRuntime did not return a valid runtime handle",
    );
    const handle = runtimeHandle as number;

    const noStateTick = bridge.tickAdvanceAndEmitBasePatchesForState(handle, 1, 0, 0);
    assert.equal(noStateTick, undefined, "expected no-state tick to return undefined");
    const setStateOk = bridge.setTickState(handle, 1, {});
    assert.equal(setStateOk, false, "invalid tick state input should fail");

    const putBlob = await bridge.cachePutBlobBatch(
        handle,
        1,
        Int32Array.of(2),
        Int32Array.of(3),
        Int32Array.of(0),
        Int32Array.of(3),
        Uint8Array.from([1, 2, 3]),
    );
    assert.equal(putBlob, 1, "cachePutBlobBatch should succeed");
    const overwriteBlob = await bridge.cachePutBlobBatch(
        handle,
        1,
        Int32Array.of(2),
        Int32Array.of(3),
        Int32Array.of(0),
        Int32Array.of(4),
        Uint8Array.from([1, 2, 3, 4]),
    );
    assert.equal(overwriteBlob, 1, "cachePutBlobBatch should allow overwrite");
    const clearDomain = await bridge.cacheClearBlobDomain(handle, 1);
    assert.equal(clearDomain, 1, "cacheClearBlobDomain should succeed");

    const defaultSetBuildConfig = await bridge.cacheSetBuildConfig(handle, {} as any);
    assert.equal(defaultSetBuildConfig, 1, "cacheSetBuildConfig should accept defaulted input");
    const invalidBuildPacket = await bridge.buildMapPacketFromCache(handle, {} as any);
    assert.equal(
        invalidBuildPacket,
        undefined,
        "invalid one-call map packet build input should return undefined",
    );
    const invalidBuildPacketBadHandle = await bridge.buildMapPacketFromCache(-1, {} as any);
    assert.equal(
        invalidBuildPacketBadHandle,
        undefined,
        "invalid runtime handle should fail one-call packet build",
    );
    const decodedNpcResult = await bridge.decodeNpcSpawnsFromBytes(
        [new Uint8Array(1)],
        0,
        0,
        0,
        new Uint8Array(0),
    );
    assert.equal(decodedNpcResult, undefined, "empty npc decode input should return undefined");

    const emptyBuckets = new Int32Array(8);
    const validPacket: MapRenderRuntimePacket = {
        packetVersion: 1,
        bucketCmdCounts: emptyBuckets,
        bucketModelInfoLengths: new Int32Array(8),
        drawRangesPacked: new Int32Array(0),
        modelInfoTextureBuckets: [
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
        ],
        heightMapTextureData: new Int16Array(4),
        vertices: new Uint8Array(0),
        indices: new Int32Array(0),
        usedTextureIds: new Int32Array(0),
        levels: 1,
        sizeX: 2,
        sizeY: 2,
        unitsTileHeightBasis: 8,
        totalModelInfoLength: 0,
    };
    const overlay = runtimePacketToPayloadOverlay(validPacket);
    assert.ok(
        overlay !== undefined,
        "runtimePacketToPayloadOverlay should accept command-stream packet contract",
    );

    const missingCommandArrays = {
        packetVersion: 1,
        bucketCmdCounts: new Int32Array(8),
        bucketModelInfoLengths: new Int32Array(8),
        modelInfoTextureBuckets: [],
        heightMapTextureData: new Int16Array(4),
        vertices: new Uint8Array(0),
        indices: new Int32Array(0),
        levels: 1,
        sizeX: 2,
        sizeY: 2,
        unitsTileHeightBasis: 8,
        totalModelInfoLength: 0,
    } as unknown as MapRenderRuntimePacket;
    const missingOverlay = runtimePacketToPayloadOverlay(missingCommandArrays);
    assert.equal(
        missingOverlay,
        undefined,
        "runtimePacketToPayloadOverlay should reject packets missing renderer-ready arrays",
    );
    const wrongVersionPacket = {
        ...validPacket,
        packetVersion: 999,
    };
    assert.equal(
        runtimePacketToPayloadOverlay(wrongVersionPacket),
        undefined,
        "runtimePacketToPayloadOverlay should reject unknown packet versions",
    );

    bridge.clearTickState(handle, 1);
    bridge.resetRuntime(handle);
    const setBuildConfigAfterReset = await bridge.cacheSetBuildConfig(handle, {} as any);
    assert.equal(setBuildConfigAfterReset, 1, "cacheSetBuildConfig should work after reset");
    bridge.destroyRuntime(handle);
    const setBuildConfigAfterDestroy = await bridge.cacheSetBuildConfig(handle, {} as any);
    assert.notEqual(setBuildConfigAfterDestroy, 1, "build-config should fail after destroy");

    const lifecycleFixture = await buildRuntimeLifecycleFixture();
    const lifecycleRuntimeHandle = await bridge.createRuntimeWithConfig({
        cacheGame: lifecycleFixture.sceneBuildInput.cacheGame | 0,
        cacheRevision: lifecycleFixture.sceneBuildInput.cacheRevision | 0,
        sceneLevels: 4,
        unitsTileHeightBasis: lifecycleFixture.sceneBuildInput.unitsTileHeightBasis | 0,
    });
    assert.ok(
        Number.isInteger(lifecycleRuntimeHandle) && (lifecycleRuntimeHandle as number) > 0,
        "lifecycle createRuntime did not return a valid runtime handle",
    );
    const lifecycleHandle = lifecycleRuntimeHandle as number;
    const lifecycleCacheUploader = new WasmCacheUploader();
    const uploadedLifecycle = await uploadRuntimeCacheForBuildRequest(
        bridge,
        lifecycleHandle,
        lifecycleFixture.request,
        lifecycleFixture.sceneBuildInput,
    );
    assert.equal(uploadedLifecycle, true, "expected lifecycle cache upload to succeed");

    const packetA = await buildMapPacketWithPreparedRuntime(
        bridge,
        lifecycleCacheUploader,
        lifecycleHandle,
        lifecycleFixture.request,
        lifecycleFixture.sceneBuildInput,
        "packetA",
    );
    assert.ok(packetA, "expected first lifecycle packet");
    assertNpcSlotMetadataContract(packetA as MapRenderRuntimePacket, "packetA");

    const packetB = await buildMapPacketWithPreparedRuntime(
        bridge,
        lifecycleCacheUploader,
        lifecycleHandle,
        lifecycleFixture.request,
        lifecycleFixture.sceneBuildInput,
        "packetB",
    );
    assert.ok(packetB, "expected second lifecycle packet");
    assertNpcSlotMetadataContract(packetB as MapRenderRuntimePacket, "packetB");

    const packetC = await buildMapPacketWithPreparedRuntime(
        bridge,
        lifecycleCacheUploader,
        lifecycleHandle,
        lifecycleFixture.request,
        lifecycleFixture.sceneBuildInput,
        "packetC",
    );
    assert.ok(packetC, "expected third lifecycle packet");
    assertNpcSlotMetadataContract(packetC as MapRenderRuntimePacket, "packetC");

    const packetD = await buildMapPacketWithPreparedRuntime(
        bridge,
        lifecycleCacheUploader,
        lifecycleHandle,
        lifecycleFixture.request,
        lifecycleFixture.sceneBuildInput,
        "packetD",
    );
    assert.ok(packetD, "expected packet before reset");
    assertNpcSlotMetadataContract(packetD as MapRenderRuntimePacket, "packetD");
    bridge.resetRuntime(lifecycleHandle);
    const uploadedAfterReset = await uploadRuntimeCacheForBuildRequest(
        bridge,
        lifecycleHandle,
        lifecycleFixture.request,
        lifecycleFixture.sceneBuildInput,
    );
    assert.equal(uploadedAfterReset, true, "expected cache upload to succeed after reset");
    const packetE = await buildMapPacketWithPreparedRuntime(
        bridge,
        lifecycleCacheUploader,
        lifecycleHandle,
        lifecycleFixture.request,
        lifecycleFixture.sceneBuildInput,
        "packetE",
    );
    assert.ok(packetE, "expected packet after reset");
    assertNpcSlotMetadataContract(packetE as MapRenderRuntimePacket, "packetE");
    bridge.destroyRuntime(lifecycleHandle);
    const packetAfterDestroy = await bridge.buildMapPacketFromCache(
        lifecycleHandle,
        lifecycleFixture.request,
    );
    assert.equal(packetAfterDestroy, undefined, "buildMapPacket should fail after runtime destroy");

    bridge.reset();

    console.log("map-render-runtime-bridge-contract: ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
