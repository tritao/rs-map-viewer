import { TileRenderFlag } from "../../rs/scene/Scene";
import type { NpcGpuDataTarget, NpcGpuFrameData } from "./NpcGpuData";

export class NpcGpuDataBuilder {
    private count = 0;
    private data: Uint16Array = new Uint16Array(16 * 4);

    beginFrame(): void {
        this.count = 0;
    }

    addRenderable(renderable: NpcGpuDataTarget): number {
        const npcs = renderable.getNpcs();
        if (npcs.length === 0) {
            return -1;
        }

        const offset = this.count | 0;

        for (const npc of npcs) {
            const tileX = npc.x >> 7;
            const tileY = npc.y >> 7;

            let renderPlane = npc.level;
            if (
                renderPlane < 3 &&
                (renderable.getTileRenderFlag(1, tileX, tileY) & TileRenderFlag.Bridge) !== 0
            ) {
                renderPlane++;
            }

            this.pushNpc(npc.x, npc.y, (npc.rotation << 2) | renderPlane, npc.npcType.id);
        }
        return offset;
    }

    flushPacked(): NpcGpuFrameData {
        const height = Math.max(Math.ceil(this.count / 16), 1);
        const required = (16 * height * 4) | 0;
        if (this.data.length < required) {
            const newData = new Uint16Array(required);
            newData.set(this.data);
            this.data = newData;
        }
        // Important: this buffer may be transferred from worker -> main thread. Never return a view
        // into `this.data` directly, otherwise the next frame would try to write into a detached
        // buffer (threads Transfer detaches). Returning a copy keeps the internal scratch reusable.
        return {
            width: 16,
            height,
            data: this.data.slice(0, required),
        };
    }

    private pushNpc(x: number, y: number, rotationAndPlane: number, npcTypeId: number): void {
        const nextCount = (this.count + 1) | 0;
        if ((((this.data.length / 4) | 0) as number) < nextCount) {
            // Grow by ~2x, rounded to 16-texel rows (width=16, rgba=4).
            const newData = new Uint16Array(Math.ceil((nextCount * 2) / 16) * 16 * 4);
            newData.set(this.data);
            this.data = newData;
        }

        let offset = (this.count * 4) | 0;
        this.data[offset++] = x;
        this.data[offset++] = y;
        this.data[offset++] = rotationAndPlane;
        this.data[offset++] = npcTypeId;
        this.count = nextCount;
    }
}
