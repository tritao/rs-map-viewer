import { vec2 } from "gl-matrix";
import { App as PicoApp, Program, Texture, UniformBuffer } from "picogl";

import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { Scene } from "../../rs/scene/Scene";
import { MapSquareRenderable } from "../MapRenderer";
import type { NpcGpuDataTarget } from "../npc/NpcGpuData";
import { SdMapData } from "../loader/SdMapData";
import { CreateDrawCallFunction, DrawCallRange, WebGLRenderable } from "./WebGLRenderable";
import type { TickCapability } from "../patch/TickCapability";
import { MapSquareTickState } from "../../sim/tick/MapSquareTickState";
import { buildMapSquareTickState } from "../../sim/tick/MapSquareTickStateBuilder";

export class WebGLMapSquare
    extends WebGLRenderable
    implements MapSquareRenderable
{
    drawCallNpc!: DrawCallRange;
    private readonly tickState: MapSquareTickState;
    private readonly npcGpuDataTarget: NpcGpuDataTarget;

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
        data: SdMapData,
        time: number,
        frame: number,
    ): WebGLMapSquare {
        const { mapX, mapY, borderSize } = data;
        const mapId = getMapSquareId(mapX, mapY);

        const mapPos = vec2.fromValues(mapX, mapY);
        const heightMapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;
        const tickStateBuild = buildMapSquareTickState(
            mapId,
            data,
            seqTypeLoader,
            seqFrameLoader,
            npcTypeLoader,
            basTypeLoader,
            time,
        );

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
            tickStateBuild.tickState,
        );
        renderable.createBuffers(app, data);
        renderable.createNpcGeometryBuffers(app, data);
        renderable.createHeightMapTexture(app, data.heightMapTextureData, heightMapSize);
        renderable.createModelInfoTextures(app, data);
        renderable.createDrawCalls(data, createDrawCall, mainProgram, mainAlphaProgram);
        renderable.drawCallNpc = createDrawCall(
            npcProgram,
            undefined,
            tickStateBuild.npcDrawRanges,
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
        tickState: MapSquareTickState,
    ) {
        const mapId = getMapSquareId(mapX, mapY);
        super(
            mapId,
            borderSize,
            tileRenderFlags,
            timeLoaded,
            frameLoaded,
        );
        this.tickState = tickState;
        this.npcGpuDataTarget = {
            id: mapId,
            getNpcs: () => this.tickState.getNpcs(),
            getTileRenderFlag: (level: number, tileX: number, tileY: number): number =>
                this.getTileRenderFlag(level, tileX, tileY),
        };
    }

    getMapDistance(mapX: number, mapY: number): number {
        return Math.max(Math.abs(mapX - this.mapX), Math.abs(mapY - this.mapY));
    }

    getNpcGpuDataTarget(): NpcGpuDataTarget | undefined {
        return this.npcGpuDataTarget;
    }

    getMapTickState(): TickCapability | undefined {
        return this.tickState;
    }
}
