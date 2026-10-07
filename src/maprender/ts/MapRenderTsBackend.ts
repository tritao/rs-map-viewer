import { NpcSpawnResolver } from "../../data/npc/NpcSpawnResolver";
import { getWindowObjSpawns } from "../../data/obj/ObjSpawn";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { Scene } from "../../rs/scene/Scene";
import { LocLoadType } from "../../rs/scene/SceneBuilder";
import type { LocAnimatedData } from "../../runtime/LocAnimatedData";
import type { MapRuntimeBootstrap, MapRuntimeRegistration } from "../../runtime/MapRuntimePayload";
import { buildMapRuntimePayloads } from "../../runtime/MapRuntimePayload";
import type { NpcTypeAnimationEntry } from "../../runtime/NpcTypeAnimationTable";
import { createBootstrapData } from "../../runtime/sim/NpcBootstrap";
import { mapObjStateFromRenderData } from "../MapObjState";
import type { MapRenderBuildDeps } from "../MapRenderBackend";
import type { ObjRenderData } from "../MapRenderData";
import type { SdMapData } from "../MapRenderPayload";
import { SdMapLoaderInput } from "../MapRenderPayload";
import type { LocAnimatedGroupBuild } from "../build/LocRenderDataBuilder";
import { ModelHashBuffer } from "../build/ModelHashBuffer";
import type { BuiltNpcGeometry } from "../build/NpcGeometryBuilder";
import type { MapRenderCommandStreamRuntimeInput } from "../build/SceneDrawCommandBuilder";
import {
    buildDrawRangesFromBuckets,
    buildModelInfoTexturesFromBuckets,
    buildRuntimeCommandStreamInputFromBuckets,
    collectRuntimeDrawCommandBuckets,
} from "../build/SceneDrawCommandBuilder";
import {
    type SceneDrawPlan,
    type SceneDrawPlanDigest,
    emitSceneModelsToSceneGeometryBuffer,
    summarizeSceneDrawPlan,
} from "../build/SceneDrawPlan";
import { SceneGeometryBuffer, type SceneModel } from "../build/SceneGeometryBuffer";

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

type SceneBuildStageResult = Readonly<{
    borderSize: number;
    baseX: number;
    baseY: number;
    mapSize: number;
    scene: Scene;
    sceneBuf: SceneGeometryBuffer;
    sceneModels: SceneModel[];
    locsAnimated: LocAnimatedData[];
    objRenderData: ObjRenderData | undefined;
    debugSceneCommandPlanDigest?: SceneDrawPlanDigest;
    debugSceneCommandPlanOpsPacked?: Int32Array;
}>;

type NpcRuntimeStageResult = Readonly<{
    npcGeometry: BuiltNpcGeometry;
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

export class MapRenderTsBackend {
    modelHashBuf?: ModelHashBuffer;
    private readonly npcSpawnResolver = new NpcSpawnResolver();

    constructor(private readonly deps: MapRenderBuildDeps) {}

    private get cacheInfo() {
        return this.deps.contentSession.getMapRenderCacheInfo();
    }

    private get textureLoader() {
        return this.deps.contentSession.getMapRenderTextureLoader();
    }

    private get buildAdapter() {
        return this.deps.buildAdapter;
    }

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
        const { mapX, mapY, maxLevel, loadObjs, loadLocs, smoothTerrain, minimizeDrawCalls } =
            input;
        const textureLoader = this.textureLoader;

        const borderSize = 6;
        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        const scene = timeStep("buildScene", () =>
            this.buildAdapter.buildScene({
                mapX,
                mapY,
                borderSize,
                smoothTerrain,
                locLoadType: loadLocs ? LocLoadType.MODELS : LocLoadType.NO_MODELS,
                locPlacementOverrides: input.locPlacementOverrides,
            }),
        );

        const sceneBuf = new SceneGeometryBuffer(textureLoader, 100000);
        timeStep("addTerrain", () => sceneBuf.addTerrain(scene, borderSize, maxLevel));

        const sceneModels: SceneModel[] = [];
        let locAnimatedGroupsBuild: Iterable<LocAnimatedGroupBuild> = [];
        if (loadLocs) {
            const sceneLocs = timeStep("getSceneLocs", () =>
                this.buildAdapter.getSceneLocs({
                    scene,
                    borderSize,
                    maxLevel,
                }),
            );
            sceneModels.push(...sceneLocs.locs);
            locAnimatedGroupsBuild = timeStep("addLocEntities", () =>
                this.buildAdapter.addSceneLocEntities({
                    scene,
                    sceneModels,
                    locEntities: sceneLocs.locEntities,
                }),
            );
        }

        const objSpawns = loadObjs
            ? timeStep("getWindowObjSpawns", () =>
                  getWindowObjSpawns(this.deps.objSpawns, maxLevel, baseX, baseY, mapSize, mapSize),
              )
            : [];
        const objRenderData = timeStep("buildObjRenderData", () =>
            this.buildAdapter.buildObjRenderData({
                loadObjs,
                scene,
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
                const locAnimatedGroups = this.buildAdapter.buildLocAnimatedGroups({
                    sceneBuf,
                    buildGroups: locAnimatedGroupsBuild,
                });
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

        const npcSpawns = await timeStepAsync("resolveNpcSpawns", () =>
            this.buildAdapter.resolveNpcSpawns({
                npcSpawnResolver: this.npcSpawnResolver,
                loadNpcs,
                mapX,
                mapY,
                maxLevel,
                borderSize: sceneStage.borderSize,
                tileRenderFlagsLevel1: sceneStage.scene.tileRenderFlags[1],
                npcSpawnDecodeBackend: this.deps.npcSpawnDecodeBackend,
                fallbackNpcSpawns: this.deps.fallbackNpcSpawns,
                telemetry: npcSpawnTelemetry,
            }),
        );

        const npcGeometry = timeStep("buildNpcGeometry", () =>
            this.buildAdapter.buildNpcGeometry({
                loadNpcs,
                includeNpcAnimationFrames: options?.includeNpcAnimationFrames !== false,
                npcSpawns,
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
            cacheName: this.cacheInfo.name,
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

        const textureLoader = this.textureLoader;

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
                ? timeStep("flattenSceneTileHeights", () =>
                      flattenSceneTileHeights(sceneStage.scene),
                  )
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
                      this.buildAdapter.loadMinimapBlob({
                          scene: sceneStage.scene,
                          level: 0,
                          borderSize: sceneStage.borderSize,
                          drawMapFunctions: false,
                      }),
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
                } models=${sceneStage.sceneModels.length} ${parts}`,
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
            mapObjState: mapObjStateFromRenderData(sceneStage.objRenderData),
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
