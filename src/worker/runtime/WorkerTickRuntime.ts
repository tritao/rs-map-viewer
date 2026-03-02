import type { CollisionData } from "../../rs/scene/CollisionMap";
import type { MapBytesProvider } from "../../rs/map/MapBytesProvider";
import type { LocAnimatedData } from "../../runtime/entities/LocAnimatedData";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../../runtime/contracts/NpcGpuFrame";
import { decodeNpcLifecyclePacket } from "../../runtime/contracts/NpcLifecyclePacket";
import type { FramePacket } from "../../runtime/contracts/FramePacket";
import {
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
} from "../../runtime/contracts/FramePacket";
import {
    buildFramePacketMapEntry,
    buildFramePacketFromMapEntries,
    type FramePacketMapEntry,
} from "../../runtime/contracts/FramePacketBuilder";
import type { CacheSession } from "../../rs/loaders/CacheSession";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { Pathfinder } from "../../rs/pathfinder/Pathfinder";
import { LOC_CYCLE_SCALE } from "../../wasm/LocCycle";
import { mapRenderRuntimeBridge } from "../../wasm/rs_map_render_backend_bridge.mjs";
import type { MapRenderDataBackend, MapRenderDataBackendKind } from "../MapRenderDataBackend";
import {
    buildTickPatchStreamsForMap,
    readWasmPatchStreamsForMap,
} from "./TickPatchStreamsBuilder";
import { applyNpcMovementStep } from "../../runtime/sim/NpcSimMovement";
import { NpcGpuFrameBuilder, type NpcGpuFrameSource } from "./NpcGpuFrameBuilder";
import {
    NpcSimStateStore,
    type NpcSimStateStoreDeps,
} from "../../runtime/sim/NpcSimStateStore";
import type { NpcTypeAnimationEntry } from "../../runtime/contracts/NpcTypeAnimationTable";
import {
    NpcBootstrapResolver,
    type ResolvedNpcBootstrapData,
} from "../../runtime/sim/NpcBootstrapResolver";

type WorkerTickRuntimeOptions = Readonly<{
    mapRenderBackend?: MapRenderDataBackendKind;
}>;

type TickWorkerState = Readonly<{
    session: CacheSession;
    mapBytesProvider: MapBytesProvider;
    mapRenderDataBackend: MapRenderDataBackend;
}>;

type TickFrameInputs = Readonly<{
    safeTicksElapsed: number;
    safeClientTicks: number;
    safeLodDistance: number;
    hoveredMapIds: ReadonlySet<number>;
    npcRingWriteIndex: number;
}>;

type WasmTickStreams = Readonly<{
    isEnabled: boolean;
    tickPatchCountsByMapId: Int32Array | undefined;
    tickPatchPacked: Int32Array | undefined;
}>;

const tickWasmBridge = mapRenderRuntimeBridge;

function decodeMapSquareFromId(mapId: number): Readonly<{ mapX: number; mapY: number }> {
    return {
        mapX: (mapId >> 8) & 0xff,
        mapY: mapId & 0xff,
    };
}

function shouldUseWasmTickInWorker(options: WorkerTickRuntimeOptions | undefined): boolean {
    return options?.mapRenderBackend === "cpp-wasm";
}

