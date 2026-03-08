import type { RenderFramePacket } from "../renderer/RenderFramePacket";
import type { RenderFrameInputUpdate, WorldInputUpdate } from "../worker/WorkerContext";
import type { WorkerInputStateVersion } from "../worker/WorkerContext";
import type { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import type { SimWorkerPool } from "../worker/SimWorkerPool";

const EMPTY_INT32 = new Int32Array(0);

export type RenderFrameStepInput = Readonly<{
    frameCount: number;
    cycle: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
}>;

export type RenderFrameSeamSample = Readonly<{
    worldMs: number;
    applyWorldMs: number;
    renderMs: number;
    totalMs: number;
    worldEventCount: number;
}>;

type RenderFrameCoordinatorDeps = Readonly<{
    simWorkerPool: SimWorkerPool;
    renderWorkerPool: RenderDataWorkerPool;
    getLodDistance(): number;
    getHoveredMapIdsPacked(): Int32Array | undefined;
    getVisibleMapIds(): Int32Array;
    getCameraMapX(): number;
    getCameraMapY(): number;
    reportSeamSample?(sample: RenderFrameSeamSample): void;
}>;

export class RenderFrameCoordinator {
    private pendingFramePacket: Promise<RenderFramePacket | undefined> | undefined;
    private latestFramePacket: RenderFramePacket | undefined;
    private packetEpoch: number = 0;
    private needsPacketRefresh: boolean = false;
    private lastFrameMapIds: Int32Array = EMPTY_INT32;
    private expectedInputStateVersion: WorkerInputStateVersion | undefined;
    private lastFrameHoveredMapIds: Int32Array = EMPTY_INT32;
    private lastFrameViewState:
        | Readonly<{ cameraMapX: number; cameraMapY: number; lodDistance: number }>
        | undefined;

    constructor(private readonly deps: RenderFrameCoordinatorDeps) {}

    nextFramePacket(input: RenderFrameStepInput): RenderFramePacket | undefined {
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
            const updatePromises = this.syncFrameRuntimeState(epoch, {
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
        this.expectedInputStateVersion = undefined;
        this.lastFrameHoveredMapIds = EMPTY_INT32;
        this.lastFrameViewState = undefined;
        void Promise.all([
            this.deps.simWorkerPool.syncWorldState({
                mapIds: EMPTY_INT32,
                viewState: {
                    cameraMapX: 0,
                    cameraMapY: 0,
                    lodDistance: 0,
                },
            }),
            this.deps.renderWorkerPool.frame.syncState({
                mapIds: EMPTY_INT32,
                viewState: {
                    cameraMapX: 0,
                    cameraMapY: 0,
                    lodDistance: 0,
                },
                hoveredMapIdsPacked: EMPTY_INT32,
            }),
        ]);
    }

    invalidateLatestPacket(): void {
        this.needsPacketRefresh = true;
    }

    private copyInt32Array(source: Int32Array, target: Int32Array): Int32Array {
        if ((source.length | 0) === 0) {
            return EMPTY_INT32;
        }
        if ((target.length | 0) !== (source.length | 0)) {
            target = new Int32Array(source.length | 0);
        }
        target.set(source);
        return target;
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
        epoch: number,
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
        let worldInputUpdate: WorldInputUpdate | undefined;
        let renderFrameUpdate: RenderFrameInputUpdate | undefined;
        if (input.shouldUpdateFrameMaps) {
            this.lastFrameMapIds = this.copyInt32Array(input.mapIds, this.lastFrameMapIds);
            worldInputUpdate = {
                ...worldInputUpdate,
                mapIds: input.mapIds,
            };
            renderFrameUpdate = {
                ...renderFrameUpdate,
                mapIds: input.mapIds,
            };
        }
        if (input.shouldUpdateFrameViewState) {
            this.lastFrameViewState = {
                cameraMapX: input.cameraMapX | 0,
                cameraMapY: input.cameraMapY | 0,
                lodDistance: input.lodDistance | 0,
            };
            worldInputUpdate = {
                ...worldInputUpdate,
                viewState: {
                    cameraMapX: input.cameraMapX | 0,
                    cameraMapY: input.cameraMapY | 0,
                    lodDistance: input.lodDistance | 0,
                },
            };
            renderFrameUpdate = {
                ...renderFrameUpdate,
                viewState: {
                    cameraMapX: input.cameraMapX | 0,
                    cameraMapY: input.cameraMapY | 0,
                    lodDistance: input.lodDistance | 0,
                },
            };
        }
        if (input.shouldUpdateFrameHoveredMapIds) {
            this.lastFrameHoveredMapIds = this.copyInt32Array(
                input.hoveredMapIdsPacked,
                this.lastFrameHoveredMapIds,
            );
            renderFrameUpdate = {
                ...renderFrameUpdate,
                hoveredMapIdsPacked: input.hoveredMapIdsPacked,
            };
        }
        if (worldInputUpdate) {
            updatePromises.push(this.deps.simWorkerPool.syncWorldState(worldInputUpdate));
        }
        if (renderFrameUpdate) {
            updatePromises.push(
                this.deps.renderWorkerPool.frame.syncState(renderFrameUpdate).then((versions) => {
                    if ((this.packetEpoch | 0) === (epoch | 0)) {
                        this.expectedInputStateVersion = versions;
                    }
                }),
            );
        }
        return updatePromises;
    }

    private queueNextFramePacket(input: Readonly<{
        epoch: number;
        input: RenderFrameStepInput;
        updatePromises: Promise<void>[];
    }>): Promise<RenderFramePacket | undefined> {
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
                await this.deps.renderWorkerPool.frame.applyWorldDelta(worldDeltaPacket);
            }
            const afterApply = performance.now();
            const packet = await this.deps.renderWorkerPool.frame.buildPacket(
                input.input.frameCount,
                input.input.cycle,
            );
            const seamEnd = performance.now();
            this.deps.reportSeamSample?.({
                worldMs: afterSim - seamStart,
                applyWorldMs: afterApply - afterSim,
                renderMs: seamEnd - afterApply,
                totalMs: seamEnd - seamStart,
                worldEventCount:
                    (worldDeltaPacket?.npcDelta?.eventCount ?? 0) +
                    (worldDeltaPacket?.objDelta?.updates.length ?? 0),
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
                    const expectedInputStateVersion = this.expectedInputStateVersion;
                    if (
                        nextPacket &&
                        expectedInputStateVersion !== undefined &&
                        (nextPacket.inputStateVersion | 0) !== (expectedInputStateVersion | 0)
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
