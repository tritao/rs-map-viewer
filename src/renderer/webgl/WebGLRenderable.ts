import PicoGL, {
    DrawCall,
    App as PicoApp,
    Program,
    Texture,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { Scene } from "../../rs/scene/Scene";
import { SdRenderableData } from "../loader/SdRenderableData";
import { LocAnimated } from "../loc/LocAnimated";
import { Npc } from "../npc/Npc";
import type { DrawRangeTickStateInput } from "../../wasm/DrawRangeTickState";
import type {
    TickCapability,
    TickPatchBackendResult,
} from "../patch/TickCapability";
import { WebGLMapSquareTickState } from "./WebGLMapSquareTickState";
import {
    buildLocsAnimated,
    buildNpcDrawRanges,
    buildNpcs,
} from "./WebGLRenderableBuild";

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

export class WebGLRenderable implements TickCapability {
    interleavedBuffer!: VertexBuffer;
    indexBuffer!: VertexBuffer;
    vertexArray!: VertexArray;
    npcInterleavedBuffer?: VertexBuffer;
    npcIndexBuffer?: VertexBuffer;
    npcVertexArray?: VertexArray;

    private modelInfoTexturesByKey!: Texture[];

    heightMapTexture!: Texture;

    private drawCallsByKey!: DrawCallRange[];

    drawCallNpc!: DrawCallRange;

    private readonly tickState: WebGLMapSquareTickState;
    private disposed = false;

    // Actual cache texture IDs used by this renderable (optional; used for texture residency).
    usedTextureIds?: Int32Array;

    constructor(
        readonly id: number,

        readonly borderSize: number,
        readonly tileRenderFlags: Uint8Array[][],

        readonly timeLoaded: number,
        readonly frameLoaded: number,
    ) {
        this.tickState = new WebGLMapSquareTickState();
    }

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

    createAnimatedLocs(
        time: number,
        data: SdRenderableData,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ) {
        const { locsAnimated, seqIds } = buildLocsAnimated(data, seqTypeLoader, time);
        this.tickState.setLocsAnimated(locsAnimated);
        this.initLocAnimationPatchData(seqFrameLoader, seqIds);
    }

    private initLocAnimationPatchData(seqFrameLoader: SeqFrameLoader, seqIds: number[]): void {
        this.tickState.initLocAnimationPatchData(seqFrameLoader, seqIds);
    }

    syncLocAnimationFrameIds(): void {
        this.tickState.syncLocAnimationFrameIds();
    }

    ensureCppTickStateInitializedFromObjects(): boolean {
        return this.tickState.ensureCppTickStateInitializedFromObjects();
    }

    resetCppTickStateLifecycle(): void {
        this.tickState.resetCppTickStateLifecycle();
    }

    getLocDrawRangeIndicesForPass(
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): Int32Array {
        return this.tickState.getLocDrawRangeIndicesForPass(isAlpha, isInteract, isLod);
    }

    createNpcs(
        data: SdRenderableData,
        npcTypeLoader: NpcTypeLoader,
        basTypeLoader: BasTypeLoader,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        createDrawCall: CreateDrawCallFunction,
        npcProgram: Program,
    ) {
        const npcs = buildNpcs(data, npcTypeLoader, basTypeLoader);
        this.tickState.setNpcs(npcs);

        const drawRangesNpc = buildNpcDrawRanges(npcs, data.npcDrawRangesBase);
        this.drawCallNpc = createDrawCall(
            npcProgram,
            undefined,
            drawRangesNpc,
            this.npcVertexArray !== undefined,
        );

        this.initNpcAnimationPatchData(
            seqTypeLoader,
            seqFrameLoader,
            data.npcDrawRangesBase,
            data.npcDrawRangesAlpha,
        );
    }

    private initNpcAnimationPatchData(
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        packetDrawRangesBase?: Int32Array,
        packetDrawRangesAlpha?: Int32Array,
    ): void {
        this.tickState.initNpcAnimationPatchData(
            seqTypeLoader,
            seqFrameLoader,
            packetDrawRangesBase,
            packetDrawRangesAlpha,
        );
    }

    syncNpcAnimationSelection(isAlpha: boolean): void {
        this.tickState.syncNpcAnimationSelection(isAlpha);
    }

    syncNpcMovementStateFromObjects(): void {
        this.tickState.syncNpcMovementStateFromObjects();
    }

    syncNpcPathStateFromObjects(): void {
        this.tickState.syncNpcPathStateFromObjects();
    }

    syncNpcSequenceSelectionForUpdate(): void {
        this.tickState.syncNpcSequenceSelectionForUpdate();
    }

    getTickCapability(): TickCapability | undefined {
        return this;
    }

    getLocsAnimated(): ReadonlyArray<LocAnimated> {
        return this.tickState.getLocsAnimated();
    }

    getLocFrameId(locIndex: number): number {
        return this.tickState.getLocFrameId(locIndex);
    }

    setLocFrameId(locIndex: number, frameId: number): void {
        this.tickState.setLocFrameId(locIndex, frameId);
    }

    getNpcs(): ReadonlyArray<Npc> {
        return this.tickState.getNpcs();
    }

    getWasmTickStateInput(): DrawRangeTickStateInput {
        return this.tickState.getWasmTickStateInput();
    }

    applyWasmTickResult(_result: TickPatchBackendResult): void {
        this.tickState.applyWasmTickResult(_result);
    }

    private static isAlphaKey(key: DrawCallKey): boolean {
        return (
            key === DrawCallKey.Alpha ||
            key === DrawCallKey.LodAlpha ||
            key === DrawCallKey.InteractAlpha ||
            key === DrawCallKey.InteractLodAlpha
        );
    }

    private static getModelInfoBucketByKey(
        modelInfoTextures: SdRenderableData["modelInfoTextures"],
        key: DrawCallKey,
    ): Uint16Array {
        switch (key) {
            case DrawCallKey.Base:
                return modelInfoTextures.base;
            case DrawCallKey.Alpha:
                return modelInfoTextures.alpha;
            case DrawCallKey.Lod:
                return modelInfoTextures.lod;
            case DrawCallKey.LodAlpha:
                return modelInfoTextures.lodAlpha;
            case DrawCallKey.Interact:
                return modelInfoTextures.interact;
            case DrawCallKey.InteractAlpha:
                return modelInfoTextures.interactAlpha;
            case DrawCallKey.InteractLod:
                return modelInfoTextures.interactLod;
            case DrawCallKey.InteractLodAlpha:
                return modelInfoTextures.interactLodAlpha;
        }
        return modelInfoTextures.base;
    }

    private static getDrawRangesByKey(
        drawRanges: SdRenderableData["drawRanges"],
        key: DrawCallKey,
    ): Int32Array {
        switch (key) {
            case DrawCallKey.Base:
                return drawRanges.base;
            case DrawCallKey.Alpha:
                return drawRanges.alpha;
            case DrawCallKey.Lod:
                return drawRanges.lod;
            case DrawCallKey.LodAlpha:
                return drawRanges.lodAlpha;
            case DrawCallKey.Interact:
                return drawRanges.interact;
            case DrawCallKey.InteractAlpha:
                return drawRanges.interactAlpha;
            case DrawCallKey.InteractLod:
                return drawRanges.interactLod;
            case DrawCallKey.InteractLodAlpha:
                return drawRanges.interactLodAlpha;
        }
        return drawRanges.base;
    }

    createModelInfoTextures(app: PicoApp, data: SdRenderableData) {
        const textures = new Array<Texture>(DRAW_CALL_KEY_COUNT);
        for (let i = 0; i < DRAW_CALL_KEY_COUNT; i++) {
            const key = i as DrawCallKey;
            textures[i] = createModelInfoTexture(
                app,
                WebGLRenderable.getModelInfoBucketByKey(data.modelInfoTextures, key),
            );
        }
        this.modelInfoTexturesByKey = textures;
    }

    createDrawCalls(
        data: SdRenderableData,
        createDrawCall: CreateDrawCallFunction,
        mainProgram: Program,
        mainAlphaProgram: Program,
    ) {
        const drawCalls = new Array<DrawCallRange>(DRAW_CALL_KEY_COUNT);
        for (let i = 0; i < DRAW_CALL_KEY_COUNT; i++) {
            const key = i as DrawCallKey;
            drawCalls[i] = createDrawCall(
                WebGLRenderable.isAlphaKey(key) ? mainAlphaProgram : mainProgram,
                this.modelInfoTexturesByKey[i],
                WebGLRenderable.getDrawRangesByKey(data.drawRanges, key),
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
                ? (isAlpha ? DrawCallKey.InteractLodAlpha : DrawCallKey.InteractLod)
                : (isAlpha ? DrawCallKey.InteractAlpha : DrawCallKey.Interact);
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
