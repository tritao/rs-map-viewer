import type { FramePacket } from "../runtime/contracts/FramePacket";
import type { SimWorkerPool } from "../worker/SimWorkerPool";
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

export interface MapViewerFramePacketSource {
    nextPacket(input: TickFrameInput): FramePacket | undefined;
    reset(): void;
}

type WorkerMapViewerFramePacketSourceDeps = Readonly<{
    simWorkerPool: SimWorkerPool;
    renderWorkerPool: RenderDataWorkerPool;
    getLodDistance(): number;
    getHoveredMapIdsPacked(): Int32Array | undefined;
    isSeamTelemetryEnabled(): boolean;
    getMapManager(): MapManager;
    getCamera(): Camera;
}>;

export class WorkerMapViewerFramePacketSource implements MapViewerFramePacketSource {
    private pendingFramePacket: Promise<FramePacket | undefined> | undefined;
    private latestFramePacket: FramePacket | undefined;
    private packetEpoch: number = 0;
    private lastTickMapIds: Int32Array = EMPTY_INT32;
    private tickMapIdsVersion: number = 0;
    private tickViewStateVersion: number = 0;
    private lastTickHoveredMapIds: Int32Array = EMPTY_INT32;
    private seamSampleCount: number = 0;
    private seamSimMsTotal: number = 0;
    private seamApplyMsTotal: number = 0;
    private seamPackMsTotal: number = 0;
    private seamTotalMsTotal: number = 0;
    private seamEventCountTotal: number = 0;
    private lastTickViewState:
        | Readonly<{ cameraMapX: number; cameraMapY: number; lodDistance: number }>
        | undefined;

    constructor(private readonly deps: WorkerMapViewerFramePacketSourceDeps) {}

