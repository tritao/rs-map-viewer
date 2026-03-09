import type {
    NpcEvent,
} from "../entities/NpcEvents";
import type { NpcUpdateDelta } from "../entities/NpcUpdateDelta";
import type { MapObjState } from "../../shared/StaticMapPacket";

export const NPC_STATE_DELTA_SPAWN_STRIDE = 8;
export const NPC_STATE_DELTA_UPDATE_STRIDE = 14;
export const NPC_STATE_DELTA_DESPAWN_STRIDE = 3;
export const LOC_ANIMATION_RESET_STRIDE = 2;

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
    npcState?: NpcWorldState;
    objDelta?: WorldObjDelta;
    locDelta?: WorldLocDelta;
}>;

export type WorldMapObjUpdate = Readonly<{
    kind: "replaceMapObjState";
    mapId: number;
    mapObjState?: MapObjState;
}>;

export type WorldObjDelta = Readonly<{
    updates: ReadonlyArray<WorldMapObjUpdate>;
}>;

export type WorldLocAnimationReset = Readonly<{
    mapId: number;
    locIndex: number;
}>;

export type WorldLocDelta = Readonly<{
    animationResetPacked: Int32Array;
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

const EMPTY_WORLD_DELTA_PACKET_COUNTS: WorldDeltaPacketCounts = {
    spawnCount: 0,
    updateCount: 0,
    despawnCount: 0,
    changeCount: 0,
};

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

function getNpcWorldStateCounts(npcState: NpcWorldState): WorldDeltaPacketCounts {
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

export type WorldDeltaPacket = Readonly<{
    frameCount: number;
    npcState?: NpcWorldState;
    objDelta?: WorldObjDelta;
    locDelta?: WorldLocDelta;
}>;

export function getWorldDeltaPacketCounts(
    packet: WorldDeltaPacket,
): WorldDeltaPacketCounts {
    const npcState = packet.npcState;
    if (!npcState) {
        return EMPTY_WORLD_DELTA_PACKET_COUNTS;
    }
    return getNpcWorldStateCounts(npcState);
}

export function validateWorldDeltaPacket(
    packet: WorldDeltaPacket,
): WorldDeltaPacketCounts {
    const locDelta = packet.locDelta;
    if (locDelta) {
        assertPackedStride(
            "animationResetPacked",
            locDelta.animationResetPacked,
            LOC_ANIMATION_RESET_STRIDE,
        );
    }
    const npcState = packet.npcState;
    if (!npcState) {
        return EMPTY_WORLD_DELTA_PACKET_COUNTS;
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
    if (input.locDelta) {
        assertPackedStride(
            "animationResetPacked",
            input.locDelta.animationResetPacked,
            LOC_ANIMATION_RESET_STRIDE,
        );
    }
    return {
        frameCount: input.frameCount | 0,
        npcState: input.npcState,
        objDelta: input.objDelta,
        locDelta: input.locDelta,
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
        frameCount?: number;
        updates: ReadonlyArray<WorldMapObjUpdate>;
    }>,
): WorldDeltaPacket {
    return buildWorldDeltaPacket({
        frameCount: input.frameCount ?? 0,
        objDelta: {
            updates: input.updates,
        },
    });
}

export function buildWorldDeltaPacketFromLocAnimationResets(
    input: Readonly<{
        frameCount: number;
        animationResets: ReadonlyArray<WorldLocAnimationReset>;
    }>,
): WorldDeltaPacket {
    const animationResetPacked = new Int32Array(
        (input.animationResets.length | 0) * LOC_ANIMATION_RESET_STRIDE,
    );
    let write = 0;
    for (let index = 0; index < input.animationResets.length; index++) {
        const reset = input.animationResets[index]!;
        animationResetPacked[write++] = reset.mapId | 0;
        animationResetPacked[write++] = reset.locIndex | 0;
    }
    return buildWorldDeltaPacket({
        frameCount: input.frameCount | 0,
        locDelta: {
            animationResetPacked,
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

export function worldDeltaPacketTransferables(packet: WorldDeltaPacket): Transferable[] {
    const transferables: Transferable[] = [];
    const npcState = packet.npcState;
    if (npcState) {
        transferables.push(
            npcState.spawnStatePacked.buffer as Transferable,
            npcState.updateStatePacked.buffer as Transferable,
            npcState.despawnStatePacked.buffer as Transferable,
        );
    }
    const objUpdates = packet.objDelta?.updates;
    if (objUpdates) {
        for (let index = 0; index < objUpdates.length; index++) {
            const mapObjState = objUpdates[index]?.mapObjState;
            if (!mapObjState) {
                continue;
            }
            transferables.push(
                mapObjState.vertices.buffer as Transferable,
                mapObjState.indices.buffer as Transferable,
                mapObjState.usedTextureIds.buffer as Transferable,
            );
            for (const key of Object.keys(mapObjState.modelInfoTextures) as Array<
                keyof typeof mapObjState.modelInfoTextures
            >) {
                transferables.push(
                    mapObjState.modelInfoTextures[key].buffer as Transferable,
                    mapObjState.drawRanges[key].buffer as Transferable,
                );
            }
        }
    }
    const locDelta = packet.locDelta;
    if (locDelta) {
        transferables.push(locDelta.animationResetPacked.buffer as Transferable);
    }
    return transferables;
}
