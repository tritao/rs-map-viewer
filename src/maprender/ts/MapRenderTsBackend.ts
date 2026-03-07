import { NpcSpawnResolver } from "../../data/npc/NpcSpawnResolver";
import { ObjSpawn, getWindowObjSpawns } from "../../data/obj/ObjSpawn";
import { InteractType } from "../../renderer/InteractType";
import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { LocType } from "../../rs/config/loctype/LocType";
import { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarProvider } from "../../rs/config/vartype/VarProvider";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { Model } from "../../rs/model/Model";
import { Scene, TileRenderFlag } from "../../rs/scene/Scene";
import { LocLoadType } from "../../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../../rs/scene/buildSceneFromMapBytesProvider";
import { LocModelLoader } from "../../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../../rs/scene/model/ObjModelLoader";
import type { MapRenderCommandStreamRuntimeInput } from "../../runtime/build";
import {
    ContourGroundType,
    LocAnimatedData,
    LocAnimatedGroup,
    ModelHashBuffer,
    SceneBuffer,
    type SceneCommandPlan,
    type SceneCommandPlanDigest,
    SceneLocEntity,
    SceneModel,
    buildDrawRangesFromBuckets,
    buildModelInfoTexturesFromBuckets,
    buildNpcGeometry,
    buildRuntimeCommandStreamInputFromBuckets,
    collectRuntimeDrawCommandBuckets,
    createLocAnimatedGroupKey,
    emitSceneModelsToSceneBuffer,
    getSceneLocs,
    resolveLocRenderPlacement,
    summarizeSceneCommandPlan,
} from "../../runtime/build";
import type { AnimationFrames } from "../../runtime/contracts/AnimationFrames";
import { type DrawRange, NULL_DRAW_RANGE } from "../../runtime/contracts/DrawRange";
import { createBootstrapData } from "../../runtime/sim/NpcBootstrap";
import type { MapRenderBuildDeps } from "../MapRenderBuildDeps";
import type { SdMapData } from "../MapRenderPayload";
import { SdMapLoaderInput } from "../MapRenderPayload";
import { loadMinimapBlob } from "./MinimapData";

export type MapRenderTsBackendDeps = MapRenderBuildDeps;

export type BuildMapDataOptions = Readonly<{
    includeRuntimeCommandStreamInput?: boolean;
    includeRuntimeSceneTileHeights?: boolean;
    includeMinimapBlob?: boolean;
    includeLoadedTextures?: boolean;
    includeNpcAnimationFrames?: boolean;
    debugIncludeSceneCommandPlanDigest?: boolean;
    debugIncludeSceneCommandPlanOpsPacked?: boolean;
    debugIncludeStageProfile?: boolean;
}>;

export type BuildMapDataBridgeInputResult = Readonly<{
    data: SdMapData | undefined;
    runtimeCommandStreamInput: MapRenderCommandStreamRuntimeInput | undefined;
    debugSceneCommandPlanDigest?: SceneCommandPlanDigest;
    debugSceneCommandPlanOpsPacked?: Int32Array;
    debugStageProfile?: Readonly<Record<string, number>>;
    debugTotalMs?: number;
}>;

function packSceneCommandPlanOps(plan: SceneCommandPlan): Int32Array {
    const stride = 6;
    const out = new Int32Array((plan.ops.length | 0) * stride);
    let o = 0;
    for (let i = 0; i < plan.ops.length; i++) {
        const op = plan.ops[i];
        if (op.kind === "mergedGroup") {
            out[o++] = 2;
            out[o++] = op.group.transparent ? 1 : 0;
            out[o++] = op.group.lowDetail ? 1 : 0;
            out[o++] = op.group.level | 0;
            out[o++] = op.group.priority | 0;
            out[o++] = op.group.models.length | 0;
        } else {
            out[o++] = 1;
            out[o++] = op.transparent ? 1 : 0;
            out[o++] = op.modelHash | 0;
            out[o++] = op.faces.length | 0;
            out[o++] = op.instances.length | 0;
            out[o++] = op.lodInstances.length | 0;
        }
    }
    return out;
}

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

function flattenSceneTileHeights(scene: Scene): Int32Array {
    const levels = scene.levels;
    const sizeX = scene.sizeX;
    const sizeY = scene.sizeY;
    const sceneTileHeights = new Int32Array(levels * (sizeX + 1) * (sizeY + 1));
    let i = 0;
    for (let level = 0; level < levels; level++) {
        for (let x = 0; x <= sizeX; x++) {
            for (let y = 0; y <= sizeY; y++) {
                sceneTileHeights[i++] = scene.tileHeights[level][x][y];
            }
        }
    }
    return sceneTileHeights;
}

