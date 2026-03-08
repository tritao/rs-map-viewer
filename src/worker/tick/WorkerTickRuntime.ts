import type { MapRenderBackend } from "../../maprender/MapRenderBackend";
import type { NpcSpawn } from "../../data/npc/NpcSpawn";
import { NpcSpawnResolver } from "../../data/npc/NpcSpawnResolver";
import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { CacheSession } from "../../rs/loaders/CacheSession";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";
import { Pathfinder } from "../../rs/pathfinder/Pathfinder";
import { Scene } from "../../rs/scene/Scene";
import { LocLoadType, type SceneBuilder } from "../../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../../rs/scene/buildSceneFromMapBytesProvider";
import type { FramePacket } from "../../runtime/contracts/FramePacket";
import {
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
} from "../../runtime/contracts/FramePacket";
import {
    type FramePacketMapEntry,
    buildFramePacketFromMapEntries,
    buildFramePacketMapEntry,
} from "../../runtime/FramePacketBuilder";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../../runtime/contracts/NpcGpuFrame";
import { decodeNpcLifecyclePacket } from "../../runtime/contracts/NpcLifecyclePacket";
import {
    type NpcStateDeltaPacket,
    buildNpcStateDeltaPacketFromEvents,
} from "../../runtime/contracts/NpcStateDeltaPacket";
import type { NpcTypeAnimationEntry } from "../../runtime/contracts/NpcTypeAnimationTable";
import type { LocAnimatedData } from "../../runtime/contracts/LocAnimatedData";
import { NpcGpuFrameBuilder } from "../../runtime/entities/NpcGpuFrameBuilder";
import {
    type ResolvedBootstrapData,
    resolveBootstrapData,
} from "../../runtime/sim/NpcBootstrap";
import type { NpcEvent } from "../../runtime/entities/NpcEvents";
import { applyNpcMovementStep } from "../../runtime/sim/NpcSimMovement";
import { NpcSimStateStore, type NpcSimStateStoreDeps } from "../../runtime/sim/NpcSimStateStore";
import {
    buildTickPatchStreamsForMap,
    readWasmPatchStreamsForMap,
} from "../../runtime/sim/TickPatchStreamsBuilder";
import { LOC_CYCLE_SCALE } from "../../wasm/LocCycle";
import type { MapRenderRuntimeHandle } from "../../wasm/MapRenderRuntimeBridgeAbi";
import { mapRenderRuntimeBridge } from "../../wasm/rs_map_runtime_bridge.mjs";

type TickWorkerState = Readonly<{
    session: CacheSession;
    mapBytesProvider: MapBytesProvider;
    fallbackNpcSpawns: ReadonlyArray<NpcSpawn>;
    sceneBuilder: SceneBuilder;
    // Tick runtime intentionally only sees the tick-safe backend surface.
    // Static map build entrypoints stay outside this layer.
    mapRenderBackend: Readonly<{
        kind: MapRenderBackend["kind"];
        getCppWasmRuntimeHandle?: () => MapRenderRuntimeHandle | undefined;
    }>;
}>;

type TickFrameInputs = Readonly<{
    safeTicksElapsed: number;
    safeClientTicks: number;
    hoveredMapIds: ReadonlySet<number>;
    npcRingWriteIndex: number;
}>;

type TickViewState = Readonly<{
    cameraMapX: number;
    cameraMapY: number;
    lodDistance: number;
}>;

type WasmTickStreams = Readonly<{
    isEnabled: boolean;
    tickPatchCountsByMapId: Int32Array | undefined;
    tickPatchPacked: Int32Array | undefined;
}>;

type WasmTickEmitResult = Readonly<{
    tickPatchCountsByMapId: Int32Array;
    tickPatchPacked: Int32Array;
}>;

type NpcSnapshot = Readonly<{
    mapId: number;
    npcInstanceId: number;
    npcTypeId: number;
    tileX: number;
    tileY: number;
    x: number;
    y: number;
    level: number;
    orientation: number;
    rotation: number;
    movementSeqId: number;
    movementFrame: number;
    movementFrameTick: number;
    movementLoop: number;
    orderKey?: number;
}>;

const tickWasmBridge = mapRenderRuntimeBridge;
const EMPTY_TICK_PATCH_COUNTS = new Int32Array(TICK_PATCH_STREAM_COUNT);
const EMPTY_TICK_PATCH_STREAMS = new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT);

