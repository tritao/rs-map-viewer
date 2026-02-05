import { ObjSpawn } from "../../data/obj/ObjSpawn";
import { LocType } from "../../rs/config/loctype/LocType";
import { NpcType } from "../../rs/config/npctype/NpcType";
import { Model } from "../../rs/model/Model";
import { Scene } from "../../rs/scene/Scene";
import { LocEntity } from "../../rs/scene/entity/LocEntity";
import { LocModelLoader } from "../../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../../rs/scene/model/ObjModelLoader";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import { AnimationFrames } from "../AnimationFrames";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
import { RenderableType } from "../Renderer";
import { ModelHashBuffer, getModelHash } from "../buffer/ModelHashBuffer";
import {
    ContourGroundType,
    DrawCommand,
    ModelFace,
    ModelMergeGroup,
    SceneBuffer,
    SceneModel,
    createModelInfoTextureData,
    getModelFaces,
    isModelFaceTransparent,
} from "../buffer/SceneBuffer";
import { LocAnimatedGroup } from "../loc/LocAnimatedGroup";
import { NpcData } from "../npc/NpcData";
import {
    SdRenderableData,
    SdRenderableDrawRanges,
    SdRenderableModelInfoTextures,
} from "./SdRenderableData";
import { SdRenderableLoaderInput } from "./SdRenderableLoaderInput";

function createModelGroups(
    modelGroupMap: Map<number, ModelMergeGroup>,
    sceneModels: SceneModel[],
    transparent: boolean,
): void {
    for (const sceneModel of sceneModels) {
        const key =
            Number(transparent) |
            ((sceneModel.lowDetail ? 1 : 0) << 1) |
            (sceneModel.level << 2) |
            (sceneModel.priority << 4);

        const group = modelGroupMap.get(key);
        if (group) {
            group.models.push(sceneModel);
        } else {
            modelGroupMap.set(key, {
                transparent,
                lowDetail: sceneModel.lowDetail,
                level: sceneModel.level,
                priority: sceneModel.priority,
                models: [sceneModel],
            });
        }
    }
}

function addSceneModels(
    modelHashBuf: ModelHashBuffer,
    textureLoader: TextureLoader,
    sceneBuf: SceneBuffer,
    sceneModels: SceneModel[],
    minimizeDrawCalls: boolean,
): void {
    const groupedModels = new Map<number, SceneModel[]>();
    for (const sceneModel of sceneModels) {
        const model = sceneModel.model;
        const hash = getModelHash(modelHashBuf, model);
        const locs = groupedModels.get(hash);
        if (locs) {
            locs.push(sceneModel);
        } else {
            groupedModels.set(hash, [sceneModel]);
        }
    }

    const modelGroupMap: Map<number, ModelMergeGroup> = new Map();
    for (const sceneModels of groupedModels.values()) {
        const model = sceneModels[0].model;
        const faces = getModelFaces(model);

        const opaqueFaces: ModelFace[] = [];
        const transparentFaces: ModelFace[] = [];
        for (const face of faces) {
            if (isModelFaceTransparent(textureLoader, face)) {
                transparentFaces.push(face);
            } else {
                opaqueFaces.push(face);
            }
        }

        const mergeModels: SceneModel[] = [];
        const instancedModels: SceneModel[] = [];
        const lodModels: SceneModel[] = [];
        for (const sceneModel of sceneModels) {
            if (sceneModel.forceMerge) {
                mergeModels.push(sceneModel);
            } else {
                instancedModels.push(sceneModel);
                if (!sceneModel.lowDetail) {
                    lodModels.push(sceneModel);
                }
            }
        }

        createModelGroups(modelGroupMap, mergeModels, false);
        if (transparentFaces.length > 0) {
            createModelGroups(modelGroupMap, mergeModels, true);
        }

        const instanceCount = instancedModels.length;
        const mergeOpaque =
            instanceCount === 1 || instanceCount * opaqueFaces.length < 100 || minimizeDrawCalls;
        const mergeTransparent =
            instanceCount === 1 ||
            instanceCount * transparentFaces.length < 100 ||
            minimizeDrawCalls;

        // mergeOpaque = false;
        // mergeTransparent = false;

        if (mergeOpaque) {
            createModelGroups(modelGroupMap, instancedModels, false);
        } else if (opaqueFaces.length > 0) {
            const indexOffset = sceneBuf.indexByteOffset();
            sceneBuf.addModel(model, opaqueFaces);
            const elementCount = (sceneBuf.indexByteOffset() - indexOffset) / 4;

            const drawCommand: DrawCommand = {
                offset: indexOffset,
                elements: elementCount,
                instances: sceneModels,
            };

            sceneBuf.drawCommands.push(drawCommand);
            sceneBuf.drawCommandsInteract.push(drawCommand);
            if (lodModels.length > 0) {
                const drawCommandLod: DrawCommand = {
                    offset: indexOffset,
                    elements: elementCount,
                    instances: lodModels,
                };
                sceneBuf.drawCommandsLod.push(drawCommandLod);
                sceneBuf.drawCommandsInteractLod.push(drawCommandLod);
            }
        }

        if (mergeTransparent && transparentFaces.length > 0) {
            createModelGroups(modelGroupMap, instancedModels, true);
        } else if (transparentFaces.length > 0) {
            const indexOffset = sceneBuf.indexByteOffset();
            sceneBuf.addModel(model, transparentFaces);
            const elementCount = (sceneBuf.indexByteOffset() - indexOffset) / 4;

            const drawCommand: DrawCommand = {
                offset: indexOffset,
                elements: elementCount,
                instances: sceneModels,
            };

            sceneBuf.drawCommandsAlpha.push(drawCommand);
            sceneBuf.drawCommandsInteractAlpha.push(drawCommand);
            if (lodModels.length > 0) {
                const drawCommandLod: DrawCommand = {
                    offset: indexOffset,
                    elements: elementCount,
                    instances: lodModels,
                };
                sceneBuf.drawCommandsLodAlpha.push(drawCommandLod);
                sceneBuf.drawCommandsInteractLodAlpha.push(drawCommandLod);
            }
        }
    }

    for (const group of modelGroupMap.values()) {
        sceneBuf.addModelGroup(group);
    }
}

