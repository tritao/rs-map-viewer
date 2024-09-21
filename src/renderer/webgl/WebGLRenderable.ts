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
import { CollisionMap } from "../../rs/scene/CollisionMap";
import { Scene } from "../../rs/scene/Scene";
import { DrawRange, newDrawRange } from "../DrawRange";
import { SdRenderableData } from "../loader/SdRenderableData";
import { LocAnimated } from "../loc/LocAnimated";
import { Npc } from "../npc/Npc";
import { DynamicNpcData, NpcData } from "../npc/NpcData";
import { RenderableType } from "../Renderer";
import { WebGLDynamicBuffers } from "./WebGLDynamicBuffers";

const FRAME_RENDER_DELAY = 3;

const NPC_DATA_TEXTURE_BUFFER_SIZE = 5;

function createModelInfoTexture(app: PicoApp, data: Uint16Array): Texture {
    return app.createTexture2D(data, 16, Math.max(Math.ceil(data.length / 16 / 4), 1), {
        internalFormat: PicoGL.RGBA16UI,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
    });
}

export type DrawCallRange = {
    drawCall: DrawCall;
    drawRanges: DrawRange[];
};

export type CreateDrawCallFunction = (program: Program,
    vertexArray: VertexArray,
    modelInfoTexture: Texture | undefined,
    drawRanges: DrawRange[]) => DrawCallRange;

export class WebGLRenderable {
    interleavedBuffer!: VertexBuffer;
    indexBuffer!: VertexBuffer;
    vertexArray!: VertexArray;

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
    drawCallDynamicNpc!: DrawCallRange;

    // Animated locs
    locsAnimated!: LocAnimated[];

    // Npcs
    npcs!: Npc[];
    dynamicNpcs!: Npc[];