function decodeMapSquareFromId(mapId: number): Readonly<{ mapX: number; mapY: number }> {
    return {
        mapX: (mapId >> 8) & 0xff,
        mapY: mapId & 0xff,
    };
}

function createNpcSimStateStoreDeps(workerState: TickWorkerState): NpcSimStateStoreDeps {
    return {
        npcTypeLoader: workerState.session.loaders.npcTypeLoader as NpcTypeLoader,
        basTypeLoader: workerState.session.loaders.basTypeLoader as BasTypeLoader,
        seqTypeLoader: workerState.session.loaders.seqTypeLoader as SeqTypeLoader,
        tickPatchEntryStride: TICK_PATCH_ENTRY_STRIDE,
    };
}

function isWasmTickEmitResult(value: unknown): value is WasmTickEmitResult {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as Partial<WasmTickEmitResult>;
    return (
        candidate.tickPatchCountsByMapId instanceof Int32Array &&
        candidate.tickPatchPacked instanceof Int32Array
    );
}

export class WorkerMapSimLifecycle {
    private readonly mapSimTokenByMapId = new Map<number, number>();
    private readonly warnedMissingTickStateMapIds = new Set<number>();

    reset(): void {
        this.mapSimTokenByMapId.clear();
        this.warnedMissingTickStateMapIds.clear();
    }

    tryAcceptMapSimToken(mapId: number, mapSimToken: number | undefined): boolean {
        const id = mapId | 0;
        const incoming = mapSimToken === undefined ? 0 : mapSimToken | 0;
        const current = this.mapSimTokenByMapId.get(id) ?? 0;
        if (incoming < current) {
            return false;
        }
        this.mapSimTokenByMapId.set(id, incoming);
        return true;
    }

    clearMissingTickStateWarning(mapId: number): void {
        this.warnedMissingTickStateMapIds.delete(mapId | 0);
    }

    consumeMissingTickStateWarning(mapId: number): boolean {
        const id = mapId | 0;
        if (this.warnedMissingTickStateMapIds.has(id)) {
            return false;
        }
        this.warnedMissingTickStateMapIds.add(id);
        return true;
    }
}

export class WorkerTickRuntime {
    private readonly npcSpawnResolver = new NpcSpawnResolver();
    private readonly npcSimStateStore = new NpcSimStateStore();
    private readonly npcSimPathfinder = new Pathfinder();
    private readonly npcGpuFrameBuilder = new NpcGpuFrameBuilder();
    private readonly workerMapSimLifecycle = new WorkerMapSimLifecycle();
    private readonly warnedEmptyNpcBootstrapMapIds = new Set<number>();
    private readonly npcSnapshotByMapId = new Map<number, Map<number, NpcSnapshot>>();
    private readonly npcSeqByInstanceId = new Map<number, number>();
    private tickMapIds: Int32Array = new Int32Array(0);
    private tickMapIdsVersion: number = 0;
    private tickViewStateVersion: number = 0;
    private tickViewState: TickViewState = {
        cameraMapX: 0,
        cameraMapY: 0,
        lodDistance: 0,
    };
    private tickHoveredMapIdsPacked: Int32Array = new Int32Array(0);

    constructor(private readonly getWorkerState: () => Promise<TickWorkerState>) {}

    resetForCache(): void {
        this.npcSimStateStore.resetForCache();
        this.npcSpawnResolver.reset();
        this.workerMapSimLifecycle.reset();
        this.warnedEmptyNpcBootstrapMapIds.clear();
        this.npcSnapshotByMapId.clear();
        this.npcSeqByInstanceId.clear();
        this.tickMapIds = new Int32Array(0);
        this.tickMapIdsVersion = 0;
        this.tickViewStateVersion = 0;
        this.tickViewState = { cameraMapX: 0, cameraMapY: 0, lodDistance: 0 };
        this.tickHoveredMapIdsPacked = new Int32Array(0);
    }

