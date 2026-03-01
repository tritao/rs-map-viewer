import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { NULL_DRAW_RANGE } from "../../renderer/DrawRange";
import { unregisterDrawRangeTickState } from "../../wasm/DrawRangePatchBackend";
import type { TsTickCapability } from "../contracts/TickCapability";
import { LocTickPatchVariant, NpcTickPatchVariant } from "../contracts/TickPatchStreams";
import type { TickPatchSink } from "./TickController";

type TsTickRuntimeOptions = Readonly<{
    mapRenderNpcSimInWorker?: boolean;
}>;

function defaultRuntimeOptions(): TsTickRuntimeOptions {
    return {};
}

export class TsTickBackend {
    private runtimeOptions: TsTickRuntimeOptions = defaultRuntimeOptions();

    setRuntimeOptions(options: TsTickRuntimeOptions | undefined): void {
        this.runtimeOptions = options ?? defaultRuntimeOptions();
    }

    tick(
        renderable: TsTickCapability,
        cycle: number,
        clientTicksElapsed: number,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        sink?: TickPatchSink,
    ): void {
        unregisterDrawRangeTickState(renderable.id);
        renderable.resetCppTickStateLifecycle();

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
            if (!sink) {
                continue;
            }
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
        if (!sink) {
            return;
        }
        for (let i = 0; i < npcCount; i++) {
            const npc = npcs[i];
            const newFrame = npc.movementFrame | 0;
            const anim = npc.getAnimationFrames();
            const baseFrame = anim?.frames?.[newFrame] ?? NULL_DRAW_RANGE;
            const alphaFrame = anim?.framesAlpha ? anim.framesAlpha[newFrame] : NULL_DRAW_RANGE;
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
