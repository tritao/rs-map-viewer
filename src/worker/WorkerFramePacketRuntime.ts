import type { MapRenderBackend } from "../maprender/MapRenderBackend";
import type { BasTypeLoader } from "../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import type { CacheSession } from "../rs/loaders/CacheSession";
import type { FramePacket } from "../runtime/packets/FramePacket";
import {
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
} from "../runtime/packets/FramePacket";
import {
    type FramePacketMapEntry,
    buildFramePacketFromMapEntries,
    buildFramePacketMapEntry,
} from "../runtime/FramePacketBuilder";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../runtime/packets/NpcGpuFrame";
import type { NpcStateDeltaPacket } from "../runtime/packets/NpcStateDeltaPacket";
import type { NpcTypeAnimationEntry } from "../runtime/NpcTypeAnimationTable";
import type { MapObjRenderPacket } from "../runtime/packets/MapObjRenderPacket";
import { buildMapObjRenderPacket } from "../runtime/packets/MapObjRenderPacket";
import type { LocAnimatedData } from "../runtime/LocAnimatedData";
import type { ObjRenderData } from "../maprender/MapRenderPayload";
import { NpcGpuFrameBuilder } from "../runtime/entities/NpcGpuFrameBuilder";
import { NpcSimStateStore, type NpcSimStateStoreDeps } from "../runtime/sim/NpcSimStateStore";
import {
    buildTickPatchStreamsForMap,
    readWasmPatchStreamsForMap,
} from "../runtime/sim/TickPatchStreamsBuilder";
import { LOC_CYCLE_SCALE } from "../wasm/LocCycle";
import type { MapRenderRuntimeHandle } from "../wasm/MapRenderRuntimeBridgeAbi";
import { mapRenderRuntimeBridge } from "../wasm/rs_map_runtime_bridge.mjs";
import { WorkerMapSimLifecycle } from "./WorkerShared";

type FrameWorkerState = Readonly<{
    session: CacheSession;
    mapRenderBackend: Readonly<{
        kind: MapRenderBackend["kind"];
        getCppWasmRuntimeHandle?: () => MapRenderRuntimeHandle | undefined;
    }>;
}>;

type TickViewState = Readonly<{
    cameraMapX: number;
    cameraMapY: number;
    lodDistance: number;
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
    private readonly workerMapSimLifecycle = new WorkerMapSimLifecycle();
    private tickMapIds: Int32Array = new Int32Array(0);
    private tickMapIdsVersion: number = 0;
    private tickViewStateVersion: number = 0;
    private tickViewState: TickViewState = {
        cameraMapX: 0,
        cameraMapY: 0,
        lodDistance: 0,
    };
    private tickHoveredMapIdsPacked: Int32Array = new Int32Array(0);
    private readonly pendingObjRenderDataByMapId = new Map<number, ObjRenderData | undefined>();

    constructor(private readonly getWorkerState: () => Promise<FrameWorkerState>) {}

    resetForCache(): void {
        this.resetState(() => this.npcSimStateStore.resetForCache());
    }

    resetForLoaderReset(): void {
        this.resetState(() => this.npcSimStateStore.resetForLoaderReset());
    }

    private resetState(resetNpcStateStore: () => void): void {
        resetNpcStateStore();
        this.workerMapSimLifecycle.reset();
        this.tickMapIds = new Int32Array(0);
        this.tickMapIdsVersion = 0;
        this.tickViewStateVersion = 0;
        this.tickViewState = { cameraMapX: 0, cameraMapY: 0, lodDistance: 0 };
        this.tickHoveredMapIdsPacked = new Int32Array(0);
        this.pendingObjRenderDataByMapId.clear();
    }

    applyMapObjRenderPacket(packet: MapObjRenderPacket | undefined): number {
        if (!packet) {
            return 0;
        }
        const updates = packet.updates;
        let applied = 0;
        for (let index = 0; index < updates.length; index++) {
            const update = updates[index];
            if (!update) {
                continue;
            }
            this.pendingObjRenderDataByMapId.set(update.mapId | 0, update.objRenderData);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    private consumePendingMapObjRenderPacket(): MapObjRenderPacket | undefined {
        if ((this.pendingObjRenderDataByMapId.size | 0) <= 0) {
            return undefined;
        }
        const updates = new Array<{
            mapId: number;
            objRenderData?: ObjRenderData;
        }>(this.pendingObjRenderDataByMapId.size | 0);
        let write = 0;
        for (const [mapId, objRenderData] of this.pendingObjRenderDataByMapId.entries()) {
            updates[write++] = {
                mapId: mapId | 0,
                objRenderData,
            };
        }
        this.pendingObjRenderDataByMapId.clear();
        return buildMapObjRenderPacket(updates);
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

    async registerMapRuntime(
        mapId: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        if (!this.workerMapSimLifecycle.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        const workerState = await this.getWorkerState();
        const deps = createNpcSimStateStoreDeps(workerState);
        this.npcSimStateStore.registerMap(
            {
                mapId,
                borderSize,
                tileRenderFlagsLevel1,
                collisionDatas: [],
                locsAnimated,
                npcTypeAnimationTable,
            },
            deps,
        );
        this.workerMapSimLifecycle.clearMissingTickStateWarning(mapId);
    }

    unregisterMapRuntime(mapId: number, mapSimToken?: number): void {
        if (!this.workerMapSimLifecycle.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        this.npcSimStateStore.unregisterMap(mapId);
        this.workerMapSimLifecycle.clearMissingTickStateWarning(mapId);
    }

    async applyNpcStateDeltaPacket(packet: NpcStateDeltaPacket): Promise<number> {
        if ((packet.eventCount | 0) <= 0) {
            return 0;
        }
        const workerState = await this.getWorkerState();
        const deps = createNpcSimStateStoreDeps(workerState);
        return this.npcSimStateStore.applyNpcStateDeltaPacket(packet, deps) | 0;
    }

    private normalizeTickFrameInputs(
        frameCount: number,
        clientTicksElapsed: number,
        hoveredMapIdsPacked: Int32Array,
    ): FrameBuildInputs {
        const hoveredMapIds = new Set<number>();
        if (hoveredMapIdsPacked instanceof Int32Array) {
            for (let index = 0; index < hoveredMapIdsPacked.length; index++) {
                hoveredMapIds.add(hoveredMapIdsPacked[index] | 0);
            }
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

    async buildFramePacketFromCurrentState(
        frameCount: number,
        cycleNow: number,
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
        const inputs = this.normalizeTickFrameInputs(frameCount, 0, this.tickHoveredMapIdsPacked);
        const view = this.tickViewState;
        const wasmTick = await this.runWasmTickIfEnabled(
            workerState,
            mapIds,
            cycleNow,
            inputs.safeClientTicks,
        );
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
            runtimeRenderUpdates: this.consumePendingMapObjRenderPacket(),
        });
    }
}
