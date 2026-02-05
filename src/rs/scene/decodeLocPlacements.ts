import { ByteBuffer } from "../io/ByteBuffer";
import { LocModelType } from "../config/loctype/LocModelType";

export type LocPlacement = {
    id: number;
    level: number;
    localX: number;
    localY: number;
    type: LocModelType;
    rotation: number;
};

export function decodeLocPlacementsFromBytes(data: Uint8Array): LocPlacement[] {
    const buffer = new ByteBuffer(data);

    const placements: LocPlacement[] = [];

    let id = -1;
    let idDelta: number;
    while ((idDelta = buffer.readSmart3()) !== 0) {
        id += idDelta;

        let pos = 0;
        let posDelta: number;
        while ((posDelta = buffer.readUnsignedSmart()) !== 0) {
            pos += posDelta - 1;

            const localX = (pos >> 6) & 0x3f;
            const localY = pos & 0x3f;
            const level = pos >> 12;

            const attributes = buffer.readUnsignedByte();

            const type: LocModelType = attributes >> 2;
            const rotation = attributes & 0x3;

            placements.push({
                id,
                level,
                localX,
                localY,
                type,
                rotation,
            });
        }
    }

    return placements;
}