    resetForLoaderReset(): void {
        this.npcSimStateStore.resetForLoaderReset();
        this.npcSpawnResolver.reset();
        this.workerMapSimLifecycle.reset();
        this.warnedEmptyNpcBootstrapMapIds.clear();
        this.npcSnapshotByMapId.clear();
        this.npcSeqByInstanceId.clear();
        this.tickMapIds = new Int32Array(0);
        this.tickMapIdsVersion = 0;
        this.tickViewStateVersion = 0;
        this.tickViewState = { cameraMapX: 0, cameraMapY: 0, lodDistance: 0 };
        this.tickHoveredMapIdsPacked = new Int32Array(0);
    }

    setTickMapIds(mapIds: Int32Array): void {
        if (!(mapIds instanceof Int32Array) || (mapIds.length | 0) <= 0) {
            this.tickMapIds = new Int32Array(0);
            this.tickMapIdsVersion = (this.tickMapIdsVersion + 1) | 0;
            return;
        }
        this.tickMapIds = Int32Array.from(mapIds);
        this.tickMapIdsVersion = (this.tickMapIdsVersion + 1) | 0;
    }

    setTickViewState(cameraMapX: number, cameraMapY: number, lodDistance: number): void {
        const nextViewState = {
            cameraMapX: cameraMapX | 0,
            cameraMapY: cameraMapY | 0,
            lodDistance: Math.max(0, lodDistance | 0),
        };
        if (
            (this.tickViewState.cameraMapX | 0) !== (nextViewState.cameraMapX | 0) ||
            (this.tickViewState.cameraMapY | 0) !== (nextViewState.cameraMapY | 0) ||
            (this.tickViewState.lodDistance | 0) !== (nextViewState.lodDistance | 0)
        ) {
            this.tickViewStateVersion = (this.tickViewStateVersion + 1) | 0;
            this.tickViewState = nextViewState;
        }
    }

    setTickHoveredMapIds(hoveredMapIdsPacked: Int32Array): void {
        if (!(hoveredMapIdsPacked instanceof Int32Array) || (hoveredMapIdsPacked.length | 0) <= 0) {
            this.tickHoveredMapIdsPacked = new Int32Array(0);
            return;
        }
        this.tickHoveredMapIdsPacked = Int32Array.from(hoveredMapIdsPacked);
    }

    private async resolveNpcBootstrapData(
        workerState: TickWorkerState,
        mapId: number,
        maxLevel: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        npcOrderKeys: Int32Array,
    ): Promise<ResolvedBootstrapData> {
        return resolveBootstrapData(
            this.npcSpawnResolver,
            {
                mapBytesProvider: workerState.mapBytesProvider,
                cacheInfo: workerState.session.cache.info,
                npcTypeLoader: workerState.session.loaders.npcTypeLoader as NpcTypeLoader,
                fallbackNpcSpawns: workerState.fallbackNpcSpawns,
            },
            {
                mapId,
                maxLevel,
                borderSize,
                tileRenderFlagsLevel1,
                npcOrderKeys,
            },
        );
    }

    private buildMapSimScene(
        workerState: TickWorkerState,
        mapId: number,
        borderSize: number,
    ): Scene {
        const { mapX, mapY } = decodeMapSquareFromId(mapId);
        const border = borderSize | 0;
        const mapSize = Scene.MAP_SQUARE_SIZE + border * 2;
        const baseX = mapX * Scene.MAP_SQUARE_SIZE - border;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - border;
        return buildSceneFromMapBytesProvider(
            workerState.sceneBuilder,
            workerState.mapBytesProvider,
            baseX,
            baseY,
            mapSize,
            mapSize,
            false,
            LocLoadType.NO_MODELS,
        );
    }

