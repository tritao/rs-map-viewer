import type { FramePacket } from "../runtime/contracts/FramePacket";
import type { MapViewerRuntimeOptions } from "./MapViewer";

export type TickClockState = Readonly<{
    cycle: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
}>;

type WorkerTickRequest = Readonly<{
    frameCount: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
    cycle: number;
}>;

type TickPassInput = Readonly<{
    runtimeOptions: MapViewerRuntimeOptions;
    frameCount: number;
    cycle: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
    applyFramePacket(packet: FramePacket | undefined): void;
    buildMainThreadFramePacket(
        cycle: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
    ): FramePacket;
    requestWorkerFramePacket(request: WorkerTickRequest): Promise<FramePacket | undefined>;
}>;

export class MapRenderTickCoordinator {
    private lastTick: number = 0;
    private lastClientTick: number = 0;

    private pendingFramePacket: Promise<FramePacket | undefined> | undefined;
    private latestFramePacket: FramePacket | undefined;
    private latestFramePacketFrameCount: number = -1;
    private lastNpcSimInWorker: boolean = false;
    private packetEpoch: number = 0;

    advanceClocks(timeSec: number): TickClockState {
        const tick = Math.floor(timeSec / 0.6);
        const ticksElapsed = Math.min(tick - this.lastTick, 1);
        if (ticksElapsed > 0) {
            this.lastTick = tick;
        }

        const clientTick = Math.floor(timeSec / 0.02);
        const clientTicksElapsed = Math.min(clientTick - this.lastClientTick, 50);
        if (clientTicksElapsed > 0) {
            this.lastClientTick = clientTick;
        }

        return {
            cycle: timeSec / 0.02,
            ticksElapsed,
            clientTicksElapsed,
        };
    }

    applyTick(input: TickPassInput): void {
        const npcSimInWorker = !!input.runtimeOptions.mapRenderNpcSimInWorker;
        const prevNpcSimInWorker = this.lastNpcSimInWorker;
        this.lastNpcSimInWorker = npcSimInWorker;

        if (prevNpcSimInWorker !== npcSimInWorker) {
            this.clearWorkerPacketState();
            input.applyFramePacket(undefined);
        }

        if (!npcSimInWorker) {
            input.applyFramePacket(
                input.buildMainThreadFramePacket(
                    input.cycle,
                    input.ticksElapsed,
                    input.clientTicksElapsed,
                ),
            );
            return;
        }

        const packet = this.latestFramePacket;
        input.applyFramePacket(packet);
        if (packet && packet.frameCount !== this.latestFramePacketFrameCount) {
            this.latestFramePacketFrameCount = packet.frameCount | 0;
        }

        if (
            !this.pendingFramePacket &&
            (input.ticksElapsed > 0 || input.clientTicksElapsed > 0 || !this.latestFramePacket)
        ) {
            const epoch = this.packetEpoch | 0;
            this.pendingFramePacket = input
                .requestWorkerFramePacket({
                    frameCount: input.frameCount,
                    ticksElapsed: input.ticksElapsed,
                    clientTicksElapsed: input.clientTicksElapsed,
                    cycle: input.cycle,
                })
                .then((packet) => {
                    if ((this.packetEpoch | 0) === epoch) {
                        this.latestFramePacket = packet;
                    }
                    return packet;
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
    }

    resetForCacheContext(): void {
        this.clearWorkerPacketState();
        this.lastNpcSimInWorker = false;
    }

    resetForShutdown(): void {
        this.resetForCacheContext();
        this.lastTick = 0;
        this.lastClientTick = 0;
    }

    private clearWorkerPacketState(): void {
        this.packetEpoch = (this.packetEpoch + 1) | 0;
        this.pendingFramePacket = undefined;
        this.latestFramePacket = undefined;
        this.latestFramePacketFrameCount = -1;
    }
}
