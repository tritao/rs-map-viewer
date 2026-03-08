import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { DrawRange } from "../../shared/DrawRange";
import {
    TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE,
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
} from "../../shared/TickPatchLayout";
import type { NpcSimMapState } from "./NpcSimStateStore";

const NULL_DRAW_RANGE: DrawRange = [0, 0, 0];

function emitTickPatch(
    outPacked: Int32Array,
    count: number,
    drawRangeIndex: number,
    frame: DrawRange,
): number {
    if ((drawRangeIndex | 0) < 0) {
        return count | 0;
    }
    const off = ((count | 0) * TICK_PATCH_ENTRY_STRIDE) | 0;
    if (off + 3 >= outPacked.length) {
        return count | 0;
    }
    outPacked[off + 0] = drawRangeIndex | 0;
    outPacked[off + 1] = frame[0] | 0;
    outPacked[off + 2] = frame[1] | 0;
    outPacked[off + 3] = frame[2] | 0;
    return (count + 1) | 0;
}

function emitLocPatchesForChangedFrame(
    state: NpcSimMapState,
    locIndex: number,
    newFrameId: number,
) {
    const loc = state.locsAnimated[locIndex];
    const baseFrame = (loc.anim.frames?.[newFrameId] ?? undefined) as DrawRange | undefined;
    if (!baseFrame) {
        return;
    }
    const alphaFrame = (loc.anim.framesAlpha?.[newFrameId] ?? undefined) as DrawRange | undefined;

    state.locTickPatchCountsByVariant[0] = emitTickPatch(
        state.locTickPatchesByVariant[0]!,
        state.locTickPatchCountsByVariant[0] | 0,
        loc.drawRangeIndex | 0,
        baseFrame,
    );
    state.locTickPatchCountsByVariant[2] = emitTickPatch(
        state.locTickPatchesByVariant[2]!,
        state.locTickPatchCountsByVariant[2] | 0,
        loc.drawRangeLodIndex | 0,
        baseFrame,
    );
    state.locTickPatchCountsByVariant[4] = emitTickPatch(
        state.locTickPatchesByVariant[4]!,
        state.locTickPatchCountsByVariant[4] | 0,
        loc.drawRangeInteractIndex | 0,
        baseFrame,
    );
    state.locTickPatchCountsByVariant[6] = emitTickPatch(
        state.locTickPatchesByVariant[6]!,
        state.locTickPatchCountsByVariant[6] | 0,
        loc.drawRangeInteractLodIndex | 0,
        baseFrame,
    );

    if (!alphaFrame) {
        return;
    }
    state.locTickPatchCountsByVariant[1] = emitTickPatch(
        state.locTickPatchesByVariant[1]!,
        state.locTickPatchCountsByVariant[1] | 0,
        loc.drawRangeAlphaIndex | 0,
        alphaFrame,
    );
    state.locTickPatchCountsByVariant[3] = emitTickPatch(
        state.locTickPatchesByVariant[3]!,
        state.locTickPatchCountsByVariant[3] | 0,
        loc.drawRangeLodAlphaIndex | 0,
        alphaFrame,
    );
    state.locTickPatchCountsByVariant[5] = emitTickPatch(
        state.locTickPatchesByVariant[5]!,
        state.locTickPatchCountsByVariant[5] | 0,
        loc.drawRangeInteractAlphaIndex | 0,
        alphaFrame,
    );
    state.locTickPatchCountsByVariant[7] = emitTickPatch(
        state.locTickPatchesByVariant[7]!,
        state.locTickPatchCountsByVariant[7] | 0,
        loc.drawRangeInteractLodAlphaIndex | 0,
        alphaFrame,
    );
}

export type WasmMapPatchStreamReadResult = Readonly<{
    hasWasmCountsForMap: boolean;
    useWasmLocStreams: boolean;
    streamsForMap: (Int32Array | undefined)[];
    nextReadOff: number;
}>;

export function readWasmPatchStreamsForMap(
    mapId: number,
    mapEntryIndex: number,
    readOff: number,
    wasmCountsByMapId: Int32Array | undefined,
    wasmPatchesPacked: Int32Array | undefined,
): WasmMapPatchStreamReadResult {
    const streamsForMap = new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT);
    const metaOff = (mapEntryIndex | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE;
    if (
        !(wasmPatchesPacked instanceof Int32Array) ||
        !(wasmCountsByMapId instanceof Int32Array) ||
        metaOff + TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE > wasmCountsByMapId.length
    ) {
        return {
            hasWasmCountsForMap: false,
            useWasmLocStreams: false,
            streamsForMap,
            nextReadOff: readOff | 0,
        };
    }

    let nextReadOff = readOff | 0;
    const useWasmLocStreams = (wasmCountsByMapId[metaOff + 0] | 0) === (mapId | 0);
    for (let streamIndex = 0; streamIndex < TICK_PATCH_STREAM_COUNT; streamIndex++) {
        const wasmCount = wasmCountsByMapId[metaOff + 1 + streamIndex] | 0;
        const wasmLen = (wasmCount * TICK_PATCH_ENTRY_STRIDE) | 0;
        if (wasmLen <= 0) {
            continue;
        }
        const end = (nextReadOff + wasmLen) | 0;
        if (end > (wasmPatchesPacked.length | 0)) {
            throw new Error(
                `[map-render][tick][cpp-wasm] wasm patch stream OOB ` +
                    `mapId=${mapId | 0} stream=${streamIndex | 0} readOff=${nextReadOff | 0} ` +
                    `len=${wasmLen | 0} packedLen=${wasmPatchesPacked.length | 0}`,
            );
        }
        if (useWasmLocStreams) {
            streamsForMap[streamIndex] = wasmPatchesPacked.subarray(nextReadOff, end);
        }
        nextReadOff = end;
    }

    return {
        hasWasmCountsForMap: true,
        useWasmLocStreams,
        streamsForMap,
        nextReadOff,
    };
}

