import { NPC_DATA_TEXTURE_RING_SIZE, type NpcGpuFrameData } from "./NpcGpuFrame";
import {
    type MapObjRenderPacket,
    mapObjRenderPacketTransferables,
} from "./MapObjRenderPacket";
import {
    LOC_TICK_PATCH_STREAM_BASE,
    LOC_TICK_PATCH_STREAM_COUNT,
    NPC_TICK_PATCH_STREAM_BASE,
    NPC_TICK_PATCH_STREAM_COUNT,
    TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE,
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
    getLocTickPatchStreamIndex,
    getNpcTickPatchStreamIndex,
} from "../runtime/TickPatchLayout";

// Meta tuples: [mapId, npcDataStart, npcDataCount]
export const NPC_RANGES_BY_MAP_ID_STRIDE = 3;
export const FRAME_RENDER_LIST_STRIDE = 2;
export const FRAME_RENDER_LIST_FLAG_HAS_NPCS = 1 << 0;
export const FRAME_RENDER_LIST_FLAG_IS_LOD = 1 << 1;
export const FRAME_RENDER_LIST_FLAG_IS_INTERACT = 1 << 2;
const FRAME_RENDER_LIST_FLAGS_MASK =
    FRAME_RENDER_LIST_FLAG_HAS_NPCS |
    FRAME_RENDER_LIST_FLAG_IS_LOD |
    FRAME_RENDER_LIST_FLAG_IS_INTERACT;

export {
    LOC_TICK_PATCH_STREAM_BASE,
    LOC_TICK_PATCH_STREAM_COUNT,
    NPC_TICK_PATCH_STREAM_BASE,
    NPC_TICK_PATCH_STREAM_COUNT,
    TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE,
    TICK_PATCH_ENTRY_STRIDE,
    TICK_PATCH_STREAM_COUNT,
    getLocTickPatchStreamIndex,
    getNpcTickPatchStreamIndex,
};

export type ParsedRenderFrameTickPatches = Readonly<{
    patchesPacked: Int32Array;
    mapIdToIndex: Map<number, number>;
    streamOffsets: Int32Array;
    streamCounts: Int32Array;
}>;

export type ParsedRenderFrameNpcRange = Readonly<{
    start: number;
    count: number;
}>;

export type ParsedRenderFrameNpcRangesByMapId = ReadonlyMap<number, ParsedRenderFrameNpcRange>;

export type ParsedRenderFramePacket = Readonly<{
    frameCount: number;
    inputMapIdsVersion: number;
    inputViewStateVersion: number;
    npcRingWriteIndex: number;
    npcGpuFrameData: NpcGpuFrameData;
    npcRangesByMapId: ParsedRenderFrameNpcRangesByMapId;
    tickPatches: ParsedRenderFrameTickPatches | undefined;
    renderListPacked: Int32Array;
    runtimeRenderUpdates: MapObjRenderPacket | undefined;
}>;

export type RenderFramePacket = Readonly<{
    frameCount: number;
    inputMapIdsVersion: number;
    inputViewStateVersion: number;
    npcRingWriteIndex: number;

    // Packed NPC info texture for the npc shader (x,y,rotationAndPlane,typeId).
    npcGpuFrameData: NpcGpuFrameData;

    // Tuples of [mapId, start, count] for the current frame's NPC upload.
    // `start` is the npc index into `npcGpuFrameData.data`, `count` is npc entries for mapId.
    npcRangesByMapIdPacked: Int32Array;
    // Tuples of [mapId, flags] for frame render ordering.
    renderListPacked: Int32Array;

    // Draw-range tick patches for animated locs + NPCs.
    // Patches are concatenated by map, and within each map by stream index [0..9].
    tickPatchCountsByMapId: Int32Array;
    tickPatchPacked: Int32Array;

    // Optional object runtime updates to apply on the renderer side.
    runtimeRenderUpdates?: MapObjRenderPacket;
}>;

