import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { BackendKind } from "../../util/BackendKind";
import type { MapSquareInfo } from "../../renderer/MapManager";
import { NULL_DRAW_RANGE } from "../../renderer/DrawRange";
import {
    isDrawRangePatchBackendReady,
    registerDrawRangeTickState,
    tickAdvanceAndEmitBasePatchesForState,
    unregisterDrawRangeTickState,
} from "../../wasm/DrawRangePatchBackend";
import type { DrawRangeTickStateInput } from "../../wasm/DrawRangeTickState";
import type { TickCapability } from "../../renderer/patch/TickCapability";
import { LocTickPatchVariant, NpcTickPatchVariant } from "../../renderer/patch/TickPatchStreams";
import { LOC_CYCLE_SCALE } from "../../wasm/LocCycle";

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

type WasmTickOutputs = Readonly<{
    locStreams: readonly Int32Array[];
    npcStreams: readonly Int32Array[];
}>;

function defaultRuntimeOptions(): RuntimeOptionsLike {
    return {};
}

export class TickController {
    private runtimeOptions: RuntimeOptionsLike = defaultRuntimeOptions();
    private readonly wasmTickOutputsByRenderableId = new Map<number, WasmTickOutputs>();

    setRuntimeOptions(options: RuntimeOptionsLike): void {
        this.runtimeOptions = options ?? defaultRuntimeOptions();
    }

    onRenderableRemoved(renderableId: number): void {
        unregisterDrawRangeTickState(renderableId);
        this.wasmTickOutputsByRenderableId.delete(renderableId | 0);
    }

