import JSZip from "jszip";
import { TransferDescriptor } from "threads";
import { registerSerializer } from "threads";
import { Transfer, expose } from "threads/worker";

import { NpcSpawn } from "../data/npc/NpcSpawn";
import { ObjSpawn } from "../data/obj/ObjSpawn";
import type { LocAnimatedData } from "../runtime/entities/LocAnimatedData";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../runtime/contracts/NpcGpuFrame";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import { decodeNpcUpdatePacket } from "../runtime/sim/NpcUpdatePacket";
import {
    TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE,
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
    framePacketTransferables,
} from "../runtime/contracts/FramePacket";
import {
    buildFramePacketMapEntry,
    buildFramePacketFromMapEntries,
    type FramePacketMapEntry,
} from "../runtime/contracts/FramePacketBuilder";
import { CacheType } from "../rs/cache/CacheType";
import { JSCompressionHandler } from "../rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../rs/config/vartype/VarProvider";
import { EnumeratingArchiveBytesProvider } from "../rs/io/BytesProvider";
import { CacheSession, tryCreateCacheSession } from "../rs/loaders/CacheSession";
import { initErrorToString } from "../rs/loaders/InitError";
import { MapBytesProvider, MapFileBytesProvider } from "../rs/map/MapBytesProvider";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import { MapImageRenderer } from "../rs/render/minimap/MapImageRenderer";
import { type CollisionData } from "../rs/scene/CollisionMap";
import { Scene } from "../rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../rs/scene/buildSceneFromMapBytesProvider";
import { decodeNpcSpawnsFromBytes } from "../rs/scene/decodeNpcSpawns";
import { LocModelLoader } from "../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../rs/scene/model/ObjModelLoader";
import { IndexedSprite } from "../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../rs/sprite/SpriteLoader";
import { LoadedCache } from "../util/Caches";
import { errorToString } from "../util/ErrorUtil";
import { Hasher } from "../util/Hasher";
import { LOC_CYCLE_SCALE } from "../wasm/LocCycle";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeHandle,
} from "../wasm/MapRenderRuntimeBridgeAbi";
import { mapRenderRuntimeBridge } from "../wasm/rs_map_render_backend_bridge.mjs";
import { createMapRenderDataBackend } from "./MapRenderDataBackend";
import type { MapRenderDataBackend, MapRenderDataBackendKind } from "./MapRenderDataBackend";
import { MinimapData, loadMinimapBlob } from "./MinimapData";
import { RenderDataLoader, renderDataLoaderSerializer } from "./RenderDataLoader";
import {
    applyNpcMovementStep,
    buildTickPatchStreamsForMap,
    readWasmPatchStreamsForMap,
} from "./runtime/WorkerTickPatchPipeline";
import { NpcGpuFrameBuilder, type NpcGpuFrameSource } from "./runtime/NpcGpuFrameBuilder";
import type { NpcSpawnEvent } from "../runtime/sim/NpcEvents";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import {
    createNpcBootstrapDataFromSpawns,
    type NpcBootstrapData,
} from "../runtime/sim/NpcBootstrapData";
import { WorkerMapSimLifecycle } from "./runtime/WorkerMapSimLifecycle";
import { WorkerNpcSimStateStore } from "./runtime/WorkerNpcSimStateStore";

registerSerializer(renderDataLoaderSerializer);

const compressionHandler = new JSCompressionHandler();
const hasherPromise = Hasher.init();

export type WorkerState = {
    session: CacheSession;
    varProvider: VarManagerProvider;
    mapBytesProvider: MapBytesProvider;
    locModelLoader: LocModelLoader;
    objModelLoader: ObjModelLoader;
    npcModelLoader: NpcModelLoader;

    sceneBuilder: SceneBuilder;
    mapRenderDataBackend: MapRenderDataBackend;

    mapImageRenderer: MapImageRenderer;
    mapImageCache: Cache;

    objSpawns: ObjSpawn[];
    npcSpawns: NpcSpawn[];
};

