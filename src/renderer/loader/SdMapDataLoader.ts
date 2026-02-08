import { NpcSpawn, getMapNpcSpawns } from "../../data/npc/NpcSpawn";
import { ObjSpawn, getMapObjSpawns } from "../../data/obj/ObjSpawn";
import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { LocType } from "../../rs/config/loctype/LocType";
import { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import { NpcType } from "../../rs/config/npctype/NpcType";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarProvider } from "../../rs/config/vartype/VarProvider";
import { Model } from "../../rs/model/Model";
import { Scene, TileRenderFlag } from "../../rs/scene/Scene";
import { buildSceneFromMapBytesProvider } from "../../rs/scene/buildSceneFromMapBytesProvider";
import { decodeNpcSpawnsFromBytes } from "../../rs/scene/decodeNpcSpawns";
import { LocEntity } from "../../rs/scene/entity/LocEntity";
import { ContourGroundInfo, LocModelLoader } from "../../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../../rs/scene/model/ObjModelLoader";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { loadMinimapBlob } from "../../worker/MinimapData";
import { RenderDataLoader, RenderDataResult } from "../../worker/RenderDataLoader";
import { WorkerState } from "../../worker/RenderDataWorker";
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
import { LocAnimatedData } from "../loc/LocAnimatedData";
import { LocAnimatedGroup } from "../loc/LocAnimatedGroup";
import { SceneLocEntity } from "../loc/SceneLocEntity";
import { getSceneLocs, isLowDetail } from "../loc/SceneLocs";
import { createNpcDatas } from "../npc/NpcData";
import { NpcSpawnGroup } from "../npc/NpcSpawnGroup";
import { SdMapData } from "./SdMapData";
import { SdMapLoaderInput } from "./SdMapLoaderInput";
import { SdRenderableDataLoader, addNpcAnimationFrames } from "./SdRenderableDataLoader";