function createObjSceneModels(
    objTypeLoader: ObjTypeLoader,
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    baseX: number,
    baseY: number,
    borderSize: number,
    spawns: ObjSpawn[],
): void {
    for (const spawn of spawns) {
        createObjSceneModel(
            objTypeLoader,
            objModelLoader,
            sceneModels,
            scene,
            baseX,
            baseY,
            borderSize,
            spawn,
        );
    }
}

function createObjSceneModel(
    objTypeLoader: ObjTypeLoader,
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    scene: Scene,
    baseX: number,
    baseY: number,
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

    // `spawns` are world coordinates; map them into the current scene window.
    // This is intentionally window-relative (not `% 64`) so border-region spawns in adjacent
    // map squares land on the correct tiles.
    const tileX = (spawn.x - baseX) | 0;
    const tileY = (spawn.y - baseY) | 0;

    const model = objModelLoader.getModel(spawn.id, spawn.count);
    if (!model) {
        return;
    }

    let renderLevel = spawn.plane;
    if (renderLevel < 3 && (scene.tileRenderFlags[1][tileX][tileY] & TileRenderFlag.Bridge) !== 0) {
        renderLevel = spawn.plane + 1;
    }

    const sceneHeight = scene.getCenterHeight(renderLevel, tileX, tileY);

    let heightOffset = 0;
    const tile = scene.tiles[renderLevel][tileX][tileY];
    if (!tile || !tile.tileModel || tile.tileModel.faces.length === 0) {
        return;
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
        // Scene-model coordinates are relative to the central map square (border excluded).
        sceneX: (tileX - borderSize) * 128 + 64,
        sceneZ: (tileY - borderSize) * 128 + 64,
        heightOffset,
        level: renderLevel,
        contourGround,
        priority: 10,
        interactType: InteractType.OBJ,
        interactId: spawn.id,
    });
}

