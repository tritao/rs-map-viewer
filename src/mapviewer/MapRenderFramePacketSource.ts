import type { CacheSession } from "../rs/loaders/CacheSession";
import type { Pathfinder } from "../rs/pathfinder/Pathfinder";
import { MapRenderer, type MapSquareRenderable } from "../renderer/MapRenderer";
import type { MapData } from "../renderer/loader/MapData";
import {
    TICK_PATCH_STREAM_COUNT,
    type FramePacket,
} from "../runtime/contracts/FramePacket";
import { NPC_DATA_TEXTURE_RING_SIZE } from "../runtime/entities/NpcGpuData";
import { NpcGpuDataBuilder } from "../runtime/entities/NpcGpuDataBuilder";
import { LocTickPatchVariant, NpcTickPatchVariant } from "../runtime/contracts/TickPatchStreams";
import { TickController, type TickPatchSink } from "../runtime/tick/TickController";
import {
    buildFramePacketFromMapEntries,
    buildFramePacketMapEntry,
    type FramePacketMapEntry,
} from "../runtime/tick/MainThreadFramePacketBuilder";
import type { MapRuntimeStateStore } from "../runtime/MapRuntimeStateStore";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { Camera } from "./Camera";
import type { MapManager } from "./MapManager";
import type { SimWorld } from "./SimWorld";

const EMPTY_INT32 = new Int32Array(0);

export type TickFrameInput = Readonly<{
    frameCount: number;
    cycle: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
}>;

export interface MapRenderFramePacketSource {
    nextPacket(input: TickFrameInput): FramePacket | undefined;
    reset(): void;
}

type MainThreadFramePacketSourceDeps = Readonly<{
    getRenderer(): MapRenderer<MapSquareRenderable, MapData>;
    getMapManager(): MapManager;
    getCamera(): Camera;
    getRuntimeStateStore(): MapRuntimeStateStore;
    getSession(): CacheSession;
    tickController: TickController;
    simWorld: SimWorld;
    npcGpuDataBuilder: NpcGpuDataBuilder;
    pathfinder: Pathfinder;
}>;

export class MainThreadFramePacketSource implements MapRenderFramePacketSource {
    constructor(private readonly deps: MainThreadFramePacketSourceDeps) {}

    nextPacket(input: TickFrameInput): FramePacket {
        const renderer = this.deps.getRenderer();
        const mapManager = this.deps.getMapManager();
        const runtimeStateStore = this.deps.getRuntimeStateStore();
        const session = this.deps.getSession();
        const camera = this.deps.getCamera();

        this.deps.npcGpuDataBuilder.beginFrame();

        const cameraMapX = camera.getMapX();
        const cameraMapY = camera.getMapY();
        const visibleCount = mapManager.visibleMapCount | 0;
        const entries = new Array<FramePacketMapEntry>(visibleCount | 0);
        const hoveredMapIds = this.getHoveredMapIds(renderer);

        const seqFrameLoader = session.getSeqFrameLoader();
        const seqTypeLoader = session.getSeqTypeLoader();

        for (let i = 0; i < visibleCount; i++) {
            const mapInfo = mapManager.visibleMaps[i];
            const mapId = mapInfo.mapId | 0;
            const streamsForMap = new Array<number[] | undefined>(TICK_PATCH_STREAM_COUNT);
            const streamCounts = new Int32Array(TICK_PATCH_STREAM_COUNT);
            let hasNpcs = false;
            let npcOffset = -1;
            const map = renderer.getMap(mapInfo.mapId)!;
            if (map && map.canRender(input.frameCount)) {
                const tickState = runtimeStateStore.getTickState(mapId);
                const mapNpcs = tickState?.getNpcs() ?? [];
                if ((mapNpcs.length | 0) > 0) {
                    hasNpcs = true;
                }
                this.deps.simWorld.tickNpcMovement(
                    mapInfo.mapId,
                    this.deps.pathfinder,
                    map.borderSize,
                    mapNpcs,
                    input.ticksElapsed,
                );
                if (tickState) {
                    this.deps.tickController.tickRenderable(
                        tickState,
                        input.cycle,
                        input.clientTicksElapsed,
                        seqTypeLoader,
                        seqFrameLoader,
                        this.createTickPatchSink(streamCounts, streamsForMap),
                    );
                }

                if (renderer.loadNpcs) {
                    const target = runtimeStateStore.createNpcGpuDataTarget(
                        mapId,
                        (level: number, tileX: number, tileY: number): number =>
                            map.getTileRenderFlag(level, tileX, tileY),
                    );
                    if (target) {
                        npcOffset = this.deps.npcGpuDataBuilder.addRenderable(target);
                    }
                }
            }

            entries[i] = buildFramePacketMapEntry({
                mapId,
                cameraMapX,
                cameraMapY,
                lodDistance: renderer.lodDistance,
                hoveredMapIds,
                hasNpcs,
                npcOffset,
                tickPatchCounts: streamCounts,
                tickPatchStreams: streamsForMap,
            });
        }

        const npcGpuFrameData = renderer.loadNpcs
            ? this.deps.npcGpuDataBuilder.flushPacked()
            : { width: 16, height: 1, data: new Uint16Array(16 * 4) };
        const frameCount = input.frameCount | 0;
        return buildFramePacketFromMapEntries({
            frameCount,
            npcRingWriteIndex: frameCount % NPC_DATA_TEXTURE_RING_SIZE,
            npcGpuFrameData,
            entries,
        });
    }

