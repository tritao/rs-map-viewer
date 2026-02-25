import { ObjSpawn } from "../../data/obj/ObjSpawn";
import { LocType } from "../../rs/config/loctype/LocType";
import { NpcType } from "../../rs/config/npctype/NpcType";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { Model } from "../../rs/model/Model";
import { Scene } from "../../rs/scene/Scene";
import { LocEntity } from "../../rs/scene/entity/LocEntity";
import { LocModelLoader } from "../../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../rs/scene/model/NpcModelLoader";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import { AnimationFrames } from "../AnimationFrames";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import { RenderableType } from "../Renderer";
import { ModelHashBuffer } from "../buffer/ModelHashBuffer";
import { ContourGroundType, SceneBuffer, SceneModel } from "../buffer/SceneBuffer";
import {
    buildDrawRangesFromBuckets,
    buildModelInfoTexturesFromBuckets,
    collectRuntimeDrawCommandBuckets,
} from "../buffer/SceneCommandBuilder";
import { emitSceneModelsToSceneBuffer } from "../buffer/SceneCommandPlan";
import { LocAnimatedGroup } from "../loc/LocAnimatedGroup";
import { NpcData } from "../npc/NpcData";
import {
    SdRenderableData,
    SdRenderableDrawRanges,
    SdRenderableModelInfoTextures,
} from "./SdRenderableData";
import { SdRenderableLoaderInput } from "./SdRenderableLoaderInput";
import { createSdTexturePacking } from "./SdTexturePacking";