function addLocAnimationFrames(
    locModelLoader: LocModelLoader,
    seqTypeLoader: SeqTypeLoader,
    sceneBuf: SceneBuffer,
    locType: LocType,
    type: number,
    rotation: number,
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
        const model = locModelLoader.getModelAnimated(locType, type, rotation, seqId, i);
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

type LocAnimatedGroupBuild = {
    seqId: number;
    type: number;
    rotation: number;
    locType: LocType;
    locs: SceneLocEntity[];
};

function pushLocEntityRenderData(
    locAnimatedGroupMap: Map<number, LocAnimatedGroupBuild>,
    locModelLoader: LocModelLoader,
    locTypeLoader: LocTypeLoader,
    varManager: VarProvider,
    scene: Scene,
    sceneModels: SceneModel[],
    sceneLocEntity: SceneLocEntity,
    idIsResolved: boolean,
): void {
    const entity = sceneLocEntity.entity;
    const resolved = resolveLocRenderPlacement(
        scene,
        sceneLocEntity,
        locTypeLoader,
        varManager,
        idIsResolved,
    );
    if (!resolved) {
        return;
    }

    if (entity.seqId !== -1) {
        const loc = {
            ...sceneLocEntity,
            lowDetail: resolved.lowDetail,
            interactId: resolved.locType.id,
        };

        const key = createLocAnimatedGroupKey(
            resolved.rotation,
            resolved.type,
            resolved.locType.id,
        );
        const group = locAnimatedGroupMap.get(key);
        if (group) {
            group.locs.push(loc);
        } else {
            locAnimatedGroupMap.set(key, {
                seqId: entity.seqId,
                type: resolved.type,
                rotation: resolved.rotation,
                locType: resolved.locType,
                locs: [loc],
            });
        }
        return;
    }

    const model = locModelLoader.getModelAnimated(
        resolved.locType,
        resolved.type,
        resolved.rotation,
        -1,
        -1,
        resolved.contourGroundInfo,
    );
    if (!model) {
        return;
    }

    sceneModels.push({
        ...sceneLocEntity,
        model,
        sceneHeight: resolved.centerHeight,
        lowDetail: resolved.lowDetail,
        // Any terrain-contoured model differs per placement; force per-placement merge.
        forceMerge: resolved.locType.contourGroundType > 0,
        interactId: resolved.locType.id,
    });
}
function addLocEntities(
    locModelLoader: LocModelLoader,
    locTypeLoader: LocTypeLoader,
    varManager: VarProvider,
    scene: Scene,
    sceneModels: SceneModel[],
    locEntities: SceneLocEntity[],
): Iterable<LocAnimatedGroupBuild> {
    const locAnimatedGroupMap = new Map<number, LocAnimatedGroupBuild>();

    for (const sceneLocEntity of locEntities) {
        pushLocEntityRenderData(
            locAnimatedGroupMap,
            locModelLoader,
            locTypeLoader,
            varManager,
            scene,
            sceneModels,
            sceneLocEntity,
            false,
        );
    }

    return locAnimatedGroupMap.values();
}

export class MapRenderTsBackend {
    modelHashBuf?: ModelHashBuffer;
    private readonly npcSpawnResolver = new NpcSpawnResolver();

    constructor(private readonly deps: MapRenderBuildDeps) {}

    init(): void {
        if (!this.modelHashBuf) {
            this.modelHashBuf = new ModelHashBuffer(5000);
        }
    }

    async buildMapDataBridgeInput(
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
        options?: BuildMapDataOptions,
    ): Promise<BuildMapDataBridgeInputResult> {
        this.init();

        const telemetryEnabled = this.deps.telemetry === true;
        const npcSpawnTelemetry = telemetryEnabled
            ? {
                  now: () => performance.now(),
                  log: (message: string) => console.log(message),
              }
            : undefined;
        const captureStageProfile = options?.debugIncludeStageProfile === true || telemetryEnabled;
        const profileStart = performance.now();
        const profile: Record<string, number> = {};
        const timeStep = <T>(name: string, fn: () => T): T => {
            if (!captureStageProfile) {
                return fn();
            }
            const t0 = performance.now();
            const result = fn();
            profile[name] = performance.now() - t0;
            return result;
        };
        const timeStepAsync = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
            if (!captureStageProfile) {
                return fn();
            }
            const t0 = performance.now();
            const result = await fn();
            profile[name] = performance.now() - t0;
            return result;
        };

        const loaders = this.deps.session.loaders;
        const locTypeLoader = loaders.locTypeLoader;
        const npcTypeLoader = loaders.npcTypeLoader;
        const objTypeLoader = loaders.objTypeLoader;
        const basTypeLoader = loaders.basTypeLoader;
        const seqTypeLoader = loaders.seqTypeLoader;
        const textureLoader = loaders.textureLoader;

        const locModelLoader = this.deps.locModelLoader;
        const objModelLoader = this.deps.objModelLoader;
        const npcModelLoader = this.deps.npcModelLoader;

        const varManager = this.deps.varProvider;

        const borderSize = 6;

        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        const scene = timeStep("buildScene", () =>
            buildSceneFromMapBytesProvider(
                this.deps.sceneBuilder,
                this.deps.mapBytesProvider,
                baseX,
                baseY,
                mapSize,
                mapSize,
                smoothTerrain,
                // If we aren't rendering locs, still decode loc placements but avoid model loads/lighting.
                loadLocs ? LocLoadType.MODELS : LocLoadType.NO_MODELS,
            ),
        );

        const sceneBuf = new SceneBuffer(textureLoader, 100000);
        timeStep("addTerrain", () => sceneBuf.addTerrain(scene, borderSize, maxLevel));

        const sceneModels: SceneModel[] = [];
        let locAnimatedGroupsBuild: Iterable<LocAnimatedGroupBuild> = [];
        if (loadLocs) {
            const sceneLocs = timeStep("getSceneLocs", () =>
                getSceneLocs(locTypeLoader, scene, borderSize, maxLevel),
            );
            sceneModels.push(...sceneLocs.locs);
            // Create loc animated groups and add transformed locs.
            locAnimatedGroupsBuild = timeStep("addLocEntities", () =>
                addLocEntities(
                    locModelLoader,
                    locTypeLoader,
                    varManager,
                    scene,
                    sceneModels,
                    sceneLocs.locEntities,
                ),
            );
        }

        if (loadObjs) {
            const objSpawns = timeStep("getWindowObjSpawns", () =>
                getWindowObjSpawns(this.deps.objSpawns, maxLevel, baseX, baseY, mapSize, mapSize),
            );
            timeStep("createObjSceneModels", () =>
                createObjSceneModels(
                    objTypeLoader,
                    objModelLoader,
                    sceneModels,
                    scene,
                    baseX,
                    baseY,
                    borderSize,
                    objSpawns,
                ),
            );
        }

        let locsAnimated: LocAnimatedData[] = [];
        let debugSceneCommandPlanDigest: SceneCommandPlanDigest | undefined;
        let debugSceneCommandPlanOpsPacked: Int32Array | undefined;
        if (sceneModels.length > 0) {
            const plan = emitSceneModelsToSceneBuffer(
                this.modelHashBuf!,
                textureLoader,
                sceneBuf,
                sceneModels,
                minimizeDrawCalls,
            );
            if (options?.debugIncludeSceneCommandPlanDigest) {
                debugSceneCommandPlanDigest = summarizeSceneCommandPlan(plan);
            }
            if (options?.debugIncludeSceneCommandPlanOpsPacked) {
                debugSceneCommandPlanOpsPacked = packSceneCommandPlanOps(plan);
            }

            // Animated locs
            if (loadLocs) {
                const locAnimatedGroups: LocAnimatedGroup[] = [];
                for (const group of locAnimatedGroupsBuild) {
                    const anim = addLocAnimationFrames(
                        locModelLoader,
                        seqTypeLoader,
                        sceneBuf,
                        group.locType,
                        group.type,
                        group.rotation,
                        group.seqId,
                    );
                    if (!anim) {
                        continue;
                    }
                    locAnimatedGroups.push({ anim, locs: group.locs });
                }

                locsAnimated = sceneBuf.addLocAnimatedGroups(locAnimatedGroups);
                if (telemetryEnabled) {
                    console.log(`animated locs: ${locsAnimated.length}`);
                }
            }
        }

        const npcSpawns = await timeStepAsync("resolveNpcSpawns", () =>
            this.npcSpawnResolver.resolveSpawns(
                {
                    mapBytesProvider: this.deps.mapBytesProvider,
                    cacheInfo: this.deps.session.cache.info,
                    npcSpawnDecodeBackend: this.deps.npcSpawnDecodeBackend,
                    fallbackNpcSpawns: this.deps.fallbackNpcSpawns,
                    telemetry: npcSpawnTelemetry,
                },
                {
                    loadNpcs,
                    mapX,
                    mapY,
                    maxLevel,
                    borderSize,
                    tileRenderFlagsLevel1: scene.tileRenderFlags[1],
                    npcTypeLoader,
                },
            ),
        );
        const npcGeometry = timeStep("buildNpcGeometry", () =>
            buildNpcGeometry({
                loadNpcs,
                includeNpcAnimationFrames: options?.includeNpcAnimationFrames !== false,
                npcSpawns,
                textureLoader,
                npcModelLoader,
                npcTypeLoader,
                seqTypeLoader,
                basTypeLoader,
            }),
        );
        const npcVertices = npcGeometry.npcVertices;
        const npcIndices = npcGeometry.npcIndices;
        const npcDrawRangesBase = npcGeometry.npcDrawRangesBase;
        const npcDrawRangesAlpha = npcGeometry.npcDrawRangesAlpha;
        const npcOrderKeys =
            loadNpcs && npcGeometry.npcs.length > 0
                ? Int32Array.from(npcGeometry.npcs, (npc) => npc.orderKey ?? -1)
                : undefined;
        const npcBootstrap =
            loadNpcs && npcGeometry.npcs.length > 0
                ? createBootstrapData({
                      mapId: getMapSquareId(mapX, mapY),
                      npcsIn: npcGeometry.npcs,
                  })
                : undefined;
        const npcTypeAnimationTable = npcBootstrap?.npcTypeAnimationTable;

        const includeRuntimeCommandStreamInput = options?.includeRuntimeCommandStreamInput === true;
        const includeRuntimeSceneTileHeights = options?.includeRuntimeSceneTileHeights !== false;
        const runtimeDrawCommandBuckets = timeStep("collectRuntimeDrawCommandBuckets", () =>
            collectRuntimeDrawCommandBuckets(sceneBuf),
        );

        const drawRanges = timeStep("getDrawRanges", () =>
            buildDrawRangesFromBuckets(runtimeDrawCommandBuckets),
        );

        const modelInfoTextures = timeStep("getModelInfoTextures", () =>
            buildModelInfoTexturesFromBuckets(runtimeDrawCommandBuckets),
        );

        const heightMapTextureData = timeStep("loadHeightMapTextureData", () =>
            loadHeightMapTextureData(scene),
        );

        const runtimeSceneTileHeights =
            includeRuntimeCommandStreamInput && includeRuntimeSceneTileHeights
                ? timeStep("flattenSceneTileHeights", () => flattenSceneTileHeights(scene))
                : undefined;

        const runtimeCommandStreamInput = includeRuntimeCommandStreamInput
            ? timeStep("createRuntimeCommandStreamInputFromBuckets", () =>
                  buildRuntimeCommandStreamInputFromBuckets(
                      runtimeSceneTileHeights ?? new Int32Array(0),
                      {
                          levels: scene.levels,
                          sizeX: scene.sizeX,
                          sizeY: scene.sizeY,
                          unitsTileHeightBasis: Scene.UNITS_TILE_HEIGHT_BASIS,
                      },
                      runtimeDrawCommandBuckets,
                  ),
              )
            : undefined;

        const vertices = sceneBuf.vertexBuf.byteArray();
        const indices = timeStep("packIndices", () => new Int32Array(sceneBuf.indices));

        const minimapBlob =
            options?.includeMinimapBlob === false
                ? new Blob()
                : await timeStepAsync("loadMinimapBlob", () =>
                      loadMinimapBlob(this.deps.mapImageRenderer, scene, 0, borderSize, false),
                  );

        const usedTextureIdSet = new Set<number>(sceneBuf.usedTextureIds);
        for (const textureId of npcGeometry.usedTextureIds) {
            usedTextureIdSet.add(textureId);
        }
        const usedTextureIds = Int32Array.from([...usedTextureIdSet].sort((a, b) => a - b));

        const includeLoadedTextures = options?.includeLoadedTextures !== false;
        const loadedTextures = new Map<number, Int32Array>();
        const loadedTextureIdSet = new Set<number>(loadedTextureIds);
        if (includeLoadedTextures) {
            const loadTexturesStart = performance.now();
            let missingTextureCount = 0;
            for (const textureId of usedTextureIdSet) {
                if (!loadedTextureIdSet.has(textureId)) {
                    const pixels = textureLoader.tryGetPixelsArgb(textureId, 128, true, 1.0);
                    if (pixels) {
                        loadedTextures.set(textureId, pixels);
                    }
                    missingTextureCount++;
                }
            }
            const loadTexturesMs = performance.now() - loadTexturesStart;
            if (captureStageProfile) {
                profile.loadMissingTextures = loadTexturesMs;
            }
            if (telemetryEnabled && loadTexturesMs > 250) {
                console.log(
                    `load map ${mapX},${mapY}: textures used=${
                        usedTextureIdSet.size
                    } missing=${missingTextureCount} decoded=${
                        loadedTextures.size
                    } ms=${loadTexturesMs.toFixed(1)}`,
                );
            }
        }

        const totalMs = performance.now() - profileStart;
        if (telemetryEnabled && totalMs > 5000) {
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

        const data: SdMapData = {
            mapId: getMapSquareId(mapX, mapY),
            mapX,
            mapY,
            cacheName: this.deps.session.cache.info.name,
            maxLevel,
            loadObjs,
            loadNpcs,
            loadLocs,
            smoothTerrain,
            borderSize,
            tileRenderFlags: scene.tileRenderFlags,
            minimapBlob,
            vertices,
            indices,
            modelInfoTextures,
            heightMapTextureData,
            drawRanges,
            locsAnimated,
            usedTextureIds,
            loadedTextures,
            npcDrawRangesBase,
            npcDrawRangesAlpha,
            npcVertices,
            npcIndices,
        };

        return {
            data,
            runtimeCommandStreamInput,
            debugSceneCommandPlanDigest,
            debugSceneCommandPlanOpsPacked,
            debugStageProfile: options?.debugIncludeStageProfile ? { ...profile } : undefined,
            debugTotalMs: options?.debugIncludeStageProfile ? totalMs : undefined,
        };
    }

    async buildMapData(
        input: SdMapLoaderInput,
        options?: BuildMapDataOptions,
    ): Promise<BuildMapDataBridgeInputResult> {
        return await this.buildMapDataBridgeInput(input, options);
    }

    reset(): void {
        this.modelHashBuf = undefined;
        this.npcSpawnResolver.reset();
    }
}
