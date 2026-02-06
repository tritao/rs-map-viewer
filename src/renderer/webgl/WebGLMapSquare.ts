import { vec2 } from "gl-matrix";
import {
    App as PicoApp,
    Program,
    Texture,
    UniformBuffer,
} from "picogl";

import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { CollisionFlag } from "../../rs/pathfinder/flag/CollisionFlag";
import { CollisionMap } from "../../rs/scene/CollisionMap";
import { Scene } from "../../rs/scene/Scene";
import { DrawRange } from "../DrawRange";
import { SdMapData } from "../loader/SdMapData";
import { MapSquareRenderable } from "../MapRenderer";
import { RenderableType } from "../Renderer";
import { CreateDrawCallFunction, DrawCallRange, WebGLRenderable } from "./WebGLRenderable";

export class WebGLMapSquare extends WebGLRenderable implements MapSquareRenderable {
    static load(
        seqTypeLoader: SeqTypeLoader,
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

        const mapPos = vec2.fromValues(mapX, mapY);
        const heightMapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        const createDrawCall: CreateDrawCallFunction = (
            program: Program,
            modelInfoTexture: Texture | undefined,
            drawRanges: DrawRange[],
        ): DrawCallRange => {
            const drawCall = app
                .createDrawCall(program, renderable.vertexArray)
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", time)
                .uniform("u_mapPos", mapPos)
                // .uniform("u_drawIdOffset", drawIdOffset)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
                .texture("u_textureSlotLut", textureSlotLut)
                .texture("u_heightMap", renderable.heightMapTexture)
                .drawRanges(...drawRanges);

            if (modelInfoTexture) {
                drawCall.texture("u_modelInfoTexture", modelInfoTexture);
            }

            return {
                drawCall,
                drawRanges,
            };
        };

        const collisionMaps = data.collisionDatas.map(CollisionMap.fromData);

        const renderable = new WebGLMapSquare(mapX, mapY, borderSize, data.tileRenderFlags,
            collisionMaps, time, frame);
        renderable.createBuffers(app, data);
        renderable.createHeightMapTexture(app, data.heightMapTextureData, heightMapSize);
        renderable.createModelInfoTextures(app, data);
        renderable.createDrawCalls(data, createDrawCall, mainProgram, mainAlphaProgram);
        renderable.createAnimatedLocs(time, data, seqTypeLoader);
        renderable.createNpcs(data, npcTypeLoader, basTypeLoader, createDrawCall, npcProgram);
        renderable.processNpcsCollisions();
        renderable.usedTextureIds = data.usedTextureIds;

        return renderable;
    }

    constructor(
        readonly mapX: number,
        readonly mapY: number,

        readonly borderSize: number,
        readonly tileRenderFlags: Uint8Array[][],
        readonly collisionMaps: CollisionMap[],

        readonly timeLoaded: number,
        readonly frameLoaded: number,
    ) {
        super(RenderableType.Map, getMapSquareId(mapX, mapY), borderSize,
            tileRenderFlags, collisionMaps, timeLoaded, frameLoaded);
    }

    processNpcsCollisions() {
        for (const npc of this.npcs) {
            const collisionMap = this.collisionMaps[npc.level];

            const currentX = npc.pathX[0];
            const currentY = npc.pathY[0];

            const size = npc.getSize();

            for (let flagX = currentX; flagX < currentX + size; flagX++) {
                for (let flagY = currentY; flagY < currentY + size; flagY++) {
                    collisionMap.flag(
                        flagX + this.borderSize,
                        flagY + this.borderSize,
                        CollisionFlag.BLOCK_NPCS,
                    );
                }
            }
        }
    }

    getMapDistance(mapX: number, mapY: number): number {
        return Math.max(Math.abs(mapX - this.mapX), Math.abs(mapY - this.mapY));
    }
}
