import type { SeqTypeLoader } from "../rs/config/seqtype/SeqTypeLoader";
import type { SeqFrameLoader } from "../rs/model/seq/SeqFrameLoader";
import type { BackendKind } from "../util/BackendKind";
import type { MapSquareInfo } from "./MapManager";
import { NULL_DRAW_RANGE } from "./DrawRange";
import {
    registerDrawRangeTickState,
    tickAdvanceAndEmitBasePatchesForState,
    unregisterDrawRangeTickState,
} from "./webgl/DrawRangePatchBackend";
import type { WebGLMapRenderer } from "./webgl/WebGLMapRenderer";
import type { WebGLRenderable } from "./webgl/WebGLRenderable";

type TickBackendKind = BackendKind;
type TickDebugSquare = Readonly<{ mapX: number; mapY: number }> | undefined;

function parseTickDebugSquare(value: unknown): TickDebugSquare {
    if (typeof value !== "string" || !value.includes(":")) {
        return undefined;
    }
    const [xRaw, yRaw] = value.split(":");
    const x = parseInt(xRaw ?? "", 10);
    const y = parseInt(yRaw ?? "", 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return undefined;
    }
    const mapX = x | 0;
    const mapY = y | 0;
    if (mapX < 0 || mapY < 0) {
        return undefined;
    }
    return { mapX, mapY };
}

type RuntimeOptionsLike = Readonly<{
    mapRenderBackend?: TickBackendKind;
    mapRenderTickBackend?: TickBackendKind;
    mapRenderDebugTickSquare?: string;
}>;

function defaultRuntimeOptions(): RuntimeOptionsLike {
    return {};
}

export class TickController {
    private runtimeOptions: RuntimeOptionsLike = defaultRuntimeOptions();
    private debugSquare: TickDebugSquare = undefined;

    constructor(private readonly renderer: WebGLMapRenderer | undefined) {}

    setRuntimeOptions(options: RuntimeOptionsLike): void {
        this.runtimeOptions = options ?? defaultRuntimeOptions();
        this.debugSquare = parseTickDebugSquare(options?.mapRenderDebugTickSquare);
    }

    onRenderableRemoved(renderableId: number): void {
        unregisterDrawRangeTickState(renderableId);
    }

    reset(): void {
        // Backend state lives in the draw-range patch backend; best-effort clear by id is done via
        // onRenderableRemoved during map unload.
        this.debugSquare = undefined;
        this.runtimeOptions = defaultRuntimeOptions();
    }

    private shouldUseCppWasmTickBackend(): boolean {
        const tickBackend =
            this.runtimeOptions.mapRenderTickBackend ?? this.runtimeOptions.mapRenderBackend;

        const ready = this.renderer?.isDrawRangePatchWasmReady() ?? false;
        return tickBackend === "cpp-wasm" && ready;
    }

    private emitPatch(
        outPacked: Int32Array,
        count: number,
        drawRangeIndex: number,
        frame: readonly [number, number, number],
    ): number {
        if (drawRangeIndex < 0) {
            return count;
        }
        const off = (count | 0) * 4;
        if (off + 3 >= outPacked.length) {
            return count;
        }
        outPacked[off + 0] = drawRangeIndex | 0;
        outPacked[off + 1] = frame[0] | 0;
        outPacked[off + 2] = frame[1] | 0;
        outPacked[off + 3] = frame[2] | 0;
        return (count + 1) | 0;
    }