    reset(): void {}

    private getHoveredMapIds(
        renderer: MapRenderer<MapSquareRenderable, MapData>,
    ): Set<number> {
        const packed =
            renderer.getInteractionSnapshotRenderer?.()?.getHoveredMapIdsPacked() ?? EMPTY_INT32;
        const out = new Set<number>();
        for (let i = 0; i < packed.length; i++) {
            out.add(packed[i] | 0);
        }
        return out;
    }

    private createTickPatchSink(
        streamCounts: Int32Array,
        streamsForMap: (number[] | undefined)[],
    ): TickPatchSink {
        return {
            emitLocPatch: (
                variant: LocTickPatchVariant,
                drawRangeIndex: number,
                offset: number,
                elements: number,
                instances: number,
            ): void => {
                if ((drawRangeIndex | 0) < 0) {
                    return;
                }
                const streamIndex = variant as number;
                streamCounts[streamIndex] = (streamCounts[streamIndex] + 1) | 0;
                let stream = streamsForMap[streamIndex];
                if (!stream) {
                    stream = [];
                    streamsForMap[streamIndex] = stream;
                }
                stream.push(drawRangeIndex | 0, offset | 0, elements | 0, instances | 0);
            },
            emitNpcPatch: (
                variant: NpcTickPatchVariant,
                drawRangeIndex: number,
                offset: number,
                elements: number,
                instances: number,
            ): void => {
                if ((drawRangeIndex | 0) < 0) {
                    return;
                }
                const streamIndex = (8 + (variant as number)) | 0;
                streamCounts[streamIndex] = (streamCounts[streamIndex] + 1) | 0;
                let stream = streamsForMap[streamIndex];
                if (!stream) {
                    stream = [];
                    streamsForMap[streamIndex] = stream;
                }
                stream.push(drawRangeIndex | 0, offset | 0, elements | 0, instances | 0);
            },
        };
    }
}

type WorkerFramePacketSourceDeps = Readonly<{
    workerPool: RenderDataWorkerPool;
    getRenderer(): MapRenderer<MapSquareRenderable, MapData>;
    getMapManager(): MapManager;
    getCamera(): Camera;
}>;

export class WorkerFramePacketSource implements MapRenderFramePacketSource {
    private pendingFramePacket: Promise<FramePacket | undefined> | undefined;
    private latestFramePacket: FramePacket | undefined;
    private packetEpoch: number = 0;

    constructor(private readonly deps: WorkerFramePacketSourceDeps) {}

    nextPacket(input: TickFrameInput): FramePacket | undefined {
        const packet = this.latestFramePacket;

        if (
            !this.pendingFramePacket &&
            (input.ticksElapsed > 0 || input.clientTicksElapsed > 0 || !this.latestFramePacket)
        ) {
            const epoch = this.packetEpoch | 0;
            const mapManager = this.deps.getMapManager();
            const renderer = this.deps.getRenderer();
            const camera = this.deps.getCamera();
            const n = mapManager.visibleMapCount | 0;
            const mapIds = new Int32Array(n);
            for (let i = 0; i < n; i++) {
                mapIds[i] = mapManager.visibleMaps[i]!.mapId | 0;
            }
            const hoveredMapIdsPacked =
                renderer.getInteractionSnapshotRenderer?.()?.getHoveredMapIdsPacked() ??
                EMPTY_INT32;
            this.pendingFramePacket = this.deps.workerPool
                .tickFrame(
                    input.frameCount,
                    mapIds,
                    input.ticksElapsed,
                    input.clientTicksElapsed,
                    input.cycle,
                    camera.getMapX(),
                    camera.getMapY(),
                    renderer.lodDistance,
                    hoveredMapIdsPacked,
                )
                .then((nextPacket) => {
                    if ((this.packetEpoch | 0) === epoch) {
                        this.latestFramePacket = nextPacket;
                    }
                    return nextPacket;
                })
                .catch(() => {
                    if ((this.packetEpoch | 0) === epoch) {
                        this.latestFramePacket = undefined;
                    }
                    return undefined;
                })
                .finally(() => {
                    if ((this.packetEpoch | 0) === epoch) {
                        this.pendingFramePacket = undefined;
                    }
                });
        }

        return packet;
    }

    reset(): void {
        this.packetEpoch = (this.packetEpoch + 1) | 0;
        this.pendingFramePacket = undefined;
        this.latestFramePacket = undefined;
    }
}
