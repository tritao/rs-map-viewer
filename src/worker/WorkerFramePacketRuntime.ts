import type { ObjSpawn } from "../data/obj/ObjSpawn";
import { staticMapObjStateToRenderData } from "../maprender/MapObjState";
import type { MapRenderBackend } from "../maprender/MapRenderBackend";
import type { ObjRenderData } from "../maprender/MapRenderData";
import type { MapObjRenderPacket } from "../renderer/MapObjRenderPacket";
import { buildMapObjRenderPacket } from "../renderer/MapObjRenderPacket";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../renderer/NpcGpuFrame";
import { NpcGpuFrameBuilder, type NpcGpuFrameSource } from "../renderer/NpcGpuFrameBuilder";
import { TICK_PATCH_ENTRY_STRIDE, TICK_PATCH_STREAM_COUNT } from "../renderer/RenderFramePacket";
import type { RenderFramePacket } from "../renderer/RenderFramePacket";
import {
    type RenderFramePacketMapEntry,
    buildRenderFramePacketFromMapEntries,
    buildRenderFramePacketMapEntry,
} from "../renderer/RenderFramePacketBuilder";
import { NpcSimStateStore, type NpcSimStateStoreDeps } from "../runtime/sim/NpcSimStateStore";
import {
    buildTickPatchStreamsForMap,
    readWasmPatchStreamsForMap,
} from "../runtime/sim/TickPatchStreamsBuilder";
import { LOC_CYCLE_SCALE } from "../wasm/LocCycle";
import type { MapRenderRuntimeHandle } from "../wasm/MapRenderRuntimeBridgeAbi";
import { mapRenderRuntimeBridge } from "../wasm/rs_map_runtime_bridge.mjs";
import type {
    WorldDeltaPacket,
    WorldDynamicMapObjDespawn,
    WorldDynamicMapObjSpawn,
    WorldDynamicMapObjUpdate,
    WorldLocAnimationPauseState,
    WorldLocAnimationReset,
    WorldMapObjAddition,
    WorldMapObjRemoval,
    WorldMapObjStateReplacement,
} from "../world/WorldDeltaPacket";
import { LOC_ANIMATION_PAUSE_STATE_STRIDE } from "../world/WorldDeltaPacket";
import { WorkerMapRuntimeTracker } from "./WorkerMapRuntimeTracker";
import {
    type ApplyWorldDeltaResult,
    type RenderFrameInputUpdate,
    type RenderMapRuntimeRegistrationInput,
    type WorkerInputStateVersion,
    type WorkerViewState,
} from "./WorkerRuntimeTypes";

type FrameWorkerState = Readonly<{
    runtimeAdapter: import("./WorkerBuildTypes").WorkerState["runtimeAdapter"];
    mapRenderBackend: Readonly<{
        kind: MapRenderBackend["kind"];
        getWasmRuntimeHandle?: () => MapRenderRuntimeHandle | undefined;
    }>;
}>;