export type BuildTickPatchStreamsForMapInput = Readonly<{
    mapId: number;
    mapEntryIndex: number;
    cycleNow: number;
    state: NpcSimMapState;
    seqFrameLoader: SeqFrameLoader;
    includeTsLocTickPatches: boolean;
    useWasmLocStreams: boolean;
    hasWasmCountsForMap: boolean;
    wasmLocStreamsForMap: readonly (Int32Array | undefined)[];
    wasmCountsByMapId: Int32Array | undefined;
}>;

export type BuiltTickPatchStreamsForMap = Readonly<{
    streamCounts: Int32Array;
    streamsForMap: (Int32Array | undefined)[];
}>;

export function buildTickPatchStreamsForMap(
    input: BuildTickPatchStreamsForMapInput,
): BuiltTickPatchStreamsForMap {
    const streamsForMap = new Array<Int32Array | undefined>(TICK_PATCH_STREAM_COUNT);
    const streamCounts = new Int32Array(TICK_PATCH_STREAM_COUNT);
    const state = input.state;

    state.locTickPatchCountsByVariant.fill(0);
    state.npcTickPatchCountsByVariant[0] = 0;
    state.npcTickPatchCountsByVariant[1] = 0;

    if (input.includeTsLocTickPatches) {
        for (let li = 0; li < state.locsAnimated.length; li++) {
            const loc = state.locsAnimated[li];
            loc.update(input.seqFrameLoader, input.cycleNow);
            const newFrameId = loc.frame | 0;
            emitLocPatchesForChangedFrame(state, li, newFrameId);
        }
    }

    for (let ni = 0; ni < state.npcs.length; ni++) {
        const npc = state.npcs[ni]!;
        const newFrameId = npc.movementFrame | 0;
        const anim = npc.getAnimationFrames();
        const baseFrame = (anim?.frames?.[newFrameId] ?? NULL_DRAW_RANGE) as DrawRange;
        const alphaFrame = (anim?.framesAlpha?.[newFrameId] ?? NULL_DRAW_RANGE) as DrawRange;
        state.npcTickPatchCountsByVariant[0] = emitTickPatch(
            state.npcTickPatchesByVariant[0]!,
            state.npcTickPatchCountsByVariant[0] | 0,
            ni | 0,
            baseFrame,
        );
        state.npcTickPatchCountsByVariant[1] = emitTickPatch(
            state.npcTickPatchesByVariant[1]!,
            state.npcTickPatchCountsByVariant[1] | 0,
            ni | 0,
            alphaFrame,
        );
    }

    if (input.wasmCountsByMapId instanceof Int32Array) {
        const wasmMetaOff = (input.mapEntryIndex | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE;
        if (wasmMetaOff + TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE <= input.wasmCountsByMapId.length) {
            const wasmMapId = input.wasmCountsByMapId[wasmMetaOff + 0] | 0;
            if (wasmMapId === (input.mapId | 0)) {
                for (let v = 0; v < 8; v++) {
                    streamCounts[v] = input.wasmCountsByMapId[wasmMetaOff + 1 + v] | 0;
                }
            } else {
                for (let v = 0; v < 8; v++) {
                    streamCounts[v] = state.locTickPatchCountsByVariant[v] | 0;
                }
            }
        } else {
            for (let v = 0; v < 8; v++) {
                streamCounts[v] = state.locTickPatchCountsByVariant[v] | 0;
            }
        }
    } else {
        for (let v = 0; v < 8; v++) {
            streamCounts[v] = state.locTickPatchCountsByVariant[v] | 0;
        }
    }
    streamCounts[8] = state.npcTickPatchCountsByVariant[0] | 0;
    streamCounts[9] = state.npcTickPatchCountsByVariant[1] | 0;

    for (let v = 0; v < 8; v++) {
        streamsForMap[v] =
            input.useWasmLocStreams && input.hasWasmCountsForMap
                ? input.wasmLocStreamsForMap[v]
                : state.locTickPatchesByVariant[v];
    }
    streamsForMap[8] = state.npcTickPatchesByVariant[0];
    streamsForMap[9] = state.npcTickPatchesByVariant[1];

    return {
        streamCounts,
        streamsForMap,
    };
}
