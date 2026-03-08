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

type WorldDeltaPacketInput = Readonly<{
    frameCount: number;
    inputStateVersion: number;
    npcState?: NpcWorldState;
    objDelta?: WorldObjDelta;
}>;

export type WorldMapObjUpdate = Readonly<{
    kind: "replaceMapObjState";
    mapId: number;
    mapObjState?: unknown;
}>;

export type WorldObjDelta = Readonly<{
    updates: ReadonlyArray<WorldMapObjUpdate>;
}>;

export type NpcWorldState = Readonly<{
    changeCount: number;
    spawnStatePacked: Int32Array;
    updateStatePacked: Int32Array;
    despawnStatePacked: Int32Array;
}>;

export type WorldDeltaPacketCounts = Readonly<{
    spawnCount: number;
    updateCount: number;
    despawnCount: number;
    changeCount: number;
}>;

function assertPackedStride(name: string, packed: Int32Array, stride: number): void {
    const len = packed.length | 0;
    const expectedStride = stride | 0;
    if (expectedStride <= 0 || len % expectedStride !== 0) {
        throw new Error(
            `[map-render][world-delta] invalid ${name} length: ` +
                `len=${len} stride=${expectedStride}`,
        );
    }
}

export type WorldDeltaPacket = Readonly<{
    frameCount: number;
    inputStateVersion: number;
    npcState?: NpcWorldState;
    objDelta?: WorldObjDelta;
}>;

export function getWorldDeltaPacketCounts(
    packet: WorldDeltaPacket,
): WorldDeltaPacketCounts {
    const npcState = packet.npcState;
    if (!npcState) {
        return {
            spawnCount: 0,
            updateCount: 0,
            despawnCount: 0,
            changeCount: 0,
        };
    }
    const spawnCount = Math.floor(
        (npcState.spawnStatePacked.length | 0) / NPC_STATE_DELTA_SPAWN_STRIDE,
    );
    const updateCount = Math.floor(
        (npcState.updateStatePacked.length | 0) / NPC_STATE_DELTA_UPDATE_STRIDE,
    );
    const despawnCount = Math.floor(
        (npcState.despawnStatePacked.length | 0) / NPC_STATE_DELTA_DESPAWN_STRIDE,
    );
    return {
        spawnCount: spawnCount | 0,
        updateCount: updateCount | 0,
        despawnCount: despawnCount | 0,
        changeCount: (spawnCount + updateCount + despawnCount) | 0,
    };
}

export function validateWorldDeltaPacket(
    packet: WorldDeltaPacket,
): WorldDeltaPacketCounts {
    const npcState = packet.npcState;
    if (!npcState) {
        return {
            spawnCount: 0,
            updateCount: 0,
            despawnCount: 0,
            changeCount: 0,
        };
    }
    assertPackedStride(
        "spawnStatePacked",
        npcState.spawnStatePacked,
        NPC_STATE_DELTA_SPAWN_STRIDE,
    );
    assertPackedStride(
        "updateStatePacked",
        npcState.updateStatePacked,
        NPC_STATE_DELTA_UPDATE_STRIDE,
    );
    assertPackedStride(
        "despawnStatePacked",
        npcState.despawnStatePacked,
        NPC_STATE_DELTA_DESPAWN_STRIDE,
    );
    const counts = getWorldDeltaPacketCounts(packet);
    if ((npcState.changeCount | 0) !== (counts.changeCount | 0)) {
        throw new Error(
            `[map-render][world-delta] invalid npcState.changeCount: ` +
                `changeCount=${npcState.changeCount | 0} expected=${counts.changeCount | 0} ` +
                `spawns=${counts.spawnCount | 0} updates=${counts.updateCount | 0} ` +
                `despawns=${counts.despawnCount | 0}`,
        );
    }
    return counts;
}

