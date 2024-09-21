import PicoGL, {
    DrawCall,
    App as PicoApp,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { DrawRange } from "../DrawRange";
import { Npc } from "../npc/Npc";
import { DynamicNpcData } from "../npc/NpcData";
import { RenderableType } from "../Renderer";

export type DrawCallRange = {
    drawCall: DrawCall;
    drawRanges: DrawRange[];
};

export type CreateDrawCallFunction = (program: Program,
    vertexArray: VertexArray,
    modelInfoTexture: Texture | undefined,
    drawRanges: DrawRange[]) => DrawCallRange;

export class WebGLDynamicBuffers {
    interleavedBuffer!: VertexBuffer;
    indexBuffer!: VertexBuffer;
    vertexArray!: VertexArray;

    dynamicNpcs!: Npc[];

    constructor(readonly type: RenderableType) { }

    createDynamicBuffers(app: PicoApp, vertices: Uint8Array, indices: Int32Array) {
        if (this.interleavedBuffer)
            this.interleavedBuffer.delete();

        if (this.indexBuffer)
            this.indexBuffer.delete();

        if (this.vertexArray)
            this.vertexArray.delete();

        this.interleavedBuffer = app.createInterleavedBuffer(12, vertices,
            PicoGL.DYNAMIC_DRAW);
        this.indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, indices);

        this.vertexArray = app
            .createVertexArray()
            // v0, v1, v2
            .vertexAttributeBuffer(0, this.interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(this.indexBuffer);
    }

    createDynamicNpcs(data: DynamicNpcData[]) {
        this.dynamicNpcs = [];

        for (const npc of data) {
            const _npc = new Npc(
                npc.spawnX,
                npc.spawnY,
                npc.level,
                npc.idleAnim,
                npc.walkAnim,
                npc.walkAnimSeqId,
                npc.idleAnimSeqId,
                null,
            );
            _npc.rotation = npc.rotation;
            _npc.x = npc.x;
            _npc.y = npc.y;
            this.dynamicNpcs.push(_npc);
        }
    }

    delete() {
        this.vertexArray.delete();
        this.interleavedBuffer.delete();
        this.indexBuffer.delete();
    }
}
