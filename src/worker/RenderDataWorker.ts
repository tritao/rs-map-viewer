import JSZip from "jszip";
import { TransferDescriptor } from "threads";
import { registerSerializer } from "threads";
import { Transfer, expose } from "threads/worker";

import { NpcSpawn } from "../data/npc/NpcSpawn";
import { ObjSpawn } from "../data/obj/ObjSpawn";
import { type DrawRange, NULL_DRAW_RANGE } from "../renderer/DrawRange";
import { LocAnimated } from "../renderer/loc/LocAnimated";
import type { LocAnimatedData } from "../renderer/loc/LocAnimatedData";
import { Npc } from "../renderer/npc/Npc";
import type { NpcData } from "../renderer/npc/NpcData";
import { NPC_DATA_TEXTURE_RING_SIZE, type NpcGpuDataTarget } from "../renderer/npc/NpcGpuData";
import { NpcGpuDataBuilder } from "../renderer/npc/NpcGpuDataBuilder";
import { orderByPacketKeys } from "../renderer/npc/orderByPacketKeys";
import type { FramePacket } from "../renderer/packet/FramePacket";
import {
    buildFramePacket,
    createTickPatchStreamsByMap,
    FRAME_RENDER_LIST_FLAG_HAS_NPCS,
    FRAME_RENDER_LIST_FLAG_IS_INTERACT,
    FRAME_RENDER_LIST_FLAG_IS_LOD,
    FRAME_RENDER_LIST_STRIDE,
    NPC_OFFSETS_BY_MAP_ID_STRIDE,
    TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE,
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
    framePacketTransferables,
} from "../renderer/packet/FramePacket";
import { CacheType } from "../rs/cache/CacheType";
import { JSCompressionHandler } from "../rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../rs/config/vartype/VarProvider";
import { EnumeratingArchiveBytesProvider } from "../rs/io/BytesProvider";
import { CacheSession, tryCreateCacheSession } from "../rs/loaders/CacheSession";
import { initErrorToString } from "../rs/loaders/InitError";
import { MapBytesProvider, MapFileBytesProvider } from "../rs/map/MapBytesProvider";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import { CollisionFlag } from "../rs/pathfinder/flag/CollisionFlag";
import { MapImageRenderer } from "../rs/render/minimap/MapImageRenderer";
import { type CollisionData, CollisionMap } from "../rs/scene/CollisionMap";
import { Scene } from "../rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../rs/scene/buildSceneFromMapBytesProvider";
import { LocModelLoader } from "../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../rs/scene/model/ObjModelLoader";
import { IndexedSprite } from "../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../rs/sprite/SpriteLoader";
import type { BackendKind } from "../util/BackendKind";
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
    // Allows isolating tick/patch issues from map-build issues.
    // If unset, tick behavior follows mapRenderBackend.
    mapRenderTickBackend?: BackendKind;
    mapRenderTelemetry?: boolean;
    // Experimental: run NPC movement sim + GPU packing in the worker, emitting per-frame packets.
    mapRenderNpcSimInWorker?: boolean;
}>;

let workerStatePromise: Promise<WorkerStateInit> | undefined;

type MapNpcSimState = {
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    collisionMaps: CollisionMap[];
    seededNpcFlags: boolean;
    npcs: Npc[];
    locsAnimated: LocAnimated[];

    // Tick patch scratch buffers (per-map) to avoid per-frame allocations.
    locTickPatchesByVariant: Int32Array[]; // 8 variants
    locTickPatchCountsByVariant: Int32Array; // length 8
    npcTickPatchesByVariant: Int32Array[]; // 2 variants (base/alpha)
    npcTickPatchCountsByVariant: Int32Array; // length 2
};

const npcSimByMapId = new Map<number, MapNpcSimState>();
const npcSimPathfinder = new Pathfinder();
const npcGpuDataBuilder = new NpcGpuDataBuilder();
const tickWasmBridge = mapRenderRuntimeBridge as unknown as MapRenderRuntimeBridgeV2;
let workerRuntimeOptions: WorkerRuntimeOptions | undefined;

function shouldUseWasmTickInWorker(): boolean {
    if (!workerRuntimeOptions?.mapRenderNpcSimInWorker) {
        return false;
    }
    const tickBackend =
        workerRuntimeOptions.mapRenderTickBackend ?? workerRuntimeOptions.mapRenderBackend;
    // Runtime-owned tick state requires that map builds also happen in the same C++ wasm runtime.
    return tickBackend === "cpp-wasm" && workerRuntimeOptions.mapRenderBackend === "cpp-wasm";
}