    private emitNpcBootstrapWarnings(
        mapId: number,
        maxLevel: number,
        borderSize: number,
        resolvedBootstrap: ResolvedBootstrapData,
        deps: NpcSimStateStoreDeps,
    ): void {
        if (this.warnedEmptyNpcBootstrapMapIds.has(mapId | 0)) {
            return;
        }
        const state = this.npcSimStateStore.getMap(mapId | 0);
        const spawnEventCount = resolvedBootstrap.spawnEvents.length | 0;
        const npcCount = state ? state.npcs.length | 0 : 0;
        if (spawnEventCount <= 0) {
            this.warnedEmptyNpcBootstrapMapIds.add(mapId | 0);
            console.warn(
                `[map-render][npc] empty bootstrap for mapId=${mapId | 0} ` +
                    `(source=${resolvedBootstrap.source} maxLevel=${maxLevel | 0} border=${
                        borderSize | 0
                    } decoded=${resolvedBootstrap.decodedSpawnsCount ?? -1} ` +
                    `fallbackKey=${resolvedBootstrap.fallbackCacheKey ?? "n/a"} ` +
                    `fallbackUrl=${resolvedBootstrap.fallbackUrl ?? "n/a"} ` +
                    `fallbackTotal=${resolvedBootstrap.fallbackTotalSpawns ?? -1} ` +
                    `fallbackMap=${resolvedBootstrap.fallbackMapSpawnsCount ?? -1} ` +
                    `fallbackMapAllLvls=${
                        resolvedBootstrap.fallbackMapSpawnsAllLevelsCount ?? -1
                    })`,
            );
            return;
        }
        if (npcCount > 0) {
            return;
        }
        this.warnedEmptyNpcBootstrapMapIds.add(mapId | 0);
        const firstTypeId = resolvedBootstrap.spawnEvents[0]!.npcTypeId | 0;
        const npcTypeOk = deps.npcTypeLoader.tryLoad(firstTypeId).ok ? 1 : 0;
        const npcTypeCount = deps.npcTypeLoader.getCount?.() ?? -1;
        console.warn(
            `[map-render][npc] bootstrap events produced 0 npc instances for mapId=${mapId | 0} ` +
                `(source=${resolvedBootstrap.source} events=${spawnEventCount} firstType=${firstTypeId} ` +
                `npcTypeOk=${npcTypeOk} npcTypeCount=${npcTypeCount | 0})`,
        );
    }

