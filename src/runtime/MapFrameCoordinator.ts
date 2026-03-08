import type { FramePacket } from "./packets/FramePacket";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { SimWorkerPool } from "../worker/SimWorkerPool";

const EMPTY_INT32 = new Int32Array(0);

export type FrameStepInput = Readonly<{
    frameCount: number;
    cycle: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
}>;

export type MapFrameSeamSample = Readonly<{
    worldMs: number;
    applyWorldMs: number;
    renderMs: number;
    totalMs: number;
    worldEventCount: number;
}>;

type MapFrameCoordinatorDeps = Readonly<{
    simWorkerPool: SimWorkerPool;
    renderWorkerPool: RenderDataWorkerPool;
    getLodDistance(): number;
    getHoveredMapIdsPacked(): Int32Array | undefined;
    getVisibleMapIds(): Int32Array;
    getCameraMapX(): number;
    getCameraMapY(): number;
    reportSeamSample?(sample: MapFrameSeamSample): void;
}>;

export class MapFrameCoordinator {
    private pendingFramePacket: Promise<FramePacket | undefined> | undefined;
    private latestFramePacket: FramePacket | undefined;
    private packetEpoch: number = 0;
    private needsPacketRefresh: boolean = false;
    private lastFrameMapIds: Int32Array = EMPTY_INT32;
    private frameMapIdsVersion: number = 0;
    private frameViewStateVersion: number = 0;
    private lastFrameHoveredMapIds: Int32Array = EMPTY_INT32;
    private lastFrameViewState:
        | Readonly<{ cameraMapX: number; cameraMapY: number; lodDistance: number }>
        | undefined;

    constructor(private readonly deps: MapFrameCoordinatorDeps) {}

    nextFramePacket(input: FrameStepInput): FramePacket | undefined {
        const packet = this.latestFramePacket;
        const mapIds = this.deps.getVisibleMapIds();
        const cameraMapX = this.deps.getCameraMapX() | 0;
        const cameraMapY = this.deps.getCameraMapY() | 0;
        const lodDistance = this.deps.getLodDistance() | 0;
        const shouldUpdateFrameMaps = !this.areInt32ArraysEqual(mapIds, this.lastFrameMapIds);
        const shouldUpdateFrameViewState = !this.lastFrameViewState
            ? true
            : this.lastFrameViewState.cameraMapX !== cameraMapX ||
              this.lastFrameViewState.cameraMapY !== cameraMapY ||
              this.lastFrameViewState.lodDistance !== lodDistance;

        if (
            !this.pendingFramePacket &&
            (input.ticksElapsed > 0 ||
                input.clientTicksElapsed > 0 ||
                this.needsPacketRefresh ||
                !this.latestFramePacket ||
                shouldUpdateFrameMaps ||
                shouldUpdateFrameViewState)
        ) {
            const epoch = this.packetEpoch | 0;
            const hoveredMapIdsPacked = this.deps.getHoveredMapIdsPacked() ?? EMPTY_INT32;
            const shouldUpdateFrameHoveredMapIds = !this.areInt32ArraysEqual(
                hoveredMapIdsPacked,
                this.lastFrameHoveredMapIds,
            );
            const updatePromises = this.syncFrameRuntimeState({
                mapIds,
                shouldUpdateFrameMaps,
                cameraMapX,
                cameraMapY,
                lodDistance,
                shouldUpdateFrameViewState,
                hoveredMapIdsPacked,
                shouldUpdateFrameHoveredMapIds,
            });
            this.pendingFramePacket = this.queueNextFramePacket({
                epoch,
                input,
                updatePromises,
            });
        }

        return packet;
    }

    reset(): void {
        this.packetEpoch = (this.packetEpoch + 1) | 0;
        this.pendingFramePacket = undefined;
        this.latestFramePacket = undefined;
        this.needsPacketRefresh = false;
        this.lastFrameMapIds = EMPTY_INT32;
        this.frameMapIdsVersion = (this.frameMapIdsVersion + 1) | 0;
        this.frameViewStateVersion = (this.frameViewStateVersion + 1) | 0;
        this.lastFrameHoveredMapIds = EMPTY_INT32;
        this.lastFrameViewState = undefined;
        void Promise.all([
            this.deps.simWorkerPool.setTickMapIds(EMPTY_INT32),
            this.deps.simWorkerPool.setTickViewState(0, 0, 0),
            this.deps.renderWorkerPool.setFrameTickMapIds(EMPTY_INT32),
            this.deps.renderWorkerPool.setFrameTickViewState(0, 0, 0),
            this.deps.renderWorkerPool.setFrameTickHoveredMapIds(EMPTY_INT32),
        ]);
    }