function createNpcSimStateStoreDeps(workerState: TickWorkerState): NpcSimStateStoreDeps {
    return {
        npcTypeLoader: workerState.session.loaders.npcTypeLoader as NpcTypeLoader,
        basTypeLoader: workerState.session.loaders.basTypeLoader as BasTypeLoader,
        seqTypeLoader: workerState.session.loaders.seqTypeLoader as SeqTypeLoader,
        tickPatchEntryStride: TICK_PATCH_ENTRY_STRIDE,
    };
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
    private readonly npcBootstrapResolver = new NpcBootstrapResolver();
    private readonly npcSimStateStore = new NpcSimStateStore();
    private readonly npcSimPathfinder = new Pathfinder();
    private readonly npcGpuFrameBuilder = new NpcGpuFrameBuilder();
    private readonly workerMapSimLifecycle = new WorkerMapSimLifecycle();
    private readonly warnedEmptyNpcBootstrapMapIds = new Set<number>();
    private options: WorkerTickRuntimeOptions | undefined;

    constructor(private readonly getWorkerState: () => Promise<TickWorkerState>) {}

    setRuntimeOptions(options: WorkerTickRuntimeOptions | undefined): void {
        this.options = options;
    }

    resetForCache(): void {
        this.npcSimStateStore.resetForCache();
        this.npcBootstrapResolver.reset();
        this.workerMapSimLifecycle.reset();
        this.warnedEmptyNpcBootstrapMapIds.clear();
    }

    resetForLoaderReset(): void {
        this.npcSimStateStore.resetForLoaderReset();
        this.npcBootstrapResolver.reset();
        this.workerMapSimLifecycle.reset();
        this.warnedEmptyNpcBootstrapMapIds.clear();
    }

    private async resolveNpcBootstrapData(
        workerState: TickWorkerState,
        mapId: number,
        maxLevel: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        npcOrderKeys: Int32Array,
    ): Promise<ResolvedNpcBootstrapData> {
        return this.npcBootstrapResolver.resolve(
            {
                mapBytesProvider: workerState.mapBytesProvider,
                cacheInfo: workerState.session.cache.info,
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

    async registerMapNpcSimState(
        mapId: number,
        maxLevel: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        collisionDatas: CollisionData[],
        locsAnimated: LocAnimatedData[],
        npcOrderKeys: Int32Array,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        if (!this.workerMapSimLifecycle.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
        const workerState = await this.getWorkerState();
        const resolvedBootstrap = await this.resolveNpcBootstrapData(
            workerState,
            mapId,
            maxLevel,
            borderSize,
            tileRenderFlagsLevel1,
            npcOrderKeys,
        );
        const deps = createNpcSimStateStoreDeps(workerState);
        const npcBootstrapData = resolvedBootstrap.data;
        this.npcSimStateStore.registerMap(
            {
                mapId,
                borderSize,
                tileRenderFlagsLevel1,
                collisionDatas,
                locsAnimated,
                npcTypeAnimationTable,
            },
            deps,
        );
        this.npcSimStateStore.applyMapNpcLifecycleEvents(
            mapId | 0,
            npcBootstrapData.spawnEvents,
            deps,
            true,
        );
        const state = this.npcSimStateStore.getMap(mapId | 0);
        const spawnEventCount = npcBootstrapData.spawnEvents.length | 0;
        const npcCount = state ? (state.npcs.length | 0) : 0;
        if (!this.warnedEmptyNpcBootstrapMapIds.has(mapId | 0)) {
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
                        `fallbackMapAllLvls=${resolvedBootstrap.fallbackMapSpawnsAllLevelsCount ?? -1})`,
                );
            } else if (npcCount <= 0) {
                this.warnedEmptyNpcBootstrapMapIds.add(mapId | 0);
                const firstTypeId = npcBootstrapData.spawnEvents[0]!.npcTypeId | 0;
                const npcTypeOk = deps.npcTypeLoader.tryLoad(firstTypeId).ok ? 1 : 0;
                const npcTypeCount = deps.npcTypeLoader.getCount?.() ?? -1;
                console.warn(
                    `[map-render][npc] bootstrap events produced 0 npc instances for mapId=${mapId | 0} ` +
                        `(source=${resolvedBootstrap.source} events=${spawnEventCount} firstType=${firstTypeId} ` +
                        `npcTypeOk=${npcTypeOk} npcTypeCount=${npcTypeCount | 0})`,
                );
            }
        }
        this.workerMapSimLifecycle.clearMissingTickStateWarning(mapId);
    }

    unregisterMapNpcSimState(mapId: number, mapSimToken?: number): void {
        if (!this.workerMapSimLifecycle.tryAcceptMapSimToken(mapId, mapSimToken)) {
            return;
        }
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
                    (this.npcSimStateStore.applyMapNpcLifecycleEvents(
                        mapId | 0,
                        events,
                        deps,
                    ) | 0)) |
                0;
        }
        return applied | 0;
    }

    private normalizeTickFrameInputs(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        lodDistance: number,
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
            safeLodDistance: Math.max(0, lodDistance | 0),
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
            shouldUseWasmTickInWorker(this.options) &&
            typeof tickWasmBridge.tickMapsEmitPatchStreams === "function";
        if (!isEnabled) {
            return {
                isEnabled: false,
                tickPatchCountsByMapId: undefined,
                tickPatchPacked: undefined,
            };
        }

        const handle = workerState.mapRenderDataBackend.getCppWasmRuntimeHandle?.();
        if (handle === undefined) {
            throw new Error("[map-render][tick][cpp-wasm] map-render runtime handle missing");
        }
        const cycleNowFixed = Math.round(cycleNow * LOC_CYCLE_SCALE) | 0;
        const wasmTick = tickWasmBridge.tickMapsEmitPatchStreams?.(
            handle,
            mapIds,
            cycleNowFixed,
            safeClientTicks,
        ) as Readonly<{ tickPatchCountsByMapId: Int32Array; tickPatchPacked: Int32Array }> | null;
        if (!wasmTick) {
            throw new Error("[map-render][tick][cpp-wasm] tickMapsEmitPatchStreams failed");
        }
        return {
            isEnabled: true,
            tickPatchCountsByMapId: wasmTick.tickPatchCountsByMapId,
            tickPatchPacked: wasmTick.tickPatchPacked,
        };
    }

    private buildMissingStateMapEntry(
        mapId: number,
        mapEntryIndex: number,
        cameraMapX: number,
        cameraMapY: number,
        safeLodDistance: number,
        hoveredMapIds: ReadonlySet<number>,
    ): FramePacketMapEntry {
        if (this.workerMapSimLifecycle.consumeMissingTickStateWarning(mapId)) {
            const { mapX, mapY } = decodeMapSquareFromId(mapId);
            console.warn(
                `[map-render][tick] missing worker sim state for visible map ${mapX},${mapY} ` +
                    `(mapId=${mapId | 0} index=${mapEntryIndex | 0} backend=${
                        this.options?.mapRenderBackend ?? "unknown"
                    })`,
            );
        }
        return buildFramePacketMapEntry({
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
    ): Promise<FramePacket | undefined> {
        if (!(mapIds instanceof Int32Array) || mapIds.length === 0) {
            return undefined;
        }

        const workerState = await this.getWorkerState();
        const inputs = this.normalizeTickFrameInputs(
            frameCount,
            ticksElapsed,
            clientTicksElapsed,
            lodDistance,
            hoveredMapIdsPacked,
        );
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
                    cameraMapX,
                    cameraMapY,
                    inputs.safeLodDistance,
                    inputs.hoveredMapIds,
                );
                continue;
            }
            const hasNpcs = (state.npcs.length | 0) > 0;

            applyNpcMovementStep(
                state,
                this.npcSimPathfinder,
                inputs.safeTicksElapsed,
                inputs.safeClientTicks,
                seqTypeLoader,
                seqFrameLoader,
            );

            const target: NpcGpuFrameSource = {
                id: mapId | 0,
                getNpcs: () => state.npcs,
                getTileRenderFlag: (_level: number, tileX: number, tileY: number): number => {
                    const col = state.tileRenderFlagsLevel1[(tileX + state.borderSize) | 0];
                    return col ? col[(tileY + state.borderSize) | 0] | 0 : 0;
                },
            };
            const npcOffset = this.npcGpuFrameBuilder.addRenderable(target);

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
                cameraMapX,
                cameraMapY,
                lodDistance: inputs.safeLodDistance,
                hoveredMapIds: inputs.hoveredMapIds,
                hasNpcs,
                npcOffset: npcOffset | 0,
                tickPatchCounts: tickPatchesForMap.streamCounts,
                tickPatchStreams: tickPatchesForMap.streamsForMap,
            });
        }
        this.validateWasmPatchRead(wasmReadOff, wasmCountsByMapId, wasmPatchesPacked);

        const npcGpuFrameData = this.npcGpuFrameBuilder.flushPacked();
        return buildFramePacketFromMapEntries({
            frameCount: frameCount | 0,
            npcRingWriteIndex: inputs.npcRingWriteIndex | 0,
            npcGpuFrameData,
            entries,
        });
    }
}