function addLocAnimationFrames(
    locModelLoader: LocModelLoader,
    seqTypeLoader: SeqTypeLoader,
    sceneBuf: SceneBuffer,
    entity: LocEntity,
    locType: LocType,
): AnimationFrames | undefined {
    const seqResult = seqTypeLoader.tryLoad(entity.seqId);
    if (!seqResult.ok) {
        return undefined;
    }
    const seqType = seqResult.value;
    let frameCount: number;
    if (seqType.hasAnimMayaSeq()) {
        frameCount = seqType.getAnimMayaDuration();
    } else {
        if (!seqType.frameIds) {
            return undefined;
        }
        frameCount = seqType.frameIds.length;
    }
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = locModelLoader.getModelAnimated(
            locType,
            entity.type,
            entity.rotation,
            entity.seqId,
            i,
        );
        if (model) {
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

export function addNpcAnimationFrames(
    npcModelLoader: NpcModelLoader,
    seqTypeLoader: SeqTypeLoader,
    sceneBuf: SceneBuffer,
    npcType: NpcType,
    seqId: number,
): AnimationFrames | undefined {
    const seqResult = seqTypeLoader.tryLoad(seqId);
    if (!seqResult.ok) {
        return undefined;
    }
    const seqType = seqResult.value;
    let frameCount: number;
    if (seqType.hasAnimMayaSeq()) {
        frameCount = seqType.getAnimMayaDuration();
    } else {
        if (!seqType.frameIds) {
            return undefined;
        }
        frameCount = seqType.frameIds.length;
    }
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = npcModelLoader.getModel(npcType, seqId, i);
        if (model) {
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

export class SdRenderableDataLoader
    implements RenderDataLoader<SdRenderableLoaderInput, SdRenderableData | undefined>
{
    __type = "sdRenderableDataLoader" as const;

    modelHashBuf?: ModelHashBuffer;

    init(): void {
        if (!this.modelHashBuf) {
            this.modelHashBuf = new ModelHashBuffer(5000);
        }
    }

    async load(
        state: WorkerState,
        { type, ids: ids, loadedTextureIds }: SdRenderableLoaderInput,
    ): Promise<RenderDataResult<SdRenderableData | undefined>> {
        this.init();

        const loaders = state.session.loaders;
        const locTypeLoader = loaders.locTypeLoader;
        const npcTypeLoader = loaders.npcTypeLoader;
        const basTypeLoader = loaders.basTypeLoader;
        const seqTypeLoader = loaders.seqTypeLoader;
        const textureLoader = loaders.textureLoader;

        const modelLoader = loaders.modelLoader;
        const locModelLoader = state.locModelLoader;
        const npcModelLoader = state.npcModelLoader;

        const id = ids[0];

        const { textureIdIndexMap } = createSdTexturePacking(textureLoader);

        const scene = new Scene(1, 0, 0);

        const sceneBuf = new SceneBuffer(textureLoader, new Map(textureIdIndexMap), 100000);

        const npcs: NpcData[] = [];
        if (type == RenderableType.NPC) {
            for (const npcId of [id]) {
                const npcResult = npcTypeLoader.tryLoad(npcId);
                if (!npcResult.ok) {
                    continue;
                }
                const npcType = npcResult.value;

                const idleSeqId = npcType.getIdleSeqId(basTypeLoader);
                const walkSeqId = npcType.getWalkSeqId(basTypeLoader);

                if (idleSeqId === -1) {
                    continue;
                }

                const idleAnim = addNpcAnimationFrames(
                    npcModelLoader,
                    seqTypeLoader,
                    sceneBuf,
                    npcType,
                    idleSeqId,
                );
                let walkAnim = idleAnim;
                if (walkSeqId !== -1 && walkSeqId !== idleSeqId) {
                    walkAnim = addNpcAnimationFrames(
                        npcModelLoader,
                        seqTypeLoader,
                        sceneBuf,
                        npcType,
                        walkSeqId,
                    );
                }

                npcs.push({
                    id: npcId,
                    tileX: 0,
                    tileY: 0,
                    level: 0,
                    idleAnim,
                    walkAnim,
                });
            }
        }

        if (type == RenderableType.Model) {
            const modelData = modelLoader.tryGet(id);
            if (modelData == null) {
                console.log("cannot load model data for model id", id);
            }

            const model = modelData!.light(textureLoader, 0 + 64, 0 + 768, -50, -10, -50);

            const sceneModels: SceneModel[] = [
                {
                    sceneX: 0,
                    sceneZ: 0,
                    heightOffset: 0,
                    level: 0,
                    contourGround: ContourGroundType.NONE,
                    priority: 0,
                    interactType: InteractType.NONE,
                    interactId: 0,
                    model: model,
                    sceneHeight: 0,
                    lowDetail: false,
                    forceMerge: false,
                },
            ];

            let minimizeDrawCalls = false;
            emitSceneModelsToSceneBuffer(
                this.modelHashBuf!,
                textureLoader,
                sceneBuf,
                sceneModels,
                minimizeDrawCalls,
            ); //;
        }

        const locAnimatedGroups: LocAnimatedGroup[] = [];
        const locsAnimated = sceneBuf.addLocAnimatedGroups(locAnimatedGroups);
        console.log(`animated locs: ${locsAnimated.length}`);

        const drawRanges = SdRenderableDataLoader.getDrawRanges(sceneBuf, id);

        const modelInfoTextures = SdRenderableDataLoader.getModelInfoTextures(sceneBuf);

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = new Int32Array(sceneBuf.indices);

        const loadedTextures = new Map<number, Int32Array>();
        for (const textureId of sceneBuf.usedTextureIds) {
            if (!loadedTextureIds.has(textureId)) {
                const pixels = textureLoader.tryGetPixelsArgb(textureId, 128, true, 1.0);
                if (pixels) {
                    loadedTextures.set(textureId, pixels);
                }
            }
        }

        console.timeEnd(`load model ${id}`);

        const transferables = [
            ...Array.from(loadedTextures.values()).map((pixels) => pixels.buffer),

            vertices.buffer,
            indices.buffer,

            modelInfoTextures.base.buffer,
            modelInfoTextures.alpha.buffer,

            modelInfoTextures.lod.buffer,
            modelInfoTextures.lodAlpha.buffer,

            modelInfoTextures.interact.buffer,
            modelInfoTextures.interactAlpha.buffer,

            modelInfoTextures.interactLod.buffer,
            modelInfoTextures.interactLodAlpha.buffer,
        ];

        const totalBytes = transferables.reduce((sum, buf) => sum + buf.byteLength, 0);

        console.log(
            `total bytes: ${totalBytes} ${id}`,
            sceneBuf.usedTextureIds,
            loadedTextures.size,
        );

        return {
            data: {
                type: type,
                ids: id,

                cacheName: state.session.cache.info.name,

                borderSize: 0,
                tileRenderFlags: scene.tileRenderFlags,
                collisionDatas: scene.collisionMaps,

                vertices,
                indices,

                modelInfoTextures,

                drawRanges,

                locsAnimated,
                npcs,

                loadedTextures,
            },
            transferables,
        };
    }

    static getModelInfoTextures(sceneBuf: SceneBuffer): SdRenderableModelInfoTextures {
        return buildModelInfoTexturesFromBuckets(collectRuntimeDrawCommandBuckets(sceneBuf));
    }

    static getDrawRanges(sceneBuf: SceneBuffer, ...args: any[]): SdRenderableDrawRanges {
        const drawRanges = buildDrawRangesFromBuckets(collectRuntimeDrawCommandBuckets(sceneBuf));
        const { base, alpha, lod, lodAlpha, interact } = drawRanges;

        console.log(`draw ranges: ${base.length / 3}, alpha: ${alpha.length / 3}`, args);
        console.log(`draw ranges lod: ${lod.length / 3}, alpha: ${lodAlpha.length / 3}`, args);
        console.log(`draw ranges interact: ${interact.length / 3}`, args);
        return drawRanges;
    }

    reset(): void {
        this.modelHashBuf = undefined;
    }
}