    invalidateLatestPacket(): void {
        this.needsPacketRefresh = true;
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

    private syncFrameRuntimeState(
        input: Readonly<{
            mapIds: Int32Array;
            shouldUpdateFrameMaps: boolean;
            cameraMapX: number;
            cameraMapY: number;
            lodDistance: number;
            shouldUpdateFrameViewState: boolean;
            hoveredMapIdsPacked: Int32Array;
            shouldUpdateFrameHoveredMapIds: boolean;
        }>,
    ): Promise<void>[] {
        const updatePromises = new Array<Promise<void>>();
        if (input.shouldUpdateFrameMaps) {
            this.lastFrameMapIds = input.mapIds;
            this.frameMapIdsVersion = (this.frameMapIdsVersion + 1) | 0;
            updatePromises.push(this.deps.simWorkerPool.setTickMapIds(input.mapIds));
            updatePromises.push(this.deps.renderWorkerPool.setFrameTickMapIds(input.mapIds));
        }
        if (input.shouldUpdateFrameViewState) {
            this.lastFrameViewState = {
                cameraMapX: input.cameraMapX | 0,
                cameraMapY: input.cameraMapY | 0,
                lodDistance: input.lodDistance | 0,
            };
            this.frameViewStateVersion = (this.frameViewStateVersion + 1) | 0;
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
        if (input.shouldUpdateFrameHoveredMapIds) {
            this.lastFrameHoveredMapIds = Int32Array.from(input.hoveredMapIdsPacked);
            updatePromises.push(
                this.deps.renderWorkerPool.setFrameTickHoveredMapIds(input.hoveredMapIdsPacked),
            );
        }
        return updatePromises;
    }

    private queueNextFramePacket(input: Readonly<{
        epoch: number;
        input: FrameStepInput;
        updatePromises: Promise<void>[];
    }>): Promise<FramePacket | undefined> {
        const runWorldStepAndBuildFrame = async () => {
            const seamStart = performance.now();
            const worldDeltaPacket = await this.deps.simWorkerPool.stepWorld(
                input.input.frameCount,
                input.input.ticksElapsed,
                input.input.clientTicksElapsed,
                input.input.cycle,
            );
            const afterSim = performance.now();
            if (worldDeltaPacket) {
                await this.deps.renderWorkerPool.applyNpcWorldStateDeltaPacket(worldDeltaPacket);
            }
            const afterApply = performance.now();
            const packet = await this.deps.renderWorkerPool.buildRenderFramePacket(
                input.input.frameCount,
                input.input.cycle,
            );
            const seamEnd = performance.now();
            this.deps.reportSeamSample?.({
                worldMs: afterSim - seamStart,
                applyWorldMs: afterApply - afterSim,
                renderMs: seamEnd - afterApply,
                totalMs: seamEnd - seamStart,
                worldEventCount: worldDeltaPacket?.eventCount ?? 0,
            });
            return packet;
        };

        const startFrameTick =
            input.updatePromises.length > 0
                ? Promise.all(input.updatePromises).then(runWorldStepAndBuildFrame)
                : runWorldStepAndBuildFrame();

        return startFrameTick
            .then((nextPacket) => {
                if ((this.packetEpoch | 0) === (input.epoch | 0)) {
                    if (
                        nextPacket &&
                        ((nextPacket.tickMapIdsVersion | 0) !== (this.frameMapIdsVersion | 0) ||
                            (nextPacket.tickViewStateVersion | 0) !==
                                (this.frameViewStateVersion | 0))
                    ) {
                        this.needsPacketRefresh = true;
                        return this.latestFramePacket;
                    }
                    this.latestFramePacket = nextPacket;
                    this.needsPacketRefresh = false;
                }
                return nextPacket;
            })
            .catch(() => {
                if ((this.packetEpoch | 0) === (input.epoch | 0)) {
                    this.needsPacketRefresh = true;
                }
                return this.latestFramePacket;
            })
            .finally(() => {
                if ((this.packetEpoch | 0) === (input.epoch | 0)) {
                    this.pendingFramePacket = undefined;
                }
            });
    }

}
