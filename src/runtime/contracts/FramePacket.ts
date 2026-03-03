import { NPC_DATA_TEXTURE_RING_SIZE, type NpcGpuFrameData } from "./NpcGpuFrame";

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

// Per-map tick patch counts cover:
// 8 loc variants (base/alpha/lod/lodAlpha/interact/interactAlpha/interactLod/interactLodAlpha)
// 2 npc variants (base/alpha)
export const TICK_PATCH_STREAM_COUNT = 10;
export const LOC_TICK_PATCH_STREAM_BASE = 0;
export const LOC_TICK_PATCH_STREAM_COUNT = 8;
export const NPC_TICK_PATCH_STREAM_BASE = LOC_TICK_PATCH_STREAM_BASE + LOC_TICK_PATCH_STREAM_COUNT;
export const NPC_TICK_PATCH_STREAM_COUNT = 2;

// Meta tuples: [mapId, <10 counts in the stream order above>]
export const TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE = 1 + TICK_PATCH_STREAM_COUNT;

// Patch tuples are packed as: [drawRangeIndex, offset, elements, instances]
export const TICK_PATCH_ENTRY_STRIDE = 4;

export function getLocTickPatchStreamIndex(
    isAlpha: boolean,
    isInteract: boolean,
    isLod: boolean,
): number {
    const interactBit = isInteract ? 4 : 0;
    const lodBit = isLod ? 2 : 0;
    const alphaBit = isAlpha ? 1 : 0;
    return (LOC_TICK_PATCH_STREAM_BASE + interactBit + lodBit + alphaBit) | 0;
}

export function getNpcTickPatchStreamIndex(isAlpha: boolean): number {
    return (NPC_TICK_PATCH_STREAM_BASE + (isAlpha ? 1 : 0)) | 0;
}

export type ParsedFrameTickPatches = Readonly<{
    patchesPacked: Int32Array;
    mapIdToIndex: Map<number, number>;
    streamOffsets: Int32Array;
    streamCounts: Int32Array;
}>;

export type ParsedFrameNpcRange = Readonly<{
    start: number;
    count: number;
}>;

export type ParsedFrameNpcRangesByMapId = ReadonlyMap<number, ParsedFrameNpcRange>;

export type ParsedFramePacket = Readonly<{
    frameCount: number;
    tickMapIdsVersion: number;
    tickViewStateVersion: number;
    npcRingWriteIndex: number;
    npcGpuFrameData: NpcGpuFrameData;
    readyMapIds: ReadonlySet<number>;
    npcRangesByMapId: ParsedFrameNpcRangesByMapId;
    tickPatches: ParsedFrameTickPatches | undefined;
    renderListPacked: Int32Array;
}>;

export type FramePacket = Readonly<{
    frameCount: number;
    tickMapIdsVersion: number;
    tickViewStateVersion: number;
    npcRingWriteIndex: number;

    // Packed NPC info texture for the npc shader (x,y,rotationAndPlane,typeId).
    npcGpuFrameData: NpcGpuFrameData;
    // Explicit ready map set for this frame; renderer should only draw maps listed here.
    readyMapIdsPacked: Int32Array;

    // Tuples of [mapId, start, count] for the current frame's NPC upload.
    // `start` is the npc index into `npcGpuFrameData.data`, `count` is npc entries for mapId.
    npcRangesByMapIdPacked: Int32Array;
    // Tuples of [mapId, flags] for frame render ordering.
    renderListPacked: Int32Array;

    // Draw-range tick patches for animated locs + NPCs.
    // Patches are concatenated by map, and within each map by stream index [0..9].
    tickPatchCountsByMapId: Int32Array;
    tickPatchPacked: Int32Array;
}>;

export function framePacketTransferables(packet: FramePacket): Transferable[] {
    const out: Transferable[] = [];
    out.push(packet.npcGpuFrameData.data.buffer as Transferable);
    out.push(packet.readyMapIdsPacked.buffer as Transferable);
    out.push(packet.npcRangesByMapIdPacked.buffer as Transferable);
    out.push(packet.renderListPacked.buffer as Transferable);
    out.push(packet.tickPatchCountsByMapId.buffer as Transferable);
    out.push(packet.tickPatchPacked.buffer as Transferable);
    return out;
}