    nextPacket(input: TickFrameInput): FramePacket | undefined {
        const packet = this.latestFramePacket;
        const mapManager = this.deps.getMapManager();
        const camera = this.deps.getCamera();
        const mapIds = this.collectVisibleMapIds(mapManager);
        const cameraMapX = camera.getMapX() | 0;
        const cameraMapY = camera.getMapY() | 0;
        const lodDistance = this.deps.getLodDistance() | 0;
        const shouldUpdateTickMaps = !this.areInt32ArraysEqual(mapIds, this.lastTickMapIds);
        const shouldUpdateTickViewState = !this.lastTickViewState
            ? true
            : this.lastTickViewState.cameraMapX !== cameraMapX ||
              this.lastTickViewState.cameraMapY !== cameraMapY ||
              this.lastTickViewState.lodDistance !== lodDistance;

        if (
            !this.pendingFramePacket &&
            (
                input.ticksElapsed > 0 ||
                input.clientTicksElapsed > 0 ||
                !this.latestFramePacket ||
                shouldUpdateTickMaps ||
                shouldUpdateTickViewState
            )
        ) {
            const epoch = this.packetEpoch | 0;
            const hoveredMapIdsPacked = this.deps.getHoveredMapIdsPacked() ?? EMPTY_INT32;
            const shouldUpdateHoveredMapIds = !this.areInt32ArraysEqual(
                hoveredMapIdsPacked,
                this.lastTickHoveredMapIds,
            );
            const runTickFrame = async () => {
                const seamStart = performance.now();
                const deltaPacket = await this.deps.simWorkerPool.tickSim(
                    input.frameCount,
                    input.ticksElapsed,
                    input.clientTicksElapsed,
                    input.cycle,
                    hoveredMapIdsPacked,
                );
                const afterSim = performance.now();
                if (deltaPacket) {
                    await this.deps.renderWorkerPool.applyNpcStateDeltaPacket(deltaPacket);
                }
                const afterApply = performance.now();
                const packet = await this.deps.renderWorkerPool.buildFramePacketFromRenderState(
                    input.frameCount,
                    input.cycle,
                );
                const seamEnd = performance.now();
                this.recordSeamTiming(
                    afterSim - seamStart,
                    afterApply - afterSim,
                    seamEnd - afterApply,
                    seamEnd - seamStart,
                    deltaPacket?.eventCount ?? 0,
                );
                return packet;
            };
            const updatePromises = this.syncTickRuntimeState({
                mapIds,
                shouldUpdateTickMaps,
                cameraMapX,
                cameraMapY,
                lodDistance,
                shouldUpdateTickViewState,
                hoveredMapIdsPacked,
                shouldUpdateHoveredMapIds,
            });
            const startFrameTick =
                updatePromises.length > 0
                    ? Promise.all(updatePromises).then(runTickFrame)
                    : runTickFrame();
            this.pendingFramePacket = startFrameTick
                .then((nextPacket) => {
                    if ((this.packetEpoch | 0) === epoch) {
                        if (
                            nextPacket &&
                            (
                                (nextPacket.tickMapIdsVersion | 0) !==
                                    (this.tickMapIdsVersion | 0) ||
                                (nextPacket.tickViewStateVersion | 0) !==
                                    (this.tickViewStateVersion | 0)
                            )
                        ) {
                            this.latestFramePacket = undefined;
                            return undefined;
                        }
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
        this.lastTickMapIds = EMPTY_INT32;
        this.tickMapIdsVersion = (this.tickMapIdsVersion + 1) | 0;
        this.tickViewStateVersion = (this.tickViewStateVersion + 1) | 0;
        this.lastTickHoveredMapIds = EMPTY_INT32;
        this.seamSampleCount = 0;
        this.seamSimMsTotal = 0;
        this.seamApplyMsTotal = 0;
        this.seamPackMsTotal = 0;
        this.seamTotalMsTotal = 0;
        this.seamEventCountTotal = 0;
        this.lastTickViewState = undefined;
        void Promise.all([
            this.deps.simWorkerPool.setTickMapIds(EMPTY_INT32),
            this.deps.simWorkerPool.setTickViewState(0, 0, 0),
            this.deps.simWorkerPool.setTickHoveredMapIds(EMPTY_INT32),
            this.deps.renderWorkerPool.setFrameTickMapIds(EMPTY_INT32),
            this.deps.renderWorkerPool.setFrameTickViewState(0, 0, 0),
            this.deps.renderWorkerPool.setFrameTickHoveredMapIds(EMPTY_INT32),
        ]);
    }

    private collectVisibleMapIds(mapManager: MapManager): Int32Array {
        const n = mapManager.visibleMapCount | 0;
        if ((n | 0) <= 0) {
            return EMPTY_INT32;
        }
        const mapIds = new Int32Array(n);
        for (let i = 0; i < n; i++) {
            mapIds[i] = mapManager.visibleMaps[i]!.mapId | 0;
        }
        return mapIds;
    }

    private areInt32ArraysEqual(left: Int32Array, right: Int32Array): boolean {
        if ((left.length | 0) !== (right.length | 0)) {
            return false;
        }
        for (let i = 0; i < left.length; i++) {
            if ((left[i] | 0) !== (right[i] | 0)) {
                return false;
            }
        }
        return true;
    }

    private syncTickRuntimeState(input: Readonly<{
        mapIds: Int32Array;
        shouldUpdateTickMaps: boolean;
        cameraMapX: number;
        cameraMapY: number;
        lodDistance: number;
        shouldUpdateTickViewState: boolean;
        hoveredMapIdsPacked: Int32Array;
        shouldUpdateHoveredMapIds: boolean;
    }>): Promise<void>[] {
        const updatePromises = new Array<Promise<void>>();
        if (input.shouldUpdateTickMaps) {
            this.lastTickMapIds = input.mapIds;
            this.tickMapIdsVersion = (this.tickMapIdsVersion + 1) | 0;
            updatePromises.push(this.deps.simWorkerPool.setTickMapIds(input.mapIds));
            updatePromises.push(this.deps.renderWorkerPool.setFrameTickMapIds(input.mapIds));
        }
        if (input.shouldUpdateTickViewState) {
            this.lastTickViewState = {
                cameraMapX: input.cameraMapX | 0,
                cameraMapY: input.cameraMapY | 0,
                lodDistance: input.lodDistance | 0,
            };
            this.tickViewStateVersion = (this.tickViewStateVersion + 1) | 0;
            updatePromises.push(
                this.deps.simWorkerPool.setTickViewState(
                    input.cameraMapX | 0,
                    input.cameraMapY | 0,
                    input.lodDistance | 0,
                ),
            );
            updatePromises.push(
                this.deps.renderWorkerPool.setFrameTickViewState(
                    input.cameraMapX | 0,
                    input.cameraMapY | 0,
                    input.lodDistance | 0,
                ),
            );
        }
        if (input.shouldUpdateHoveredMapIds) {
            this.lastTickHoveredMapIds = Int32Array.from(input.hoveredMapIdsPacked);
            updatePromises.push(
                this.deps.simWorkerPool.setTickHoveredMapIds(input.hoveredMapIdsPacked),
            );
            updatePromises.push(
                this.deps.renderWorkerPool.setFrameTickHoveredMapIds(input.hoveredMapIdsPacked),
            );
        }
        return updatePromises;
    }

    private recordSeamTiming(
        simMs: number,
        applyMs: number,
        packMs: number,
        totalMs: number,
        eventCount: number,
    ): void {
        if (!this.deps.isSeamTelemetryEnabled()) {
            return;
        }
        this.seamSampleCount = (this.seamSampleCount + 1) | 0;
        this.seamSimMsTotal += simMs;
        this.seamApplyMsTotal += applyMs;
        this.seamPackMsTotal += packMs;
        this.seamTotalMsTotal += totalMs;
        this.seamEventCountTotal += eventCount | 0;
        if ((this.seamSampleCount | 0) < 120) {
            return;
        }
        const count = this.seamSampleCount | 0;
        console.log("[map-render][frame-seam] avg", {
            samples: count,
            simMs: this.seamSimMsTotal / count,
            applyMs: this.seamApplyMsTotal / count,
            packMs: this.seamPackMsTotal / count,
            totalMs: this.seamTotalMsTotal / count,
            eventsPerFrame: this.seamEventCountTotal / count,
        });
        this.seamSampleCount = 0;
        this.seamSimMsTotal = 0;
        this.seamApplyMsTotal = 0;
        this.seamPackMsTotal = 0;
        this.seamTotalMsTotal = 0;
        this.seamEventCountTotal = 0;
    }
}