    npcDataTextureOffsets!: number[];
    dynamicNpcDataTextureOffsets!: number[];

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
            vertexArray: VertexArray,
            modelInfoTexture: Texture | undefined,
            drawRanges: DrawRange[],
        ): DrawCallRange => {
            const drawCall = app
                .createDrawCall(program, vertexArray)
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", time)
                .uniform("u_mapPos", mapPos)
                // .uniform("u_drawIdOffset", drawIdOffset)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
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

        const renderable = new WebGLRenderable(type, ids, createDrawCall, npcProgram,
            data.borderSize, data.tileRenderFlags, data.tileHeights, collisionMaps, time, frame);
        renderable.createBuffers(app, data);
        renderable.createHeightMapTexture(app, new Int16Array(), heightMapSize);
        renderable.createModelInfoTextures(app, data);
        renderable.createDrawCalls(data, createDrawCall, mainProgram, mainAlphaProgram);
        renderable.createAnimatedLocs(time, data, seqTypeLoader);
        renderable.createNpcs(data.npcs, npcTypeLoader, basTypeLoader);

        return renderable;
    }

    constructor(
        readonly type: RenderableType,
        readonly id: number,

        readonly createDrawCall: CreateDrawCallFunction,
        readonly npcProgram: Program,

        readonly borderSize: number,
        readonly tileRenderFlags: Uint8Array[][],
        readonly tileHeights: Int32Array[][],
        readonly collisionMaps: CollisionMap[],

        readonly timeLoaded: number,
        readonly frameLoaded: number,
    ) {
        this.npcDataTextureOffsets = new Array(NPC_DATA_TEXTURE_BUFFER_SIZE).fill(-1);
        this.dynamicNpcDataTextureOffsets = new Array(NPC_DATA_TEXTURE_BUFFER_SIZE).fill(-1);
    }

    getTileRenderFlag(level: number, tileX: number, tileY: number): number {
        return this.tileRenderFlags[level][tileX + this.borderSize][tileY + this.borderSize];
    }

    getTileHeight(level: number, tileX: number, tileZ: number): number {
        return this.tileHeights[level][tileX + this.borderSize][tileZ + this.borderSize];
    }

    getHeight(level: number, x: number, z: number): number {
        const tileX = x | 0;
        const tileZ = z | 0;
        const dx = x - tileX;
        const dz = z - tileZ;

        const h00 = this.getTileHeight(level, tileX, tileZ);
        const h10 = this.getTileHeight(level, tileX + 1, tileZ);
        const h01 = this.getTileHeight(level, tileX, tileZ + 1);
        const h11 = this.getTileHeight(level, tileX + 1, tileZ + 1);

        const height =
            h00 + dx * (h10 - h00) + dz * (h01 - h00) + dx * dz * (h00 - h10 - h01 + h11);

        return height / 128;
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
            }
        );
    }

    createBuffers(app: PicoApp, data: SdRenderableData) {
        this.interleavedBuffer = app.createInterleavedBuffer(12, data.vertices);
        this.indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, data.indices);

        this.vertexArray = app
            .createVertexArray()
            // v0, v1, v2
            .vertexAttributeBuffer(0, this.interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(this.indexBuffer);
    }

    createAnimatedLocs(time: number, data: SdRenderableData, seqTypeLoader: SeqTypeLoader) {
        const cycle = time / 0.02;

        this.locsAnimated = [];
        for (const loc of data.locsAnimated) {
            const seqType = seqTypeLoader.load(loc.seqId);
            this.locsAnimated.push(
                new LocAnimated(
                    loc.drawRangeIndex,
                    loc.drawRangeAlphaIndex,

                    loc.drawRangeLodIndex,
                    loc.drawRangeLodAlphaIndex,

                    loc.drawRangeInteractIndex,
                    loc.drawRangeInteractAlphaIndex,

                    loc.drawRangeInteractLodIndex,
                    loc.drawRangeInteractLodAlphaIndex,

                    loc.anim,
                    seqType,
                    cycle,
                    loc.randomStart
                )
            );
        }
    }

    createNpcs(data: NpcData[], npcTypeLoader: NpcTypeLoader, basTypeLoader: BasTypeLoader) {
        this.npcs = [];
        for (const npc of data) {
            const npcType = npcTypeLoader.load(npc.id);

            this.npcs.push(
                new Npc(
                    npc.tileX,
                    npc.tileY,
                    npc.level,
                    npc.idleAnim,
                    npc.walkAnim,
                    npcType.getIdleSeqId(basTypeLoader),
                    npcType.getWalkSeqId(basTypeLoader),
                    npcType,
                )
            );
        }

        const drawRangesNpc = this.npcs.map((_npc) => newDrawRange(0, 0, 1));
        this.drawCallNpc = this.createDrawCall(
            this.npcProgram, this.vertexArray, undefined, drawRangesNpc);
    }

    clearDynamicNpcs() {
        this.dynamicNpcs = [];
    }

    addDynamicNpc(npc: DynamicNpcData) {
        // TODO: optimize array access

        const _npc = new Npc(
            npc.spawnX,
            npc.spawnY,
            npc.level,
            npc.idleAnim,
            npc.walkAnim,
            npc.walkAnimSeqId,
            npc.idleAnimSeqId,
            null,
        );
        _npc.rotation = npc.rotation;
        _npc.x = npc.x;
        _npc.y = npc.y;
        this.dynamicNpcs.push(_npc);
    }

    createDynamicNpcs(buffers: WebGLDynamicBuffers) {
        const drawRangesNpc = this.dynamicNpcs.map((_npc) => newDrawRange(0, 0, 1));
        this.drawCallDynamicNpc = this.createDrawCall(
            this.npcProgram, buffers.vertexArray, undefined, drawRangesNpc);
    }

    createModelInfoTextures(app: PicoApp, data: SdRenderableData) {
        this.modelInfoTexture = createModelInfoTexture(app, data.modelInfoTextures.base);
        this.modelInfoTextureAlpha = createModelInfoTexture(app, data.modelInfoTextures.alpha);

        this.modelInfoTextureLod = createModelInfoTexture(app, data.modelInfoTextures.lod);
        this.modelInfoTextureLodAlpha = createModelInfoTexture(
            app,
            data.modelInfoTextures.lodAlpha
        );

        this.modelInfoTextureInteract = createModelInfoTexture(
            app,
            data.modelInfoTextures.interact
        );
        this.modelInfoTextureInteractAlpha = createModelInfoTexture(
            app,
            data.modelInfoTextures.interactAlpha
        );

        this.modelInfoTextureInteractLod = createModelInfoTexture(
            app,
            data.modelInfoTextures.interactLod
        );
        this.modelInfoTextureInteractLodAlpha = createModelInfoTexture(
            app,
            data.modelInfoTextures.interactLodAlpha
        );
    }

    createDrawCalls(data: SdRenderableData, createDrawCall: CreateDrawCallFunction,
        mainProgram: Program, mainAlphaProgram: Program) {
        this.drawCall = createDrawCall(
            mainProgram,
            this.vertexArray,
            this.modelInfoTexture,
            data.drawRanges.base
        );

        this.drawCallAlpha = createDrawCall(
            mainAlphaProgram,
            this.vertexArray,
            this.modelInfoTextureAlpha,
            data.drawRanges.alpha
        );

        this.drawCallLod = createDrawCall(
            mainProgram, this.vertexArray,
            this.modelInfoTextureLod,
            data.drawRanges.lod
        );

        this.drawCallLodAlpha = createDrawCall(
            mainAlphaProgram,
            this.vertexArray,
            this.modelInfoTextureLodAlpha,
            data.drawRanges.lodAlpha
        );

        this.drawCallInteract = createDrawCall(
            mainProgram,
            this.vertexArray,
            this.modelInfoTextureInteract,
            data.drawRanges.interact
        );
        this.drawCallInteractAlpha = createDrawCall(
            mainAlphaProgram,
            this.vertexArray,
            this.modelInfoTextureInteractAlpha,
            data.drawRanges.interactAlpha
        );

        this.drawCallInteractLod = createDrawCall(
            mainProgram,
            this.vertexArray,
            this.modelInfoTextureInteractLod,
            data.drawRanges.interactLod
        );
        this.drawCallInteractLodAlpha = createDrawCall(
            mainAlphaProgram,
            this.vertexArray,
            this.modelInfoTextureInteractLodAlpha,
            data.drawRanges.interactLodAlpha
        );
    }

    canRender(frameCount: number): boolean {
        return frameCount - this.frameLoaded > FRAME_RENDER_DELAY;
    }

    getDrawCall(isAlpha: boolean, isInteract: boolean, isLod: boolean): DrawCallRange {
        if (isInteract) {
            if (isLod) {
                return isAlpha ? this.drawCallInteractLodAlpha : this.drawCallInteractLod;
            } else {
                return isAlpha ? this.drawCallInteractAlpha : this.drawCallInteract;
            }
        } else {
            if (isLod) {
                return isAlpha ? this.drawCallLodAlpha : this.drawCallLod;
            } else {
                return isAlpha ? this.drawCallAlpha : this.drawCall;
            }
        }
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
