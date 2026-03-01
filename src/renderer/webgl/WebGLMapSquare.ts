import { vec2 } from "gl-matrix";
import { App as PicoApp, Program, Texture, UniformBuffer } from "picogl";

import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { Scene } from "../../rs/scene/Scene";
import { MapSquareRenderable } from "../MapRenderer";
import { SdMapData } from "../../maprender/payload/SdMapData";
import { CreateDrawCallFunction, DrawCallRange, WebGLRenderable } from "./WebGLRenderable";

export class WebGLMapSquare
    extends WebGLRenderable
    implements MapSquareRenderable
{
    drawCallNpc!: DrawCallRange;

    private static buildDefaultNpcDrawRanges(npcCount: number): Int32Array {
        const drawRangesNpc = new Int32Array((npcCount | 0) * 3);
        for (let i = 0; i < npcCount; i++) {
            const off = i * 3;
            drawRangesNpc[off + 0] = 0;
            drawRangesNpc[off + 1] = 0;
            drawRangesNpc[off + 2] = 1;
        }
        return drawRangesNpc;
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
        ): DrawCallRange => {
            const drawRangeCount = (drawRangesPacked.length / 3) | 0;
            const drawRangeArgs = new Array<[number, number, number]>(drawRangeCount);
            for (let i = 0; i < drawRangeCount; i++) {
                const off = i * 3;
                drawRangeArgs[i] = [
                    drawRangesPacked[off + 0] | 0,
                    drawRangesPacked[off + 1] | 0,
                    drawRangesPacked[off + 2] | 0,
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
        renderable.createHeightMapTexture(app, data.heightMapTextureData, heightMapSize);
        renderable.createModelInfoTextures(app, data);
        renderable.createDrawCalls(data, createDrawCall, mainProgram, mainAlphaProgram);
        const npcDrawRanges = data.npcDrawRangesBase
            ? data.npcDrawRangesBase
            : WebGLMapSquare.buildDefaultNpcDrawRanges(data.npcs.length | 0);
        renderable.drawCallNpc = createDrawCall(
            npcProgram,
            undefined,
            npcDrawRanges,
            renderable.npcVertexArray !== undefined,
        );
        renderable.usedTextureIds = data.usedTextureIds;

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
        super(
            mapId,
            borderSize,
            tileRenderFlags,
            timeLoaded,
            frameLoaded,
        );
    }

    getMapDistance(mapX: number, mapY: number): number {
        return Math.max(Math.abs(mapX - this.mapX), Math.abs(mapY - this.mapY));
    }
}