type WorkerStateInit = { ok: true; state: WorkerState } | { ok: false; error: string };

export type WorkerRuntimeOptions = Readonly<{
    mapRenderBackend?: MapRenderDataBackendKind;
    mapRenderTelemetry?: boolean;
}>;

let workerStatePromise: Promise<WorkerStateInit> | undefined;
const npcSimStateStore = new WorkerNpcSimStateStore();
const npcSimPathfinder = new Pathfinder();
const npcGpuFrameBuilder = new NpcGpuFrameBuilder();
const tickWasmBridge = mapRenderRuntimeBridge as unknown as MapRenderRuntimeBridgeV2;
let workerRuntimeOptions: WorkerRuntimeOptions | undefined;
const workerMapSimLifecycle = new WorkerMapSimLifecycle();

function shouldUseWasmTickInWorker(): boolean {
    return workerRuntimeOptions?.mapRenderBackend === "cpp-wasm";
}

function decodeMapSquareFromId(mapId: number): Readonly<{ mapX: number; mapY: number }> {
    return {
        mapX: (mapId >> 8) & 0xff,
        mapY: mapId & 0xff,
    };
}

function maybeHydrateNpcBootstrapEventsFromMapBytes(
    workerState: WorkerState,
    mapId: number,
    borderSize: number,
    tileRenderFlagsLevel1: Uint8Array[],
    npcBootstrapDataIn: Readonly<{
        spawnEvents: ReadonlyArray<NpcSpawnEvent>;
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>;
    }>,
): NpcBootstrapData {
    if ((npcBootstrapDataIn.spawnEvents.length | 0) > 0) {
        return {
            spawnEvents: Array.from(npcBootstrapDataIn.spawnEvents),
            npcTypeAnimationTable: Array.from(npcBootstrapDataIn.npcTypeAnimationTable),
        };
    }
    const { mapX, mapY } = decodeMapSquareFromId(mapId);
    const npcSpawnBytes = workerState.mapBytesProvider.getNpcSpawnBytes(mapX, mapY);
    if (!(npcSpawnBytes instanceof Uint8Array) || npcSpawnBytes.length === 0) {
        return {
            spawnEvents: [],
            npcTypeAnimationTable: [],
        };
    }
    const decodedSpawns = decodeNpcSpawnsFromBytes(
        tileRenderFlagsLevel1,
        borderSize,
        mapX,
        mapY,
        npcSpawnBytes,
    );
    if (!decodedSpawns || (decodedSpawns.length | 0) <= 0) {
        return {
            spawnEvents: [],
            npcTypeAnimationTable: [],
        };
    }
    const npcTypeLoader = workerState.session.loaders.npcTypeLoader;
    const filteredSpawns = decodedSpawns.filter((spawn) => {
        const npcResult = npcTypeLoader.tryLoad(spawn.id);
        return npcResult.ok && (npcResult.value.loginScreenProps & 0x1) > 0;
    });
    if ((filteredSpawns.length | 0) <= 0) {
        return {
            spawnEvents: [],
            npcTypeAnimationTable: [],
        };
    }
    return createNpcBootstrapDataFromSpawns(mapId | 0, filteredSpawns);
}

async function requireWorkerState(): Promise<WorkerState> {
    const init = await workerStatePromise;
    if (!init) {
        throw new Error("Worker not initialized");
    }
    if (!init.ok) {
        throw new Error(init.error);
    }
    return init.state;
}

function createNpcSimStateStoreDeps(workerState: WorkerState) {
    return {
        npcTypeLoader: workerState.session.loaders.npcTypeLoader,
        basTypeLoader: workerState.session.loaders.basTypeLoader,
        seqTypeLoader: workerState.session.loaders.seqTypeLoader,
        tickPatchEntryStride: TICK_PATCH_ENTRY_STRIDE,
    } as const;
}

