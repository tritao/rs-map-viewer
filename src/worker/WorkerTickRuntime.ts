import type { NpcSpawn } from "../data/npc/NpcSpawn";
import type { ObjSpawn } from "../data/obj/ObjSpawn";
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
import {
    type MapObjState,
    type StaticMapObjState,
} from "../shared/StaticMapPacket";
import { decodeNpcLifecyclePacket } from "./NpcLifecyclePacket";
import {
    type WorldDeltaPacket,
    type WorldMapObjAddition,
    type WorldDynamicMapObjDespawn,
    type WorldDynamicMapObjSpawn,
    type WorldDynamicMapObjUpdate,
    type WorldLocAnimationPauseState,
    type WorldLocAnimationReset,
    type WorldMapObjRemoval,
    type WorldMapObjStateReplacement,
    buildWorldDeltaPacket,
    buildWorldDeltaPacketFromLocAnimationPauseStates,
    buildWorldDeltaPacketFromLocAnimationResets,
    buildWorldDeltaPacketFromNpcLifecycleEvents,
} from "../world/WorldDeltaPacket";
import {
    type ResolvedBootstrapData,
    resolveBootstrapData,
} from "../runtime/sim/NpcBootstrap";
import type { NpcEvent } from "../runtime/entities/NpcEvents";
import { applyNpcMovementStep } from "../runtime/sim/NpcSimMovement";
import { NpcSimStateStore, type NpcSimStateStoreDeps } from "../runtime/sim/NpcSimStateStore";
import { WorkerMapRuntimeTracker } from "./WorkerMapRuntimeTracker";
import type {
    MapRuntimeBootstrapInput,
    SimMapRuntimeRegistrationInput,
    WorldInputUpdate,
} from "./WorkerRuntimeTypes";
import type { WorkerState } from "./WorkerBuildTypes";

