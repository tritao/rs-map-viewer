import type { RenderFramePacket } from "../renderer/RenderFramePacket";
const SERVER_TICK_SECONDS = 0.6;
const CLIENT_TICK_SECONDS = 0.02;
import type { RenderFrameStepInput } from "../renderer/RenderFrameCoordinator";
import { RenderFrameCoordinator } from "../renderer/RenderFrameCoordinator";

const MAX_SERVER_TICKS_PER_FRAME = 1;
const MAX_CLIENT_TICKS_PER_FRAME = 50;

export type RenderTickState = Readonly<{
    cycle: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
}>;

type RenderTickPassInput = Readonly<{
    frameInput: RenderFrameStepInput;
    renderFrameCoordinator: RenderFrameCoordinator;
    applyFramePacket(packet: RenderFramePacket | undefined): void;
}>;

export class RenderTickCoordinator {
    private lastTick: number = 0;
    private lastClientTick: number = 0;
    private needsClockResync: boolean = true;

    advanceClocks(timeSec: number): RenderTickState {
        const tick = Math.floor(timeSec / SERVER_TICK_SECONDS);
        const clientTick = Math.floor(timeSec / CLIENT_TICK_SECONDS);

        if (this.needsClockResync) {
            this.lastTick = tick;
            this.lastClientTick = clientTick;
            this.needsClockResync = false;
            return {
                cycle: timeSec / CLIENT_TICK_SECONDS,
                ticksElapsed: 0,
                clientTicksElapsed: 0,
            };
        }

        const ticksElapsed = Math.min(
            Math.max((tick - this.lastTick) | 0, 0),
            MAX_SERVER_TICKS_PER_FRAME,
        );
        if (ticksElapsed > 0) {
            this.lastTick = tick;
        }

        const clientTicksElapsed = Math.min(
            Math.max((clientTick - this.lastClientTick) | 0, 0),
            MAX_CLIENT_TICKS_PER_FRAME,
        );
        if (clientTicksElapsed > 0) {
            this.lastClientTick = clientTick;
        }

        return {
            cycle: timeSec / CLIENT_TICK_SECONDS,
            ticksElapsed,
            clientTicksElapsed,
        };
    }

    applyTick(input: RenderTickPassInput): void {
        const packet = input.renderFrameCoordinator.nextFramePacket(input.frameInput);
        input.applyFramePacket(packet);
    }

    requestClockResync(): void {
        this.needsClockResync = true;
    }

    resetForCacheContext(frameCoordinator: RenderFrameCoordinator): void {
        frameCoordinator.reset();
        this.requestClockResync();
    }

    resetForShutdown(frameCoordinator: RenderFrameCoordinator): void {
        this.resetForCacheContext(frameCoordinator);
        this.lastTick = 0;
        this.lastClientTick = 0;
        this.needsClockResync = true;
    }
}