export function renderFramePacketTransferables(packet: RenderFramePacket): Transferable[] {
    const out: Transferable[] = [];
    out.push(packet.npcGpuFrameData.data.buffer as Transferable);
    out.push(packet.npcRangesByMapIdPacked.buffer as Transferable);
    out.push(packet.renderListPacked.buffer as Transferable);
    out.push(packet.tickPatchCountsByMapId.buffer as Transferable);
    out.push(packet.tickPatchPacked.buffer as Transferable);
    if (packet.runtimeRenderUpdates) {
        out.push(...mapObjRenderPacketTransferables(packet.runtimeRenderUpdates));
    }
    return out;
}

export type TickPatchStreamSource = (
    mapEntryIndex: number,
    streamIndex: number,
    patchCount: number,
) => Int32Array | undefined;

export type TickPatchStreamsByMap = (Int32Array | undefined)[][];
export type BuildRenderFramePacketInput = Readonly<{
    frameCount: number;
    inputMapIdsVersion: number;
    inputViewStateVersion: number;
    npcRingWriteIndex: number;
    npcGpuFrameData: NpcGpuFrameData;
    npcRangesByMapIdPacked: Int32Array;
    renderListPacked: Int32Array;
    tickPatchCountsByMapId: Int32Array;
    tickPatchStreamsByMap: TickPatchStreamsByMap;
    runtimeRenderUpdates?: MapObjRenderPacket;
}>;

export function createTickPatchStreamsByMap(mapEntryCount: number): TickPatchStreamsByMap {
    const out: TickPatchStreamsByMap = new Array(mapEntryCount | 0);
    for (let i = 0; i < (mapEntryCount | 0); i++) {
        out[i] = new Array(TICK_PATCH_STREAM_COUNT);
    }
    return out;
}