function emitTickPatch(
    outPacked: Int32Array,
    count: number,
    drawRangeIndex: number,
    frame: DrawRange,
): number {
    if ((drawRangeIndex | 0) < 0) {
        return count | 0;
    }
    const off = ((count | 0) * TICK_PATCH_ENTRY_STRIDE) | 0;
    if (off + 3 >= outPacked.length) {
        return count | 0;
    }
    outPacked[off + 0] = drawRangeIndex | 0;
    outPacked[off + 1] = frame[0] | 0;
    outPacked[off + 2] = frame[1] | 0;
    outPacked[off + 3] = frame[2] | 0;
    return (count + 1) | 0;
}

function emitLocPatchesForChangedFrame(
    state: MapNpcSimState,
    locIndex: number,
    newFrameId: number,
) {
    const loc = state.locsAnimated[locIndex];
    const baseFrame = (loc.anim.frames?.[newFrameId] ?? undefined) as DrawRange | undefined;
    if (!baseFrame) {
        return;
    }
    const alphaFrame = (loc.anim.framesAlpha?.[newFrameId] ?? undefined) as DrawRange | undefined;

    // Loc streams: 0..7 match LocTickPatchVariant ordering.
    state.locTickPatchCountsByVariant[0] = emitTickPatch(
        state.locTickPatchesByVariant[0]!,
        state.locTickPatchCountsByVariant[0] | 0,
        loc.drawRangeIndex | 0,
        baseFrame,
    );
    state.locTickPatchCountsByVariant[2] = emitTickPatch(
        state.locTickPatchesByVariant[2]!,
        state.locTickPatchCountsByVariant[2] | 0,
        loc.drawRangeLodIndex | 0,
        baseFrame,
    );
    state.locTickPatchCountsByVariant[4] = emitTickPatch(
        state.locTickPatchesByVariant[4]!,
        state.locTickPatchCountsByVariant[4] | 0,
        loc.drawRangeInteractIndex | 0,
        baseFrame,
    );
    state.locTickPatchCountsByVariant[6] = emitTickPatch(
        state.locTickPatchesByVariant[6]!,
        state.locTickPatchCountsByVariant[6] | 0,
        loc.drawRangeInteractLodIndex | 0,
        baseFrame,
    );

    if (!alphaFrame) {
        return;
    }
    state.locTickPatchCountsByVariant[1] = emitTickPatch(
        state.locTickPatchesByVariant[1]!,
        state.locTickPatchCountsByVariant[1] | 0,
        loc.drawRangeAlphaIndex | 0,
        alphaFrame,
    );
    state.locTickPatchCountsByVariant[3] = emitTickPatch(
        state.locTickPatchesByVariant[3]!,
        state.locTickPatchCountsByVariant[3] | 0,
        loc.drawRangeLodAlphaIndex | 0,
        alphaFrame,
    );
    state.locTickPatchCountsByVariant[5] = emitTickPatch(
        state.locTickPatchesByVariant[5]!,
        state.locTickPatchCountsByVariant[5] | 0,
        loc.drawRangeInteractAlphaIndex | 0,
        alphaFrame,
    );
    state.locTickPatchCountsByVariant[7] = emitTickPatch(
        state.locTickPatchesByVariant[7]!,
        state.locTickPatchCountsByVariant[7] | 0,
        loc.drawRangeInteractLodAlphaIndex | 0,
        alphaFrame,
    );
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
        npcSimByMapId.clear();
        // Make initCache awaitable so callers can block until the worker is fully ready.
        await requireWorkerState();
    },
    initDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.init();
    },
    async resetDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.reset();
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
        npcsIn: NpcData[],
        npcOrderKeys?: Int32Array,
    ): Promise<void> {
        const workerState = await requireWorkerState();
        const npcTypeLoader = workerState.session.loaders.npcTypeLoader;
        const basTypeLoader = workerState.session.loaders.basTypeLoader;
        const seqTypeLoader = workerState.session.loaders.seqTypeLoader;
        const seqFrameLoader = workerState.session.loaders.seqFrameLoader;

        const collisionMaps = collisionDatas.map(CollisionMap.fromData);

        const ordered = orderByPacketKeys(npcsIn, npcOrderKeys);
        const npcs: Npc[] = [];
        for (const init of ordered) {
            const npcTypeResult = npcTypeLoader.tryLoad(init.id);
            if (!npcTypeResult.ok) {
                continue;
            }
            const npcType = npcTypeResult.value;
            const idleSeqId = npcType.getIdleSeqId(basTypeLoader);
            const walkSeqId = npcType.getWalkSeqId(basTypeLoader);
            npcs.push(
                new Npc(
                    init.tileX | 0,
                    init.tileY | 0,
                    init.level | 0,
                    init.idleAnim,
                    init.walkAnim,
                    npcType,
                    idleSeqId | 0,
                    walkSeqId | 0,
                ),
            );
        }

        const cycleNow = 0;
        const locs: LocAnimated[] = [];
        for (const loc of locsAnimated) {
            const seqResult = seqTypeLoader.tryLoad(loc.seqId);
            if (!seqResult.ok) {
                continue;
            }
            const seqType = seqResult.value;
            locs.push(
                new LocAnimated(
                    loc.drawRangeIndex | 0,
                    loc.drawRangeAlphaIndex | 0,
                    loc.drawRangeLodIndex | 0,
                    loc.drawRangeLodAlphaIndex | 0,
                    loc.drawRangeInteractIndex | 0,
                    loc.drawRangeInteractAlphaIndex | 0,
                    loc.drawRangeInteractLodIndex | 0,
                    loc.drawRangeInteractLodAlphaIndex | 0,
                    loc.anim,
                    seqType,
                    cycleNow,
                    !!loc.randomStart,
                ),
            );
        }

        const locCount = locs.length | 0;
        const locTickPatchesByVariant: Int32Array[] = [];
        for (let i = 0; i < 8; i++) {
            locTickPatchesByVariant.push(new Int32Array(locCount * TICK_PATCH_ENTRY_STRIDE));
        }
        const npcCount = npcs.length | 0;
        const npcTickPatchesByVariant: Int32Array[] = [
            new Int32Array(npcCount * TICK_PATCH_ENTRY_STRIDE),
            new Int32Array(npcCount * TICK_PATCH_ENTRY_STRIDE),
        ];

        npcSimByMapId.set(mapId | 0, {
            borderSize: borderSize | 0,
            tileRenderFlagsLevel1,
            collisionMaps,
            seededNpcFlags: false,
            npcs,
            locsAnimated: locs,
            locTickPatchesByVariant,
            locTickPatchCountsByVariant: new Int32Array(8),
            npcTickPatchesByVariant,
            npcTickPatchCountsByVariant: new Int32Array(2),
        });
    },
    unregisterMapNpcSimState(mapId: number): void {
        npcSimByMapId.delete(mapId | 0);
        // Tick state is owned by the map-render runtime (C++). Do not mirror/clear it from TS here.
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

        npcGpuDataBuilder.beginFrame();

        const offsetsPairs = new Int32Array((mapIds.length | 0) * NPC_OFFSETS_BY_MAP_ID_STRIDE);
        const renderListPacked = new Int32Array((mapIds.length | 0) * FRAME_RENDER_LIST_STRIDE);
        const tickPatchCountsByMapId = new Int32Array(
            (mapIds.length | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE,
        );
        const tickPatchStreamsByMap = createTickPatchStreamsByMap(mapIds.length | 0);

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
            const state = npcSimByMapId.get(mapId);
            const metaOff = (mi | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE;
            const renderOff = (mi | 0) * FRAME_RENDER_LIST_STRIDE;
            const streamsForMap = tickPatchStreamsByMap[mi]!;
            const wasmStreamsForMap = new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT);
            let hasWasmCountsForMap = false;
            let useWasmLocStreams = false;
            if (
                wasmPatchesPacked instanceof Int32Array &&
                wasmCountsByMapId instanceof Int32Array &&
                metaOff + TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE <= wasmCountsByMapId.length
            ) {
                hasWasmCountsForMap = true;
                useWasmLocStreams = (wasmCountsByMapId[metaOff + 0] | 0) === (mapId | 0);
                for (let streamIndex = 0; streamIndex < TICK_PATCH_STREAM_COUNT; streamIndex++) {
                    const wasmCount = wasmCountsByMapId[metaOff + 1 + streamIndex] | 0;
                    const wasmLen = (wasmCount * TICK_PATCH_ENTRY_STRIDE) | 0;
                    if (wasmLen > 0) {
                        const end = (wasmReadOff + wasmLen) | 0;
                        if (end > (wasmPatchesPacked.length | 0)) {
                            throw new Error(
                                `[map-render][tick][cpp-wasm] wasm patch stream OOB ` +
                                    `mapId=${mapId | 0} stream=${streamIndex | 0} readOff=${
                                        wasmReadOff | 0
                                    } len=${wasmLen | 0} ` +
                                    `packedLen=${wasmPatchesPacked.length | 0}`,
                            );
                        }
                        if (useWasmLocStreams) {
                            wasmStreamsForMap[streamIndex] = wasmPatchesPacked.subarray(
                                wasmReadOff,
                                end,
                            );
                        }
                        wasmReadOff = end;
                    }
                }
            }
            const mapX = mapId >> 8;
            const mapY = mapId & 0xff;
            const mapDistance = Math.max(
                Math.abs((cameraMapX | 0) - (mapX | 0)),
                Math.abs((cameraMapY | 0) - (mapY | 0)),
            );
            let renderFlags =
                mapDistance >= safeLodDistance ? FRAME_RENDER_LIST_FLAG_IS_LOD : 0;
            if (hoveredMapIds.has(mapId | 0)) {
                renderFlags |= FRAME_RENDER_LIST_FLAG_IS_INTERACT;
            }
            tickPatchCountsByMapId[metaOff + 0] = mapId | 0;
            renderListPacked[renderOff + 0] = mapId | 0;
            if (!state) {
                renderListPacked[renderOff + 1] = renderFlags | 0;
                offsetsPairs[mi * 2 + 0] = mapId;
                offsetsPairs[mi * 2 + 1] = -1;
                for (let s = 0; s < TICK_PATCH_STREAM_COUNT; s++) {
                    tickPatchCountsByMapId[metaOff + 1 + s] = 0;
                    streamsForMap[s] = undefined;
                }
                continue;
            }
            if ((state.npcs.length | 0) > 0) {
                renderFlags |= FRAME_RENDER_LIST_FLAG_HAS_NPCS;
            }
            renderListPacked[renderOff + 1] = renderFlags | 0;

            // Seed NPC collision flags once per map so pathfinding avoids NPC overlaps.
            if (!state.seededNpcFlags) {
                for (const npc of state.npcs) {
                    const level = npc.level | 0;
                    const collisionMap = state.collisionMaps[level];
                    if (!collisionMap) {
                        continue;
                    }
                    const currentX = npc.pathX[0] | 0;
                    const currentY = npc.pathY[0] | 0;
                    const size = npc.getSize() | 0;
                    for (let fx = currentX; fx < currentX + size; fx++) {
                        for (let fy = currentY; fy < currentY + size; fy++) {
                            collisionMap.flag(
                                (fx + state.borderSize) | 0,
                                (fy + state.borderSize) | 0,
                                CollisionFlag.BLOCK_NPCS,
                            );
                        }
                    }
                }
                state.seededNpcFlags = true;
            }

            // Server movement: update paths with collision constraints.
            for (let t = 0; t < safeTicksElapsed; t++) {
                for (const npc of state.npcs) {
                    npc.updateServerMovement(
                        npcSimPathfinder,
                        state.borderSize,
                        state.collisionMaps,
                    );
                }
            }

            // Client movement transforms: advance along the server-selected path.
            for (let t = 0; t < safeClientTicks; t++) {
                for (const npc of state.npcs) {
                    npc.updateMovementTransformOnly();
                }
            }

            // Client movement seq: advance animation frames without changing transforms.
            for (let t = 0; t < safeClientTicks; t++) {
                for (const npc of state.npcs) {
                    npc.updateMovementSeq(seqTypeLoader, seqFrameLoader);
                }
            }

            const npcCount = state.npcs.length | 0;

            // Build packed NPC gpu info (x,y,rotationAndPlane,typeId) and per-map offset.
            const target: NpcGpuDataTarget = {
                id: mapId | 0,
                npcs: state.npcs,
                getTileRenderFlag: (_level: number, tileX: number, tileY: number): number => {
                    const col = state.tileRenderFlagsLevel1[(tileX + state.borderSize) | 0];
                    return col ? col[(tileY + state.borderSize) | 0] | 0 : 0;
                },
            };
            const npcOffset = npcGpuDataBuilder.addRenderable(target);

            offsetsPairs[mi * 2 + 0] = mapId;
            offsetsPairs[mi * 2 + 1] = npcOffset | 0;

            // Build draw-range tick patches (locs: changed frames only; npcs: emit per npc).
            state.locTickPatchCountsByVariant.fill(0);
            state.npcTickPatchCountsByVariant[0] = 0;
            state.npcTickPatchCountsByVariant[1] = 0;

            if (!wasmTick) {
                for (let li = 0; li < state.locsAnimated.length; li++) {
                    const loc = state.locsAnimated[li];
                    loc.update(seqFrameLoader, cycleNow);
                    const newFrameId = loc.frame | 0;
                    // Always emit a patch for the current frame. Some map packets may have placeholder
                    // draw ranges for animated locs until the first tick patch is applied.
                    emitLocPatchesForChangedFrame(state, li, newFrameId);
                }
            }

            for (let ni = 0; ni < npcCount; ni++) {
                const npc = state.npcs[ni]!;
                const newFrameId = npc.movementFrame | 0;
                const anim = npc.getAnimationFrames();
                const baseFrame = (anim?.frames?.[newFrameId] ?? NULL_DRAW_RANGE) as DrawRange;
                const alphaFrame = (anim?.framesAlpha?.[newFrameId] ??
                    NULL_DRAW_RANGE) as DrawRange;
                state.npcTickPatchCountsByVariant[0] = emitTickPatch(
                    state.npcTickPatchesByVariant[0]!,
                    state.npcTickPatchCountsByVariant[0] | 0,
                    ni | 0,
                    baseFrame,
                );
                state.npcTickPatchCountsByVariant[1] = emitTickPatch(
                    state.npcTickPatchesByVariant[1]!,
                    state.npcTickPatchCountsByVariant[1] | 0,
                    ni | 0,
                    alphaFrame,
                );
            }

            // Write per-map patch counts meta in stream order.
            if (wasmCountsByMapId instanceof Int32Array) {
                const wasmMetaOff = (mi | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE;
                if (wasmMetaOff + TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE <= wasmCountsByMapId.length) {
                    const wasmMapId = wasmCountsByMapId[wasmMetaOff + 0] | 0;
                    if (wasmMapId === (mapId | 0)) {
                        for (let v = 0; v < 8; v++) {
                            tickPatchCountsByMapId[metaOff + 1 + v] =
                                wasmCountsByMapId[wasmMetaOff + 1 + v] | 0;
                        }
                    } else {
                        for (let v = 0; v < 8; v++) {
                            tickPatchCountsByMapId[metaOff + 1 + v] =
                                state.locTickPatchCountsByVariant[v] | 0;
                        }
                    }
                } else {
                    for (let v = 0; v < 8; v++) {
                        tickPatchCountsByMapId[metaOff + 1 + v] =
                            state.locTickPatchCountsByVariant[v] | 0;
                    }
                }
            } else {
                for (let v = 0; v < 8; v++) {
                    tickPatchCountsByMapId[metaOff + 1 + v] =
                        state.locTickPatchCountsByVariant[v] | 0;
                }
            }
            tickPatchCountsByMapId[metaOff + 1 + 8] = state.npcTickPatchCountsByVariant[0] | 0;
            tickPatchCountsByMapId[metaOff + 1 + 9] = state.npcTickPatchCountsByVariant[1] | 0;

            for (let v = 0; v < 8; v++) {
                streamsForMap[v] =
                    useWasmLocStreams && hasWasmCountsForMap
                        ? wasmStreamsForMap[v]
                        : state.locTickPatchesByVariant[v];
            }
            streamsForMap[8] = state.npcTickPatchesByVariant[0];
            streamsForMap[9] = state.npcTickPatchesByVariant[1];

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

        const npcGpuFrameData = npcGpuDataBuilder.flushPacked();
        const packet: FramePacket = buildFramePacket({
            frameCount: frameCount | 0,
            npcRingWriteIndex: newIndexMod | 0,
            npcGpuFrameData,
            npcOffsetsByMapIdPairs: offsetsPairs,
            renderListPacked,
            tickPatchCountsByMapId,
            tickPatchStreamsByMap,
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
