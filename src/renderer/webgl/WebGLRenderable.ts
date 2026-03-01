import { vec2 } from "gl-matrix";
import PicoGL, {
    DrawCall,
    App as PicoApp,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { Scene } from "../../rs/scene/Scene";
import { DrawRange, NULL_DRAW_RANGE } from "../DrawRange";
import { RenderableType } from "../Renderer";
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

const DRAW_RANGE_STRIDE = 3;
const DRAW_RANGE_OFFSET_INDEX = 0;
const DRAW_RANGE_ELEMENTS_INDEX = 1;
const DRAW_RANGE_INSTANCES_INDEX = 2;

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

    modelInfoTexture!: Texture;
    modelInfoTextureAlpha!: Texture;

    modelInfoTextureLod!: Texture;
    modelInfoTextureLodAlpha!: Texture;

    modelInfoTextureInteract!: Texture;
    modelInfoTextureInteractAlpha!: Texture;

    modelInfoTextureInteractLod!: Texture;
    modelInfoTextureInteractLodAlpha!: Texture;

    heightMapTexture!: Texture;

    drawCall!: DrawCallRange;
    drawCallAlpha!: DrawCallRange;

    drawCallLod!: DrawCallRange;
    drawCallLodAlpha!: DrawCallRange;

    drawCallInteract!: DrawCallRange;
    drawCallInteractAlpha!: DrawCallRange;

    drawCallInteractLod!: DrawCallRange;
    drawCallInteractLodAlpha!: DrawCallRange;

    drawCallNpc!: DrawCallRange;

    private readonly tickState: WebGLMapSquareTickState;

    // Actual cache texture IDs used by this renderable (optional; used for texture residency).
    usedTextureIds?: Int32Array;

    static load(
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        npcTypeLoader: NpcTypeLoader,
        basTypeLoader: BasTypeLoader,
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        textureSlotLut: Texture,
        sceneUniformBuffer: UniformBuffer,
        data: SdRenderableData,
        time: number,
        frame: number,
    ): WebGLRenderable {
        const { ids, type } = data;

        const mapPos = vec2.fromValues(0, 0);
        const heightMapSize = 0;

        // const time = performance.now() * 0.001;

        const createDrawCall: CreateDrawCallFunction = (
            program: Program,
            modelInfoTexture: Texture | undefined,
            drawRangesPacked: Int32Array,
            useNpcGeometry?: boolean,
        ): DrawCallRange => {
            const drawRangeCount = (drawRangesPacked.length / DRAW_RANGE_STRIDE) | 0;
            const drawRangeArgs = new Array<DrawRange>(drawRangeCount);
            for (let i = 0; i < drawRangeCount; i++) {
                const off = i * DRAW_RANGE_STRIDE;
                drawRangeArgs[i] = [
                    drawRangesPacked[off + DRAW_RANGE_OFFSET_INDEX] | 0,
                    drawRangesPacked[off + DRAW_RANGE_ELEMENTS_INDEX] | 0,
                    drawRangesPacked[off + DRAW_RANGE_INSTANCES_INDEX] | 0,
                ];
            }
            const drawCall = app
                .createDrawCall(
                    program,
                    useNpcGeometry && renderable.npcVertexArray
                        ? renderable.npcVertexArray
                        : renderable.vertexArray,
                )
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", time)
                .uniform("u_mapPos", mapPos)
                // .uniform("u_drawIdOffset", drawIdOffset)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
                .texture("u_textureSlotLut", textureSlotLut)
                .texture("u_heightMap", renderable.heightMapTexture)
                .drawRanges(...drawRangeArgs);

            if (modelInfoTexture) {
                drawCall.texture("u_modelInfoTexture", modelInfoTexture);
            }

            return {
                drawCall,
                drawRangesPacked,
            };
        };

        const renderable = new WebGLRenderable(
            type,
            ids,
            data.borderSize,
            data.tileRenderFlags,
            time,
            frame,
        );
        renderable.createBuffers(app, data);
        renderable.createNpcGeometryBuffers(app, data);
        renderable.createHeightMapTexture(app, new Int16Array(), heightMapSize);
        renderable.createModelInfoTextures(app, data);
        renderable.createDrawCalls(data, createDrawCall, mainProgram, mainAlphaProgram);
        renderable.createAnimatedLocs(time, data, seqTypeLoader, seqFrameLoader);
        renderable.createNpcs(
            data,
            npcTypeLoader,
            basTypeLoader,
            seqTypeLoader,
            seqFrameLoader,
            createDrawCall,
            npcProgram,
        );

        return renderable;
    }

    constructor(
        readonly type: RenderableType,
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

    createModelInfoTextures(app: PicoApp, data: SdRenderableData) {
        this.modelInfoTexture = createModelInfoTexture(app, data.modelInfoTextures.base);
        this.modelInfoTextureAlpha = createModelInfoTexture(app, data.modelInfoTextures.alpha);

        this.modelInfoTextureLod = createModelInfoTexture(app, data.modelInfoTextures.lod);
        this.modelInfoTextureLodAlpha = createModelInfoTexture(
            app,
            data.modelInfoTextures.lodAlpha,
        );

        this.modelInfoTextureInteract = createModelInfoTexture(
            app,
            data.modelInfoTextures.interact,
        );
        this.modelInfoTextureInteractAlpha = createModelInfoTexture(
            app,
            data.modelInfoTextures.interactAlpha,
        );

        this.modelInfoTextureInteractLod = createModelInfoTexture(
            app,
            data.modelInfoTextures.interactLod,
        );
        this.modelInfoTextureInteractLodAlpha = createModelInfoTexture(
            app,
            data.modelInfoTextures.interactLodAlpha,
        );
    }

    createDrawCalls(
        data: SdRenderableData,
        createDrawCall: CreateDrawCallFunction,
        mainProgram: Program,
        mainAlphaProgram: Program,
    ) {
        this.drawCall = createDrawCall(mainProgram, this.modelInfoTexture, data.drawRanges.base);
        this.drawCallAlpha = createDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureAlpha,
            data.drawRanges.alpha,
        );

        this.drawCallLod = createDrawCall(
            mainProgram,
            this.modelInfoTextureLod,
            data.drawRanges.lod,
        );
        this.drawCallLodAlpha = createDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureLodAlpha,
            data.drawRanges.lodAlpha,
        );

        this.drawCallInteract = createDrawCall(
            mainProgram,
            this.modelInfoTextureInteract,
            data.drawRanges.interact,
        );
        this.drawCallInteractAlpha = createDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureInteractAlpha,
            data.drawRanges.interactAlpha,
        );

        this.drawCallInteractLod = createDrawCall(
            mainProgram,
            this.modelInfoTextureInteractLod,
            data.drawRanges.interactLod,
        );
        this.drawCallInteractLodAlpha = createDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureInteractLodAlpha,
            data.drawRanges.interactLodAlpha,
        );
    }

    canRender(frameCount: number): boolean {
        return frameCount - this.frameLoaded > FRAME_RENDER_DELAY;
    }

    getDrawCallKey(isAlpha: boolean, isInteract: boolean, isLod: boolean): DrawCallKey {
        if (isInteract) {
            if (isLod) {
                return isAlpha ? DrawCallKey.InteractLodAlpha : DrawCallKey.InteractLod;
            }
            return isAlpha ? DrawCallKey.InteractAlpha : DrawCallKey.Interact;
        }
        if (isLod) {
            return isAlpha ? DrawCallKey.LodAlpha : DrawCallKey.Lod;
        }
        return isAlpha ? DrawCallKey.Alpha : DrawCallKey.Base;
    }

    getDrawCallByKey(key: DrawCallKey): DrawCallRange {
        switch (key) {
            case DrawCallKey.Base:
                return this.drawCall;
            case DrawCallKey.Alpha:
                return this.drawCallAlpha;
            case DrawCallKey.Lod:
                return this.drawCallLod;
            case DrawCallKey.LodAlpha:
                return this.drawCallLodAlpha;
            case DrawCallKey.Interact:
                return this.drawCallInteract;
            case DrawCallKey.InteractAlpha:
                return this.drawCallInteractAlpha;
            case DrawCallKey.InteractLod:
                return this.drawCallInteractLod;
            case DrawCallKey.InteractLodAlpha:
                return this.drawCallInteractLodAlpha;
        }
        return this.drawCall;
    }

    getDrawCall(isAlpha: boolean, isInteract: boolean, isLod: boolean): DrawCallRange {
        return this.getDrawCallByKey(this.getDrawCallKey(isAlpha, isInteract, isLod));
    }

    delete() {
        this.vertexArray.delete();
        this.interleavedBuffer.delete();
        this.indexBuffer.delete();

        this.heightMapTexture.delete();

        // Model info
        this.modelInfoTexture.delete();
        this.modelInfoTextureAlpha.delete();

        this.modelInfoTextureLod.delete();
        this.modelInfoTextureLodAlpha.delete();

        this.modelInfoTextureInteract.delete();
        this.modelInfoTextureInteractAlpha.delete();

        this.modelInfoTextureInteractLod.delete();
        this.modelInfoTextureInteractLodAlpha.delete();
    }
}
