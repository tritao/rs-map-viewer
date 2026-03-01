import {
    isDrawRangePatchBackendReady,
    registerDrawRangeTickState,
    tickAdvanceAndEmitBasePatchesForState,
    unregisterDrawRangeTickState,
} from "../../wasm/DrawRangePatchBackend";
import type { DrawRangeTickStateInput } from "../../wasm/DrawRangeTickState";
import type { WasmTickCapability } from "../contracts/TickCapability";
import { LocTickPatchVariant, NpcTickPatchVariant } from "../contracts/TickPatchStreams";
import type { TickPatchSink } from "./TickController";

type WasmTickOutputs = Readonly<{
    locStreams: readonly Int32Array[];
    npcStreams: readonly Int32Array[];
}>;

export class WasmTickBackend {
    private readonly outputsByRenderableId = new Map<number, WasmTickOutputs>();

    isReady(): boolean {
        return isDrawRangePatchBackendReady();
    }

    onRenderableRemoved(renderableId: number): void {
        unregisterDrawRangeTickState(renderableId);
        this.outputsByRenderableId.delete(renderableId | 0);
    }

    reset(): void {
        this.outputsByRenderableId.clear();
    }

    private toWasmTickOutputs(input: DrawRangeTickStateInput): WasmTickOutputs {
        return {
            locStreams: [
                input.outLocPatchesPacked,
                input.outLocAlphaPatchesPacked,
                input.outLocLodPatchesPacked,
                input.outLocLodAlphaPatchesPacked,
                input.outLocInteractPatchesPacked,
                input.outLocInteractAlphaPatchesPacked,
                input.outLocInteractLodPatchesPacked,
                input.outLocInteractLodAlphaPatchesPacked,
            ],
            npcStreams: [input.outNpcPatchesPacked, input.outNpcAlphaPatchesPacked],
        };
    }

    private emitWasmStreamsToSink(
        sink: TickPatchSink,
        outputs: WasmTickOutputs,
        counts: readonly number[],
    ): void {
        for (let streamIndex = 0; streamIndex < 8; streamIndex++) {
            const patches = outputs.locStreams[streamIndex];
            const patchCount = Math.max(0, counts[streamIndex] | 0);
            const safeCount = Math.min(patchCount, Math.floor((patches.length | 0) / 4));
            const variant = streamIndex as LocTickPatchVariant;
            for (let patchIndex = 0; patchIndex < safeCount; patchIndex++) {
                const off = (patchIndex | 0) * 4;
                sink.emitLocPatch(
                    variant,
                    patches[off + 0] | 0,
                    patches[off + 1] | 0,
                    patches[off + 2] | 0,
                    patches[off + 3] | 0,
                );
            }
        }
        for (let streamIndex = 0; streamIndex < 2; streamIndex++) {
            const patches = outputs.npcStreams[streamIndex];
            const patchCount = Math.max(0, counts[8 + streamIndex] | 0);
            const safeCount = Math.min(patchCount, Math.floor((patches.length | 0) / 4));
            const variant = streamIndex as NpcTickPatchVariant;
            for (let patchIndex = 0; patchIndex < safeCount; patchIndex++) {
                const off = (patchIndex | 0) * 4;
                sink.emitNpcPatch(
                    variant,
                    patches[off + 0] | 0,
                    patches[off + 1] | 0,
                    patches[off + 2] | 0,
                    patches[off + 3] | 0,
                );
            }
        }
    }

    tick(
        renderable: WasmTickCapability,
        cycleNowFixed: number,
        clientTicksElapsed: number,
        sink?: TickPatchSink,
    ): boolean {
        const stateWasInitialized = renderable.ensureCppTickStateInitializedFromObjects();
        renderable.syncNpcMovementStateFromObjects();
        renderable.syncNpcPathStateFromObjects();

        let stateInput: DrawRangeTickStateInput | undefined;
        if (stateWasInitialized || !this.outputsByRenderableId.has(renderable.id | 0)) {
            stateInput = renderable.getWasmTickStateInput();
            this.outputsByRenderableId.set(
                renderable.id | 0,
                this.toWasmTickOutputs(stateInput),
            );
        }

        if (stateWasInitialized) {
            const registered = registerDrawRangeTickState(renderable.id, stateInput!);
            if (!registered) {
                return false;
            }
        }

        const tickResult = tickAdvanceAndEmitBasePatchesForState(
            renderable.id,
            cycleNowFixed,
            clientTicksElapsed,
        );
        if (!tickResult) {
            return false;
        }

        renderable.applyWasmTickResult(tickResult);
        if (sink) {
            const outputs = this.outputsByRenderableId.get(renderable.id | 0);
            if (outputs) {
                this.emitWasmStreamsToSink(sink, outputs, [
                    tickResult.locBasePatchCount | 0,
                    tickResult.locAlphaPatchCount | 0,
                    tickResult.locLodPatchCount | 0,
                    tickResult.locLodAlphaPatchCount | 0,
                    tickResult.locInteractPatchCount | 0,
                    tickResult.locInteractAlphaPatchCount | 0,
                    tickResult.locInteractLodPatchCount | 0,
                    tickResult.locInteractLodAlphaPatchCount | 0,
                    tickResult.npcBasePatchCount | 0,
                    tickResult.npcAlphaPatchCount | 0,
                ]);
            }
        }

        return true;
    }
}