    private emitLocPatchesForChangedFrame(
        renderable: WebGLRenderable,
        locIndex: number,
        newFrameId: number,
    ): void {
        const loc = renderable.locsAnimated[locIndex];
        const baseFrame = loc.anim.frames?.[newFrameId] as [number, number, number] | undefined;
        if (!baseFrame) {
            return;
        }
        const alphaFrame = (loc.anim.framesAlpha?.[newFrameId] ??
            undefined) as [number, number, number] | undefined;

        const baseIndex = renderable.locDrawRangeIndicesBase[locIndex] | 0;
        renderable.locTickBasePatchCount = this.emitPatch(
            renderable.locTickBasePatches,
            renderable.locTickBasePatchCount,
            baseIndex,
            baseFrame,
        );

        const lodIndex = renderable.locDrawRangeIndicesLod[locIndex] | 0;
        renderable.locTickLodPatchCount = this.emitPatch(
            renderable.locTickLodPatches,
            renderable.locTickLodPatchCount,
            lodIndex,
            baseFrame,
        );

        const interactIndex = renderable.locDrawRangeIndicesInteract[locIndex] | 0;
        renderable.locTickInteractPatchCount = this.emitPatch(
            renderable.locTickInteractPatches,
            renderable.locTickInteractPatchCount,
            interactIndex,
            baseFrame,
        );

        const interactLodIndex = renderable.locDrawRangeIndicesInteractLod[locIndex] | 0;
        renderable.locTickInteractLodPatchCount = this.emitPatch(
            renderable.locTickInteractLodPatches,
            renderable.locTickInteractLodPatchCount,
            interactLodIndex,
            baseFrame,
        );

        if (!alphaFrame) {
            return;
        }

        const alphaIndex = renderable.locDrawRangeIndicesAlpha[locIndex] | 0;
        renderable.locTickAlphaPatchCount = this.emitPatch(
            renderable.locTickAlphaPatches,
            renderable.locTickAlphaPatchCount,
            alphaIndex,
            alphaFrame,
        );

        const lodAlphaIndex = renderable.locDrawRangeIndicesLodAlpha[locIndex] | 0;
        renderable.locTickLodAlphaPatchCount = this.emitPatch(
            renderable.locTickLodAlphaPatches,
            renderable.locTickLodAlphaPatchCount,
            lodAlphaIndex,
            alphaFrame,
        );

        const interactAlphaIndex = renderable.locDrawRangeIndicesInteractAlpha[locIndex] | 0;
        renderable.locTickInteractAlphaPatchCount = this.emitPatch(
            renderable.locTickInteractAlphaPatches,
            renderable.locTickInteractAlphaPatchCount,
            interactAlphaIndex,
            alphaFrame,
        );

        const interactLodAlphaIndex = renderable.locDrawRangeIndicesInteractLodAlpha[locIndex] | 0;
        renderable.locTickInteractLodAlphaPatchCount = this.emitPatch(
            renderable.locTickInteractLodAlphaPatches,
            renderable.locTickInteractLodAlphaPatchCount,
            interactLodAlphaIndex,
            alphaFrame,
        );
    }

    private tickWithTs(
        renderable: WebGLRenderable,
        cycle: number,
        clientTicksElapsed: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ): void {
        // Keep wasm state fully disabled when using the TS tick path.
        unregisterDrawRangeTickState(renderable.id);
        renderable.resetCppTickStateLifecycle();

        renderable.resetTickPatchCountsToZero();

        // Locs: update and emit patches for changed frames.
        renderable.syncLocAnimationFrameIds();
        for (let i = 0; i < renderable.locsAnimated.length; i++) {
            const loc = renderable.locsAnimated[i];
            const oldFrame = renderable.locFrameIds[i] | 0;
            loc.update(seqFrameLoader, cycle);
            const newFrame = loc.frame | 0;
            if (newFrame === oldFrame) {
                continue;
            }
            renderable.locFrameIds[i] = newFrame;
            this.emitLocPatchesForChangedFrame(renderable, i, newFrame);
        }

        // Npcs: advance movement and emit patches for final frame changes.
        const npcCount = renderable.npcs.length | 0;
        for (let t = 0; t < clientTicksElapsed; t++) {
            for (let i = 0; i < npcCount; i++) {
                renderable.npcs[i].updateMovement(seqTypeLoader, seqFrameLoader);
            }
        }
        for (let i = 0; i < npcCount; i++) {
            const npc = renderable.npcs[i];
            const newFrame = npc.movementFrame | 0;
            renderable.npcFrameIds[i] = newFrame;
            const anim = npc.getAnimationFrames();
            const baseFrame = anim?.frames?.[newFrame] ?? NULL_DRAW_RANGE;
            const alphaFrame = anim?.framesAlpha ? anim.framesAlpha[newFrame] : NULL_DRAW_RANGE;
            const drawRangeIndex = renderable.npcDrawRangeIndices[i] | 0;
            renderable.npcTickBasePatchCount = this.emitPatch(
                renderable.npcTickBasePatches,
                renderable.npcTickBasePatchCount,
                drawRangeIndex,
                baseFrame,
            );
            renderable.npcTickAlphaPatchCount = this.emitPatch(
                renderable.npcTickAlphaPatches,
                renderable.npcTickAlphaPatchCount,
                drawRangeIndex,
                alphaFrame,
            );
        }
    }