    async registerMapRuntime(
        mapId: number,
        borderSize: number,
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        if (!this.workerMapSimLifecycle.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        const workerState = await this.getWorkerState();
        const simScene = this.buildMapSimScene(workerState, mapId, borderSize);
        const tileRenderFlagsLevel1 = simScene.tileRenderFlags[1] ?? [];
        const deps = createNpcSimStateStoreDeps(workerState);
        this.npcSimStateStore.registerMap(
            {
                mapId,
                borderSize,
                tileRenderFlagsLevel1,
                collisionDatas: simScene.collisionMaps,
                locsAnimated,
                npcTypeAnimationTable,
            },
            deps,
        );
        this.warnedEmptyNpcBootstrapMapIds.delete(mapId | 0);
        this.workerMapSimLifecycle.clearMissingTickStateWarning(mapId);
    }

    async bootstrapMapRuntime(
        mapId: number,
        maxLevel: number,
        npcOrderKeys: Int32Array,
        mapSimToken?: number,
    ): Promise<void> {
        if (!this.workerMapSimLifecycle.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        const state = this.npcSimStateStore.getMap(mapId | 0);
        if (!state) {
            return;
        }
        const workerState = await this.getWorkerState();
        const resolvedBootstrap = await this.resolveNpcBootstrapData(
            workerState,
            mapId,
            maxLevel,
            state.borderSize | 0,
            state.tileRenderFlagsLevel1,
            npcOrderKeys,
        );
        const deps = createNpcSimStateStoreDeps(workerState);
        this.npcSimStateStore.applyMapNpcLifecycleEvents(
            mapId | 0,
            resolvedBootstrap.spawnEvents,
            deps,
            true,
        );
        this.emitNpcBootstrapWarnings(
            mapId | 0,
            maxLevel | 0,
            state.borderSize | 0,
            resolvedBootstrap,
            deps,
        );
        this.workerMapSimLifecycle.clearMissingTickStateWarning(mapId);
    }

    unregisterMapRuntime(mapId: number, mapSimToken?: number): void {
        if (!this.workerMapSimLifecycle.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        const prevSnapshots = this.npcSnapshotByMapId.get(mapId | 0);
        if (prevSnapshots) {
            for (const instanceId of prevSnapshots.keys()) {
                this.npcSeqByInstanceId.delete(instanceId | 0);
            }
        }
        this.npcSnapshotByMapId.delete(mapId | 0);
        this.npcSimStateStore.unregisterMap(mapId);
        this.warnedEmptyNpcBootstrapMapIds.delete(mapId | 0);
        this.workerMapSimLifecycle.clearMissingTickStateWarning(mapId);
    }

    async applyNpcLifecyclePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        const decoded = decodeNpcLifecyclePacket(packet);
        const workerState = await this.getWorkerState();
        const deps = createNpcSimStateStoreDeps(workerState);
        let applied = 0;
        for (const [mapId, events] of decoded.lifecycleEventsByMapId.entries()) {
            applied =
                (applied +
                    (this.npcSimStateStore.applyMapNpcLifecycleEvents(mapId | 0, events, deps) |
                        0)) |
                0;
        }
        return applied | 0;
    }

    private nextNpcSeq(npcInstanceId: number): number {
        const id = npcInstanceId | 0;
        const next = ((this.npcSeqByInstanceId.get(id) ?? 0) + 1) | 0;
        this.npcSeqByInstanceId.set(id, next);
        return next;
    }

    private snapshotNpc(
        mapId: number,
        npc: {
            instanceId?: number;
            npcType: { id: number };
            pathX: ArrayLike<number>;
            pathY: ArrayLike<number>;
            x: number;
            y: number;
            level: number;
            orientation: number;
            rotation: number;
            movementSeqId: number;
            movementFrame: number;
            movementFrameTick: number;
            movementLoop: number;
            orderKey?: number;
        },
    ): NpcSnapshot | undefined {
        const npcInstanceId = npc.instanceId;
        if (npcInstanceId === undefined) {
            return undefined;
        }
        return {
            mapId: mapId | 0,
            npcInstanceId: npcInstanceId | 0,
            npcTypeId: npc.npcType.id | 0,
            tileX: npc.pathX[0] | 0,
            tileY: npc.pathY[0] | 0,
            x: npc.x | 0,
            y: npc.y | 0,
            level: npc.level | 0,
            orientation: npc.orientation | 0,
            rotation: npc.rotation | 0,
            movementSeqId: npc.movementSeqId | 0,
            movementFrame: npc.movementFrame | 0,
            movementFrameTick: npc.movementFrameTick | 0,
            movementLoop: npc.movementLoop | 0,
            orderKey: npc.orderKey !== undefined ? npc.orderKey | 0 : undefined,
        };
    }

    private areNpcSnapshotsEqual(a: NpcSnapshot, b: NpcSnapshot): boolean {
        return (
            (a.mapId | 0) === (b.mapId | 0) &&
            (a.npcInstanceId | 0) === (b.npcInstanceId | 0) &&
            (a.npcTypeId | 0) === (b.npcTypeId | 0) &&
            (a.tileX | 0) === (b.tileX | 0) &&
            (a.tileY | 0) === (b.tileY | 0) &&
            (a.x | 0) === (b.x | 0) &&
            (a.y | 0) === (b.y | 0) &&
            (a.level | 0) === (b.level | 0) &&
            (a.orientation | 0) === (b.orientation | 0) &&
            (a.rotation | 0) === (b.rotation | 0) &&
            (a.movementSeqId | 0) === (b.movementSeqId | 0) &&
            (a.movementFrame | 0) === (b.movementFrame | 0) &&
            (a.movementFrameTick | 0) === (b.movementFrameTick | 0) &&
            (a.movementLoop | 0) === (b.movementLoop | 0) &&
            ((a.orderKey ?? 0) | 0) === ((b.orderKey ?? 0) | 0)
        );
    }

    private collectNpcDeltaEventsForMap(
        mapId: number,
        npcs: ReadonlyArray<{
            instanceId?: number;
            npcType: { id: number };
            pathX: ArrayLike<number>;
            pathY: ArrayLike<number>;
            x: number;
            y: number;
            level: number;
            orientation: number;
            rotation: number;
            movementSeqId: number;
            movementFrame: number;
            movementFrameTick: number;
            movementLoop: number;
            orderKey?: number;
        }>,
        outEvents: NpcEvent[],
    ): number {
        const id = mapId | 0;
        const prevSnapshots = this.npcSnapshotByMapId.get(id) ?? new Map<number, NpcSnapshot>();
        const nextSnapshots = new Map<number, NpcSnapshot>();
        let emitted = 0;

        for (let i = 0; i < npcs.length; i++) {
            const snapshot = this.snapshotNpc(id, npcs[i]!);
            if (!snapshot) {
                continue;
            }
            const instanceId = snapshot.npcInstanceId | 0;
            nextSnapshots.set(instanceId, snapshot);
            const prev = prevSnapshots.get(instanceId);
            if (!prev) {
                outEvents.push({
                    kind: "spawn",
                    mapId: id,
                    npcInstanceId: instanceId,
                    npcTypeId: snapshot.npcTypeId | 0,
                    tileX: snapshot.tileX | 0,
                    tileY: snapshot.tileY | 0,
                    level: snapshot.level | 0,
                    orderKey: snapshot.orderKey,
                });
                emitted = (emitted + 1) | 0;
                continue;
            }
            if (!this.areNpcSnapshotsEqual(prev, snapshot)) {
                outEvents.push({
                    kind: "update",
                    mapId: id,
                    npcInstanceId: instanceId,
                    seq: this.nextNpcSeq(instanceId),
                    delta: {
                        clearServerPath: true,
                        snapTileX: snapshot.tileX | 0,
                        snapTileY: snapshot.tileY | 0,
                        snapWorldX: snapshot.x | 0,
                        snapWorldY: snapshot.y | 0,
                        orientation: snapshot.orientation | 0,
                        rotation: snapshot.rotation | 0,
                        movementSeqId: snapshot.movementSeqId | 0,
                        movementFrame: snapshot.movementFrame | 0,
                        movementFrameTick: snapshot.movementFrameTick | 0,
                        movementLoop: snapshot.movementLoop | 0,
                    },
                });
                emitted = (emitted + 1) | 0;
            }
        }

        for (const [instanceId] of prevSnapshots.entries()) {
            if (nextSnapshots.has(instanceId | 0)) {
                continue;
            }
            outEvents.push({
                kind: "despawn",
                mapId: id,
                npcInstanceId: instanceId | 0,
                seq: this.nextNpcSeq(instanceId | 0),
            });
            this.npcSeqByInstanceId.delete(instanceId | 0);
            emitted = (emitted + 1) | 0;
        }

        this.npcSnapshotByMapId.set(id, nextSnapshots);
        return emitted | 0;
    }

    async tickSim(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        _cycleNow: number,
        hoveredMapIdsPacked?: Int32Array,
    ): Promise<NpcStateDeltaPacket | undefined> {
        const mapIds = this.tickMapIds;
        if (!(mapIds instanceof Int32Array) || mapIds.length === 0) {
            return undefined;
        }
        if (hoveredMapIdsPacked instanceof Int32Array) {
            this.setTickHoveredMapIds(hoveredMapIdsPacked);
        }
        const workerState = await this.getWorkerState();
        const inputs = this.normalizeTickFrameInputs(
            frameCount,
            ticksElapsed,
            clientTicksElapsed,
            this.tickHoveredMapIdsPacked,
        );
        const seqTypeLoader = workerState.session.loaders.seqTypeLoader;
        const seqFrameLoader = workerState.session.loaders.seqFrameLoader;
        const events: NpcEvent[] = [];

        for (let i = 0; i < mapIds.length; i++) {
            const mapId = mapIds[i] | 0;
            const state = this.npcSimStateStore.getMap(mapId);
            if (!state) {
                this.npcSnapshotByMapId.delete(mapId | 0);
                continue;
            }
            applyNpcMovementStep(
                state,
                this.npcSimPathfinder,
                inputs.safeTicksElapsed,
                inputs.safeClientTicks,
                seqTypeLoader,
                seqFrameLoader,
            );
            this.collectNpcDeltaEventsForMap(mapId, state.npcs, events);
        }

        return buildNpcStateDeltaPacketFromEvents({
            frameCount: frameCount | 0,
            tickMapIdsVersion: this.tickMapIdsVersion | 0,
            tickViewStateVersion: this.tickViewStateVersion | 0,
            events,
        });
    }

    private normalizeTickFrameInputs(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        hoveredMapIdsPacked: Int32Array,
    ): TickFrameInputs {
        const hoveredMapIds = new Set<number>();
        if (hoveredMapIdsPacked instanceof Int32Array) {
            for (let index = 0; index < hoveredMapIdsPacked.length; index++) {
                hoveredMapIds.add(hoveredMapIdsPacked[index] | 0);
            }
        }
        return {
            safeTicksElapsed: Math.max(0, Math.min(ticksElapsed | 0, 4)),
            safeClientTicks: Math.max(0, Math.min(clientTicksElapsed | 0, 50)),
            hoveredMapIds,
            npcRingWriteIndex: (frameCount | 0) % NPC_DATA_TEXTURE_RING_SIZE,
        };
    }

    private async runWasmTickIfEnabled(
        workerState: TickWorkerState,
        mapIds: Int32Array,
        cycleNow: number,
        safeClientTicks: number,
    ): Promise<WasmTickStreams> {
        const isEnabled =
            workerState.mapRenderBackend.kind === "cpp-wasm" &&
            typeof tickWasmBridge.tickMapsEmitPatchStreams === "function";
        if (!isEnabled) {
            return {
                isEnabled: false,
                tickPatchCountsByMapId: undefined,
                tickPatchPacked: undefined,
            };
        }

        const handle = workerState.mapRenderBackend.getCppWasmRuntimeHandle?.();
        if (handle === undefined) {
            throw new Error("[map-render][tick][cpp-wasm] map-render runtime handle missing");
        }
        const cycleNowFixed = Math.round(cycleNow * LOC_CYCLE_SCALE) | 0;
        const wasmTickValue = tickWasmBridge.tickMapsEmitPatchStreams?.(
            handle,
            mapIds,
            cycleNowFixed,
            safeClientTicks,
        );
        if (!isWasmTickEmitResult(wasmTickValue)) {
            throw new Error(
                "[map-render][tick][cpp-wasm] tickMapsEmitPatchStreams returned invalid data",
            );
        }
        return {
            isEnabled: true,
            tickPatchCountsByMapId: wasmTickValue.tickPatchCountsByMapId,
            tickPatchPacked: wasmTickValue.tickPatchPacked,
        };
    }

    private buildMissingStateMapEntry(
        mapId: number,
        mapEntryIndex: number,
        cameraMapX: number,
        cameraMapY: number,
        safeLodDistance: number,
        hoveredMapIds: ReadonlySet<number>,
        backendKind: string,
    ): FramePacketMapEntry {
        if (this.workerMapSimLifecycle.consumeMissingTickStateWarning(mapId)) {
            const { mapX, mapY } = decodeMapSquareFromId(mapId);
            console.warn(
                `[map-render][tick] missing worker sim state for visible map ${mapX},${mapY} ` +
                    `(mapId=${mapId | 0} index=${mapEntryIndex | 0} backend=${backendKind})`,
            );
        }
        return buildFramePacketMapEntry({
            mapId,
            cameraMapX,
            cameraMapY,
            lodDistance: safeLodDistance,
            hoveredMapIds,
            npcRangeStart: 0,
            npcRangeCount: 0,
            tickPatchCounts: EMPTY_TICK_PATCH_COUNTS,
            tickPatchStreams: EMPTY_TICK_PATCH_STREAMS,
        });
    }

    private validateWasmPatchRead(
        wasmReadOff: number,
        tickPatchCountsByMapId: Int32Array | undefined,
        tickPatchPacked: Int32Array | undefined,
    ): void {
        if (
            tickPatchPacked instanceof Int32Array &&
            tickPatchCountsByMapId instanceof Int32Array &&
            wasmReadOff !== (tickPatchPacked.length | 0)
        ) {
            throw new Error(
                `[map-render][tick][cpp-wasm] wasm patch read mismatch ` +
                    `readOff=${wasmReadOff | 0} packedLen=${tickPatchPacked.length | 0}`,
            );
        }
    }

    private async buildFramePacketInternal(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
        advanceNpcSim: boolean,
        hoveredMapIdsPacked?: Int32Array,
    ): Promise<FramePacket | undefined> {
        const mapIds = this.tickMapIds;
        if (!(mapIds instanceof Int32Array) || mapIds.length === 0) {
            return undefined;
        }
        if (hoveredMapIdsPacked instanceof Int32Array) {
            this.setTickHoveredMapIds(hoveredMapIdsPacked);
        }

        const workerState = await this.getWorkerState();
        const backendKind = workerState.mapRenderBackend.kind ?? "unknown";
        const inputs = this.normalizeTickFrameInputs(
            frameCount,
            ticksElapsed,
            clientTicksElapsed,
            this.tickHoveredMapIdsPacked,
        );
        const view = this.tickViewState;
        const wasmTick = await this.runWasmTickIfEnabled(
            workerState,
            mapIds,
            cycleNow,
            inputs.safeClientTicks,
        );
        const seqTypeLoader = workerState.session.loaders.seqTypeLoader;
        const seqFrameLoader = workerState.session.loaders.seqFrameLoader;
        this.npcGpuFrameBuilder.beginFrame();
        const entries = new Array<FramePacketMapEntry>(mapIds.length | 0);
        const wasmCountsByMapId = wasmTick.tickPatchCountsByMapId;
        const wasmPatchesPacked = wasmTick.tickPatchPacked;

        let wasmReadOff = 0;
        for (let mapEntryIndex = 0; mapEntryIndex < mapIds.length; mapEntryIndex++) {
            const mapId = mapIds[mapEntryIndex] | 0;
            const state = this.npcSimStateStore.getMap(mapId);
            const wasmPatchRead = readWasmPatchStreamsForMap(
                mapId,
                mapEntryIndex,
                wasmReadOff,
                wasmCountsByMapId,
                wasmPatchesPacked,
            );
            wasmReadOff = wasmPatchRead.nextReadOff | 0;
            if (!state) {
                entries[mapEntryIndex] = this.buildMissingStateMapEntry(
                    mapId,
                    mapEntryIndex,
                    view.cameraMapX | 0,
                    view.cameraMapY | 0,
                    view.lodDistance | 0,
                    inputs.hoveredMapIds,
                    backendKind,
                );
                continue;
            }
            if (advanceNpcSim) {
                applyNpcMovementStep(
                    state,
                    this.npcSimPathfinder,
                    inputs.safeTicksElapsed,
                    inputs.safeClientTicks,
                    seqTypeLoader,
                    seqFrameLoader,
                );
            }

            const npcRange = this.npcGpuFrameBuilder.addMapNpcs(
                state.npcs,
                state.borderSize,
                state.tileRenderFlagsLevel1,
            );

            const tickPatchesForMap = buildTickPatchStreamsForMap({
                mapId,
                mapEntryIndex,
                cycleNow,
                state,
                seqFrameLoader,
                includeTsLocTickPatches: !wasmTick.isEnabled,
                useWasmLocStreams: wasmPatchRead.useWasmLocStreams,
                hasWasmCountsForMap: wasmPatchRead.hasWasmCountsForMap,
                wasmLocStreamsForMap: wasmPatchRead.streamsForMap,
                wasmCountsByMapId,
            });
            entries[mapEntryIndex] = buildFramePacketMapEntry({
                mapId,
                cameraMapX: view.cameraMapX | 0,
                cameraMapY: view.cameraMapY | 0,
                lodDistance: view.lodDistance | 0,
                hoveredMapIds: inputs.hoveredMapIds,
                npcRangeStart: npcRange.start | 0,
                npcRangeCount: npcRange.count | 0,
                tickPatchCounts: tickPatchesForMap.streamCounts,
                tickPatchStreams: tickPatchesForMap.streamsForMap,
            });
        }
        this.validateWasmPatchRead(wasmReadOff, wasmCountsByMapId, wasmPatchesPacked);

        const npcGpuFrameData = this.npcGpuFrameBuilder.flushPacked();
        return buildFramePacketFromMapEntries({
            frameCount: frameCount | 0,
            tickMapIdsVersion: this.tickMapIdsVersion | 0,
            tickViewStateVersion: this.tickViewStateVersion | 0,
            npcRingWriteIndex: inputs.npcRingWriteIndex | 0,
            npcGpuFrameData,
            entries,
        });
    }

    async buildFramePacketFromCurrentState(
        frameCount: number,
        cycleNow: number,
        hoveredMapIdsPacked?: Int32Array,
    ): Promise<FramePacket | undefined> {
        return this.buildFramePacketInternal(
            frameCount,
            0,
            0,
            cycleNow,
            false,
            hoveredMapIdsPacked,
        );
    }

    async tickFrame(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
        hoveredMapIdsPacked?: Int32Array,
    ): Promise<FramePacket | undefined> {
        return this.buildFramePacketInternal(
            frameCount,
            ticksElapsed,
            clientTicksElapsed,
            cycleNow,
            true,
            hoveredMapIdsPacked,
        );
    }
}
