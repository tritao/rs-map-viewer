import { vec2 } from "gl-matrix";
import { App as PicoApp, Program, Texture, UniformBuffer } from "picogl";

import type { ObjRenderData, SdMapData } from "../../maprender/MapRenderPayload";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { Scene } from "../../rs/scene/Scene";
import { MapSquareRenderable } from "../MapRenderer";
import { createSceneDrawCall } from "./WebGLDrawCallUtil";
import { CreateDrawCallFunction, DrawCallRange, WebGLSceneResources } from "./WebGLSceneResources";

export class WebGLMapSquare extends WebGLSceneResources implements MapSquareRenderable {
    drawCallNpc!: DrawCallRange;
    private baseUsedTextureIds: Int32Array = new Int32Array(0);
    private objUsedTextureIds: Int32Array | undefined;

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
        objRenderData: ObjRenderData | undefined,
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
        ): DrawCallRange => {
            const drawCall = createSceneDrawCall(app, {
                program,
                vertexArray:
                    useObjGeometry && renderable.objVertexArray
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
        renderable.createBuffers(app, data);
        renderable.createNpcGeometryBuffers(app, data);
        renderable.createObjGeometryBuffers(app, objRenderData);
        renderable.createHeightMapTexture(app, data.heightMapTextureData, heightMapSize);
        renderable.createModelInfoTextures(app, data);
        renderable.createObjModelInfoTextures(app, objRenderData);
        renderable.createDrawCalls(data, createDrawCall, mainProgram, mainAlphaProgram);
        renderable.createObjDrawCalls(objRenderData, createDrawCall, mainProgram, mainAlphaProgram);
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
        renderable.objUsedTextureIds = objRenderData?.usedTextureIds;
        renderable.usedTextureIds = WebGLMapSquare.unionUsedTextureIds(
            renderable.baseUsedTextureIds,
            renderable.objUsedTextureIds,
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

    replaceObjRenderData(
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        textureSlotLut: Texture,
        sceneUniformBuffer: UniformBuffer,
        objRenderData: ObjRenderData | undefined,
    ): void {
        this.resetObjRenderData();
        const createDrawCall: CreateDrawCallFunction = (
            program: Program,
            modelInfoTexture: Texture | undefined,
            drawRangesPacked: Int32Array,
            _useNpcGeometry?: boolean,
            useObjGeometry?: boolean,
        ): DrawCallRange => {
            const drawCall = createSceneDrawCall(app, {
                program,
                vertexArray:
                    useObjGeometry && this.objVertexArray ? this.objVertexArray : this.vertexArray,
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
        this.createObjGeometryBuffers(app, objRenderData);
        this.createObjModelInfoTextures(app, objRenderData);
        this.createObjDrawCalls(objRenderData, createDrawCall, mainProgram, mainAlphaProgram);
        this.objUsedTextureIds = objRenderData?.usedTextureIds;
        this.usedTextureIds = WebGLMapSquare.unionUsedTextureIds(
            this.baseUsedTextureIds,
            this.objUsedTextureIds,
        );
    }
}
