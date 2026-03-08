import type {
    NpcDespawnEvent,
    NpcEvent,
    NpcSpawnEvent,
    NpcUpdateEvent,
} from "../entities/NpcEvents";
import type { NpcUpdateDelta } from "../entities/NpcUpdateDelta";

export const NPC_STATE_DELTA_SPAWN_STRIDE = 8;
export const NPC_STATE_DELTA_UPDATE_STRIDE = 14;
export const NPC_STATE_DELTA_DESPAWN_STRIDE = 3;

const UPDATE_FLAG_CLEAR_SERVER_PATH = 1 << 0;
const UPDATE_FLAG_HAS_SNAP_TILE = 1 << 1;
const UPDATE_FLAG_HAS_SNAP_WORLD = 1 << 2;
const UPDATE_FLAG_HAS_ORIENTATION = 1 << 3;
const UPDATE_FLAG_HAS_ROTATION = 1 << 4;
const UPDATE_FLAG_HAS_MOVEMENT_SEQ_ID = 1 << 5;
const UPDATE_FLAG_HAS_MOVEMENT_FRAME = 1 << 6;
const UPDATE_FLAG_HAS_MOVEMENT_FRAME_TICK = 1 << 7;
const UPDATE_FLAG_HAS_MOVEMENT_LOOP = 1 << 8;

type NpcStateDeltaPacketInput = Readonly<{
    frameCount: number;
    inputStateVersion: number;
    spawnsPacked: Int32Array;
    updatesPacked: Int32Array;
    despawnsPacked: Int32Array;
}>;

export type NpcStateDeltaPacketCounts = Readonly<{
    spawnCount: number;
    updateCount: number;
    despawnCount: number;
    eventCount: number;
}>;

function assertPackedStride(name: string, packed: Int32Array, stride: number): void {
    const len = packed.length | 0;
    const expectedStride = stride | 0;
    if (expectedStride <= 0 || len % expectedStride !== 0) {
        throw new Error(
            `[map-render][npc-state-delta] invalid ${name} length: ` +
                `len=${len} stride=${expectedStride}`,
        );
    }
}

export type NpcStateDeltaPacket = Readonly<{
    frameCount: number;
    inputStateVersion: number;
    eventCount: number;
    spawnsPacked: Int32Array;
    updatesPacked: Int32Array;
    despawnsPacked: Int32Array;
}>;

export function getNpcStateDeltaPacketCounts(
    packet: NpcStateDeltaPacket,
): NpcStateDeltaPacketCounts {
    const spawnCount = Math.floor((packet.spawnsPacked.length | 0) / NPC_STATE_DELTA_SPAWN_STRIDE);
    const updateCount = Math.floor(
        (packet.updatesPacked.length | 0) / NPC_STATE_DELTA_UPDATE_STRIDE,
    );
    const despawnCount = Math.floor(
        (packet.despawnsPacked.length | 0) / NPC_STATE_DELTA_DESPAWN_STRIDE,
    );
    return {
        spawnCount: spawnCount | 0,
        updateCount: updateCount | 0,
        despawnCount: despawnCount | 0,
        eventCount: (spawnCount + updateCount + despawnCount) | 0,
    };
}

export function validateNpcStateDeltaPacket(
    packet: NpcStateDeltaPacket,
): NpcStateDeltaPacketCounts {
    assertPackedStride("spawnsPacked", packet.spawnsPacked, NPC_STATE_DELTA_SPAWN_STRIDE);
    assertPackedStride("updatesPacked", packet.updatesPacked, NPC_STATE_DELTA_UPDATE_STRIDE);
    assertPackedStride("despawnsPacked", packet.despawnsPacked, NPC_STATE_DELTA_DESPAWN_STRIDE);
    const counts = getNpcStateDeltaPacketCounts(packet);
    if ((packet.eventCount | 0) !== (counts.eventCount | 0)) {
        throw new Error(
            `[map-render][npc-state-delta] invalid eventCount: ` +
                `eventCount=${packet.eventCount | 0} expected=${counts.eventCount | 0} ` +
                `spawns=${counts.spawnCount | 0} updates=${counts.updateCount | 0} ` +
                `despawns=${counts.despawnCount | 0}`,
        );
    }
    return counts;
}

export function buildNpcStateDeltaPacket(input: NpcStateDeltaPacketInput): NpcStateDeltaPacket {
    assertPackedStride("spawnsPacked", input.spawnsPacked, NPC_STATE_DELTA_SPAWN_STRIDE);
    assertPackedStride("updatesPacked", input.updatesPacked, NPC_STATE_DELTA_UPDATE_STRIDE);
    assertPackedStride("despawnsPacked", input.despawnsPacked, NPC_STATE_DELTA_DESPAWN_STRIDE);
    const spawnCount = Math.floor((input.spawnsPacked.length | 0) / NPC_STATE_DELTA_SPAWN_STRIDE);
    const updateCount = Math.floor(
        (input.updatesPacked.length | 0) / NPC_STATE_DELTA_UPDATE_STRIDE,
    );
    const despawnCount = Math.floor(
        (input.despawnsPacked.length | 0) / NPC_STATE_DELTA_DESPAWN_STRIDE,
    );
    return {
        frameCount: input.frameCount | 0,
        inputStateVersion: input.inputStateVersion | 0,
        eventCount: (spawnCount + updateCount + despawnCount) | 0,
        spawnsPacked: input.spawnsPacked,
        updatesPacked: input.updatesPacked,
        despawnsPacked: input.despawnsPacked,
    };
}

