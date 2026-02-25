import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { tryCreateCacheSession } from "../../src/rs/runtime/createCacheSession";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeDebugBridgeV2,
} from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import {
    createByteDrivenSceneBuildInput,
    createMapRenderRuntimeUploadScratchState,
    resetMapRenderRuntimeUploadScratchState,
    uploadRuntimeCacheForBuildRequestWithBridge,
} from "../../src/worker/MapRenderDataBackend";
import {
    MapRenderRuntimePacket,
    runtimePacketToPayloadOverlay,
} from "../../src/worker/MapRenderDataContract";
import { loadCache, loadCacheInfos } from "./load-util";

type RuntimeBridge = MapRenderRuntimeBridgeV2;
type RuntimeDebugBridge = MapRenderRuntimeDebugBridgeV2;

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
            loadedTextureIds: new Set<number>(),
        },
        {
            mapBytesProvider,
            locTypeLoader: session.loaders.locTypeLoader,
            locModelLoader: {
                modelLoader: session.loaders.modelLoader,
                textureLoader: session.loaders.textureLoader,
                seqTypeLoader: session.loaders.seqTypeLoader,
                seqFrameLoader: session.loaders.seqFrameLoader,
            },
            varProvider,
            cacheGame: loadedCache.info.game,
            cacheRevision: loadedCache.info.revision,
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

async function main(): Promise<void> {
    const runtimeBridgeModuleUrl = pathToFileURL(
        path.resolve(process.cwd(), "src/wasm/rs_map_render_backend_runtime.mjs"),
    ).href;
    const runtimeDebugBridgeModuleUrl = pathToFileURL(
        path.resolve(process.cwd(), "src/wasm/rs_map_render_backend_runtime.mjs"),
    ).href;
    const runtimeMod = (await import(runtimeBridgeModuleUrl)) as Record<string, unknown>;
    const runtimeDebugMod = (await import(runtimeDebugBridgeModuleUrl)) as Record<string, unknown>;
    const runtimeBridgeCandidate = runtimeMod.mapRenderRuntimeBridge;
    assert.equal(
        typeof runtimeMod.mapRenderRuntimeDebugBridge,
        "undefined",
        "runtime module must not export debug bridge",
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
    assertFn(runtimeBridge, "cachePutTextureArgb");
    assertFn(runtimeBridge, "cacheClearTextureArgb");
    assertFn(runtimeBridge, "cachePutMaterialParams");
    assertFn(runtimeBridge, "cacheClearMaterialParams");
    assertFn(runtimeBridge, "cacheGetResourceCounts");
    assertFn(runtimeBridge, "cacheSetBuildConfig");
    assertFn(runtimeBridge, "cacheClearMapSquares");
    assertFn(runtimeBridge, "cachePutMapSquaresPacked");
    assertFn(runtimeBridge, "cacheClearTypeKind");
    assertFn(runtimeBridge, "cachePutTypeEntry");
    assertFn(runtimeBridge, "collectRequiredPrimaryTypeIds");
    assertFn(runtimeBridge, "collectRequiredExpandedTypeIds");
    assertFn(runtimeBridge, "cacheSetVarps");
    assertFn(runtimeBridge, "buildMapPacketFromCache");
    assertFn(runtimeBridge, "releasePacket");
    assertFn(runtimeBridge, "setTickState");
    assertFn(runtimeBridge, "clearTickState");
    assertFn(runtimeBridge, "tickAdvanceAndEmitBasePatchesForState");
    assertFn(runtimeBridge, "decodeNpcSpawnsFromBytes");
    assertFn(runtimeBridge, "reset");
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

    const runtimeDebugBridgeCandidate = runtimeDebugMod.mapRenderRuntimeDebugBridge;
    assert.equal(
        typeof runtimeDebugMod.mapRenderRuntimeBridge,
        "undefined",
        "runtime debug module must not export runtime bridge",
    );
    assert.equal(
        typeof runtimeDebugMod.mapRenderDataBridge,
        "undefined",
        "runtime debug module must not export legacy helper bridge",
    );
    assert.ok(
        runtimeDebugBridgeCandidate && typeof runtimeDebugBridgeCandidate === "object",
        "missing mapRenderRuntimeDebugBridge export",
    );
    const runtimeDebugBridge = runtimeDebugBridgeCandidate as Record<string, unknown>;
    assertFn(runtimeDebugBridge, "debugCollectCachedMapInputDigest");
    assertFn(runtimeDebugBridge, "debugGetRuntimeCacheConfig");
    assertFn(runtimeDebugBridge, "debugGetRuntimeLoadedHeightHash");
    assertFn(runtimeDebugBridge, "debugGetRuntimeMapInputHashes");

    const bridge = runtimeBridgeCandidate as RuntimeBridge;
    const debugBridge = runtimeDebugBridgeCandidate as RuntimeDebugBridge;
    const runtimeReady = await bridge.initRuntime();
    assert.equal(runtimeReady, true, "runtime bridge init failed");
    const debugRuntimeReady = await debugBridge.initRuntime();
    assert.equal(debugRuntimeReady, true, "runtime debug bridge init failed");

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

    const cachePutTexture = await bridge.cachePutTextureArgb(
        handle,
        42,
        Int32Array.from([0xff00ff00]),
    );
    assert.equal(cachePutTexture, 1, "cachePutTextureArgb should succeed");
    const cachePutMaterial = await bridge.cachePutMaterialParams(
        handle,
        7,
        Int32Array.from([1, 2, 3]),
    );
    assert.equal(cachePutMaterial, 1, "cachePutMaterialParams should succeed");
    const resourceCounts = await bridge.cacheGetResourceCounts(handle);
    assert.equal(resourceCounts?.textureCount, 1, "resource stats should include uploaded texture");
    assert.equal(
        resourceCounts?.materialCount,
        1,
        "resource stats should include uploaded material",
    );
    const cacheClearTexture = await bridge.cacheClearTextureArgb(handle);
    assert.equal(cacheClearTexture, 1, "cacheClearTextureArgb should succeed");
    const cacheClearMaterial = await bridge.cacheClearMaterialParams(handle);
    assert.equal(cacheClearMaterial, 1, "cacheClearMaterialParams should succeed");

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

    assert.doesNotThrow(() => {
        bridge.releasePacket?.(undefined);
    }, "releasePacket should accept undefined packets");

    bridge.clearTickState(handle, 1);
    bridge.resetRuntime(handle);
    const setBuildConfigAfterReset = await bridge.cacheSetBuildConfig(handle, {} as any);
    assert.equal(setBuildConfigAfterReset, 1, "cacheSetBuildConfig should work after reset");
    bridge.destroyRuntime(handle);
    const setBuildConfigAfterDestroy = await bridge.cacheSetBuildConfig(handle, {} as any);
    assert.notEqual(setBuildConfigAfterDestroy, 1, "build-config should fail after destroy");

    const lifecycleRuntimeHandle = await bridge.createRuntimeWithConfig({
        cacheGame: 0,
        cacheRevision: 0,
        sceneLevels: 4,
        unitsTileHeightBasis: 8,
    });
    assert.ok(
        Number.isInteger(lifecycleRuntimeHandle) && (lifecycleRuntimeHandle as number) > 0,
        "lifecycle createRuntime did not return a valid runtime handle",
    );
    const lifecycleHandle = lifecycleRuntimeHandle as number;
    const lifecycleFixture = await buildRuntimeLifecycleFixture();
    const uploadScratchState = createMapRenderRuntimeUploadScratchState();
    const uploadedLifecycle = await uploadRuntimeCacheForBuildRequestWithBridge(
        bridge,
        lifecycleHandle,
        lifecycleFixture.request,
        lifecycleFixture.sceneBuildInput,
        uploadScratchState,
    );
    assert.equal(uploadedLifecycle, true, "expected lifecycle cache upload to succeed");

    const packetA = (await bridge.buildMapPacketFromCache(
        lifecycleHandle,
        lifecycleFixture.request,
    )) as MapRenderRuntimePacket | undefined;
    assert.ok(packetA, "expected first lifecycle packet");
    assert.equal(
        bridge.releasePacket?.(packetA),
        true,
        "releasePacket should succeed for active packet handle",
    );
    assert.equal(
        bridge.releasePacket?.(packetA),
        false,
        "releasePacket should fail when packet handle is already released",
    );

    const packetB = (await bridge.buildMapPacketFromCache(
        lifecycleHandle,
        lifecycleFixture.request,
    )) as MapRenderRuntimePacket | undefined;
    assert.ok(packetB, "expected second lifecycle packet");
    const packetC = (await bridge.buildMapPacketFromCache(
        lifecycleHandle,
        lifecycleFixture.request,
    )) as MapRenderRuntimePacket | undefined;
    assert.ok(packetC, "expected third lifecycle packet");
    assert.equal(
        bridge.releasePacket?.(packetB),
        false,
        "releasePacket should fail for stale packet handle after rebuild",
    );
    assert.equal(
        bridge.releasePacket?.(packetC),
        true,
        "releasePacket should succeed for newest packet handle",
    );

    const packetD = (await bridge.buildMapPacketFromCache(
        lifecycleHandle,
        lifecycleFixture.request,
    )) as MapRenderRuntimePacket | undefined;
    assert.ok(packetD, "expected packet before reset");
    bridge.resetRuntime(lifecycleHandle);
    resetMapRenderRuntimeUploadScratchState(uploadScratchState);
    assert.equal(
        bridge.releasePacket?.(packetD),
        false,
        "releasePacket should fail for stale packet handle after runtime reset",
    );
    const uploadedAfterReset = await uploadRuntimeCacheForBuildRequestWithBridge(
        bridge,
        lifecycleHandle,
        lifecycleFixture.request,
        lifecycleFixture.sceneBuildInput,
        uploadScratchState,
    );
    assert.equal(uploadedAfterReset, true, "expected cache upload to succeed after reset");
    const packetE = (await bridge.buildMapPacketFromCache(
        lifecycleHandle,
        lifecycleFixture.request,
    )) as MapRenderRuntimePacket | undefined;
    assert.ok(packetE, "expected packet after reset");
    bridge.destroyRuntime(lifecycleHandle);
    assert.equal(
        bridge.releasePacket?.(packetE),
        false,
        "releasePacket should fail for stale packet handle after runtime destroy",
    );
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
