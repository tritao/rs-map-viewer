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
import { DrawRange } from "../DrawRange";
import { SdModelData } from "../loader/SdModelData";
import { LocAnimated } from "../loc/LocAnimated";

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

export class WebGLModel {
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
        modelData: SdModelData,
        time: number,
        frame: number,
    ): WebGLModel {
        const { modelId, borderSize, tileRenderFlags } = modelData;

        const mapPos = vec2.fromValues(0, 0);

        const interleavedBuffer = app.createInterleavedBuffer(12, modelData.vertices);
        const indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, modelData.indices);

        const vertexArray = app
            .createVertexArray()
            // v0, v1, v2
            .vertexAttributeBuffer(0, interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 3,
                stride: 12,
                integer: true as any,
            })
            .indexBuffer(indexBuffer);

        const modelInfoTexture = createModelInfoTexture(app, modelData.modelTextureData);
        const modelInfoTextureAlpha = createModelInfoTexture(app, modelData.modelTextureDataAlpha);

        const modelInfoTextureLod = createModelInfoTexture(app, modelData.modelTextureDataLod);
        const modelInfoTextureLodAlpha = createModelInfoTexture(
            app,
            modelData.modelTextureDataLodAlpha,
        );

        const modelInfoTextureInteract = createModelInfoTexture(
            app,
            modelData.modelTextureDataInteract,
        );
        const modelInfoTextureInteractAlpha = createModelInfoTexture(
            app,
            modelData.modelTextureDataInteractAlpha,
        );

        const modelInfoTextureInteractLod = createModelInfoTexture(
            app,
            modelData.modelTextureDataInteractLod,
        );
        const modelInfoTextureInteractLodAlpha = createModelInfoTexture(
            app,
            modelData.modelTextureDataInteractLodAlpha,
        );

        // const time = performance.now() * 0.001;

        const createDrawCall = (
            program: Program,
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
                // .texture("u_modelInfoTexture", modelInfoTexture)
                .drawRanges(...drawRanges);
            if (modelInfoTexture) {
                drawCall.texture("u_modelInfoTexture", modelInfoTexture);
            }
            return {
                drawCall,
                drawRanges,
            };
        };

        const drawCall = createDrawCall(mainProgram, modelInfoTexture, modelData.drawRanges);
        const drawCallAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureAlpha,
            modelData.drawRangesAlpha,
        );

        const drawCallLod = createDrawCall(mainProgram, modelInfoTextureLod, modelData.drawRangesLod);
        const drawCallLodAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureLodAlpha,
            modelData.drawRangesLodAlpha,
        );

        const drawCallInteract = createDrawCall(
            mainProgram,
            modelInfoTextureInteract,
            modelData.drawRangesInteract,
        );
        const drawCallInteractAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureInteractAlpha,
            modelData.drawRangesInteractAlpha,
        );

        const drawCallInteractLod = createDrawCall(
            mainProgram,
            modelInfoTextureInteractLod,
            modelData.drawRangesInteractLod,
        );
        const drawCallInteractLodAlpha = createDrawCall(
            mainAlphaProgram,
            modelInfoTextureInteractLodAlpha,
            modelData.drawRangesInteractLodAlpha,
        );

        const cycle = time / 0.02;

        const locsAnimated: LocAnimated[] = [];
        for (const loc of modelData.locsAnimated) {
            const seqType = seqTypeLoader.load(loc.seqId);
            locsAnimated.push(
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
                    loc.randomStart,
                ),
            );
        }

        return new WebGLModel(
            modelId,

            time,
            frame,

            interleavedBuffer,
            indexBuffer,
            vertexArray,

            modelInfoTexture,
            modelInfoTextureAlpha,

            modelInfoTextureLod,
            modelInfoTextureLodAlpha,

            modelInfoTextureInteract,
            modelInfoTextureInteractAlpha,

            modelInfoTextureInteractLod,
            modelInfoTextureInteractLodAlpha,

            drawCall,
            drawCallAlpha,

            drawCallLod,
            drawCallLodAlpha,

            drawCallInteract,
            drawCallInteractAlpha,

            drawCallInteractLod,
            drawCallInteractLodAlpha,

            locsAnimated,
        );
    }

    constructor(
        readonly modelId: number,

        readonly timeLoaded: number,
        readonly frameLoaded: number,

        readonly interleavedBuffer: VertexBuffer,
        readonly indexBuffer: VertexBuffer,
        readonly vertexArray: VertexArray,

        // Model info
        readonly modelInfoTexture: Texture,
        readonly modelInfoTextureAlpha: Texture,

        readonly modelInfoTextureLod: Texture,
        readonly modelInfoTextureLodAlpha: Texture,

        readonly modelInfoTextureInteract: Texture,
        readonly modelInfoTextureInteractAlpha: Texture,

        readonly modelInfoTextureInteractLod: Texture,
        readonly modelInfoTextureInteractLodAlpha: Texture,

        // Draw calls
        readonly drawCall: DrawCallRange,
        readonly drawCallAlpha: DrawCallRange,

        readonly drawCallLod: DrawCallRange,
        readonly drawCallLodAlpha: DrawCallRange,

        readonly drawCallInteract: DrawCallRange,
        readonly drawCallInteractAlpha: DrawCallRange,

        readonly drawCallInteractLod: DrawCallRange,
        readonly drawCallInteractLodAlpha: DrawCallRange,

        // Animated locs
        readonly locsAnimated: LocAnimated[],
    ) {
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
