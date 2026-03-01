import {
    buildFramePacket,
    createTickPatchStreamsByMap,
    FRAME_RENDER_LIST_FLAG_HAS_NPCS,
    FRAME_RENDER_LIST_FLAG_IS_INTERACT,
    FRAME_RENDER_LIST_FLAG_IS_LOD,
    TICK_PATCH_STREAM_COUNT,
    type FramePacket,
} from "../contracts/FramePacket";
import type { NpcGpuFrameData } from "../entities/NpcGpuData";

export type FramePacketMapEntry = Readonly<{
    mapId: number;
    renderFlags: number;
    npcOffset: number;
    tickPatchCounts: Int32Array;
    tickPatchStreams: readonly (Int32Array | undefined)[];
}>;

export type FramePacketMapEntryStreamSource = Int32Array | ReadonlyArray<number> | undefined;

export type CreateFramePacketMapEntryInput = Readonly<{
    mapId: number;
    renderFlags: number;
    npcOffset: number;
    tickPatchCounts: Int32Array | ReadonlyArray<number>;
    tickPatchStreams: readonly FramePacketMapEntryStreamSource[];
}>;

export type BuildFramePacketFromMapEntriesInput = Readonly<{
    frameCount: number;
    npcRingWriteIndex: number;
    npcGpuFrameData: NpcGpuFrameData;
    entries: readonly FramePacketMapEntry[];
}>;

export function createFramePacketMapEntry(
    input: CreateFramePacketMapEntryInput,
): FramePacketMapEntry {
    const streamCount = TICK_PATCH_STREAM_COUNT | 0;
    const counts = new Int32Array(streamCount);
    for (let i = 0; i < streamCount; i++) {
        counts[i] = input.tickPatchCounts[i] | 0;
    }

    const streams = new Array<Int32Array | undefined>(streamCount);
    for (let i = 0; i < streamCount; i++) {
        const count = counts[i] | 0;
        if (count <= 0) {
            streams[i] = undefined;
            continue;
        }
        const stream = input.tickPatchStreams[i];
        if (stream instanceof Int32Array) {
            streams[i] = stream;
            continue;
        }
        if (stream && stream.length > 0) {
            streams[i] = Int32Array.from(stream);
            continue;
        }
        streams[i] = undefined;
    }

    return {
        mapId: input.mapId | 0,
        renderFlags: input.renderFlags | 0,
        npcOffset: input.npcOffset | 0,
        tickPatchCounts: counts,
        tickPatchStreams: streams,
    };
}

export function computeFrameRenderFlags(
    mapId: number,
    cameraMapX: number,
    cameraMapY: number,
    lodDistance: number,
    hoveredMapIds: ReadonlySet<number>,
    hasNpcs: boolean,
): number {
    const mapX = (mapId | 0) >> 8;
    const mapY = (mapId | 0) & 0xff;
    const mapDistance = Math.max(
        Math.abs((cameraMapX | 0) - (mapX | 0)),
        Math.abs((cameraMapY | 0) - (mapY | 0)),
    );
    let flags = 0;
    if (mapDistance >= (lodDistance | 0)) {
        flags |= FRAME_RENDER_LIST_FLAG_IS_LOD;
    }
    if (hoveredMapIds.has(mapId | 0)) {
        flags |= FRAME_RENDER_LIST_FLAG_IS_INTERACT;
    }
    if (hasNpcs) {
        flags |= FRAME_RENDER_LIST_FLAG_HAS_NPCS;
    }
    return flags | 0;
}

export function buildFramePacketFromMapEntries(
    input: BuildFramePacketFromMapEntriesInput,
): FramePacket {
    const entryCount = input.entries.length | 0;
    const npcOffsetsByMapIdPairs = new Int32Array((entryCount | 0) * 2);
    const renderListPacked = new Int32Array((entryCount | 0) * 2);
    const tickPatchCountsByMapId = new Int32Array((entryCount | 0) * (1 + TICK_PATCH_STREAM_COUNT));
    const tickPatchStreamsByMap = createTickPatchStreamsByMap(entryCount | 0);

    for (let i = 0; i < entryCount; i++) {
        const entry = input.entries[i]!;
        const mapId = entry.mapId | 0;
        const pairOff = (i | 0) * 2;
        const renderOff = (i | 0) * 2;
        const metaOff = (i | 0) * (1 + TICK_PATCH_STREAM_COUNT);
        npcOffsetsByMapIdPairs[pairOff + 0] = mapId;
        npcOffsetsByMapIdPairs[pairOff + 1] = entry.npcOffset | 0;
        renderListPacked[renderOff + 0] = mapId;
        renderListPacked[renderOff + 1] = entry.renderFlags | 0;
        tickPatchCountsByMapId[metaOff + 0] = mapId;
        for (let streamIndex = 0; streamIndex < TICK_PATCH_STREAM_COUNT; streamIndex++) {
            tickPatchCountsByMapId[metaOff + 1 + streamIndex] =
                entry.tickPatchCounts[streamIndex] | 0;
            tickPatchStreamsByMap[i]![streamIndex] = entry.tickPatchStreams[streamIndex];
        }
    }

    return buildFramePacket({
        frameCount: input.frameCount | 0,
        npcRingWriteIndex: input.npcRingWriteIndex | 0,
        npcGpuFrameData: input.npcGpuFrameData,
        npcOffsetsByMapIdPairs,
        renderListPacked,
        tickPatchCountsByMapId,
        tickPatchStreamsByMap,
    });
}
