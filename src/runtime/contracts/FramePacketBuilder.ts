import {
    buildFramePacket,
    FRAME_RENDER_LIST_FLAG_HAS_NPCS,
    FRAME_RENDER_LIST_FLAG_IS_INTERACT,
    FRAME_RENDER_LIST_FLAG_IS_LOD,
    TICK_PATCH_STREAM_COUNT,
    type FramePacket,
} from "./FramePacket";
import type { NpcGpuFrameData } from "./NpcGpuFrame";

export type FramePacketMapEntry = Readonly<{
    mapId: number;
    renderFlags: number;
    npcRangeStart: number;
    npcRangeCount: number;
    tickPatchCounts: ArrayLike<number>;
    tickPatchStreams: readonly (Int32Array | undefined)[];
}>;

export type BuildFramePacketMapEntryInput = Readonly<{
    mapId: number;
    cameraMapX: number;
    cameraMapY: number;
    lodDistance: number;
    hoveredMapIds: ReadonlySet<number>;
    npcRangeStart: number;
    npcRangeCount: number;
    tickPatchCounts: ArrayLike<number>;
    tickPatchStreams: readonly (Int32Array | undefined)[];
}>;

export type BuildFramePacketFromMapEntriesInput = Readonly<{
    frameCount: number;
    tickMapIdsVersion: number;
    tickViewStateVersion: number;
    npcRingWriteIndex: number;
    npcGpuFrameData: NpcGpuFrameData;
    entries: readonly FramePacketMapEntry[];
}>;

export function computeFrameRenderFlags(
    mapId: number,
    cameraMapX: number,
    cameraMapY: number,
    lodDistance: number,
    hoveredMapIds: ReadonlySet<number>,
    npcRangeCount: number,
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
    if ((npcRangeCount | 0) > 0) {
        flags |= FRAME_RENDER_LIST_FLAG_HAS_NPCS;
    }
    return flags | 0;
}

export function buildFramePacketMapEntry(
    input: BuildFramePacketMapEntryInput,
): FramePacketMapEntry {
    return {
        mapId: input.mapId | 0,
        renderFlags: computeFrameRenderFlags(
            input.mapId | 0,
            input.cameraMapX | 0,
            input.cameraMapY | 0,
            input.lodDistance | 0,
            input.hoveredMapIds,
            input.npcRangeCount | 0,
        ),
        npcRangeStart: input.npcRangeStart | 0,
        npcRangeCount: input.npcRangeCount | 0,
        tickPatchCounts: input.tickPatchCounts,
        tickPatchStreams: input.tickPatchStreams,
    };
}

export function buildFramePacketFromMapEntries(
    input: BuildFramePacketFromMapEntriesInput,
): FramePacket {
    const entryCount = input.entries.length | 0;
    const readyMapIdsPacked = buildReadyMapIdsPacked(input.entries);
    const npcRangesByMapIdPacked = new Int32Array((entryCount | 0) * 3);
    const renderListPacked = new Int32Array((entryCount | 0) * 2);
    const tickPatchCountsByMapId = new Int32Array(
        (entryCount | 0) * (1 + TICK_PATCH_STREAM_COUNT),
    );
    const tickPatchStreamsByMap = new Array<(Int32Array | undefined)[]>(entryCount | 0);

    for (let i = 0; i < entryCount; i++) {
        const entry = input.entries[i]!;
        const mapId = entry.mapId | 0;
        const pairOff = (i | 0) * 3;
        const renderOff = (i | 0) * 2;
        const metaOff = (i | 0) * (1 + TICK_PATCH_STREAM_COUNT);
        npcRangesByMapIdPacked[pairOff + 0] = mapId;
        npcRangesByMapIdPacked[pairOff + 1] = entry.npcRangeStart | 0;
        npcRangesByMapIdPacked[pairOff + 2] = entry.npcRangeCount | 0;
        renderListPacked[renderOff + 0] = mapId;
        renderListPacked[renderOff + 1] = entry.renderFlags | 0;
        tickPatchCountsByMapId[metaOff + 0] = mapId;
        for (let streamIndex = 0; streamIndex < TICK_PATCH_STREAM_COUNT; streamIndex++) {
            tickPatchCountsByMapId[metaOff + 1 + streamIndex] =
                entry.tickPatchCounts[streamIndex] | 0;
        }
        tickPatchStreamsByMap[i] = entry.tickPatchStreams as (Int32Array | undefined)[];
    }

    return buildFramePacket({
        frameCount: input.frameCount | 0,
        tickMapIdsVersion: input.tickMapIdsVersion | 0,
        tickViewStateVersion: input.tickViewStateVersion | 0,
        npcRingWriteIndex: input.npcRingWriteIndex | 0,
        npcGpuFrameData: input.npcGpuFrameData,
        readyMapIdsPacked,
        npcRangesByMapIdPacked,
        renderListPacked,
        tickPatchCountsByMapId,
        tickPatchStreamsByMap,
    });
}

function buildReadyMapIdsPacked(entries: readonly FramePacketMapEntry[]): Int32Array {
    const entryCount = entries.length | 0;
    if ((entryCount | 0) <= 0) {
        return new Int32Array(0);
    }

    const sorted = new Int32Array(entryCount | 0);
    for (let i = 0; i < entryCount; i++) {
        sorted[i] = entries[i]!.mapId | 0;
    }
    sorted.sort();

    let uniqueCount = 0;
    for (let i = 0; i < entryCount; i++) {
        const mapId = sorted[i] | 0;
        if ((i | 0) > 0 && (mapId | 0) === (sorted[i - 1] | 0)) {
            continue;
        }
        sorted[uniqueCount] = mapId;
        uniqueCount = (uniqueCount + 1) | 0;
    }

    return sorted.slice(0, uniqueCount | 0);
}
