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
        return this.drawCallsByKey[key as number] ?? this.drawCallsByKey[DrawCallKey.Base];
    }

    getDrawCall(isAlpha: boolean, isInteract: boolean, isLod: boolean): DrawCallRange {
        return this.getDrawCallByKey(this.getDrawCallKey(isAlpha, isInteract, isLod));
    }

    delete() {
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
    }
}
