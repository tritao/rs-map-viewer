import type { NpcSpawn } from "../data/npc/NpcSpawn";
import { NpcSpawnResolver } from "../data/npc/NpcSpawnResolver";
import type { BasTypeLoader } from "../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import type { CacheSession } from "../rs/loaders/CacheSession";
import type { MapBytesProvider } from "../rs/map/MapBytesProvider";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import { Scene } from "../rs/scene/Scene";
import { LocLoadType, type SceneBuilder } from "../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../rs/scene/buildSceneFromMapBytesProvider";
import { decodeNpcLifecyclePacket } from "../runtime/packets/NpcLifecyclePacket";
import {
    type WorldDeltaPacket,
    buildWorldDeltaPacketFromNpcLifecycleEvents,
} from "../runtime/packets/WorldDeltaPacket";
import {
    type ResolvedBootstrapData,
    resolveBootstrapData,
} from "../runtime/sim/NpcBootstrap";
import type { NpcEvent } from "../runtime/entities/NpcEvents";
import { applyNpcMovementStep } from "../runtime/sim/NpcSimMovement";
import { NpcSimStateStore, type NpcSimStateStoreDeps } from "../runtime/sim/NpcSimStateStore";
import { WorkerMapRuntimeTracker } from "./WorkerContext";
import type {
    MapRuntimeBootstrapInput,
    SimMapRuntimeRegistrationInput,
    WorkerViewState,
    WorldInputUpdate,
} from "./WorkerContext";

type TickWorkerState = Readonly<{
    session: CacheSession;
    mapBytesProvider: MapBytesProvider;
    fallbackNpcSpawns: ReadonlyArray<NpcSpawn>;
    sceneBuilder: SceneBuilder;
}>;

type WorldStepInputs = Readonly<{
    safeTicksElapsed: number;
    safeClientTicks: number;
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
        tickPatchEntryStride: 4,
    };
}

export class WorkerTickRuntime {
    private readonly npcSpawnResolver = new NpcSpawnResolver();
    private readonly npcSimStateStore = new NpcSimStateStore();
    private readonly npcSimPathfinder = new Pathfinder();
    private readonly workerMapRuntimeTracker = new WorkerMapRuntimeTracker();
    private readonly warnedEmptyNpcBootstrapMapIds = new Set<number>();
    private readonly npcSnapshotByMapId = new Map<number, Map<number, NpcSnapshot>>();
    private readonly npcSeqByInstanceId = new Map<number, number>();
    private visibleMapIds: Int32Array = new Int32Array(0);
    private inputStateVersion: number = 0;
    private viewState: WorkerViewState = {
        cameraMapX: 0,
        cameraMapY: 0,
        lodDistance: 0,
    };
    constructor(private readonly getWorkerState: () => Promise<TickWorkerState>) {}

    resetForCache(): void {
        this.resetState(() => this.npcSimStateStore.resetForCache());
    }

    resetForLoaderReset(): void {
        this.resetState(() => this.npcSimStateStore.resetForLoaderReset());
    }

    private resetState(resetNpcStateStore: () => void): void {
        resetNpcStateStore();
        this.npcSpawnResolver.reset();
        this.workerMapRuntimeTracker.reset();
        this.warnedEmptyNpcBootstrapMapIds.clear();
        this.npcSnapshotByMapId.clear();
        this.npcSeqByInstanceId.clear();
        this.visibleMapIds = new Int32Array(0);
        this.inputStateVersion = 0;
        this.viewState = { cameraMapX: 0, cameraMapY: 0, lodDistance: 0 };
    }

    applyWorldInputUpdate(update: WorldInputUpdate): void {
        if (update.mapIds !== undefined) {
            this.setVisibleMapIds(update.mapIds);
        }
        if (update.viewState !== undefined) {
            this.setViewState(update.viewState);
        }
    }

    private setVisibleMapIds(mapIds: Int32Array): void {
        if ((mapIds.length | 0) <= 0) {
            this.visibleMapIds = new Int32Array(0);
            this.inputStateVersion = (this.inputStateVersion + 1) | 0;
            return;
        }
        this.visibleMapIds = Int32Array.from(mapIds);
        this.inputStateVersion = (this.inputStateVersion + 1) | 0;
    }