async function initWorker(
    cache: LoadedCache,
    objSpawns: ObjSpawn[],
    npcSpawns: NpcSpawn[],
    options?: WorkerRuntimeOptions,
): Promise<WorkerState> {
    await hasherPromise;

    const sessionResult = tryCreateCacheSession(cache, compressionHandler);
    if (!sessionResult.ok) {
        throw new Error(initErrorToString(sessionResult.error));
    }
    const session = sessionResult.value;
    const {
        underlayTypeLoader,
        overlayTypeLoader,
        locTypeLoader,
        objTypeLoader,
        npcTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        mapFileLoader,
        mapScenes,
        mapFunctions,
    } = session.loaders;
    const skeletalSeqLoader = session.getSkeletalSeqLoader();

    const varProvider = new VarManagerProvider(session.varManager);

    const mapBytesProvider = new MapFileBytesProvider(mapFileLoader, cache.xteas);

    const locModelLoader = new LocModelLoader(
        locTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
    );

    const objModelLoader = new ObjModelLoader(objTypeLoader, modelLoader, textureLoader);

    const npcModelLoader = new NpcModelLoader(
        npcTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
        varProvider,
    );

    const sceneBuilder = new SceneBuilder(cache.info, {
        underlayTypeLoader,
        overlayTypeLoader,
        locTypeLoader,
        textureLoader,
        locModelLoader,
        varProvider,
    });
    const mapRenderBackendKind = options?.mapRenderBackend ?? "cpp-wasm";
    const mapImageRenderer = new MapImageRenderer(
        textureLoader,
        locTypeLoader,
        mapScenes,
        mapFunctions,
    );
    const mapRenderDataBackend = createMapRenderDataBackend(
        mapRenderBackendKind,
        {
            session,
            sceneBuilder,
            mapBytesProvider,
            locModelLoader,
            objModelLoader,
            npcModelLoader,
            mapImageRenderer,
            varProvider,
            objSpawns,
            npcSpawns,
        },
        {
            telemetry: options?.mapRenderTelemetry,
        },
    );

    const mapImageCache = await caches.open("map-images");

    return {
        session,
        varProvider,
        mapBytesProvider,
        locModelLoader,
        objModelLoader,
        npcModelLoader,

        sceneBuilder,
        mapRenderDataBackend,

        mapImageRenderer,
        mapImageCache,

        objSpawns,
        npcSpawns,
    };
}

