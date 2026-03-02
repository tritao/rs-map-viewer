import { MovementType } from "../../runtime/entities/Npc";
import { ByteBuffer } from "../../rs/io/ByteBuffer";
import type { NpcUpdateEvent } from "./NpcEvents";
import type { NpcUpdateDelta } from "./NpcSimMovement";

const PACKET_VERSION = 1;
const MAX_PATH_LENGTH = 25;

const FLAG_HAS_NPC_INDEX = 1 << 0;
const FLAG_HAS_NPC_ORDER_KEY = 1 << 1;
const FLAG_CLEAR_SERVER_PATH = 1 << 2;
const FLAG_HAS_SNAP_TILE = 1 << 3;
const FLAG_HAS_SNAP_WORLD = 1 << 4;
const FLAG_HAS_ORIENTATION = 1 << 5;
const FLAG_HAS_ROTATION = 1 << 6;
const FLAG_HAS_PATH = 1 << 7;

export type DecodedNpcUpdatePacket = Readonly<{
    version: number;
    updateEventsByMapId: ReadonlyMap<number, NpcUpdateEvent[]>;
    deltaCount: number;
}>;

type MutableNpcUpdateDelta = {
    -readonly [K in keyof NpcUpdateDelta]: NpcUpdateDelta[K];
};

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

export function decodeNpcUpdatePacket(input: ByteInput): DecodedNpcUpdatePacket {
    const reader = new ByteBuffer(toUint8Array(input));
    const version = reader.readUnsignedShort() | 0;
    if ((version | 0) !== PACKET_VERSION) {
        throw new Error(
            `[map-viewer][npc-update-packet] unsupported version: ` +
                `got=${version | 0} expected=${PACKET_VERSION}`,
        );
    }

    const mapCount = reader.readUnsignedShort() | 0;
    const updateEventsByMapId = new Map<number, NpcUpdateEvent[]>();
    let deltaCount = 0;

    for (let m = 0; m < mapCount; m++) {
        const mapId = reader.readUnsignedShort() | 0;
        const mapDeltaCount = reader.readUnsignedShort() | 0;
        const mapEvents = new Array<NpcUpdateEvent>(mapDeltaCount);
        for (let i = 0; i < mapDeltaCount; i++) {
            const flags = reader.readUnsignedByte() | 0;
            const delta: MutableNpcUpdateDelta = {};

            if ((flags & FLAG_HAS_NPC_INDEX) !== 0) {
                delta.npcIndex = reader.readUnsignedShort() | 0;
            }
            if ((flags & FLAG_HAS_NPC_ORDER_KEY) !== 0) {
                delta.npcOrderKey = reader.readInt() | 0;
                delta.npcInstanceId = delta.npcOrderKey | 0;
            }
            if (
                delta.npcInstanceId === undefined &&
                delta.npcIndex === undefined &&
                delta.npcOrderKey === undefined
            ) {
                throw new Error(
                    `[map-viewer][npc-update-packet] delta missing target: ` +
                        `mapId=${mapId | 0} index=${i | 0}`,
                );
            }

            if ((flags & FLAG_CLEAR_SERVER_PATH) !== 0) {
                delta.clearServerPath = true;
            }
            if ((flags & FLAG_HAS_SNAP_TILE) !== 0) {
                delta.snapTileX = reader.readSignedShort() | 0;
                delta.snapTileY = reader.readSignedShort() | 0;
            }
            if ((flags & FLAG_HAS_SNAP_WORLD) !== 0) {
                delta.snapWorldX = reader.readInt() | 0;
                delta.snapWorldY = reader.readInt() | 0;
            }
            if ((flags & FLAG_HAS_ORIENTATION) !== 0) {
                delta.orientation = reader.readUnsignedShort() | 0;
            }
            if ((flags & FLAG_HAS_ROTATION) !== 0) {
                delta.rotation = reader.readUnsignedShort() | 0;
            }
            if ((flags & FLAG_HAS_PATH) !== 0) {
                const pathLength = reader.readUnsignedByte() | 0;
                if (pathLength < 0 || pathLength > MAX_PATH_LENGTH) {
                    throw new Error(
                        `[map-viewer][npc-update-packet] invalid path length: ` +
                            `mapId=${mapId | 0} index=${i | 0} len=${pathLength | 0}`,
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
                delta.path = {
                    length: pathLength | 0,
                    pathX,
                    pathY,
                    pathMovementType,
                };
            }

            mapEvents[i] = {
                kind: "update",
                mapId: mapId | 0,
                delta,
                npcInstanceId: delta.npcInstanceId,
            };
            deltaCount = (deltaCount + 1) | 0;
        }
        updateEventsByMapId.set(mapId | 0, mapEvents);
    }

    if ((reader.remaining | 0) !== 0) {
        throw new Error(
            `[map-viewer][npc-update-packet] trailing bytes: ${reader.remaining | 0}`,
        );
    }

    return {
        version: version | 0,
        updateEventsByMapId,
        deltaCount: deltaCount | 0,
    };
}
