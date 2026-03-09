import { vec2 } from "gl-matrix";
import PicoGL, {
    App as PicoApp,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import type { ObjRenderData, SdMapData } from "../../maprender/MapRenderPayload";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { Scene } from "../../rs/scene/Scene";
import { MapSquareRenderable } from "../MapRenderer";
import { createSceneDrawCall } from "./WebGLDrawCallUtil";
import { CreateDrawCallFunction, DrawCallRange, WebGLSceneResources } from "./WebGLSceneResources";

const HIDDEN_MODEL_INFO_WORD2 = 0xffc0;
const HIDDEN_MODEL_INFO_WORD3 = 0xffff;

type DynamicObjChunk = Readonly<{
    runtimeObjId: number;
    vertexArray: VertexArray;
    interleavedBuffer: VertexBuffer;
    indexBuffer: VertexBuffer;
    modelInfoTexturesByKey: Texture[];
    drawCallsByKey: DrawCallRange[];
    usedTextureIds?: Int32Array;
}>;

function createDynamicModelInfoTexture(app: PicoApp, data: Uint16Array): Texture {
    return app.createTexture2D(data, 16, Math.max(Math.ceil(data.length / 16 / 4), 1), {
        internalFormat: PicoGL.RGBA16UI,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
    });
}

function cloneObjRenderDataWithHiddenState(
    objRenderData: ObjRenderData | undefined,
    hiddenObjIndicesPacked: Int32Array | undefined,
): ObjRenderData | undefined {
    if (!objRenderData) {
        return undefined;
    }
    if (!(hiddenObjIndicesPacked instanceof Int32Array) || (hiddenObjIndicesPacked.length | 0) <= 0) {
        return objRenderData;
    }
    const modelInfoTextures = {
        base: objRenderData.modelInfoTextures.base.slice(),
        alpha: objRenderData.modelInfoTextures.alpha.slice(),
        lod: objRenderData.modelInfoTextures.lod.slice(),
        lodAlpha: objRenderData.modelInfoTextures.lodAlpha.slice(),
        interact: objRenderData.modelInfoTextures.interact.slice(),
        interactAlpha: objRenderData.modelInfoTextures.interactAlpha.slice(),
        interactLod: objRenderData.modelInfoTextures.interactLod.slice(),
        interactLodAlpha: objRenderData.modelInfoTextures.interactLodAlpha.slice(),
    };
    for (let hiddenIndex = 0; hiddenIndex < hiddenObjIndicesPacked.length; hiddenIndex++) {
        const objIndex = hiddenObjIndicesPacked[hiddenIndex] | 0;
        for (const key of Object.keys(modelInfoTextures) as Array<keyof typeof modelInfoTextures>) {
            const modelInfoIndex = objRenderData.modelInfoIndices[key][objIndex] | 0;
            if (modelInfoIndex < 0) {
                continue;
            }
            const texelOffset = (modelInfoIndex | 0) * 4;
            modelInfoTextures[key][texelOffset + 2] = HIDDEN_MODEL_INFO_WORD2;
            modelInfoTextures[key][texelOffset + 3] = HIDDEN_MODEL_INFO_WORD3;
        }
    }
    return {
        ...objRenderData,
        modelInfoTextures,
    };
}

export class WebGLMapSquare extends WebGLSceneResources implements MapSquareRenderable {
    drawCallNpc!: DrawCallRange;
    private baseUsedTextureIds: Int32Array = new Int32Array(0);
    private objUsedTextureIds: Int32Array | undefined;
    private dynamicObjUsedTextureIds: Int32Array | undefined;
    private currentStaticObjRenderData: ObjRenderData | undefined;
    private currentDynamicObjRenderData: ObjRenderData | undefined;
    private hiddenStaticObjIndicesPacked: Int32Array | undefined;
    private readonly dynamicObjChunksByRuntimeObjId = new Map<number, DynamicObjChunk>();

    static unionUsedTextureIds(
        base: Int32Array,
        extra: Int32Array | undefined,
    ): Int32Array {
        if (!(extra instanceof Int32Array) || extra.length <= 0) {
            return base;
        }
        const merged = new Set<number>();
        for (let i = 0; i < base.length; i++) {
            merged.add(base[i] | 0);
        }
        for (let i = 0; i < extra.length; i++) {
            merged.add(extra[i] | 0);
        }
        return Int32Array.from(merged);
    }

    static load(
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        textureSlotLut: Texture,
        sceneUniformBuffer: UniformBuffer,
        data: SdMapData,
        staticObjRenderData: ObjRenderData | undefined,
        dynamicObjRenderData: ObjRenderData | undefined,
        hiddenStaticObjIndicesPacked: Int32Array | undefined,
        time: number,
        frame: number,
    ): WebGLMapSquare {
        const { mapX, mapY, borderSize } = data;

        const mapPos = vec2.fromValues(mapX, mapY);
        const heightMapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        const createDrawCall: CreateDrawCallFunction = (
            program: Program,
            modelInfoTexture: Texture | undefined,
            drawRangesPacked: Int32Array,
            useNpcGeometry?: boolean,
            useObjGeometry?: boolean,
            useDynamicObjGeometry?: boolean,
        ): DrawCallRange => {
            const drawCall = createSceneDrawCall(app, {
                program,
                vertexArray:
                    useDynamicObjGeometry && renderable.dynamicObjVertexArray
                        ? renderable.dynamicObjVertexArray
                        : useObjGeometry && renderable.objVertexArray
                        ? renderable.objVertexArray
                        : useNpcGeometry && renderable.npcVertexArray
                        ? renderable.npcVertexArray
                        : renderable.vertexArray,
                sceneUniformBuffer,
                timeLoaded: time,
                mapPos,
                textureArray,
                textureMaterials,
                textureSlotLut,
                drawRangesPacked,
                modelInfoTexture,
                heightMapTexture: renderable.heightMapTexture,
            });
            return {
                drawCall,
                drawRangesPacked,
            };
        };

        const renderable = new WebGLMapSquare(
            mapX,
            mapY,
            borderSize,
            data.tileRenderFlags,
            time,
            frame,
        );
        const visibleStaticObjRenderData = cloneObjRenderDataWithHiddenState(
            staticObjRenderData,
            hiddenStaticObjIndicesPacked,
        );
        renderable.currentStaticObjRenderData = staticObjRenderData;
        renderable.currentDynamicObjRenderData = dynamicObjRenderData;
        renderable.hiddenStaticObjIndicesPacked = hiddenStaticObjIndicesPacked;
        renderable.createBuffers(app, data);
        renderable.createNpcGeometryBuffers(app, data);
        renderable.createObjGeometryBuffers(app, staticObjRenderData);
        renderable.createDynamicObjGeometryBuffers(app, dynamicObjRenderData);
        renderable.createHeightMapTexture(app, data.heightMapTextureData, heightMapSize);
        renderable.createModelInfoTextures(app, data);
        renderable.createObjModelInfoTextures(app, visibleStaticObjRenderData);
        renderable.createDynamicObjModelInfoTextures(app, dynamicObjRenderData);
        renderable.createDrawCalls(data, createDrawCall, mainProgram, mainAlphaProgram);
        renderable.createObjDrawCalls(
            visibleStaticObjRenderData,
            createDrawCall,
            mainProgram,
            mainAlphaProgram,
        );
        renderable.createDynamicObjDrawCalls(
            dynamicObjRenderData,
            createDrawCall,
            mainProgram,
            mainAlphaProgram,
        );
        const npcDrawRanges =
            renderable.npcVertexArray !== undefined
                ? data.npcDrawRangesBase
                    ? data.npcDrawRangesBase
                    : new Int32Array(0)
                : new Int32Array(0);
        renderable.drawCallNpc = createDrawCall(
            npcProgram,
            undefined,
            npcDrawRanges,
            renderable.npcVertexArray !== undefined,
        );
        renderable.baseUsedTextureIds = data.usedTextureIds;
        renderable.objUsedTextureIds = staticObjRenderData?.usedTextureIds;
        renderable.dynamicObjUsedTextureIds = dynamicObjRenderData?.usedTextureIds;
        renderable.usedTextureIds = WebGLMapSquare.unionUsedTextureIds(
            WebGLMapSquare.unionUsedTextureIds(
                renderable.baseUsedTextureIds,
                renderable.objUsedTextureIds,
            ),
            renderable.dynamicObjUsedTextureIds,
        );

        return renderable;
    }

    constructor(
        readonly mapX: number,
        readonly mapY: number,

        readonly borderSize: number,
        readonly tileRenderFlags: Uint8Array[][],

        readonly timeLoaded: number,
        readonly frameLoaded: number,
    ) {
        const mapId = getMapSquareId(mapX, mapY);
        super(mapId, borderSize, tileRenderFlags, timeLoaded, frameLoaded);
    }

    getMapDistance(mapX: number, mapY: number): number {
        return Math.max(Math.abs(mapX - this.mapX), Math.abs(mapY - this.mapY));
    }

    private createDynamicChunk(
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        textureSlotLut: Texture,
        sceneUniformBuffer: UniformBuffer,
        runtimeObjId: number,
        objRenderData: ObjRenderData,
    ): DynamicObjChunk {
        const interleavedBuffer = app.createInterleavedBuffer(16, objRenderData.vertices);
        const indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, objRenderData.indices);
        const vertexArray = app
            .createVertexArray()
            .vertexAttributeBuffer(
                0,
                interleavedBuffer,
                { type: PicoGL.UNSIGNED_INT, size: 4, stride: 16, integer: true } as never,
            )
            .indexBuffer(indexBuffer);
        const textureKeys = Object.keys(objRenderData.modelInfoTextures) as Array<
            keyof typeof objRenderData.modelInfoTextures
        >;
        const modelInfoTexturesByKey = textureKeys.map((key) =>
            createDynamicModelInfoTexture(app, objRenderData.modelInfoTextures[key]),
        );
        const drawRangeBuckets = [
            objRenderData.drawRanges.base,
            objRenderData.drawRanges.alpha,
            objRenderData.drawRanges.lod,
            objRenderData.drawRanges.lodAlpha,
            objRenderData.drawRanges.interact,
            objRenderData.drawRanges.interactAlpha,
            objRenderData.drawRanges.interactLod,
            objRenderData.drawRanges.interactLodAlpha,
        ];
        const drawCallsByKey = drawRangeBuckets.map((drawRangesPacked, index) =>
            createSceneDrawCall(app, {
                program:
                    index === 1 || index === 3 || index === 5 || index === 7
                        ? mainAlphaProgram
                        : mainProgram,
                vertexArray,
                sceneUniformBuffer,
                timeLoaded: this.timeLoaded,
                mapPos: vec2.fromValues(this.mapX, this.mapY),
                textureArray,
                textureMaterials,
                textureSlotLut,
                drawRangesPacked,
                modelInfoTexture: modelInfoTexturesByKey[index],
                heightMapTexture: this.heightMapTexture,
            })
        ).map((drawCall, index) => ({
            drawCall,
            drawRangesPacked: drawRangeBuckets[index]!,
        }));
        return {
            runtimeObjId: runtimeObjId | 0,
            vertexArray,
            interleavedBuffer,
            indexBuffer,
            modelInfoTexturesByKey,
            drawCallsByKey,
            usedTextureIds: objRenderData.usedTextureIds,
        };
    }

    private deleteDynamicChunk(chunk: DynamicObjChunk | undefined): void {
        if (!chunk) {
            return;
        }
        chunk.vertexArray.delete();
        chunk.interleavedBuffer.delete();
        chunk.indexBuffer.delete();
        for (let index = 0; index < chunk.modelInfoTexturesByKey.length; index++) {
            chunk.modelInfoTexturesByKey[index]!.delete();
        }
    }

    private refreshUsedTextureIds(): void {
        let usedTextureIds = WebGLMapSquare.unionUsedTextureIds(
            WebGLMapSquare.unionUsedTextureIds(this.baseUsedTextureIds, this.objUsedTextureIds),
            this.dynamicObjUsedTextureIds,
        );
        for (const chunk of this.dynamicObjChunksByRuntimeObjId.values()) {
            usedTextureIds = WebGLMapSquare.unionUsedTextureIds(usedTextureIds, chunk.usedTextureIds);
        }
        this.usedTextureIds = usedTextureIds;
    }

    override getObjDrawCall(
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): ReadonlyArray<DrawCallRange> {
        const drawCalls = [...super.getObjDrawCall(isAlpha, isInteract, isLod)];
        const keyIndex =
            isInteract
                ? isLod
                    ? isAlpha
                        ? 7
                        : 6
                    : isAlpha
                    ? 5
                    : 4
                : isLod
                ? isAlpha
                    ? 3
                    : 2
                : isAlpha
                ? 1
                : 0;
        for (const chunk of this.dynamicObjChunksByRuntimeObjId.values()) {
            const drawCall = chunk.drawCallsByKey[keyIndex];
            if (drawCall) {
                drawCalls.push(drawCall);
            }
        }
        return drawCalls;
    }

    replaceObjRenderData(
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        textureSlotLut: Texture,
        sceneUniformBuffer: UniformBuffer,
        update: Readonly<{
            replaceStaticObjRenderData: boolean;
            staticObjRenderData?: ObjRenderData;
            hiddenStaticObjIndicesPacked?: Int32Array;
            replaceDynamicObjRenderData: boolean;
            dynamicObjRenderData?: ObjRenderData;
            appendDynamicObjRenders?: ReadonlyArray<{
                runtimeObjId: number;
                interactId: number;
                objRenderData: ObjRenderData;
            }>;
            removeDynamicRuntimeObjIdsPacked?: Int32Array;
            clearDynamicObjRenderData: boolean;
        }>,
    ): void {
        if (update.replaceStaticObjRenderData) {
            this.currentStaticObjRenderData = update.staticObjRenderData;
        }
        if (update.replaceDynamicObjRenderData) {
            this.currentDynamicObjRenderData = update.dynamicObjRenderData;
        }
        if (update.clearDynamicObjRenderData) {
            for (const chunk of this.dynamicObjChunksByRuntimeObjId.values()) {
                this.deleteDynamicChunk(chunk);
            }
            this.dynamicObjChunksByRuntimeObjId.clear();
        }
        if (update.removeDynamicRuntimeObjIdsPacked) {
            for (let index = 0; index < update.removeDynamicRuntimeObjIdsPacked.length; index++) {
                const runtimeObjId = update.removeDynamicRuntimeObjIdsPacked[index] | 0;
                const chunk = this.dynamicObjChunksByRuntimeObjId.get(runtimeObjId);
                this.deleteDynamicChunk(chunk);
                this.dynamicObjChunksByRuntimeObjId.delete(runtimeObjId);
            }
        }
        if (update.hiddenStaticObjIndicesPacked !== undefined) {
            this.hiddenStaticObjIndicesPacked = update.hiddenStaticObjIndicesPacked;
        }
        const staticObjRenderData = this.currentStaticObjRenderData;
        const dynamicObjRenderData = this.currentDynamicObjRenderData;
        const visibleStaticObjRenderData = cloneObjRenderDataWithHiddenState(
            staticObjRenderData,
            this.hiddenStaticObjIndicesPacked,
        );
        const createDrawCall: CreateDrawCallFunction = (
            program: Program,
            modelInfoTexture: Texture | undefined,
            drawRangesPacked: Int32Array,
            _useNpcGeometry?: boolean,
            useObjGeometry?: boolean,
            useDynamicObjGeometry?: boolean,
        ): DrawCallRange => {
            const drawCall = createSceneDrawCall(app, {
                program,
                vertexArray:
                    useDynamicObjGeometry && this.dynamicObjVertexArray
                        ? this.dynamicObjVertexArray
                        : useObjGeometry && this.objVertexArray
                        ? this.objVertexArray
                        : this.vertexArray,
                sceneUniformBuffer,
                timeLoaded: this.timeLoaded,
                mapPos: vec2.fromValues(this.mapX, this.mapY),
                textureArray,
                textureMaterials,
                textureSlotLut,
                drawRangesPacked,
                modelInfoTexture,
                heightMapTexture: this.heightMapTexture,
            });
            return { drawCall, drawRangesPacked };
        };
        if (update.replaceStaticObjRenderData) {
            this.objVertexArray?.delete();
            this.objInterleavedBuffer?.delete();
            this.objIndexBuffer?.delete();
            this.createObjGeometryBuffers(app, staticObjRenderData);
        } else {
            for (const texture of this.objModelInfoTexturesByKey ?? []) {
                texture.delete();
            }
            this.objModelInfoTexturesByKey = [];
            this.objDrawCallsByKey = [];
        }
        if (update.replaceDynamicObjRenderData) {
            this.dynamicObjVertexArray?.delete();
            this.dynamicObjInterleavedBuffer?.delete();
            this.dynamicObjIndexBuffer?.delete();
            this.createDynamicObjGeometryBuffers(app, dynamicObjRenderData);
        } else {
            for (const texture of this.dynamicObjModelInfoTexturesByKey ?? []) {
                texture.delete();
            }
            this.dynamicObjModelInfoTexturesByKey = [];
            this.dynamicObjDrawCallsByKey = [];
        }
        this.createObjModelInfoTextures(app, visibleStaticObjRenderData);
        this.createObjDrawCalls(
            visibleStaticObjRenderData,
            createDrawCall,
            mainProgram,
            mainAlphaProgram,
        );
        this.createDynamicObjModelInfoTextures(app, dynamicObjRenderData);
        this.createDynamicObjDrawCalls(
            dynamicObjRenderData,
            createDrawCall,
            mainProgram,
            mainAlphaProgram,
        );
        this.objUsedTextureIds = staticObjRenderData?.usedTextureIds;
        this.dynamicObjUsedTextureIds = dynamicObjRenderData?.usedTextureIds;
        const appendDynamicObjRenders = update.appendDynamicObjRenders;
        if (appendDynamicObjRenders) {
            for (let index = 0; index < appendDynamicObjRenders.length; index++) {
                const append = appendDynamicObjRenders[index];
                if (!append) {
                    continue;
                }
                const previous = this.dynamicObjChunksByRuntimeObjId.get(append.runtimeObjId | 0);
                this.deleteDynamicChunk(previous);
                this.dynamicObjChunksByRuntimeObjId.set(
                    append.runtimeObjId | 0,
                    this.createDynamicChunk(
                        app,
                        mainProgram,
                        mainAlphaProgram,
                        textureArray,
                        textureMaterials,
                        textureSlotLut,
                        sceneUniformBuffer,
                        append.runtimeObjId | 0,
                        append.objRenderData,
                    ),
                );
            }
        }
        this.refreshUsedTextureIds();
    }

    override delete(): void {
        for (const chunk of this.dynamicObjChunksByRuntimeObjId.values()) {
            this.deleteDynamicChunk(chunk);
        }
        this.dynamicObjChunksByRuntimeObjId.clear();
        super.delete();
    }
}