const worker = {
    async initCache(
        cache: LoadedCache,
        objSpawns: ObjSpawn[],
        npcSpawns: NpcSpawn[],
        options?: WorkerRuntimeOptions,
    ): Promise<void> {
        console.log("init worker", cache.info);
        workerRuntimeOptions = options;
        workerStatePromise = initWorker(cache, objSpawns, npcSpawns, options)
            .then((state) => ({ ok: true, state }) as const)
            .catch((e) => ({ ok: false, error: errorToString(e) }) as const);
        npcSimStateStore.resetForCache();
        workerMapSimLifecycle.reset();
        // Make initCache awaitable so callers can block until the worker is fully ready.
        await requireWorkerState();
    },
    initDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.init();
    },
    async resetDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.reset();
        npcSimStateStore.resetForLoaderReset();
        workerMapSimLifecycle.reset();
        const workerState = await requireWorkerState();
        workerState.mapRenderDataBackend.reset();
    },
    async load<I, D>(
        dataLoader: RenderDataLoader<I, D>,
        input: I,
    ): Promise<TransferDescriptor<D> | undefined> {
        const workerState = await requireWorkerState();

        const { data, transferables } = await dataLoader.load(workerState, input);

        if (!data) {
            return undefined;
        }
        return Transfer<D>(data, transferables);
    },
    async loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<TransferDescriptor<Int32Array>> {
        const workerState = await requireWorkerState();

        const pixels =
            workerState.session.getTextureLoader().tryGetPixelsArgb(id, size, flipH, brightness) ??
            new Int32Array(size * size);

        return Transfer(pixels, [pixels.buffer]);
    },
    async loadMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ): Promise<MinimapData | undefined> {
        const workerState = await requireWorkerState();

        const borderSize = 6;

        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        const scene = buildSceneFromMapBytesProvider(
            workerState.sceneBuilder,
            workerState.mapBytesProvider,
            baseX,
            baseY,
            mapSize,
            mapSize,
            false,
            LocLoadType.NO_MODELS,
        );

        const minimapBlob = await loadMinimapBlob(
            workerState.mapImageRenderer,
            scene,
            level,
            borderSize,
            drawMapFunctions,
        );

        return {
            mapX,
            mapY,
            level,
            cacheInfo: workerState.session.cache.info,
            minimapBlob,
        };
    },
    async registerMapNpcSimState(
        mapId: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        collisionDatas: CollisionData[],
        locsAnimated: LocAnimatedData[],
        npcEventsIn: NpcSpawnEvent[],
        npcTypeAnimationTableIn: NpcTypeAnimationEntry[],
        mapSimToken?: number,
    ): Promise<void> {
        if (!workerMapSimLifecycle.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        const workerState = await requireWorkerState();
        const npcBootstrapData = maybeHydrateNpcBootstrapEventsFromMapBytes(
            workerState,
            mapId,
            borderSize,
            tileRenderFlagsLevel1,
            {
                spawnEvents: npcEventsIn,
                npcTypeAnimationTable: npcTypeAnimationTableIn,
            },
        );
        const deps = createNpcSimStateStoreDeps(workerState);
        npcSimStateStore.registerMap(
            {
                mapId,
                borderSize,
                tileRenderFlagsLevel1,
                collisionDatas,
                locsAnimated,
                npcTypeAnimationTable: npcBootstrapData.npcTypeAnimationTable,
            },
            deps,
        );
        npcSimStateStore.applyMapNpcLifecycleEvents(
            mapId | 0,
            npcBootstrapData.spawnEvents,
            deps,
            true,
        );
        workerMapSimLifecycle.clearMissingTickStateWarning(mapId);
    },
    unregisterMapNpcSimState(mapId: number, mapSimToken?: number): void {
        if (!workerMapSimLifecycle.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        npcSimStateStore.unregisterMap(mapId);
        workerMapSimLifecycle.clearMissingTickStateWarning(mapId);
        // Tick state is owned by the map-render runtime (C++). Do not mirror/clear it from TS here.
    },
    async applyNpcUpdatePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        const decoded = decodeNpcUpdatePacket(packet);
        const workerState = await requireWorkerState();
        const deps = createNpcSimStateStoreDeps(workerState);
        let applied = 0;
        for (const [mapId, events] of decoded.updateEventsByMapId.entries()) {
            applied =
                (applied +
                    (npcSimStateStore.applyMapNpcLifecycleEvents(
                        mapId | 0,
                        events,
                        deps,
                    ) | 0)) |
                0;
        }
        return applied | 0;
    },
    async tickFrame(
        frameCount: number,
        mapIds: Int32Array,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
        cameraMapX: number,
        cameraMapY: number,
        lodDistance: number,
        hoveredMapIdsPacked: Int32Array,
    ): Promise<TransferDescriptor<FramePacket | undefined>> {
        if (!(mapIds instanceof Int32Array) || mapIds.length === 0) {
            return Transfer<FramePacket | undefined>(undefined, []);
        }

        const workerState = await requireWorkerState();
        const seqTypeLoader = workerState.session.loaders.seqTypeLoader;
        const seqFrameLoader = workerState.session.loaders.seqFrameLoader;

        npcGpuFrameBuilder.beginFrame();

        const entries = new Array<FramePacketMapEntry>(mapIds.length | 0);

        const safeTicksElapsed = Math.max(0, Math.min(ticksElapsed | 0, 4));
        const safeClientTicks = Math.max(0, Math.min(clientTicksElapsed | 0, 50));

        const useWasmTick =
            shouldUseWasmTickInWorker() &&
            typeof tickWasmBridge.tickMapsEmitPatchStreams === "function";
        const cycleNowFixed = Math.round(cycleNow * LOC_CYCLE_SCALE) | 0;
        let wasmTick:
            | Readonly<{ tickPatchCountsByMapId: Int32Array; tickPatchPacked: Int32Array }>
            | undefined;
        if (useWasmTick) {
            const handle = workerState.mapRenderDataBackend.getCppWasmRuntimeHandle?.();
            if (handle === undefined) {
                throw new Error("[map-render][tick][cpp-wasm] map-render runtime handle missing");
            }
            wasmTick = tickWasmBridge.tickMapsEmitPatchStreams?.(
                handle,
                mapIds,
                cycleNowFixed,
                safeClientTicks,
            ) as any;
            if (!wasmTick) {
                throw new Error("[map-render][tick][cpp-wasm] tickMapsEmitPatchStreams failed");
            }
        }
        const wasmCountsByMapId = wasmTick?.tickPatchCountsByMapId;
        const wasmPatchesPacked = wasmTick?.tickPatchPacked;

        const ringSize = NPC_DATA_TEXTURE_RING_SIZE;
        const newIndexMod = (frameCount | 0) % ringSize;
        const safeLodDistance = Math.max(0, lodDistance | 0);
        const hoveredMapIds = new Set<number>();
        if (hoveredMapIdsPacked instanceof Int32Array) {
            for (let i = 0; i < hoveredMapIdsPacked.length; i++) {
                hoveredMapIds.add(hoveredMapIdsPacked[i] | 0);
            }
        }
        let wasmReadOff = 0;
        for (let mi = 0; mi < mapIds.length; mi++) {
            const mapId = mapIds[mi] | 0;
            const state = npcSimStateStore.getMap(mapId);
            const wasmPatchRead = readWasmPatchStreamsForMap(
                mapId,
                mi,
                wasmReadOff,
                wasmCountsByMapId,
                wasmPatchesPacked,
            );
            wasmReadOff = wasmPatchRead.nextReadOff | 0;
            if (!state) {
                if (workerMapSimLifecycle.consumeMissingTickStateWarning(mapId)) {
                    const { mapX, mapY } = decodeMapSquareFromId(mapId);
                    console.warn(
                        `[map-render][tick] missing worker sim state for visible map ${mapX},${mapY} ` +
                            `(mapId=${mapId | 0} index=${mi | 0} backend=${
                                workerRuntimeOptions?.mapRenderBackend ?? "unknown"
                            })`,
                    );
                }
                entries[mi] = buildFramePacketMapEntry({
                    mapId,
                    cameraMapX,
                    cameraMapY,
                    lodDistance: safeLodDistance,
                    hoveredMapIds,
                    hasNpcs: false,
                    npcOffset: -1,
                    tickPatchCounts: new Int32Array(TICK_PATCH_STREAM_COUNT),
                    tickPatchStreams: new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT),
                });
                continue;
            }
            const hasNpcs = (state.npcs.length | 0) > 0;

            applyNpcMovementStep(
                state,
                npcSimPathfinder,
                safeTicksElapsed,
                safeClientTicks,
                seqTypeLoader,
                seqFrameLoader,
            );

            // Build packed NPC gpu info (x,y,rotationAndPlane,typeId) and per-map offset.
            const target: NpcGpuFrameSource = {
                id: mapId | 0,
                getNpcs: () => state.npcs,
                getTileRenderFlag: (_level: number, tileX: number, tileY: number): number => {
                    const col = state.tileRenderFlagsLevel1[(tileX + state.borderSize) | 0];
                    return col ? col[(tileY + state.borderSize) | 0] | 0 : 0;
                },
            };
            const npcOffset = npcGpuFrameBuilder.addRenderable(target);

            const tickPatchesForMap = buildTickPatchStreamsForMap({
                mapId,
                mapEntryIndex: mi,
                cycleNow,
                state,
                seqFrameLoader,
                includeTsLocTickPatches: !wasmTick,
                useWasmLocStreams: wasmPatchRead.useWasmLocStreams,
                hasWasmCountsForMap: wasmPatchRead.hasWasmCountsForMap,
                wasmLocStreamsForMap: wasmPatchRead.streamsForMap,
                wasmCountsByMapId,
            });
            entries[mi] = buildFramePacketMapEntry({
                mapId,
                cameraMapX,
                cameraMapY,
                lodDistance: safeLodDistance,
                hoveredMapIds,
                hasNpcs,
                npcOffset: npcOffset | 0,
                tickPatchCounts: tickPatchesForMap.streamCounts,
                tickPatchStreams: tickPatchesForMap.streamsForMap,
            });

        }
        if (
            wasmPatchesPacked instanceof Int32Array &&
            wasmCountsByMapId instanceof Int32Array &&
            wasmReadOff !== (wasmPatchesPacked.length | 0)
        ) {
            throw new Error(
                `[map-render][tick][cpp-wasm] wasm patch read mismatch ` +
                    `readOff=${wasmReadOff | 0} packedLen=${wasmPatchesPacked.length | 0}`,
            );
        }

        const npcGpuFrameData = npcGpuFrameBuilder.flushPacked();
        const packet: FramePacket = buildFramePacketFromMapEntries({
            frameCount: frameCount | 0,
            npcRingWriteIndex: newIndexMod | 0,
            npcGpuFrameData,
            entries,
        });
        return Transfer<FramePacket | undefined>(packet, framePacketTransferables(packet));
    },
    async setVars(values: Int32Array): Promise<void> {
        const workerState = await requireWorkerState();
        workerState.varProvider.set(values);
    },
    async loadCachedMapImages(): Promise<Map<number, string>> {
        const workerState = await requireWorkerState();
        const keys = await workerState.mapImageCache.keys();
        const mapImageUrls = new Map<number, string>();
        const promises: Promise<void>[] = [];
        for (const key of keys) {
            if (key.headers.get("RS-Cache-Name") !== workerState.session.cache.info.name) {
                continue;
            }
            promises.push(initCachedMapImage(workerState.mapImageCache, mapImageUrls, key));
        }
        await Promise.all(promises);
        return mapImageUrls;
    },
    async exportSpritesToZip(): Promise<Blob> {
        const workerState = await requireWorkerState();

        const zip = new JSZip();

        const cacheType = workerState.session.cache.type;

        if (cacheType === CacheType.Dat2) {
            await exportSpritesToZip(workerState.session, zip);
        } else if (cacheType === CacheType.Dat) {
            await exportDatSpritesToZip(workerState.session, zip);
        }

        return zip.generateAsync({ type: "blob" });
    },
    async exportTexturesToZip(): Promise<Blob> {
        const workerState = await requireWorkerState();

        const zip = new JSZip();

        const textureLoader = workerState.session.getTextureLoader();

        const textureSize = 128;

        const textureIds = textureLoader.getTextureIds();
        for (let i = 0; i < textureIds.length; i++) {
            const id = textureIds[i];
            const pixels = textureLoader.tryGetPixelsArgb(id, textureSize, true, 1.0);
            if (!pixels) {
                console.error("Failed to export texture", id);
                continue;
            }

            const canvas = new OffscreenCanvas(textureSize, textureSize);
            const ctx = canvas.getContext("2d");

            if (ctx) {
                const imageData = ctx.createImageData(textureSize, textureSize);

                const rgbaPixels = imageData.data;
                for (let j = 0; j < pixels.length; j++) {
                    rgbaPixels[j * 4 + 0] = (pixels[j] >> 16) & 0xff; // R
                    rgbaPixels[j * 4 + 1] = (pixels[j] >> 8) & 0xff; // G
                    rgbaPixels[j * 4 + 2] = pixels[j] & 0xff; // B
                    rgbaPixels[j * 4 + 3] = (pixels[j] >> 24) & 0xff; // A
                }

                ctx.putImageData(imageData, 0, 0);

                const dataUrl = await offscreenCanvasToPng(canvas);

                const pngData = atob(dataUrl.split(",")[1]);
                zip.file(id + ".png", pngData, { binary: true });
            }
        }

        return zip.generateAsync({ type: "blob" });
    },
};

