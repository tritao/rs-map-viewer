import { MovementType } from "../../runtime/entities/Npc";
import { ByteBuffer } from "../../rs/io/ByteBuffer";
import type { NpcEvent, NpcSpawnEvent, NpcUpdateEvent, NpcDespawnEvent } from "./NpcEvents";
import type { NpcUpdateDelta } from "./NpcSimMovement";

const LEGACY_PACKET_VERSION = 1;
const LIFECYCLE_PACKET_VERSION = 2;
const MAX_PATH_LENGTH = 25;

const LEGACY_FLAG_HAS_NPC_INDEX = 1 << 0;
const LEGACY_FLAG_HAS_NPC_ORDER_KEY = 1 << 1;
const LEGACY_FLAG_CLEAR_SERVER_PATH = 1 << 2;
const LEGACY_FLAG_HAS_SNAP_TILE = 1 << 3;
const LEGACY_FLAG_HAS_SNAP_WORLD = 1 << 4;
const LEGACY_FLAG_HAS_ORIENTATION = 1 << 5;
const LEGACY_FLAG_HAS_ROTATION = 1 << 6;
const LEGACY_FLAG_HAS_PATH = 1 << 7;

const DELTA_FLAG_CLEAR_SERVER_PATH = 1 << 0;
const DELTA_FLAG_HAS_SNAP_TILE = 1 << 1;
const DELTA_FLAG_HAS_SNAP_WORLD = 1 << 2;
const DELTA_FLAG_HAS_ORIENTATION = 1 << 3;
const DELTA_FLAG_HAS_ROTATION = 1 << 4;
const DELTA_FLAG_HAS_PATH = 1 << 5;

const SPAWN_FLAG_HAS_ORDER_KEY = 1 << 0;

export type DecodedLegacyNpcUpdatePacket = Readonly<{
    version: 1;
    updateEventsByMapId: ReadonlyMap<number, LegacyNpcUpdateEvent[]>;
    deltaCount: number;
}>;

export type DecodedNpcLifecyclePacket = Readonly<{
    version: 2;
    lifecycleEventsByMapId: ReadonlyMap<number, NpcEvent[]>;
    eventCount: number;
}>;

export type DecodedNpcUpdatePacket = DecodedLegacyNpcUpdatePacket | DecodedNpcLifecyclePacket;

type MutableNpcUpdateDelta = {
    -readonly [K in keyof NpcUpdateDelta]: NpcUpdateDelta[K];
};

export type LegacyNpcUpdateEvent = Readonly<{
    mapId: number;
    npcIndex?: number;
    npcOrderKey?: number;
    npcInstanceId?: number;
    delta: NpcUpdateDelta;
}>;

type ByteInput = ArrayBuffer | ArrayBufferView;