export function buildWorldDeltaPacket(input: WorldDeltaPacketInput): WorldDeltaPacket {
    if (input.npcState) {
        assertPackedStride(
            "spawnStatePacked",
            input.npcState.spawnStatePacked,
            NPC_STATE_DELTA_SPAWN_STRIDE,
        );
        assertPackedStride(
            "updateStatePacked",
            input.npcState.updateStatePacked,
            NPC_STATE_DELTA_UPDATE_STRIDE,
        );
        assertPackedStride(
            "despawnStatePacked",
            input.npcState.despawnStatePacked,
            NPC_STATE_DELTA_DESPAWN_STRIDE,
        );
    }
    return {
        frameCount: input.frameCount | 0,
        inputStateVersion: input.inputStateVersion | 0,
        npcState: input.npcState,
        objDelta: input.objDelta,
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

export function buildWorldDeltaPacketFromNpcLifecycleEvents(
    input: Readonly<{
        frameCount: number;
        inputStateVersion: number;
        lifecycleEvents: ReadonlyArray<NpcEvent>;
    }>,
): WorldDeltaPacket {
    const events = input.lifecycleEvents;
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

    const spawnStatePacked = new Int32Array((spawnCount | 0) * NPC_STATE_DELTA_SPAWN_STRIDE);
    const updateStatePacked = new Int32Array((updateCount | 0) * NPC_STATE_DELTA_UPDATE_STRIDE);
    const despawnStatePacked = new Int32Array((despawnCount | 0) * NPC_STATE_DELTA_DESPAWN_STRIDE);

    let spawnOff = 0;
    let updateOff = 0;
    let despawnOff = 0;
    for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        if (event.kind === "spawn") {
            spawnStatePacked[spawnOff++] = event.mapId | 0;
            spawnStatePacked[spawnOff++] = event.npcInstanceId | 0;
            spawnStatePacked[spawnOff++] = event.npcTypeId | 0;
            spawnStatePacked[spawnOff++] = event.tileX | 0;
            spawnStatePacked[spawnOff++] = event.tileY | 0;
            spawnStatePacked[spawnOff++] = event.level | 0;
            spawnStatePacked[spawnOff++] = event.orderKey === undefined ? 0 : 1;
            spawnStatePacked[spawnOff++] = (event.orderKey ?? 0) | 0;
            continue;
        }
        if (event.kind === "update") {
            const flags = updateFlagsFromDelta(event.delta);
            updateStatePacked[updateOff++] = event.mapId | 0;
            updateStatePacked[updateOff++] = event.npcInstanceId | 0;
            updateStatePacked[updateOff++] = event.seq | 0;
            updateStatePacked[updateOff++] = flags | 0;
            updateStatePacked[updateOff++] = event.delta.snapTileX ?? 0;
            updateStatePacked[updateOff++] = event.delta.snapTileY ?? 0;
            updateStatePacked[updateOff++] = event.delta.snapWorldX ?? 0;
            updateStatePacked[updateOff++] = event.delta.snapWorldY ?? 0;
            updateStatePacked[updateOff++] = event.delta.orientation ?? 0;
            updateStatePacked[updateOff++] = event.delta.rotation ?? 0;
            updateStatePacked[updateOff++] = event.delta.movementSeqId ?? 0;
            updateStatePacked[updateOff++] = event.delta.movementFrame ?? 0;
            updateStatePacked[updateOff++] = event.delta.movementFrameTick ?? 0;
            updateStatePacked[updateOff++] = event.delta.movementLoop ?? 0;
            continue;
        }
        despawnStatePacked[despawnOff++] = event.mapId | 0;
        despawnStatePacked[despawnOff++] = event.npcInstanceId | 0;
        despawnStatePacked[despawnOff++] = event.seq | 0;
    }

    return buildWorldDeltaPacket({
        frameCount: input.frameCount | 0,
        inputStateVersion: input.inputStateVersion | 0,
        npcState: {
            changeCount: (spawnCount + updateCount + despawnCount) | 0,
            spawnStatePacked,
            updateStatePacked,
            despawnStatePacked,
        },
    });
}

export function buildWorldDeltaPacketFromObjUpdates(
    input: Readonly<{
        updates: ReadonlyArray<WorldMapObjUpdate>;
    }>,
): WorldDeltaPacket {
    return buildWorldDeltaPacket({
        frameCount: 0,
        inputStateVersion: 0,
        objDelta: {
            updates: input.updates,
        },
    });
}

export function decodeNpcWorldStateUpdate(
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

export function decodeWorldDeltaNpcLifecycleEvents(
    packet: WorldDeltaPacket,
): ReadonlyMap<number, NpcEvent[]> {
    const counts = validateWorldDeltaPacket(packet);
    const out = new Map<number, NpcEvent[]>();
    const npcState = packet.npcState;
    if (!npcState) {
        return out;
    }

    const spawnPacked = npcState.spawnStatePacked;
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

    const updatePacked = npcState.updateStatePacked;
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
            delta: decodeNpcWorldStateUpdate(flags, updatePacked, off),
        };
        events.push(event);
    }

    const despawnPacked = npcState.despawnStatePacked;
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

export function worldDeltaPacketTransferables(packet: WorldDeltaPacket): Transferable[] {
    const npcState = packet.npcState;
    if (!npcState) {
        return [];
    }
    return [
        npcState.spawnStatePacked.buffer as Transferable,
        npcState.updateStatePacked.buffer as Transferable,
        npcState.despawnStatePacked.buffer as Transferable,
    ];
}