async function initCachedMapImage(
    mapImageCache: Cache,
    mapImageUrls: Map<number, string>,
    key: Request,
): Promise<void> {
    const resp = await mapImageCache.match(key);
    if (!resp) {
        return;
    }
    const fileName = key.url.slice(key.url.lastIndexOf("/") + 1);
    const split = fileName.replace(".png", "").split("_");
    if (split.length !== 2) {
        return;
    }
    const mapX = parseInt(split[0]);
    const mapY = parseInt(split[1]);

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    mapImageUrls.set(getMapSquareId(mapX, mapY), url);
}

async function offscreenCanvasToPng(canvas: OffscreenCanvas): Promise<string> {
    const blob = await canvas.convertToBlob({ type: "image/png" });

    const reader = new FileReader();

    const dataUrlPromise = new Promise<string>((resolve) => {
        reader.onload = () => {
            resolve(reader.result as string);
        };
    });

    reader.readAsDataURL(blob);

    return await dataUrlPromise;
}

async function addSpritesToZip(zip: JSZip, id: number, sprites: IndexedSprite[]) {
    if (sprites.length > 1) {
        zip = zip.folder(id.toString())!;
    }
    for (let i = 0; i < sprites.length; i++) {
        const sprite = sprites[i];
        sprite.normalize();

        const canvas = sprite.getCanvas();
        const dataUrl = await offscreenCanvasToPng(canvas);

        let fileName = id + ".png";
        if (sprites.length > 1) {
            fileName = i + ".png";
        }

        const pngData = atob(dataUrl.split(",")[1]);
        zip.file(fileName, pngData, { binary: true });
    }
}

