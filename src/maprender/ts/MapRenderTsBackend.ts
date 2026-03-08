import { NpcSpawnResolver } from "../../data/npc/NpcSpawnResolver";
import { getWindowObjSpawns } from "../../data/obj/ObjSpawn";
import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { LocType } from "../../rs/config/loctype/LocType";
import { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarProvider } from "../../rs/config/vartype/VarProvider";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { Scene } from "../../rs/scene/Scene";
import { LocLoadType } from "../../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../../rs/scene/buildSceneFromMapBytesProvider";
import { LocModelLoader } from "../../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../rs/scene/model/NpcModelLoader";
import type { LocAnimatedData } from "../../runtime/contracts/LocAnimatedData";
import type { MapRenderCommandStreamRuntimeInput } from "../../runtime/build/SceneDrawCommandBuilder";
import { ModelHashBuffer } from "../../runtime/build/ModelHashBuffer";
import { createLocAnimatedGroupKey, type LocAnimatedGroup } from "../../runtime/build/LocAnimatedGroup";
import { SceneGeometryBuffer, type SceneModel } from "../../runtime/build/SceneGeometryBuffer";
import {
    type SceneDrawPlan,
    type SceneDrawPlanDigest,
    emitSceneModelsToSceneGeometryBuffer,
    summarizeSceneDrawPlan,
} from "../../runtime/build/SceneDrawPlan";
import type { SceneLocEntity } from "../../runtime/build/SceneLocEntity";
import {
    buildDrawRangesFromBuckets,
    buildModelInfoTexturesFromBuckets,
    buildRuntimeCommandStreamInputFromBuckets,
    collectRuntimeDrawCommandBuckets,
} from "../../runtime/build/SceneDrawCommandBuilder";
import { buildNpcGeometry } from "../../runtime/build/NpcGeometryBuilder";
import { buildObjRenderData } from "../../runtime/build/ObjRenderDataBuilder";
import { resolveLocRenderPlacement } from "../../runtime/build/LocPlacementResolver";
import { getSceneLocs } from "../../runtime/build/SceneLocs";
import type { AnimationFrames } from "../../runtime/entities/AnimationFrames";
import type { DrawRange } from "../../runtime/DrawRange";
import { createBootstrapData } from "../../runtime/sim/NpcBootstrap";
import type { MapRenderBuildDeps } from "../MapRenderBackend";
import type {
    MapRuntimeBootstrap,
    MapRuntimeRegistration,
    SdMapData,
} from "../MapRenderPayload";
import {
    SdMapLoaderInput,
    buildMapRuntimePayloads,
} from "../MapRenderPayload";
import { loadMinimapBlob } from "./MinimapData";
import type { NpcTypeAnimationEntry } from "../../runtime/contracts/NpcTypeAnimationTable";

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
    runtimeRegistration?: MapRuntimeRegistration;
    runtimeBootstrap?: MapRuntimeBootstrap;
    runtimeCommandStreamInput: MapRenderCommandStreamRuntimeInput | undefined;
    debugSceneCommandPlanDigest?: SceneDrawPlanDigest;
    debugSceneCommandPlanOpsPacked?: Int32Array;
    debugStageProfile?: Readonly<Record<string, number>>;
    debugTotalMs?: number;
}>;

type StageTimer = <T>(name: string, fn: () => T) => T;
type AsyncStageTimer = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
const NULL_DRAW_RANGE: DrawRange = [0, 0, 0];

type SceneBuildStageResult = Readonly<{
    borderSize: number;
    baseX: number;
    baseY: number;
    mapSize: number;
    scene: Scene;
    sceneBuf: SceneGeometryBuffer;
    sceneModels: SceneModel[];
    locsAnimated: LocAnimatedData[];
    objRenderData: ReturnType<typeof buildObjRenderData>;
    debugSceneCommandPlanDigest?: SceneDrawPlanDigest;
    debugSceneCommandPlanOpsPacked?: Int32Array;
}>;

type NpcRuntimeStageResult = Readonly<{
    npcGeometry: ReturnType<typeof buildNpcGeometry>;
    npcOrderKeys?: Int32Array;
    npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
}>;

