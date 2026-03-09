import { TileRenderFlag } from "../rs/scene/Scene";
import type { NpcGpuFrameData } from "./NpcGpuFrame";

export type NpcGpuFrameSource = Readonly<{
    x: number;
    y: number;
    level: number;
    rotation: number;
    npcInstanceId: number;
    npcTypeId: number;
}>;

export class NpcGpuFrameBuilder {
    private count = 0;
    private data: Uint16Array = new Uint16Array(16 * 4);
    private interactionMetaPacked: Int32Array = new Int32Array(16 * 2);

    beginFrame(): void {
        this.count = 0;
    }

    addMapNpcs(
        npcs: ReadonlyArray<NpcGpuFrameSource>,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
    ): Readonly<{ start: number; count: number }> {
        const start = this.count | 0;
        const count = npcs.length | 0;
        if (npcs.length === 0) {
            return { start, count: 0 };
        }

        const border = borderSize | 0;

        for (const npc of npcs) {
            const tileX = npc.x >> 7;
            const tileY = npc.y >> 7;

            let renderPlane = npc.level;
            const col = tileRenderFlagsLevel1[(tileX + border) | 0];
            const flag = col ? col[(tileY + border) | 0] | 0 : 0;
            if (renderPlane < 3 && (flag & TileRenderFlag.Bridge) !== 0) {
                renderPlane++;
            }

            this.pushNpc(
                npc.x,
                npc.y,
                (npc.rotation << 2) | renderPlane,
                npc.npcInstanceId,
                npc.npcTypeId,
            );
        }
        return { start, count };
    }

    flushPacked(): NpcGpuFrameData {
        const height = Math.max(Math.ceil(this.count / 16), 1);
        const required = (16 * height * 4) | 0;
        if (this.data.length < required) {
            const newData = new Uint16Array(required);
            newData.set(this.data);
            this.data = newData;
        }
        return {
            width: 16,
            height,
            data: this.data.slice(0, required),
        };
    }

    flushInteractionMetaPacked(): Int32Array {
        return this.interactionMetaPacked.slice(0, (this.count | 0) * 2);
    }

    private pushNpc(
        x: number,
        y: number,
        rotationAndPlane: number,
        npcInstanceId: number,
        npcTypeId: number,
    ): void {
        const nextCount = (this.count + 1) | 0;
        if ((((this.data.length / 4) | 0) as number) < nextCount) {
            const newData = new Uint16Array(Math.ceil((nextCount * 2) / 16) * 16 * 4);
            newData.set(this.data);
            this.data = newData;
        }
        if ((((this.interactionMetaPacked.length / 2) | 0) as number) < nextCount) {
            const newMeta = new Int32Array(Math.ceil((nextCount * 2) / 16) * 16 * 2);
            newMeta.set(this.interactionMetaPacked);
            this.interactionMetaPacked = newMeta;
        }
        if ((nextCount | 0) > 0xffff) {
            throw new Error(
                `[map-render][npc-frame] npc interaction index overflow: count=${nextCount | 0}`,
            );
        }

        let offset = (this.count * 4) | 0;
        this.data[offset++] = x;
        this.data[offset++] = y;
        this.data[offset++] = rotationAndPlane;
        this.data[offset++] = this.count | 0;
        let metaOffset = (this.count * 2) | 0;
        this.interactionMetaPacked[metaOffset++] = npcInstanceId | 0;
        this.interactionMetaPacked[metaOffset++] = npcTypeId | 0;
        this.count = nextCount;
    }
}