function updateFlagsFromDelta(delta: NpcUpdateDelta): number {
    let flags = 0;
    if (delta.clearServerPath) {
        flags |= UPDATE_FLAG_CLEAR_SERVER_PATH;
    }
    if (delta.snapTileX !== undefined && delta.snapTileY !== undefined) {
        flags |= UPDATE_FLAG_HAS_SNAP_TILE;
    }
    if (delta.snapWorldX !== undefined && delta.snapWorldY !== undefined) {
        flags |= UPDATE_FLAG_HAS_SNAP_WORLD;
    }
    if (delta.orientation !== undefined) {
        flags |= UPDATE_FLAG_HAS_ORIENTATION;
    }
    if (delta.rotation !== undefined) {
        flags |= UPDATE_FLAG_HAS_ROTATION;
    }
    if (delta.movementSeqId !== undefined) {
        flags |= UPDATE_FLAG_HAS_MOVEMENT_SEQ_ID;
    }
    if (delta.movementFrame !== undefined) {
        flags |= UPDATE_FLAG_HAS_MOVEMENT_FRAME;
    }
    if (delta.movementFrameTick !== undefined) {
        flags |= UPDATE_FLAG_HAS_MOVEMENT_FRAME_TICK;
    }
    if (delta.movementLoop !== undefined) {
        flags |= UPDATE_FLAG_HAS_MOVEMENT_LOOP;
    }
    return flags | 0;
}

export function buildNpcStateDeltaPacketFromEvents(
    input: Readonly<{
        frameCount: number;
        inputStateVersion: number;
        events: ReadonlyArray<NpcEvent>;
    }>,
): NpcStateDeltaPacket {
    const events = input.events;
    let spawnCount = 0;
    let updateCount = 0;
    let despawnCount = 0;
    for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        if (event.kind === "spawn") {
            spawnCount = (spawnCount + 1) | 0;
        } else if (event.kind === "update") {
            updateCount = (updateCount + 1) | 0;
        } else {
            despawnCount = (despawnCount + 1) | 0;
        }
    }

    const spawnsPacked = new Int32Array((spawnCount | 0) * NPC_STATE_DELTA_SPAWN_STRIDE);
    const updatesPacked = new Int32Array((updateCount | 0) * NPC_STATE_DELTA_UPDATE_STRIDE);
    const despawnsPacked = new Int32Array((despawnCount | 0) * NPC_STATE_DELTA_DESPAWN_STRIDE);

    let spawnOff = 0;
    let updateOff = 0;
    let despawnOff = 0;
    for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        if (event.kind === "spawn") {
            spawnsPacked[spawnOff++] = event.mapId | 0;
            spawnsPacked[spawnOff++] = event.npcInstanceId | 0;
            spawnsPacked[spawnOff++] = event.npcTypeId | 0;
            spawnsPacked[spawnOff++] = event.tileX | 0;
            spawnsPacked[spawnOff++] = event.tileY | 0;
            spawnsPacked[spawnOff++] = event.level | 0;
            spawnsPacked[spawnOff++] = event.orderKey === undefined ? 0 : 1;
            spawnsPacked[spawnOff++] = (event.orderKey ?? 0) | 0;
            continue;
        }
        if (event.kind === "update") {
            const flags = updateFlagsFromDelta(event.delta);
            updatesPacked[updateOff++] = event.mapId | 0;
            updatesPacked[updateOff++] = event.npcInstanceId | 0;
            updatesPacked[updateOff++] = event.seq | 0;
            updatesPacked[updateOff++] = flags | 0;
            updatesPacked[updateOff++] = event.delta.snapTileX ?? 0;
            updatesPacked[updateOff++] = event.delta.snapTileY ?? 0;
            updatesPacked[updateOff++] = event.delta.snapWorldX ?? 0;
            updatesPacked[updateOff++] = event.delta.snapWorldY ?? 0;
            updatesPacked[updateOff++] = event.delta.orientation ?? 0;
            updatesPacked[updateOff++] = event.delta.rotation ?? 0;
            updatesPacked[updateOff++] = event.delta.movementSeqId ?? 0;
            updatesPacked[updateOff++] = event.delta.movementFrame ?? 0;
            updatesPacked[updateOff++] = event.delta.movementFrameTick ?? 0;
            updatesPacked[updateOff++] = event.delta.movementLoop ?? 0;
            continue;
        }
        despawnsPacked[despawnOff++] = event.mapId | 0;
        despawnsPacked[despawnOff++] = event.npcInstanceId | 0;
        despawnsPacked[despawnOff++] = event.seq | 0;
    }

    return buildNpcStateDeltaPacket({
        frameCount: input.frameCount | 0,
        inputStateVersion: input.inputStateVersion | 0,
        spawnsPacked,
        updatesPacked,
        despawnsPacked,
    });
}