type FrameBuildInputs = Readonly<{
    hoveredMapIds: ReadonlySet<number>;
    safeClientTicks: number;
    npcRingWriteIndex: number;
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

type PendingRuntimeMapObjUpdate = {
    staticObjRenderData: ObjRenderData | undefined;
    replaceStaticObjRenderData: boolean;
    hiddenStaticObjIndices: Set<number>;
    appendDynamicObjRenders: Array<
        Readonly<{
            runtimeObjId: number;
            interactId: number;
            objRenderData: ObjRenderData;
        }>
    >;
    removeDynamicRuntimeObjIds: Set<number>;
    clearDynamicObjRenderData: boolean;
};

type RuntimeDynamicObjMapState = Readonly<{
    staticObjCount: number;
    slotByRuntimeObjId: ReadonlyMap<number, number>;
    freeSlots: ReadonlyArray<number>;
    nextSlot: number;
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

function createNpcSimStateStoreDeps(workerState: FrameWorkerState): NpcSimStateStoreDeps {
    return workerState.runtimeAdapter.createNpcSimStateStoreDeps(TICK_PATCH_ENTRY_STRIDE);
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

export class WorkerFramePacketRuntime {
    private readonly npcSimStateStore = new NpcSimStateStore();
    private readonly npcGpuFrameBuilder = new NpcGpuFrameBuilder();
    private readonly workerMapRuntimeTracker = new WorkerMapRuntimeTracker();
    private visibleMapIds: Int32Array = new Int32Array(0);
    private inputStateVersion: WorkerInputStateVersion = 0;
    private viewState: WorkerViewState = {
        cameraMapX: 0,
        cameraMapY: 0,
        lodDistance: 0,
    };
    private hoveredMapIdsPacked: Int32Array = new Int32Array(0);
    private readonly runtimeHiddenObjIndicesByMapId = new Map<number, Set<number>>();
    private readonly runtimeDynamicObjStateByMapId = new Map<number, RuntimeDynamicObjMapState>();
    private readonly pendingDynamicObjSnapshotMapIds = new Set<number>();
    private readonly pendingRuntimeMapObjUpdatesByMapId = new Map<
        number,
        PendingRuntimeMapObjUpdate
    >();
    private readonly pendingLocAnimationResetByLocKey = new Map<string, WorldLocAnimationReset>();
    private readonly pendingLocAnimationPauseStateByLocKey = new Map<
        string,
        WorldLocAnimationPauseState
    >();
    private readonly npcGpuFrameSourceScratch: NpcGpuFrameSource[] = [];

    constructor(private readonly getWorkerState: () => Promise<FrameWorkerState>) {}

    resetForCache(): void {
        this.resetState(() => this.npcSimStateStore.resetForCache());
    }

    resetForLoaderReset(): void {
        this.resetState(() => this.npcSimStateStore.resetForLoaderReset());
    }

    private resetState(resetNpcStateStore: () => void): void {
        resetNpcStateStore();
        this.workerMapRuntimeTracker.reset();
        this.visibleMapIds = new Int32Array(0);
        this.inputStateVersion = 0;
        this.viewState = { cameraMapX: 0, cameraMapY: 0, lodDistance: 0 };
        this.hoveredMapIdsPacked = new Int32Array(0);
        this.runtimeHiddenObjIndicesByMapId.clear();
        this.runtimeDynamicObjStateByMapId.clear();
        this.pendingDynamicObjSnapshotMapIds.clear();
        this.pendingRuntimeMapObjUpdatesByMapId.clear();
        this.pendingLocAnimationResetByLocKey.clear();
        this.pendingLocAnimationPauseStateByLocKey.clear();
    }

    private getPendingRuntimeMapObjUpdate(mapId: number): PendingRuntimeMapObjUpdate {
        const id = mapId | 0;
        let pending = this.pendingRuntimeMapObjUpdatesByMapId.get(id);
        if (!pending) {
            pending = {
                staticObjRenderData: undefined,
                replaceStaticObjRenderData: false,
                hiddenStaticObjIndices: new Set(this.runtimeHiddenObjIndicesByMapId.get(id) ?? []),
                appendDynamicObjRenders: [],
                removeDynamicRuntimeObjIds: new Set<number>(),
                clearDynamicObjRenderData: false,
            };
            this.pendingRuntimeMapObjUpdatesByMapId.set(id, pending);
        }
        return pending;
    }

    private applyRuntimeMapObjStateReplacements(
        stateReplacements: ReadonlyArray<WorldMapObjStateReplacement> | undefined,
    ): number {
        if (!stateReplacements) {
            return 0;
        }
        let applied = 0;
        for (let index = 0; index < stateReplacements.length; index++) {
            const update = stateReplacements[index];
            if (!update) {
                continue;
            }
            if (update.kind !== "replaceState") {
                continue;
            }
            const pending = this.getPendingRuntimeMapObjUpdate(update.mapId | 0);
            const mapObjState = update.mapObjState;
            if (mapObjState && "staticState" in mapObjState) {
                pending.staticObjRenderData = staticMapObjStateToRenderData(
                    mapObjState.staticState,
                );
                pending.replaceStaticObjRenderData = true;
                const currentDynamic = this.runtimeDynamicObjStateByMapId.get(update.mapId | 0);
                this.runtimeDynamicObjStateByMapId.set(update.mapId | 0, {
                    staticObjCount: mapObjState.staticState?.objTypeIds.length ?? 0,
                    slotByRuntimeObjId:
                        currentDynamic?.slotByRuntimeObjId ?? new Map<number, number>(),
                    freeSlots: currentDynamic?.freeSlots ?? [],
                    nextSlot: currentDynamic?.nextSlot ?? 0,
                });
            }
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private ensureDynamicObjMapState(mapId: number): RuntimeDynamicObjMapState {
        const id = mapId | 0;
        const existing = this.runtimeDynamicObjStateByMapId.get(id);
        if (existing) {
            return existing;
        }
        const created: RuntimeDynamicObjMapState = {
            staticObjCount: 0,
            slotByRuntimeObjId: new Map<number, number>(),
            freeSlots: [],
            nextSlot: 0,
        };
        this.runtimeDynamicObjStateByMapId.set(id, created);
        return created;
    }

    private allocateDynamicObjSlot(mapState: RuntimeDynamicObjMapState): Readonly<{
        slot: number;
        nextState: RuntimeDynamicObjMapState;
    }> {
        if ((mapState.freeSlots.length | 0) > 0) {
            const nextFreeSlots = mapState.freeSlots.slice();
            const slot = nextFreeSlots.pop()! | 0;
            return {
                slot,
                nextState: {
                    ...mapState,
                    freeSlots: nextFreeSlots,
                },
            };
        }
        const slot = mapState.nextSlot | 0;
        return {
            slot,
            nextState: {
                ...mapState,
                nextSlot: ((mapState.nextSlot | 0) + 1) | 0,
            },
        };
    }

    private buildDynamicObjRenderData(
        workerState: FrameWorkerState,
        mapId: number,
        borderSize: number,
        spawn: ObjSpawn,
        interactId: number,
    ): ObjRenderData | undefined {
        return workerState.runtimeAdapter.buildMapObjRenderData({
            mapId: mapId | 0,
            borderSize: borderSize | 0,
            objSpawns: [spawn],
            interactIds: Int32Array.of(interactId | 0),
            minimizeDrawCalls: true,
        });
    }

    private async applyRuntimeDynamicMapObjSpawns(
        spawns: ReadonlyArray<WorldDynamicMapObjSpawn> | undefined,
    ): Promise<number> {
        if (!spawns || (spawns.length | 0) <= 0) {
            return 0;
        }
        const workerState = await this.getWorkerState();
        let applied = 0;
        const borderSizeByMapId = new Map<number, number>();
        for (let index = 0; index < spawns.length; index++) {
            const spawn = spawns[index];
            if (!spawn) {
                continue;
            }
            const mapId = spawn.mapId | 0;
            let mapState = this.ensureDynamicObjMapState(mapId);
            const allocated = this.allocateDynamicObjSlot(mapState);
            const slot = allocated.slot | 0;
            mapState = {
                ...allocated.nextState,
                slotByRuntimeObjId: new Map(allocated.nextState.slotByRuntimeObjId).set(
                    spawn.runtimeObjId | 0,
                    slot | 0,
                ),
            };
            this.runtimeDynamicObjStateByMapId.set(mapId, mapState);
            const interactId = ((mapState.staticObjCount | 0) + (slot | 0)) | 0;
            let borderSize = borderSizeByMapId.get(mapId);
            if (borderSize === undefined) {
                borderSize = this.npcSimStateStore.getMap(mapId)?.borderSize ?? 0;
                borderSizeByMapId.set(mapId, borderSize | 0);
            }
            const objRenderData = this.buildDynamicObjRenderData(
                workerState,
                mapId,
                borderSize | 0,
                {
                    id: spawn.objTypeId | 0,
                    count: Math.max(1, spawn.count | 0),
                    x: spawn.x | 0,
                    y: spawn.y | 0,
                    plane: spawn.plane | 0,
                },
                interactId | 0,
            );
            if (!objRenderData) {
                continue;
            }
            this.getPendingRuntimeMapObjUpdate(mapId).appendDynamicObjRenders.push({
                runtimeObjId: spawn.runtimeObjId | 0,
                interactId: interactId | 0,
                objRenderData,
            });
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private applyRuntimeDynamicMapObjDespawns(
        despawns: ReadonlyArray<WorldDynamicMapObjDespawn> | undefined,
    ): number {
        if (!despawns || (despawns.length | 0) <= 0) {
            return 0;
        }
        let applied = 0;
        for (let index = 0; index < despawns.length; index++) {
            const despawn = despawns[index];
            if (!despawn) {
                continue;
            }
            const mapId = despawn.mapId | 0;
            const mapState = this.runtimeDynamicObjStateByMapId.get(mapId);
            const slot = mapState?.slotByRuntimeObjId.get(despawn.runtimeObjId | 0);
            if (slot === undefined || !mapState) {
                this.pendingDynamicObjSnapshotMapIds.add(mapId);
                continue;
            }
            const nextSlots = new Map(mapState.slotByRuntimeObjId);
            nextSlots.delete(despawn.runtimeObjId | 0);
            this.runtimeDynamicObjStateByMapId.set(mapId, {
                ...mapState,
                slotByRuntimeObjId: nextSlots,
                freeSlots: [...mapState.freeSlots, slot | 0],
            });
            this.getPendingRuntimeMapObjUpdate(mapId).removeDynamicRuntimeObjIds.add(
                despawn.runtimeObjId | 0,
            );
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private async applyRuntimeDynamicMapObjUpdates(
        updates: ReadonlyArray<WorldDynamicMapObjUpdate> | undefined,
    ): Promise<number> {
        if (!updates || (updates.length | 0) <= 0) {
            return 0;
        }
        const workerState = await this.getWorkerState();
        let applied = 0;
        const borderSizeByMapId = new Map<number, number>();
        for (let index = 0; index < updates.length; index++) {
            const update = updates[index];
            if (!update) {
                continue;
            }
            const mapId = update.mapId | 0;
            const mapState = this.runtimeDynamicObjStateByMapId.get(mapId);
            const slot = mapState?.slotByRuntimeObjId.get(update.runtimeObjId | 0);
            if (slot === undefined || !mapState) {
                this.pendingDynamicObjSnapshotMapIds.add(mapId);
                continue;
            }
            const interactId = ((mapState.staticObjCount | 0) + (slot | 0)) | 0;
            let borderSize = borderSizeByMapId.get(mapId);
            if (borderSize === undefined) {
                borderSize = this.npcSimStateStore.getMap(mapId)?.borderSize ?? 0;
                borderSizeByMapId.set(mapId, borderSize | 0);
            }
            const objRenderData = this.buildDynamicObjRenderData(
                workerState,
                mapId,
                borderSize | 0,
                {
                    id: update.objTypeId | 0,
                    count: Math.max(1, update.count | 0),
                    x: update.x | 0,
                    y: update.y | 0,
                    plane: update.plane | 0,
                },
                interactId | 0,
            );
            if (!objRenderData) {
                continue;
            }
            this.getPendingRuntimeMapObjUpdate(mapId).appendDynamicObjRenders.push({
                runtimeObjId: update.runtimeObjId | 0,
                interactId: interactId | 0,
                objRenderData,
            });
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private applyRuntimeClearDynamicMapObjRenderData(
        mapIds: ReadonlyArray<number> | undefined,
    ): number {
        if (!mapIds || (mapIds.length | 0) <= 0) {
            return 0;
        }
        let applied = 0;
        for (let index = 0; index < mapIds.length; index++) {
            const mapId = mapIds[index];
            if (mapId === undefined) {
                continue;
            }
            const current = this.ensureDynamicObjMapState(mapId | 0);
            this.runtimeDynamicObjStateByMapId.set(mapId | 0, {
                ...current,
                slotByRuntimeObjId: new Map<number, number>(),
                freeSlots: [],
                nextSlot: 0,
            });
            const pending = this.getPendingRuntimeMapObjUpdate(mapId | 0);
            pending.clearDynamicObjRenderData = true;
            pending.appendDynamicObjRenders = [];
            pending.removeDynamicRuntimeObjIds.clear();
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private applyRuntimeMapObjRemovals(
        removals: ReadonlyArray<WorldMapObjRemoval> | undefined,
    ): number {
        if (!removals) {
            return 0;
        }
        let applied = 0;
        for (let index = 0; index < removals.length; index++) {
            const removal = removals[index];
            if (!removal) {
                continue;
            }
            const mapId = removal.mapId | 0;
            let hiddenObjIndices = this.runtimeHiddenObjIndicesByMapId.get(mapId);
            if (!hiddenObjIndices) {
                hiddenObjIndices = new Set<number>();
                this.runtimeHiddenObjIndicesByMapId.set(mapId, hiddenObjIndices);
            }
            hiddenObjIndices.add(removal.objIndex | 0);
            this.getPendingRuntimeMapObjUpdate(mapId).hiddenStaticObjIndices = new Set(
                hiddenObjIndices,
            );
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private applyRuntimeMapObjAdditions(
        additions: ReadonlyArray<WorldMapObjAddition> | undefined,
    ): number {
        if (!additions) {
            return 0;
        }
        let applied = 0;
        for (let index = 0; index < additions.length; index++) {
            const addition = additions[index];
            if (!addition) {
                continue;
            }
            const mapId = addition.mapId | 0;
            const hiddenObjIndices = this.runtimeHiddenObjIndicesByMapId.get(mapId);
            if (!hiddenObjIndices) {
                continue;
            }
            hiddenObjIndices.delete(addition.objIndex | 0);
            this.getPendingRuntimeMapObjUpdate(mapId).hiddenStaticObjIndices = new Set(
                hiddenObjIndices,
            );
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private consumePendingRuntimeMapObjRenderPacket(): MapObjRenderPacket | undefined {
        if ((this.pendingRuntimeMapObjUpdatesByMapId.size | 0) <= 0) {
            return undefined;
        }
        const updates = new Array<{
            mapId: number;
            replaceStaticObjRenderData: boolean;
            staticObjRenderData?: ObjRenderData;
            hiddenStaticObjIndicesPacked?: Int32Array;
            appendDynamicObjRenders?: ReadonlyArray<{
                runtimeObjId: number;
                interactId: number;
                objRenderData: ObjRenderData;
            }>;
            removeDynamicRuntimeObjIdsPacked?: Int32Array;
            clearDynamicObjRenderData: boolean;
        }>(this.pendingRuntimeMapObjUpdatesByMapId.size | 0);
        let write = 0;
        for (const [mapId, pending] of this.pendingRuntimeMapObjUpdatesByMapId.entries()) {
            updates[write++] = {
                mapId: mapId | 0,
                replaceStaticObjRenderData: pending.replaceStaticObjRenderData,
                staticObjRenderData: pending.staticObjRenderData,
                hiddenStaticObjIndicesPacked:
                    (pending.hiddenStaticObjIndices.size | 0) > 0
                        ? Int32Array.from(pending.hiddenStaticObjIndices)
                        : undefined,
                appendDynamicObjRenders:
                    (pending.appendDynamicObjRenders.length | 0) > 0
                        ? pending.appendDynamicObjRenders
                        : undefined,
                removeDynamicRuntimeObjIdsPacked:
                    (pending.removeDynamicRuntimeObjIds.size | 0) > 0
                        ? Int32Array.from(pending.removeDynamicRuntimeObjIds)
                        : undefined,
                clearDynamicObjRenderData: pending.clearDynamicObjRenderData,
            };
        }
        this.pendingRuntimeMapObjUpdatesByMapId.clear();
        return buildMapObjRenderPacket(updates);
    }

    private getInputStateVersion(): WorkerInputStateVersion {
        return this.inputStateVersion | 0;
    }

    private consumePendingDynamicObjSnapshotMapIdsPacked(): Int32Array | undefined {
        if ((this.pendingDynamicObjSnapshotMapIds.size | 0) <= 0) {
            return undefined;
        }
        const packed = Int32Array.from(this.pendingDynamicObjSnapshotMapIds);
        this.pendingDynamicObjSnapshotMapIds.clear();
        return packed;
    }

    hasCompatibleInputStateVersion(inputStateVersion: number): boolean {
        return (this.getInputStateVersion() | 0) === (inputStateVersion | 0);
    }

    applyRenderFrameInputUpdate(update: RenderFrameInputUpdate): WorkerInputStateVersion {
        if (update.mapIds !== undefined) {
            this.setVisibleMapIds(update.mapIds);
        }
        if (update.viewState !== undefined) {
            this.setViewState(update.viewState);
        }
        if (update.hoveredMapIdsPacked !== undefined) {
            this.setHoveredMapIds(update.hoveredMapIdsPacked);
        }
        return this.getInputStateVersion();
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

    private setHoveredMapIds(hoveredMapIdsPacked: Int32Array): void {
        if ((hoveredMapIdsPacked.length | 0) <= 0) {
            this.hoveredMapIdsPacked = new Int32Array(0);
            return;
        }
        this.hoveredMapIdsPacked = Int32Array.from(hoveredMapIdsPacked);
    }

    async registerRenderMapRuntime(input: RenderMapRuntimeRegistrationInput): Promise<void> {
        const mapId = input.mapId | 0;
        const mapSimToken = input.mapSimToken;
        if (!this.workerMapRuntimeTracker.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        const workerState = await this.getWorkerState();
        const deps = createNpcSimStateStoreDeps(workerState);
        this.npcSimStateStore.registerMap(
            {
                mapId,
                borderSize: input.borderSize | 0,
                tileRenderFlagsLevel1: input.tileRenderFlagsLevel1,
                collisionDatas: [],
                locsAnimated: input.locsAnimated,
                npcTypeAnimationTable: input.npcTypeAnimationTable,
            },
            deps,
        );
        this.workerMapRuntimeTracker.clearMissingRuntimeStateWarning(mapId);
    }

    unregisterRenderMapRuntime(mapId: number, mapSimToken?: number): void {
        if (!this.workerMapRuntimeTracker.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        this.npcSimStateStore.unregisterMap(mapId);
        this.runtimeHiddenObjIndicesByMapId.delete(mapId | 0);
        this.runtimeDynamicObjStateByMapId.delete(mapId | 0);
        this.pendingRuntimeMapObjUpdatesByMapId.delete(mapId | 0);
        this.workerMapRuntimeTracker.clearMissingRuntimeStateWarning(mapId);
    }

    async applyWorldDeltaPacket(packet: WorldDeltaPacket): Promise<ApplyWorldDeltaResult> {
        const objStaticDelta = packet.obj?.static;
        const objDynamicDelta = packet.obj?.dynamic;
        let applied = this.applyRuntimeMapObjStateReplacements(objStaticDelta?.stateReplacements);
        applied = (applied + this.applyRuntimeMapObjRemovals(objStaticDelta?.removals)) | 0;
        applied = (applied + this.applyRuntimeMapObjAdditions(objStaticDelta?.additions)) | 0;
        applied =
            (applied +
                this.applyRuntimeClearDynamicMapObjRenderData(
                    objDynamicDelta?.clearDynamicMapIds,
                )) |
            0;
        applied =
            (applied + this.applyRuntimeDynamicMapObjDespawns(objDynamicDelta?.dynamicDespawns)) |
            0;
        applied =
            (applied +
                (await this.applyRuntimeDynamicMapObjUpdates(objDynamicDelta?.dynamicUpdates))) |
            0;
        applied =
            (applied +
                (await this.applyRuntimeDynamicMapObjSpawns(objDynamicDelta?.dynamicSpawns))) |
            0;
        const locAnimationDelta = packet.loc?.animation;
        const locStateDelta = packet.loc?.state;
        if (locStateDelta?.visibilityPacked instanceof Int32Array) {
            applied = (applied + this.npcSimStateStore.applyLocVisibilityChanges(packet)) | 0;
        }
        if (locAnimationDelta) {
            const packed = locAnimationDelta.animationResetPacked;
            let locResetCount = 0;
            for (let offset = 0; offset + 2 <= (packed.length | 0); offset += 2) {
                const mapId = packed[offset + 0] | 0;
                const locIndex = packed[offset + 1] | 0;
                this.pendingLocAnimationResetByLocKey.set(`${mapId}:${locIndex}`, {
                    mapId,
                    locIndex,
                });
                locResetCount = (locResetCount + 1) | 0;
                applied = (applied + 1) | 0;
            }
            const pausePacked = locAnimationDelta.animationPauseStatePacked;
            if (pausePacked instanceof Int32Array) {
                let locPauseCount = 0;
                for (
                    let offset = 0;
                    offset + LOC_ANIMATION_PAUSE_STATE_STRIDE <= (pausePacked.length | 0);
                    offset += LOC_ANIMATION_PAUSE_STATE_STRIDE
                ) {
                    const mapId = pausePacked[offset + 0] | 0;
                    const locIndex = pausePacked[offset + 1] | 0;
                    const paused = (pausePacked[offset + 2] | 0) !== 0;
                    this.pendingLocAnimationPauseStateByLocKey.set(`${mapId}:${locIndex}`, {
                        mapId,
                        locIndex,
                        paused,
                    });
                    locPauseCount = (locPauseCount + 1) | 0;
                    applied = (applied + 1) | 0;
                }
            }
            const snapshotPacked = locAnimationDelta.animationSnapshotPacked;
            if (snapshotPacked instanceof Int32Array) {
                applied = (applied + this.npcSimStateStore.applyLocAnimationSnapshots(packet)) | 0;
            }
        }
        if (((packet.npc?.state?.changeCount ?? 0) | 0) <= 0) {
            return {
                applied: applied | 0,
                obj: {
                    snapshotRequests: {
                        dynamic: this.consumePendingDynamicObjSnapshotMapIdsPacked(),
                    },
                },
                loc: {
                    snapshotRequests: {
                        animation: this.npcSimStateStore.consumePendingLocSnapshotMapIdsPacked(),
                    },
                },
            };
        }
        const workerState = await this.getWorkerState();
        const deps = createNpcSimStateStoreDeps(workerState);
        applied = (applied + (this.npcSimStateStore.applyWorldDeltaPacket(packet, deps) | 0)) | 0;
        return {
            applied: applied | 0,
            npc: {
                snapshotRequests: {
                    state: this.npcSimStateStore.consumePendingNpcSnapshotMapIdsPacked(),
                },
            },
            obj: {
                snapshotRequests: {
                    dynamic: this.consumePendingDynamicObjSnapshotMapIdsPacked(),
                },
            },
            loc: {
                snapshotRequests: {
                    animation: this.npcSimStateStore.consumePendingLocSnapshotMapIdsPacked(),
                },
            },
        };
    }

    private applyPendingLocAnimationResets(cycleNow: number): void {
        if ((this.pendingLocAnimationResetByLocKey.size | 0) <= 0) {
            return;
        }
        const resetCount = this.pendingLocAnimationResetByLocKey.size | 0;
        const animationResetPacked = new Int32Array((resetCount | 0) * 2);
        let write = 0;
        for (const reset of this.pendingLocAnimationResetByLocKey.values()) {
            animationResetPacked[write++] = reset.mapId | 0;
            animationResetPacked[write++] = reset.locIndex | 0;
        }
        this.pendingLocAnimationResetByLocKey.clear();
        const applied = this.npcSimStateStore.applyLocAnimationResets(
            {
                frameCount: 0,
                loc: {
                    animation: {
                        animationResetPacked,
                    },
                },
            },
            cycleNow | 0,
        );
    }

    private applyPendingLocAnimationPauseStates(): void {
        if ((this.pendingLocAnimationPauseStateByLocKey.size | 0) <= 0) {
            return;
        }
        const pauseCount = this.pendingLocAnimationPauseStateByLocKey.size | 0;
        const animationPauseStatePacked = new Int32Array(
            (pauseCount | 0) * LOC_ANIMATION_PAUSE_STATE_STRIDE,
        );
        let write = 0;
        for (const pauseState of this.pendingLocAnimationPauseStateByLocKey.values()) {
            animationPauseStatePacked[write++] = pauseState.mapId | 0;
            animationPauseStatePacked[write++] = pauseState.locIndex | 0;
            animationPauseStatePacked[write++] = pauseState.paused ? 1 : 0;
        }
        this.pendingLocAnimationPauseStateByLocKey.clear();
        const applied = this.npcSimStateStore.applyLocAnimationPauseStates({
            frameCount: 0,
            loc: {
                animation: {
                    animationResetPacked: new Int32Array(0),
                    animationPauseStatePacked,
                },
            },
        });
    }

    private normalizeFrameBuildInputs(
        frameCount: number,
        clientTicksElapsed: number,
        hoveredMapIdsPacked: Int32Array,
    ): FrameBuildInputs {
        const hoveredMapIds = new Set<number>();
        for (let index = 0; index < hoveredMapIdsPacked.length; index++) {
            hoveredMapIds.add(hoveredMapIdsPacked[index] | 0);
        }
        return {
            safeClientTicks: Math.max(0, Math.min(clientTicksElapsed | 0, 50)),
            hoveredMapIds,
            npcRingWriteIndex: (frameCount | 0) % NPC_DATA_TEXTURE_RING_SIZE,
        };
    }

    private async runWasmTickIfEnabled(
        workerState: FrameWorkerState,
        mapIds: Int32Array,
        cycleNow: number,
        safeClientTicks: number,
    ): Promise<WasmTickStreams> {
        const isEnabled =
            workerState.mapRenderBackend.kind === "wasm" &&
            typeof tickWasmBridge.tickMapsEmitPatchStreams === "function";
        if (!isEnabled) {
            return {
                isEnabled: false,
                tickPatchCountsByMapId: undefined,
                tickPatchPacked: undefined,
            };
        }

        const handle = workerState.mapRenderBackend.getWasmRuntimeHandle?.();
        if (handle === undefined) {
            throw new Error("[map-render][tick][wasm] map-render runtime handle missing");
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
                "[map-render][tick][wasm] tickMapsEmitPatchStreams returned invalid data",
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
    ): RenderFramePacketMapEntry {
        if (this.workerMapRuntimeTracker.consumeMissingRuntimeStateWarning(mapId)) {
            const { mapX, mapY } = decodeMapSquareFromId(mapId);
            console.warn(
                `[map-render][frame] missing worker runtime state for visible map ${mapX},${mapY} ` +
                    `(mapId=${mapId | 0} index=${mapEntryIndex | 0} backend=${backendKind})`,
            );
        }
        return buildRenderFramePacketMapEntry({
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
                `[map-render][tick][wasm] wasm patch read mismatch ` +
                    `readOff=${wasmReadOff | 0} packedLen=${tickPatchPacked.length | 0}`,
            );
        }
    }

    private toNpcGpuFrameSources(
        npcs: ReadonlyArray<{
            x: number;
            y: number;
            level: number;
            rotation: number;
            instanceId?: number;
            npcType: { id: number };
        }>,
    ): ReadonlyArray<NpcGpuFrameSource> {
        const count = npcs.length | 0;
        this.npcGpuFrameSourceScratch.length = count;
        for (let index = 0; index < count; index++) {
            const npc = npcs[index]!;
            this.npcGpuFrameSourceScratch[index] = {
                x: npc.x,
                y: npc.y,
                level: npc.level,
                rotation: npc.rotation,
                npcInstanceId: npc.instanceId ?? -1,
                npcTypeId: npc.npcType.id,
            };
        }
        return this.npcGpuFrameSourceScratch;
    }

    async buildRenderFramePacket(
        frameCount: number,
        cycleNow: number,
    ): Promise<RenderFramePacket | undefined> {
        const mapIds = this.visibleMapIds;
        if ((mapIds.length | 0) <= 0) {
            return undefined;
        }
        const workerState = await this.getWorkerState();
        this.applyPendingLocAnimationPauseStates();
        this.applyPendingLocAnimationResets(cycleNow | 0);
        const backendKind = workerState.mapRenderBackend.kind ?? "unknown";
        const inputs = this.normalizeFrameBuildInputs(frameCount, 0, this.hoveredMapIdsPacked);
        const view = this.viewState;
        const wasmTick = await this.runWasmTickIfEnabled(
            workerState,
            mapIds,
            cycleNow,
            inputs.safeClientTicks,
        );
        const { seqFrameLoader } = workerState.runtimeAdapter.getNpcAnimationDeps();
        this.npcGpuFrameBuilder.beginFrame();
        const entries = new Array<RenderFramePacketMapEntry>(mapIds.length | 0);
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

            const npcRange = this.npcGpuFrameBuilder.addMapNpcs(
                this.toNpcGpuFrameSources(state.npcs),
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
            entries[mapEntryIndex] = buildRenderFramePacketMapEntry({
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
        const npcInteractionMetaPacked = this.npcGpuFrameBuilder.flushInteractionMetaPacked();
        return buildRenderFramePacketFromMapEntries({
            frameCount: frameCount | 0,
            inputStateVersion: this.inputStateVersion | 0,
            npcRingWriteIndex: inputs.npcRingWriteIndex | 0,
            npcGpuFrameData,
            npcInteractionMetaPacked,
            entries,
            runtimeRenderUpdates: this.consumePendingRuntimeMapObjRenderPacket(),
        });
    }
}
