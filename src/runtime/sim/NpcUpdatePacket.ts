import { MovementType } from "../../runtime/entities/Npc";
import { ByteBuffer } from "../../rs/io/ByteBuffer";
import type { NpcEvent, NpcSpawnEvent, NpcUpdateEvent, NpcDespawnEvent } from "./NpcEvents";
import type { NpcUpdateDelta } from "./NpcSimMovement";

const LIFECYCLE_PACKET_VERSION = 2;
const MAX_PATH_LENGTH = 25;

const DELTA_FLAG_CLEAR_SERVER_PATH = 1 << 0;
const DELTA_FLAG_HAS_SNAP_TILE = 1 << 1;
const DELTA_FLAG_HAS_SNAP_WORLD = 1 << 2;
const DELTA_FLAG_HAS_ORIENTATION = 1 << 3;
const DELTA_FLAG_HAS_ROTATION = 1 << 4;
const DELTA_FLAG_HAS_PATH = 1 << 5;

const SPAWN_FLAG_HAS_ORDER_KEY = 1 << 0;

export type DecodedNpcLifecyclePacket = Readonly<{
    version: 2;
    lifecycleEventsByMapId: ReadonlyMap<number, NpcEvent[]>;
    eventCount: number;
}>;

type MutableNpcUpdateDelta = {
    -readonly [K in keyof NpcUpdateDelta]: NpcUpdateDelta[K];
};

type ByteInput = ArrayBuffer | ArrayBufferView;

class PacketWriter {
    private bytes = new Uint8Array(256);
    private offset = 0;

    private ensure(extra: number): void {
        const required = (this.offset + extra) | 0;
        if (required <= this.bytes.length) {
            return;
        }
        let nextLength = this.bytes.length | 0;
        while (nextLength < required) {
            nextLength = (nextLength * 2) | 0;
        }
        const nextBytes = new Uint8Array(nextLength);
        nextBytes.set(this.bytes.subarray(0, this.offset));
        this.bytes = nextBytes;
    }

    writeU8(value: number): void {
        this.ensure(1);
        this.bytes[this.offset++] = value & 0xff;
    }

    writeU16(value: number): void {
        this.ensure(2);
        this.bytes[this.offset++] = (value >>> 8) & 0xff;
        this.bytes[this.offset++] = value & 0xff;
    }

    writeI16(value: number): void {
        this.writeU16(value & 0xffff);
    }

    writeI32(value: number): void {
        this.ensure(4);
        this.bytes[this.offset++] = (value >>> 24) & 0xff;
        this.bytes[this.offset++] = (value >>> 16) & 0xff;
        this.bytes[this.offset++] = (value >>> 8) & 0xff;
        this.bytes[this.offset++] = value & 0xff;
    }

    finish(): Uint8Array {
        return this.bytes.slice(0, this.offset);
    }
}

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

function writePathDelta(writer: PacketWriter, path: NonNullable<NpcUpdateDelta["path"]>): void {
    const pathLength = Math.min(
        MAX_PATH_LENGTH,
        path.length ?? Math.min(path.pathX.length | 0, path.pathY.length | 0),
    );
    writer.writeU8(pathLength | 0);
    for (let i = 0; i < pathLength; i++) {
        writer.writeI16(path.pathX[i] | 0);
        writer.writeI16(path.pathY[i] | 0);
        const movement = path.pathMovementType?.[i];
        const movementType =
            movement === MovementType.CRAWL || movement === MovementType.RUN
                ? movement
                : MovementType.WALK;
        writer.writeU8(movementType | 0);
    }
}

function writeLifecycleDelta(writer: PacketWriter, delta: NpcUpdateDelta): void {
    let flags = 0;
    if (delta.clearServerPath) {
        flags |= DELTA_FLAG_CLEAR_SERVER_PATH;
    }
    if (delta.snapTileX !== undefined && delta.snapTileY !== undefined) {
        flags |= DELTA_FLAG_HAS_SNAP_TILE;
    }
    if (delta.snapWorldX !== undefined && delta.snapWorldY !== undefined) {
        flags |= DELTA_FLAG_HAS_SNAP_WORLD;
    }
    if (delta.orientation !== undefined) {
        flags |= DELTA_FLAG_HAS_ORIENTATION;
    }
    if (delta.rotation !== undefined) {
        flags |= DELTA_FLAG_HAS_ROTATION;
    }
    if (delta.path) {
        flags |= DELTA_FLAG_HAS_PATH;
    }
    writer.writeU8(flags | 0);

    if ((flags & DELTA_FLAG_HAS_SNAP_TILE) !== 0) {
        writer.writeI16(delta.snapTileX! | 0);
        writer.writeI16(delta.snapTileY! | 0);
    }
    if ((flags & DELTA_FLAG_HAS_SNAP_WORLD) !== 0) {
        writer.writeI32(delta.snapWorldX! | 0);
        writer.writeI32(delta.snapWorldY! | 0);
    }
    if ((flags & DELTA_FLAG_HAS_ORIENTATION) !== 0) {
        writer.writeU16(delta.orientation! | 0);
    }
    if ((flags & DELTA_FLAG_HAS_ROTATION) !== 0) {
        writer.writeU16(delta.rotation! | 0);
    }
    if ((flags & DELTA_FLAG_HAS_PATH) !== 0) {
        writePathDelta(writer, delta.path!);
    }
}

