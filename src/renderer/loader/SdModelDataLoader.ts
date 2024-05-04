import { LocModelLoader } from "../../rs/config/loctype/LocModelLoader";
import { LocType } from "../../rs/config/loctype/LocType";
import { ObjModelLoader } from "../../rs/config/objtype/ObjModelLoader";
import { Model } from "../../rs/model/Model";
import { Scene } from "../../rs/scene/Scene";
import { LocEntity } from "../../rs/scene/entity/LocEntity";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
import { ObjSpawn } from "../../data/obj/ObjSpawn";
import { AnimationFrames } from "../AnimationFrames";
import { DrawRange, NULL_DRAW_RANGE, newDrawRange } from "../DrawRange";
import { InteractType } from "../InteractType";
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
import { SdModelLoaderInput } from "./SdModelLoaderInput";
import { SdModelData } from "./SdModelData";

function createObjSceneModels(
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawns: ObjSpawn[],
): void {
    for (const spawn of spawns) {
        createObjSceneModel(objModelLoader, sceneModels, scene, borderSize, spawn);
    }
}

function createObjSceneModel(
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawn: ObjSpawn,
): void {
    const objType = objModelLoader.objTypeLoader.load(spawn.id);
    if (objType.name === "null") {
        return;
    }

    const localX = spawn.x % 64;
    const localY = spawn.y % 64;

    const tileX = localX + borderSize;
    const tileY = localY + borderSize;

    const model = objModelLoader.getModel(spawn.id, spawn.count);
    if (!model) {
        return undefined;
    }

    let renderLevel = spawn.plane;
    if (renderLevel < 3 && (scene.tileRenderFlags[1][tileX][tileY] & 0x2) === 2) {
        renderLevel = spawn.plane + 1;
    }

    const sceneHeight = scene.getCenterHeight(renderLevel, tileX, tileY);

    let heightOffset = 0;
    const tile = scene.tiles[renderLevel][tileX][tileY];
    if (!tile || !tile.tileModel || tile.tileModel.faces.length === 0) {
        return undefined;
    }
    if (tile) {
        for (const loc of tile.locs) {
            if ((loc.flags & 256) === 256 && loc.entity instanceof Model) {
                const model = loc.entity;
                model.calculateBoundsCylinder();
                if (model.contourHeight > heightOffset) {
                    heightOffset = model.contourHeight;
                }
            }
        }
    }

    let contourGround = ContourGroundType.CENTER_TILE;

    if (heightOffset !== 0) {
        heightOffset -= sceneHeight;
        contourGround = ContourGroundType.NONE;
    }

    sceneModels.push({
        model,
        lowDetail: false,
        forceMerge: false,
        sceneHeight,
        sceneX: localX * 128 + 64,
        sceneZ: localY * 128 + 64,
        heightOffset,
        level: renderLevel,
        contourGround,
        priority: 10,
        interactType: InteractType.OBJ,
        interactId: spawn.id,
    });
}

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
    const seqType = locModelLoader.seqTypeLoader.load(entity.seqId);
    let frameCount: number;
    if (seqType.isSkeletalSeq()) {
        frameCount = seqType.getSkeletalDuration();
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

export class SdModelDataLoader implements RenderDataLoader<SdModelLoaderInput, SdModelData | undefined> {
    __type = "sdModelDataLoader" as const;

    modelHashBuf?: ModelHashBuffer;

    init(): void {
        if (!this.modelHashBuf) {
            this.modelHashBuf = new ModelHashBuffer(5000);
        }
    }

    async load(
        state: WorkerState,
        {
            modelId,
            loadedTextureIds,
        }: SdModelLoaderInput,
    ): Promise<RenderDataResult<SdModelData | undefined>> {
        console.time(`load model ${modelId}`);
        this.init();

        const locTypeLoader = state.locTypeLoader;
        const npcTypeLoader = state.npcTypeLoader;
        const basTypeLoader = state.basTypeLoader;
        const textureLoader = state.textureLoader;

        const modelLoader = state.modelLoader;
        const locModelLoader = state.locModelLoader;
        const objModelLoader = state.objModelLoader;
        const npcModelLoader = state.npcModelLoader;

        const varManager = state.varManager;

        let textureIds = textureLoader.getTextureIds().filter((id) => textureLoader.isSd(id));
        textureIds = textureIds.slice(0, 2047);
        const textureIdIndexMap = new Map<number, number>();
        for (let i = 0; i < textureIds.length; i++) {
            textureIdIndexMap.set(textureIds[i], i);
        }

        const borderSize = 6;

        const scene = new Scene(1, 0, 0);

        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 100000);

        const modelData = modelLoader.getModel(modelId);
        if (modelData == null) {
            console.log('cannot load model data for model id', modelId);
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
                forceMerge: false
            }];

        let minimizeDrawCalls = false;
        addSceneModels(this.modelHashBuf!, textureLoader, sceneBuf, sceneModels, minimizeDrawCalls)//;

        const locAnimatedGroups: LocAnimatedGroup[] = [];
        const locsAnimated = sceneBuf.addLocAnimatedGroups(locAnimatedGroups);
        console.log(`animated locs: ${locsAnimated.length}`);

        // Draw ranges

        // Normal (merged)
        const drawRanges = sceneBuf.drawCommands.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesAlpha = sceneBuf.drawCommandsAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(
            `draw ranges: ${drawRanges.length}, alpha: ${drawRangesAlpha.length}`,
            modelId,
        );

        // Lod (merged)
        const drawRangesLod = sceneBuf.drawCommandsLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesLodAlpha = sceneBuf.drawCommandsLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(
            `draw ranges lod: ${drawRangesLod.length}, alpha: ${drawRangesLodAlpha.length}`,
            modelId,
        );

        // Interact (non merged)
        const drawRangesInteract = sceneBuf.drawCommandsInteract.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractAlpha = sceneBuf.drawCommandsInteractAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        console.log(`draw ranges interact: ${drawRangesInteract.length}`, modelId);

        // Interact Lod (non merged)
        const drawRangesInteractLod = sceneBuf.drawCommandsInteractLod.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );
        const drawRangesInteractLodAlpha = sceneBuf.drawCommandsInteractLodAlpha.map((cmd) =>
            newDrawRange(cmd.offset, cmd.elements, cmd.instances.length),
        );

        // Model info textures
        const modelTextureData = createModelInfoTextureData(sceneBuf.drawCommands);
        const modelTextureDataAlpha = createModelInfoTextureData(sceneBuf.drawCommandsAlpha);

        const modelTextureDataLod = createModelInfoTextureData(sceneBuf.drawCommandsLod);
        const modelTextureDataLodAlpha = createModelInfoTextureData(sceneBuf.drawCommandsLodAlpha);

        const modelTextureDataInteract = createModelInfoTextureData(sceneBuf.drawCommandsInteract);
        const modelTextureDataInteractAlpha = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractAlpha,
        );

        const modelTextureDataInteractLod = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLod,
        );
        const modelTextureDataInteractLodAlpha = createModelInfoTextureData(
            sceneBuf.drawCommandsInteractLodAlpha,
        );

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = new Int32Array(sceneBuf.indices);

        const loadedTextures = new Map<number, Int32Array>();
        for (const textureId of sceneBuf.usedTextureIds) {
            if (!loadedTextureIds.has(textureId)) {
                try {
                    const pixels = textureLoader.getPixelsArgb(textureId, 128, true, 1.0);
                    loadedTextures.set(textureId, pixels);
                } catch (e) { }
            }
        }

        console.timeEnd(`load model ${modelId}`);

        const transferables = [
            ...Array.from(loadedTextures.values()).map((pixels) => pixels.buffer),

            vertices.buffer,
            indices.buffer,

            modelTextureData.buffer,
            modelTextureDataAlpha.buffer,

            modelTextureDataLod.buffer,
            modelTextureDataLodAlpha.buffer,

            modelTextureDataInteract.buffer,
            modelTextureDataInteractAlpha.buffer,

            modelTextureDataInteractLod.buffer,
            modelTextureDataInteractLodAlpha.buffer,
        ];

        const totalBytes = transferables.reduce((sum, buf) => sum + buf.byteLength, 0);

        console.log(
            `total bytes: ${totalBytes} ${modelId}`,
            sceneBuf.usedTextureIds,
            loadedTextures.size,
        );

        return {
            data: {
                modelId: modelId,

                cacheName: state.cache.info.name,

                borderSize,
                tileRenderFlags: scene.tileRenderFlags,
                collisionDatas: scene.collisionMaps,

                vertices,
                indices,

                modelTextureData,
                modelTextureDataAlpha,

                modelTextureDataLod,
                modelTextureDataLodAlpha,

                modelTextureDataInteract,
                modelTextureDataInteractAlpha,

                modelTextureDataInteractLod,
                modelTextureDataInteractLodAlpha,

                drawRanges,
                drawRangesAlpha,

                drawRangesLod,
                drawRangesLodAlpha,

                drawRangesInteract,
                drawRangesInteractAlpha,

                drawRangesInteractLod,
                drawRangesInteractLodAlpha,

                locsAnimated,

                loadedTextures,
            },
            transferables,
        };
    }

    reset(): void {
        this.modelHashBuf = undefined;
    }
}
