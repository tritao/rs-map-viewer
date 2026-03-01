import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { LOC_CYCLE_SCALE } from "../../wasm/LocCycle";
import type { BackendKind } from "../../util/BackendKind";
import type { TsTickCapability, WasmTickCapability } from "../contracts/TickCapability";
import { LocTickPatchVariant, NpcTickPatchVariant } from "../contracts/TickPatchStreams";
import { TsTickBackend } from "./TsTickBackend";
import { WasmTickBackend } from "./WasmTickBackend";

type TickBackendKind = BackendKind;

type RuntimeOptionsLike = Readonly<{
    mapRenderBackend?: TickBackendKind;
    mapRenderTickBackend?: TickBackendKind;
    mapRenderNpcSimInWorker?: boolean;
}>;

export type TickPatchSink = Readonly<{
    emitLocPatch(
        variant: LocTickPatchVariant,
        drawRangeIndex: number,
        offset: number,
        elements: number,
        instances: number,
    ): void;
    emitNpcPatch(
        variant: NpcTickPatchVariant,
        drawRangeIndex: number,
        offset: number,
        elements: number,
        instances: number,
    ): void;
}>;

function defaultRuntimeOptions(): RuntimeOptionsLike {
    return {};
}

export class TickController {
    private runtimeOptions: RuntimeOptionsLike = defaultRuntimeOptions();
    private readonly tsBackend = new TsTickBackend();
    private readonly wasmBackend = new WasmTickBackend();

    setRuntimeOptions(options: RuntimeOptionsLike): void {
        this.runtimeOptions = options ?? defaultRuntimeOptions();
        this.tsBackend.setRuntimeOptions(this.runtimeOptions);
    }

    onRenderableRemoved(renderableId: number): void {
        this.wasmBackend.onRenderableRemoved(renderableId);
    }

    reset(): void {
        this.runtimeOptions = defaultRuntimeOptions();
        this.tsBackend.setRuntimeOptions(this.runtimeOptions);
        this.wasmBackend.reset();
    }

    private shouldUseCppWasmTickBackend(): boolean {
        if (this.runtimeOptions.mapRenderNpcSimInWorker) {
            return false;
        }
        const tickBackend =
            this.runtimeOptions.mapRenderTickBackend ?? this.runtimeOptions.mapRenderBackend;
        return tickBackend === "cpp-wasm" && this.wasmBackend.isReady();
    }

    tickRenderable(
        renderable: TsTickCapability & WasmTickCapability,
        cycle: number,
        clientTicksElapsed: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        sink?: TickPatchSink,
    ): void {
        const cycleNowFixed = Math.round(cycle * LOC_CYCLE_SCALE) | 0;
        if (this.shouldUseCppWasmTickBackend()) {
            const ok = this.wasmBackend.tick(
                renderable,
                cycleNowFixed,
                clientTicksElapsed,
                sink,
            );
            if (ok) {
                return;
            }
        }

        this.tsBackend.tick(
            renderable,
            cycle,
            clientTicksElapsed,
            seqTypeLoader,
            seqFrameLoader,
            sink,
        );
    }
}
