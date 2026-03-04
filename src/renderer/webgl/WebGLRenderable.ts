import PicoGL, {
    DrawCall,
    App as PicoApp,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { SdRenderableData } from "../../maprender/MapRenderPayload";
import { Scene } from "../../rs/scene/Scene";

const FRAME_RENDER_DELAY = 3;

function createIntegerVertexAttributeOptions(
    type: number,
    size: number,
    stride: number,
): Parameters<VertexArray["vertexAttributeBuffer"]>[2] {
    return { type, size, stride, integer: true } as unknown as Parameters<
        VertexArray["vertexAttributeBuffer"]
    >[2];
}

function createModelInfoTexture(app: PicoApp, data: Uint16Array): Texture {
    return app.createTexture2D(data, 16, Math.max(Math.ceil(data.length / 16 / 4), 1), {
        internalFormat: PicoGL.RGBA16UI,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
    });
}

export type DrawCallRange = {
    drawCall: DrawCall;
    drawRangesPacked: Int32Array;
};

export const enum DrawCallKey {
    Base = 0,
    Alpha = 1,
    Lod = 2,
    LodAlpha = 3,
    Interact = 4,
    InteractAlpha = 5,
    InteractLod = 6,
    InteractLodAlpha = 7,
}
const DRAW_CALL_KEY_COUNT = 8;

export type CreateDrawCallFunction = (
    program: Program,
    modelInfoTexture: Texture | undefined,
    drawRangesPacked: Int32Array,
    useNpcGeometry?: boolean,
) => DrawCallRange;

export class WebGLRenderable {
    interleavedBuffer!: VertexBuffer;
    indexBuffer!: VertexBuffer;
    vertexArray!: VertexArray;
    npcInterleavedBuffer?: VertexBuffer;
    npcIndexBuffer?: VertexBuffer;
    npcVertexArray?: VertexArray;

    private modelInfoTexturesByKey!: Texture[];

    heightMapTexture!: Texture;

    private drawCallsByKey!: DrawCallRange[];

    private disposed = false;

    // Actual cache texture IDs used by this renderable (optional; used for texture residency).
    usedTextureIds?: Int32Array;

    constructor(
        readonly id: number,

        readonly borderSize: number,
        readonly tileRenderFlags: Uint8Array[][],

        readonly timeLoaded: number,
        readonly frameLoaded: number,
    ) {}

    getTileRenderFlag(level: number, tileX: number, tileY: number): number {
        return this.tileRenderFlags[level][tileX + this.borderSize][tileY + this.borderSize];
    }

    createHeightMapTexture(app: PicoApp, data: Int16Array, heightMapSize: number) {
        this.heightMapTexture = app.createTextureArray(
            data,
            heightMapSize,
            heightMapSize,
            Scene.MAX_LEVELS,
            {
                internalFormat: PicoGL.R16I,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
                type: PicoGL.SHORT,
                wrapS: PicoGL.CLAMP_TO_EDGE,
                wrapT: PicoGL.CLAMP_TO_EDGE,
            },
        );
    }

    createBuffers(app: PicoApp, data: SdRenderableData) {
        this.interleavedBuffer = app.createInterleavedBuffer(16, data.vertices);
        this.indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, data.indices);

        this.vertexArray = app
            .createVertexArray()
            // v0, v1, v2, v3
            .vertexAttributeBuffer(
                0,
                this.interleavedBuffer,
                createIntegerVertexAttributeOptions(PicoGL.UNSIGNED_INT, 4, 16),
            )
            .indexBuffer(this.indexBuffer);
    }

    createNpcGeometryBuffers(app: PicoApp, data: SdRenderableData) {
        if (
            !(data.npcVertices instanceof Uint8Array) ||
            !(data.npcIndices instanceof Int32Array) ||
            data.npcVertices.length === 0 ||
            data.npcIndices.length === 0
        ) {
            this.npcInterleavedBuffer = undefined;
            this.npcIndexBuffer = undefined;
            this.npcVertexArray = undefined;
            return;
        }
        this.npcInterleavedBuffer = app.createInterleavedBuffer(16, data.npcVertices);
        this.npcIndexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, data.npcIndices);

        this.npcVertexArray = app
            .createVertexArray()
            .vertexAttributeBuffer(
                0,
                this.npcInterleavedBuffer,
                createIntegerVertexAttributeOptions(PicoGL.UNSIGNED_INT, 4, 16),
            )
            .indexBuffer(this.npcIndexBuffer);
    }

    private static isAlphaKey(key: DrawCallKey): boolean {
        return (
            key === DrawCallKey.Alpha ||
            key === DrawCallKey.LodAlpha ||
            key === DrawCallKey.InteractAlpha ||
            key === DrawCallKey.InteractLodAlpha
        );
    }

    private static getModelInfoBuckets(
        modelInfoTextures: SdRenderableData["modelInfoTextures"],
    ): ReadonlyArray<Uint16Array> {
        return [
            modelInfoTextures.base,
            modelInfoTextures.alpha,
            modelInfoTextures.lod,
            modelInfoTextures.lodAlpha,
            modelInfoTextures.interact,
            modelInfoTextures.interactAlpha,
            modelInfoTextures.interactLod,
            modelInfoTextures.interactLodAlpha,
        ];
    }

    private static getDrawRangeBuckets(
        drawRanges: SdRenderableData["drawRanges"],
    ): ReadonlyArray<Int32Array> {
        return [
            drawRanges.base,
            drawRanges.alpha,
            drawRanges.lod,
            drawRanges.lodAlpha,
            drawRanges.interact,
            drawRanges.interactAlpha,
            drawRanges.interactLod,
            drawRanges.interactLodAlpha,
        ];
    }

    createModelInfoTextures(app: PicoApp, data: SdRenderableData) {
        const modelInfoBuckets = WebGLRenderable.getModelInfoBuckets(data.modelInfoTextures);
        const textures = new Array<Texture>(DRAW_CALL_KEY_COUNT);
        for (let i = 0; i < DRAW_CALL_KEY_COUNT; i++) {
            textures[i] = createModelInfoTexture(app, modelInfoBuckets[i]!);
        }
        this.modelInfoTexturesByKey = textures;
    }

    createDrawCalls(
        data: SdRenderableData,
        createDrawCall: CreateDrawCallFunction,
        mainProgram: Program,
        mainAlphaProgram: Program,
    ) {
        const drawRangeBuckets = WebGLRenderable.getDrawRangeBuckets(data.drawRanges);
        const drawCalls = new Array<DrawCallRange>(DRAW_CALL_KEY_COUNT);
        for (let i = 0; i < DRAW_CALL_KEY_COUNT; i++) {
            const key = i as DrawCallKey;
            drawCalls[i] = createDrawCall(
                WebGLRenderable.isAlphaKey(key) ? mainAlphaProgram : mainProgram,
                this.modelInfoTexturesByKey[i],
                drawRangeBuckets[i]!,
            );
        }
        this.drawCallsByKey = drawCalls;
    }

    canRender(frameCount: number): boolean {
        return frameCount - this.frameLoaded > FRAME_RENDER_DELAY;
    }

    getDrawCall(isAlpha: boolean, isInteract: boolean, isLod: boolean): DrawCallRange {
        let key = DrawCallKey.Base;
        if (isInteract) {
            key = isLod
                ? isAlpha
                    ? DrawCallKey.InteractLodAlpha
                    : DrawCallKey.InteractLod
                : isAlpha
                ? DrawCallKey.InteractAlpha
                : DrawCallKey.Interact;
        } else if (isLod) {
            key = isAlpha ? DrawCallKey.LodAlpha : DrawCallKey.Lod;
        } else if (isAlpha) {
            key = DrawCallKey.Alpha;
        }
        return this.drawCallsByKey[key as number] ?? this.drawCallsByKey[DrawCallKey.Base];
    }

    delete() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;

        this.vertexArray.delete();
        this.interleavedBuffer.delete();
        this.indexBuffer.delete();
        this.npcVertexArray?.delete();
        this.npcInterleavedBuffer?.delete();
        this.npcIndexBuffer?.delete();

        this.heightMapTexture.delete();
        for (const texture of this.modelInfoTexturesByKey ?? []) {
            texture.delete();
        }

        this.modelInfoTexturesByKey = [];
        this.drawCallsByKey = [];
        this.npcVertexArray = undefined;
        this.npcInterleavedBuffer = undefined;
        this.npcIndexBuffer = undefined;
        this.usedTextureIds = undefined;
    }
}