    private setViewState(viewState: WorkerViewState): void {
        const nextViewState = {
            cameraMapX: viewState.cameraMapX | 0,
            cameraMapY: viewState.cameraMapY | 0,
            lodDistance: Math.max(0, viewState.lodDistance | 0),
        };
        if (
            (this.viewState.cameraMapX | 0) !== (nextViewState.cameraMapX | 0) ||
            (this.viewState.cameraMapY | 0) !== (nextViewState.cameraMapY | 0) ||
            (this.viewState.lodDistance | 0) !== (nextViewState.lodDistance | 0)
        ) {
            this.inputStateVersion = (this.inputStateVersion + 1) | 0;
            this.viewState = nextViewState;
        }
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

    async registerMapRuntime(input: SimMapRuntimeRegistrationInput): Promise<void> {
        const mapId = input.mapId | 0;
        const mapSimToken = input.mapSimToken;
        if (!this.workerMapRuntimeTracker.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        const workerState = await this.getWorkerState();
        const simScene = this.buildMapSimScene(workerState, mapId, input.borderSize);
        const tileRenderFlagsLevel1 = simScene.tileRenderFlags[1] ?? [];
        const deps = createNpcSimStateStoreDeps(workerState);
        this.npcSimStateStore.registerMap(
            {
                mapId,
                borderSize: input.borderSize | 0,
                tileRenderFlagsLevel1,
                collisionDatas: simScene.collisionMaps,
                locsAnimated: input.locsAnimated,
                npcTypeAnimationTable: input.npcTypeAnimationTable,
            },
            deps,
        );
        this.warnedEmptyNpcBootstrapMapIds.delete(mapId | 0);
        this.workerMapRuntimeTracker.clearMissingRuntimeStateWarning(mapId);
    }

    async bootstrapMapRuntime(input: MapRuntimeBootstrapInput): Promise<void> {
        const mapId = input.mapId | 0;
        const mapSimToken = input.mapSimToken;
        if (!this.workerMapRuntimeTracker.tryAcceptMapSimToken(mapId, mapSimToken)) {
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
            input.maxLevel | 0,
            state.borderSize | 0,
            state.tileRenderFlagsLevel1,
            input.npcOrderKeys,
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
            input.maxLevel | 0,
            state.borderSize | 0,
            resolvedBootstrap,
            deps,
        );
        this.workerMapRuntimeTracker.clearMissingRuntimeStateWarning(mapId);
    }

    unregisterMapRuntime(mapId: number, mapSimToken?: number): void {
        if (!this.workerMapRuntimeTracker.tryAcceptMapSimToken(mapId, mapSimToken)) {
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
        this.workerMapRuntimeTracker.clearMissingRuntimeStateWarning(mapId);
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

    private collectNpcLifecycleEventsForMap(
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

    async stepWorld(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        _cycleNow: number,
    ): Promise<WorldDeltaPacket | undefined> {
        const mapIds = this.visibleMapIds;
        if ((mapIds.length | 0) === 0) {
            return undefined;
        }
        const workerState = await this.getWorkerState();
        const inputs = this.normalizeWorldStepInputs(ticksElapsed, clientTicksElapsed);
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
            this.collectNpcLifecycleEventsForMap(mapId, state.npcs, events);
        }

        return buildWorldDeltaPacketFromNpcLifecycleEvents({
            frameCount: frameCount | 0,
            inputStateVersion: this.inputStateVersion | 0,
            lifecycleEvents: events,
        });
    }

    private normalizeWorldStepInputs(
        ticksElapsed: number,
        clientTicksElapsed: number,
    ): WorldStepInputs {
        return {
            safeTicksElapsed: Math.max(0, Math.min(ticksElapsed | 0, 4)),
            safeClientTicks: Math.max(0, Math.min(clientTicksElapsed | 0, 50)),
        };
    }

}
