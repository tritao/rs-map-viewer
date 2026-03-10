import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { DrawRange } from "../../maprender/MapRenderData";
import {
    LOC_TICK_PATCH_STREAM_COUNT,
    NPC_TICK_PATCH_STREAM_COUNT,
    TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE,
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
    getLocTickPatchStreamIndex,
    getNpcTickPatchStreamIndex,
} from "../../renderer/RenderFramePacket";
import type { NpcSimMapState } from "./NpcSimStateStore";

const NULL_DRAW_RANGE: DrawRange = [0, 0, 0];

function emitLocTickPatch(
    state: NpcSimMapState,
    isAlpha: boolean,
    isInteract: boolean,
    isLod: boolean,
    drawRangeIndex: number,
    frame: DrawRange,
): void {
    const streamIndex = getLocTickPatchStreamIndex(isAlpha, isInteract, isLod);
    state.locTickPatchCountsByVariant[streamIndex] = emitTickPatch(
        state.locTickPatchesByVariant[streamIndex]!,
        state.locTickPatchCountsByVariant[streamIndex] | 0,
        drawRangeIndex | 0,
        frame,
    );
}

function emitNpcTickPatch(
    state: NpcSimMapState,
    isAlpha: boolean,
    drawRangeIndex: number,
    frame: DrawRange,
): void {
    const streamIndex = getNpcTickPatchStreamIndex(isAlpha) - LOC_TICK_PATCH_STREAM_COUNT;
    state.npcTickPatchCountsByVariant[streamIndex] = emitTickPatch(
        state.npcTickPatchesByVariant[streamIndex]!,
        state.npcTickPatchCountsByVariant[streamIndex] | 0,
        drawRangeIndex | 0,
        frame,
    );
}

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

    emitLocTickPatch(state, false, false, false, loc.drawRangeIndex, baseFrame);
    emitLocTickPatch(state, false, false, true, loc.drawRangeLodIndex, baseFrame);
    emitLocTickPatch(state, false, true, false, loc.drawRangeInteractIndex, baseFrame);
    emitLocTickPatch(state, false, true, true, loc.drawRangeInteractLodIndex, baseFrame);

    if (!alphaFrame) {
        return;
    }
    emitLocTickPatch(state, true, false, false, loc.drawRangeAlphaIndex, alphaFrame);
    emitLocTickPatch(state, true, false, true, loc.drawRangeLodAlphaIndex, alphaFrame);
    emitLocTickPatch(state, true, true, false, loc.drawRangeInteractAlphaIndex, alphaFrame);
    emitLocTickPatch(state, true, true, true, loc.drawRangeInteractLodAlphaIndex, alphaFrame);
}

function emitLocHiddenPatches(state: NpcSimMapState, locIndex: number) {
    const loc = state.locsAnimated[locIndex];
    emitLocTickPatch(state, false, false, false, loc.drawRangeIndex, NULL_DRAW_RANGE);
    emitLocTickPatch(state, true, false, false, loc.drawRangeAlphaIndex, NULL_DRAW_RANGE);
    emitLocTickPatch(state, false, false, true, loc.drawRangeLodIndex, NULL_DRAW_RANGE);
    emitLocTickPatch(state, true, false, true, loc.drawRangeLodAlphaIndex, NULL_DRAW_RANGE);
    emitLocTickPatch(state, false, true, false, loc.drawRangeInteractIndex, NULL_DRAW_RANGE);
    emitLocTickPatch(state, true, true, false, loc.drawRangeInteractAlphaIndex, NULL_DRAW_RANGE);
    emitLocTickPatch(state, false, true, true, loc.drawRangeInteractLodIndex, NULL_DRAW_RANGE);
    emitLocTickPatch(state, true, true, true, loc.drawRangeInteractLodAlphaIndex, NULL_DRAW_RANGE);
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
                `[map-render][tick][wasm] wasm patch stream OOB ` +
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
    for (let streamIndex = 0; streamIndex < NPC_TICK_PATCH_STREAM_COUNT; streamIndex++) {
        state.npcTickPatchCountsByVariant[streamIndex] = 0;
    }

    if (input.includeTsLocTickPatches) {
        for (let li = 0; li < state.locsAnimated.length; li++) {
            const loc = state.locsAnimated[li];
            if (!loc.visible) {
                emitLocHiddenPatches(state, li);
                continue;
            }
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
        emitNpcTickPatch(state, false, ni, baseFrame);
        emitNpcTickPatch(state, true, ni, alphaFrame);
    }

    if (input.wasmCountsByMapId instanceof Int32Array) {
        const wasmMetaOff = (input.mapEntryIndex | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE;
        if (wasmMetaOff + TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE <= input.wasmCountsByMapId.length) {
            const wasmMapId = input.wasmCountsByMapId[wasmMetaOff + 0] | 0;
            if (wasmMapId === (input.mapId | 0)) {
                for (let v = 0; v < LOC_TICK_PATCH_STREAM_COUNT; v++) {
                    streamCounts[v] = input.wasmCountsByMapId[wasmMetaOff + 1 + v] | 0;
                }
            } else {
                for (let v = 0; v < LOC_TICK_PATCH_STREAM_COUNT; v++) {
                    streamCounts[v] = state.locTickPatchCountsByVariant[v] | 0;
                }
            }
        } else {
            for (let v = 0; v < LOC_TICK_PATCH_STREAM_COUNT; v++) {
                streamCounts[v] = state.locTickPatchCountsByVariant[v] | 0;
            }
        }
    } else {
        for (let v = 0; v < LOC_TICK_PATCH_STREAM_COUNT; v++) {
            streamCounts[v] = state.locTickPatchCountsByVariant[v] | 0;
        }
    }
    for (let streamIndex = 0; streamIndex < NPC_TICK_PATCH_STREAM_COUNT; streamIndex++) {
        const globalStreamIndex = getNpcTickPatchStreamIndex(streamIndex === 1);
        streamCounts[globalStreamIndex] = state.npcTickPatchCountsByVariant[streamIndex] | 0;
    }

    for (let v = 0; v < LOC_TICK_PATCH_STREAM_COUNT; v++) {
        streamsForMap[v] =
            input.useWasmLocStreams && input.hasWasmCountsForMap
                ? input.wasmLocStreamsForMap[v]
                : state.locTickPatchesByVariant[v];
    }
    for (let streamIndex = 0; streamIndex < NPC_TICK_PATCH_STREAM_COUNT; streamIndex++) {
        const globalStreamIndex = getNpcTickPatchStreamIndex(streamIndex === 1);
        streamsForMap[globalStreamIndex] = state.npcTickPatchesByVariant[streamIndex];
    }

    return {
        streamCounts,
        streamsForMap,
    };
}
