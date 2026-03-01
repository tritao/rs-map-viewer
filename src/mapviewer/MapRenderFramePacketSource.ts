import { MapRenderer, type MapSquareRenderable } from "../renderer/MapRenderer";
import type { MapData } from "../maprender/payload/MapData";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { Camera } from "./Camera";
import type { MapManager } from "./MapManager";

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