function packSceneDrawPlanOps(plan: SceneDrawPlan): Int32Array {
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

function addLocAnimationFrames(
    locModelLoader: LocModelLoader,
    seqTypeLoader: SeqTypeLoader,
    sceneBuf: SceneGeometryBuffer,
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

    private buildSceneStage(
        input: SdMapLoaderInput,
        options: BuildMapDataOptions | undefined,
        timeStep: StageTimer,
    ): SceneBuildStageResult {
        const { mapX, mapY, maxLevel, loadObjs, loadLocs, smoothTerrain, minimizeDrawCalls } = input;
        const loaders = this.deps.session.loaders;
        const locTypeLoader = loaders.locTypeLoader;
        const objTypeLoader = loaders.objTypeLoader;
        const seqTypeLoader = loaders.seqTypeLoader;
        const textureLoader = loaders.textureLoader;
        const locModelLoader = this.deps.locModelLoader;
        const objModelLoader = this.deps.objModelLoader;
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
                loadLocs ? LocLoadType.MODELS : LocLoadType.NO_MODELS,
            ),
        );

        const sceneBuf = new SceneGeometryBuffer(textureLoader, 100000);
        timeStep("addTerrain", () => sceneBuf.addTerrain(scene, borderSize, maxLevel));

        const sceneModels: SceneModel[] = [];
        let locAnimatedGroupsBuild: Iterable<LocAnimatedGroupBuild> = [];
        if (loadLocs) {
            const sceneLocs = timeStep("getSceneLocs", () =>
                getSceneLocs(locTypeLoader, scene, borderSize, maxLevel),
            );
            sceneModels.push(...sceneLocs.locs);
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

        const objSpawns = loadObjs
            ? timeStep("getWindowObjSpawns", () =>
                  getWindowObjSpawns(this.deps.objSpawns, maxLevel, baseX, baseY, mapSize, mapSize),
              )
            : [];
        const objRenderData = timeStep("buildObjRenderData", () =>
            buildObjRenderData({
                loadObjs,
                objTypeLoader,
                objModelLoader,
                scene,
                textureLoader,
                baseX,
                baseY,
                borderSize,
                objSpawns,
                minimizeDrawCalls,
            }),
        );

        let locsAnimated: LocAnimatedData[] = [];
        let debugSceneCommandPlanDigest: SceneDrawPlanDigest | undefined;
        let debugSceneCommandPlanOpsPacked: Int32Array | undefined;
        if (sceneModels.length > 0) {
            const plan = emitSceneModelsToSceneGeometryBuffer(
                this.modelHashBuf!,
                textureLoader,
                sceneBuf,
                sceneModels,
                minimizeDrawCalls,
            );
            if (options?.debugIncludeSceneCommandPlanDigest) {
                debugSceneCommandPlanDigest = summarizeSceneDrawPlan(plan);
            }
            if (options?.debugIncludeSceneCommandPlanOpsPacked) {
                debugSceneCommandPlanOpsPacked = packSceneDrawPlanOps(plan);
            }

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
                if (this.deps.telemetry === true) {
                    console.log(`animated locs: ${locsAnimated.length}`);
                }
            }
        }

        return {
            borderSize,
            baseX,
            baseY,
            mapSize,
            scene,
            sceneBuf,
            sceneModels,
            locsAnimated,
            objRenderData,
            debugSceneCommandPlanDigest,
            debugSceneCommandPlanOpsPacked,
        };
    }

    private async buildNpcRuntimeStage(
        input: SdMapLoaderInput,
        sceneStage: SceneBuildStageResult,
        options: BuildMapDataOptions | undefined,
        timeStep: StageTimer,
        timeStepAsync: AsyncStageTimer,
        npcSpawnTelemetry:
            | {
                  now: () => number;
                  log: (message: string) => void;
              }
            | undefined,
    ): Promise<NpcRuntimeStageResult> {
        const { mapX, mapY, maxLevel, loadNpcs } = input;
        const loaders = this.deps.session.loaders;
        const npcTypeLoader = loaders.npcTypeLoader;
        const basTypeLoader = loaders.basTypeLoader;
        const seqTypeLoader = loaders.seqTypeLoader;
        const textureLoader = loaders.textureLoader;
        const npcModelLoader = this.deps.npcModelLoader;

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
                    borderSize: sceneStage.borderSize,
                    tileRenderFlagsLevel1: sceneStage.scene.tileRenderFlags[1],
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

        return {
            npcGeometry,
            npcOrderKeys,
            npcTypeAnimationTable: npcBootstrap?.npcTypeAnimationTable,
        };
    }

    private buildStaticMapData(
        input: SdMapLoaderInput,
        sceneStage: SceneBuildStageResult,
        minimapBlob: Blob,
        drawRanges: ReturnType<typeof buildDrawRangesFromBuckets>,
        modelInfoTextures: ReturnType<typeof buildModelInfoTexturesFromBuckets>,
        heightMapTextureData: Int16Array,
        usedTextureIds: Int32Array,
        loadedTextures: Map<number, Int32Array>,
        npcVertices: Uint8Array | undefined,
        npcIndices: Int32Array | undefined,
        npcDrawRangesBase: Int32Array | undefined,
        npcDrawRangesAlpha: Int32Array | undefined,
    ): SdMapData {
        return {
            mapId: getMapSquareId(input.mapX, input.mapY),
            mapX: input.mapX,
            mapY: input.mapY,
            cacheName: this.deps.session.cache.info.name,
            maxLevel: input.maxLevel,
            loadObjs: input.loadObjs,
            loadNpcs: input.loadNpcs,
            loadLocs: input.loadLocs,
            smoothTerrain: input.smoothTerrain,
            borderSize: sceneStage.borderSize,
            tileRenderFlags: sceneStage.scene.tileRenderFlags,
            minimapBlob,
            vertices: sceneStage.sceneBuf.vertexBuf.byteArray(),
            indices: new Int32Array(sceneStage.sceneBuf.indices),
            modelInfoTextures,
            heightMapTextureData,
            drawRanges,
            locsAnimated: sceneStage.locsAnimated,
            usedTextureIds,
            loadedTextures,
            npcDrawRangesBase,
            npcDrawRangesAlpha,
            npcVertices,
            npcIndices,
        };
    }

    async buildMapData(
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
        const input: SdMapLoaderInput = {
            mapX,
            mapY,
            maxLevel,
            loadObjs,
            loadNpcs,
            loadLocs,
            smoothTerrain,
            minimizeDrawCalls,
            loadedTextureIds,
        };

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
        const textureLoader = loaders.textureLoader;

        const sceneStage = this.buildSceneStage(input, options, timeStep);
        const npcStage = await this.buildNpcRuntimeStage(
            input,
            sceneStage,
            options,
            timeStep,
            timeStepAsync,
            npcSpawnTelemetry,
        );
        const npcGeometry = npcStage.npcGeometry;
        const npcVertices = npcGeometry.npcVertices;
        const npcIndices = npcGeometry.npcIndices;
        const npcDrawRangesBase = npcGeometry.npcDrawRangesBase;
        const npcDrawRangesAlpha = npcGeometry.npcDrawRangesAlpha;
        const npcOrderKeys = npcStage.npcOrderKeys;
        const npcTypeAnimationTable = npcStage.npcTypeAnimationTable;

        const includeRuntimeCommandStreamInput = options?.includeRuntimeCommandStreamInput === true;
        const includeRuntimeSceneTileHeights = options?.includeRuntimeSceneTileHeights !== false;
        const runtimeDrawCommandBuckets = timeStep("collectRuntimeDrawCommandBuckets", () =>
            collectRuntimeDrawCommandBuckets(sceneStage.sceneBuf),
        );

        const drawRanges = timeStep("getDrawRanges", () =>
            buildDrawRangesFromBuckets(runtimeDrawCommandBuckets),
        );

        const modelInfoTextures = timeStep("getModelInfoTextures", () =>
            buildModelInfoTexturesFromBuckets(runtimeDrawCommandBuckets),
        );

        const heightMapTextureData = timeStep("loadHeightMapTextureData", () =>
            loadHeightMapTextureData(sceneStage.scene),
        );

        const runtimeSceneTileHeights =
            includeRuntimeCommandStreamInput && includeRuntimeSceneTileHeights
                ? timeStep("flattenSceneTileHeights", () => flattenSceneTileHeights(sceneStage.scene))
                : undefined;

        const runtimeCommandStreamInput = includeRuntimeCommandStreamInput
            ? timeStep("createRuntimeCommandStreamInputFromBuckets", () =>
                  buildRuntimeCommandStreamInputFromBuckets(
                      runtimeSceneTileHeights ?? new Int32Array(0),
                      {
                          levels: sceneStage.scene.levels,
                          sizeX: sceneStage.scene.sizeX,
                          sizeY: sceneStage.scene.sizeY,
                          unitsTileHeightBasis: Scene.UNITS_TILE_HEIGHT_BASIS,
                      },
                      runtimeDrawCommandBuckets,
                  ),
              )
            : undefined;

        const minimapBlob =
            options?.includeMinimapBlob === false
                ? new Blob()
                : await timeStepAsync("loadMinimapBlob", () =>
                      loadMinimapBlob(
                          this.deps.mapImageRenderer,
                          sceneStage.scene,
                          0,
                          sceneStage.borderSize,
                          false,
                      ),
                  );

        const usedTextureIdSet = new Set<number>(sceneStage.sceneBuf.usedTextureIds);
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
                )}ms vertices=${sceneStage.sceneBuf.vertexCount()} indices=${
                    sceneStage.sceneBuf.indices.length
                } models=${
                    sceneStage.sceneModels.length
                } ${parts}`,
            );
        }
        const data = this.buildStaticMapData(
            input,
            sceneStage,
            minimapBlob,
            drawRanges,
            modelInfoTextures,
            heightMapTextureData,
            usedTextureIds,
            loadedTextures,
            npcVertices,
            npcIndices,
            npcDrawRangesBase,
            npcDrawRangesAlpha,
        );

        const runtimePayloads = buildMapRuntimePayloads({
            borderSize: sceneStage.borderSize,
            tileRenderFlags: sceneStage.scene.tileRenderFlags,
            locsAnimated: sceneStage.locsAnimated,
            npcTypeAnimationTable,
            npcOrderKeys: npcStage.npcOrderKeys,
            objRenderData: sceneStage.objRenderData,
        });

        return {
            data,
            runtimeRegistration: runtimePayloads.runtimeRegistration,
            runtimeBootstrap: runtimePayloads.runtimeBootstrap,
            runtimeCommandStreamInput,
            debugSceneCommandPlanDigest: sceneStage.debugSceneCommandPlanDigest,
            debugSceneCommandPlanOpsPacked: sceneStage.debugSceneCommandPlanOpsPacked,
            debugStageProfile: options?.debugIncludeStageProfile ? { ...profile } : undefined,
            debugTotalMs: options?.debugIncludeStageProfile ? totalMs : undefined,
        };
    }

    reset(): void {
        this.modelHashBuf = undefined;
        this.npcSpawnResolver.reset();
    }
}