function loadHeightMapTextureData(scene: Scene): Int16Array {
    const heightMapTextureData = new Int16Array(Scene.MAX_LEVELS * scene.sizeX * scene.sizeY);

    let dataIndex = 0;
    for (let level = 0; level < scene.levels; level++) {
        for (let y = 0; y < scene.sizeY; y++) {
            for (let x = 0; x < scene.sizeX; x++) {
                heightMapTextureData[dataIndex++] =
                    (-scene.tileHeights[level][x][y] / Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
            }
        }
    }

    return heightMapTextureData;
}

function createObjSceneModels(
    objTypeLoader: ObjTypeLoader,
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawns: ObjSpawn[],
): void {
    for (const spawn of spawns) {
        createObjSceneModel(objTypeLoader, objModelLoader, sceneModels, scene, borderSize, spawn);
    }
}

function createObjSceneModel(
    objTypeLoader: ObjTypeLoader,
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    borderSize: number,
    spawn: ObjSpawn,
): void {
    const objResult = objTypeLoader.tryLoad(spawn.id);
    if (!objResult.ok) {
        return;
    }
    const objType = objResult.value;
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
    if (renderLevel < 3 && (scene.tileRenderFlags[1][tileX][tileY] & TileRenderFlag.Bridge) !== 0) {
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

function addLocEntities(
    locModelLoader: LocModelLoader,
    locTypeLoader: LocTypeLoader,
    seqTypeLoader: SeqTypeLoader,
    varManager: VarProvider,
    scene: Scene,
    sceneModels: SceneModel[],
    sceneBuf: SceneBuffer,
    locEntities: SceneLocEntity[],
): Iterable<LocAnimatedGroup> {
    const locAnimatedGroupMap = new Map<number, LocAnimatedGroup>();

    for (const sceneLocEntity of locEntities) {
        const entity = sceneLocEntity.entity;
        const id = entity.id;
        const type = entity.type;
        const rotation = entity.rotation;
        const tileX = entity.tileX;
        const tileY = entity.tileY;
        const level = entity.level;

        const locResult = locTypeLoader.tryLoad(id);
        if (!locResult.ok) {
            continue;
        }
        let locType = locResult.value;
        let sizeX = locType.sizeX;
        let sizeY = locType.sizeY;
        if (rotation === 1 || rotation === 3) {
            sizeX = locType.sizeY;
            sizeY = locType.sizeX;
        }

        if (locType.transforms) {
            const transformed = locType.transform(varManager, locTypeLoader);
            if (!transformed) {
                continue;
            }
            locType = transformed;
        }

        const startX = (sizeX >> 1) + tileX;
        const endX = ((sizeX + 1) >> 1) + tileX;
        const startY = (sizeY >> 1) + tileY;
        const endY = ((sizeY + 1) >> 1) + tileY;

        const heightMap = scene.tileHeights[level];
        let heightMapAbove: Int32Array[] | undefined;
        if (entity.level < scene.levels - 1) {
            heightMapAbove = scene.tileHeights[level + 1];
        }

        const centerHeight =
            (heightMap[endX][endY] +
                heightMap[startX][endY] +
                heightMap[startX][startY] +
                heightMap[endX][startY]) >>
            2;
        const entityX = (tileX << 7) + (sizeX << 6);
        const entityZ = (tileY << 7) + (sizeY << 6);

        const contourGroundInfo: ContourGroundInfo = {
            type: locType.contourGroundType,
            param: locType.contourGroundParam,
            heightMap,
            heightMapAbove,
            entityX: entityX,
            entityY: centerHeight,
            entityZ: entityZ,
        };
        const lowDetail = isLowDetail(scene, level, tileX, tileY, locType, type);
        if (entity.seqId !== -1) {
            const loc = {
                ...sceneLocEntity,
                lowDetail,
                interactId: locType.id,
            };

            const key = rotation + (type << 3) + (locType.id << 10);
            const group = locAnimatedGroupMap.get(key);
            if (group) {
                group.locs.push(loc);
            } else {
                const anim = addLocAnimationFrames(
                    locModelLoader,
                    seqTypeLoader,
                    sceneBuf,
                    entity,
                    locType,
                );
                if (!anim) {
                    continue;
                }

                locAnimatedGroupMap.set(key, {
                    anim,
                    locs: [loc],
                });
            }
        } else {
            const model = locModelLoader.getModelAnimated(
                locType,
                type,
                rotation,
                -1,
                -1,
                contourGroundInfo,
            );
            if (!model) {
                continue;
            }
            sceneModels.push({
                ...sceneLocEntity,

                model,
                sceneHeight: centerHeight,
                lowDetail,
                forceMerge: locType.contourGroundType > 1,
                interactId: locType.id,
            });
        }
    }

    return locAnimatedGroupMap.values();
}

function createNpcSpawnGroups(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: NpcTypeLoader,
    seqTypeLoader: SeqTypeLoader,
    basTypeLoader: BasTypeLoader,
    sceneBuf: SceneBuffer,
    npcSpawns: NpcSpawn[],
): NpcSpawnGroup[] {
    const groupedSpawns = new Map<number, NpcSpawn[]>();
    for (const spawn of npcSpawns) {
        const group = groupedSpawns.get(spawn.id);
        if (group) {
            group.push(spawn);
        } else {
            groupedSpawns.set(spawn.id, [spawn]);
        }
    }

    const groups: NpcSpawnGroup[] = [];

    for (const spawns of groupedSpawns.values()) {
        const npcResult = npcTypeLoader.tryLoad(spawns[0].id);
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

        if (!idleAnim) {
            continue;
        }

        groups.push({
            idleAnim,
            walkAnim,
            spawns,
        });
    }

    return groups;
}

export class SdMapDataLoader implements RenderDataLoader<SdMapLoaderInput, SdMapData | undefined> {
    __type = "sdMapDataLoader" as const;

    modelHashBuf?: ModelHashBuffer;
    private cachedTextureIdIndexMap?: Map<number, number>;
    private cachedTextureCacheName?: string;

    init(): void {
        if (!this.modelHashBuf) {
            this.modelHashBuf = new ModelHashBuffer(5000);
        }
    }

    private getTextureIdIndexMap(
        textureLoader: TextureLoader,
        cacheName: string,
    ): Map<number, number> {
        if (this.cachedTextureIdIndexMap && this.cachedTextureCacheName === cacheName) {
            return this.cachedTextureIdIndexMap;
        }

        let textureIds = textureLoader.getTextureIds().filter((id) => textureLoader.isSd(id));
        textureIds = textureIds.slice(0, 2047);

        const textureIdIndexMap = new Map<number, number>();
        for (let i = 0; i < textureIds.length; i++) {
            textureIdIndexMap.set(textureIds[i], i);
        }

        this.cachedTextureIdIndexMap = textureIdIndexMap;
        this.cachedTextureCacheName = cacheName;
        return textureIdIndexMap;
    }

    async load(
        state: WorkerState,
        {
            mapX,
            mapY,
            maxLevel,
            loadObjs,
            loadNpcs,
            loadLocs,
            smoothTerrain,
            minimizeDrawCalls,
            loadedTextureIds,
        }: SdMapLoaderInput,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        console.time(`load map ${mapX},${mapY}`);
        this.init();

        const profileStart = performance.now();
        const profile: Record<string, number> = {};
        const timeStep = <T>(name: string, fn: () => T): T => {
            const t0 = performance.now();
            const result = fn();
            profile[name] = performance.now() - t0;
            return result;
        };
        const timeStepAsync = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            const t0 = performance.now();
            const result = await fn();
            profile[name] = performance.now() - t0;
            return result;
        };

        const loaders = state.session.loaders;
        const locTypeLoader = loaders.locTypeLoader;
        const npcTypeLoader = loaders.npcTypeLoader;
        const objTypeLoader = loaders.objTypeLoader;
        const basTypeLoader = loaders.basTypeLoader;
        const seqTypeLoader = loaders.seqTypeLoader;
        const textureLoader = loaders.textureLoader;

        const locModelLoader = state.locModelLoader;
        const objModelLoader = state.objModelLoader;
        const npcModelLoader = state.npcModelLoader;

        const varManager = state.varProvider;

        const textureIdIndexMap = this.getTextureIdIndexMap(
            textureLoader,
            state.session.cache.info.name,
        );

        const borderSize = 6;

        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        console.time(`build scene ${mapX},${mapY}`);
        const scene = buildSceneFromMapBytesProvider(
            state.sceneBuilder,
            state.mapBytesProvider,
            baseX,
            baseY,
            mapSize,
            mapSize,
            smoothTerrain,
        );
        console.timeEnd(`build scene ${mapX},${mapY}`);

        const sceneBuf = new SceneBuffer(textureLoader, textureIdIndexMap, 100000);
        timeStep("addTerrain", () => sceneBuf.addTerrain(scene, borderSize, maxLevel));

        const sceneLocs = timeStep("getSceneLocs", () =>
            getSceneLocs(locTypeLoader, scene, borderSize, maxLevel),
        );
        const sceneModels = sceneLocs.locs;

        // Create loc animated groups and add transformed locs
        const locAnimatedGroups = timeStep("addLocEntities", () =>
            addLocEntities(
                locModelLoader,
                locTypeLoader,
                seqTypeLoader,
                varManager,
                scene,
                sceneModels,
                sceneBuf,
                sceneLocs.locEntities,
            ),
        );

        if (loadObjs) {
            const objSpawns = timeStep("getMapObjSpawns", () =>
                getMapObjSpawns(state.objSpawns, maxLevel, mapX, mapY),
            );
            timeStep("createObjSceneModels", () =>
                createObjSceneModels(
                    objTypeLoader,
                    objModelLoader,
                    sceneModels,
                    scene,
                    borderSize,
                    objSpawns,
                ),
            );
        }

        let locsAnimated: LocAnimatedData[] = [];
        if (loadLocs) {
            addSceneModels(
                this.modelHashBuf!,
                textureLoader,
                sceneBuf,
                sceneModels,
                minimizeDrawCalls,
            );

            // Animated locs
            locsAnimated = sceneBuf.addLocAnimatedGroups(locAnimatedGroups);
            console.log(`animated locs: ${locsAnimated.length}`);
        }

        // Npcs

        let npcSpawns: NpcSpawn[] = [];
        if (loadNpcs) {
            const npcSpawnBytes = state.mapBytesProvider.getNpcSpawnBytes(mapX, mapY);
            const cacheNpcSpawns = npcSpawnBytes
                ? decodeNpcSpawnsFromBytes(
                      scene.tileRenderFlags[1],
                      borderSize,
                      mapX,
                      mapY,
                      npcSpawnBytes,
                  )
                : undefined;
            if (cacheNpcSpawns) {
                npcSpawns = cacheNpcSpawns.filter((spawn) => {
                    const npcResult = npcTypeLoader.tryLoad(spawn.id);
                    if (!npcResult.ok) {
                        return false;
                    }
                    return (npcResult.value.loginScreenProps & 0x1) > 0;
                });
            } else {
                npcSpawns = getMapNpcSpawns(state.npcSpawns, maxLevel, mapX, mapY);
                npcSpawns = npcSpawns.filter((spawn) => {
                    if (spawn.name === undefined) {
                        return true;
                    }
                    const npcResult = npcTypeLoader.tryLoad(spawn.id);
                    return npcResult.ok && spawn.name === npcResult.value.name;
                });
            }
        }
        const npcSpawnGroups = timeStep("createNpcSpawnGroups", () =>
            createNpcSpawnGroups(
                npcModelLoader,
                npcTypeLoader,
                seqTypeLoader,
                basTypeLoader,
                sceneBuf,
                npcSpawns,
            ),
        );
        const npcs = timeStep("createNpcDatas", () => createNpcDatas(npcSpawnGroups));

        const drawRanges = timeStep("getDrawRanges", () =>
            SdRenderableDataLoader.getDrawRanges(sceneBuf, mapX, mapY),
        );

        const modelInfoTextures = timeStep("getModelInfoTextures", () =>
            SdRenderableDataLoader.getModelInfoTextures(sceneBuf),
        );

        const heightMapTextureData = timeStep("loadHeightMapTextureData", () =>
            loadHeightMapTextureData(scene),
        );

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = timeStep("packIndices", () => new Int32Array(sceneBuf.indices));

        const minimapBlob = await timeStepAsync("loadMinimapBlob", () =>
            loadMinimapBlob(state.mapImageRenderer, scene, 0, borderSize, false),
        );

        const usedTextureIds = Int32Array.from(sceneBuf.usedTextureIds);

        const loadedTextures = new Map<number, Int32Array>();
        const loadTexturesStart = performance.now();
        let missingTextureCount = 0;
        for (const textureId of sceneBuf.usedTextureIds) {
            if (!loadedTextureIds.has(textureId)) {
                const pixels = textureLoader.tryGetPixelsArgb(textureId, 128, true, 1.0);
                if (pixels) {
                    loadedTextures.set(textureId, pixels);
                }
                missingTextureCount++;
            }
        }
        const loadTexturesMs = performance.now() - loadTexturesStart;
        if (loadTexturesMs > 250) {
            console.log(
                `load map ${mapX},${mapY}: textures used=${
                    sceneBuf.usedTextureIds.size
                } missing=${missingTextureCount} decoded=${
                    loadedTextures.size
                } ms=${loadTexturesMs.toFixed(1)}`,
            );
        }

        console.timeEnd(`load map ${mapX},${mapY}`);

        const totalMs = performance.now() - profileStart;
        if (totalMs > 5000) {
            const parts = Object.entries(profile)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([k, v]) => `${k}=${v.toFixed(1)}ms`)
                .join(" ");
            console.log(
                `load map ${mapX},${mapY}: total=${totalMs.toFixed(
                    1,
                )}ms vertices=${sceneBuf.vertexCount()} indices=${sceneBuf.indices.length} models=${
                    sceneModels.length
                } ${parts}`,
            );
        }

        const transferables = [
            ...scene.tileRenderFlags.flat().map((buf) => buf.buffer),
            ...scene.collisionMaps.map((map) => map.flags.buffer),
            ...Array.from(loadedTextures.values()).map((pixels) => pixels.buffer),

            vertices.buffer,
            indices.buffer,
            heightMapTextureData.buffer,
            usedTextureIds.buffer,

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

        //console.log(
        //    `total bytes: ${totalBytes} ${mapX},${mapY}`,
        //    sceneBuf.usedTextureIds,
        //    loadedTextures.size,
        //);

        const data = new SdMapData(
            mapX,
            mapY,

            state.session.cache.info.name,

            maxLevel,
            loadObjs,
            loadNpcs,
            loadLocs,

            smoothTerrain,

            borderSize,
            scene.tileRenderFlags,
            scene.collisionMaps,

            minimapBlob,

            vertices,
            indices,

            modelInfoTextures,

            heightMapTextureData,

            drawRanges,

            locsAnimated,
            npcs,

            usedTextureIds,
            loadedTextures,
        );

        return {
            data,
            transferables,
        };
    }

    reset(): void {
        this.modelHashBuf = undefined;
        this.cachedTextureIdIndexMap = undefined;
        this.cachedTextureCacheName = undefined;
    }
}
