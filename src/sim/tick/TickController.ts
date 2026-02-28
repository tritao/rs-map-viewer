import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { BackendKind } from "../../util/BackendKind";
import type { MapSquareInfo } from "../../renderer/MapManager";
import { NULL_DRAW_RANGE } from "../../renderer/DrawRange";
import {
    registerDrawRangeTickState,
    tickAdvanceAndEmitBasePatchesForState,
    unregisterDrawRangeTickState,
} from "../../wasm/DrawRangePatchBackend";
import type { TickCapability, TickControllerRenderer } from "../../renderer/patch/TickCapability";
import { LOC_CYCLE_SCALE } from "../../wasm/LocCycle";

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
    mapRenderNpcSimInWorker?: boolean;
    mapRenderDebugTickSquare?: string;
}>;

function defaultRuntimeOptions(): RuntimeOptionsLike {
    return {};
}

export class TickController {
    private runtimeOptions: RuntimeOptionsLike = defaultRuntimeOptions();
    private debugSquare: TickDebugSquare = undefined;

    constructor(private readonly renderer: TickControllerRenderer | undefined) {}

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
        if (this.runtimeOptions.mapRenderNpcSimInWorker) {
            // Worker-driven NPC movement sim requires the TS tick path for now.
            return false;
        }
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
        renderable: TickCapability,
        locIndex: number,
        newFrameId: number,
    ): void {
        renderable.emitLocPatchesForChangedFrame(locIndex, newFrameId);
    }

    private tickWithTs(
        renderable: TickCapability,
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
            this.emitLocPatchesForChangedFrame(renderable, i, newFrame);
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
            renderable.emitNpcPatchesForNpcIndex(i, newFrame, baseFrame, alphaFrame);
        }
    }

    private tickWithWasm(
        renderable: TickCapability,
        mapInfo: MapSquareInfo,
        cycleNowFixed: number,
        clientTicksElapsed: number,
    ): boolean {
        const wantDebugTick =
            !!this.debugSquare &&
            mapInfo.mapX === this.debugSquare.mapX &&
            mapInfo.mapY === this.debugSquare.mapY;
        const preLocFrameIds = wantDebugTick ? renderable.copyLocFrameIds() : undefined;

        const stateWasInitialized = renderable.ensureCppTickStateInitializedFromObjects();
        renderable.syncNpcMovementStateFromObjects();
        renderable.syncNpcPathStateFromObjects();

        if (stateWasInitialized) {
            const registered = registerDrawRangeTickState(
                renderable.id,
                renderable.getWasmTickStateInput(),
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

        if (wantDebugTick && preLocFrameIds) {
            // Keep the existing lightweight validation: ensure changed loc frames emitted a base patch.
            const { patches, count: patchCount } = renderable.getLocBasePatchStreamDebug();
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
            const locs = renderable.getLocsAnimated();
            for (let li = 0; li < locs.length; li++) {
                const oldFrame = preLocFrameIds[li] | 0;
                const newFrame = renderable.getLocFrameId(li) | 0;
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
        renderable: TickCapability,
        mapInfo: MapSquareInfo,
        cycle: number,
        clientTicksElapsed: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ): void {
        const cycleNowFixed = Math.round(cycle * LOC_CYCLE_SCALE) | 0;
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