export function decodeNpcStateDeltaUpdate(
    flags: number,
    packed: Int32Array,
    off: number,
): NpcUpdateDelta {
    const delta: {
        clearServerPath?: boolean;
        snapTileX?: number;
        snapTileY?: number;
        snapWorldX?: number;
        snapWorldY?: number;
        orientation?: number;
        rotation?: number;
        movementSeqId?: number;
        movementFrame?: number;
        movementFrameTick?: number;
        movementLoop?: number;
    } = {};
    if ((flags & UPDATE_FLAG_CLEAR_SERVER_PATH) !== 0) {
        delta.clearServerPath = true;
    }
    if ((flags & UPDATE_FLAG_HAS_SNAP_TILE) !== 0) {
        delta.snapTileX = packed[off + 4] | 0;
        delta.snapTileY = packed[off + 5] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_SNAP_WORLD) !== 0) {
        delta.snapWorldX = packed[off + 6] | 0;
        delta.snapWorldY = packed[off + 7] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_ORIENTATION) !== 0) {
        delta.orientation = packed[off + 8] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_ROTATION) !== 0) {
        delta.rotation = packed[off + 9] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_MOVEMENT_SEQ_ID) !== 0) {
        delta.movementSeqId = packed[off + 10] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_MOVEMENT_FRAME) !== 0) {
        delta.movementFrame = packed[off + 11] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_MOVEMENT_FRAME_TICK) !== 0) {
        delta.movementFrameTick = packed[off + 12] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_MOVEMENT_LOOP) !== 0) {
        delta.movementLoop = packed[off + 13] | 0;
    }
    return delta;
}

function ensureMapEvents(out: Map<number, NpcEvent[]>, mapId: number): NpcEvent[] {
    const id = mapId | 0;
    const existing = out.get(id);
    if (existing) {
        return existing;
    }
    const next: NpcEvent[] = [];
    out.set(id, next);
    return next;
}

export function decodeNpcStateDeltaPacketEvents(
    packet: NpcStateDeltaPacket,
): ReadonlyMap<number, NpcEvent[]> {
    const counts = validateNpcStateDeltaPacket(packet);
    const out = new Map<number, NpcEvent[]>();

    const spawnPacked = packet.spawnsPacked;
    const spawnCount = counts.spawnCount | 0;
    for (let i = 0; i < spawnCount; i++) {
        const off = (i | 0) * NPC_STATE_DELTA_SPAWN_STRIDE;
        const mapId = spawnPacked[off + 0] | 0;
        const events = ensureMapEvents(out, mapId);
        const hasOrderKey = (spawnPacked[off + 6] | 0) !== 0;
        const event: NpcSpawnEvent = {
            kind: "spawn",
            mapId,
            npcInstanceId: spawnPacked[off + 1] | 0,
            npcTypeId: spawnPacked[off + 2] | 0,
            tileX: spawnPacked[off + 3] | 0,
            tileY: spawnPacked[off + 4] | 0,
            level: spawnPacked[off + 5] | 0,
            orderKey: hasOrderKey ? spawnPacked[off + 7] | 0 : undefined,
        };
        events.push(event);
    }

    const updatePacked = packet.updatesPacked;
    const updateCount = counts.updateCount | 0;
    for (let i = 0; i < updateCount; i++) {
        const off = (i | 0) * NPC_STATE_DELTA_UPDATE_STRIDE;
        const mapId = updatePacked[off + 0] | 0;
        const flags = updatePacked[off + 3] | 0;
        const events = ensureMapEvents(out, mapId);
        const event: NpcUpdateEvent = {
            kind: "update",
            mapId,
            npcInstanceId: updatePacked[off + 1] | 0,
            seq: updatePacked[off + 2] | 0,
            delta: decodeNpcStateDeltaUpdate(flags, updatePacked, off),
        };
        events.push(event);
    }

    const despawnPacked = packet.despawnsPacked;
    const despawnCount = counts.despawnCount | 0;
    for (let i = 0; i < despawnCount; i++) {
        const off = (i | 0) * NPC_STATE_DELTA_DESPAWN_STRIDE;
        const mapId = despawnPacked[off + 0] | 0;
        const events = ensureMapEvents(out, mapId);
        const event: NpcDespawnEvent = {
            kind: "despawn",
            mapId,
            npcInstanceId: despawnPacked[off + 1] | 0,
            seq: despawnPacked[off + 2] | 0,
        };
        events.push(event);
    }

    return out;
}

export function npcStateDeltaPacketTransferables(packet: NpcStateDeltaPacket): Transferable[] {
    return [
        packet.spawnsPacked.buffer as Transferable,
        packet.updatesPacked.buffer as Transferable,
        packet.despawnsPacked.buffer as Transferable,
    ];
}