async function exportSpritesToZip(session: CacheSession, zip: JSZip): Promise<void> {
    const spriteSource = session.tryGetDat2SpriteSource();
    if (!spriteSource) {
        return;
    }

    const promises: Promise<any>[] = [];

    for (const id of spriteSource.getIds()) {
        const sprites = SpriteLoader.loadIntoIndexedSpritesFromSource(spriteSource, id);
        if (!sprites) {
            continue;
        }
        promises.push(addSpritesToZip(zip, id, sprites));
    }

    await Promise.all(promises);
}

async function exportDatSpritesToZip(session: CacheSession, zip: JSZip): Promise<void> {
    const mediaArchive = session.tryGetDatMediaArchive();
    if (!mediaArchive) {
        return;
    }

    const indexDatId = mediaArchive.tryGetFileId("index.dat");
    if (indexDatId === undefined) {
        return;
    }

    const promises: Promise<any>[] = [];

    const mediaSource = new EnumeratingArchiveBytesProvider(mediaArchive);
    for (const fileId of mediaSource.getIds()) {
        if (fileId === indexDatId) {
            continue;
        }

        const sprites: IndexedSprite[] = [];
        for (let i = 0; i < 256; i++) {
            const sprite = SpriteLoader.tryLoadIndexedSpriteDatId(mediaArchive, fileId, i);
            if (!sprite) {
                break;
            }
            sprites.push(sprite);
        }
        promises.push(addSpritesToZip(zip, fileId, sprites));
    }

    await Promise.all(promises);
}

export type RenderDataWorker = typeof worker;

expose(worker);
