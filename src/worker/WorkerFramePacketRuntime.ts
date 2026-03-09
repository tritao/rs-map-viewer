import type { MapRenderBackend } from "../maprender/MapRenderBackend";
import type { BasTypeLoader } from "../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import type { CacheSession } from "../rs/loaders/CacheSession";
import {
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
} from "../shared/TickPatchLayout";
import {
    type RenderFramePacketMapEntry,
    buildRenderFramePacketFromMapEntries,
    buildRenderFramePacketMapEntry,
} from "../renderer/RenderFramePacketBuilder";
import type { RenderFramePacket } from "../renderer/RenderFramePacket";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../renderer/NpcGpuFrame";
import type {
    WorldDeltaPacket,
    WorldLocAnimationReset,
    WorldMapObjUpdate,
} from "../runtime/packets/WorldDeltaPacket";
import type { MapObjRenderPacket } from "../renderer/MapObjRenderPacket";
import { buildMapObjRenderPacket } from "../renderer/MapObjRenderPacket";
import type { ObjRenderData } from "../maprender/MapRenderPayload";
import { NpcGpuFrameBuilder, type NpcGpuFrameSource } from "../renderer/NpcGpuFrameBuilder";
import { NpcSimStateStore, type NpcSimStateStoreDeps } from "../runtime/sim/NpcSimStateStore";
import {
    buildTickPatchStreamsForMap,
    readWasmPatchStreamsForMap,
} from "../runtime/sim/TickPatchStreamsBuilder";
import { LOC_CYCLE_SCALE } from "../wasm/LocCycle";
import type { MapRenderRuntimeHandle } from "../wasm/MapRenderRuntimeBridgeAbi";
import { mapRenderRuntimeBridge } from "../wasm/rs_map_runtime_bridge.mjs";
import {
    type RenderFrameInputUpdate,
    type RenderMapRuntimeRegistrationInput,
    type WorkerInputStateVersion,
    type WorkerViewState,
    WorkerMapRuntimeTracker,
} from "./WorkerContext";
import { mapObjStateToRenderData } from "../shared/StaticMapPacket";

type FrameWorkerState = Readonly<{
    session: CacheSession;
    mapRenderBackend: Readonly<{
        kind: MapRenderBackend["kind"];
        getCppWasmRuntimeHandle?: () => MapRenderRuntimeHandle | undefined;
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
    private readonly pendingRuntimeObjRenderDataByMapId = new Map<number, ObjRenderData | undefined>();
    private readonly pendingLocAnimationResetByLocKey = new Map<string, WorldLocAnimationReset>();
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
        this.pendingRuntimeObjRenderDataByMapId.clear();
        this.pendingLocAnimationResetByLocKey.clear();
    }

    private applyRuntimeMapObjUpdates(updates: ReadonlyArray<WorldMapObjUpdate> | undefined): number {
        if (!updates) {
            return 0;
        }
        let applied = 0;
        for (let index = 0; index < updates.length; index++) {
            const update = updates[index];
            if (!update) {
                continue;
            }
            if (update.kind !== "replaceMapObjState") {
                continue;
            }
            this.pendingRuntimeObjRenderDataByMapId.set(
                update.mapId | 0,
                mapObjStateToRenderData(update.mapObjState),
            );
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private consumePendingRuntimeMapObjRenderPacket(): MapObjRenderPacket | undefined {
        if ((this.pendingRuntimeObjRenderDataByMapId.size | 0) <= 0) {
            return undefined;
        }
        const updates = new Array<{
            mapId: number;
            objRenderData?: ObjRenderData;
        }>(this.pendingRuntimeObjRenderDataByMapId.size | 0);
        let write = 0;
        for (const [mapId, objRenderData] of this.pendingRuntimeObjRenderDataByMapId.entries()) {
            updates[write++] = {
                mapId: mapId | 0,
                objRenderData,
            };
        }
        this.pendingRuntimeObjRenderDataByMapId.clear();
        return buildMapObjRenderPacket(updates);
    }

    private getInputStateVersion(): WorkerInputStateVersion {
        return this.inputStateVersion | 0;
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
        this.workerMapRuntimeTracker.clearMissingRuntimeStateWarning(mapId);
    }

    async applyWorldDeltaPacket(packet: WorldDeltaPacket): Promise<number> {
        let applied = this.applyRuntimeMapObjUpdates(packet.objDelta?.updates);
        const locDelta = packet.locDelta;
        if (locDelta) {
            const packed = locDelta.animationResetPacked;
            for (let offset = 0; offset + 2 <= (packed.length | 0); offset += 2) {
                const mapId = packed[offset + 0] | 0;
                const locIndex = packed[offset + 1] | 0;
                this.pendingLocAnimationResetByLocKey.set(`${mapId}:${locIndex}`, {
                    mapId,
                    locIndex,
                });
                applied = (applied + 1) | 0;
            }
        }
        if (((packet.npcState?.changeCount ?? 0) | 0) <= 0) {
            return applied | 0;
        }
        const workerState = await this.getWorkerState();
        const deps = createNpcSimStateStoreDeps(workerState);
        applied = (applied + (this.npcSimStateStore.applyWorldDeltaPacket(packet, deps) | 0)) | 0;
        return applied | 0;
    }

    private applyPendingLocAnimationResets(cycleNow: number): void {
        if ((this.pendingLocAnimationResetByLocKey.size | 0) <= 0) {
            return;
        }
        const animationResetPacked = new Int32Array(
            (this.pendingLocAnimationResetByLocKey.size | 0) * 2,
        );
        let write = 0;
        for (const reset of this.pendingLocAnimationResetByLocKey.values()) {
            animationResetPacked[write++] = reset.mapId | 0;
            animationResetPacked[write++] = reset.locIndex | 0;
        }
        this.pendingLocAnimationResetByLocKey.clear();
        this.npcSimStateStore.applyLocAnimationResets(
            {
                frameCount: 0,
                locDelta: {
                    animationResetPacked,
                },
            },
            cycleNow | 0,
        );
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
                `[map-render][tick][cpp-wasm] wasm patch read mismatch ` +
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
        const seqFrameLoader = workerState.session.loaders.seqFrameLoader;
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
        return buildRenderFramePacketFromMapEntries({
            frameCount: frameCount | 0,
            inputStateVersion: this.inputStateVersion | 0,
            npcRingWriteIndex: inputs.npcRingWriteIndex | 0,
            npcGpuFrameData,
            entries,
            runtimeRenderUpdates: this.consumePendingRuntimeMapObjRenderPacket(),
        });
    }
}
