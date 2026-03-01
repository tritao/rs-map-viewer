import type { FramePacket } from "../runtime/contracts/FramePacket";
import type { MapRenderFramePacketSource, TickFrameInput } from "./MapRenderFramePacketSource";

export type TickClockState = Readonly<{
    cycle: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
}>;

type TickPassInput = Readonly<{
    frameInput: TickFrameInput;
    workerSource: MapRenderFramePacketSource;
    applyFramePacket(packet: FramePacket | undefined): void;
}>;

export class MapRenderTickCoordinator {
    private lastTick: number = 0;
    private lastClientTick: number = 0;

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
        const packet = input.workerSource.nextPacket(input.frameInput);
        input.applyFramePacket(packet);
    }

    resetForCacheContext(workerSource: MapRenderFramePacketSource): void {
        workerSource.reset();
    }

    resetForShutdown(workerSource: MapRenderFramePacketSource): void {
        this.resetForCacheContext(workerSource);
        this.lastTick = 0;
        this.lastClientTick = 0;
    }
}
