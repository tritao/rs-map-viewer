import PicoGL, {
    DrawCall,
    App as PicoApp,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { DrawRange } from "../../renderer/DrawRange";
import { Scene } from "../../rs/scene/Scene";
import { EditorMapData } from "./loader/EditorMapData";
import { RendererMapSquare } from "../../renderer/MapRenderer";
import { LocAnimated } from "../../renderer/loc/LocAnimated";
import { Npc } from "../../renderer/npc/Npc";
import { CollisionMap } from "../../rs/scene/CollisionMap";
import { getMapSquareId } from "../../rs/map/MapFileIndex";

export function createHeightMapTexture(
    app: PicoApp,
    borderSize: number,
    heightMapTextureData: Float32Array,
): Texture {
    const heightMapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;
    return app.createTextureArray(
        heightMapTextureData,
        heightMapSize,
        heightMapSize,
        Scene.MAX_LEVELS,
        {
            internalFormat: PicoGL.R32F,
            minFilter: PicoGL.LINEAR,
            magFilter: PicoGL.LINEAR,
            type: PicoGL.FLOAT,
            wrapS: PicoGL.CLAMP_TO_EDGE,
            wrapT: PicoGL.CLAMP_TO_EDGE,
        },
    );
}

export class WebGLEditorMapSquare implements RendererMapSquare {
    readonly id: number;

    readonly collisionMaps: CollisionMap[] = [];
    readonly locsAnimated: LocAnimated[] = [];
    readonly npcs: Npc[] = [];

    static create(
        app: PicoApp,
        mapData: EditorMapData,
        sceneUniformBuffer: UniformBuffer,
        textures: Texture,
        materialsTexture: Texture,
        terrainProgram: Program,
    ): WebGLEditorMapSquare {
        const { mapX, mapY, borderSize } = mapData;

        const terrainVertexBuffer = app.createInterleavedBuffer(8, mapData.vertices);
        const terrainVertexArray = app
            .createVertexArray()
            .vertexAttributeBuffer(0, terrainVertexBuffer, {
                type: PicoGL.UNSIGNED_SHORT,
                size: 4,
                stride: 8,
                integer: true as any,
            });

        const heightMapTexture = createHeightMapTexture(
            app,
            borderSize,
            mapData.heightMapTextureData,
        );

        const terrainDrawCall = app
            .createDrawCall(terrainProgram, terrainVertexArray)
            .uniformBlock("SceneUniforms", sceneUniformBuffer)
            .uniform("u_mapX", mapX)
            .uniform("u_mapY", mapY)
            .texture("u_textures", textures)
            .texture("u_materials", materialsTexture)
            .texture("u_heightMap", heightMapTexture);

        return new WebGLEditorMapSquare(
            mapX,
            mapY,
            borderSize,
            terrainVertexBuffer,
            terrainVertexArray,
            terrainDrawCall,
            mapData.terrainDrawRanges,
            heightMapTexture,
            mapData.heightMapTextureData,
        );
    }

    canRender(frameCount: number): boolean {
        return true;
    }

    delete(): void {
        this.terrainVertexBuffer.delete();
        this.terrainVertexArray.delete();
        this.heightMapTexture.delete();
    }

    constructor(
        readonly mapX: number,
        readonly mapY: number,
        readonly borderSize: number,
        readonly terrainVertexBuffer: VertexBuffer,
        readonly terrainVertexArray: VertexArray,
        readonly terrainDrawCall: DrawCall,
        readonly terrainDrawRanges: DrawRange[],
        public heightMapTexture: Texture,
        public heightMapTextureData: Float32Array,
    ) {
        this.id = getMapSquareId(mapX, mapY);
    }

    updateHeightMapTexture(app: PicoApp): void {
        this.heightMapTexture.delete();

        this.heightMapTexture = createHeightMapTexture(
            app,
            this.borderSize,
            this.heightMapTextureData,
        );
        this.terrainDrawCall.texture("u_heightMap", this.heightMapTexture);
    }
}
