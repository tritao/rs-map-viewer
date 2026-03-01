import type { FramePacket } from "../runtime/contracts/FramePacket";
import type { MapViewerRuntimeOptions } from "./MapViewer";
import type { MapRenderFramePacketSource, TickFrameInput } from "./MapRenderFramePacketSource";

export type TickClockState = Readonly<{
    cycle: number;
    ticksElapsed: number;
    clientTicksElapsed: number;
}>;

type TickPassInput = Readonly<{
    runtimeOptions: MapViewerRuntimeOptions;
    frameInput: TickFrameInput;
    mainThreadSource: MapRenderFramePacketSource;
    workerSource: MapRenderFramePacketSource;
    applyFramePacket(packet: FramePacket | undefined): void;
}>;

export class MapRenderTickCoordinator {
    private lastTick: number = 0;
    private lastClientTick: number = 0;
    private lastNpcSimInWorker: boolean = false;

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
        if (this.lastNpcSimInWorker !== npcSimInWorker) {
            // Ensure stale packet state from one mode never leaks into the next mode.
            input.mainThreadSource.reset();
            input.workerSource.reset();
            input.applyFramePacket(undefined);
        }
        this.lastNpcSimInWorker = npcSimInWorker;

        const source = npcSimInWorker ? input.workerSource : input.mainThreadSource;
        const packet = source.nextPacket(input.frameInput);
        input.applyFramePacket(packet);
    }

    resetForCacheContext(
        mainThreadSource: MapRenderFramePacketSource,
        workerSource: MapRenderFramePacketSource,
    ): void {
        mainThreadSource.reset();
        workerSource.reset();
        this.lastNpcSimInWorker = false;
    }

    resetForShutdown(
        mainThreadSource: MapRenderFramePacketSource,
        workerSource: MapRenderFramePacketSource,
    ): void {
        this.resetForCacheContext(mainThreadSource, workerSource);
        this.lastTick = 0;
        this.lastClientTick = 0;
    }
}