export function encodeNpcLifecyclePacket(
    lifecycleEventsByMapId: ReadonlyMap<number, ReadonlyArray<NpcEvent>>,
): Uint8Array {
    const writer = new PacketWriter();
    writer.writeU16(LIFECYCLE_PACKET_VERSION);
    writer.writeU16(lifecycleEventsByMapId.size | 0);

    for (const [mapIdRaw, events] of lifecycleEventsByMapId.entries()) {
        const mapId = mapIdRaw | 0;
        const spawns: NpcSpawnEvent[] = [];
        const updates: NpcUpdateEvent[] = [];
        const despawns: NpcDespawnEvent[] = [];

        for (let i = 0; i < events.length; i++) {
            const event = events[i]!;
            if ((event.mapId | 0) !== mapId) {
                throw new Error(
                    `[map-viewer][npc-update-packet] mapId mismatch in event batch: ` +
                        `entry=${mapId | 0} event=${event.mapId | 0}`,
                );
            }
            if (event.kind === "spawn") {
                spawns.push(event);
            } else if (event.kind === "update") {
                updates.push(event);
            } else {
                despawns.push(event);
            }
        }

        writer.writeU16(mapId);
        writer.writeU16(spawns.length | 0);
        writer.writeU16(updates.length | 0);
        writer.writeU16(despawns.length | 0);

        for (let i = 0; i < spawns.length; i++) {
            const event = spawns[i]!;
            writer.writeI32(event.npcInstanceId | 0);
            writer.writeU16(event.npcTypeId | 0);
            writer.writeI16(event.tileX | 0);
            writer.writeI16(event.tileY | 0);
            writer.writeU8(event.level | 0);
            let flags = 0;
            if (event.orderKey !== undefined) {
                flags |= SPAWN_FLAG_HAS_ORDER_KEY;
            }
            writer.writeU8(flags | 0);
            if ((flags & SPAWN_FLAG_HAS_ORDER_KEY) !== 0) {
                writer.writeI32(event.orderKey! | 0);
            }
        }

        for (let i = 0; i < updates.length; i++) {
            const event = updates[i]!;
            writer.writeI32(event.npcInstanceId | 0);
            writer.writeI32(event.seq | 0);
            writeLifecycleDelta(writer, event.delta);
        }

        for (let i = 0; i < despawns.length; i++) {
            const event = despawns[i]!;
            writer.writeI32(event.npcInstanceId | 0);
            writer.writeI32(event.seq | 0);
        }
    }

    return writer.finish();
}

export function encodeNpcLifecyclePacketFromEvents(events: ReadonlyArray<NpcEvent>): Uint8Array {
    const lifecycleEventsByMapId = new Map<number, NpcEvent[]>();
    for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        const mapId = event.mapId | 0;
        const mapEvents = lifecycleEventsByMapId.get(mapId);
        if (mapEvents) {
            mapEvents.push(event);
        } else {
            lifecycleEventsByMapId.set(mapId, [event]);
        }
    }
    return encodeNpcLifecyclePacket(lifecycleEventsByMapId);
}

export function decodeNpcLifecyclePacket(input: ByteInput): DecodedNpcLifecyclePacket {
    const reader = new ByteBuffer(toUint8Array(input));
    const version = reader.readUnsignedShort() | 0;
    if ((version | 0) !== LIFECYCLE_PACKET_VERSION) {
        throw new Error(
            `[map-viewer][npc-update-packet] unsupported version: ` +
                `got=${version | 0} expected=${LIFECYCLE_PACKET_VERSION}`,
        );
    }

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

    if ((reader.remaining | 0) !== 0) {
        throw new Error(`[map-viewer][npc-update-packet] trailing bytes: ${reader.remaining | 0}`);
    }

    return {
        version: LIFECYCLE_PACKET_VERSION,
        lifecycleEventsByMapId,
        eventCount: eventCount | 0,
    };
}