export function buildTickPatchPackedFromCounts(
    countsByMapId: Int32Array,
    getStreamPatches: TickPatchStreamSource,
): Int32Array {
    const totalInts = countsByMapId.length | 0;
    if (totalInts % TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE !== 0) {
        throw new Error(
            `[map-render][frame-packet] tickPatchCountsByMapId length misaligned: ` +
                `len=${totalInts} stride=${TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE}`,
        );
    }

    const entryCount = Math.floor(totalInts / TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE);
    let totalPatches = 0;
    for (let e = 0; e < entryCount; e++) {
        const baseOff = (e | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE;
        for (let s = 0; s < TICK_PATCH_STREAM_COUNT; s++) {
            totalPatches = (totalPatches + (countsByMapId[baseOff + 1 + s] | 0)) | 0;
        }
    }

    const out = new Int32Array(Math.max(0, totalPatches | 0) * TICK_PATCH_ENTRY_STRIDE);
    let writeOff = 0;
    for (let e = 0; e < entryCount; e++) {
        const baseOff = (e | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE;
        for (let s = 0; s < TICK_PATCH_STREAM_COUNT; s++) {
            const count = countsByMapId[baseOff + 1 + s] | 0;
            const len = (count * TICK_PATCH_ENTRY_STRIDE) | 0;
            if (len <= 0) {
                continue;
            }
            const patches = getStreamPatches(e | 0, s | 0, count | 0);
            if (!(patches instanceof Int32Array) || (patches.length | 0) < (len | 0)) {
                throw new Error(
                    `[map-render][frame-packet] missing/short stream source: ` +
                        `entry=${e | 0} stream=${s | 0} count=${count | 0} ` +
                        `neededInts=${len | 0} got=${patches?.length ?? -1}`,
                );
            }
            out.set(patches.subarray(0, len), writeOff);
            writeOff = (writeOff + len) | 0;
        }
    }

    return out;
}

export function buildTickPatchPackedFromCountsAndStreams(
    countsByMapId: Int32Array,
    streamsByMap: TickPatchStreamsByMap,
): Int32Array {
    return buildTickPatchPackedFromCounts(
        countsByMapId,
        (mapEntryIndex, streamIndex, patchCount) => {
            const stream = streamsByMap[mapEntryIndex]?.[streamIndex];
            if (stream instanceof Int32Array) {
                return stream;
            }
            return patchCount > 0 ? undefined : new Int32Array(0);
        },
    );
}

function validateRenderFramePacketStrict(packet: RenderFramePacket): void {
    const frameCount = packet.frameCount | 0;
    if (frameCount < 0) {
        throw new Error(`[map-render][frame-packet] frameCount invalid: ${frameCount}`);
    }
    const inputMapIdsVersion = packet.inputMapIdsVersion | 0;
    if (inputMapIdsVersion < 0) {
        throw new Error(
            `[map-render][frame-packet] inputMapIdsVersion invalid: ${inputMapIdsVersion}`,
        );
    }
    const inputViewStateVersion = packet.inputViewStateVersion | 0;
    if (inputViewStateVersion < 0) {
        throw new Error(
            `[map-render][frame-packet] inputViewStateVersion invalid: ${inputViewStateVersion}`,
        );
    }

    const ring = packet.npcRingWriteIndex | 0;
    if (ring < 0 || ring >= NPC_DATA_TEXTURE_RING_SIZE) {
        throw new Error(
            `[map-render][frame-packet] npcRingWriteIndex out of range: ` +
                `value=${ring} size=${NPC_DATA_TEXTURE_RING_SIZE}`,
        );
    }

    const gpu = packet.npcGpuFrameData;
    if (!(gpu.data instanceof Uint16Array) || (gpu.width | 0) <= 0 || (gpu.height | 0) <= 0) {
        throw new Error(
            `[map-render][frame-packet] npcGpuFrameData invalid: ` +
                `width=${gpu.width} height=${gpu.height} data=${
                    gpu.data?.constructor?.name ?? "null"
                }`,
        );
    }
    const expectedGpuLen = ((gpu.width | 0) * (gpu.height | 0) * 4) | 0;
    if ((gpu.data.length | 0) !== (expectedGpuLen | 0)) {
        throw new Error(
            `[map-render][frame-packet] npcGpuFrameData.data length mismatch: ` +
                `expected=${expectedGpuLen} actual=${gpu.data.length | 0}`,
        );
    }

    const renderInts = packet.renderListPacked.length | 0;
    if (renderInts % FRAME_RENDER_LIST_STRIDE !== 0) {
        throw new Error(
            `[map-render][frame-packet] renderListPacked length misaligned: ` +
                `len=${renderInts} stride=${FRAME_RENDER_LIST_STRIDE}`,
        );
    }
    const rangeInts = packet.npcRangesByMapIdPacked.length | 0;
    if (rangeInts % NPC_RANGES_BY_MAP_ID_STRIDE !== 0) {
        throw new Error(
            `[map-render][frame-packet] npcRangesByMapIdPacked length misaligned: ` +
                `len=${rangeInts} stride=${NPC_RANGES_BY_MAP_ID_STRIDE}`,
        );
    }

    const tickMetaInts = packet.tickPatchCountsByMapId.length | 0;
    if (tickMetaInts % TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE !== 0) {
        throw new Error(
            `[map-render][frame-packet] tickPatchCountsByMapId length misaligned: ` +
                `len=${tickMetaInts} stride=${TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE}`,
        );
    }

    const renderCount = Math.floor(renderInts / FRAME_RENDER_LIST_STRIDE);
    const rangeCount = Math.floor(rangeInts / NPC_RANGES_BY_MAP_ID_STRIDE);
    const tickCount = Math.floor(tickMetaInts / TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE);
    if (renderCount !== rangeCount || renderCount !== tickCount) {
        throw new Error(
            `[map-render][frame-packet] entry count mismatch: ` +
                `render=${renderCount} npcRanges=${rangeCount} tick=${tickCount}`,
        );
    }

    const seenMapIds = new Set<number>();

    const maxNpcEntries = ((gpu.width | 0) * (gpu.height | 0)) | 0;

    for (let i = 0; i < renderCount; i++) {
        const renderOff = (i | 0) * FRAME_RENDER_LIST_STRIDE;
        const rangeOff = (i | 0) * NPC_RANGES_BY_MAP_ID_STRIDE;
        const tickOff = (i | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE;
        const renderMapId = packet.renderListPacked[renderOff + 0] | 0;
        const renderFlags = packet.renderListPacked[renderOff + 1] | 0;
        const rangesMapId = packet.npcRangesByMapIdPacked[rangeOff + 0] | 0;
        const npcStart = packet.npcRangesByMapIdPacked[rangeOff + 1] | 0;
        const npcCount = packet.npcRangesByMapIdPacked[rangeOff + 2] | 0;
        const tickMapId = packet.tickPatchCountsByMapId[tickOff + 0] | 0;
        if ((renderFlags & ~FRAME_RENDER_LIST_FLAGS_MASK) !== 0) {
            throw new Error(
                `[map-render][frame-packet] render flags invalid: ` +
                    `entry=${i | 0} mapId=${renderMapId} flags=${renderFlags}`,
            );
        }
        if ((renderMapId | 0) !== (rangesMapId | 0) || (renderMapId | 0) !== (tickMapId | 0)) {
            throw new Error(
                `[map-render][frame-packet] mapId order mismatch: ` +
                    `entry=${
                        i | 0
                    } render=${renderMapId} npcRanges=${rangesMapId} tick=${tickMapId}`,
            );
        }
        if (seenMapIds.has(renderMapId | 0)) {
            throw new Error(
                `[map-render][frame-packet] duplicate render map entry: ` +
                    `entry=${i | 0} mapId=${renderMapId | 0}`,
            );
        }
        seenMapIds.add(renderMapId | 0);
        if (
            (npcStart | 0) < 0 ||
            (npcCount | 0) < 0 ||
            ((npcStart + npcCount) | 0) > maxNpcEntries
        ) {
            throw new Error(
                `[map-render][frame-packet] npc range invalid: ` +
                    `entry=${
                        i | 0
                    } mapId=${renderMapId} start=${npcStart} count=${npcCount} max=${maxNpcEntries}`,
            );
        }
        const hasNpcsFlag = (renderFlags & FRAME_RENDER_LIST_FLAG_HAS_NPCS) !== 0;
        if (hasNpcsFlag !== (npcCount | 0) > 0) {
            throw new Error(
                `[map-render][frame-packet] npc flags/range mismatch: ` +
                    `entry=${i | 0} mapId=${renderMapId} flags=${renderFlags} count=${npcCount}`,
            );
        }
    }
}

export function buildRenderFramePacket(
    input: BuildRenderFramePacketInput,
): RenderFramePacket {
    const packet: RenderFramePacket = {
        frameCount: input.frameCount | 0,
        inputMapIdsVersion: input.inputMapIdsVersion | 0,
        inputViewStateVersion: input.inputViewStateVersion | 0,
        npcRingWriteIndex: input.npcRingWriteIndex | 0,
        npcGpuFrameData: input.npcGpuFrameData,
        npcRangesByMapIdPacked: input.npcRangesByMapIdPacked,
        renderListPacked: input.renderListPacked,
        tickPatchCountsByMapId: input.tickPatchCountsByMapId,
        tickPatchPacked: buildTickPatchPackedFromCountsAndStreams(
            input.tickPatchCountsByMapId,
            input.tickPatchStreamsByMap,
        ),
        runtimeRenderUpdates: input.runtimeRenderUpdates,
    };
    validateRenderFramePacketStrict(packet);
    return packet;
}

export function parseRenderFramePacketRenderList(packed: Int32Array): Int32Array {
    const totalInts = packed.length | 0;
    if (totalInts % FRAME_RENDER_LIST_STRIDE !== 0) {
        throw new Error(
            `[map-render][frame-packet] renderListPacked length misaligned: ` +
                `len=${totalInts} stride=${FRAME_RENDER_LIST_STRIDE}`,
        );
    }
    return packed;
}

export function parseRenderFrameTickPatches(
    countsByMapId: Int32Array,
    patchesPacked: Int32Array,
): ParsedRenderFrameTickPatches | undefined {
    const totalInts = countsByMapId.length | 0;
    if (totalInts % TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE !== 0) {
        throw new Error(
            `[map-render][frame-packet] tickPatchCountsByMapId length misaligned: ` +
                `len=${totalInts} stride=${TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE}`,
        );
    }
    const entryCount = Math.floor((countsByMapId.length | 0) / TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE);
    if (entryCount <= 0 || !(patchesPacked instanceof Int32Array)) {
        return undefined;
    }

    const streamOffsets = new Int32Array((entryCount | 0) * TICK_PATCH_STREAM_COUNT);
    const streamCounts = new Int32Array((entryCount | 0) * TICK_PATCH_STREAM_COUNT);
    const mapIdToIndex = new Map<number, number>();

    let readOff = 0;
    for (let e = 0; e < entryCount; e++) {
        const baseOff = (e | 0) * TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE;
        const mapId = countsByMapId[baseOff + 0] | 0;
        mapIdToIndex.set(mapId, e | 0);
        for (let s = 0; s < TICK_PATCH_STREAM_COUNT; s++) {
            const count = countsByMapId[baseOff + 1 + s] | 0;
            const idx = (e * TICK_PATCH_STREAM_COUNT + s) | 0;
            streamCounts[idx] = count;
            streamOffsets[idx] = readOff | 0;
            readOff = (readOff + ((count * TICK_PATCH_ENTRY_STRIDE) | 0)) | 0;
        }
    }

    const expected = readOff | 0;
    const actual = patchesPacked.length | 0;
    if (expected !== actual) {
        throw new Error(
            `[map-render][frame-packet] tickPatchPacked length mismatch: ` +
                `expected=${expected} actual=${actual}`,
        );
    }

    return {
        patchesPacked,
        mapIdToIndex,
        streamOffsets,
        streamCounts,
    };
}

export function parseRenderFrameTickPatchesFromPacket(
    packet: RenderFramePacket | undefined,
): ParsedRenderFrameTickPatches | undefined {
    if (!packet) {
        return undefined;
    }
    return parseRenderFrameTickPatches(packet.tickPatchCountsByMapId, packet.tickPatchPacked);
}

export function parseRenderFrameNpcRangesByMapId(
    pairs: Int32Array,
): ParsedRenderFrameNpcRangesByMapId {
    const totalInts = pairs.length | 0;
    if (totalInts % NPC_RANGES_BY_MAP_ID_STRIDE !== 0) {
        throw new Error(
            `[map-render][frame-packet] npcRangesByMapIdPacked length misaligned: ` +
                `len=${totalInts} stride=${NPC_RANGES_BY_MAP_ID_STRIDE}`,
        );
    }

    const out = new Map<number, ParsedRenderFrameNpcRange>();
    const pairCount = Math.floor((pairs.length | 0) / NPC_RANGES_BY_MAP_ID_STRIDE);
    for (let i = 0; i < pairCount; i++) {
        const off = (i * NPC_RANGES_BY_MAP_ID_STRIDE) | 0;
        const mapId = pairs[off + 0] | 0;
        const start = pairs[off + 1] | 0;
        const count = pairs[off + 2] | 0;
        out.set(mapId, { start, count });
    }
    return out;
}

export function parseRenderFramePacket(
    packet: RenderFramePacket | undefined,
): ParsedRenderFramePacket | undefined {
    if (!packet) {
        return undefined;
    }
    validateRenderFramePacketStrict(packet);
    const npcRingWriteIndex = packet.npcRingWriteIndex | 0;

    return {
        frameCount: packet.frameCount | 0,
        inputMapIdsVersion: packet.inputMapIdsVersion | 0,
        inputViewStateVersion: packet.inputViewStateVersion | 0,
        npcRingWriteIndex,
        npcGpuFrameData: packet.npcGpuFrameData,
        npcRangesByMapId: parseRenderFrameNpcRangesByMapId(packet.npcRangesByMapIdPacked),
        tickPatches: parseRenderFrameTickPatchesFromPacket(packet),
        renderListPacked: parseRenderFramePacketRenderList(packet.renderListPacked),
        runtimeRenderUpdates: packet.runtimeRenderUpdates,
    };
}