type TickWorkerState = Readonly<{
    session: CacheSession;
    mapBytesProvider: MapBytesProvider;
    objSpawns: ReadonlyArray<ObjSpawn>;
    fallbackNpcSpawns: ReadonlyArray<NpcSpawn>;
    objModelLoader: WorkerState["objModelLoader"];
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

type MapObjRuntimeState = Readonly<{
    borderSize: number;
    maxLevel: number;
    staticMapObjState?: StaticMapObjState;
    removedObjIndices: ReadonlySet<number>;
    dynamicObjSpawnsByRuntimeId: ReadonlyMap<number, ObjSpawn>;
    nextDynamicRuntimeObjId: number;
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
    private readonly pendingNpcSnapshotMapIds = new Set<number>();
    private readonly pendingDynamicObjSnapshotMapIds = new Set<number>();
    private activeMapIds: Int32Array = new Int32Array(0);
    private readonly pendingMapObjStateReplacementsByMapId = new Map<number, WorldMapObjStateReplacement>();
    private readonly pendingMapObjAdditionsByMapId = new Map<number, Set<number>>();
    private readonly pendingMapObjRemovalsByMapId = new Map<number, Set<number>>();
    private readonly pendingDynamicMapObjSpawnsByMapId = new Map<
        number,
        Array<
            Readonly<{
                objTypeId: number;
                count: number;
                x: number;
                y: number;
                plane: number;
            }>
        >
    >();
    private readonly pendingDynamicMapObjDespawnsByMapId = new Map<number, Set<number>>();
    private readonly pendingDynamicMapObjUpdatesByMapId = new Map<
        number,
        Map<number, WorldDynamicMapObjUpdate>
    >();
    private readonly pendingClearDynamicMapIds = new Set<number>();
    private readonly pendingLocAnimationResetByLocKey = new Map<string, WorldLocAnimationReset>();
    private readonly pendingLocAnimationPauseStateByLocKey = new Map<
        string,
        WorldLocAnimationPauseState
    >();
    private readonly mapObjRuntimeByMapId = new Map<number, MapObjRuntimeState>();
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
        this.pendingNpcSnapshotMapIds.clear();
        this.pendingDynamicObjSnapshotMapIds.clear();
        this.activeMapIds = new Int32Array(0);
        this.pendingMapObjStateReplacementsByMapId.clear();
        this.pendingMapObjAdditionsByMapId.clear();
        this.pendingMapObjRemovalsByMapId.clear();
        this.pendingDynamicMapObjSpawnsByMapId.clear();
        this.pendingDynamicMapObjDespawnsByMapId.clear();
        this.pendingDynamicMapObjUpdatesByMapId.clear();
        this.pendingClearDynamicMapIds.clear();
        this.pendingLocAnimationResetByLocKey.clear();
        this.pendingLocAnimationPauseStateByLocKey.clear();
        this.mapObjRuntimeByMapId.clear();
    }

    applyWorldInputUpdate(update: WorldInputUpdate): void {
        if (update.mapIds !== undefined) {
            this.setActiveMapIds(update.mapIds);
        }
        if (update.npcSnapshotMapIds !== undefined) {
            this.requestNpcSnapshots(update.npcSnapshotMapIds);
        }
        if (update.dynamicObjSnapshotMapIds !== undefined) {
            this.requestDynamicObjSnapshots(update.dynamicObjSnapshotMapIds);
        }
    }

    private requestNpcSnapshots(mapIds: Int32Array): void {
        for (let index = 0; index < mapIds.length; index++) {
            this.pendingNpcSnapshotMapIds.add(mapIds[index] | 0);
        }
    }

    private requestDynamicObjSnapshots(mapIds: Int32Array): void {
        for (let index = 0; index < mapIds.length; index++) {
            this.pendingDynamicObjSnapshotMapIds.add(mapIds[index] | 0);
        }
    }

    applyMapObjStateReplacements(
        stateReplacements: ReadonlyArray<WorldMapObjStateReplacement>,
    ): number {
        let applied = 0;
        for (let index = 0; index < stateReplacements.length; index++) {
            const update = stateReplacements[index];
            if (!update) {
                continue;
            }
            this.pendingMapObjStateReplacementsByMapId.set(update.mapId | 0, update);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    applyMapObjAdditions(additions: ReadonlyArray<WorldMapObjAddition>): number {
        let applied = 0;
        for (let index = 0; index < additions.length; index++) {
            const addition = additions[index];
            if (!addition) {
                continue;
            }
            const mapId = addition.mapId | 0;
            let addedIndices = this.pendingMapObjAdditionsByMapId.get(mapId);
            if (!addedIndices) {
                addedIndices = new Set<number>();
                this.pendingMapObjAdditionsByMapId.set(mapId, addedIndices);
            }
            addedIndices.add(addition.objIndex | 0);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    applyMapObjRemovals(removals: ReadonlyArray<WorldMapObjRemoval>): number {
        let applied = 0;
        for (let index = 0; index < removals.length; index++) {
            const removal = removals[index];
            if (!removal) {
                continue;
            }
            const mapId = removal.mapId | 0;
            let removedIndices = this.pendingMapObjRemovalsByMapId.get(mapId);
            if (!removedIndices) {
                removedIndices = new Set<number>();
                this.pendingMapObjRemovalsByMapId.set(mapId, removedIndices);
            }
            removedIndices.add(removal.objIndex | 0);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    applyDynamicMapObjSpawns(
        spawns: ReadonlyArray<
            Readonly<{
                mapId: number;
                objTypeId: number;
                count: number;
                x: number;
                y: number;
                plane: number;
            }>
        >,
    ): number {
        let applied = 0;
        for (let index = 0; index < spawns.length; index++) {
            const spawn = spawns[index];
            if (!spawn) {
                continue;
            }
            const mapId = spawn.mapId | 0;
            let pending = this.pendingDynamicMapObjSpawnsByMapId.get(mapId);
            if (!pending) {
                pending = [];
                this.pendingDynamicMapObjSpawnsByMapId.set(mapId, pending);
            }
            pending.push({
                objTypeId: spawn.objTypeId | 0,
                count: Math.max(1, spawn.count | 0),
                x: spawn.x | 0,
                y: spawn.y | 0,
                plane: spawn.plane | 0,
            });
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    applyDynamicMapObjDespawns(
        despawns: ReadonlyArray<
            Readonly<{
                mapId: number;
                runtimeObjId: number;
            }>
        >,
    ): number {
        let applied = 0;
        for (let index = 0; index < despawns.length; index++) {
            const despawn = despawns[index];
            if (!despawn) {
                continue;
            }
            const mapId = despawn.mapId | 0;
            let pending = this.pendingDynamicMapObjDespawnsByMapId.get(mapId);
            if (!pending) {
                pending = new Set<number>();
                this.pendingDynamicMapObjDespawnsByMapId.set(mapId, pending);
            }
            pending.add(despawn.runtimeObjId | 0);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    applyDynamicMapObjUpdates(updates: ReadonlyArray<WorldDynamicMapObjUpdate>): number {
        let applied = 0;
        for (let index = 0; index < updates.length; index++) {
            const update = updates[index];
            if (!update) {
                continue;
            }
            const mapId = update.mapId | 0;
            let pending = this.pendingDynamicMapObjUpdatesByMapId.get(mapId);
            if (!pending) {
                pending = new Map<number, WorldDynamicMapObjUpdate>();
                this.pendingDynamicMapObjUpdatesByMapId.set(mapId, pending);
            }
            pending.set(update.runtimeObjId | 0, {
                mapId,
                runtimeObjId: update.runtimeObjId | 0,
                objTypeId: update.objTypeId | 0,
                count: Math.max(1, update.count | 0),
                x: update.x | 0,
                y: update.y | 0,
                plane: update.plane | 0,
            });
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    clearDynamicMapObjs(mapIds: ReadonlyArray<number>): number {
        let applied = 0;
        for (let index = 0; index < mapIds.length; index++) {
            const mapId = mapIds[index];
            if (mapId === undefined) {
                continue;
            }
            this.pendingClearDynamicMapIds.add(mapId | 0);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    applyLocAnimationResets(resets: ReadonlyArray<WorldLocAnimationReset>): number {
        let applied = 0;
        for (let index = 0; index < resets.length; index++) {
            const reset = resets[index];
            if (!reset) {
                continue;
            }
            this.pendingLocAnimationResetByLocKey.set(
                `${reset.mapId | 0}:${reset.locIndex | 0}`,
                reset,
            );
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    applyLocAnimationPauseStates(
        pauseStates: ReadonlyArray<WorldLocAnimationPauseState>,
    ): number {
        let applied = 0;
        for (let index = 0; index < pauseStates.length; index++) {
            const pauseState = pauseStates[index];
            if (!pauseState) {
                continue;
            }
            this.pendingLocAnimationPauseStateByLocKey.set(
                `${pauseState.mapId | 0}:${pauseState.locIndex | 0}`,
                pauseState,
            );
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private setActiveMapIds(mapIds: Int32Array): void {
        if ((mapIds.length | 0) <= 0) {
            this.activeMapIds = new Int32Array(0);
            return;
        }
        this.activeMapIds = Int32Array.from(mapIds);
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

    private upsertMapObjRuntimeState(
        mapId: number,
        input: Readonly<{
            borderSize?: number;
            maxLevel?: number;
            mapObjState?: MapObjState;
            resetRemovedObjIndices?: boolean;
            resetDynamicObjSpawns?: boolean;
        }>,
    ): void {
        const current = this.mapObjRuntimeByMapId.get(mapId | 0);
        this.mapObjRuntimeByMapId.set(mapId | 0, {
            borderSize: input.borderSize ?? current?.borderSize ?? 0,
            maxLevel: input.maxLevel ?? current?.maxLevel ?? 0,
            staticMapObjState:
                input.mapObjState?.staticState ?? current?.staticMapObjState,
            removedObjIndices: input.resetRemovedObjIndices
                ? new Set<number>()
                : new Set(current?.removedObjIndices ?? []),
            dynamicObjSpawnsByRuntimeId: input.resetDynamicObjSpawns
                ? new Map<number, ObjSpawn>()
                : new Map(current?.dynamicObjSpawnsByRuntimeId ?? []),
            nextDynamicRuntimeObjId: input.resetDynamicObjSpawns
                ? 1
                : current?.nextDynamicRuntimeObjId ?? 1,
        });
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
        this.upsertMapObjRuntimeState(mapId, {
            borderSize: input.borderSize | 0,
            resetDynamicObjSpawns: true,
        });
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
        this.upsertMapObjRuntimeState(mapId, {
            maxLevel: input.maxLevel | 0,
            mapObjState: input.mapObjState,
            resetRemovedObjIndices: true,
            resetDynamicObjSpawns: true,
        });
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
        this.pendingNpcSnapshotMapIds.delete(mapId | 0);
        this.npcSimStateStore.unregisterMap(mapId);
        this.warnedEmptyNpcBootstrapMapIds.delete(mapId | 0);
        this.pendingMapObjStateReplacementsByMapId.delete(mapId | 0);
        this.pendingMapObjAdditionsByMapId.delete(mapId | 0);
        this.pendingMapObjRemovalsByMapId.delete(mapId | 0);
        this.pendingDynamicMapObjSpawnsByMapId.delete(mapId | 0);
        this.pendingDynamicMapObjDespawnsByMapId.delete(mapId | 0);
        this.pendingClearDynamicMapIds.delete(mapId | 0);
        this.mapObjRuntimeByMapId.delete(mapId | 0);
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
        const mapIds = this.activeMapIds;
        const hasPendingNpcSnapshots = (this.pendingNpcSnapshotMapIds.size | 0) > 0;
        const hasPendingObjStateReplacements =
            (this.pendingMapObjStateReplacementsByMapId.size | 0) > 0;
        const hasPendingObjAdditions = (this.pendingMapObjAdditionsByMapId.size | 0) > 0;
        const hasPendingObjRemovals = (this.pendingMapObjRemovalsByMapId.size | 0) > 0;
        const hasPendingDynamicObjSpawns = (this.pendingDynamicMapObjSpawnsByMapId.size | 0) > 0;
        const hasPendingDynamicObjDespawns =
            (this.pendingDynamicMapObjDespawnsByMapId.size | 0) > 0;
        const hasPendingClearDynamicMaps = (this.pendingClearDynamicMapIds.size | 0) > 0;
        const hasPendingLocAnimationResets =
            (this.pendingLocAnimationResetByLocKey.size | 0) > 0;
        const hasPendingLocAnimationPauseStates =
            (this.pendingLocAnimationPauseStateByLocKey.size | 0) > 0;
        if (
            (mapIds.length | 0) === 0 &&
            !hasPendingNpcSnapshots &&
            !hasPendingObjStateReplacements &&
            !hasPendingObjAdditions &&
            !hasPendingObjRemovals &&
            !hasPendingDynamicObjSpawns &&
            !hasPendingDynamicObjDespawns &&
            !hasPendingClearDynamicMaps &&
            !hasPendingLocAnimationResets &&
            !hasPendingLocAnimationPauseStates
        ) {
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
                this.pendingNpcSnapshotMapIds.delete(mapId | 0);
                continue;
            }
            if (this.pendingNpcSnapshotMapIds.has(mapId | 0)) {
                this.npcSnapshotByMapId.delete(mapId | 0);
                this.pendingNpcSnapshotMapIds.delete(mapId | 0);
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

        const npcStatePacket = buildWorldDeltaPacketFromNpcLifecycleEvents({
            frameCount: frameCount | 0,
            lifecycleEvents: events,
        });
        const objStateReplacements: WorldMapObjStateReplacement[] = [];
        const objAdditions: WorldMapObjAddition[] = [];
        const objRemovals: WorldMapObjRemoval[] = [];
        const dynamicObjSpawns: WorldDynamicMapObjSpawn[] = [];
        const dynamicObjDespawns: WorldDynamicMapObjDespawn[] = [];
        const dynamicObjUpdates: WorldDynamicMapObjUpdate[] = [];
        const clearDynamicMapIds: number[] = [];
        if (hasPendingObjStateReplacements) {
            for (const update of this.pendingMapObjStateReplacementsByMapId.values()) {
                objStateReplacements.push(update);
                if (update.kind === "replaceState") {
                    this.upsertMapObjRuntimeState(update.mapId | 0, {
                        mapObjState: update.mapObjState,
                        resetRemovedObjIndices: true,
                        resetDynamicObjSpawns:
                            update.mapObjState?.staticState !== undefined,
                    });
                }
            }
        }
        if (hasPendingObjRemovals) {
            for (const [mapId, removedObjIndices] of this.pendingMapObjRemovalsByMapId.entries()) {
                const runtime = this.mapObjRuntimeByMapId.get(mapId | 0);
                if (!runtime) {
                    continue;
                }
                const nextRemovedObjIndices = new Set(runtime.removedObjIndices);
                for (const objIndex of removedObjIndices.values()) {
                    nextRemovedObjIndices.add(objIndex | 0);
                    objRemovals.push({
                        mapId: mapId | 0,
                        objIndex: objIndex | 0,
                    });
                }
                this.mapObjRuntimeByMapId.set(mapId | 0, {
                    ...runtime,
                    removedObjIndices: nextRemovedObjIndices,
                });
            }
        }
        if (
            hasPendingClearDynamicMaps ||
            hasPendingDynamicObjSpawns ||
            hasPendingDynamicObjDespawns
        ) {
            const dirtyDynamicMapIds = new Set<number>();
            for (const mapId of this.pendingClearDynamicMapIds.values()) {
                const runtime = this.mapObjRuntimeByMapId.get(mapId | 0);
                if (!runtime) {
                    continue;
                }
                this.mapObjRuntimeByMapId.set(mapId | 0, {
                    ...runtime,
                    dynamicObjSpawnsByRuntimeId: new Map<number, ObjSpawn>(),
                    nextDynamicRuntimeObjId: runtime.nextDynamicRuntimeObjId | 0,
                });
                clearDynamicMapIds.push(mapId | 0);
            }
            for (const [mapId, spawns] of this.pendingDynamicMapObjSpawnsByMapId.entries()) {
                const runtime = this.mapObjRuntimeByMapId.get(mapId | 0);
                if (!runtime) {
                    continue;
                }
                const nextDynamicObjSpawnsByRuntimeId = new Map(runtime.dynamicObjSpawnsByRuntimeId);
                let nextDynamicRuntimeObjId = runtime.nextDynamicRuntimeObjId | 0;
                for (let index = 0; index < spawns.length; index++) {
                    const spawn = spawns[index]!;
                    const runtimeObjId = nextDynamicRuntimeObjId | 0;
                    nextDynamicObjSpawnsByRuntimeId.set(nextDynamicRuntimeObjId, {
                        id: spawn.objTypeId | 0,
                        count: Math.max(1, spawn.count | 0),
                        x: spawn.x | 0,
                        y: spawn.y | 0,
                        plane: spawn.plane | 0,
                    });
                    dynamicObjSpawns.push({
                        mapId: mapId | 0,
                        runtimeObjId,
                        objTypeId: spawn.objTypeId | 0,
                        count: Math.max(1, spawn.count | 0),
                        x: spawn.x | 0,
                        y: spawn.y | 0,
                        plane: spawn.plane | 0,
                    });
                    nextDynamicRuntimeObjId = (nextDynamicRuntimeObjId + 1) | 0;
                }
                this.mapObjRuntimeByMapId.set(mapId | 0, {
                    ...runtime,
                    dynamicObjSpawnsByRuntimeId: nextDynamicObjSpawnsByRuntimeId,
                    nextDynamicRuntimeObjId,
                });
            }
            for (const [mapId, runtimeObjIds] of this.pendingDynamicMapObjDespawnsByMapId.entries()) {
                const runtime = this.mapObjRuntimeByMapId.get(mapId | 0);
                if (!runtime) {
                    continue;
                }
                const nextDynamicObjSpawnsByRuntimeId = new Map(runtime.dynamicObjSpawnsByRuntimeId);
                for (const runtimeObjId of runtimeObjIds.values()) {
                    nextDynamicObjSpawnsByRuntimeId.delete(runtimeObjId | 0);
                    dynamicObjDespawns.push({
                        mapId: mapId | 0,
                        runtimeObjId: runtimeObjId | 0,
                    });
                }
                this.mapObjRuntimeByMapId.set(mapId | 0, {
                    ...runtime,
                    dynamicObjSpawnsByRuntimeId: nextDynamicObjSpawnsByRuntimeId,
                });
            }
            for (const [mapId, updates] of this.pendingDynamicMapObjUpdatesByMapId.entries()) {
                const runtime = this.mapObjRuntimeByMapId.get(mapId | 0);
                if (!runtime) {
                    continue;
                }
                const nextDynamicObjSpawnsByRuntimeId = new Map(runtime.dynamicObjSpawnsByRuntimeId);
                for (const update of updates.values()) {
                    if (!nextDynamicObjSpawnsByRuntimeId.has(update.runtimeObjId | 0)) {
                        continue;
                    }
                    nextDynamicObjSpawnsByRuntimeId.set(update.runtimeObjId | 0, {
                        id: update.objTypeId | 0,
                        count: Math.max(1, update.count | 0),
                        x: update.x | 0,
                        y: update.y | 0,
                        plane: update.plane | 0,
                    });
                    dynamicObjUpdates.push(update);
                }
                this.mapObjRuntimeByMapId.set(mapId | 0, {
                    ...runtime,
                    dynamicObjSpawnsByRuntimeId: nextDynamicObjSpawnsByRuntimeId,
                });
            }
            for (const mapId of this.pendingDynamicObjSnapshotMapIds.values()) {
                const runtime = this.mapObjRuntimeByMapId.get(mapId | 0);
                if (!runtime) {
                    continue;
                }
                clearDynamicMapIds.push(mapId | 0);
                for (const [runtimeObjId, spawn] of runtime.dynamicObjSpawnsByRuntimeId.entries()) {
                    dynamicObjSpawns.push({
                        mapId: mapId | 0,
                        runtimeObjId: runtimeObjId | 0,
                        objTypeId: spawn.id | 0,
                        count: Math.max(1, spawn.count | 0),
                        x: spawn.x | 0,
                        y: spawn.y | 0,
                        plane: spawn.plane | 0,
                    });
                }
            }
        }
        if (hasPendingObjAdditions) {
            for (const [mapId, addedObjIndices] of this.pendingMapObjAdditionsByMapId.entries()) {
                const runtime = this.mapObjRuntimeByMapId.get(mapId | 0);
                if (!runtime) {
                    continue;
                }
                const nextRemovedObjIndices = new Set(runtime.removedObjIndices);
                for (const objIndex of addedObjIndices.values()) {
                    nextRemovedObjIndices.delete(objIndex | 0);
                    objAdditions.push({
                        mapId: mapId | 0,
                        objIndex: objIndex | 0,
                    });
                }
                this.mapObjRuntimeByMapId.set(mapId | 0, {
                    ...runtime,
                    removedObjIndices: nextRemovedObjIndices,
                });
            }
        }
        const locAnimationResets = hasPendingLocAnimationResets
            ? Array.from(this.pendingLocAnimationResetByLocKey.values())
            : undefined;
        const locAnimationPauseStates = hasPendingLocAnimationPauseStates
            ? Array.from(this.pendingLocAnimationPauseStateByLocKey.values())
            : undefined;
        this.pendingMapObjStateReplacementsByMapId.clear();
        this.pendingMapObjAdditionsByMapId.clear();
        this.pendingMapObjRemovalsByMapId.clear();
        this.pendingDynamicMapObjSpawnsByMapId.clear();
        this.pendingDynamicMapObjDespawnsByMapId.clear();
        this.pendingDynamicMapObjUpdatesByMapId.clear();
        this.pendingClearDynamicMapIds.clear();
        this.pendingDynamicObjSnapshotMapIds.clear();
        this.pendingLocAnimationResetByLocKey.clear();
        this.pendingLocAnimationPauseStateByLocKey.clear();
        const locDeltaPacket = locAnimationResets
            ? buildWorldDeltaPacketFromLocAnimationResets({
                  frameCount: frameCount | 0,
                  animationResets: locAnimationResets,
              })
            : undefined;
        const locPausePacket = locAnimationPauseStates
            ? buildWorldDeltaPacketFromLocAnimationPauseStates({
                  frameCount: frameCount | 0,
                  animationPauseStates: locAnimationPauseStates,
              })
            : undefined;
        if (
            !npcStatePacket.npcState &&
            (objStateReplacements.length | 0) <= 0 &&
            (objAdditions.length | 0) <= 0 &&
            (objRemovals.length | 0) <= 0 &&
            !locDeltaPacket?.locDelta &&
            !locPausePacket?.locDelta
        ) {
            return undefined;
        }
        return buildWorldDeltaPacket({
            frameCount: frameCount | 0,
            npcState: npcStatePacket.npcState,
            objDelta:
                (objStateReplacements.length | 0) > 0 ||
                (objAdditions.length | 0) > 0 ||
                (objRemovals.length | 0) > 0 ||
                (dynamicObjSpawns.length | 0) > 0 ||
                (dynamicObjDespawns.length | 0) > 0 ||
                (dynamicObjUpdates.length | 0) > 0 ||
                (clearDynamicMapIds.length | 0) > 0
                    ? {
                          stateReplacements:
                              (objStateReplacements.length | 0) > 0
                                  ? objStateReplacements
                                  : undefined,
                          additions: (objAdditions.length | 0) > 0 ? objAdditions : undefined,
                          removals: (objRemovals.length | 0) > 0 ? objRemovals : undefined,
                          dynamicSpawns:
                              (dynamicObjSpawns.length | 0) > 0 ? dynamicObjSpawns : undefined,
                          dynamicDespawns:
                              (dynamicObjDespawns.length | 0) > 0 ? dynamicObjDespawns : undefined,
                          dynamicUpdates:
                              (dynamicObjUpdates.length | 0) > 0 ? dynamicObjUpdates : undefined,
                          clearDynamicMapIds:
                              (clearDynamicMapIds.length | 0) > 0 ? clearDynamicMapIds : undefined,
                      }
                    : undefined,
            locDelta:
                locDeltaPacket?.locDelta || locPausePacket?.locDelta
                    ? {
                          animationResetPacked:
                              locDeltaPacket?.locDelta?.animationResetPacked ?? new Int32Array(0),
                          animationPauseStatePacked:
                              locPausePacket?.locDelta?.animationPauseStatePacked,
                      }
                    : undefined,
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