function addLocAnimationFrames(
    locModelLoader: LocModelLoader,
    sceneBuf: SceneBuffer,
    entity: LocEntity,
    locType: LocType,
): AnimationFrames | undefined {
    const seqResult = locModelLoader.seqTypeLoader.tryLoad(entity.seqId);
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
    sceneBuf: SceneBuffer,
    npcType: NpcType,
    seqId: number,
): AnimationFrames | undefined {
    const seqResult = npcModelLoader.seqTypeLoader.tryLoad(seqId);
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

        const locTypeLoader = state.session.loaders.locTypeLoader;
        const npcTypeLoader = state.session.loaders.npcTypeLoader;
        const basTypeLoader = state.session.loaders.basTypeLoader;
        const textureLoader = state.session.loaders.textureLoader;

        const modelLoader = state.session.loaders.modelLoader;
        const locModelLoader = state.locModelLoader;
        const objModelLoader = state.objModelLoader;
        const npcModelLoader = state.npcModelLoader;

        const id = ids[0];

        let textureIds = textureLoader.getTextureIds().filter((id) => textureLoader.isSd(id));
        textureIds = textureIds.slice(0, 2047);
        const textureIdIndexMap = new Map<number, number>();
        for (let i = 0; i < textureIds.length; i++) {
            textureIdIndexMap.set(textureIds[i], i);
        }

        const scene = new Scene(1, 0, 0);

        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 100000);

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
                    sceneBuf,
                    npcType,
                    idleSeqId,
                );
                let walkAnim = idleAnim;
                if (walkSeqId !== -1 && walkSeqId !== idleSeqId) {
                    walkAnim = addNpcAnimationFrames(npcModelLoader, sceneBuf, npcType, walkSeqId);
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
            const modelData = modelLoader.getModel(id);
            if (modelData == null) {
                console.log("cannot load model data for model id", id);
            }

            const model = modelData!.light(
                objModelLoader.textureLoader,
                0 + 64,
                0 + 768,
                -50,
                -10,
                -50,
            );

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
            addSceneModels(
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
                try {
                    const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                    loadedTextures.set(textureId, pixels);
                } catch (e) {}
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
        const base = createModelInfoTextureData(sceneBuf.drawCommands);
        const alpha = createModelInfoTextureData(sceneBuf.drawCommandsAlpha);

        const lod = createModelInfoTextureData(sceneBuf.drawCommandsLod);
        const lodAlpha = createModelInfoTextureData(sceneBuf.drawCommandsLodAlpha);

        const interact = createModelInfoTextureData(sceneBuf.drawCommandsInteract);
        const interactAlpha = createModelInfoTextureData(sceneBuf.drawCommandsInteractAlpha);

        const interactLod = createModelInfoTextureData(sceneBuf.drawCommandsInteractLod);
        const interactLodAlpha = createModelInfoTextureData(sceneBuf.drawCommandsInteractLodAlpha);

        return {
            base,
            alpha,
            lod,
            lodAlpha,
            interact,
            interactAlpha,
            interactLod,
            interactLodAlpha,
        };
    }

    static getDrawRanges(sceneBuf: SceneBuffer, ...args: any[]): SdRenderableDrawRanges {
        // Normal (merged)
        const base = sceneBuf.drawCommands.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const alpha = sceneBuf.drawCommandsAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(`draw ranges: ${base.length}, alpha: ${alpha.length}`, args);

        // Lod (merged)
        const lod = sceneBuf.drawCommandsLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const lodAlpha = sceneBuf.drawCommandsLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(`draw ranges lod: ${lod.length}, alpha: ${lodAlpha.length}`, args);

        // Interact (non merged)
        const interact = sceneBuf.drawCommandsInteract.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const interactAlpha = sceneBuf.drawCommandsInteractAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(`draw ranges interact: ${interact.length}`, args);

        // Interact Lod (non merged)
        const interactLod = sceneBuf.drawCommandsInteractLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const interactLodAlpha = sceneBuf.drawCommandsInteractLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        return {
            base,
            alpha,
            lod,
            lodAlpha,
            interact,
            interactAlpha,
            interactLod,
            interactLodAlpha,
        };
    }

    reset(): void {
        this.modelHashBuf = undefined;
    }
}
