import {
    isDrawRangePatchBackendReady,
    registerDrawRangeTickState,
    tickAdvanceAndEmitBasePatchesForState,
    unregisterDrawRangeTickState,
    updateDrawRangeTickStateNpcPathPacked,
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
    private readonly npcPathPackedByRenderableId = new Map<number, Int32Array>();

    isReady(): boolean {
        return isDrawRangePatchBackendReady();
    }

    onRenderableRemoved(renderableId: number): void {
        unregisterDrawRangeTickState(renderableId);
        this.outputsByRenderableId.delete(renderableId | 0);
        this.npcPathPackedByRenderableId.delete(renderableId | 0);
    }

    reset(): void {
        this.outputsByRenderableId.clear();
        this.npcPathPackedByRenderableId.clear();
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

    private getNpcPathPackedScratch(renderableId: number, npcCount: number): Int32Array {
        const expectedLength = 2 + npcCount * 31;
        const key = renderableId | 0;
        const existing = this.npcPathPackedByRenderableId.get(key);
        if (existing && (existing.length | 0) === expectedLength) {
            return existing;
        }
        const next = new Int32Array(expectedLength);
        this.npcPathPackedByRenderableId.set(key, next);
        return next;
    }

    private fillNpcPathPacked(packed: Int32Array, input: DrawRangeTickStateInput): void {
        const npcCount = input.npcPathLength.length | 0;
        packed[0] = 1;
        packed[1] = npcCount;
        let cursor = 2;
        packed.set(input.npcPathLength, cursor);
        cursor += npcCount;
        packed.set(input.npcPathXPacked, cursor);
        cursor += input.npcPathXPacked.length | 0;
        packed.set(input.npcPathYPacked, cursor);
        cursor += input.npcPathYPacked.length | 0;
        packed.set(input.npcPathMovementTypePacked, cursor);
    }

    tick(
        renderable: WasmTickCapability,
        cycleNowFixed: number,
        clientTicksElapsed: number,
        sink?: TickPatchSink,
    ): boolean {
        const stateWasInitialized = renderable.ensureCppTickStateInitializedFromObjects();
        renderable.syncNpcPathDecisionStateFromObjects();

        let stateInput: DrawRangeTickStateInput | undefined;
        const renderableId = renderable.id | 0;
        const hadOutputs = this.outputsByRenderableId.has(renderableId);
        if (stateWasInitialized || !hadOutputs) {
            stateInput = renderable.getWasmTickStateInput();
            this.outputsByRenderableId.set(renderableId, this.toWasmTickOutputs(stateInput));
            const registered = registerDrawRangeTickState(renderableId, stateInput);
            if (!registered) {
                return false;
            }
        } else {
            // TS decides only path queues; wasm remains authoritative for NPC transform/frame state.
            stateInput = renderable.getWasmTickStateInput();
            const npcCount = stateInput.npcPathLength.length | 0;
            const packed = this.getNpcPathPackedScratch(renderableId, npcCount);
            this.fillNpcPathPacked(packed, stateInput);
            if (!updateDrawRangeTickStateNpcPathPacked(renderableId, packed)) {
                return false;
            }
        }

        const tickResult = tickAdvanceAndEmitBasePatchesForState(
            renderableId,
            cycleNowFixed,
            clientTicksElapsed,
        );
        if (!tickResult) {
            return false;
        }

        renderable.applyWasmTickResult(tickResult);
        if (sink) {
            const outputs = this.outputsByRenderableId.get(renderableId);
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