    private tickWithWasm(
        renderable: WebGLRenderable,
        mapInfo: MapSquareInfo,
        cycleNowFixed: number,
        clientTicksElapsed: number,
    ): boolean {
        const wantDebugTick =
            !!this.debugSquare &&
            mapInfo.mapX === this.debugSquare.mapX &&
            mapInfo.mapY === this.debugSquare.mapY;
        const preLocFrameIds =
            wantDebugTick && renderable.locFrameIds instanceof Int32Array
                ? new Int32Array(renderable.locFrameIds)
                : undefined;

        const stateWasInitialized = renderable.ensureCppTickStateInitializedFromObjects();
        renderable.syncNpcMovementStateFromObjects();
        renderable.syncNpcPathStateFromObjects();

        if (stateWasInitialized) {
            const registered = registerDrawRangeTickState(renderable.id, {
                locFrameIds: renderable.locFrameIds,
                locCycleStartsFixed: renderable.locCycleStartsFixed,
                locFrameSteps: renderable.locSeqFrameSteps,
                locHasAnimMaya: renderable.locSeqHasAnimMaya,
                locAnimMayaDurations: renderable.locSeqAnimMayaDurations,
                locFrameLengthOffsets: renderable.locSeqFrameLengthOffsets,
                locFrameLengthCounts: renderable.locSeqFrameLengthCounts,
                locFrameLengthsPacked: renderable.locSeqFrameLengthsPacked,
                locSeqIds: renderable.locSeqIds,
                locOutActiveFlags: renderable.locSeqActiveFlags,
                locDrawRangeIndicesBase: renderable.locDrawRangeIndicesBase,
                locAnimFrameOffsetsBase: renderable.locAnimFrameOffsetsBase,
                locAnimFrameCountsBase: renderable.locAnimFrameCountsBase,
                locAnimFramesBasePacked: renderable.locAnimFramesBasePacked,
                outLocPatchesPacked: renderable.locTickBasePatches,
                locDrawRangeIndicesAlpha: renderable.locDrawRangeIndicesAlpha,
                locDrawRangeIndicesLod: renderable.locDrawRangeIndicesLod,
                locDrawRangeIndicesLodAlpha: renderable.locDrawRangeIndicesLodAlpha,
                locDrawRangeIndicesInteract: renderable.locDrawRangeIndicesInteract,
                locDrawRangeIndicesInteractAlpha: renderable.locDrawRangeIndicesInteractAlpha,
                locDrawRangeIndicesInteractLod: renderable.locDrawRangeIndicesInteractLod,
                locDrawRangeIndicesInteractLodAlpha: renderable.locDrawRangeIndicesInteractLodAlpha,
                locAnimFrameOffsetsAlpha: renderable.locAnimFrameOffsetsAlpha,
                locAnimFrameCountsAlpha: renderable.locAnimFrameCountsAlpha,
                locAnimFramesAlphaPacked: renderable.locAnimFramesAlphaPacked,
                outLocAlphaPatchesPacked: renderable.locTickAlphaPatches,
                outLocLodPatchesPacked: renderable.locTickLodPatches,
                outLocLodAlphaPatchesPacked: renderable.locTickLodAlphaPatches,
                outLocInteractPatchesPacked: renderable.locTickInteractPatches,
                outLocInteractAlphaPatchesPacked: renderable.locTickInteractAlphaPatches,
                outLocInteractLodPatchesPacked: renderable.locTickInteractLodPatches,
                outLocInteractLodAlphaPatchesPacked: renderable.locTickInteractLodAlphaPatches,

                npcX: renderable.npcX,
                npcY: renderable.npcY,
                npcOrientation: renderable.npcOrientation,
                npcRotation: renderable.npcRotation,
                npcPathLength: renderable.npcPathLength,
                npcMovementSeqId: renderable.npcMovementSeqId,
                npcPathXPacked: renderable.npcPathXPacked,
                npcPathYPacked: renderable.npcPathYPacked,
                npcPathMovementTypePacked: renderable.npcPathMovementTypePacked,
                npcSize: renderable.npcSize,
                npcIsClickable: renderable.npcIsClickable,
                npcRotationSpeed: renderable.npcRotationSpeed,
                npcIdleSeqId: renderable.npcIdleSeqId,
                npcWalkSeqId: renderable.npcWalkSeqId,
                npcHasWalkAnim: renderable.npcHasWalkAnim,
                npcFrameIds: renderable.npcFrameIds,
                npcFrameTicks: renderable.npcFrameTicks,
                npcMovementLoops: renderable.npcMovementLoops,
                npcIdleSeqValid: renderable.npcIdleSeqValid,
                npcIdleSeqHasAnimMaya: renderable.npcIdleSeqHasAnimMaya,
                npcIdleSeqAnimMayaDurations: renderable.npcIdleSeqAnimMayaDurations,
                npcIdleSeqFrameSteps: renderable.npcIdleSeqFrameSteps,
                npcIdleSeqLooping: renderable.npcIdleSeqLooping,
                npcIdleSeqMaxLoops: renderable.npcIdleSeqMaxLoops,
                npcIdleSeqFrameIdCounts: renderable.npcIdleSeqFrameIdCounts,
                npcIdleSeqFrameLengthOffsets: renderable.npcIdleSeqFrameLengthOffsets,
                npcIdleSeqFrameLengthCounts: renderable.npcIdleSeqFrameLengthCounts,
                npcWalkSeqValid: renderable.npcWalkSeqValid,
                npcWalkSeqHasAnimMaya: renderable.npcWalkSeqHasAnimMaya,
                npcWalkSeqAnimMayaDurations: renderable.npcWalkSeqAnimMayaDurations,
                npcWalkSeqFrameSteps: renderable.npcWalkSeqFrameSteps,
                npcWalkSeqLooping: renderable.npcWalkSeqLooping,
                npcWalkSeqMaxLoops: renderable.npcWalkSeqMaxLoops,
                npcWalkSeqFrameIdCounts: renderable.npcWalkSeqFrameIdCounts,
                npcWalkSeqFrameLengthOffsets: renderable.npcWalkSeqFrameLengthOffsets,
                npcWalkSeqFrameLengthCounts: renderable.npcWalkSeqFrameLengthCounts,
                npcSeqFrameLengthsPacked: renderable.npcSeqFrameLengthsPacked,
                npcDrawRangeIndices: renderable.npcDrawRangeIndices,
                npcIdleAnimFrameOffsetsBase: renderable.npcIdleFrameOffsetsBase,
                npcIdleAnimFrameCountsBase: renderable.npcIdleFrameCountsBase,
                npcWalkAnimFrameOffsetsBase: renderable.npcWalkFrameOffsetsBase,
                npcWalkAnimFrameCountsBase: renderable.npcWalkFrameCountsBase,
                npcAnimFramesBasePacked: renderable.npcAnimFramesBasePacked,
                outNpcPatchesPacked: renderable.npcTickBasePatches,
                npcIdleAnimFrameOffsetsAlpha: renderable.npcIdleFrameOffsetsAlpha,
                npcIdleAnimFrameCountsAlpha: renderable.npcIdleFrameCountsAlpha,
                npcWalkAnimFrameOffsetsAlpha: renderable.npcWalkFrameOffsetsAlpha,
                npcWalkAnimFrameCountsAlpha: renderable.npcWalkFrameCountsAlpha,
                npcAnimFramesAlphaPacked: renderable.npcAnimFramesAlphaPacked,
                npcNullAlphaFrameOffset: renderable.npcNullAlphaFrameOffset,
                outNpcAlphaPatchesPacked: renderable.npcTickAlphaPatches,
            });
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

        renderable.applyLocAnimationStateToObjects();
        renderable.applyNpcFrameStateToObjects();

        renderable.locTickBasePatchCount = tickResult.locBasePatchCount | 0;
        renderable.locTickAlphaPatchCount = tickResult.locAlphaPatchCount | 0;
        renderable.locTickLodPatchCount = tickResult.locLodPatchCount | 0;
        renderable.locTickLodAlphaPatchCount = tickResult.locLodAlphaPatchCount | 0;
        renderable.locTickInteractPatchCount = tickResult.locInteractPatchCount | 0;
        renderable.locTickInteractAlphaPatchCount = tickResult.locInteractAlphaPatchCount | 0;
        renderable.locTickInteractLodPatchCount = tickResult.locInteractLodPatchCount | 0;
        renderable.locTickInteractLodAlphaPatchCount = tickResult.locInteractLodAlphaPatchCount | 0;
        renderable.npcTickBasePatchCount = tickResult.npcBasePatchCount | 0;
        renderable.npcTickAlphaPatchCount = tickResult.npcAlphaPatchCount | 0;

        if (wantDebugTick && preLocFrameIds) {
            // Keep the existing lightweight validation: ensure changed loc frames emitted a base patch.
            const patches = renderable.locTickBasePatches;
            const patchCount = renderable.locTickBasePatchCount | 0;
            const patchMap = new Map<number, [number, number, number]>();
            const safePatchCount = Math.min(patchCount, Math.floor(patches.length / 4));
            for (let p = 0; p < safePatchCount; p++) {
                const off = p * 4;
                const drawRangeIndex = patches[off + 0] | 0;
                patchMap.set(drawRangeIndex, [
                    patches[off + 1] | 0,
                    patches[off + 2] | 0,
                    patches[off + 3] | 0,
                ]);
            }
            const locs = renderable.locsAnimated;
            for (let li = 0; li < locs.length; li++) {
                const oldFrame = preLocFrameIds[li] | 0;
                const newFrame = renderable.locFrameIds[li] | 0;
                if (oldFrame === newFrame) {
                    continue;
                }
                const loc = locs[li];
                const drawRangeIndex = loc.drawRangeIndex | 0;
                const expected = loc.anim.frames?.[newFrame];
                const actual = patchMap.get(drawRangeIndex);
                if (!expected || !actual) {
                    // Keep it as a warning; strict mode already validates patch stream bounds elsewhere.
                    console.warn("[map-render-backend][tick-debug] missing patch for frame change", {
                        square: `${mapInfo.mapX}:${mapInfo.mapY}`,
                        locIndex: li,
                        drawRangeIndex,
                        oldFrame,
                        newFrame,
                        patchCount,
                    });
                    break;
                }
            }
        }

        return true;
    }

    tickRenderable(
        renderable: WebGLRenderable,
        mapInfo: MapSquareInfo,
        cycle: number,
        cycleNowFixed: number,
        clientTicksElapsed: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ): void {
        const useWasm = this.shouldUseCppWasmTickBackend();
        if (useWasm) {
            const ok = this.tickWithWasm(
                renderable,
                mapInfo,
                cycleNowFixed,
                clientTicksElapsed,
            );
            if (ok) {
                return;
            }
        }

        this.tickWithTs(renderable, cycle, clientTicksElapsed, seqTypeLoader, seqFrameLoader);
    }
}