    reset(): void {
        // Backend state lives in the draw-range patch backend; best-effort clear by id is done via
        // onRenderableRemoved during map unload.
        this.runtimeOptions = defaultRuntimeOptions();
        this.wasmTickOutputsByRenderableId.clear();
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

    private shouldUseCppWasmTickBackend(): boolean {
        if (this.runtimeOptions.mapRenderNpcSimInWorker) {
            // Worker-driven NPC movement sim requires the TS tick path for now.
            return false;
        }
        const tickBackend =
            this.runtimeOptions.mapRenderTickBackend ?? this.runtimeOptions.mapRenderBackend;

        const ready = isDrawRangePatchBackendReady();
        return tickBackend === "cpp-wasm" && ready;
    }

    private tickWithTs(
        renderable: TickCapability,
        cycle: number,
        clientTicksElapsed: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        sink?: TickPatchSink,
    ): void {
        // Keep wasm state fully disabled when using the TS tick path.
        unregisterDrawRangeTickState(renderable.id);
        renderable.resetCppTickStateLifecycle();

        // Locs: update and emit patches for changed frames.
        renderable.syncLocAnimationFrameIds();
        const locs = renderable.getLocsAnimated();
        for (let i = 0; i < locs.length; i++) {
            const loc = locs[i];
            const oldFrame = renderable.getLocFrameId(i) | 0;
            loc.update(seqFrameLoader, cycle);
            const newFrame = loc.frame | 0;
            if (newFrame === oldFrame) {
                continue;
            }
            renderable.setLocFrameId(i, newFrame);
            if (sink) {
                const baseFrame = loc.anim.frames?.[newFrame];
                if (baseFrame) {
                    sink.emitLocPatch(
                        LocTickPatchVariant.Base,
                        loc.drawRangeIndex | 0,
                        baseFrame[0] | 0,
                        baseFrame[1] | 0,
                        baseFrame[2] | 0,
                    );
                    sink.emitLocPatch(
                        LocTickPatchVariant.Lod,
                        loc.drawRangeLodIndex | 0,
                        baseFrame[0] | 0,
                        baseFrame[1] | 0,
                        baseFrame[2] | 0,
                    );
                    sink.emitLocPatch(
                        LocTickPatchVariant.Interact,
                        loc.drawRangeInteractIndex | 0,
                        baseFrame[0] | 0,
                        baseFrame[1] | 0,
                        baseFrame[2] | 0,
                    );
                    sink.emitLocPatch(
                        LocTickPatchVariant.InteractLod,
                        loc.drawRangeInteractLodIndex | 0,
                        baseFrame[0] | 0,
                        baseFrame[1] | 0,
                        baseFrame[2] | 0,
                    );
                }
                const alphaFrame = loc.anim.framesAlpha?.[newFrame];
                if (alphaFrame) {
                    sink.emitLocPatch(
                        LocTickPatchVariant.Alpha,
                        loc.drawRangeAlphaIndex | 0,
                        alphaFrame[0] | 0,
                        alphaFrame[1] | 0,
                        alphaFrame[2] | 0,
                    );
                    sink.emitLocPatch(
                        LocTickPatchVariant.LodAlpha,
                        loc.drawRangeLodAlphaIndex | 0,
                        alphaFrame[0] | 0,
                        alphaFrame[1] | 0,
                        alphaFrame[2] | 0,
                    );
                    sink.emitLocPatch(
                        LocTickPatchVariant.InteractAlpha,
                        loc.drawRangeInteractAlphaIndex | 0,
                        alphaFrame[0] | 0,
                        alphaFrame[1] | 0,
                        alphaFrame[2] | 0,
                    );
                    sink.emitLocPatch(
                        LocTickPatchVariant.InteractLodAlpha,
                        loc.drawRangeInteractLodAlphaIndex | 0,
                        alphaFrame[0] | 0,
                        alphaFrame[1] | 0,
                        alphaFrame[2] | 0,
                    );
                }
            }
        }

        // Npcs: advance movement and emit patches for final frame changes.
        const npcs = renderable.getNpcs();
        const npcCount = npcs.length | 0;
        for (let t = 0; t < clientTicksElapsed; t++) {
            for (let i = 0; i < npcCount; i++) {
                if (this.runtimeOptions.mapRenderNpcSimInWorker) {
                    npcs[i].updateMovementSeq(seqTypeLoader, seqFrameLoader);
                } else {
                    npcs[i].updateMovement(seqTypeLoader, seqFrameLoader);
                }
            }
        }
        for (let i = 0; i < npcCount; i++) {
            const npc = npcs[i];
            const newFrame = npc.movementFrame | 0;
            const anim = npc.getAnimationFrames();
            const baseFrame = anim?.frames?.[newFrame] ?? NULL_DRAW_RANGE;
            const alphaFrame = anim?.framesAlpha ? anim.framesAlpha[newFrame] : NULL_DRAW_RANGE;
            if (sink) {
                sink.emitNpcPatch(
                    NpcTickPatchVariant.Base,
                    i | 0,
                    baseFrame[0] | 0,
                    baseFrame[1] | 0,
                    baseFrame[2] | 0,
                );
                sink.emitNpcPatch(
                    NpcTickPatchVariant.Alpha,
                    i | 0,
                    alphaFrame[0] | 0,
                    alphaFrame[1] | 0,
                    alphaFrame[2] | 0,
                );
            }
        }
    }

    private tickWithWasm(
        renderable: TickCapability,
        _mapInfo: MapSquareInfo,
        cycleNowFixed: number,
        clientTicksElapsed: number,
        sink?: TickPatchSink,
    ): boolean {
        const stateWasInitialized = renderable.ensureCppTickStateInitializedFromObjects();
        renderable.syncNpcMovementStateFromObjects();
        renderable.syncNpcPathStateFromObjects();

        let stateInput: DrawRangeTickStateInput | undefined;
        if (stateWasInitialized || !this.wasmTickOutputsByRenderableId.has(renderable.id | 0)) {
            stateInput = renderable.getWasmTickStateInput();
            this.wasmTickOutputsByRenderableId.set(
                renderable.id | 0,
                this.toWasmTickOutputs(stateInput),
            );
        }

        if (stateWasInitialized) {
            const registered = registerDrawRangeTickState(
                renderable.id,
                stateInput!,
            );
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
            const outputs = this.wasmTickOutputsByRenderableId.get(renderable.id | 0);
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

    tickRenderable(
        renderable: TickCapability,
        mapInfo: MapSquareInfo,
        cycle: number,
        clientTicksElapsed: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        sink?: TickPatchSink,
    ): void {
        const cycleNowFixed = Math.round(cycle * LOC_CYCLE_SCALE) | 0;
        const useWasm = this.shouldUseCppWasmTickBackend();
        if (useWasm) {
            const ok = this.tickWithWasm(
                renderable,
                mapInfo,
                cycleNowFixed,
                clientTicksElapsed,
                sink,
            );
            if (ok) {
                return;
            }
        }

        this.tickWithTs(renderable, cycle, clientTicksElapsed, seqTypeLoader, seqFrameLoader, sink);
    }
}
