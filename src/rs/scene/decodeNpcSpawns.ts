import { NpcSpawn } from "../../data/npc/NpcSpawn";
import { ByteBuffer } from "../io/ByteBuffer";
import { TileRenderFlag } from "./Scene";

export function decodeNpcSpawnsFromBytes(
    tileRenderFlagsLevel1: Uint8Array[],
    borderSize: number,
    mapX: number,
    mapY: number,
    data: Uint8Array,
): NpcSpawn[] {
    const spawns: NpcSpawn[] = [];

    const buffer = new ByteBuffer(data);

    const baseX = mapX * 64;
    const baseY = mapY * 64;

    while (buffer.remaining > 0) {
        const positionPacked = buffer.readUnsignedShort();
        let level = positionPacked >> 14;
        const x = (positionPacked >> 7) & 0x3f;
        const y = positionPacked & 0x3f;
        const id = buffer.readUnsignedShort();
        if (
            level > 0 &&
            (tileRenderFlagsLevel1[x + borderSize][y + borderSize] & TileRenderFlag.Bridge) !== 0
        ) {
            level--;
        }
        spawns.push({
            id,
            x: baseX + x,
            y: baseY + y,
            level,
        });
    }

    return spawns;
}