function toUint8Array(input: ByteInput): Uint8Array {
    if (input instanceof Uint8Array) {
        return input;
    }
    if (input instanceof ArrayBuffer) {
        return new Uint8Array(input);
    }
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function readMovementType(value: number): MovementType {
    if (value === MovementType.CRAWL || value === MovementType.WALK || value === MovementType.RUN) {
        return value;
    }
    throw new Error(`[map-viewer][npc-update-packet] invalid movement type: ${value | 0}`);
}

function readPathDelta(
    reader: ByteBuffer,
    mapId: number,
    index: number,
): NonNullable<NpcUpdateDelta["path"]> {
    const pathLength = reader.readUnsignedByte() | 0;
    if (pathLength < 0 || pathLength > MAX_PATH_LENGTH) {
        throw new Error(
            `[map-viewer][npc-update-packet] invalid path length: ` +
                `mapId=${mapId | 0} index=${index | 0} len=${pathLength | 0}`,
        );
    }
    const pathX = new Int32Array(pathLength);
    const pathY = new Int32Array(pathLength);
    const pathMovementType = new Int32Array(pathLength);
    for (let p = 0; p < pathLength; p++) {
        pathX[p] = reader.readSignedShort() | 0;
        pathY[p] = reader.readSignedShort() | 0;
        pathMovementType[p] = readMovementType(reader.readUnsignedByte()) | 0;
    }
    return {
        length: pathLength | 0,
        pathX,
        pathY,
        pathMovementType,
    };
}

function readLegacyDelta(
    reader: ByteBuffer,
    flags: number,
    mapId: number,
    index: number,
): NpcUpdateDelta {
    const delta: MutableNpcUpdateDelta = {};
    if ((flags & LEGACY_FLAG_CLEAR_SERVER_PATH) !== 0) {
        delta.clearServerPath = true;
    }
    if ((flags & LEGACY_FLAG_HAS_SNAP_TILE) !== 0) {
        delta.snapTileX = reader.readSignedShort() | 0;
        delta.snapTileY = reader.readSignedShort() | 0;
    }
    if ((flags & LEGACY_FLAG_HAS_SNAP_WORLD) !== 0) {
        delta.snapWorldX = reader.readInt() | 0;
        delta.snapWorldY = reader.readInt() | 0;
    }
    if ((flags & LEGACY_FLAG_HAS_ORIENTATION) !== 0) {
        delta.orientation = reader.readUnsignedShort() | 0;
    }
    if ((flags & LEGACY_FLAG_HAS_ROTATION) !== 0) {
        delta.rotation = reader.readUnsignedShort() | 0;
    }
    if ((flags & LEGACY_FLAG_HAS_PATH) !== 0) {
        delta.path = readPathDelta(reader, mapId, index);
    }
    return delta;
}

function readLifecycleDelta(
    reader: ByteBuffer,
    flags: number,
    mapId: number,
    index: number,
): NpcUpdateDelta {
    const delta: MutableNpcUpdateDelta = {};
    if ((flags & DELTA_FLAG_CLEAR_SERVER_PATH) !== 0) {
        delta.clearServerPath = true;
    }
    if ((flags & DELTA_FLAG_HAS_SNAP_TILE) !== 0) {
        delta.snapTileX = reader.readSignedShort() | 0;
        delta.snapTileY = reader.readSignedShort() | 0;
    }
    if ((flags & DELTA_FLAG_HAS_SNAP_WORLD) !== 0) {
        delta.snapWorldX = reader.readInt() | 0;
        delta.snapWorldY = reader.readInt() | 0;
    }
    if ((flags & DELTA_FLAG_HAS_ORIENTATION) !== 0) {
        delta.orientation = reader.readUnsignedShort() | 0;
    }
    if ((flags & DELTA_FLAG_HAS_ROTATION) !== 0) {
        delta.rotation = reader.readUnsignedShort() | 0;
    }
    if ((flags & DELTA_FLAG_HAS_PATH) !== 0) {
        delta.path = readPathDelta(reader, mapId, index);
    }
    return delta;
}

function decodeLegacyNpcUpdatePacket(reader: ByteBuffer): DecodedLegacyNpcUpdatePacket {
    const mapCount = reader.readUnsignedShort() | 0;
    const updateEventsByMapId = new Map<number, LegacyNpcUpdateEvent[]>();
    let deltaCount = 0;

    for (let m = 0; m < mapCount; m++) {
        const mapId = reader.readUnsignedShort() | 0;
        const mapDeltaCount = reader.readUnsignedShort() | 0;
        const mapEvents = new Array<LegacyNpcUpdateEvent>(mapDeltaCount);
        for (let i = 0; i < mapDeltaCount; i++) {
            const flags = reader.readUnsignedByte() | 0;
            let npcIndex: number | undefined;
            let npcOrderKey: number | undefined;
            let npcInstanceId: number | undefined;

            if ((flags & LEGACY_FLAG_HAS_NPC_INDEX) !== 0) {
                npcIndex = reader.readUnsignedShort() | 0;
            }
            if ((flags & LEGACY_FLAG_HAS_NPC_ORDER_KEY) !== 0) {
                npcOrderKey = reader.readInt() | 0;
                npcInstanceId = npcOrderKey | 0;
            }
            if (npcInstanceId === undefined && npcIndex === undefined && npcOrderKey === undefined) {
                throw new Error(
                    `[map-viewer][npc-update-packet] delta missing target: ` +
                        `mapId=${mapId | 0} index=${i | 0}`,
                );
            }

            const delta = readLegacyDelta(reader, flags, mapId, i);

            mapEvents[i] = { mapId: mapId | 0, npcIndex, npcOrderKey, npcInstanceId, delta };
            deltaCount = (deltaCount + 1) | 0;
        }
        updateEventsByMapId.set(mapId | 0, mapEvents);
    }

    return {
        version: LEGACY_PACKET_VERSION,
        updateEventsByMapId,
        deltaCount: deltaCount | 0,
    };
}

function decodeNpcLifecyclePacket(reader: ByteBuffer): DecodedNpcLifecyclePacket {
    const mapCount = reader.readUnsignedShort() | 0;
    const lifecycleEventsByMapId = new Map<number, NpcEvent[]>();
    let eventCount = 0;

    for (let m = 0; m < mapCount; m++) {
        const mapId = reader.readUnsignedShort() | 0;
        const spawnCount = reader.readUnsignedShort() | 0;
        const updateCount = reader.readUnsignedShort() | 0;
        const despawnCount = reader.readUnsignedShort() | 0;
        const events: NpcEvent[] = [];

        for (let i = 0; i < spawnCount; i++) {
            const npcInstanceId = reader.readInt() | 0;
            const npcTypeId = reader.readUnsignedShort() | 0;
            const tileX = reader.readSignedShort() | 0;
            const tileY = reader.readSignedShort() | 0;
            const level = reader.readUnsignedByte() | 0;
            const flags = reader.readUnsignedByte() | 0;
            const event: NpcSpawnEvent = {
                kind: "spawn",
                mapId: mapId | 0,
                npcInstanceId,
                npcTypeId,
                tileX,
                tileY,
                level,
                orderKey:
                    (flags & SPAWN_FLAG_HAS_ORDER_KEY) !== 0 ? (reader.readInt() | 0) : undefined,
            };
            events.push(event);
            eventCount = (eventCount + 1) | 0;
        }

        for (let i = 0; i < updateCount; i++) {
            const npcInstanceId = reader.readInt() | 0;
            const seq = reader.readInt() | 0;
            const flags = reader.readUnsignedByte() | 0;
            const event: NpcUpdateEvent = {
                kind: "update",
                mapId: mapId | 0,
                npcInstanceId,
                seq,
                delta: readLifecycleDelta(reader, flags, mapId, i),
            };
            events.push(event);
            eventCount = (eventCount + 1) | 0;
        }

        for (let i = 0; i < despawnCount; i++) {
            const event: NpcDespawnEvent = {
                kind: "despawn",
                mapId: mapId | 0,
                npcInstanceId: reader.readInt() | 0,
                seq: reader.readInt() | 0,
            };
            events.push(event);
            eventCount = (eventCount + 1) | 0;
        }

        if ((events.length | 0) > 0) {
            lifecycleEventsByMapId.set(mapId | 0, events);
        }
    }

    return {
        version: LIFECYCLE_PACKET_VERSION,
        lifecycleEventsByMapId,
        eventCount: eventCount | 0,
    };
}

export function decodeNpcUpdatePacket(input: ByteInput): DecodedNpcUpdatePacket {
    const reader = new ByteBuffer(toUint8Array(input));
    const version = reader.readUnsignedShort() | 0;
    let decoded: DecodedNpcUpdatePacket;
    if ((version | 0) === LEGACY_PACKET_VERSION) {
        decoded = decodeLegacyNpcUpdatePacket(reader);
    } else if ((version | 0) === LIFECYCLE_PACKET_VERSION) {
        decoded = decodeNpcLifecyclePacket(reader);
    } else {
        throw new Error(
            `[map-viewer][npc-update-packet] unsupported version: ` +
                `got=${version | 0} expected=${LEGACY_PACKET_VERSION}|${LIFECYCLE_PACKET_VERSION}`,
        );
    }

    if ((reader.remaining | 0) !== 0) {
        throw new Error(`[map-viewer][npc-update-packet] trailing bytes: ${reader.remaining | 0}`);
    }

    return decoded;
}