export type TickPatchStreamSource = (
    mapEntryIndex: number,
    streamIndex: number,
    patchCount: number,
) => Int32Array | undefined;

export type TickPatchStreamsByMap = (Int32Array | undefined)[][];
export type BuildFramePacketInput = Readonly<{
    frameCount: number;
    tickMapIdsVersion: number;
    tickViewStateVersion: number;
    npcRingWriteIndex: number;
    npcGpuFrameData: NpcGpuFrameData;
    readyMapIdsPacked: Int32Array;
    npcRangesByMapIdPacked: Int32Array;
    renderListPacked: Int32Array;
    tickPatchCountsByMapId: Int32Array;
    tickPatchStreamsByMap: TickPatchStreamsByMap;
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
    if ((totalInts % TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE) !== 0) {
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

function validateFramePacketStrict(packet: FramePacket): void {
    const frameCount = packet.frameCount | 0;
    if (frameCount < 0) {
        throw new Error(`[map-render][frame-packet] frameCount invalid: ${frameCount}`);
    }
    const tickMapIdsVersion = packet.tickMapIdsVersion | 0;
    if (tickMapIdsVersion < 0) {
        throw new Error(
            `[map-render][frame-packet] tickMapIdsVersion invalid: ${tickMapIdsVersion}`,
        );
    }
    const tickViewStateVersion = packet.tickViewStateVersion | 0;
    if (tickViewStateVersion < 0) {
        throw new Error(
            `[map-render][frame-packet] tickViewStateVersion invalid: ${tickViewStateVersion}`,
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
    if (
        !(gpu.data instanceof Uint16Array) ||
        (gpu.width | 0) <= 0 ||
        (gpu.height | 0) <= 0
    ) {
        throw new Error(
            `[map-render][frame-packet] npcGpuFrameData invalid: ` +
                `width=${gpu.width} height=${gpu.height} data=${gpu.data?.constructor?.name ?? "null"}`,
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
    if ((renderInts % FRAME_RENDER_LIST_STRIDE) !== 0) {
        throw new Error(
            `[map-render][frame-packet] renderListPacked length misaligned: ` +
                `len=${renderInts} stride=${FRAME_RENDER_LIST_STRIDE}`,
        );
    }
    const readyInts = packet.readyMapIdsPacked.length | 0;

    const rangeInts = packet.npcRangesByMapIdPacked.length | 0;
    if ((rangeInts % NPC_RANGES_BY_MAP_ID_STRIDE) !== 0) {
        throw new Error(
            `[map-render][frame-packet] npcRangesByMapIdPacked length misaligned: ` +
                `len=${rangeInts} stride=${NPC_RANGES_BY_MAP_ID_STRIDE}`,
        );
    }

    const tickMetaInts = packet.tickPatchCountsByMapId.length | 0;
    if ((tickMetaInts % TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE) !== 0) {
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

    const readyMapIds = packet.readyMapIdsPacked;
    const readySet = new Set<number>();
    let prevReadyMapId = -1;
    for (let i = 0; i < readyInts; i++) {
        const readyMapId = readyMapIds[i] | 0;
        if ((i | 0) > 0 && (readyMapId | 0) <= (prevReadyMapId | 0)) {
            throw new Error(
                `[map-render][frame-packet] readyMapIdsPacked must be unique sorted asc: ` +
                    `entry=${i | 0} prev=${prevReadyMapId | 0} cur=${readyMapId | 0}`,
            );
        }
        prevReadyMapId = readyMapId | 0;
        readySet.add(readyMapId | 0);
    }

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
                    `entry=${i | 0} render=${renderMapId} npcRanges=${rangesMapId} tick=${tickMapId}`,
            );
        }
        if (!readySet.has(renderMapId | 0)) {
            throw new Error(
                `[map-render][frame-packet] render map missing from readyMapIdsPacked: ` +
                    `entry=${i | 0} mapId=${renderMapId | 0}`,
            );
        }
        if ((npcStart | 0) < 0 || (npcCount | 0) < 0 || ((npcStart + npcCount) | 0) > maxNpcEntries) {
            throw new Error(
                `[map-render][frame-packet] npc range invalid: ` +
                    `entry=${i | 0} mapId=${renderMapId} start=${npcStart} count=${npcCount} max=${maxNpcEntries}`,
            );
        }
        const hasNpcsFlag = (renderFlags & FRAME_RENDER_LIST_FLAG_HAS_NPCS) !== 0;
        if (hasNpcsFlag !== ((npcCount | 0) > 0)) {
            throw new Error(
                `[map-render][frame-packet] npc flags/range mismatch: ` +
                    `entry=${i | 0} mapId=${renderMapId} flags=${renderFlags} count=${npcCount}`,
            );
        }
    }
}

export function buildFramePacket(input: BuildFramePacketInput): FramePacket {
    const packet: FramePacket = {
        frameCount: input.frameCount | 0,
        tickMapIdsVersion: input.tickMapIdsVersion | 0,
        tickViewStateVersion: input.tickViewStateVersion | 0,
        npcRingWriteIndex: input.npcRingWriteIndex | 0,
        npcGpuFrameData: input.npcGpuFrameData,
        readyMapIdsPacked: input.readyMapIdsPacked,
        npcRangesByMapIdPacked: input.npcRangesByMapIdPacked,
        renderListPacked: input.renderListPacked,
        tickPatchCountsByMapId: input.tickPatchCountsByMapId,
        tickPatchPacked: buildTickPatchPackedFromCountsAndStreams(
            input.tickPatchCountsByMapId,
            input.tickPatchStreamsByMap,
        ),
    };
    validateFramePacketStrict(packet);
    return packet;
}

export function parseFramePacketRenderList(
    packed: Int32Array,
): Int32Array {
    const totalInts = packed.length | 0;
    if ((totalInts % FRAME_RENDER_LIST_STRIDE) !== 0) {
        throw new Error(
            `[map-render][frame-packet] renderListPacked length misaligned: ` +
                `len=${totalInts} stride=${FRAME_RENDER_LIST_STRIDE}`,
        );
    }
    return packed;
}

export function parseFramePacketTickPatches(
    countsByMapId: Int32Array,
    patchesPacked: Int32Array,
): ParsedFrameTickPatches | undefined {
    const totalInts = countsByMapId.length | 0;
    if ((totalInts % TICK_PATCH_COUNTS_BY_MAP_ID_STRIDE) !== 0) {
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

export function parseFramePacketTickPatchesFromPacket(
    packet: FramePacket | undefined,
): ParsedFrameTickPatches | undefined {
    if (!packet) {
        return undefined;
    }
    return parseFramePacketTickPatches(packet.tickPatchCountsByMapId, packet.tickPatchPacked);
}

export function parseFramePacketNpcRangesByMapId(
    pairs: Int32Array,
): ParsedFrameNpcRangesByMapId {
    const totalInts = pairs.length | 0;
    if ((totalInts % NPC_RANGES_BY_MAP_ID_STRIDE) !== 0) {
        throw new Error(
            `[map-render][frame-packet] npcRangesByMapIdPacked length misaligned: ` +
                `len=${totalInts} stride=${NPC_RANGES_BY_MAP_ID_STRIDE}`,
        );
    }

    const out = new Map<number, ParsedFrameNpcRange>();
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

export function parseFramePacket(packet: FramePacket | undefined): ParsedFramePacket | undefined {
    if (!packet) {
        return undefined;
    }
    validateFramePacketStrict(packet);
    const npcRingWriteIndex = packet.npcRingWriteIndex | 0;

    return {
        frameCount: packet.frameCount | 0,
        tickMapIdsVersion: packet.tickMapIdsVersion | 0,
        tickViewStateVersion: packet.tickViewStateVersion | 0,
        npcRingWriteIndex,
        npcGpuFrameData: packet.npcGpuFrameData,
        readyMapIds: new Set<number>(packet.readyMapIdsPacked),
        npcRangesByMapId: parseFramePacketNpcRangesByMapId(packet.npcRangesByMapIdPacked),
        tickPatches: parseFramePacketTickPatchesFromPacket(packet),
        renderListPacked: parseFramePacketRenderList(packet.renderListPacked),
    };
}
