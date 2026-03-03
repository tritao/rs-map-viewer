import type { FramePacket } from "../runtime/contracts/FramePacket";
import { CLIENT_TICK_SECONDS, SERVER_TICK_SECONDS } from "../runtime/contracts/TickTiming";
import type { MapViewerFramePacketSource, TickFrameInput } from "./MapViewerFramePacketSource";

const MAX_SERVER_TICKS_PER_FRAME = 1;
const MAX_CLIENT_TICKS_PER_FRAME = 50;

export type TickClockState = Readonly<{
    cycle: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
}>;

type TickPassInput = Readonly<{
    frameInput: TickFrameInput;
    packetSource: MapViewerFramePacketSource;
    applyFramePacket(packet: FramePacket | undefined): void;
}>;

export class MapViewerTickCoordinator {
    private lastTick: number = 0;
    private lastClientTick: number = 0;
    private needsClockResync: boolean = true;

    advanceClocks(timeSec: number): TickClockState {
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

    applyTick(input: TickPassInput): void {
        const packet = input.packetSource.nextPacket(input.frameInput);
        input.applyFramePacket(packet);
    }

    requestClockResync(): void {
        this.needsClockResync = true;
    }

    resetForCacheContext(packetSource: MapViewerFramePacketSource): void {
        packetSource.reset();
        this.requestClockResync();
    }

    resetForShutdown(packetSource: MapViewerFramePacketSource): void {
        this.resetForCacheContext(packetSource);
        this.lastTick = 0;
        this.lastClientTick = 0;
        this.needsClockResync = true;
    }
}
