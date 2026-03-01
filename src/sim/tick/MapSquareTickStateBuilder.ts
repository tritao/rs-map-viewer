import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { SdMapData } from "../../renderer/loader/SdMapData";
import { LocAnimated } from "../../renderer/loc/LocAnimated";
import { Npc } from "../../renderer/npc/Npc";
import { orderByPacketKeys } from "../../renderer/npc/orderByPacketKeys";
import { MapSquareTickState } from "./MapSquareTickState";

const DRAW_RANGE_STRIDE = 3;
const DRAW_RANGE_OFFSET_INDEX = 0;
const DRAW_RANGE_ELEMENTS_INDEX = 1;
const DRAW_RANGE_INSTANCES_INDEX = 2;

export function buildLocsAnimated(
    data: SdMapData,
    seqTypeLoader: SeqTypeLoader,
    time: number,
): { locsAnimated: LocAnimated[]; seqIds: number[] } {
    const cycle = time / 0.02;
    const seqIds: number[] = [];
    const locsAnimated: LocAnimated[] = [];

    for (const loc of data.locsAnimated) {
        const seqResult = seqTypeLoader.tryLoad(loc.seqId);
        if (!seqResult.ok) {
            continue;
        }
        const seqType = seqResult.value;
        seqIds.push(loc.seqId | 0);
        locsAnimated.push(
            new LocAnimated(
                loc.drawRangeIndex,
                loc.drawRangeAlphaIndex,
                loc.drawRangeLodIndex,
                loc.drawRangeLodAlphaIndex,
                loc.drawRangeInteractIndex,
                loc.drawRangeInteractAlphaIndex,
                loc.drawRangeInteractLodIndex,
                loc.drawRangeInteractLodAlphaIndex,
                loc.anim,
                seqType,
                cycle,
                loc.randomStart,
            ),
        );
    }

    return { locsAnimated, seqIds };
}

export function buildNpcs(
    data: SdMapData,
    npcTypeLoader: NpcTypeLoader,
    basTypeLoader: BasTypeLoader,
): Npc[] {
    const npcs: Npc[] = [];
    const npcInput = orderByPacketKeys(data.npcs, data.npcOrderKeys);
    for (const npc of npcInput) {
        const npcResult = npcTypeLoader.tryLoad(npc.id);
        if (!npcResult.ok) {
            continue;
        }
        const npcType = npcResult.value;

        npcs.push(
            new Npc(
                npc.tileX,
                npc.tileY,
                npc.level,
                npc.idleAnim,
                npc.walkAnim,
                npcType,
                npcType.getIdleSeqId(basTypeLoader),
                npcType.getWalkSeqId(basTypeLoader),
            ),
        );
    }
    return npcs;
}

export function buildNpcDrawRanges(
    npcs: ReadonlyArray<Npc>,
    packetDrawRangesBase: Int32Array | undefined,
): Int32Array {
    const hasPacketNpcDrawRanges =
        packetDrawRangesBase instanceof Int32Array &&
        packetDrawRangesBase.length === npcs.length * DRAW_RANGE_STRIDE;

    const drawRangesNpc = hasPacketNpcDrawRanges
        ? new Int32Array(packetDrawRangesBase)
        : new Int32Array(npcs.length * DRAW_RANGE_STRIDE);
    if (!hasPacketNpcDrawRanges) {
        for (let i = 0; i < npcs.length; i++) {
            const off = i * DRAW_RANGE_STRIDE;
            drawRangesNpc[off + DRAW_RANGE_OFFSET_INDEX] = 0;
            drawRangesNpc[off + DRAW_RANGE_ELEMENTS_INDEX] = 0;
            drawRangesNpc[off + DRAW_RANGE_INSTANCES_INDEX] = 1;
        }
    }
    return drawRangesNpc;
}

export type MapSquareTickStateBuildResult = Readonly<{
    tickState: MapSquareTickState;
    npcDrawRanges: Int32Array;
}>;

export function buildMapSquareTickState(
    mapId: number,
    data: SdMapData,
    seqTypeLoader: SeqTypeLoader,
    seqFrameLoader: SeqFrameLoader,
    npcTypeLoader: NpcTypeLoader,
    basTypeLoader: BasTypeLoader,
    time: number,
): MapSquareTickStateBuildResult {
    const tickState = new MapSquareTickState(mapId);

    const { locsAnimated, seqIds } = buildLocsAnimated(data, seqTypeLoader, time);
    tickState.setLocsAnimated(locsAnimated);
    tickState.initLocAnimationPatchData(seqFrameLoader, seqIds);

    const npcs = buildNpcs(data, npcTypeLoader, basTypeLoader);
    tickState.setNpcs(npcs);
    tickState.initNpcAnimationPatchData(
        seqTypeLoader,
        seqFrameLoader,
        data.npcDrawRangesBase,
        data.npcDrawRangesAlpha,
    );

    const npcDrawRanges = buildNpcDrawRanges(npcs, data.npcDrawRangesBase);
    return { tickState, npcDrawRanges };
}
