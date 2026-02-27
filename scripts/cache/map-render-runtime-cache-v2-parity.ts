import path from "path";
import { pathToFileURL } from "url";

import type { NpcSpawn } from "../../src/data/npc/NpcSpawn";
import type { ObjSpawn } from "../../src/data/obj/ObjSpawn";
import { ModelHashBuffer, getModelHash } from "../../src/renderer/buffer/ModelHashBuffer";
import {
    SceneBuffer,
    collectTerrainTileVertexRecords,
    getModelFaces,
    isModelFaceTransparent,
    splitModelFacesByTransparency,
    summarizeTerrainGeometry,
} from "../../src/renderer/buffer/SceneBuffer";
import { collectRuntimeDrawCommandBuckets } from "../../src/renderer/buffer/SceneCommandBuilder";
import type { SceneCommandPlanDigest } from "../../src/renderer/buffer/SceneCommandPlan";
import { emitSceneModelsToSceneBuffer } from "../../src/renderer/buffer/SceneCommandPlan";
import { SdMapLoaderInput } from "../../src/renderer/loader/SdMapLoaderInput";
import { SdMapRenderDataTsBackend } from "../../src/renderer/loader/SdMapRenderDataTsBackend";
import type { SdMapRenderDataTsBackendDeps } from "../../src/renderer/loader/SdMapRenderDataTsBackend";
import { createSdTexturePacking } from "../../src/renderer/loader/SdTexturePacking";
import { isLowDetail } from "../../src/renderer/loc/SceneLocs";
import { getSceneLocs } from "../../src/renderer/loc/SceneLocs";
import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { LocModelType } from "../../src/rs/config/loctype/LocModelType";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { ModelData } from "../../src/rs/model/ModelData";
import { MapImageRenderer } from "../../src/rs/render/minimap/MapImageRenderer";
import { tryCreateCacheSession } from "../../src/rs/loaders/CacheSession";
import { getLocPlacementRotation, getLocPlacementType } from "../../src/rs/scene/LocPlacementFlag";
import {
    expandLocPlacementModelVariants,
    resolveLocTypeForPlacement,
} from "../../src/rs/scene/LocTypePlacementResolver";
import { Scene } from "../../src/rs/scene/Scene";
import {
    createSceneBuildContext,
    decodeLocsStage,
    decodeTerrainStage,
    fillEmptyTerrainStage,
} from "../../src/rs/scene/SceneBuildStages";
import { LocLoadType, SceneBuilder } from "../../src/rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../../src/rs/scene/buildSceneFromMapBytesProvider";
import { decodeLocPlacementsFromBytes } from "../../src/rs/scene/decodeLocPlacements";
import { getIdFromTag } from "../../src/rs/scene/entity/EntityTag";
import { LocModelLoader } from "../../src/rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../src/rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../../src/rs/scene/model/ObjModelLoader";
import type { MapRenderRuntimeBridgeV2 } from "../../src/wasm/MapRenderRuntimeBridgeAbi";
import {
    tryLoadBackendModule,
    runtimeDebugBuildMapPlanFromCacheWithWasm,
    runtimeDebugCollectMapInputDigestWithWasm,
    runtimeDebugDecodeCachedTerrainCellWithWasm,
    runtimeDebugDecodeLocTypeWithWasm,
    runtimeDebugDecodeOverlayTypeWithWasm,
    runtimeDebugGetCacheConfigWithWasm,
    runtimeDebugGetCachedCommandStreamArraysWithWasm,
    runtimeDebugGetCachedCommandStreamDigestWithWasm,
    runtimeDebugGetLastCommandProvenancePackedWithWasm,
    runtimeDebugGetLastLocMergeDecisionEntriesPackedWithWasm,
    runtimeDebugGetLastLocMergeEmitEntriesPackedWithWasm,
    runtimeDebugGetLastLocMergeNormalsTraceEntriesPackedWithWasm,
    runtimeDebugGetLastLocPreMergeGroupKeyEntriesPackedWithWasm,
    runtimeDebugGetLastLocPreMergeGroupKeySignaturesWithWasm,
    runtimeDebugGetLastLocRenderPlacementDigestWithWasm,
    runtimeDebugGetLastLocRenderPlacementEntriesPackedWithWasm,
    runtimeDebugGetLastMapInputHashesWithWasm,
    runtimeDebugGetLastSceneBucketsDigestWithWasm,
    runtimeDebugGetLastSceneCommandPlanDigestWithWasm,
    runtimeDebugGetLastSceneCommandPlanOpProvenancePackedWithWasm,
    runtimeDebugGetLastSceneCommandPlanOpsPackedWithWasm,
    runtimeDebugGetLastTerrainDigestSamplesPackedWithWasm,
    runtimeDebugGetLastTerrainDigestWithWasm,
    runtimeDebugGetLastTerrainProbeWithWasm,
    runtimeDebugGetLastTerrainTileFaceCountsWithWasm,
    runtimeDebugGetLastWorldHeightProbeWithWasm,
    runtimeDebugGetLastBuildStatsWithWasm,
    runtimeDebugGetLoadedHeightHashWithWasm,
    runtimeDebugGetLocModelVerticesSampleWithWasm,
    runtimeDebugGetModelFacesDigestWithWasm,
    runtimeDebugGetModelVerticesDigestWithWasm,
    runtimeDebugGetModelVerticesSampleRangeWithWasm,
    runtimeDebugGetModelVerticesSampleWithWasm,
    runtimeDebugSetTerrainDigestSampleStartVertexWithWasm,
    runtimeDebugSetTerrainProbeWithWasm,
    runtimeDebugSetWorldHeightProbeWithWasm,
} from "../../src/wasm/rs_map_render_backend_debug.mjs";
import {
    createByteDrivenSceneBuildInput,
    uploadRuntimeCacheForBuildRequest,
} from "../../src/worker/runtime-cache/MapRenderRuntimeCacheV2Uploader";
import { runtimePacketToPayloadOverlay } from "../../src/worker/MapRenderDataContract";
import type { SdMapData } from "../../src/renderer/loader/SdMapData";
import type { MapRenderRuntimePacket } from "../../src/worker/MapRenderDataContract";
import { loadCache, loadCacheInfos } from "./load-util";

type Args = Readonly<{
    cacheName?: string;
    limit: number;
    mode: "default" | "models-targeted" | "anim-maya-targeted";
    squares?: ReadonlyArray<Square>;
    stages: boolean;
    summaryOnly: boolean;
    quiet: boolean;
    profile: "full" | "terrain-only" | "terrain-locs" | "terrain-locs-objs";
    matrix: boolean;
    listFailingSquares: boolean;
    debugStage?: StageKey;
}>;
type Square = Readonly<{ mapX: number; mapY: number }>;
type ParityProfile = Readonly<{
    name: Args["profile"];
    loadLocs: boolean;
    loadObjs: boolean;
    loadNpcs: boolean;
}>;

type RuntimeOverlay = Readonly<{
    heightMapTextureData: Int16Array;
    drawRanges: SdMapData["drawRanges"];
    modelInfoTextures: SdMapData["modelInfoTextures"];
}>;

type PacketDigest = Readonly<{
    heightMap: number;
    drawRanges: number;
    modelInfo: number;
    vertices: number;
    indices: number;
}>;

const DRAW_BUCKET_KEYS = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
] as const;

type RuntimeCommandDigest = Readonly<{
    totalCmdCount: number;
    cmdBucketIndicesHash: number;
    cmdOffsetsHash: number;
    cmdElementsHash: number;
    cmdInstanceCountsHash: number;
    cmdPackedInstancesHash: number;
    verticesHash: number;
    indicesHash: number;
    bucketCmdCounts: number[];
}>;

const FORCE_LOG = console.log.bind(console);

function logSummary(message: string): void {
    FORCE_LOG(message);
}

function setQuietMode(quiet: boolean): void {
    if (!quiet) {
        return;
    }
    const noOp = () => undefined;
    console.log = noOp;
    console.info = noOp;
    console.debug = noOp;
    console.time = noOp;
    console.timeEnd = noOp;
}

function describeCollectMapInputReason(reason: number): string {
    switch (reason | 0) {
        case 1:
            return "ok";
        case 2:
            return "invalid_arg";
        case 3:
            return "no_squares_in_window";
        case 4:
            return "terrain_bytes_capacity";
        case 5:
            return "loc_bytes_capacity";
        case 6:
            return "other";
        default:
            return "none";
    }
}

type RuntimeBridge = MapRenderRuntimeBridgeV2 &
    Record<string, any> &
    Readonly<{
        createRuntime?: () => Promise<number | undefined>;
        debugSetTerrainProbe?: (
            runtimeHandle: number,
            level: number,
            tileX: number,
            tileY: number,
        ) => Promise<boolean | undefined>;
        debugGetRuntimeLastTerrainProbe?: (runtimeHandle: number) => Promise<
            | {
                  hit: boolean;
                  level: number;
                  tileX: number;
                  tileY: number;
                  packed: Int32Array;
              }
            | undefined
        >;
        debugGetRuntimeLastTerrainTileFaceCounts?: (runtimeHandle: number) => Promise<
            | {
                  levels: number;
                  width: number;
                  height: number;
                  border: number;
                  counts: Uint8Array;
              }
            | undefined
        >;
        debugGetRuntimeLastTerrainDigest?: (runtimeHandle: number) => Promise<
            | {
                  levels: number;
                  facesTotal: number;
                  verticesTotal: number;
                  levelFaces: number[];
                  levelVertices: number[];
                  hash: number;
              }
            | undefined
        >;
        debugGetRuntimeModelFacesDigest?: (
            runtimeHandle: number,
            modelId: number,
        ) => Promise<
            | {
                  faceCount: number;
                  opaqueCount: number;
                  transparentCount: number;
                  hash: number;
              }
            | undefined
        >;
        debugGetRuntimeLastLocRenderPlacementDigest?: (runtimeHandle: number) => Promise<
            | {
                  count: number;
                  hash: number;
              }
            | undefined
        >;
        debugGetRuntimeLastLocPreMergeGroupKeySignatures?: (
            runtimeHandle: number,
        ) => Promise<Int32Array | undefined>;
        debugGetRuntimeLastLocPreMergeGroupKeyEntriesPacked?: (
            runtimeHandle: number,
        ) => Promise<Int32Array | undefined>;
        debugGetRuntimeLastLocMergeDecisionEntriesPacked?: (
            runtimeHandle: number,
        ) => Promise<Int32Array | undefined>;
        debugGetRuntimeLastLocMergeNormalsTraceEntriesPacked?: (
            runtimeHandle: number,
        ) => Promise<Int32Array | undefined>;
        debugGetRuntimeLastCommandProvenancePacked?: (
            runtimeHandle: number,
        ) => Promise<Int32Array | undefined>;
        getRuntimeCachedCommandStreamDigest: (runtimeHandle: number) => Promise<unknown>;
        getRuntimeCachedCommandStreamArrays: (runtimeHandle: number) => Promise<
            | {
                  cmdBucketIndices: Int32Array;
                  cmdOffsets: Int32Array;
                  cmdElements: Int32Array;
                  cmdInstanceCounts: Int32Array;
                  cmdPackedInstances: Int32Array;
                  vertices: Uint8Array;
                  indices: Int32Array;
              }
            | undefined
        >;
        debugDecodeRuntimeOverlayType?: (
            runtimeHandle: number,
            overlayTypeId: number,
        ) => Promise<
            | {
                  primaryRgb: number;
                  primaryHsl: number;
                  textureId: number;
                  secondaryTextureId: number;
                  blendRgb: number;
                  blendHsl: number;
                  blendable: boolean;
                  blendPriority: number;
                  hideUnderlay: boolean;
                  occludes: boolean;
                  textureSize: number;
                  blockShadow: boolean;
              }
            | undefined
        >;
        debugDecodeRuntimeLocType?: (
            runtimeHandle: number,
            locTypeId: number,
        ) => Promise<
            | {
                  id: number;
                  resolvedId: number;
                  mergeNormals: boolean;
                  resolvedMergeNormals: boolean;
                  contourGroundType: number;
                  resolvedContourGroundType: number;
                  contouredGround: number;
                  resolvedContouredGround: number;
                  contourGroundParam: number;
                  resolvedContourGroundParam: number;
                  hasTypes: boolean;
                  resolvedHasTypes: boolean;
                  typeCount: number;
                  resolvedTypeCount: number;
                  modelGroupCount: number;
                  resolvedModelGroupCount: number;
                  modelIdCount: number;
                  resolvedModelIdCount: number;
                  firstType: number;
                  resolvedFirstType: number;
                  firstModelId: number;
                  resolvedFirstModelId: number;
                  transformsCount: number;
                  transformVarbit: number;
                  transformVarp: number;
                  transformIndex: number;
                  transformId: number;
                  resolvedFromTransform: boolean;
              }
            | undefined
        >;
    }>;

async function withBackendModule<T>(fn: (backendModule: any) => T): Promise<T | undefined> {
    const backendModule = await tryLoadBackendModule();
    if (!backendModule) {
        return undefined;
    }
    return fn(backendModule);
}

function createScriptDebugWrappers(): Partial<RuntimeBridge> {
    return {
        async debugCollectCachedMapInputDigest(runtimeHandle: number, sceneBuildInput: unknown) {
            const backendModule = await tryLoadBackendModule();
            if (!backendModule) {
                return undefined;
            }
            return runtimeDebugCollectMapInputDigestWithWasm(
                backendModule,
                runtimeHandle,
                sceneBuildInput,
            );
        },
        async getRuntimeCachedCommandStreamDigest(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetCachedCommandStreamDigestWithWasm(m, runtimeHandle));
        },
        async getRuntimeCachedCommandStreamArrays(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetCachedCommandStreamArraysWithWasm(m, runtimeHandle));
        },
        async debugGetRuntimeLastBuildStats(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetLastBuildStatsWithWasm(m, runtimeHandle));
        },
        async debugGetRuntimeCacheConfig(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetCacheConfigWithWasm(m, runtimeHandle));
        },
        async debugGetRuntimeLoadedHeightHash(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetLoadedHeightHashWithWasm(m, runtimeHandle));
        },
        async debugGetRuntimeMapInputHashes(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetLastMapInputHashesWithWasm(m, runtimeHandle));
        },
        async debugDecodeCachedTerrainCell(
            runtimeHandle: number,
            mapX: number,
            mapY: number,
            level: number,
            localX: number,
            localY: number,
        ) {
            return withBackendModule((m) =>
                runtimeDebugDecodeCachedTerrainCellWithWasm(
                    m,
                    runtimeHandle,
                    mapX,
                    mapY,
                    level,
                    localX,
                    localY,
                ),
            );
        },
        async debugGetRuntimeLastTerrainTileFaceCounts(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastTerrainTileFaceCountsWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastTerrainDigest(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetLastTerrainDigestWithWasm(m, runtimeHandle));
        },
        async debugSetTerrainDigestSampleStartVertex(runtimeHandle: number, startVertex: number) {
            return (
                (await withBackendModule((m) =>
                    runtimeDebugSetTerrainDigestSampleStartVertexWithWasm(
                        m,
                        runtimeHandle,
                        startVertex,
                    ),
                )) ?? false
            );
        },
        async debugSetTerrainProbe(runtimeHandle: number, level: number, tileX: number, tileY: number) {
            return (
                (await withBackendModule((m) =>
                    runtimeDebugSetTerrainProbeWithWasm(m, runtimeHandle, level, tileX, tileY),
                )) ?? false
            );
        },
        async debugGetRuntimeLastTerrainProbe(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetLastTerrainProbeWithWasm(m, runtimeHandle));
        },
        async debugSetWorldHeightProbe(runtimeHandle: number, level: number, worldX: number, worldZ: number) {
            return (
                (await withBackendModule((m) =>
                    runtimeDebugSetWorldHeightProbeWithWasm(m, runtimeHandle, level, worldX, worldZ),
                )) ?? false
            );
        },
        async debugGetRuntimeLastWorldHeightProbe(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetLastWorldHeightProbeWithWasm(m, runtimeHandle));
        },
        async debugGetRuntimeLastTerrainDigestSamplesPacked(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastTerrainDigestSamplesPackedWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastSceneCommandPlanDigest(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastSceneCommandPlanDigestWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastSceneCommandPlanOpsPacked(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastSceneCommandPlanOpsPackedWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastSceneCommandPlanOpProvenancePacked(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastSceneCommandPlanOpProvenancePackedWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastSceneBucketsDigest(runtimeHandle: number) {
            return withBackendModule((m) => runtimeDebugGetLastSceneBucketsDigestWithWasm(m, runtimeHandle));
        },
        async debugGetRuntimeLastLocRenderPlacementDigest(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastLocRenderPlacementDigestWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastLocRenderPlacementEntriesPacked(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastLocRenderPlacementEntriesPackedWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeModelFacesDigest(runtimeHandle: number, modelId: number) {
            return withBackendModule((m) => runtimeDebugGetModelFacesDigestWithWasm(m, runtimeHandle, modelId));
        },
        async debugGetRuntimeModelVerticesDigest(runtimeHandle: number, modelId: number) {
            return withBackendModule((m) => runtimeDebugGetModelVerticesDigestWithWasm(m, runtimeHandle, modelId));
        },
        async debugGetRuntimeModelVerticesSample(runtimeHandle: number, modelId: number, maxVertices: number) {
            void maxVertices;
            return withBackendModule((m) =>
                runtimeDebugGetModelVerticesSampleWithWasm(m, runtimeHandle, modelId),
            );
        },
        async debugGetRuntimeModelVerticesSampleRange(
            runtimeHandle: number,
            modelId: number,
            startVertex: number,
            maxVertices: number,
        ) {
            void maxVertices;
            return withBackendModule((m) =>
                runtimeDebugGetModelVerticesSampleRangeWithWasm(m, runtimeHandle, modelId, startVertex),
            );
        },
        async debugGetRuntimeLocModelVerticesSample(runtimeHandle: number, locTypeId: number, placementType: number, rotation: number, modelId: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLocModelVerticesSampleWithWasm(
                    m,
                    runtimeHandle,
                    locTypeId,
                    placementType,
                    rotation,
                    modelId,
                ),
            );
        },
        async debugGetRuntimeLastLocPreMergeGroupKeySignatures(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastLocPreMergeGroupKeySignaturesWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastLocPreMergeGroupKeyEntriesPacked(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastLocPreMergeGroupKeyEntriesPackedWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastLocMergeDecisionEntriesPacked(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastLocMergeDecisionEntriesPackedWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastLocMergeNormalsTraceEntriesPacked(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastLocMergeNormalsTraceEntriesPackedWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastLocMergeEmitEntriesPacked(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastLocMergeEmitEntriesPackedWithWasm(m, runtimeHandle),
            );
        },
        async debugGetRuntimeLastCommandProvenancePacked(runtimeHandle: number) {
            return withBackendModule((m) =>
                runtimeDebugGetLastCommandProvenancePackedWithWasm(m, runtimeHandle),
            );
        },
        async debugBuildMapPlanFromCache(runtimeHandle: number, request: any) {
            const backendModule = await tryLoadBackendModule();
            if (!backendModule) {
                return false;
            }
            return runtimeDebugBuildMapPlanFromCacheWithWasm(backendModule, runtimeHandle, request);
        },
        async debugDecodeRuntimeOverlayType(runtimeHandle: number, overlayId: number) {
            return withBackendModule((m) =>
                runtimeDebugDecodeOverlayTypeWithWasm(m, runtimeHandle, overlayId),
            );
        },
        async debugDecodeRuntimeLocType(runtimeHandle: number, locTypeId: number) {
            return withBackendModule((m) => runtimeDebugDecodeLocTypeWithWasm(m, runtimeHandle, locTypeId));
        },
    };
}

function buildRuntimeRequest(sceneBuildInput: Record<string, unknown>) {
    const sizeX = (sceneBuildInput.sizeX as number) | 0;
    const sizeY = (sceneBuildInput.sizeY as number) | 0;
    const baseX = (sceneBuildInput.baseX as number) | 0;
    const baseY = (sceneBuildInput.baseY as number) | 0;
    const mapSquareSize = 64;
    if (sizeX <= 0 || sizeY <= 0) return undefined;
    const borderX = ((sizeX - mapSquareSize) / 2) | 0;
    const borderY = ((sizeY - mapSquareSize) / 2) | 0;
    if (
        borderX < 0 ||
        borderY < 0 ||
        borderX !== borderY ||
        sizeX !== mapSquareSize + borderX * 2 ||
        sizeY !== mapSquareSize + borderY * 2
    ) {
        return undefined;
    }
    const borderSize = borderX;
    return {
        mapX: Math.floor((baseX + borderSize) / mapSquareSize) | 0,
        mapY: Math.floor((baseY + borderSize) / mapSquareSize) | 0,
        borderSize,
        sizeX,
        sizeY,
        cacheGame: (sceneBuildInput.cacheGame as number) | 0,
        cacheRevision: (sceneBuildInput.cacheRevision as number) | 0,
        unitsTileHeightBasis: (sceneBuildInput.unitsTileHeightBasis as number) | 0,
        smoothTerrain: !!sceneBuildInput.smoothTerrain,
        locLoadType: (sceneBuildInput.locLoadType as number) | 0,
        loadLocs: sceneBuildInput.loadLocs !== false,
        loadObjs: sceneBuildInput.loadObjs !== false,
        loadNpcs: sceneBuildInput.loadNpcs !== false,
    };
}

function snapshotVarpValues(varProvider: unknown): Int32Array {
    const provider = varProvider as
        | {
              varManager?: { values?: Int32Array };
              values?: Int32Array;
          }
        | undefined;
    const managerValues = provider?.varManager?.values;
    if (managerValues instanceof Int32Array) return new Int32Array(managerValues);
    const directValues = provider?.values;
    if (directValues instanceof Int32Array) return new Int32Array(directValues);
    return new Int32Array(0);
}

function parseArgs(argv: string[]): Args {
    let cacheName: string | undefined;
    let limit = 4;
    let mode: Args["mode"] = "default";
    let squares: Square[] | undefined;
    let stages = false;
    let summaryOnly = false;
    let quiet = false;
    let profile: Args["profile"] = "full";
    let matrix = false;
    let listFailingSquares = false;
    let debugStage: StageKey | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") cacheName = argv[++i];
        else if (arg === "--limit") limit = Number(argv[++i]);
        else if (arg === "--mode") {
            const value = (argv[++i] ?? "").toLowerCase();
            if (value === "models-targeted") {
                mode = "models-targeted";
            } else if (value === "anim-maya-targeted") {
                mode = "anim-maya-targeted";
            }
        } else if (arg === "--squares") {
            const raw = argv[++i] ?? "";
            const parsed: Square[] = [];
            const tokens = raw
                .split(/[;,]/)
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
            for (let t = 0; t < tokens.length; t++) {
                const parts = tokens[t].split(":");
                if (parts.length !== 2) {
                    throw new Error("Invalid --squares format; expected mapX:mapY[,mapX:mapY]");
                }
                const mapX = Number(parts[0]);
                const mapY = Number(parts[1]);
                if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) {
                    throw new Error("Invalid --squares value");
                }
                parsed.push({ mapX: mapX | 0, mapY: mapY | 0 });
            }
            squares = parsed;
        } else if (arg === "--stages") {
            stages = true;
        } else if (arg === "--summary-only") {
            summaryOnly = true;
        } else if (arg === "--quiet") {
            quiet = true;
        } else if (arg === "--profile") {
            const value = (argv[++i] ?? "").toLowerCase();
            if (
                value === "full" ||
                value === "terrain-only" ||
                value === "terrain-locs" ||
                value === "terrain-locs-objs"
            ) {
                profile = value;
            } else {
                throw new Error(
                    "Invalid --profile. Expected full|terrain-only|terrain-locs|terrain-locs-objs",
                );
            }
        } else if (arg === "--matrix") {
            matrix = true;
        } else if (arg === "--list-failing-squares") {
            listFailingSquares = true;
        } else if (arg === "--debug-stage") {
            const raw = String(argv[++i] ?? "");
            const key = raw as StageKey;
            if (!STAGE_KEYS.includes(key)) {
                throw new Error(`Invalid --debug-stage. Expected one of: ${STAGE_KEYS.join(",")}`);
            }
            debugStage = key;
        }
    }
    if (!Number.isFinite(limit) || limit <= 0) throw new Error("Invalid --limit");
    return {
        cacheName,
        limit: limit | 0,
        mode,
        squares,
        stages,
        summaryOnly,
        quiet,
        profile,
        matrix,
        listFailingSquares,
        debugStage,
    };
}

function resolveProfiles(args: Args): ParityProfile[] {
    if (args.matrix) {
        return [
            { name: "terrain-only", loadLocs: false, loadObjs: false, loadNpcs: false },
            { name: "terrain-locs", loadLocs: true, loadObjs: false, loadNpcs: false },
            { name: "terrain-locs-objs", loadLocs: true, loadObjs: true, loadNpcs: false },
            { name: "full", loadLocs: true, loadObjs: true, loadNpcs: true },
        ];
    }
    switch (args.profile) {
        case "terrain-only":
            return [{ name: "terrain-only", loadLocs: false, loadObjs: false, loadNpcs: false }];
        case "terrain-locs":
            return [{ name: "terrain-locs", loadLocs: true, loadObjs: false, loadNpcs: false }];
        case "terrain-locs-objs":
            return [{ name: "terrain-locs-objs", loadLocs: true, loadObjs: true, loadNpcs: false }];
        case "full":
        default:
            return [{ name: "full", loadLocs: true, loadObjs: true, loadNpcs: true }];
    }
}

type StageKey =
    | "input"
    | "commandStream"
    | "packet"
    | "sceneLightStage"
    | "terrainDigestStage"
    | "sceneCommandPlanStage"
    | "sceneCommandPlanOpsStage"
    | "sceneBucketsStage"
    | "locRenderPlacementStage"
    | "modelFacesStage"
    | "locVariantStage"
    | "locVariantDropStage"
    | "locPreMergeGroupKeyStage"
    | "locPreMergeSignatureStage"
    | "locMergeDummyStage"
    | "planOnlySelfCheckStage";

type StageResult = Readonly<{
    key: StageKey;
    ok: boolean;
    detail?: string;
}>;

const STAGE_KEYS: ReadonlyArray<StageKey> = [
    "input",
    "commandStream",
    "packet",
    "sceneLightStage",
    "terrainDigestStage",
    "sceneCommandPlanStage",
    "sceneCommandPlanOpsStage",
    "sceneBucketsStage",
    "locRenderPlacementStage",
    "modelFacesStage",
    "locVariantStage",
    "locVariantDropStage",
    "locPreMergeGroupKeyStage",
    "locPreMergeSignatureStage",
    "locMergeDummyStage",
    "planOnlySelfCheckStage",
];

// All stages are gating now.
const NON_GATING_STAGE_KEYS: ReadonlySet<StageKey> = new Set<StageKey>();

function createStageFailureCounter(): Record<StageKey, number> {
    return {
        input: 0,
        commandStream: 0,
        packet: 0,
        sceneLightStage: 0,
        terrainDigestStage: 0,
        sceneCommandPlanStage: 0,
        sceneCommandPlanOpsStage: 0,
        sceneBucketsStage: 0,
        locRenderPlacementStage: 0,
        modelFacesStage: 0,
        locVariantStage: 0,
        locVariantDropStage: 0,
        locPreMergeGroupKeyStage: 0,
        locPreMergeSignatureStage: 0,
        locMergeDummyStage: 0,
        planOnlySelfCheckStage: 0,
    };
}

function createStageFailureSquareList(): Record<StageKey, string[]> {
    const out = {} as Record<StageKey, string[]>;
    for (let i = 0; i < STAGE_KEYS.length; i++) {
        out[STAGE_KEYS[i]] = [];
    }
    return out;
}

function formatStageFailureSummary(stageFailures: Record<StageKey, number>): string {
    return STAGE_KEYS.map((key) => `${key}=${stageFailures[key] | 0}`).join(" ");
}

function compareInputDigests(
    jsDigest: ReturnType<typeof digestJsMapInput>,
    cacheDigestRaw: unknown,
): StageResult {
    if (!cacheDigestRaw || typeof cacheDigestRaw !== "object") {
        // Runtime collect-map-input digest intentionally reports NotFound when no map-square bytes
        // exist in the request window; TS digest in that case is the empty sentinel.
        if (
            (jsDigest.mapCount | 0) === 0 &&
            (jsDigest.terrainBytesLength | 0) === 0 &&
            (jsDigest.locBytesLength | 0) === 0
        ) {
            return { key: "input", ok: true };
        }
        return { key: "input", ok: false, detail: "missing-cache-input-digest" };
    }
    const cacheDigest = cacheDigestRaw as Record<string, unknown>;
    const fields: Array<keyof ReturnType<typeof digestJsMapInput>> = [
        "mapCount",
        "terrainBytesLength",
        "locBytesLength",
        "mapSquareIdsHash",
        "terrainOffsetsHash",
        "terrainLengthsHash",
        "terrainBytesHash",
        "locBytesHash",
    ];
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const js = jsDigest[field] | 0;
        const cache = Number(cacheDigest[field] ?? 0) | 0;
        if (js !== cache) {
            return { key: "input", ok: false, detail: `${field}: ts=${js} cache=${cache}` };
        }
    }
    return { key: "input", ok: true };
}

function compareCommandDigests(
    tsDigest: RuntimeCommandDigest | undefined,
    cacheDigestRaw: unknown,
): StageResult {
    if (!tsDigest) return { key: "commandStream", ok: false, detail: "missing-ts-command-digest" };
    const cacheDigest = normalizeRuntimeCommandDigest(cacheDigestRaw);
    if (!cacheDigest) {
        return { key: "commandStream", ok: false, detail: "missing-cache-command-digest" };
    }
    const first = firstRuntimeCommandDigestMismatch(tsDigest, cacheDigest);
    if (first) return { key: "commandStream", ok: false, detail: first };
    return { key: "commandStream", ok: true };
}

function comparePacketDigests(
    tsPayload: SdMapData,
    cacheOverlay: RuntimeOverlay | undefined,
    cachePacket: MapRenderRuntimePacket | undefined,
): StageResult {
    if (!cacheOverlay) return { key: "packet", ok: false, detail: "missing-cache-overlay" };
    if (!cachePacket) return { key: "packet", ok: false, detail: "missing-cache-packet" };
    const expected = digestPacketPayload(tsPayload);
    const actual = digestRuntimePacket(cacheOverlay, cachePacket);
    const mismatchKeys = (Object.keys(expected) as Array<keyof PacketDigest>).filter(
        (k) => expected[k] !== actual[k],
    );
    if (mismatchKeys.length > 0) {
        return {
            key: "packet",
            ok: false,
            detail: mismatchKeys.map((k) => `${k}:ts=${expected[k]} cache=${actual[k]}`).join(", "),
        };
    }
    return { key: "packet", ok: true };
}

function compareTerrainDigestStageDigests(
    tsDigest: ReturnType<typeof summarizeTerrainGeometry> | undefined,
    cacheDigest: unknown,
): StageResult {
    if (!tsDigest) {
        return { key: "terrainDigestStage", ok: false, detail: "missing-ts-terrain-digest" };
    }
    if (!cacheDigest || typeof cacheDigest !== "object") {
        return { key: "terrainDigestStage", ok: false, detail: "missing-cache-terrain-digest" };
    }
    const cache = cacheDigest as Record<string, unknown>;
    const cacheLevels = Number(cache.levels ?? 0) | 0;
    const cacheFaces = Number(cache.facesTotal ?? 0) | 0;
    const cacheVertices = Number(cache.verticesTotal ?? 0) | 0;
    const cacheHash = Number(cache.hash ?? 0) | 0;
    if ((tsDigest.levels | 0) !== cacheLevels) {
        return {
            key: "terrainDigestStage",
            ok: false,
            detail: `levels: ts=${tsDigest.levels | 0} cache=${cacheLevels}`,
        };
    }
    if ((tsDigest.facesTotal | 0) !== cacheFaces) {
        return {
            key: "terrainDigestStage",
            ok: false,
            detail: `facesTotal: ts=${tsDigest.facesTotal | 0} cache=${cacheFaces}`,
        };
    }
    if ((tsDigest.verticesTotal | 0) !== cacheVertices) {
        return {
            key: "terrainDigestStage",
            ok: false,
            detail: `verticesTotal: ts=${tsDigest.verticesTotal | 0} cache=${cacheVertices}`,
        };
    }
    if ((tsDigest.hash | 0) >>> 0 !== (cacheHash | 0) >>> 0) {
        return {
            key: "terrainDigestStage",
            ok: false,
            detail: `hash: ts=${(tsDigest.hash | 0) >>> 0} cache=${(cacheHash | 0) >>> 0}`,
        };
    }
    const tsLevelFaces = tsDigest.levelFaces ?? [];
    const tsLevelVertices = tsDigest.levelVertices ?? [];
    const cacheLevelFaces = Array.isArray(cache.levelFaces) ? (cache.levelFaces as number[]) : [];
    const cacheLevelVertices = Array.isArray(cache.levelVertices)
        ? (cache.levelVertices as number[])
        : [];
    for (let i = 0; i < 4; i++) {
        const tsF = (tsLevelFaces[i] ?? 0) | 0;
        const cacheF = (cacheLevelFaces[i] ?? 0) | 0;
        if (tsF !== cacheF) {
            return {
                key: "terrainDigestStage",
                ok: false,
                detail: `levelFaces[${i}]: ts=${tsF} cache=${cacheF}`,
            };
        }
        const tsV = (tsLevelVertices[i] ?? 0) | 0;
        const cacheV = (cacheLevelVertices[i] ?? 0) | 0;
        if (tsV !== cacheV) {
            return {
                key: "terrainDigestStage",
                ok: false,
                detail: `levelVertices[${i}]: ts=${tsV} cache=${cacheV}`,
            };
        }
    }
    return { key: "terrainDigestStage", ok: true };
}

function computeTerrainDigestSamplePackedFromTsDigest(
    scene: Scene,
    borderSize: number,
    maxLevel: number,
    textureIdIndexMap: ReadonlyMap<number, number>,
    limitVertices: number,
    startVertex: number = 0,
): { count: number; stride: number; packed: Int32Array } {
    const startX = borderSize;
    const startY = borderSize;
    const endX = borderSize + Scene.MAP_SQUARE_SIZE;
    const endY = borderSize + Scene.MAP_SQUARE_SIZE;
    const vertexOffset = borderSize * -128;

    const stride = 10;
    const out: number[] = [];
    let count = 0;
    let h = 2166136261 >>> 0;
    let cursor = 0;
    const start = Math.max(0, startVertex | 0);

    const fnv1a32UpdateInt = (hash: number, value: number): number => {
        const x = ((hash >>> 0) ^ (value >>> 0)) >>> 0;
        return Math.imul(x, 16777619) >>> 0;
    };
    const quantizeUv = (v: number): number => ((v * 4096) | 0) as number;

    for (let level = 0; level < scene.levels; level++) {
        for (let x = startX; x < endX; x++) {
            for (let y = startY; y < endY; y++) {
                const tile = scene.tiles[level][x][y];
                if (!tile || tile.minLevel > maxLevel) continue;
                const tileModel = tile.tileModel;
                const faceCount = tileModel?.faces.length ?? 0;
                if (faceCount === 0) continue;

                const vertices = collectTerrainTileVertexRecords(tile, vertexOffset, vertexOffset);
                for (let i = 0; i < vertices.length; i++) {
                    const v = vertices[i];
                    const tex0 = (textureIdIndexMap.get(v.textureId) ?? -1) | 0;
                    const tex1 = (textureIdIndexMap.get(v.textureId1) ?? -1) | 0;
                    const qU = quantizeUv(v.u);
                    const qV = quantizeUv(v.v);
                    const blendI = (v.texBlend | 0) as number;
                    h = fnv1a32UpdateInt(h, v.x | 0);
                    h = fnv1a32UpdateInt(h, v.y | 0);
                    h = fnv1a32UpdateInt(h, v.z | 0);
                    h = fnv1a32UpdateInt(h, v.hsl | 0);
                    h = fnv1a32UpdateInt(h, qU | 0);
                    h = fnv1a32UpdateInt(h, qV | 0);
                    h = fnv1a32UpdateInt(h, tex0 | 0);
                    h = fnv1a32UpdateInt(h, tex1 | 0);
                    h = fnv1a32UpdateInt(h, blendI | 0);

                    if (cursor >= start) {
                        if (count >= limitVertices) {
                            return { count, stride, packed: new Int32Array(out) };
                        }
                        out.push(
                            v.x | 0,
                            v.y | 0,
                            v.z | 0,
                            v.hsl | 0,
                            qU | 0,
                            qV | 0,
                            tex0 | 0,
                            tex1 | 0,
                            blendI | 0,
                            h | 0,
                        );
                        count++;
                    }
                    cursor++;
                }
            }
        }
    }

    return { count, stride, packed: new Int32Array(out) };
}

function compareSceneCommandPlanStageDigests(
    tsDigest: SceneCommandPlanDigest | undefined,
    cacheDigest: unknown,
): StageResult {
    if (!tsDigest) {
        return {
            key: "sceneCommandPlanStage",
            ok: false,
            detail: "missing-ts-scene-command-plan-digest",
        };
    }
    if (!cacheDigest || typeof cacheDigest !== "object") {
        return {
            key: "sceneCommandPlanStage",
            ok: false,
            detail: "missing-cache-scene-command-plan-digest",
        };
    }
    const cache = cacheDigest as Record<string, unknown>;
    const fields: Array<keyof SceneCommandPlanDigest> = [
        "opCount",
        "mergedGroupOpCount",
        "instancedOpCount",
        "instancedFacesTotal",
        "instancedInstancesTotal",
        "instancedLodInstancesTotal",
    ];
    for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        const ts = (tsDigest[f] ?? 0) | 0;
        const ca = Number(cache[f] ?? 0) | 0;
        if (ts !== ca) {
            return {
                key: "sceneCommandPlanStage",
                ok: false,
                detail: `${f}: ts=${ts} cache=${ca}`,
            };
        }
    }
    if (tsDigest.seqHash >>> 0 !== Number(cache.seqHash ?? 0) >>> 0) {
        return {
            key: "sceneCommandPlanStage",
            ok: false,
            detail: `seqHash: ts=${tsDigest.seqHash >>> 0} cache=${
                Number(cache.seqHash ?? 0) >>> 0
            }`,
        };
    }
    if (tsDigest.multisetHashSum >>> 0 !== Number(cache.multisetHashSum ?? 0) >>> 0) {
        return {
            key: "sceneCommandPlanStage",
            ok: false,
            detail: `multisetHashSum: ts=${tsDigest.multisetHashSum >>> 0} cache=${
                Number(cache.multisetHashSum ?? 0) >>> 0
            }`,
        };
    }
    if (tsDigest.multisetHashXor >>> 0 !== Number(cache.multisetHashXor ?? 0) >>> 0) {
        return {
            key: "sceneCommandPlanStage",
            ok: false,
            detail: `multisetHashXor: ts=${tsDigest.multisetHashXor >>> 0} cache=${
                Number(cache.multisetHashXor ?? 0) >>> 0
            }`,
        };
    }
    return { key: "sceneCommandPlanStage", ok: true };
}

function decodePackedSceneCommandPlanOp(packed: Int32Array, opIndex: number): unknown {
    const stride = 6;
    const base = (opIndex | 0) * stride;
    if (base < 0 || base + stride > packed.length) {
        return undefined;
    }
    const kind = packed[base + 0] | 0;
    const transparent = (packed[base + 1] | 0) !== 0;
    if (kind === 2) {
        return {
            kind: "mergedGroup",
            transparent,
            lowDetail: (packed[base + 2] | 0) !== 0,
            level: packed[base + 3] | 0,
            priority: packed[base + 4] | 0,
            modelCount: packed[base + 5] | 0,
        };
    }
    return {
        kind: "instanced",
        transparent,
        modelHash: packed[base + 2] | 0,
        faceCount: packed[base + 3] | 0,
        instanceCount: packed[base + 4] | 0,
        lodInstanceCount: packed[base + 5] | 0,
    };
}

function compareSceneCommandPlanOpsPackedStage(
    tsPacked: Int32Array | undefined,
    cachePacked: unknown,
): StageResult {
    if (!tsPacked) {
        return {
            key: "sceneCommandPlanOpsStage",
            ok: false,
            detail: "missing-ts-scene-command-plan-ops",
        };
    }
    if (!(cachePacked instanceof Int32Array)) {
        return {
            key: "sceneCommandPlanOpsStage",
            ok: false,
            detail: "missing-cache-scene-command-plan-ops",
        };
    }
    if (tsPacked.length !== cachePacked.length) {
        return {
            key: "sceneCommandPlanOpsStage",
            ok: false,
            detail: `length: ts=${tsPacked.length} cache=${cachePacked.length}`,
        };
    }
    for (let i = 0; i < tsPacked.length; i++) {
        const a = tsPacked[i] | 0;
        const b = cachePacked[i] | 0;
        if (a !== b) {
            const opIndex = (i / 6) | 0 | 0;
            return {
                key: "sceneCommandPlanOpsStage",
                ok: false,
                detail:
                    `firstMismatch i32Index=${i} opIndex=${opIndex} ts=${a} cache=${b} ` +
                    `tsOp=${JSON.stringify(decodePackedSceneCommandPlanOp(tsPacked, opIndex))} ` +
                    `cacheOp=${JSON.stringify(
                        decodePackedSceneCommandPlanOp(cachePacked, opIndex),
                    )}`,
            };
        }
    }
    return { key: "sceneCommandPlanOpsStage", ok: true };
}

function sceneCommandPlanOpSignature(op: unknown): string {
    const entry = (op ?? {}) as Record<string, unknown>;
    const kind = String(entry.kind ?? "unknown");
    if (kind === "mergedGroup") {
        return [
            "merged",
            "t=" + (((entry.transparent as boolean | undefined) ? 1 : 0) | 0),
            "ld=" + (((entry.lowDetail as boolean | undefined) ? 1 : 0) | 0),
            "lvl=" + ((Number(entry.level ?? 0) | 0) as number),
            "pri=" + ((Number(entry.priority ?? 0) | 0) as number),
            "n=" + ((Number(entry.modelCount ?? 0) | 0) as number),
        ].join("|");
    }
    return [
        "inst",
        "t=" + (((entry.transparent as boolean | undefined) ? 1 : 0) | 0),
        "h=" + ((Number(entry.modelHash ?? 0) | 0) as number),
        "f=" + ((Number(entry.faceCount ?? 0) | 0) as number),
        "i=" + ((Number(entry.instanceCount ?? 0) | 0) as number),
        "lod=" + ((Number(entry.lodInstanceCount ?? 0) | 0) as number),
    ].join("|");
}

function sceneCommandPlanOpShapeSignature(op: unknown): string {
    const entry = (op ?? {}) as Record<string, unknown>;
    const kind = String(entry.kind ?? "unknown");
    if (kind === "mergedGroup") {
        return [
            "merged",
            "t=" + (((entry.transparent as boolean | undefined) ? 1 : 0) | 0),
            "ld=" + (((entry.lowDetail as boolean | undefined) ? 1 : 0) | 0),
            "lvl=" + ((Number(entry.level ?? 0) | 0) as number),
            "pri=" + ((Number(entry.priority ?? 0) | 0) as number),
            "n=" + ((Number(entry.modelCount ?? 0) | 0) as number),
        ].join("|");
    }
    return [
        "inst",
        "t=" + (((entry.transparent as boolean | undefined) ? 1 : 0) | 0),
        "f=" + ((Number(entry.faceCount ?? 0) | 0) as number),
        "i=" + ((Number(entry.instanceCount ?? 0) | 0) as number),
        "lod=" + ((Number(entry.lodInstanceCount ?? 0) | 0) as number),
    ].join("|");
}

function diffSceneCommandPlanOpsPackedMultiset(
    tsPacked: Int32Array | undefined,
    cachePacked: Int32Array | undefined,
    limit = 16,
): string[] {
    if (!tsPacked || !cachePacked) {
        return [];
    }
    const stride = 6;
    const tsCount = ((tsPacked.length / stride) | 0) as number;
    const cacheCount = ((cachePacked.length / stride) | 0) as number;
    const tsMap = new Map<string, number>();
    const cacheMap = new Map<string, number>();
    for (let i = 0; i < tsCount; i++) {
        const sig = sceneCommandPlanOpSignature(decodePackedSceneCommandPlanOp(tsPacked, i));
        tsMap.set(sig, ((tsMap.get(sig) ?? 0) + 1) | 0);
    }
    for (let i = 0; i < cacheCount; i++) {
        const sig = sceneCommandPlanOpSignature(decodePackedSceneCommandPlanOp(cachePacked, i));
        cacheMap.set(sig, ((cacheMap.get(sig) ?? 0) + 1) | 0);
    }
    const keys = new Set<string>([...tsMap.keys(), ...cacheMap.keys()]);
    const out: Array<{ sig: string; ts: number; cache: number; delta: number }> = [];
    for (const sig of keys) {
        const ts = (tsMap.get(sig) ?? 0) | 0;
        const cache = (cacheMap.get(sig) ?? 0) | 0;
        if (ts !== cache) {
            out.push({ sig, ts, cache, delta: (cache - ts) | 0 });
        }
    }
    out.sort((a, b) => {
        const da = Math.abs(a.delta) | 0;
        const db = Math.abs(b.delta) | 0;
        if (da !== db) {
            return db - da;
        }
        return a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0;
    });
    return out
        .slice(0, Math.max(0, limit | 0))
        .map((entry) => `${entry.sig}: ts=${entry.ts} cache=${entry.cache} delta=${entry.delta}`);
}

function diffSceneCommandPlanOpsPackedShapeMultiset(
    tsPacked: Int32Array | undefined,
    cachePacked: Int32Array | undefined,
    limit = 16,
): string[] {
    if (!tsPacked || !cachePacked) {
        return [];
    }
    const stride = 6;
    const tsCount = ((tsPacked.length / stride) | 0) as number;
    const cacheCount = ((cachePacked.length / stride) | 0) as number;
    const tsMap = new Map<string, number>();
    const cacheMap = new Map<string, number>();
    for (let i = 0; i < tsCount; i++) {
        const sig = sceneCommandPlanOpShapeSignature(decodePackedSceneCommandPlanOp(tsPacked, i));
        tsMap.set(sig, ((tsMap.get(sig) ?? 0) + 1) | 0);
    }
    for (let i = 0; i < cacheCount; i++) {
        const sig = sceneCommandPlanOpShapeSignature(
            decodePackedSceneCommandPlanOp(cachePacked, i),
        );
        cacheMap.set(sig, ((cacheMap.get(sig) ?? 0) + 1) | 0);
    }
    const keys = new Set<string>([...tsMap.keys(), ...cacheMap.keys()]);
    const out: Array<{ sig: string; ts: number; cache: number; delta: number }> = [];
    for (const sig of keys) {
        const ts = (tsMap.get(sig) ?? 0) | 0;
        const cache = (cacheMap.get(sig) ?? 0) | 0;
        if (ts !== cache) {
            out.push({ sig, ts, cache, delta: (cache - ts) | 0 });
        }
    }
    out.sort((a, b) => {
        const da = Math.abs(a.delta) | 0;
        const db = Math.abs(b.delta) | 0;
        if (da !== db) {
            return db - da;
        }
        return a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0;
    });
    return out
        .slice(0, Math.max(0, limit | 0))
        .map((entry) => `${entry.sig}: ts=${entry.ts} cache=${entry.cache} delta=${entry.delta}`);
}

function describeFirstSceneCommandPlanOpsSharedMismatch(
    tsPacked: Int32Array | undefined,
    cachePacked: Int32Array | undefined,
): string {
    if (!tsPacked || !cachePacked) {
        return "none";
    }
    const minLength = Math.min(tsPacked.length, cachePacked.length) | 0;
    for (let i = 0; i < minLength; i++) {
        const a = tsPacked[i] | 0;
        const b = cachePacked[i] | 0;
        if (a !== b) {
            const opIndex = ((i / 6) | 0) as number;
            return (
                `i32Index=${i} opIndex=${opIndex} ts=${a} cache=${b} ` +
                `tsOp=${JSON.stringify(decodePackedSceneCommandPlanOp(tsPacked, opIndex))} ` +
                `cacheOp=${JSON.stringify(decodePackedSceneCommandPlanOp(cachePacked, opIndex))}`
            );
        }
    }
    return "none";
}

// runtimeCommandBucketsInput was removed; stage comparisons focus on command-stream + packet digests.

type SceneLightStageDigest = Readonly<{
    verticesLength: number;
    verticesHash: number;
    indicesLength: number;
    indicesHash: number;
    commandCount: number;
    commandHash: number;
    bucketCmdCounts: number[];
}>;

type TsSceneLightStageDigests = Readonly<{
    pre: SceneLightStageDigest;
    post: SceneLightStageDigest;
}>;

function digestSceneLightCommandBucketsFromSceneBuffer(sceneBuf: SceneBuffer): Readonly<{
    commandCount: number;
    commandHash: number;
    bucketCmdCounts: number[];
}> {
    const buckets = collectRuntimeDrawCommandBuckets(sceneBuf);
    const bucketCmdCounts = new Array<number>(DRAW_BUCKET_KEYS.length).fill(0);
    let commandCount = 0;
    let h = 2166136261 >>> 0;
    for (let bucketIndex = 0; bucketIndex < DRAW_BUCKET_KEYS.length; bucketIndex++) {
        const bucket = DRAW_BUCKET_KEYS[bucketIndex];
        const commands = buckets[bucket];
        bucketCmdCounts[bucketIndex] = commands.length | 0;
        commandCount += commands.length | 0;
        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            h = fnv1a32UpdateInt(h, bucketIndex | 0);
            h = fnv1a32UpdateInt(h, cmd.offset | 0);
            h = fnv1a32UpdateInt(h, cmd.elements | 0);
            const instCount = cmd.instances.length | 0;
            h = fnv1a32UpdateInt(h, instCount);
            for (let j = 0; j < instCount; j++) {
                const inst = cmd.instances[j];
                h = fnv1a32UpdateInt(h, inst.sceneX | 0);
                h = fnv1a32UpdateInt(h, inst.sceneZ | 0);
                h = fnv1a32UpdateInt(h, inst.heightOffset | 0);
                h = fnv1a32UpdateInt(h, inst.level | 0);
                h = fnv1a32UpdateInt(h, inst.contourGround | 0);
                h = fnv1a32UpdateInt(h, inst.priority | 0);
                h = fnv1a32UpdateInt(h, inst.interactType | 0);
                h = fnv1a32UpdateInt(h, inst.interactId | 0);
            }
        }
    }
    return { commandCount: commandCount | 0, commandHash: h >>> 0, bucketCmdCounts };
}

function digestSceneLightRenderFromScene(
    scene: Scene,
    borderSize: number,
    maxLevel: number,
    locTypeLoader: SceneBuilder["services"]["locTypeLoader"],
    textureLoader: SceneBuilder["services"]["textureLoader"],
): SceneLightStageDigest {
    const { textureIdIndexMap } = createSdTexturePacking(textureLoader as any);
    const sceneBuf = new SceneBuffer(textureLoader as any, new Map(textureIdIndexMap), 100000);
    sceneBuf.addTerrain(scene, borderSize | 0, maxLevel | 0);
    const sceneLocs = getSceneLocs(locTypeLoader as any, scene, borderSize | 0, maxLevel | 0);
    emitSceneModelsToSceneBuffer(
        new ModelHashBuffer(5000),
        textureLoader as any,
        sceneBuf,
        sceneLocs.locs,
        false,
    );
    const vertices = sceneBuf.vertexBuf.byteArray();
    const indices = Int32Array.from(sceneBuf.indices);
    const commandDigest = digestSceneLightCommandBucketsFromSceneBuffer(sceneBuf);
    return {
        verticesLength: vertices.length | 0,
        verticesHash: hashByteArray(vertices, 2166136261 >>> 0),
        indicesLength: indices.length | 0,
        indicesHash: hashArray(indices, 2166136261 >>> 0),
        commandCount: commandDigest.commandCount | 0,
        commandHash: commandDigest.commandHash >>> 0,
        bucketCmdCounts: commandDigest.bucketCmdCounts.map((v) => v | 0),
    };
}

function buildTsSceneForLightStage(
    sceneBuilder: SceneBuilder,
    mapBytesProvider: MapFileBytesProvider,
    sceneBuildInput: Record<string, unknown>,
    loadLocs: boolean,
): Scene {
    const baseX = (sceneBuildInput.baseX as number) | 0;
    const baseY = (sceneBuildInput.baseY as number) | 0;
    const sizeX = (sceneBuildInput.sizeX as number) | 0;
    const sizeY = (sceneBuildInput.sizeY as number) | 0;
    const smoothTerrain = !!sceneBuildInput.smoothTerrain;
    const context = createSceneBuildContext(
        baseX,
        baseY,
        sizeX,
        sizeY,
        smoothTerrain,
        loadLocs ? LocLoadType.MODELS : LocLoadType.NO_MODELS,
    );
    const scene = new Scene(Scene.MAX_LEVELS, context.sizeX, context.sizeY);
    const emptyTerrainIds = decodeTerrainStage(sceneBuilder, mapBytesProvider, scene, context);
    fillEmptyTerrainStage(sceneBuilder, scene, context, emptyTerrainIds);
    if (loadLocs) {
        decodeLocsStage(sceneBuilder, mapBytesProvider, scene, context);
    }
    sceneBuilder.addTileModels(scene, smoothTerrain);
    scene.setTileMinLevels();
    return scene;
}

function computeTsSceneLightStageDigests(
    sceneBuilder: SceneBuilder,
    mapBytesProvider: MapFileBytesProvider,
    sceneBuildInput: Record<string, unknown>,
    maxLevel: number,
    loadLocs: boolean,
): TsSceneLightStageDigests | undefined {
    if (!loadLocs) {
        return undefined;
    }
    const borderSize = ((((sceneBuildInput.sizeX as number) | 0) - 64) / 2) | 0;
    if (borderSize < 0) {
        return undefined;
    }
    const scene = buildTsSceneForLightStage(sceneBuilder, mapBytesProvider, sceneBuildInput, true);
    const pre = digestSceneLightRenderFromScene(
        scene,
        borderSize,
        maxLevel | 0,
        sceneBuilder.services.locTypeLoader,
        sceneBuilder.services.textureLoader,
    );
    scene.light(sceneBuilder.textureLoader, -50, -10, -50);
    const post = digestSceneLightRenderFromScene(
        scene,
        borderSize,
        maxLevel | 0,
        sceneBuilder.services.locTypeLoader,
        sceneBuilder.services.textureLoader,
    );
    return { pre, post };
}

function digestSceneLightFromRuntimeCommandArrays(input: {
    cmdBucketIndices: Int32Array;
    cmdOffsets: Int32Array;
    cmdElements: Int32Array;
    cmdInstanceCounts: Int32Array;
    cmdPackedInstances: Int32Array;
    vertices: Uint8Array;
    indices: Int32Array;
}): SceneLightStageDigest {
    const bucketCmdCounts = new Array<number>(DRAW_BUCKET_KEYS.length).fill(0);
    // Scene-light stage is a geometry check, not a tick/animation check.
    // The runtime command stream can include placeholder commands (offset=0,elements=0)
    // for animated locs; TS scene-light digest intentionally doesn't build those.
    // Filter them out so this stage remains stable and useful.
    const commandCountRaw = input.cmdOffsets.length | 0;
    let instanceBase = 0;
    let h = 2166136261 >>> 0;
    let commandCount = 0;
    for (let i = 0; i < commandCountRaw; i++) {
        const bucket = input.cmdBucketIndices[i] | 0;
        const instCount = input.cmdInstanceCounts[i] | 0;
        // Always advance instanceBase to keep packed-instance decoding aligned.
        const shouldSkip = (input.cmdElements[i] | 0) === 0;
        if (shouldSkip) {
            instanceBase += instCount;
            continue;
        }
        commandCount++;
        if (bucket >= 0 && bucket < DRAW_BUCKET_KEYS.length) {
            bucketCmdCounts[bucket] = (bucketCmdCounts[bucket] | 0) + 1;
        }
        h = fnv1a32UpdateInt(h, bucket);
        h = fnv1a32UpdateInt(h, input.cmdOffsets[i] | 0);
        h = fnv1a32UpdateInt(h, input.cmdElements[i] | 0);
        h = fnv1a32UpdateInt(h, instCount);
        let off = (instanceBase * 8) | 0;
        for (let j = 0; j < instCount; j++) {
            h = fnv1a32UpdateInt(h, input.cmdPackedInstances[off + 0] | 0);
            h = fnv1a32UpdateInt(h, input.cmdPackedInstances[off + 1] | 0);
            h = fnv1a32UpdateInt(h, input.cmdPackedInstances[off + 2] | 0);
            h = fnv1a32UpdateInt(h, input.cmdPackedInstances[off + 3] | 0);
            h = fnv1a32UpdateInt(h, input.cmdPackedInstances[off + 4] | 0);
            h = fnv1a32UpdateInt(h, input.cmdPackedInstances[off + 5] | 0);
            h = fnv1a32UpdateInt(h, input.cmdPackedInstances[off + 6] | 0);
            h = fnv1a32UpdateInt(h, input.cmdPackedInstances[off + 7] | 0);
            off += 8;
        }
        instanceBase += instCount;
    }
    // Hash only geometry referenced by non-placeholder commands. This keeps the scene-light stage stable
    // when the runtime appends additional unreferenced geometry (e.g. animated-loc precomputed frames).
    const usedRanges: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < commandCountRaw; i++) {
        const offsetBytes = input.cmdOffsets[i] | 0;
        const elements = input.cmdElements[i] | 0;
        if (offsetBytes < 0 || elements <= 0) continue;
        const start = offsetBytes >> 2;
        const end = start + elements;
        if (end > start) {
            usedRanges.push({ start, end });
        }
    }
    usedRanges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < usedRanges.length; i++) {
        const r = usedRanges[i];
        if (merged.length === 0) {
            merged.push({ start: r.start | 0, end: r.end | 0 });
            continue;
        }
        const last = merged[merged.length - 1];
        if ((r.start | 0) <= (last.end | 0)) {
            if ((r.end | 0) > (last.end | 0)) last.end = r.end | 0;
            continue;
        }
        merged.push({ start: r.start | 0, end: r.end | 0 });
    }
    let maxIndex = -1;
    let indicesUsedLength = 0;
    for (let r = 0; r < merged.length; r++) {
        const start = Math.max(0, merged[r].start | 0);
        const end = Math.min(input.indices.length, merged[r].end | 0);
        if (end > indicesUsedLength) indicesUsedLength = end;
        for (let i = start; i < end; i++) {
            const v = input.indices[i] | 0;
            if (v > maxIndex) maxIndex = v;
        }
    }
    const verticesUsedLength =
        maxIndex >= 0
            ? Math.min(input.vertices.length, (maxIndex + 1) * PACKED_VERTEX_SIZE_BYTES)
            : 0;
    return {
        verticesLength: verticesUsedLength | 0,
        verticesHash: hashVertexPrefixFromIndexRanges(input.vertices, input.indices, merged),
        indicesLength: indicesUsedLength | 0,
        indicesHash: hashIndicesInRanges(input.indices, merged),
        commandCount,
        commandHash: h >>> 0,
        bucketCmdCounts,
    };
}

function firstSceneLightDigestMismatch(
    ts: SceneLightStageDigest,
    cache: SceneLightStageDigest,
): string | undefined {
    if ((ts.verticesLength | 0) !== (cache.verticesLength | 0)) {
        return `verticesLength: ts=${ts.verticesLength | 0} cache=${cache.verticesLength | 0}`;
    }
    if (ts.verticesHash >>> 0 !== cache.verticesHash >>> 0) {
        return `verticesHash: ts=${ts.verticesHash >>> 0} cache=${cache.verticesHash >>> 0}`;
    }
    if ((ts.indicesLength | 0) !== (cache.indicesLength | 0)) {
        return `indicesLength: ts=${ts.indicesLength | 0} cache=${cache.indicesLength | 0}`;
    }
    if (ts.indicesHash >>> 0 !== cache.indicesHash >>> 0) {
        return `indicesHash: ts=${ts.indicesHash >>> 0} cache=${cache.indicesHash >>> 0}`;
    }
    return undefined;
}

function compareSceneLightStageDigests(
    tsDigests: TsSceneLightStageDigests | undefined,
    cacheArrays:
        | {
              cmdBucketIndices: Int32Array;
              cmdOffsets: Int32Array;
              cmdElements: Int32Array;
              cmdInstanceCounts: Int32Array;
              cmdPackedInstances: Int32Array;
              vertices: Uint8Array;
              indices: Int32Array;
          }
        | undefined,
    loadLocs: boolean,
): StageResult {
    if (!loadLocs) {
        return { key: "sceneLightStage", ok: true };
    }
    if (!tsDigests) {
        return { key: "sceneLightStage", ok: false, detail: "missing-ts-scene-light-digest" };
    }
    if (!cacheArrays) {
        return { key: "sceneLightStage", ok: false, detail: "missing-cache-command-arrays" };
    }
    const cachePost = digestSceneLightFromRuntimeCommandArrays(cacheArrays);
    const postMismatch = firstSceneLightDigestMismatch(tsDigests.post, cachePost);
    if (postMismatch) {
        return {
            key: "sceneLightStage",
            ok: false,
            detail:
                postMismatch +
                ` preTs[vHash=${tsDigests.pre.verticesHash >>> 0},iHash=${
                    tsDigests.pre.indicesHash >>> 0
                },cmdHash=${tsDigests.pre.commandHash >>> 0}]` +
                ` postTs[vHash=${tsDigests.post.verticesHash >>> 0},iHash=${
                    tsDigests.post.indicesHash >>> 0
                },cmdHash=${tsDigests.post.commandHash >>> 0}]`,
        };
    }
    return { key: "sceneLightStage", ok: true };
}

function compareSceneBucketsStage(): StageResult {
    return {
        key: "sceneBucketsStage",
        ok: true,
        detail: "skipped (ts runtimeCommandBucketsInput removed)",
    };
}

function compareLocRenderPlacementStageDigests(
    tsDigest: TsLocRenderPlacementDigest | undefined,
    cacheDigest: unknown,
): StageResult {
    if (!tsDigest) {
        return {
            key: "locRenderPlacementStage",
            ok: false,
            detail: "missing-ts-loc-render-placement-digest",
        };
    }
    if (!cacheDigest || typeof cacheDigest !== "object") {
        return {
            key: "locRenderPlacementStage",
            ok: false,
            detail: "missing-cache-loc-render-placement-digest",
        };
    }
    const cache = cacheDigest as { count?: unknown; hash?: unknown };
    const count = Number(cache.count ?? 0) | 0;
    const hash = Number(cache.hash ?? 0) | 0;
    if ((tsDigest.placementsResolved | 0) !== count) {
        return {
            key: "locRenderPlacementStage",
            ok: false,
            detail: `count: ts=${tsDigest.placementsResolved | 0} cache=${count}`,
        };
    }
    if ((tsDigest.hash | 0) !== hash) {
        return {
            key: "locRenderPlacementStage",
            ok: false,
            detail: `hash: ts=${tsDigest.hash | 0} cache=${hash}`,
        };
    }
    return { key: "locRenderPlacementStage", ok: true };
}

type TsModelFacesDigest = Readonly<{
    faceCount: number;
    opaqueCount: number;
    transparentCount: number;
    hash: number;
}>;

type TsModelVerticesDigest = Readonly<{
    verticesCount: number;
    usedVertexCount: number;
    faceCount: number;
    hash: number;
}>;

function digestTsModelVerticesFromModelData(model: ModelData): TsModelVerticesDigest {
    const vx = model.verticesX;
    const vy = model.verticesY;
    const vz = model.verticesZ;
    const n = Math.min(vx.length | 0, vy.length | 0, vz.length | 0) | 0;

    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, model.version | 0);
    h = fnv1a32UpdateInt(h, model.verticesCount | 0);
    h = fnv1a32UpdateInt(h, model.usedVertexCount | 0);
    h = fnv1a32UpdateInt(h, model.faceCount | 0);
    h = fnv1a32UpdateInt(h, model.textureFaceCount | 0);
    for (let i = 0; i < n; i++) {
        h = fnv1a32UpdateInt(h, vx[i] | 0);
        h = fnv1a32UpdateInt(h, vy[i] | 0);
        h = fnv1a32UpdateInt(h, vz[i] | 0);
    }
    return {
        verticesCount: model.verticesCount | 0,
        usedVertexCount: model.usedVertexCount | 0,
        faceCount: model.faceCount | 0,
        hash: h | 0,
    };
}

function digestTsModelFacesFromModelData(
    model: ModelData,
    transparentTextureIds: ReadonlySet<number>,
): TsModelFacesDigest {
    const faceCount = model.faceCount | 0;
    const faceRenderTypes = model.faceRenderTypes;
    const faceRenderPriorities = model.faceRenderPriorities;
    const faceAlphas = model.faceAlphas;
    const faceTextures = model.faceTextures;

    let h = 2166136261 >>> 0;
    let outFaceCount = 0;
    let opaqueCount = 0;
    let transparentCount = 0;

    for (let i = 0; i < faceCount; i++) {
        let type = faceRenderTypes ? faceRenderTypes[i] & 0xff : 0;
        const rawAlphaSigned = faceAlphas ? faceAlphas[i] | 0 : 0;
        if (rawAlphaSigned === -2) {
            type = 3;
        } else if (rawAlphaSigned === -1) {
            type = 2;
        }

        const textureId = faceTextures ? faceTextures[i] | 0 : -1;

        // Match C++ (and TS `ModelData.light`) drawability filter.
        const drawable =
            textureId === -1 ? type === 0 || type === 1 || type === 3 : type === 0 || type === 1;
        if (!drawable) {
            continue;
        }

        // Alpha is only considered for untextured faces (matches C++).
        let alpha = 0xff;
        if (textureId === -1 && faceAlphas) {
            alpha = 0xff - (rawAlphaSigned & 0xff);
        }
        if (alpha === 0 || alpha === 1) {
            continue;
        }

        const priority = faceRenderPriorities ? faceRenderPriorities[i] | 0 : 0;
        const isTrans =
            alpha < 0xff || (textureId !== -1 && transparentTextureIds.has(textureId | 0));
        if (isTrans) {
            transparentCount++;
        } else {
            opaqueCount++;
        }
        outFaceCount++;

        h = fnv1a32UpdateInt(h, i);
        h = fnv1a32UpdateInt(h, alpha);
        h = fnv1a32UpdateInt(h, priority);
        h = fnv1a32UpdateInt(h, textureId);
        h = fnv1a32UpdateInt(h, isTrans ? 1 : 0);
    }

    return {
        faceCount: outFaceCount | 0,
        opaqueCount: opaqueCount | 0,
        transparentCount: transparentCount | 0,
        hash: h | 0,
    };
}

function collectTransparentTextureIdSet(textureLoader: unknown): ReadonlySet<number> {
    const out = new Set<number>();
    const tl = textureLoader as {
        getTextureIds?: () => unknown;
        isTransparent?: (id: number) => unknown;
    };
    const ids = tl.getTextureIds?.();
    if (!Array.isArray(ids) || typeof tl.isTransparent !== "function") {
        return out;
    }
    for (let i = 0; i < ids.length; i++) {
        const id = (ids[i] as number) | 0;
        if (id >= 0 && tl.isTransparent(id)) {
            out.add(id);
        }
    }
    return out;
}

async function compareModelFacesStage(
    runtimeHandle: number,
    bridge: RuntimeBridge,
    modelIds: ReadonlyArray<number> | undefined,
    modelLoader: { tryGet(id: number): unknown },
    transparentTextureIds: ReadonlySet<number>,
): Promise<StageResult> {
    if (!modelIds || modelIds.length === 0) {
        return { key: "modelFacesStage", ok: true, detail: "no-models" };
    }
    if (typeof bridge.debugGetRuntimeModelFacesDigest !== "function") {
        return {
            key: "modelFacesStage",
            ok: false,
            detail: "bridge-missing-debugGetRuntimeModelFacesDigest",
        };
    }
    const limit = 64;
    let skippedMissingCacheDigest = 0;
    for (let i = 0; i < modelIds.length && i < limit; i++) {
        const modelId = modelIds[i] | 0;
        let tsModel: unknown;
        try {
            tsModel = modelLoader.tryGet(modelId);
        } catch {
            tsModel = undefined;
        }
        if (!(tsModel instanceof ModelData)) {
            return { key: "modelFacesStage", ok: false, detail: `missing-ts-model id=${modelId}` };
        }
        const tsDigest = digestTsModelFacesFromModelData(tsModel, transparentTextureIds);
        const cacheDigest = await bridge.debugGetRuntimeModelFacesDigest(runtimeHandle, modelId);
        if (!cacheDigest) {
            // Legacy model paths can bypass per-id model blob caches, so this debug hook may be unavailable.
            skippedMissingCacheDigest++;
            continue;
        }
        if ((tsDigest.faceCount | 0) !== (cacheDigest.faceCount | 0)) {
            return {
                key: "modelFacesStage",
                ok: false,
                detail: `id=${modelId} faceCount ts=${tsDigest.faceCount | 0} cache=${
                    cacheDigest.faceCount | 0
                }`,
            };
        }
        if ((tsDigest.opaqueCount | 0) !== (cacheDigest.opaqueCount | 0)) {
            return {
                key: "modelFacesStage",
                ok: false,
                detail: `id=${modelId} opaqueCount ts=${tsDigest.opaqueCount | 0} cache=${
                    cacheDigest.opaqueCount | 0
                }`,
            };
        }
        if ((tsDigest.transparentCount | 0) !== (cacheDigest.transparentCount | 0)) {
            return {
                key: "modelFacesStage",
                ok: false,
                detail: `id=${modelId} transparentCount ts=${tsDigest.transparentCount | 0} cache=${
                    cacheDigest.transparentCount | 0
                }`,
            };
        }
        if ((tsDigest.hash | 0) !== (cacheDigest.hash | 0)) {
            return {
                key: "modelFacesStage",
                ok: false,
                detail: `id=${modelId} hash ts=${tsDigest.hash | 0} cache=${cacheDigest.hash | 0}`,
            };
        }
    }
    if (skippedMissingCacheDigest > 0) {
        return {
            key: "modelFacesStage",
            ok: true,
            detail: `checked=${Math.min(limit, modelIds.length)} skippedMissingCacheDigest=${skippedMissingCacheDigest}`,
        };
    }
    return {
        key: "modelFacesStage",
        ok: true,
        detail: `checked=${Math.min(limit, modelIds.length)}`,
    };
}

function compareLocVariantStageDigests(
    tsDigest: TsLocVariantStageDigest | undefined,
    runtimeStats: Record<string, unknown> | undefined,
): StageResult {
    if (!tsDigest) {
        return { key: "locVariantStage", ok: false, detail: "missing-ts-loc-variant-digest" };
    }
    if (!runtimeStats) {
        return { key: "locVariantStage", ok: false, detail: "missing-runtime-build-stats" };
    }
    const fields: Array<keyof TsLocVariantStageDigest> = [
        "groupsQueued",
        "groupsHash",
        "type9Queued",
        "type0Queued",
        "id1651Type9Queued",
        "id1651Type0Queued",
    ];
    const runtimeFields: Record<keyof TsLocVariantStageDigest, string> = {
        groupsQueued: "locVariantGroupsQueued",
        groupsHash: "locVariantGroupsHash",
        type9Queued: "locVariantType9Queued",
        type0Queued: "locVariantType0Queued",
        id1651Type9Queued: "locVariantId1651Type9Queued",
        id1651Type0Queued: "locVariantId1651Type0Queued",
    };
    for (let i = 0; i < fields.length; i++) {
        const key = fields[i];
        const runtimeKey = runtimeFields[key];
        const tsValue = tsDigest[key] | 0;
        const runtimeValue = Number(runtimeStats[runtimeKey] ?? 0) | 0;
        if (tsValue !== runtimeValue) {
            return {
                key: "locVariantStage",
                ok: false,
                detail: `${runtimeKey}: ts=${tsValue} cache=${runtimeValue}`,
            };
        }
    }
    return { key: "locVariantStage", ok: true };
}

function compareLocVariantDropDigests(
    tsDigest: TsLocVariantDropDigest | undefined,
    runtimeStats: Record<string, unknown> | undefined,
): StageResult {
    if (!tsDigest) {
        return {
            key: "locVariantDropStage",
            ok: false,
            detail: "missing-ts-loc-variant-drop-digest",
        };
    }
    if (!runtimeStats) {
        return { key: "locVariantDropStage", ok: false, detail: "missing-runtime-build-stats" };
    }
    const fields: Array<keyof TsLocVariantDropDigest> = ["candidatesExpanded", "decodeFailed"];
    const runtimeFields: Record<keyof TsLocVariantDropDigest, string> = {
        candidatesExpanded: "locVariantCandidatesExpanded",
        decodeFailed: "locVariantDecodeFailed",
    };
    for (let i = 0; i < fields.length; i++) {
        const key = fields[i];
        const runtimeKey = runtimeFields[key];
        const tsValue = tsDigest[key] | 0;
        const runtimeValue = Number(runtimeStats[runtimeKey] ?? 0) | 0;
        if (tsValue !== runtimeValue) {
            return {
                key: "locVariantDropStage",
                ok: false,
                detail: `${runtimeKey}: ts=${tsValue} cache=${runtimeValue}`,
            };
        }
    }
    return { key: "locVariantDropStage", ok: true };
}

function compareLocPreMergeGroupKeyDigests(
    tsDigest: TsLocPreMergeGroupKeyDigest | undefined,
    runtimeStats: Record<string, unknown> | undefined,
): StageResult {
    if (!tsDigest) {
        return {
            key: "locPreMergeGroupKeyStage",
            ok: false,
            detail: "missing-ts-pre-merge-group-key-digest",
        };
    }
    if (!runtimeStats) {
        return {
            key: "locPreMergeGroupKeyStage",
            ok: false,
            detail: "missing-runtime-build-stats",
        };
    }
    const fields: Array<keyof TsLocPreMergeGroupKeyDigest> = ["keysQueued", "keysHash"];
    const runtimeFields: Record<keyof TsLocPreMergeGroupKeyDigest, string> = {
        keysQueued: "locPreMergeGroupKeysQueued",
        keysHash: "locPreMergeGroupKeysHash",
    };
    for (let i = 0; i < fields.length; i++) {
        const key = fields[i];
        const runtimeKey = runtimeFields[key];
        const tsValue = tsDigest[key] | 0;
        const runtimeValue = Number(runtimeStats[runtimeKey] ?? 0) | 0;
        if (tsValue !== runtimeValue) {
            return {
                key: "locPreMergeGroupKeyStage",
                ok: false,
                detail: `${runtimeKey}: ts=${tsValue} cache=${runtimeValue}`,
            };
        }
    }
    return { key: "locPreMergeGroupKeyStage", ok: true };
}

function countI32Frequencies(values: Int32Array): Map<number, number> {
    const counts = new Map<number, number>();
    for (let i = 0; i < values.length; i++) {
        const key = values[i] | 0;
        counts.set(key, ((counts.get(key) ?? 0) + 1) | 0);
    }
    return counts;
}

function makeLocPreMergeEntryKey(entry: {
    locTypeId: number;
    placementType: number;
    placementRotation: number;
    variantType: number;
    variantRotation: number;
    level: number;
    tileX: number;
    tileY: number;
    priority: number;
}): string {
    return [
        entry.locTypeId | 0,
        entry.placementType | 0,
        entry.placementRotation | 0,
        entry.variantType | 0,
        entry.variantRotation | 0,
        entry.level | 0,
        entry.tileX | 0,
        entry.tileY | 0,
        entry.priority | 0,
    ].join("|");
}

function parseRuntimeLocPreMergeEntriesPacked(
    packed: Int32Array | undefined,
): ReadonlyArray<TsLocPreMergeSignatureEntry> | undefined {
    if (!packed) {
        return undefined;
    }
    if ((packed.length | 0) === 0) {
        return [];
    }

    let stride = 0;
    if (packed.length % 17 === 0) {
        stride = 17;
    } else if (packed.length % 10 === 0) {
        stride = 10;
    }
    if (stride === 0) {
        return undefined;
    }

    const out: TsLocPreMergeSignatureEntry[] = [];
    for (let base = 0; base < packed.length; base += stride) {
        out.push({
            signature: packed[base + 0] | 0,
            locTypeId: packed[base + 1] | 0,
            placementType: packed[base + 2] | 0,
            placementRotation: packed[base + 3] | 0,
            variantType: packed[base + 4] | 0,
            variantRotation: packed[base + 5] | 0,
            level: packed[base + 6] | 0,
            tileX: packed[base + 7] | 0,
            tileY: packed[base + 8] | 0,
            priority: packed[base + 9] | 0,
            forceMerge: stride >= 17 ? packed[base + 10] | 0 : 0,
            includeLod: stride >= 17 ? packed[base + 11] | 0 : 0,
            sceneHeight: stride >= 17 ? packed[base + 12] | 0 : 0,
            contourSceneX: stride >= 17 ? packed[base + 13] | 0 : 0,
            contourSceneZ: stride >= 17 ? packed[base + 14] | 0 : 0,
            contourGround: stride >= 17 ? packed[base + 15] | 0 : 0,
            modelIdsHash: stride >= 17 ? packed[base + 16] | 0 : 0,
        });
    }
    return out;
}

type RuntimeLocMergeDecisionEntry = Readonly<{
    locTypeId: number;
    placementType: number;
    placementRotation: number;
    variantType: number;
    variantRotation: number;
    level: number;
    tileX: number;
    tileY: number;
    priority: number;
    forceMerge: number;
    includeLod: number;
    contourSensitive: number;
    sceneHeight: number;
    contourSceneX: number;
    contourSceneZ: number;
    contourGround: number;
    contourProfileHash: number;
    modelSignature: number;
    modelIdsHash: number;
    foundGroupIndex: number;
    chosenGroupIndex: number;
    createdNewGroup: number;
    opaqueElementsPerInstance: number;
    alphaElementsPerInstance: number;
    placementCategory: number;
    placementOrder: number;
    modelCount: number;
}>;

type RuntimeLocMergeEmitEntry = Readonly<{
    startElement: number;
    elements: number;
    locTypeId: number;
    placementType: number;
    placementRotation: number;
    level: number;
    priority: number;
    transparent: number;
    includeLod: number;
    groupIndex: number;
    instanceIndex: number;
    hasFaceRenderPriorities: number;
    faceRenderPrioritiesLength: number;
}>;

function parseRuntimeLocMergeEmitEntriesPacked(
    packed: Int32Array | undefined,
): ReadonlyArray<RuntimeLocMergeEmitEntry> | undefined {
    if (!packed) {
        return undefined;
    }
    if ((packed.length | 0) === 0) {
        return [];
    }
    const stride = 13;
    if (packed.length % stride !== 0) {
        return undefined;
    }
    const out: RuntimeLocMergeEmitEntry[] = [];
    for (let base = 0; base < packed.length; base += stride) {
        out.push({
            startElement: packed[base + 0] | 0,
            elements: packed[base + 1] | 0,
            locTypeId: packed[base + 2] | 0,
            placementType: packed[base + 3] | 0,
            placementRotation: packed[base + 4] | 0,
            level: packed[base + 5] | 0,
            priority: packed[base + 6] | 0,
            transparent: packed[base + 7] | 0,
            includeLod: packed[base + 8] | 0,
            groupIndex: packed[base + 9] | 0,
            instanceIndex: packed[base + 10] | 0,
            hasFaceRenderPriorities: packed[base + 11] | 0,
            faceRenderPrioritiesLength: packed[base + 12] | 0,
        });
    }
    return out;
}

function summarizeRuntimeLocMergeEmitEntry(e: RuntimeLocMergeEmitEntry): string {
    return (
        `start=${e.startElement}|elem=${e.elements}` +
        ` loc=${e.locTypeId}` +
        ` p=${e.placementType}/${e.placementRotation}` +
        ` lvl=${e.level}` +
        ` pri=${e.priority}` +
        ` tr=${e.transparent}` +
        ` lod=${e.includeLod}` +
        ` grp=${e.groupIndex}` +
        ` inst=${e.instanceIndex}` +
        ` priArr=${e.hasFaceRenderPriorities}/${e.faceRenderPrioritiesLength}`
    );
}

function findRuntimeLocMergeEmitEntryIndexForElement(
    entries: ReadonlyArray<RuntimeLocMergeEmitEntry> | undefined,
    elementIndex: number,
): number {
    if (!entries || entries.length <= 0) {
        return -1;
    }
    const target = elementIndex | 0;
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const start = e.startElement | 0;
        const count = e.elements | 0;
        if (count <= 0) continue;
        const end = (start + count) | 0;
        if (target >= start && target < end) {
            return i | 0;
        }
    }
    return -1;
}

function parseRuntimeLocMergeDecisionEntriesPacked(
    packed: Int32Array | undefined,
): ReadonlyArray<RuntimeLocMergeDecisionEntry> | undefined {
    if (!packed) {
        return undefined;
    }
    if ((packed.length | 0) === 0) {
        return [];
    }
    const stride = packed.length % 27 === 0 ? 27 : packed.length % 26 === 0 ? 26 : 0;
    if (stride === 0) {
        return undefined;
    }
    const out: RuntimeLocMergeDecisionEntry[] = [];
    for (let base = 0; base < packed.length; base += stride) {
        out.push({
            locTypeId: packed[base + 0] | 0,
            placementType: packed[base + 1] | 0,
            placementRotation: packed[base + 2] | 0,
            variantType: packed[base + 3] | 0,
            variantRotation: packed[base + 4] | 0,
            level: packed[base + 5] | 0,
            tileX: packed[base + 6] | 0,
            tileY: packed[base + 7] | 0,
            priority: packed[base + 8] | 0,
            forceMerge: packed[base + 9] | 0,
            includeLod: packed[base + 10] | 0,
            contourSensitive: packed[base + 11] | 0,
            sceneHeight: packed[base + 12] | 0,
            contourSceneX: packed[base + 13] | 0,
            contourSceneZ: packed[base + 14] | 0,
            contourGround: packed[base + 15] | 0,
            contourProfileHash: stride >= 27 ? packed[base + 16] | 0 : 0,
            modelSignature: packed[base + (stride >= 27 ? 17 : 16)] | 0,
            modelIdsHash: packed[base + (stride >= 27 ? 18 : 17)] | 0,
            foundGroupIndex: packed[base + (stride >= 27 ? 19 : 18)] | 0,
            chosenGroupIndex: packed[base + (stride >= 27 ? 20 : 19)] | 0,
            createdNewGroup: packed[base + (stride >= 27 ? 21 : 20)] | 0,
            opaqueElementsPerInstance: packed[base + (stride >= 27 ? 22 : 21)] | 0,
            alphaElementsPerInstance: packed[base + (stride >= 27 ? 23 : 22)] | 0,
            placementCategory: packed[base + (stride >= 27 ? 24 : 23)] | 0,
            placementOrder: packed[base + (stride >= 27 ? 25 : 24)] | 0,
            modelCount: packed[base + (stride >= 27 ? 26 : 25)] | 0,
        });
    }
    return out;
}

type RuntimeLocMergeNormalsTraceEntry = Readonly<{
    aLocTypeId: number;
    aPlacementType: number;
    aRotation: number;
    aLevel: number;
    aTileX: number;
    aTileY: number;
    aSizeX: number;
    aSizeY: number;
    bLocTypeId: number;
    bPlacementType: number;
    bRotation: number;
    bLevel: number;
    bTileX: number;
    bTileY: number;
    bSizeX: number;
    bSizeY: number;
    offX: number;
    offY: number;
    offZ: number;
    hideOccluded: number;
    mergedCount: number;
    callKind: number;
}>;

function parseRuntimeLocMergeNormalsTraceEntriesPacked(
    packed: Int32Array | undefined,
): ReadonlyArray<RuntimeLocMergeNormalsTraceEntry> | undefined {
    if (!packed) {
        return undefined;
    }
    if ((packed.length | 0) === 0) {
        return [];
    }
    const stride = 22;
    if (packed.length % stride !== 0) {
        return undefined;
    }
    const out: RuntimeLocMergeNormalsTraceEntry[] = [];
    for (let base = 0; base < packed.length; base += stride) {
        out.push({
            aLocTypeId: packed[base + 0] | 0,
            aPlacementType: packed[base + 1] | 0,
            aRotation: packed[base + 2] | 0,
            aLevel: packed[base + 3] | 0,
            aTileX: packed[base + 4] | 0,
            aTileY: packed[base + 5] | 0,
            aSizeX: packed[base + 6] | 0,
            aSizeY: packed[base + 7] | 0,
            bLocTypeId: packed[base + 8] | 0,
            bPlacementType: packed[base + 9] | 0,
            bRotation: packed[base + 10] | 0,
            bLevel: packed[base + 11] | 0,
            bTileX: packed[base + 12] | 0,
            bTileY: packed[base + 13] | 0,
            bSizeX: packed[base + 14] | 0,
            bSizeY: packed[base + 15] | 0,
            offX: packed[base + 16] | 0,
            offY: packed[base + 17] | 0,
            offZ: packed[base + 18] | 0,
            hideOccluded: packed[base + 19] | 0,
            mergedCount: packed[base + 20] | 0,
            callKind: packed[base + 21] | 0,
        });
    }
    return out;
}

type RuntimeCommandProvenanceEntry = Readonly<{
    cmdIndex: number;
    bucket: number;
    offset: number;
    elements: number;
    sourceKind: number;
    locTypeId: number;
    placementType: number;
    placementRotation: number;
    variantType: number;
    variantRotation: number;
    pass: number;
    mergePath: number;
    splitSignature: number;
}>;

function parseRuntimeCommandProvenanceEntriesPacked(
    packed: Int32Array | undefined,
): ReadonlyArray<RuntimeCommandProvenanceEntry> | undefined {
    if (!packed) {
        return undefined;
    }
    if ((packed.length | 0) === 0) {
        return [];
    }
    const stride = packed.length % 12 === 0 ? 12 : packed.length % 11 === 0 ? 11 : 0;
    if (stride === 0) {
        return undefined;
    }
    const out: RuntimeCommandProvenanceEntry[] = [];
    for (let base = 0, cmdIndex = 0; base < packed.length; base += stride, cmdIndex++) {
        out.push({
            cmdIndex: cmdIndex | 0,
            bucket: packed[base + 0] | 0,
            offset: packed[base + 1] | 0,
            elements: packed[base + 2] | 0,
            sourceKind: packed[base + 3] | 0,
            locTypeId: packed[base + 4] | 0,
            placementType: packed[base + 5] | 0,
            placementRotation: packed[base + 6] | 0,
            variantType: packed[base + 7] | 0,
            variantRotation: packed[base + 8] | 0,
            pass: packed[base + 9] | 0,
            mergePath: packed[base + 10] | 0,
            splitSignature: stride >= 12 ? packed[base + 11] | 0 : 0,
        });
    }
    return out;
}

function summarizeRuntimeCommandProvenanceEntriesAtIndices(
    entries: ReadonlyArray<RuntimeCommandProvenanceEntry> | undefined,
    indices: readonly number[],
): string[] {
    if (!entries) {
        return ["  cmd-provenance: <missing>"];
    }
    if (entries.length <= 0) {
        return ["  cmd-provenance: <empty>"];
    }
    const lines: string[] = [];
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i] | 0;
        if (idx < 0 || idx >= entries.length) {
            continue;
        }
        const e = entries[idx];
        lines.push(
            "  cmd-provenance idx=" +
                (idx | 0) +
                " bucket=" +
                (e.bucket | 0) +
                " off=" +
                (e.offset | 0) +
                " elem=" +
                (e.elements | 0) +
                " src=" +
                (e.sourceKind | 0) +
                " loc=" +
                (e.locTypeId | 0) +
                " placement=" +
                (e.placementType | 0) +
                "/" +
                (e.placementRotation | 0) +
                " variant=" +
                (e.variantType | 0) +
                "/" +
                (e.variantRotation | 0) +
                " pass=" +
                (e.pass | 0) +
                " mergePath=" +
                (e.mergePath | 0) +
                " splitSig=" +
                (e.splitSignature | 0),
        );
    }
    if (lines.length <= 0) {
        return ["  cmd-provenance: no-indices"];
    }
    return lines;
}

function summarizeRuntimeLocMergeDecisionEntries(
    entries: ReadonlyArray<RuntimeLocMergeDecisionEntry> | undefined,
    locTypeIds: readonly number[],
): string[] {
    if (!entries) {
        return ["  loc-merge-decision: <missing>"];
    }
    if (entries.length <= 0) {
        return ["  loc-merge-decision: <empty>"];
    }
    const targetSet = new Set<number>((locTypeIds ?? []).map((id) => id | 0));
    const filtered = entries.filter((entry) =>
        targetSet.size > 0 ? targetSet.has(entry.locTypeId | 0) : true,
    );
    const lines: string[] = [];
    if (targetSet.size > 0) {
        const seen = new Set<number>();
        for (let i = 0; i < filtered.length; i++) {
            seen.add(filtered[i].locTypeId | 0);
        }
        const missing: number[] = [];
        for (const id of targetSet) {
            if (!seen.has(id | 0)) {
                missing.push(id | 0);
            }
        }
        if (missing.length > 0) {
            missing.sort((a, b) => a - b);
            lines.push("  loc-merge-decision missing-target-locIds " + missing.join(","));
        }
    }
    if (filtered.length <= 0) {
        return ["  loc-merge-decision: no-target-entries total=" + entries.length];
    }

    let created = 0;
    for (let i = 0; i < filtered.length; i++) {
        if ((filtered[i].createdNewGroup | 0) !== 0) {
            created++;
        }
    }
    lines.push(
        "  loc-merge-decision totals entries=" +
            filtered.length +
            " created=" +
            created +
            " reused=" +
            ((filtered.length - created) | 0),
    );

    const grouped = new Map<string, { count: number; created: number; reused: number }>();
    for (let i = 0; i < filtered.length; i++) {
        const entry = filtered[i];
        const key =
            String(entry.locTypeId | 0) +
            "|t" +
            String(entry.variantType | 0) +
            "|r" +
            String(entry.variantRotation | 0) +
            "|c" +
            String(entry.contourSensitive | 0) +
            "|cp" +
            String(entry.contourProfileHash | 0) +
            "|o" +
            String(entry.opaqueElementsPerInstance | 0) +
            "|a" +
            String(entry.alphaElementsPerInstance | 0) +
            "|sig" +
            String(entry.modelSignature | 0) +
            "|ids" +
            String(entry.modelIdsHash | 0);
        const bucket = grouped.get(key);
        const isCreated = (entry.createdNewGroup | 0) !== 0 ? 1 : 0;
        if (bucket) {
            bucket.count = (bucket.count + 1) | 0;
            bucket.created = (bucket.created + isCreated) | 0;
            bucket.reused = (bucket.reused + (isCreated ? 0 : 1)) | 0;
        } else {
            grouped.set(key, {
                count: 1,
                created: isCreated,
                reused: isCreated ? 0 : 1,
            });
        }
    }

    const topVariants = Array.from(grouped.entries())
        .sort((a, b) => {
            if ((b[1].count | 0) !== (a[1].count | 0)) {
                return (b[1].count | 0) - (a[1].count | 0);
            }
            return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
        })
        .slice(0, 12)
        .map(
            ([key, value]) =>
                key +
                ":n=" +
                (value.count | 0) +
                ",new=" +
                (value.created | 0) +
                ",reuse=" +
                (value.reused | 0),
        );
    if (topVariants.length > 0) {
        lines.push("  loc-merge-decision groups " + topVariants.join(" "));
    }

    const orderedLocs = Array.from(
        new Set<number>(filtered.map((entry) => entry.locTypeId | 0)),
    ).sort((a, b) => a - b);
    for (let li = 0; li < orderedLocs.length; li++) {
        const locTypeId = orderedLocs[li] | 0;
        const locEntries = filtered
            .filter((entry) => (entry.locTypeId | 0) === locTypeId)
            .sort((a, b) => {
                if ((a.placementOrder | 0) !== (b.placementOrder | 0)) {
                    return (a.placementOrder | 0) - (b.placementOrder | 0);
                }
                if ((a.variantType | 0) !== (b.variantType | 0)) {
                    return (a.variantType | 0) - (b.variantType | 0);
                }
                return (a.variantRotation | 0) - (b.variantRotation | 0);
            });
        lines.push("  loc-merge-decision loc=" + locTypeId + " entries=" + (locEntries.length | 0));
        const byVariantContour = new Map<string, number>();
        for (let i = 0; i < locEntries.length; i++) {
            const entry = locEntries[i];
            const key =
                "v" +
                String(entry.variantType | 0) +
                "/" +
                String(entry.variantRotation | 0) +
                "|c" +
                String(entry.contourGround | 0);
            byVariantContour.set(key, ((byVariantContour.get(key) ?? 0) + 1) | 0);
        }
        const variantContourSummary = Array.from(byVariantContour.entries())
            .sort((a, b) => {
                if ((b[1] | 0) !== (a[1] | 0)) {
                    return (b[1] | 0) - (a[1] | 0);
                }
                return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
            })
            .slice(0, 12)
            .map(([key, count]) => key + ":n=" + (count | 0));
        if (variantContourSummary.length > 0) {
            lines.push("  loc-merge-decision variantContour " + variantContourSummary.join(" "));
        }
        const sampleCount =
            locEntries.length <= 32 ? locEntries.length : Math.min(6, locEntries.length);
        for (let i = 0; i < sampleCount; i++) {
            const entry = locEntries[i];
            lines.push(
                "  loc-merge-decision sample loc=" +
                    locTypeId +
                    " ord=" +
                    (entry.placementOrder | 0) +
                    " p=" +
                    (entry.placementType | 0) +
                    "/" +
                    (entry.placementRotation | 0) +
                    " v=" +
                    (entry.variantType | 0) +
                    "/" +
                    (entry.variantRotation | 0) +
                    " tile=" +
                    (entry.tileX | 0) +
                    "," +
                    (entry.tileY | 0) +
                    " fm=" +
                    (entry.forceMerge | 0) +
                    " cs=" +
                    (entry.contourSensitive | 0) +
                    " sh=" +
                    (entry.sceneHeight | 0) +
                    " cx=" +
                    (entry.contourSceneX | 0) +
                    " cz=" +
                    (entry.contourSceneZ | 0) +
                    " grp=" +
                    (entry.foundGroupIndex | 0) +
                    "->" +
                    (entry.chosenGroupIndex | 0) +
                    " new=" +
                    (entry.createdNewGroup | 0) +
                    " contour=" +
                    (entry.contourGround | 0) +
                    " o/a=" +
                    (entry.opaqueElementsPerInstance | 0) +
                    "/" +
                    (entry.alphaElementsPerInstance | 0) +
                    " modelSig=" +
                    (entry.modelSignature | 0),
            );
        }
    }

    return lines;
}

function summarizeRuntimeSplitReasonsForLocVariant(
    entries: ReadonlyArray<RuntimeLocMergeDecisionEntry> | undefined,
    locTypeId: number,
    variantType: number,
    variantRotation: number,
    maxLines: number,
): string[] {
    if (!entries || entries.length <= 0) {
        return ["  runtime-split-reason: <missing-loc-merge-entries>"];
    }
    const filtered = entries.filter(
        (e) =>
            (e.locTypeId | 0) === (locTypeId | 0) &&
            (e.variantType | 0) === (variantType | 0) &&
            (e.variantRotation | 0) === (variantRotation | 0),
    );
    if (filtered.length <= 0) {
        return [
            `  runtime-split-reason loc=${locTypeId | 0} v=${variantType | 0}/${
                variantRotation | 0
            }: <no-entries>`,
        ];
    }

    const uniq = (vals: readonly number[]): number[] =>
        Array.from(new Set<number>(vals.map((v) => v | 0))).sort((a, b) => a - b);
    const chosenGroups = uniq(filtered.map((e) => e.chosenGroupIndex | 0));
    const sceneHeights = uniq(filtered.map((e) => e.sceneHeight | 0));
    const contourGrounds = uniq(filtered.map((e) => e.contourGround | 0));
    const contourSensitive = uniq(filtered.map((e) => e.contourSensitive | 0));
    const includeLod = uniq(filtered.map((e) => e.includeLod | 0));
    const modelSigs = uniq(filtered.map((e) => e.modelSignature | 0));
    const modelIdsHashes = uniq(filtered.map((e) => e.modelIdsHash | 0));
    const contourProfileHashes = uniq(filtered.map((e) => e.contourProfileHash | 0));
    const priorities = uniq(filtered.map((e) => e.priority | 0));
    const levels = uniq(filtered.map((e) => e.level | 0));
    const contourSceneXs = uniq(filtered.map((e) => e.contourSceneX | 0));
    const contourSceneZs = uniq(filtered.map((e) => e.contourSceneZ | 0));
    const contourProfileHashHist = new Map<number, number>();
    const contourProfileByHeightGround = new Map<string, Set<number>>();
    for (let i = 0; i < filtered.length; i++) {
        const e = filtered[i];
        const cp = e.contourProfileHash | 0;
        contourProfileHashHist.set(cp, ((contourProfileHashHist.get(cp) ?? 0) + 1) | 0);
        const hg = `${e.sceneHeight | 0}|${e.contourGround | 0}`;
        const set = contourProfileByHeightGround.get(hg);
        if (set) {
            set.add(cp);
        } else {
            contourProfileByHeightGround.set(hg, new Set<number>([cp]));
        }
    }

    const reasons: string[] = [];
    if (chosenGroups.length > 1 && sceneHeights.length > 1) reasons.push("sceneHeight");
    if (chosenGroups.length > 1 && contourGrounds.length > 1) reasons.push("contourGround");
    if (chosenGroups.length > 1 && modelSigs.length > 1) reasons.push("modelSignature");
    if (chosenGroups.length > 1 && modelIdsHashes.length > 1) reasons.push("modelIdsHash");
    if (chosenGroups.length > 1 && contourProfileHashes.length > 1)
        reasons.push("contourProfileHash");
    if (chosenGroups.length > 1 && contourSceneXs.length > 1) reasons.push("contourSceneX");
    if (chosenGroups.length > 1 && contourSceneZs.length > 1) reasons.push("contourSceneZ");
    if (chosenGroups.length > 1 && contourSensitive.includes(1)) reasons.push("contourSensitive");
    if (chosenGroups.length > 1 && reasons.length <= 0) reasons.push("unknown");

    const lines: string[] = [];
    lines.push(
        "  runtime-split-reason loc=" +
            (locTypeId | 0) +
            " v=" +
            (variantType | 0) +
            "/" +
            (variantRotation | 0) +
            " entries=" +
            filtered.length +
            " groups=" +
            chosenGroups.length +
            " reasons=" +
            (reasons.length > 0 ? reasons.join("+") : "<none>"),
    );
    lines.push(
        "  runtime-split-fields sceneHeights=" +
            JSON.stringify(sceneHeights.slice(0, maxLines)) +
            " contourGrounds=" +
            JSON.stringify(contourGrounds.slice(0, maxLines)) +
            " contourSensitive=" +
            JSON.stringify(contourSensitive.slice(0, maxLines)) +
            " includeLod=" +
            JSON.stringify(includeLod.slice(0, maxLines)) +
            " priorities=" +
            JSON.stringify(priorities.slice(0, maxLines)) +
            " levels=" +
            JSON.stringify(levels.slice(0, maxLines)),
    );
    lines.push(
        "  runtime-split-model modelSignatureCount=" +
            modelSigs.length +
            " modelIdsHashCount=" +
            modelIdsHashes.length +
            " contourProfileHashCount=" +
            contourProfileHashes.length +
            " contourSceneXCount=" +
            contourSceneXs.length +
            " contourSceneZCount=" +
            contourSceneZs.length,
    );
    const topContourProfiles = Array.from(contourProfileHashHist.entries())
        .sort((a, b) => (b[1] | 0) - (a[1] | 0))
        .slice(0, Math.max(1, maxLines | 0))
        .map(([cp, n]) => [cp | 0, n | 0]);
    lines.push(
        "  runtime-split-profile topContourProfileHash=" + JSON.stringify(topContourProfiles),
    );
    const hgMultiProfile = Array.from(contourProfileByHeightGround.entries())
        .map(([hg, set]) => ({
            hg,
            count: set.size | 0,
            values: Array.from(set.values()).sort((a, b) => (a | 0) - (b | 0)),
        }))
        .filter((entry) => (entry.count | 0) > 1)
        .sort((a, b) => (b.count | 0) - (a.count | 0))
        .slice(0, Math.max(1, maxLines | 0))
        .map((entry) => `${entry.hg}:${JSON.stringify(entry.values)}`);
    lines.push(
        "  runtime-split-profile heightGroundMultiProfile=" +
            (hgMultiProfile.length > 0 ? hgMultiProfile.join(" ") : "<none>"),
    );
    return lines;
}

function summarizeTsVsRuntimeLocGrouping(
    tsEntries: ReadonlyArray<TsLocPreMergeSignatureEntry> | undefined,
    runtimeEntries: ReadonlyArray<RuntimeLocMergeDecisionEntry> | undefined,
    locTypeId: number,
): string[] {
    const locId = locTypeId | 0;
    if (!tsEntries || !runtimeEntries) {
        return [
            "  loc-group-compare loc=" +
                locId +
                " status=missing " +
                (!tsEntries ? "ts" : "") +
                (!runtimeEntries ? " runtime" : ""),
        ];
    }

    const tsFiltered = tsEntries.filter((entry) => (entry.locTypeId | 0) === locId);
    const runtimeFiltered = runtimeEntries.filter((entry) => (entry.locTypeId | 0) === locId);
    if (tsFiltered.length <= 0 && runtimeFiltered.length <= 0) {
        return ["  loc-group-compare loc=" + locId + " status=empty"];
    }

    const makeFineKeyFromTs = (entry: TsLocPreMergeSignatureEntry): string =>
        "v" +
        String(entry.variantType | 0) +
        "/" +
        String(entry.variantRotation | 0) +
        "|p" +
        String(entry.priority | 0) +
        "|fm" +
        String(entry.forceMerge | 0) +
        "|lod" +
        String(entry.includeLod | 0) +
        "|h" +
        String(entry.sceneHeight | 0) +
        "|cg" +
        String(entry.contourGround | 0) +
        "|ids" +
        String(entry.modelIdsHash | 0);
    const makeFineKeyFromRuntime = (entry: RuntimeLocMergeDecisionEntry): string =>
        "v" +
        String(entry.variantType | 0) +
        "/" +
        String(entry.variantRotation | 0) +
        "|p" +
        String(entry.priority | 0) +
        "|fm" +
        String(entry.forceMerge | 0) +
        "|lod" +
        String(entry.includeLod | 0) +
        "|h" +
        String(entry.sceneHeight | 0) +
        "|cg" +
        String(entry.contourGround | 0) +
        "|ids" +
        String(entry.modelIdsHash | 0);
    const makeCoarseKeyFromTs = (entry: TsLocPreMergeSignatureEntry): string =>
        "v" +
        String(entry.variantType | 0) +
        "/" +
        String(entry.variantRotation | 0) +
        "|p" +
        String(entry.priority | 0) +
        "|fm" +
        String(entry.forceMerge | 0) +
        "|lod" +
        String(entry.includeLod | 0) +
        "|cg" +
        String(entry.contourGround | 0) +
        "|ids" +
        String(entry.modelIdsHash | 0);
    const makeCoarseKeyFromRuntime = (entry: RuntimeLocMergeDecisionEntry): string =>
        "v" +
        String(entry.variantType | 0) +
        "/" +
        String(entry.variantRotation | 0) +
        "|p" +
        String(entry.priority | 0) +
        "|fm" +
        String(entry.forceMerge | 0) +
        "|lod" +
        String(entry.includeLod | 0) +
        "|cg" +
        String(entry.contourGround | 0) +
        "|ids" +
        String(entry.modelIdsHash | 0);

    const buildCountMap = <T>(
        entries: ReadonlyArray<T>,
        keyOf: (entry: T) => string,
    ): Map<string, number> => {
        const out = new Map<string, number>();
        for (let i = 0; i < entries.length; i++) {
            const key = keyOf(entries[i]);
            out.set(key, ((out.get(key) ?? 0) + 1) | 0);
        }
        return out;
    };

    const tsFine = buildCountMap(tsFiltered, makeFineKeyFromTs);
    const runtimeFine = buildCountMap(runtimeFiltered, makeFineKeyFromRuntime);
    const tsCoarse = buildCountMap(tsFiltered, makeCoarseKeyFromTs);
    const runtimeCoarse = buildCountMap(runtimeFiltered, makeCoarseKeyFromRuntime);

    const summarizeDiff = (
        label: string,
        tsMap: Map<string, number>,
        runtimeMap: Map<string, number>,
    ): string[] => {
        const keys = new Set<string>();
        for (const key of tsMap.keys()) keys.add(key);
        for (const key of runtimeMap.keys()) keys.add(key);
        const deltas: Array<{ key: string; tsCount: number; runtimeCount: number; delta: number }> =
            [];
        for (const key of keys) {
            const tsCount = tsMap.get(key) ?? 0;
            const runtimeCount = runtimeMap.get(key) ?? 0;
            const delta = (runtimeCount - tsCount) | 0;
            if (delta !== 0) {
                deltas.push({ key, tsCount: tsCount | 0, runtimeCount: runtimeCount | 0, delta });
            }
        }
        deltas.sort((a, b) => {
            const ad = Math.abs(a.delta | 0);
            const bd = Math.abs(b.delta | 0);
            if (ad !== bd) return bd - ad;
            return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
        });
        if (deltas.length <= 0) {
            return ["  loc-group-compare loc=" + locId + " " + label + " diff=<none>"];
        }
        const n = Math.min(8, deltas.length);
        const parts: string[] = [];
        for (let i = 0; i < n; i++) {
            const d = deltas[i];
            parts.push(
                d.key +
                    ":{ts=" +
                    (d.tsCount | 0) +
                    ",rt=" +
                    (d.runtimeCount | 0) +
                    ",d=" +
                    (d.delta | 0) +
                    "}",
            );
        }
        return [
            "  loc-group-compare loc=" +
                locId +
                " " +
                label +
                " tsEntries=" +
                (tsFiltered.length | 0) +
                " rtEntries=" +
                (runtimeFiltered.length | 0) +
                " keyDiffs=" +
                deltas.length,
            "  loc-group-compare " + label + " top " + parts.join(" "),
        ];
    };

    return [
        ...summarizeDiff("fine", tsFine, runtimeFine),
        ...summarizeDiff("coarse", tsCoarse, runtimeCoarse),
    ];
}

function describeLocPreMergeEntryDelta(
    expected: TsLocPreMergeSignatureEntry,
    actual: TsLocPreMergeSignatureEntry,
): string {
    const diffs: string[] = [];
    const push = (name: string, a: number, b: number) => {
        if ((a | 0) !== (b | 0)) {
            diffs.push(name + ":" + (a | 0) + "->" + (b | 0));
        }
    };
    push("forceMerge", expected.forceMerge, actual.forceMerge);
    push("includeLod", expected.includeLod, actual.includeLod);
    push("sceneHeight", expected.sceneHeight, actual.sceneHeight);
    push("contourSceneX", expected.contourSceneX, actual.contourSceneX);
    push("contourSceneZ", expected.contourSceneZ, actual.contourSceneZ);
    push("contourGround", expected.contourGround, actual.contourGround);
    push("modelIdsHash", expected.modelIdsHash, actual.modelIdsHash);
    return diffs.length > 0 ? diffs.join(",") : "none";
}

function compareLocPreMergeSignatureDigests(
    tsEntries: ReadonlyArray<TsLocPreMergeSignatureEntry> | undefined,
    runtimeSignatures: Int32Array | undefined,
    runtimeEntriesPacked: Int32Array | undefined,
): StageResult {
    if (!tsEntries) {
        return {
            key: "locPreMergeSignatureStage",
            ok: false,
            detail: "missing-ts-pre-merge-signatures",
        };
    }
    if (!runtimeSignatures) {
        return {
            key: "locPreMergeSignatureStage",
            ok: false,
            detail: "missing-runtime-pre-merge-signatures",
        };
    }

    const runtimeEntries = parseRuntimeLocPreMergeEntriesPacked(runtimeEntriesPacked);

    const tsSignatures = new Int32Array(tsEntries.length);
    for (let i = 0; i < tsEntries.length; i++) {
        tsSignatures[i] = tsEntries[i].signature | 0;
    }

    if ((tsSignatures.length | 0) !== (runtimeSignatures.length | 0)) {
        const runtimeCounts = countI32Frequencies(runtimeSignatures);
        const runtimeEntryCounts = new Map<string, number>();
        if (runtimeEntries) {
            for (let i = 0; i < runtimeEntries.length; i++) {
                const key = makeLocPreMergeEntryKey(runtimeEntries[i]);
                runtimeEntryCounts.set(key, ((runtimeEntryCounts.get(key) ?? 0) + 1) | 0);
            }

            for (let i = 0; i < tsEntries.length; i++) {
                const entry = tsEntries[i];
                const key = makeLocPreMergeEntryKey(entry);
                const keyCount = runtimeEntryCounts.get(key) ?? 0;
                if (keyCount <= 0) {
                    const runtimeSamePlacement = runtimeEntries.filter(
                        (runtimeEntry) =>
                            (runtimeEntry.locTypeId | 0) === (entry.locTypeId | 0) &&
                            (runtimeEntry.placementType | 0) === (entry.placementType | 0) &&
                            (runtimeEntry.placementRotation | 0) ===
                                (entry.placementRotation | 0) &&
                            (runtimeEntry.level | 0) === (entry.level | 0) &&
                            (runtimeEntry.tileX | 0) === (entry.tileX | 0) &&
                            (runtimeEntry.tileY | 0) === (entry.tileY | 0) &&
                            (runtimeEntry.priority | 0) === (entry.priority | 0),
                    );
                    const runtimeVariants = runtimeSamePlacement.map(
                        (runtimeEntry) =>
                            (runtimeEntry.variantType | 0) +
                            "/" +
                            (runtimeEntry.variantRotation | 0),
                    );
                    const tsKeyTotal = tsEntries.filter(
                        (tsEntry) => makeLocPreMergeEntryKey(tsEntry) === key,
                    ).length;
                    const runtimeKeyTotal = runtimeEntries.filter(
                        (runtimeEntry) => makeLocPreMergeEntryKey(runtimeEntry) === key,
                    ).length;
                    return {
                        key: "locPreMergeSignatureStage",
                        ok: false,
                        detail:
                            "length ts=" +
                            (tsSignatures.length | 0) +
                            " cache=" +
                            (runtimeSignatures.length | 0) +
                            " missing-key idx=" +
                            i +
                            " loc=" +
                            entry.locTypeId +
                            " pType=" +
                            entry.placementType +
                            " pRot=" +
                            entry.placementRotation +
                            " vType=" +
                            entry.variantType +
                            " vRot=" +
                            entry.variantRotation +
                            " lvl=" +
                            entry.level +
                            " tile=" +
                            entry.tileX +
                            "," +
                            entry.tileY +
                            " pri=" +
                            entry.priority +
                            " tsKeyCount=" +
                            tsKeyTotal +
                            " runtimeKeyCount=" +
                            runtimeKeyTotal +
                            " runtimeVariants=" +
                            (runtimeVariants.length > 0 ? runtimeVariants.join(",") : "none"),
                    };
                }
                runtimeEntryCounts.set(key, (keyCount - 1) | 0);
            }
        }

        for (let i = 0; i < tsEntries.length; i++) {
            const entry = tsEntries[i];
            const sig = entry.signature | 0;
            const count = runtimeCounts.get(sig) ?? 0;
            if (count <= 0) {
                const key = makeLocPreMergeEntryKey(entry);
                const runtimeKeyCount = runtimeEntries ? runtimeEntryCounts.get(key) ?? 0 : 0;
                const keyStatus =
                    runtimeEntries === undefined
                        ? "runtime-entry-meta-unavailable"
                        : runtimeKeyCount > 0
                        ? "signature-mismatch same-key-remaining=" + runtimeKeyCount
                        : "signature-mismatch";
                return {
                    key: "locPreMergeSignatureStage",
                    ok: false,
                    detail:
                        "length ts=" +
                        (tsSignatures.length | 0) +
                        " cache=" +
                        (runtimeSignatures.length | 0) +
                        " missing idx=" +
                        i +
                        " sig=" +
                        sig +
                        " loc=" +
                        entry.locTypeId +
                        " pType=" +
                        entry.placementType +
                        " pRot=" +
                        entry.placementRotation +
                        " vType=" +
                        entry.variantType +
                        " vRot=" +
                        entry.variantRotation +
                        " lvl=" +
                        entry.level +
                        " tile=" +
                        entry.tileX +
                        "," +
                        entry.tileY +
                        " pri=" +
                        entry.priority +
                        " runtimeKey=" +
                        keyStatus,
                };
            }
            runtimeCounts.set(sig, (count - 1) | 0);
        }
        return {
            key: "locPreMergeSignatureStage",
            ok: false,
            detail:
                "length ts=" +
                (tsSignatures.length | 0) +
                " cache=" +
                (runtimeSignatures.length | 0),
        };
    }

    const first = describeFirstI32Mismatch(tsSignatures, runtimeSignatures);
    if (first !== "none") {
        const m = /^idx=(\d+) expected=/.exec(first);
        const idx = m ? Number(m[1]) | 0 : -1;
        if (idx >= 0 && idx < tsEntries.length) {
            const entry = tsEntries[idx];
            let delta = "runtime-entry-meta-unavailable";
            if (runtimeEntries) {
                const key = makeLocPreMergeEntryKey(entry);
                const runtimeMatch = runtimeEntries.find(
                    (candidate) => makeLocPreMergeEntryKey(candidate) === key,
                );
                if (runtimeMatch) {
                    delta = describeLocPreMergeEntryDelta(entry, runtimeMatch);
                } else {
                    delta = "runtime-entry-missing-for-key";
                }
            }
            return {
                key: "locPreMergeSignatureStage",
                ok: false,
                detail:
                    first +
                    " loc=" +
                    entry.locTypeId +
                    " pType=" +
                    entry.placementType +
                    " pRot=" +
                    entry.placementRotation +
                    " vType=" +
                    entry.variantType +
                    " vRot=" +
                    entry.variantRotation +
                    " lvl=" +
                    entry.level +
                    " tile=" +
                    entry.tileX +
                    "," +
                    entry.tileY +
                    " pri=" +
                    entry.priority +
                    " delta=" +
                    delta,
            };
        }
        return { key: "locPreMergeSignatureStage", ok: false, detail: first };
    }
    return { key: "locPreMergeSignatureStage", ok: true };
}
function compareLocMergeDummyDigests(
    tsDigest: TsLocMergedDummyDigest | undefined,
    runtimeStats: Record<string, unknown> | undefined,
): StageResult {
    if (!tsDigest) {
        return { key: "locMergeDummyStage", ok: false, detail: "missing-ts-merge-dummy-digest" };
    }
    if (!runtimeStats) {
        return { key: "locMergeDummyStage", ok: false, detail: "missing-runtime-build-stats" };
    }
    const fields: Array<keyof TsLocMergedDummyDigest> = [
        "commandCount",
        "elementsTotal",
        "hash",
        "baseCount",
        "alphaCount",
        "lodCount",
        "lodAlphaCount",
    ];
    const runtimeFields: Record<keyof TsLocMergedDummyDigest, string> = {
        commandCount: "locMergedDummyCommandCount",
        elementsTotal: "locMergedDummyElementsTotal",
        hash: "locMergedDummyHash",
        baseCount: "locMergedDummyBaseCount",
        alphaCount: "locMergedDummyAlphaCount",
        lodCount: "locMergedDummyLodCount",
        lodAlphaCount: "locMergedDummyLodAlphaCount",
    };
    for (let i = 0; i < fields.length; i++) {
        const key = fields[i];
        const runtimeKey = runtimeFields[key];
        const tsValue = tsDigest[key] | 0;
        const runtimeValue = Number(runtimeStats[runtimeKey] ?? 0) | 0;
        if (tsValue !== runtimeValue) {
            return {
                key: "locMergeDummyStage",
                ok: false,
                detail: `${runtimeKey}: ts=${tsValue} cache=${runtimeValue}`,
            };
        }
    }
    return { key: "locMergeDummyStage", ok: true };
}
function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) throw new Error("No caches found");
    if (!cacheName) return latest;
    return caches.find((c) => c.name === cacheName) ?? latest;
}

function pickSquares(
    mapFileIndex: {
        tryGetTerrainArchiveId(x: number, y: number): number | undefined;
        tryGetLocArchiveId(x: number, y: number): number | undefined;
    },
    limit: number,
): Square[] {
    const squares: Square[] = [];
    outer: for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (mapFileIndex.tryGetTerrainArchiveId(mapX, mapY) === undefined) continue;
            if (mapFileIndex.tryGetLocArchiveId(mapX, mapY) === undefined) continue;
            squares.push({ mapX, mapY });
            if (squares.length >= limit) break outer;
        }
    }
    return squares;
}

function pickModelTargetSquares(
    mapFileIndex: {
        tryGetTerrainArchiveId(x: number, y: number): number | undefined;
        tryGetLocArchiveId(x: number, y: number): number | undefined;
    },
    mapBytesProvider: {
        getLocBytes(x: number, y: number): Uint8Array | undefined;
    },
    limit: number,
): Square[] {
    const candidates: Array<Square & { placementCount: number; uniqueLocCount: number }> = [];
    const fallbackCandidates: Array<Square & { placementCount: number; uniqueLocCount: number }> =
        [];
    for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (mapFileIndex.tryGetTerrainArchiveId(mapX, mapY) === undefined) continue;
            if (mapFileIndex.tryGetLocArchiveId(mapX, mapY) === undefined) continue;
            const locBytes = mapBytesProvider.getLocBytes(mapX, mapY);
            if (!(locBytes instanceof Uint8Array) || locBytes.length <= 0) continue;
            const placements = decodeLocPlacementsFromBytes(locBytes);
            if (placements.length <= 0) continue;
            const uniqueLocs = new Set<number>();
            for (let i = 0; i < placements.length; i++) {
                uniqueLocs.add(placements[i].id | 0);
            }
            const candidate = {
                mapX,
                mapY,
                placementCount: placements.length | 0,
                uniqueLocCount: uniqueLocs.size | 0,
            };
            fallbackCandidates.push(candidate);
            const mediumComplexity =
                candidate.placementCount >= 20 &&
                candidate.placementCount <= 180 &&
                candidate.uniqueLocCount >= 10 &&
                candidate.uniqueLocCount <= 90;
            if (mediumComplexity) {
                candidates.push(candidate);
            }
        }
    }
    const rank = (list: Array<Square & { placementCount: number; uniqueLocCount: number }>) =>
        list.sort((a, b) => {
            if (b.uniqueLocCount !== a.uniqueLocCount) {
                return b.uniqueLocCount - a.uniqueLocCount;
            }
            return b.placementCount - a.placementCount;
        });
    rank(candidates);
    if (candidates.length < limit) {
        rank(fallbackCandidates);
        const selected = new Set(candidates.map((c) => `${c.mapX},${c.mapY}`));
        for (let i = 0; i < fallbackCandidates.length && candidates.length < limit; i++) {
            const c = fallbackCandidates[i];
            const key = `${c.mapX},${c.mapY}`;
            if (!selected.has(key)) {
                selected.add(key);
                candidates.push(c);
            }
        }
    }
    return candidates.slice(0, limit).map((c) => ({ mapX: c.mapX, mapY: c.mapY }));
}

function pickAnimMayaTargetSquares(
    mapFileIndex: {
        tryGetTerrainArchiveId(x: number, y: number): number | undefined;
        tryGetLocArchiveId(x: number, y: number): number | undefined;
    },
    mapBytesProvider: {
        getLocBytes(x: number, y: number): Uint8Array | undefined;
    },
    services: {
        locTypeLoader: {
            tryLoad(id: number): { ok: true; value: any } | { ok: false; error: unknown };
        };
        seqTypeLoader?: {
            tryLoad(id: number): { ok: true; value: any } | { ok: false; error: unknown };
        };
        varProvider: any;
    },
    limit: number,
): Square[] {
    const candidates: Array<
        Square & { placementCount: number; uniqueLocCount: number; mayaPlacements: number }
    > = [];
    const fallback: Array<
        Square & { placementCount: number; uniqueLocCount: number; mayaPlacements: number }
    > = [];
    const seqTypeLoader = services.seqTypeLoader;
    if (!seqTypeLoader || typeof seqTypeLoader.tryLoad !== "function") {
        return [];
    }
    for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (mapFileIndex.tryGetTerrainArchiveId(mapX, mapY) === undefined) continue;
            if (mapFileIndex.tryGetLocArchiveId(mapX, mapY) === undefined) continue;
            const locBytes = mapBytesProvider.getLocBytes(mapX, mapY);
            if (!(locBytes instanceof Uint8Array) || locBytes.length <= 0) continue;
            const placements = decodeLocPlacementsFromBytes(locBytes);
            if (placements.length <= 0) continue;
            // Avoid pathological squares for quick iteration; we want representative, but not huge.
            // Selection is ranked by placementCount, so this is just a hard safety cap.
            if (placements.length > 5000) continue;

            let found = false;
            let mayaPlacements = 0;
            const uniqueLocs = new Set<number>();
            for (let i = 0; i < placements.length; i++) {
                const p = placements[i];
                uniqueLocs.add(p.id | 0);
                let locType: any;
                try {
                    locType = resolveLocTypeForPlacement(
                        p.id | 0,
                        services.locTypeLoader as any,
                        services.varProvider as any,
                    );
                } catch {
                    locType = undefined;
                }
                if (!locType) continue;
                const seqIds: number[] = [];
                const seqId = (locType.seqId ?? -1) | 0;
                if (seqId >= 0) seqIds.push(seqId);
                const randomSeqIds = (locType.randomSeqIds ?? undefined) as unknown;
                if (Array.isArray(randomSeqIds)) {
                    for (let r = 0; r < randomSeqIds.length; r++) {
                        const v = randomSeqIds[r] | 0;
                        if (v >= 0) seqIds.push(v);
                    }
                }
                for (let s = 0; s < seqIds.length; s++) {
                    let sr: any;
                    try {
                        sr = seqTypeLoader.tryLoad(seqIds[s] | 0);
                    } catch {
                        sr = undefined;
                    }
                    if (!sr.ok) continue;
                    const st = sr.value;
                    const hasMaya =
                        typeof st.hasAnimMayaSeq === "function"
                            ? !!st.hasAnimMayaSeq()
                            : ((st.animMayaId ?? -1) | 0) >= 0;
                    if (hasMaya) {
                        found = true;
                        mayaPlacements++;
                        break;
                    }
                }
            }
            if (!found) continue;
            const rec = {
                mapX,
                mapY,
                placementCount: placements.length | 0,
                uniqueLocCount: uniqueLocs.size | 0,
                mayaPlacements: mayaPlacements | 0,
            };
            fallback.push(rec);
            const mediumComplexity =
                rec.placementCount >= 10 &&
                rec.placementCount <= 140 &&
                rec.uniqueLocCount >= 8 &&
                rec.uniqueLocCount <= 90;
            if (mediumComplexity) {
                candidates.push(rec);
            }
        }
    }
    const rank = (list: typeof candidates) =>
        list.sort((a, b) => {
            // Prefer smaller squares to keep parity checks fast.
            if ((a.placementCount | 0) !== (b.placementCount | 0)) {
                return (a.placementCount | 0) - (b.placementCount | 0);
            }
            // Then prefer squares with more anim-maya placements.
            if ((b.mayaPlacements | 0) !== (a.mayaPlacements | 0)) {
                return (b.mayaPlacements | 0) - (a.mayaPlacements | 0);
            }
            return (b.uniqueLocCount | 0) - (a.uniqueLocCount | 0);
        });
    rank(candidates);
    if (candidates.length < limit) {
        rank(fallback);
        const selected = new Set(candidates.map((c) => `${c.mapX},${c.mapY}`));
        for (let i = 0; i < fallback.length && candidates.length < limit; i++) {
            const c = fallback[i];
            const key = `${c.mapX},${c.mapY}`;
            if (!selected.has(key)) {
                selected.add(key);
                candidates.push(c);
            }
        }
    }
    return candidates.slice(0, limit).map((c) => ({ mapX: c.mapX, mapY: c.mapY }));
}

function fnv1a32UpdateInt(hash: number, value: number): number {
    let h = hash >>> 0;
    const v = value >>> 0;
    h ^= v & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 16777619);
    return h >>> 0;
}

function fnv1a32UpdateByte(hash: number, value: number): number {
    let h = hash >>> 0;
    h ^= value & 0xff;
    h = Math.imul(h, 16777619);
    return h >>> 0;
}

function hashArray(data: ArrayLike<number>, seed: number): number {
    let h = seed >>> 0;
    for (let i = 0; i < data.length; i++) h = fnv1a32UpdateInt(h, data[i] | 0);
    return h >>> 0;
}

function hashByteArray(data: ArrayLike<number>, seed: number): number {
    let h = seed >>> 0;
    for (let i = 0; i < data.length; i++) h = fnv1a32UpdateByte(h, data[i] | 0);
    return h >>> 0;
}

function digestJsMapInput(sceneBuildInput: Record<string, unknown>): Readonly<{
    mapCount: number;
    terrainBytesLength: number;
    locBytesLength: number;
    mapSquareIdsHash: number;
    terrainOffsetsHash: number;
    terrainLengthsHash: number;
    terrainBytesHash: number;
    locBytesHash: number;
}> {
    const mapBytesProvider = sceneBuildInput.mapBytesProvider as
        | {
              getTerrainBytes(mapX: number, mapY: number): Uint8Array | undefined;
              getLocBytes(mapX: number, mapY: number): Uint8Array | undefined;
          }
        | undefined;
    const baseX = (sceneBuildInput.baseX as number) | 0;
    const baseY = (sceneBuildInput.baseY as number) | 0;
    const sizeX = (sceneBuildInput.sizeX as number) | 0;
    const sizeY = (sceneBuildInput.sizeY as number) | 0;
    if (!mapBytesProvider || sizeX <= 0 || sizeY <= 0) {
        return {
            mapCount: 0,
            terrainBytesLength: 0,
            locBytesLength: 0,
            mapSquareIdsHash: 2166136261 >>> 0,
            terrainOffsetsHash: 2166136261 >>> 0,
            terrainLengthsHash: 2166136261 >>> 0,
            terrainBytesHash: 2166136261 >>> 0,
            locBytesHash: 2166136261 >>> 0,
        };
    }
    const mapStartX = Math.floor(baseX / 64);
    const mapStartY = Math.floor(baseY / 64);
    const mapEndX = Math.ceil((baseX + sizeX) / 64);
    const mapEndY = Math.ceil((baseY + sizeY) / 64);
    const mapSquareIds: number[] = [];
    const terrainOffsets: number[] = [];
    const terrainLengths: number[] = [];
    const terrainBytes: number[] = [];
    const locBytes: number[] = [];
    let terrainOff = 0;
    for (let mapX = mapStartX; mapX < mapEndX; mapX++) {
        for (let mapY = mapStartY; mapY < mapEndY; mapY++) {
            const terrain = mapBytesProvider.getTerrainBytes(mapX, mapY);
            const loc = mapBytesProvider.getLocBytes(mapX, mapY);
            if (!terrain && !loc) continue;
            mapSquareIds.push(((mapX << 8) + mapY) | 0);
            if (terrain && terrain.length > 0) {
                terrainOffsets.push(terrainOff);
                terrainLengths.push(terrain.length | 0);
                for (let i = 0; i < terrain.length; i++) terrainBytes.push(terrain[i] | 0);
                terrainOff += terrain.length | 0;
            } else {
                terrainOffsets.push(-1);
                terrainLengths.push(-1);
            }
            if (loc && loc.length > 0) {
                for (let i = 0; i < loc.length; i++) locBytes.push(loc[i] | 0);
            }
        }
    }
    let terrainBytesHash = 2166136261 >>> 0;
    for (let i = 0; i < terrainBytes.length; i++) {
        terrainBytesHash = fnv1a32UpdateByte(terrainBytesHash, terrainBytes[i]);
    }
    let locBytesHash = 2166136261 >>> 0;
    for (let i = 0; i < locBytes.length; i++) {
        locBytesHash = fnv1a32UpdateByte(locBytesHash, locBytes[i]);
    }
    return {
        mapCount: mapSquareIds.length | 0,
        terrainBytesLength: terrainBytes.length | 0,
        locBytesLength: locBytes.length | 0,
        mapSquareIdsHash: hashArray(mapSquareIds, 2166136261 >>> 0),
        terrainOffsetsHash: hashArray(terrainOffsets, 2166136261 >>> 0),
        terrainLengthsHash: hashArray(terrainLengths, 2166136261 >>> 0),
        terrainBytesHash,
        locBytesHash,
    };
}

function digestOverlay(overlay: RuntimeOverlay): Record<string, number> {
    let drawRanges = 2166136261 >>> 0;
    drawRanges = hashArray(overlay.drawRanges.base, drawRanges);
    drawRanges = hashArray(overlay.drawRanges.alpha, drawRanges);
    drawRanges = hashArray(overlay.drawRanges.lod, drawRanges);
    drawRanges = hashArray(overlay.drawRanges.lodAlpha, drawRanges);
    drawRanges = hashArray(overlay.drawRanges.interact, drawRanges);
    drawRanges = hashArray(overlay.drawRanges.interactAlpha, drawRanges);
    drawRanges = hashArray(overlay.drawRanges.interactLod, drawRanges);
    drawRanges = hashArray(overlay.drawRanges.interactLodAlpha, drawRanges);

    let modelInfo = 2166136261 >>> 0;
    modelInfo = hashArray(overlay.modelInfoTextures.base, modelInfo);
    modelInfo = hashArray(overlay.modelInfoTextures.alpha, modelInfo);
    modelInfo = hashArray(overlay.modelInfoTextures.lod, modelInfo);
    modelInfo = hashArray(overlay.modelInfoTextures.lodAlpha, modelInfo);
    modelInfo = hashArray(overlay.modelInfoTextures.interact, modelInfo);
    modelInfo = hashArray(overlay.modelInfoTextures.interactAlpha, modelInfo);
    modelInfo = hashArray(overlay.modelInfoTextures.interactLod, modelInfo);
    modelInfo = hashArray(overlay.modelInfoTextures.interactLodAlpha, modelInfo);

    return {
        heightMap: hashArray(overlay.heightMapTextureData, 2166136261 >>> 0),
        drawRanges,
        modelInfo,
    };
}

const PACKED_VERTEX_SIZE_BYTES = 16;

type PackedDrawRangesLike = Readonly<
    Record<(typeof DRAW_BUCKET_KEYS)[number], readonly number[] | Int32Array>
>;

function collectUsedIndexRanges(
    drawRanges: PackedDrawRangesLike,
): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < DRAW_BUCKET_KEYS.length; i++) {
        const key = DRAW_BUCKET_KEYS[i];
        const packed = drawRanges[key];
        for (let j = 0; j + 2 < packed.length; j += 3) {
            const offsetBytes = packed[j] | 0;
            const elements = packed[j + 1] | 0;
            if (offsetBytes < 0 || elements <= 0) {
                continue;
            }
            const start = offsetBytes >> 2;
            const end = start + elements;
            if (end > start) {
                ranges.push({ start, end });
            }
        }
    }
    if (ranges.length <= 1) {
        return ranges;
    }
    ranges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    let curStart = ranges[0].start | 0;
    let curEnd = ranges[0].end | 0;
    for (let i = 1; i < ranges.length; i++) {
        const nextStart = ranges[i].start | 0;
        const nextEnd = ranges[i].end | 0;
        if (nextStart <= curEnd) {
            if (nextEnd > curEnd) {
                curEnd = nextEnd;
            }
            continue;
        }
        merged.push({ start: curStart, end: curEnd });
        curStart = nextStart;
        curEnd = nextEnd;
    }
    merged.push({ start: curStart, end: curEnd });
    return merged;
}

function hashIndicesInRanges(
    indices: Int32Array,
    ranges: ReadonlyArray<{ start: number; end: number }>,
): number {
    let h = 2166136261 >>> 0;
    for (let r = 0; r < ranges.length; r++) {
        const start = Math.max(0, ranges[r].start | 0);
        const end = Math.min(indices.length, ranges[r].end | 0);
        for (let i = start; i < end; i++) {
            h = fnv1a32UpdateInt(h, indices[i] | 0);
        }
    }
    return h >>> 0;
}

function hashVertexPrefixFromIndexRanges(
    vertices: Uint8Array,
    indices: Int32Array,
    ranges: ReadonlyArray<{ start: number; end: number }>,
): number {
    let maxIndex = -1;
    for (let r = 0; r < ranges.length; r++) {
        const start = Math.max(0, ranges[r].start | 0);
        const end = Math.min(indices.length, ranges[r].end | 0);
        for (let i = start; i < end; i++) {
            const idx = indices[i] | 0;
            if (idx > maxIndex) {
                maxIndex = idx;
            }
        }
    }
    if (maxIndex < 0) {
        return 2166136261 >>> 0;
    }
    const neededBytes = (maxIndex + 1) * PACKED_VERTEX_SIZE_BYTES;
    const clampedBytes = Math.min(vertices.length, neededBytes);
    return hashByteArray(vertices.subarray(0, clampedBytes), 2166136261 >>> 0);
}

function digestPacketPayload(payload: SdMapData): PacketDigest {
    const d = digestOverlay(toRuntimeOverlay(payload));
    const usedRanges = collectUsedIndexRanges(payload.drawRanges);
    return {
        heightMap: d.heightMap,
        drawRanges: d.drawRanges,
        modelInfo: d.modelInfo,
        vertices: hashVertexPrefixFromIndexRanges(payload.vertices, payload.indices, usedRanges),
        indices: hashIndicesInRanges(payload.indices, usedRanges),
    };
}

function digestRuntimePacket(
    cacheOverlay: RuntimeOverlay,
    packet: MapRenderRuntimePacket,
): PacketDigest {
    const d = digestOverlay(cacheOverlay);
    const usedRanges = collectUsedIndexRanges(cacheOverlay.drawRanges);
    const hasPacketData =
        packet.vertices instanceof Uint8Array && packet.indices instanceof Int32Array;
    const vertices = hasPacketData
        ? hashVertexPrefixFromIndexRanges(
              packet.vertices as Uint8Array,
              packet.indices as Int32Array,
              usedRanges,
          )
        : 0;
    const indices = hasPacketData
        ? hashIndicesInRanges(packet.indices as Int32Array, usedRanges)
        : 0;
    return {
        heightMap: d.heightMap,
        drawRanges: d.drawRanges,
        modelInfo: d.modelInfo,
        vertices,
        indices,
    };
}

function cloneRuntimePacketGeometry(packet: MapRenderRuntimePacket): MapRenderRuntimePacket {
    return {
        ...packet,
        vertices: new Uint8Array(packet.vertices),
        indices: new Int32Array(packet.indices),
    };
}

function summarizeDrawRangeBuckets(drawRanges: SdMapData["drawRanges"]): Record<
    string,
    {
        cmds: number;
        elements: number;
        instances: number;
        multiInstanceCmds: number;
        zeroElementCmds: number;
    }
> {
    const out: Record<
        string,
        {
            cmds: number;
            elements: number;
            instances: number;
            multiInstanceCmds: number;
            zeroElementCmds: number;
        }
    > = {};
    for (let i = 0; i < DRAW_BUCKET_KEYS.length; i++) {
        const key = DRAW_BUCKET_KEYS[i];
        const packed = drawRanges[key];
        let elements = 0;
        let instances = 0;
        let multiInstanceCmds = 0;
        let zeroElementCmds = 0;
        for (let j = 0; j + 2 < packed.length; j += 3) {
            const cmdInstances = packed[j + 2] | 0;
            elements += packed[j + 1] | 0;
            instances += cmdInstances;
            if (cmdInstances > 1) {
                multiInstanceCmds++;
            }
            if ((packed[j + 1] | 0) === 0) {
                zeroElementCmds++;
            }
        }
        out[key] = {
            cmds: (packed.length / 3) | 0,
            elements: elements | 0,
            instances: instances | 0,
            multiInstanceCmds: multiInstanceCmds | 0,
            zeroElementCmds: zeroElementCmds | 0,
        };
    }
    return out;
}

function decodeModelInfoTextureInstances(
    packedDrawRanges: readonly number[] | Int32Array,
    textureData: Uint16Array,
): Array<{
    sceneX: number;
    sceneZ: number;
    level: number;
    contourGround: number;
    priority: number;
    interactType: number;
    interactId: number;
    heightDiv8: number;
}> {
    const cmdCount = ((packedDrawRanges.length / 3) | 0) >>> 0;
    let instanceCount = 0;
    for (let i = 0; i + 2 < packedDrawRanges.length; i += 3) {
        instanceCount += packedDrawRanges[i + 2] | 0;
    }
    const out: Array<{
        sceneX: number;
        sceneZ: number;
        level: number;
        contourGround: number;
        priority: number;
        interactType: number;
        interactId: number;
        heightDiv8: number;
    }> = [];

    const base = (cmdCount * 4) | 0;
    for (let i = 0; i < instanceCount; i++) {
        const off = (base + i * 4) | 0;
        const w0 = textureData[off + 0] | 0;
        const w1 = textureData[off + 1] | 0;
        const w2 = textureData[off + 2] | 0;
        const w3 = textureData[off + 3] | 0;

        const sceneX = w0 & 0x3fff;
        const level = (w0 >>> 14) & 0x3;
        const sceneZ = w1 & 0x3fff;
        const contourGround = (w1 >>> 14) & 0x3;

        const priority = w2 & 0x7;
        const interactType = (w2 >>> 4) & 0x3;
        const heightDiv8 = (w2 << 16) >> 22; // signed 10-bit-ish lane

        // For our use-cases ids are < 65536; keep a best-effort decode anyway.
        const hi = (w2 >>> 3) & 0x1fff;
        const interactId = ((hi << 16) | w3) >>> 0;

        out.push({
            sceneX,
            sceneZ,
            level,
            contourGround,
            priority,
            interactType,
            interactId,
            heightDiv8,
        });
    }
    return out;
}

function digestTsRuntimeCommandStream(
    runtimeCommandStreamInput: {
        cmdBucketIndices: Int32Array;
        cmdOffsets: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    payload: SdMapData,
): RuntimeCommandDigest {
    const bucketCmdCounts = new Array<number>(DRAW_BUCKET_KEYS.length).fill(0);
    const cmdBucketIndices = runtimeCommandStreamInput.cmdBucketIndices;
    for (let i = 0; i < cmdBucketIndices.length; i++) {
        const bucket = cmdBucketIndices[i] | 0;
        if (bucket >= 0 && bucket < bucketCmdCounts.length) {
            bucketCmdCounts[bucket] = (bucketCmdCounts[bucket] | 0) + 1;
        }
    }

    return {
        totalCmdCount: runtimeCommandStreamInput.cmdOffsets.length | 0,
        cmdBucketIndicesHash: hashArray(
            runtimeCommandStreamInput.cmdBucketIndices,
            2166136261 >>> 0,
        ),
        cmdOffsetsHash: hashArray(runtimeCommandStreamInput.cmdOffsets, 2166136261 >>> 0),
        cmdElementsHash: hashArray(runtimeCommandStreamInput.cmdElements, 2166136261 >>> 0),
        cmdInstanceCountsHash: hashArray(
            runtimeCommandStreamInput.cmdInstanceCounts,
            2166136261 >>> 0,
        ),
        cmdPackedInstancesHash: hashArray(
            runtimeCommandStreamInput.cmdPackedInstances,
            2166136261 >>> 0,
        ),
        verticesHash: hashVertexPrefixFromIndexRanges(
            payload.vertices,
            payload.indices,
            collectUsedIndexRanges(payload.drawRanges),
        ),
        indicesHash: hashIndicesInRanges(
            payload.indices,
            collectUsedIndexRanges(payload.drawRanges),
        ),
        bucketCmdCounts,
    };
}

function normalizeRuntimeCommandDigest(raw: unknown): RuntimeCommandDigest | undefined {
    if (!raw || typeof raw !== "object") {
        return undefined;
    }
    const value = raw as {
        totalCmdCount?: unknown;
        cmdBucketIndicesHash?: unknown;
        cmdOffsetsHash?: unknown;
        cmdElementsHash?: unknown;
        cmdInstanceCountsHash?: unknown;
        cmdPackedInstancesHash?: unknown;
        verticesHash?: unknown;
        indicesHash?: unknown;
        bucketCmdCounts?: unknown;
    };
    if (
        !Array.isArray(value.bucketCmdCounts) ||
        value.bucketCmdCounts.length !== DRAW_BUCKET_KEYS.length
    ) {
        return undefined;
    }
    return {
        totalCmdCount: Number(value.totalCmdCount ?? 0) | 0,
        cmdBucketIndicesHash: Number(value.cmdBucketIndicesHash ?? 0) >>> 0,
        cmdOffsetsHash: Number(value.cmdOffsetsHash ?? 0) >>> 0,
        cmdElementsHash: Number(value.cmdElementsHash ?? 0) >>> 0,
        cmdInstanceCountsHash: Number(value.cmdInstanceCountsHash ?? 0) >>> 0,
        cmdPackedInstancesHash: Number(value.cmdPackedInstancesHash ?? 0) >>> 0,
        verticesHash: Number(value.verticesHash ?? 0) >>> 0,
        indicesHash: Number(value.indicesHash ?? 0) >>> 0,
        bucketCmdCounts: value.bucketCmdCounts.map((v) => Number(v) | 0),
    };
}

function firstBucketCommandCountMismatch(
    tsDigest: RuntimeCommandDigest,
    cacheDigest: RuntimeCommandDigest,
): string | undefined {
    for (let i = 0; i < DRAW_BUCKET_KEYS.length; i++) {
        const tsCount = tsDigest.bucketCmdCounts[i] | 0;
        const cacheCount = cacheDigest.bucketCmdCounts[i] | 0;
        if (tsCount !== cacheCount) {
            return `${DRAW_BUCKET_KEYS[i]}: ts=${tsCount} cache=${cacheCount}`;
        }
    }
    return undefined;
}

function firstRuntimeCommandDigestMismatch(
    tsDigest: RuntimeCommandDigest,
    cacheDigest: RuntimeCommandDigest,
): string | undefined {
    const scalarFields: Array<keyof RuntimeCommandDigest> = [
        "totalCmdCount",
        "cmdBucketIndicesHash",
        "cmdOffsetsHash",
        "cmdElementsHash",
        "cmdInstanceCountsHash",
        "cmdPackedInstancesHash",
        "verticesHash",
        "indicesHash",
    ];
    for (let i = 0; i < scalarFields.length; i++) {
        const field = scalarFields[i];
        if ((tsDigest[field] as number) !== (cacheDigest[field] as number)) {
            return `${field}: ts=${tsDigest[field] as number} cache=${
                cacheDigest[field] as number
            }`;
        }
    }
    for (let i = 0; i < DRAW_BUCKET_KEYS.length; i++) {
        const tsCount = tsDigest.bucketCmdCounts[i] | 0;
        const cacheCount = cacheDigest.bucketCmdCounts[i] | 0;
        if (tsCount !== cacheCount) {
            return `bucketCmdCounts.${DRAW_BUCKET_KEYS[i]}: ts=${tsCount} cache=${cacheCount}`;
        }
    }
    return undefined;
}

function firstArrayMismatchIndex(expected: ArrayLike<number>, actual: ArrayLike<number>): number {
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
        if ((expected[i] | 0) !== (actual[i] | 0)) {
            return i;
        }
    }
    if (expected.length !== actual.length) {
        return n;
    }
    return -1;
}

function describeCommandAtIndex(
    label: string,
    cmdBucketIndices: Int32Array,
    cmdOffsets: Int32Array,
    cmdElements: Int32Array,
    cmdInstanceCounts: Int32Array,
    cmdPackedInstances: Int32Array | undefined,
    idx: number,
): string {
    const b = idx < cmdBucketIndices.length ? cmdBucketIndices[idx] | 0 : undefined;
    const o = idx < cmdOffsets.length ? cmdOffsets[idx] | 0 : undefined;
    const e = idx < cmdElements.length ? cmdElements[idx] | 0 : undefined;
    const c = idx < cmdInstanceCounts.length ? cmdInstanceCounts[idx] | 0 : undefined;

    const parts: string[] = [
        `${label} cmd[${idx}] bucket=${b ?? "<end>"} offset=${o ?? "<end>"} elements=${
            e ?? "<end>"
        } instances=${c ?? "<end>"}`,
    ];

    // TS packs 8 int32 words per instance.
    if (cmdPackedInstances && typeof c === "number" && c > 0) {
        let instanceBase = 0;
        for (let i = 0; i < idx && i < cmdInstanceCounts.length; i++) {
            instanceBase += cmdInstanceCounts[i] | 0;
        }
        const packedOff = (instanceBase * 8) | 0;
        if (packedOff + 7 < cmdPackedInstances.length) {
            const sceneX = cmdPackedInstances[packedOff + 0] | 0;
            const sceneZ = cmdPackedInstances[packedOff + 1] | 0;
            const heightOffset = cmdPackedInstances[packedOff + 2] | 0;
            const level = cmdPackedInstances[packedOff + 3] | 0;
            const contourGround = cmdPackedInstances[packedOff + 4] | 0;
            const priority = cmdPackedInstances[packedOff + 5] | 0;
            const interactType = cmdPackedInstances[packedOff + 6] | 0;
            const interactId = cmdPackedInstances[packedOff + 7] >>> 0;
            const interactNames = ["NONE", "LOC", "OBJ", "NPC"];
            const interactName =
                interactType >= 0 && interactType < interactNames.length
                    ? interactNames[interactType]
                    : String(interactType);
            parts.push(
                `inst0{sceneX=${sceneX} sceneZ=${sceneZ} hOff=${heightOffset} level=${level} contour=${contourGround} pri=${priority} interact=${interactName} id=${interactId}} instBase=${instanceBase}`,
            );
        } else {
            parts.push(`inst0{<oob>} instBase=${instanceBase}`);
        }
    }

    return parts.join(" ");
}

function collectCommandInstances(
    cmdIndex: number,
    cmdInstanceCounts: Int32Array,
    cmdPackedInstances: Int32Array,
): Array<{
    sceneX: number;
    sceneZ: number;
    heightOffset: number;
    level: number;
    contour: number;
    pri: number;
    interactType: number;
    interactId: number;
}> {
    let instanceBase = 0;
    for (let i = 0; i < cmdIndex && i < cmdInstanceCounts.length; i++) {
        instanceBase += cmdInstanceCounts[i] | 0;
    }
    const ic = cmdIndex < cmdInstanceCounts.length ? cmdInstanceCounts[cmdIndex] | 0 : 0;
    const out: Array<{
        sceneX: number;
        sceneZ: number;
        heightOffset: number;
        level: number;
        contour: number;
        pri: number;
        interactType: number;
        interactId: number;
    }> = [];
    let off = (instanceBase * 8) | 0;
    for (let j = 0; j < ic; j++) {
        if (off + 7 >= cmdPackedInstances.length) break;
        out.push({
            sceneX: cmdPackedInstances[off + 0] | 0,
            sceneZ: cmdPackedInstances[off + 1] | 0,
            heightOffset: cmdPackedInstances[off + 2] | 0,
            level: cmdPackedInstances[off + 3] | 0,
            contour: cmdPackedInstances[off + 4] | 0,
            pri: cmdPackedInstances[off + 5] | 0,
            interactType: cmdPackedInstances[off + 6] | 0,
            interactId: cmdPackedInstances[off + 7] >>> 0,
        });
        off += 8;
    }
    return out;
}

function findFirstCommandsWithFirstInstanceFields(
    cmdBucketIndices: Int32Array,
    cmdInstanceCounts: Int32Array,
    cmdPackedInstances: Int32Array,
    want: {
        sceneX: number;
        sceneZ: number;
        level: number;
        contour: number;
        pri: number;
        instanceCount: number;
    },
    limit: number,
): Array<{ cmdIndex: number; bucket: number }> {
    const out: Array<{ cmdIndex: number; bucket: number }> = [];
    let instanceBase = 0;
    for (let cmdIndex = 0; cmdIndex < cmdBucketIndices.length; cmdIndex++) {
        const ic = cmdIndex < cmdInstanceCounts.length ? cmdInstanceCounts[cmdIndex] | 0 : 0;
        const packedOff = (instanceBase * 8) | 0;
        if (ic === (want.instanceCount | 0) && packedOff + 5 < cmdPackedInstances.length) {
            const sceneX = cmdPackedInstances[packedOff + 0] | 0;
            const sceneZ = cmdPackedInstances[packedOff + 1] | 0;
            const level = cmdPackedInstances[packedOff + 3] | 0;
            const contour = cmdPackedInstances[packedOff + 4] | 0;
            const pri = cmdPackedInstances[packedOff + 5] | 0;
            if (
                sceneX === (want.sceneX | 0) &&
                sceneZ === (want.sceneZ | 0) &&
                level === (want.level | 0) &&
                contour === (want.contour | 0) &&
                pri === (want.pri | 0)
            ) {
                out.push({ cmdIndex, bucket: cmdBucketIndices[cmdIndex] | 0 });
                if (out.length >= limit) {
                    return out;
                }
            }
        }
        instanceBase += ic;
    }
    return out;
}

function findFirstCommandsWithAnyInstanceFields(
    cmdBucketIndices: Int32Array,
    cmdInstanceCounts: Int32Array,
    cmdPackedInstances: Int32Array,
    want: { sceneX: number; sceneZ: number; level: number; contour: number; pri: number },
    limit: number,
): Array<{ cmdIndex: number; bucket: number; instanceIndex: number; instanceCount: number }> {
    const out: Array<{
        cmdIndex: number;
        bucket: number;
        instanceIndex: number;
        instanceCount: number;
    }> = [];
    let instanceBase = 0;
    for (let cmdIndex = 0; cmdIndex < cmdBucketIndices.length; cmdIndex++) {
        const ic = cmdIndex < cmdInstanceCounts.length ? cmdInstanceCounts[cmdIndex] | 0 : 0;
        const baseWord = (instanceBase * 8) | 0;
        let matchedInstance = -1;
        for (let j = 0; j < ic; j++) {
            const off = baseWord + j * 8;
            if (off + 7 >= cmdPackedInstances.length) {
                break;
            }
            const sceneX = cmdPackedInstances[off + 0] | 0;
            const sceneZ = cmdPackedInstances[off + 1] | 0;
            const level = cmdPackedInstances[off + 3] | 0;
            const contour = cmdPackedInstances[off + 4] | 0;
            const pri = cmdPackedInstances[off + 5] | 0;
            if (
                sceneX === (want.sceneX | 0) &&
                sceneZ === (want.sceneZ | 0) &&
                level === (want.level | 0) &&
                contour === (want.contour | 0) &&
                pri === (want.pri | 0)
            ) {
                matchedInstance = j;
                break;
            }
        }
        if (matchedInstance >= 0) {
            out.push({
                cmdIndex,
                bucket: cmdBucketIndices[cmdIndex] | 0,
                instanceIndex: matchedInstance,
                instanceCount: ic,
            });
            if (out.length >= limit) {
                return out;
            }
        }
        instanceBase += ic;
    }
    return out;
}

function findFirstCommandsWithInteractKey(
    cmdBucketIndices: Int32Array,
    cmdInstanceCounts: Int32Array,
    cmdPackedInstances: Int32Array,
    interactType: number,
    interactId: number,
    limit: number,
): Array<{ cmdIndex: number; bucket: number; instanceIndex: number }> {
    const out: Array<{ cmdIndex: number; bucket: number; instanceIndex: number }> = [];
    let instanceBase = 0;
    for (let cmdIndex = 0; cmdIndex < cmdBucketIndices.length; cmdIndex++) {
        const ic = cmdIndex < cmdInstanceCounts.length ? cmdInstanceCounts[cmdIndex] | 0 : 0;
        const baseWord = (instanceBase * 8) | 0;
        let firstInstanceIndex = -1;
        for (let j = 0; j < ic; j++) {
            const off = baseWord + j * 8;
            if (off + 7 >= cmdPackedInstances.length) {
                break;
            }
            const it = cmdPackedInstances[off + 6] | 0;
            const id = cmdPackedInstances[off + 7] >>> 0;
            if (it === (interactType | 0) && id === interactId >>> 0) {
                firstInstanceIndex = j;
                break;
            }
        }
        if (firstInstanceIndex >= 0) {
            out.push({
                cmdIndex,
                bucket: cmdBucketIndices[cmdIndex] | 0,
                instanceIndex: firstInstanceIndex,
            });
            if (out.length >= limit) {
                return out;
            }
        }
        instanceBase += ic;
    }
    return out;
}

type TsSceneLocRecord = Readonly<{
    id: number;
    level: number;
    sceneX: number;
    sceneZ: number;
    priority: number;
    placementType: number;
    placementRotation: number;
    category: string;
    tileX: number;
    tileY: number;
}>;

type TsLocVariantStageDigest = Readonly<{
    groupsQueued: number;
    groupsHash: number;
    type9Queued: number;
    type0Queued: number;
    id1651Type9Queued: number;
    id1651Type0Queued: number;
}>;

type TsLocVariantDropDigest = Readonly<{
    candidatesExpanded: number;
    decodeFailed: number;
}>;

type TsLocPreMergeGroupKeyDigest = Readonly<{
    keysQueued: number;
    keysHash: number;
}>;

type TsLocPreMergeSignatureEntry = Readonly<{
    signature: number;
    locTypeId: number;
    placementType: number;
    placementRotation: number;
    variantType: number;
    variantRotation: number;
    level: number;
    tileX: number;
    tileY: number;
    priority: number;
    forceMerge: number;
    includeLod: number;
    sceneHeight: number;
    contourSceneX: number;
    contourSceneZ: number;
    contourGround: number;
    modelIdsHash: number;
}>;

type TsLocStageDigests = Readonly<{
    renderPlacement: TsLocRenderPlacementDigest;
    // Stride=13 i32, matches runtime debugLocRenderPlacementEntriesPacked.
    // [0]=placementId [1]=resolvedLocTypeId [2]=placementType [3]=placementRotation
    // [4]=level [5]=tileX [6]=tileY [7]=seqId [8]=priority [9]=interactId
    // [10]=includeLod(0/1) [11]=forceMerge(0/1) [12]=sourceIsEntity(0/1)
    renderPlacementEntriesPacked: Int32Array;
    modelIdsUsed: ReadonlyArray<number>;
    variant: TsLocVariantStageDigest;
    variantDrop: TsLocVariantDropDigest;
    preMergeGroupKey: TsLocPreMergeGroupKeyDigest;
    preMergeKeySignatures: Int32Array;
    preMergeSignatureEntries: ReadonlyArray<TsLocPreMergeSignatureEntry>;
}>;

type TsLocRenderPlacementDigest = Readonly<{
    placementsResolved: number;
    resolvedTypeCount: number;
    animatedCount: number;
    hash: number;
}>;

function collectLocModelIdsForVariant(
    locType: { types?: number[]; models?: number[][] },
    placementType: number,
): readonly number[] | undefined {
    const models = locType.models;
    if (!Array.isArray(models) || models.length === 0) {
        return undefined;
    }
    if (!Array.isArray(locType.types) || locType.types.length === 0) {
        if ((placementType | 0) !== LocModelType.NORMAL) {
            return undefined;
        }
        const ids = models[0];
        return Array.isArray(ids) && ids.length > 0 ? ids : undefined;
    }
    for (let i = 0; i < locType.types.length; i++) {
        if ((locType.types[i] | 0) !== (placementType | 0)) {
            continue;
        }
        const ids = models[i];
        if (Array.isArray(ids) && ids.length > 0) {
            return ids;
        }
        return undefined;
    }
    return undefined;
}

function isWithinSceneHeightBounds(
    scene: { levels: number; sizeX: number; sizeY: number },
    level: number,
    tileX: number,
    tileY: number,
): boolean {
    return (
        level >= 0 &&
        level < (scene.levels | 0) &&
        tileX >= 0 &&
        tileX <= (scene.sizeX | 0) &&
        tileY >= 0 &&
        tileY <= (scene.sizeY | 0)
    );
}

function computeTsLocContourSampleOrigin(
    locType: { sizeX: number; sizeY: number },
    rotation: number,
    tileX: number,
    tileY: number,
): Readonly<{ sceneX: number; sceneZ: number }> {
    let sizeX = locType.sizeX | 0;
    let sizeY = locType.sizeY | 0;
    if (((rotation | 0) & 1) !== 0) {
        const swap = sizeX;
        sizeX = sizeY;
        sizeY = swap;
    }
    return {
        sceneX: ((tileX << 7) + (sizeX << 6)) | 0,
        sceneZ: ((tileY << 7) + (sizeY << 6)) | 0,
    };
}

function computeTsLocSceneHeight(
    scene: {
        levels: number;
        sizeX: number;
        sizeY: number;
        tileHeights: Int32Array[][];
    },
    locType: { sizeX: number; sizeY: number },
    level: number,
    tileX: number,
    tileY: number,
    rotation: number,
): number {
    let sizeX = locType.sizeX | 0;
    let sizeY = locType.sizeY | 0;
    if (((rotation | 0) & 1) !== 0) {
        const swap = sizeX;
        sizeX = sizeY;
        sizeY = swap;
    }

    const startX = ((sizeX >> 1) + tileX) | 0;
    const endX = (((sizeX + 1) >> 1) + tileX) | 0;
    const startY = ((sizeY >> 1) + tileY) | 0;
    const endY = (((sizeY + 1) >> 1) + tileY) | 0;

    if (
        !isWithinSceneHeightBounds(scene, level, startX, startY) ||
        !isWithinSceneHeightBounds(scene, level, endX, startY) ||
        !isWithinSceneHeightBounds(scene, level, startX, endY) ||
        !isWithinSceneHeightBounds(scene, level, endX, endY)
    ) {
        return 0;
    }

    return (
        ((scene.tileHeights[level][endX][endY] | 0) +
            (scene.tileHeights[level][startX][endY] | 0) +
            (scene.tileHeights[level][startX][startY] | 0) +
            (scene.tileHeights[level][endX][startY] | 0)) >>
        2
    );
}

function resolveTsLocInstanceContourGroundSimple(
    scene: { levels: number; sizeX: number; sizeY: number; tileHeights: Int32Array[][] },
    locType: { contourGroundType: number },
    level: number,
    tileX: number,
    tileY: number,
): number {
    const contourType = locType.contourGroundType | 0;
    if (contourType <= 0) {
        return 0;
    }
    if (contourType === 3) {
        return 1;
    }

    if (
        !isWithinSceneHeightBounds(scene, level, tileX, tileY) ||
        !isWithinSceneHeightBounds(scene, level, tileX + 1, tileY) ||
        !isWithinSceneHeightBounds(scene, level, tileX, tileY + 1) ||
        !isWithinSceneHeightBounds(scene, level, tileX + 1, tileY + 1)
    ) {
        return 0;
    }

    if (contourType === 4 || contourType === 5) {
        const above = (level + 1) | 0;
        if (
            !isWithinSceneHeightBounds(scene, above, tileX, tileY) ||
            !isWithinSceneHeightBounds(scene, above, tileX + 1, tileY) ||
            !isWithinSceneHeightBounds(scene, above, tileX, tileY + 1) ||
            !isWithinSceneHeightBounds(scene, above, tileX + 1, tileY + 1)
        ) {
            return 0;
        }
        return 1;
    }

    const h00 = scene.tileHeights[level][tileX][tileY] | 0;
    const h10 = scene.tileHeights[level][tileX + 1][tileY] | 0;
    const h01 = scene.tileHeights[level][tileX][tileY + 1] | 0;
    const h11 = scene.tileHeights[level][tileX + 1][tileY + 1] | 0;
    const centerHeight = (h00 + h10 + h01 + h11) >> 2;
    if (
        h00 === centerHeight &&
        h10 === centerHeight &&
        h01 === centerHeight &&
        h11 === centerHeight
    ) {
        return 0;
    }
    return 1;
}

function computeTsLocStageDigests(
    sceneBuilder: SceneBuilder,
    mapBytesProvider: MapFileBytesProvider,
    sceneBuildInput: Record<string, unknown>,
    maxLevel: number,
    modelLoader: { tryGet(id: number): unknown },
): TsLocStageDigests | undefined {
    const borderSize = ((((sceneBuildInput.sizeX as number) | 0) - 64) / 2) | 0;
    if (borderSize < 0) {
        return undefined;
    }
    const scene = buildSceneFromMapBytesProvider(
        sceneBuilder,
        mapBytesProvider,
        (sceneBuildInput.baseX as number) | 0,
        (sceneBuildInput.baseY as number) | 0,
        (sceneBuildInput.sizeX as number) | 0,
        (sceneBuildInput.sizeY as number) | 0,
        !!sceneBuildInput.smoothTerrain,
        LocLoadType.MODELS,
    );
    const records = collectTsSceneLocRecords(scene, borderSize, maxLevel | 0);
    const locTypeLoader = sceneBuilder.services.locTypeLoader;
    const varProvider = sceneBuilder.services.varProvider;

    const modelIdsUsedSet = new Set<number>();
    let placementsResolved = 0;
    let resolvedTypeCount = 0;
    let animatedCount = 0;
    let renderPlacementHash = 2166136261 >>> 0;
    const renderPlacementEntriesPacked: number[] = [];

    let groupsQueued = 0;
    let groupsHash = 2166136261 >>> 0;
    let type9Queued = 0;
    let type0Queued = 0;
    let id1651Type9Queued = 0;
    let id1651Type0Queued = 0;
    let candidatesExpanded = 0;
    let decodeFailed = 0;

    let preMergeGroupKeysQueued = 0;
    let preMergeGroupKeysHash = 2166136261 >>> 0;
    const preMergeKeySignatures: number[] = [];
    const preMergeSignatureEntries: TsLocPreMergeSignatureEntry[] = [];

    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const locTypeId = record.id | 0;
        const baseResult = locTypeLoader.tryLoad(locTypeId);
        if (!baseResult.ok) {
            continue;
        }
        const baseLocType = baseResult.value as { transforms?: unknown };
        const baseHadTransforms =
            (baseLocType as { transforms?: unknown }).transforms !== undefined &&
            (baseLocType as { transforms?: unknown }).transforms !== null;

        const resolvedLocType = resolveLocTypeForPlacement(locTypeId, locTypeLoader, varProvider);
        if (!resolvedLocType) {
            continue;
        }

        placementsResolved++;
        if ((resolvedLocType.id | 0) !== (locTypeId | 0)) {
            resolvedTypeCount++;
        }

        let seqId = (resolvedLocType.seqId ?? -1) | 0;
        const randomSeqIds = (resolvedLocType as { randomSeqIds?: ReadonlyArray<number> })
            .randomSeqIds;
        if (seqId === -1 && Array.isArray(randomSeqIds) && randomSeqIds.length > 0) {
            seqId = (randomSeqIds[0] ?? -1) | 0;
        }

        const placementType = record.placementType | 0;
        const placementRotation = record.placementRotation | 0;
        const lowDetail = isLowDetail(
            scene,
            record.level | 0,
            record.tileX | 0,
            record.tileY | 0,
            resolvedLocType,
            placementType as LocModelType,
        );
        const includeLod = !lowDetail;
        // TS render-data backend forces per-placement merge for any contoured-ground loc (type>0).
        const forceMerge = (resolvedLocType.contourGroundType | 0) > 0;

        const resolvedHasTransforms = Array.isArray(
            (resolvedLocType as { transforms?: unknown }).transforms,
        )
            ? (((resolvedLocType as { transforms?: unknown[] }).transforms?.length ?? 0) | 0) > 0
            : !!(resolvedLocType as { transforms?: unknown }).transforms;
        const sourceIsEntity = seqId !== -1 || baseHadTransforms || resolvedHasTransforms;

        // Pure loc placement resolve stage digest: should be stable and match C++ stage outputs.
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, locTypeId);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, resolvedLocType.id | 0);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, placementType);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, placementRotation);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, record.level | 0);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, record.tileX | 0);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, record.tileY | 0);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, seqId | 0);
        const priority =
            placementType === 22 ? 3 : placementType >= 4 && placementType <= 8 ? 10 : 1;
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, priority | 0);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, resolvedLocType.id | 0); // interactId
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, includeLod ? 1 : 0);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, forceMerge ? 1 : 0);
        renderPlacementHash = fnv1a32UpdateInt(renderPlacementHash, sourceIsEntity ? 1 : 0);

        // Keep packed entries aligned with runtime for diffing when stage count/hash mismatches.
        renderPlacementEntriesPacked.push(
            locTypeId | 0,
            resolvedLocType.id | 0,
            placementType | 0,
            placementRotation | 0,
            record.level | 0,
            record.tileX | 0,
            record.tileY | 0,
            seqId | 0,
            priority | 0,
            resolvedLocType.id | 0, // interactId (stage-only)
            includeLod ? 1 : 0,
            forceMerge ? 1 : 0,
            sourceIsEntity ? 1 : 0,
        );

        if (seqId !== -1) {
            animatedCount++;
            continue;
        }

        const contourOrigin = computeTsLocContourSampleOrigin(
            resolvedLocType,
            placementRotation,
            record.tileX | 0,
            record.tileY | 0,
        );
        const sceneHeight = computeTsLocSceneHeight(
            scene,
            resolvedLocType,
            record.level | 0,
            record.tileX | 0,
            record.tileY | 0,
            placementRotation,
        );
        const contourGround = resolveTsLocInstanceContourGroundSimple(
            scene,
            resolvedLocType,
            record.level | 0,
            record.tileX | 0,
            record.tileY | 0,
        );

        const variants = expandLocPlacementModelVariants(
            placementType as LocModelType,
            placementRotation,
        );
        for (let j = 0; j < variants.length; j++) {
            const variant = variants[j];
            const variantType = variant.type | 0;
            const modelIds = collectLocModelIdsForVariant(resolvedLocType, variantType);
            if (!modelIds || modelIds.length === 0) {
                continue;
            }
            candidatesExpanded++;
            let allModelsAvailable = true;
            for (let k = 0; k < modelIds.length; k++) {
                modelIdsUsedSet.add(modelIds[k] | 0);
                if (!modelLoader.tryGet(modelIds[k] | 0)) {
                    allModelsAvailable = false;
                    break;
                }
            }
            if (!allModelsAvailable) {
                decodeFailed++;
                continue;
            }

            groupsQueued++;
            if (variantType === 9) {
                type9Queued++;
                if ((resolvedLocType.id | 0) === 1651) {
                    id1651Type9Queued++;
                }
            } else if (variantType === 0) {
                type0Queued++;
                if ((resolvedLocType.id | 0) === 1651) {
                    id1651Type0Queued++;
                }
            }

            groupsHash = fnv1a32UpdateInt(groupsHash, resolvedLocType.id | 0);
            groupsHash = fnv1a32UpdateInt(groupsHash, placementType);
            groupsHash = fnv1a32UpdateInt(groupsHash, placementRotation);
            groupsHash = fnv1a32UpdateInt(groupsHash, variantType);
            groupsHash = fnv1a32UpdateInt(groupsHash, variant.rotation | 0);
            groupsHash = fnv1a32UpdateInt(groupsHash, record.priority | 0);
            groupsHash = fnv1a32UpdateInt(groupsHash, record.level | 0);
            groupsHash = fnv1a32UpdateInt(groupsHash, record.tileX | 0);
            groupsHash = fnv1a32UpdateInt(groupsHash, record.tileY | 0);
            groupsHash = fnv1a32UpdateInt(groupsHash, forceMerge ? 1 : 0);
            groupsHash = fnv1a32UpdateInt(groupsHash, includeLod ? 1 : 0);

            let modelIdsHash = 2166136261 >>> 0;
            for (let k = 0; k < modelIds.length; k++) {
                modelIdsHash = fnv1a32UpdateInt(modelIdsHash, modelIds[k] | 0);
            }

            let preMergeSignature = 2166136261 >>> 0;
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, resolvedLocType.id | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, placementType);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, placementRotation);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, variantType);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, variant.rotation | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, record.priority | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, record.level | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, record.tileX | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, record.tileY | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, forceMerge ? 1 : 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, includeLod ? 1 : 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, sceneHeight | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, contourOrigin.sceneX | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, contourOrigin.sceneZ | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, contourGround | 0);
            preMergeSignature = fnv1a32UpdateInt(preMergeSignature, modelIdsHash | 0);
            preMergeKeySignatures.push(preMergeSignature | 0);
            preMergeSignatureEntries.push({
                signature: preMergeSignature | 0,
                locTypeId: resolvedLocType.id | 0,
                placementType: placementType | 0,
                placementRotation: placementRotation | 0,
                variantType: variantType | 0,
                variantRotation: variant.rotation | 0,
                level: record.level | 0,
                tileX: record.tileX | 0,
                tileY: record.tileY | 0,
                priority: record.priority | 0,
                forceMerge: forceMerge ? 1 : 0,
                includeLod: includeLod ? 1 : 0,
                sceneHeight: sceneHeight | 0,
                contourSceneX: contourOrigin.sceneX | 0,
                contourSceneZ: contourOrigin.sceneZ | 0,
                contourGround: contourGround | 0,
                modelIdsHash: modelIdsHash | 0,
            });

            preMergeGroupKeysQueued++;
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, resolvedLocType.id | 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, placementType);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, placementRotation);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, variantType);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, variant.rotation | 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, record.priority | 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, record.level | 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, record.tileX | 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, record.tileY | 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, forceMerge ? 1 : 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, includeLod ? 1 : 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, sceneHeight | 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(
                preMergeGroupKeysHash,
                contourOrigin.sceneX | 0,
            );
            preMergeGroupKeysHash = fnv1a32UpdateInt(
                preMergeGroupKeysHash,
                contourOrigin.sceneZ | 0,
            );
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, contourGround | 0);
            preMergeGroupKeysHash = fnv1a32UpdateInt(preMergeGroupKeysHash, modelIdsHash | 0);
        }
    }

    const modelIdsUsed = Array.from(modelIdsUsedSet.values())
        .map((id) => id | 0)
        .sort((a, b) => (a | 0) - (b | 0));
    return {
        renderPlacement: {
            placementsResolved: placementsResolved | 0,
            resolvedTypeCount: resolvedTypeCount | 0,
            animatedCount: animatedCount | 0,
            hash: placementsResolved > 0 ? renderPlacementHash | 0 : 0,
        },
        renderPlacementEntriesPacked: Int32Array.from(renderPlacementEntriesPacked),
        modelIdsUsed,
        variant: {
            groupsQueued: groupsQueued | 0,
            groupsHash: groupsQueued > 0 ? groupsHash | 0 : 0,
            type9Queued: type9Queued | 0,
            type0Queued: type0Queued | 0,
            id1651Type9Queued: id1651Type9Queued | 0,
            id1651Type0Queued: id1651Type0Queued | 0,
        },
        variantDrop: {
            candidatesExpanded: candidatesExpanded | 0,
            decodeFailed: decodeFailed | 0,
        },
        preMergeGroupKey: {
            keysQueued: preMergeGroupKeysQueued | 0,
            keysHash: preMergeGroupKeysQueued > 0 ? preMergeGroupKeysHash | 0 : 0,
        },
        preMergeKeySignatures: Int32Array.from(preMergeKeySignatures),
        preMergeSignatureEntries,
    };
}

function summarizeLocRenderPlacementEntryPacked(entry: readonly number[]): string {
    const [placementId, resolvedId, placementType, placementRotation, level, tileX, tileY, seqId] =
        entry;
    return `id=${placementId}|res=${resolvedId}|t=${placementType}|r=${placementRotation}|lvl=${level}|x=${tileX}|y=${tileY}|seq=${seqId}`;
}

function diffLocRenderPlacementEntriesPacked(
    tsPacked: Int32Array | undefined,
    cachePacked: Int32Array | undefined,
): Readonly<{
    tsCount: number;
    cacheCount: number;
    missingInCache: string[];
    extraInCache: string[];
}> {
    const stride = 13;
    const tsCount = tsPacked ? Math.floor(tsPacked.length / stride) : 0;
    const cacheCount = cachePacked ? Math.floor(cachePacked.length / stride) : 0;
    const tsKeys = new Map<string, number>();
    const cacheKeys = new Map<string, number>();

    const add = (dst: Map<string, number>, packed: Int32Array, i: number) => {
        const off = i * stride;
        const entry = [];
        for (let j = 0; j < stride; j++) entry.push(packed[off + j] | 0);
        const key = summarizeLocRenderPlacementEntryPacked(entry);
        dst.set(key, (dst.get(key) ?? 0) + 1);
    };
    if (tsPacked) {
        for (let i = 0; i < tsCount; i++) add(tsKeys, tsPacked, i);
    }
    if (cachePacked) {
        for (let i = 0; i < cacheCount; i++) add(cacheKeys, cachePacked, i);
    }

    const missingInCache: string[] = [];
    const extraInCache: string[] = [];
    for (const [key, count] of tsKeys.entries()) {
        const have = cacheKeys.get(key) ?? 0;
        if (have < count) missingInCache.push(`${key} x${count - have}`);
    }
    for (const [key, count] of cacheKeys.entries()) {
        const have = tsKeys.get(key) ?? 0;
        if (have < count) extraInCache.push(`${key} x${count - have}`);
    }
    missingInCache.sort();
    extraInCache.sort();
    return {
        tsCount,
        cacheCount,
        missingInCache: missingInCache.slice(0, 12),
        extraInCache: extraInCache.slice(0, 12),
    };
}

function firstLocRenderPlacementEntriesPackedMismatch(
    tsPacked: Int32Array | undefined,
    cachePacked: Int32Array | undefined,
): string | undefined {
    const stride = 13;
    if (!tsPacked || !cachePacked) {
        return undefined;
    }
    const tsCount = Math.floor(tsPacked.length / stride) | 0;
    const cacheCount = Math.floor(cachePacked.length / stride) | 0;
    if (tsCount <= 0 || cacheCount <= 0) {
        return undefined;
    }
    const n = Math.min(tsCount, cacheCount) | 0;
    const names = [
        "placementId",
        "resolvedId",
        "type",
        "rotation",
        "level",
        "tileX",
        "tileY",
        "seqId",
        "priority",
        "interactId",
        "includeLod",
        "forceMerge",
        "sourceIsEntity",
    ] as const;
    for (let i = 0; i < n; i++) {
        const base = (i * stride) | 0;
        for (let j = 0; j < stride; j++) {
            const a = tsPacked[base + j] | 0;
            const b = cachePacked[base + j] | 0;
            if (a !== b) {
                const tsRow = Array.from(tsPacked.slice(base, base + stride)).map((x) => x | 0);
                const cacheRow = Array.from(cachePacked.slice(base, base + stride)).map(
                    (x) => x | 0,
                );
                const name = names[j] ?? `field${j}`;
                return `firstPackedDiff[i=${i} j=${j} ${name} ts=${a} cache=${b}] tsRow=${JSON.stringify(
                    tsRow,
                )} cacheRow=${JSON.stringify(cacheRow)}`;
            }
        }
    }
    if (tsCount !== cacheCount) {
        return `packedCountDiff ts=${tsCount} cache=${cacheCount}`;
    }
    return undefined;
}
type TsLocMergedDummyDigest = Readonly<{
    commandCount: number;
    elementsTotal: number;
    hash: number;
    baseCount: number;
    alphaCount: number;
    lodCount: number;
    lodAlphaCount: number;
}>;

type MergedDummyCmd = Readonly<{
    cmdIndex: number;
    bucket: number;
    offsetWords: number;
    elements: number;
    level: number;
    priority: number;
}>;

function collectMergedDummyCommands(runtimeCommandStreamInput: {
    cmdBucketIndices: Int32Array;
    cmdOffsets: Int32Array;
    cmdElements: Int32Array;
    cmdInstanceCounts: Int32Array;
    cmdPackedInstances: Int32Array;
}): MergedDummyCmd[] {
    const cmdBucketIndices = runtimeCommandStreamInput.cmdBucketIndices;
    const cmdOffsets = runtimeCommandStreamInput.cmdOffsets;
    const cmdElements = runtimeCommandStreamInput.cmdElements;
    const cmdInstanceCounts = runtimeCommandStreamInput.cmdInstanceCounts;
    const cmdPackedInstances = runtimeCommandStreamInput.cmdPackedInstances;

    const out: MergedDummyCmd[] = [];
    let instanceBase = 0;
    for (let cmdIndex = 0; cmdIndex < cmdBucketIndices.length; cmdIndex++) {
        const bucket = cmdBucketIndices[cmdIndex] | 0;
        const instanceCount =
            cmdIndex < cmdInstanceCounts.length ? cmdInstanceCounts[cmdIndex] | 0 : 0;
        const packedOff = (instanceBase * 8) | 0;
        if (
            bucket >= 0 &&
            bucket <= 3 &&
            instanceCount === 1 &&
            packedOff + 7 < cmdPackedInstances.length
        ) {
            const sceneX = cmdPackedInstances[packedOff + 0] | 0;
            const sceneZ = cmdPackedInstances[packedOff + 1] | 0;
            const heightOffset = cmdPackedInstances[packedOff + 2] | 0;
            const level = cmdPackedInstances[packedOff + 3] | 0;
            const contour = cmdPackedInstances[packedOff + 4] | 0;
            const priority = cmdPackedInstances[packedOff + 5] | 0;
            const interactType = cmdPackedInstances[packedOff + 6] | 0;
            const interactId = cmdPackedInstances[packedOff + 7] >>> 0;
            if (
                sceneX === 0 &&
                sceneZ === 0 &&
                heightOffset === 0 &&
                contour === 2 &&
                priority > 0 &&
                interactType === 0 &&
                interactId === 0xffff
            ) {
                const elements = cmdIndex < cmdElements.length ? cmdElements[cmdIndex] | 0 : 0;
                const offsetWords =
                    ((cmdIndex < cmdOffsets.length ? cmdOffsets[cmdIndex] | 0 : 0) >> 2) | 0;
                out.push({
                    cmdIndex: cmdIndex | 0,
                    bucket: bucket | 0,
                    offsetWords,
                    elements,
                    level,
                    priority,
                });
            }
        }
        instanceBase += instanceCount;
    }
    return out;
}

function diffMergedDummyCommandMultiset(
    label: string,
    tsInput: {
        cmdBucketIndices: Int32Array;
        cmdOffsets: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    cacheInput: {
        cmdBucketIndices: Int32Array;
        cmdOffsets: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    cacheProvenance?: ReadonlyArray<RuntimeCommandProvenanceEntry>,
    maxLines: number = 10,
): void {
    const tsCmds = collectMergedDummyCommands(tsInput);
    const cacheCmds = collectMergedDummyCommands(cacheInput);

    const keyOf = (c: MergedDummyCmd): string =>
        String(c.bucket | 0) +
        "|" +
        String(c.level | 0) +
        "|" +
        String(c.priority | 0) +
        "|" +
        String(c.elements | 0);

    const tsCounts = new Map<string, number>();
    const cacheCounts = new Map<string, number>();
    const tsFirst = new Map<string, MergedDummyCmd>();
    const cacheFirst = new Map<string, MergedDummyCmd>();

    for (const c of tsCmds) {
        const k = keyOf(c);
        tsCounts.set(k, ((tsCounts.get(k) ?? 0) + 1) | 0);
        if (!tsFirst.has(k)) tsFirst.set(k, c);
    }
    for (const c of cacheCmds) {
        const k = keyOf(c);
        cacheCounts.set(k, ((cacheCounts.get(k) ?? 0) + 1) | 0);
        if (!cacheFirst.has(k)) cacheFirst.set(k, c);
    }

    const allKeys = new Set<string>([
        ...Array.from(tsCounts.keys()),
        ...Array.from(cacheCounts.keys()),
    ]);
    const diffs: Array<{ key: string; delta: number; tsCount: number; cacheCount: number }> = [];
    for (const k of allKeys) {
        const a = tsCounts.get(k) ?? 0;
        const b = cacheCounts.get(k) ?? 0;
        if (a !== b) diffs.push({ key: k, delta: (b - a) | 0, tsCount: a | 0, cacheCount: b | 0 });
    }
    diffs.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

    if (diffs.length === 0) {
        console.error(
            `  ${label} merged-dummy multiset: <match> (ts=${tsCmds.length} cache=${cacheCmds.length})`,
        );
        return;
    }

    console.error(
        `  ${label} merged-dummy multiset: diffs=${diffs.length} (ts=${tsCmds.length} cache=${cacheCmds.length})`,
    );
    for (let i = 0; i < diffs.length && i < (maxLines | 0); i++) {
        const d = diffs[i];
        const tsEx = tsFirst.get(d.key);
        const cacheEx = cacheFirst.get(d.key);
        console.error(`    key=${d.key} ts=${d.tsCount} cache=${d.cacheCount} delta=${d.delta}`);
        if (tsEx) {
            console.error(
                "      ts ex: cmd=" +
                    (tsEx.cmdIndex | 0) +
                    " offW=" +
                    (tsEx.offsetWords | 0) +
                    " bucket=" +
                    (tsEx.bucket | 0) +
                    " level=" +
                    (tsEx.level | 0) +
                    " pri=" +
                    (tsEx.priority | 0) +
                    " elements=" +
                    (tsEx.elements | 0),
            );
        }
        if (cacheEx) {
            console.error(
                "      cache ex: cmd=" +
                    (cacheEx.cmdIndex | 0) +
                    " offW=" +
                    (cacheEx.offsetWords | 0) +
                    " bucket=" +
                    (cacheEx.bucket | 0) +
                    " level=" +
                    (cacheEx.level | 0) +
                    " pri=" +
                    (cacheEx.priority | 0) +
                    " elements=" +
                    (cacheEx.elements | 0),
            );
            if (
                cacheProvenance &&
                (cacheEx.cmdIndex | 0) >= 0 &&
                (cacheEx.cmdIndex | 0) < cacheProvenance.length
            ) {
                const pe = cacheProvenance[cacheEx.cmdIndex | 0];
                console.error(
                    "      cache provenance: sourceKind=" +
                        (pe.sourceKind | 0) +
                        " loc=" +
                        (pe.locTypeId | 0) +
                        " vType=" +
                        (pe.variantType | 0) +
                        " vRot=" +
                        (pe.variantRotation | 0) +
                        " mergePath=" +
                        (pe.mergePath | 0) +
                        " splitSig=" +
                        (pe.splitSignature | 0),
                );
            }
        }
    }
}

function computeTsLocMergedDummyDigest(runtimeCommandStreamInput: {
    cmdBucketIndices: Int32Array;
    cmdOffsets: Int32Array;
    cmdElements: Int32Array;
    cmdInstanceCounts: Int32Array;
    cmdPackedInstances: Int32Array;
}): TsLocMergedDummyDigest {
    const cmdBucketIndices = runtimeCommandStreamInput.cmdBucketIndices;
    const cmdOffsets = runtimeCommandStreamInput.cmdOffsets;
    const cmdElements = runtimeCommandStreamInput.cmdElements;
    const cmdInstanceCounts = runtimeCommandStreamInput.cmdInstanceCounts;
    const cmdPackedInstances = runtimeCommandStreamInput.cmdPackedInstances;

    let commandCount = 0;
    let elementsTotal = 0;
    let hash = 2166136261 >>> 0;
    let baseCount = 0;
    let alphaCount = 0;
    let lodCount = 0;
    let lodAlphaCount = 0;

    let instanceBase = 0;
    for (let cmdIndex = 0; cmdIndex < cmdBucketIndices.length; cmdIndex++) {
        const bucket = cmdBucketIndices[cmdIndex] | 0;
        const instanceCount =
            cmdIndex < cmdInstanceCounts.length ? cmdInstanceCounts[cmdIndex] | 0 : 0;
        const packedOff = (instanceBase * 8) | 0;
        if (
            bucket >= 0 &&
            bucket <= 3 &&
            instanceCount === 1 &&
            packedOff + 7 < cmdPackedInstances.length
        ) {
            const sceneX = cmdPackedInstances[packedOff + 0] | 0;
            const sceneZ = cmdPackedInstances[packedOff + 1] | 0;
            const heightOffset = cmdPackedInstances[packedOff + 2] | 0;
            const level = cmdPackedInstances[packedOff + 3] | 0;
            const contour = cmdPackedInstances[packedOff + 4] | 0;
            const priority = cmdPackedInstances[packedOff + 5] | 0;
            const interactType = cmdPackedInstances[packedOff + 6] | 0;
            const interactId = cmdPackedInstances[packedOff + 7] >>> 0;
            if (
                sceneX === 0 &&
                sceneZ === 0 &&
                heightOffset === 0 &&
                contour === 2 &&
                priority > 0 &&
                interactType === 0 &&
                interactId === 0xffff
            ) {
                commandCount++;
                const elements = cmdIndex < cmdElements.length ? cmdElements[cmdIndex] | 0 : 0;
                elementsTotal = (elementsTotal + elements) | 0;
                if (bucket === 0) {
                    baseCount++;
                } else if (bucket === 1) {
                    alphaCount++;
                } else if (bucket === 2) {
                    lodCount++;
                } else if (bucket === 3) {
                    lodAlphaCount++;
                }
                const offsetWords =
                    ((cmdIndex < cmdOffsets.length ? cmdOffsets[cmdIndex] | 0 : 0) >> 2) | 0;
                hash = fnv1a32UpdateInt(hash, bucket);
                hash = fnv1a32UpdateInt(hash, offsetWords);
                hash = fnv1a32UpdateInt(hash, elements);
                hash = fnv1a32UpdateInt(hash, level);
                hash = fnv1a32UpdateInt(hash, priority);
            }
        }
        instanceBase += instanceCount;
    }

    return {
        commandCount: commandCount | 0,
        elementsTotal: elementsTotal | 0,
        hash: commandCount > 0 ? hash | 0 : 0,
        baseCount: baseCount | 0,
        alphaCount: alphaCount | 0,
        lodCount: lodCount | 0,
        lodAlphaCount: lodAlphaCount | 0,
    };
}
function collectTsSceneLocRecords(
    scene: {
        levels: number;
        sizeX: number;
        sizeY: number;
        tiles: Array<Array<Array<unknown>>>;
        isPlayerLevel(level: number, tileX: number, tileY: number, playerLevel: number): boolean;
    },
    borderSize: number,
    maxLevel: number,
): TsSceneLocRecord[] {
    const out: TsSceneLocRecord[] = [];
    const startX = borderSize | 0;
    const startY = borderSize | 0;
    const endX = (borderSize + 64) | 0;
    const endY = (borderSize + 64) | 0;
    const sceneOffset = (borderSize * -128) | 0;

    type SceneLocLike = Readonly<{
        tag: unknown;
        flags: number;
        x: number;
        y: number;
    }>;

    const pushRecord = (
        sceneLoc: SceneLocLike | undefined,
        offsetX: number,
        offsetY: number,
        level: number,
        priority: number,
        category: string,
        tileX: number,
        tileY: number,
    ): void => {
        if (!sceneLoc || typeof sceneLoc.flags !== "number") {
            return;
        }
        const id = getIdFromTag(sceneLoc.tag as never);
        out.push({
            id: id | 0,
            level: level | 0,
            sceneX: ((sceneLoc.x | 0) + (offsetX | 0)) | 0,
            sceneZ: ((sceneLoc.y | 0) + (offsetY | 0)) | 0,
            priority: priority | 0,
            placementType: getLocPlacementType(sceneLoc.flags | 0) | 0,
            placementRotation: getLocPlacementRotation(sceneLoc.flags | 0) | 0,
            category,
            tileX: tileX | 0,
            tileY: tileY | 0,
        });
    };

    for (let level = 0; level < scene.levels; level++) {
        for (let tileX = startX; tileX < endX; tileX++) {
            for (let tileY = startY; tileY < endY; tileY++) {
                const tile = scene.tiles[level][tileX][tileY] as
                    | {
                          minLevel?: number;
                          floorDecoration?: {
                              entity?: unknown;
                              x: number;
                              y: number;
                              tag: unknown;
                              flags: number;
                          };
                          wall?: {
                              entity0?: unknown;
                              entity1?: unknown;
                              x: number;
                              y: number;
                              tag: unknown;
                              flags: number;
                          };
                          wallDecoration?: {
                              entity0?: unknown;
                              entity1?: unknown;
                              x: number;
                              y: number;
                              offsetX: number;
                              offsetY: number;
                              tag: unknown;
                              flags: number;
                          };
                          locs?: Array<{
                              entity?: unknown;
                              x: number;
                              y: number;
                              tag: unknown;
                              flags: number;
                              startX: number;
                              startY: number;
                          }>;
                      }
                    | undefined;
                if (
                    !tile ||
                    ((tile.minLevel ?? 0) > maxLevel &&
                        !scene.isPlayerLevel(level, tileX, tileY, maxLevel))
                ) {
                    continue;
                }

                if (tile.floorDecoration?.entity) {
                    pushRecord(
                        tile.floorDecoration,
                        sceneOffset,
                        sceneOffset,
                        level,
                        3,
                        "floorDecoration",
                        tileX,
                        tileY,
                    );
                }

                if (tile.wall) {
                    if (tile.wall.entity0) {
                        pushRecord(
                            tile.wall,
                            sceneOffset,
                            sceneOffset,
                            level,
                            1,
                            "wall0",
                            tileX,
                            tileY,
                        );
                    }
                }

                if (tile.wallDecoration) {
                    if (tile.wallDecoration.entity0) {
                        pushRecord(
                            tile.wallDecoration,
                            (sceneOffset + (tile.wallDecoration.offsetX | 0)) | 0,
                            (sceneOffset + (tile.wallDecoration.offsetY | 0)) | 0,
                            level,
                            10,
                            "wallDecor0",
                            tileX,
                            tileY,
                        );
                    }
                }

                const locs = tile.locs ?? [];
                for (let li = 0; li < locs.length; li++) {
                    const loc = locs[li];
                    if (!loc.entity || (loc.startX | 0) !== tileX || (loc.startY | 0) !== tileY) {
                        continue;
                    }
                    pushRecord(loc, sceneOffset, sceneOffset, level, 1, "loc", tileX, tileY);
                }
            }
        }
    }

    return out;
}

function describeTsLocSourceProbe(
    tsSceneLocRecords: readonly TsSceneLocRecord[] | undefined,
    tsInstances: ReadonlyArray<{
        sceneX: number;
        sceneZ: number;
        heightOffset: number;
        level: number;
        contour: number;
        pri: number;
        interactType: number;
        interactId: number;
    }>,
    maxLines: number,
): string[] {
    if (!tsSceneLocRecords || tsSceneLocRecords.length <= 0) {
        return [];
    }
    const out: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < tsInstances.length; i++) {
        const inst = tsInstances[i];
        if ((inst.interactType | 0) !== 1 || inst.interactId >>> 0 === 0xffff) {
            continue;
        }
        const key =
            String(inst.interactId >>> 0) +
            "|" +
            String(inst.level | 0) +
            "|" +
            String(inst.sceneX | 0) +
            "|" +
            String(inst.sceneZ | 0);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const sameIdLevel = tsSceneLocRecords.filter(
            (r) => (r.id | 0) === (inst.interactId | 0) && (r.level | 0) === (inst.level | 0),
        );
        const exact = sameIdLevel.filter(
            (r) => (r.sceneX | 0) === (inst.sceneX | 0) && (r.sceneZ | 0) === (inst.sceneZ | 0),
        );
        const near = sameIdLevel
            .filter(
                (r) =>
                    Math.abs((r.sceneX | 0) - (inst.sceneX | 0)) <= 256 &&
                    Math.abs((r.sceneZ | 0) - (inst.sceneZ | 0)) <= 256,
            )
            .sort((a, b) => {
                const da =
                    Math.abs((a.sceneX | 0) - (inst.sceneX | 0)) +
                    Math.abs((a.sceneZ | 0) - (inst.sceneZ | 0));
                const db =
                    Math.abs((b.sceneX | 0) - (inst.sceneX | 0)) +
                    Math.abs((b.sceneZ | 0) - (inst.sceneZ | 0));
                return (da | 0) - (db | 0);
            });

        const sampleSource = (exact.length > 0 ? exact : near.length > 0 ? near : sameIdLevel)
            .slice(0, 4)
            .map((r) => ({
                category: r.category,
                type: r.placementType | 0,
                rot: r.placementRotation | 0,
                priority: r.priority | 0,
                sceneX: r.sceneX | 0,
                sceneZ: r.sceneZ | 0,
                tileX: r.tileX | 0,
                tileY: r.tileY | 0,
            }));

        out.push(
            "  ts-source locProbe id=" +
                (inst.interactId >>> 0) +
                " level=" +
                (inst.level | 0) +
                " scene=(" +
                (inst.sceneX | 0) +
                "," +
                (inst.sceneZ | 0) +
                ")" +
                " sameIdLevel=" +
                (sameIdLevel.length | 0) +
                " exact=" +
                (exact.length | 0) +
                " near=" +
                (near.length | 0) +
                " sample=" +
                JSON.stringify(sampleSource),
        );

        if (out.length >= (maxLines | 0)) {
            break;
        }
    }

    return out;
}

function collectTsSourceRecordsForPackedInstances(
    tsSceneLocRecords: readonly TsSceneLocRecord[] | undefined,
    instances: ReadonlyArray<{
        sceneX: number;
        sceneZ: number;
        level: number;
        interactType: number;
        interactId: number;
    }>,
): TsSceneLocRecord[] {
    if (!tsSceneLocRecords || tsSceneLocRecords.length <= 0) {
        return [];
    }
    const out: TsSceneLocRecord[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        if ((inst.interactType | 0) !== 1 || inst.interactId >>> 0 === 0xffff) {
            continue;
        }
        const dedupeKey =
            String(inst.interactId >>> 0) +
            "|" +
            String(inst.level | 0) +
            "|" +
            String(inst.sceneX | 0) +
            "|" +
            String(inst.sceneZ | 0);
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);

        const sameIdLevel = tsSceneLocRecords.filter(
            (r) => (r.id | 0) === (inst.interactId | 0) && (r.level | 0) === (inst.level | 0),
        );
        if (sameIdLevel.length <= 0) {
            continue;
        }
        const exact = sameIdLevel.filter(
            (r) => (r.sceneX | 0) === (inst.sceneX | 0) && (r.sceneZ | 0) === (inst.sceneZ | 0),
        );
        if (exact.length > 0) {
            out.push(exact[0]);
            continue;
        }
        let best: TsSceneLocRecord | undefined;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let j = 0; j < sameIdLevel.length; j++) {
            const rec = sameIdLevel[j];
            const dist =
                Math.abs((rec.sceneX | 0) - (inst.sceneX | 0)) +
                Math.abs((rec.sceneZ | 0) - (inst.sceneZ | 0));
            if (dist < bestDist) {
                bestDist = dist;
                best = rec;
            }
        }
        if (best && bestDist <= 256) {
            out.push(best);
        }
    }
    return out;
}

function topHistogramEntries(hist: Map<string, number>, limit: number): Array<[string, number]> {
    return Array.from(hist.entries())
        .sort((a, b) => {
            if ((b[1] | 0) !== (a[1] | 0)) {
                return (b[1] | 0) - (a[1] | 0);
            }
            return a[0].localeCompare(b[0]);
        })
        .slice(0, Math.max(1, limit | 0));
}

function describeTsLocGroupingCandidates(
    tsSceneLocRecords: readonly TsSceneLocRecord[] | undefined,
    instances: ReadonlyArray<{
        sceneX: number;
        sceneZ: number;
        level: number;
        interactType: number;
        interactId: number;
    }>,
    label: string,
    maxLines: number,
): string[] {
    const matched = collectTsSourceRecordsForPackedInstances(tsSceneLocRecords, instances);
    if (matched.length <= 0) {
        return [`  ts-source grouping(${label}): <no matched records>`];
    }

    const byCategory = new Map<string, number>();
    const byTypeRot = new Map<string, number>();
    const byTypeRotPri = new Map<string, number>();
    const byCategoryTypeRot = new Map<string, number>();
    const byTile = new Map<string, number>();
    for (let i = 0; i < matched.length; i++) {
        const rec = matched[i];
        const cat = rec.category;
        const typeRot = `${rec.id | 0}|t${rec.placementType | 0}|r${rec.placementRotation | 0}`;
        const typeRotPri = `${typeRot}|p${rec.priority | 0}`;
        const catTypeRot = `${cat}|${typeRot}`;
        const tile = `${rec.tileX | 0},${rec.tileY | 0}`;
        byCategory.set(cat, ((byCategory.get(cat) ?? 0) + 1) | 0);
        byTypeRot.set(typeRot, ((byTypeRot.get(typeRot) ?? 0) + 1) | 0);
        byTypeRotPri.set(typeRotPri, ((byTypeRotPri.get(typeRotPri) ?? 0) + 1) | 0);
        byCategoryTypeRot.set(catTypeRot, ((byCategoryTypeRot.get(catTypeRot) ?? 0) + 1) | 0);
        byTile.set(tile, ((byTile.get(tile) ?? 0) + 1) | 0);
    }

    const lines: string[] = [];
    const lineLimit = Math.max(1, maxLines | 0);
    lines.push(
        `  ts-source grouping(${label}) matched=${matched.length} categories=${JSON.stringify(
            topHistogramEntries(byCategory, lineLimit),
        )}`,
    );
    if (lines.length < lineLimit) {
        lines.push(
            `  ts-source grouping(${label}) byTypeRot=${JSON.stringify(
                topHistogramEntries(byTypeRot, lineLimit),
            )}`,
        );
    }
    if (lines.length < lineLimit) {
        lines.push(
            `  ts-source grouping(${label}) byTypeRotPri=${JSON.stringify(
                topHistogramEntries(byTypeRotPri, lineLimit),
            )}`,
        );
    }
    if (lines.length < lineLimit) {
        lines.push(
            `  ts-source grouping(${label}) byCategoryTypeRot=${JSON.stringify(
                topHistogramEntries(byCategoryTypeRot, lineLimit),
            )}`,
        );
    }
    if (lines.length < lineLimit) {
        lines.push(
            `  ts-source grouping(${label}) byTile=${JSON.stringify(
                topHistogramEntries(byTile, lineLimit),
            )}`,
        );
    }
    return lines;
}

function collectLocIdsFromCommandInstances(
    instances: ReadonlyArray<{
        interactType: number;
        interactId: number;
    }>,
): number[] {
    const ids = new Set<number>();
    for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        if ((inst.interactType | 0) !== 1) {
            continue;
        }
        const id = inst.interactId | 0;
        if (id < 0 || id === 0xffff) {
            continue;
        }
        ids.add(id);
    }
    return Array.from(ids.values()).sort((a, b) => a - b);
}

function summarizeTsModelHashPartitionsForInstances(
    label: string,
    tsSceneLocRecords: readonly TsSceneLocRecord[] | undefined,
    instances: ReadonlyArray<{
        sceneX: number;
        sceneZ: number;
        level: number;
        interactType: number;
        interactId: number;
    }>,
    getTsModelHashStatsForLocIds:
        | ((locTypeIds: readonly number[]) => readonly TsLocModelHashStat[])
        | undefined,
    maxLines: number,
): string[] {
    if (!tsSceneLocRecords || tsSceneLocRecords.length <= 0) {
        return [`  ts-model-partition(${label}): <no-ts-source-records>`];
    }
    if (typeof getTsModelHashStatsForLocIds !== "function") {
        return [`  ts-model-partition(${label}): <model-hash-stats-unavailable>`];
    }

    const matched = collectTsSourceRecordsForPackedInstances(tsSceneLocRecords, instances);
    if (matched.length <= 0) {
        return [`  ts-model-partition(${label}): <no-matched-records>`];
    }

    const fromInstances = collectLocIdsFromCommandInstances(instances);
    const locIds = Array.from(
        new Set<number>([...fromInstances, ...matched.map((r) => r.id | 0)]),
    ).sort((a, b) => a - b);
    const stats = getTsModelHashStatsForLocIds(locIds);
    if (stats.length <= 0) {
        return [`  ts-model-partition(${label}): <no-model-hash-stats> locIds=${locIds.join(",")}`];
    }

    const statsByTypeRot = new Map<string, TsLocModelHashStat[]>();
    for (let i = 0; i < stats.length; i++) {
        const s = stats[i];
        const key = `${s.locTypeId | 0}|t${s.placementType | 0}|r${s.placementRotation | 0}`;
        const arr = statsByTypeRot.get(key);
        if (arr) {
            arr.push(s);
        } else {
            statsByTypeRot.set(key, [s]);
        }
    }

    const matchedByTypeRot = new Map<string, number>();
    for (let i = 0; i < matched.length; i++) {
        const rec = matched[i];
        const key = `${rec.id | 0}|t${rec.placementType | 0}|r${rec.placementRotation | 0}`;
        matchedByTypeRot.set(key, ((matchedByTypeRot.get(key) ?? 0) + 1) | 0);
    }

    const entries = Array.from(matchedByTypeRot.entries())
        .map(([key, matchedCount]) => {
            const keyStats = statsByTypeRot.get(key) ?? [];
            const hashCount = new Set<number>(keyStats.map((s) => s.modelHash | 0)).size | 0;
            const placements = keyStats.reduce((sum, s) => (sum + (s.count | 0)) | 0, 0);
            return { key, matchedCount: matchedCount | 0, hashCount, placements, keyStats };
        })
        .sort((a, b) => {
            if ((b.matchedCount | 0) !== (a.matchedCount | 0)) {
                return (b.matchedCount | 0) - (a.matchedCount | 0);
            }
            if ((b.hashCount | 0) !== (a.hashCount | 0)) {
                return (b.hashCount | 0) - (a.hashCount | 0);
            }
            if ((b.placements | 0) !== (a.placements | 0)) {
                return (b.placements | 0) - (a.placements | 0);
            }
            return a.key.localeCompare(b.key);
        });

    const lines: string[] = [];
    lines.push(
        `  ts-model-partition(${label}) matched=${matched.length} typeRots=${
            entries.length
        } locIds=${locIds.join(",")}`,
    );
    const limit = Math.max(1, maxLines | 0);
    for (let i = 0; i < entries.length && i < limit; i++) {
        const e = entries[i];
        const topHashes = [...e.keyStats]
            .sort((a, b) => (b.count | 0) - (a.count | 0))
            .slice(0, 4)
            .map((s) => [s.modelHash | 0, s.count | 0] as const);
        lines.push(
            `  ts-model-partition(${label}) key=${e.key} matched=${e.matchedCount | 0} placements=${
                e.placements | 0
            } hashCount=${e.hashCount | 0} topHashes=${JSON.stringify(topHashes)}`,
        );
    }
    return lines;
}

function summarizeTsPreMergeSignatureFieldsForInstances(
    label: string,
    tsSceneLocRecords: readonly TsSceneLocRecord[] | undefined,
    tsLocPreMergeSignatureEntries: readonly TsLocPreMergeSignatureEntry[] | undefined,
    instances: ReadonlyArray<{
        sceneX: number;
        sceneZ: number;
        level: number;
        interactType: number;
        interactId: number;
    }>,
    maxLines: number,
): string[] {
    if (!tsSceneLocRecords || tsSceneLocRecords.length <= 0) {
        return [`  ts-premerge(${label}): <no-ts-source-records>`];
    }
    if (!tsLocPreMergeSignatureEntries || tsLocPreMergeSignatureEntries.length <= 0) {
        return [`  ts-premerge(${label}): <no-premerge-signature-entries>`];
    }

    const matched = collectTsSourceRecordsForPackedInstances(tsSceneLocRecords, instances);
    if (matched.length <= 0) {
        return [`  ts-premerge(${label}): <no-matched-records>`];
    }

    const entryByPlacementKey = new Map<string, TsLocPreMergeSignatureEntry[]>();
    for (let i = 0; i < tsLocPreMergeSignatureEntries.length; i++) {
        const e = tsLocPreMergeSignatureEntries[i];
        const key =
            String(e.locTypeId | 0) +
            "|" +
            String(e.placementType | 0) +
            "|" +
            String(e.placementRotation | 0) +
            "|" +
            String(e.level | 0) +
            "|" +
            String(e.tileX | 0) +
            "|" +
            String(e.tileY | 0) +
            "|" +
            String(e.priority | 0);
        const arr = entryByPlacementKey.get(key);
        if (arr) {
            arr.push(e);
        } else {
            entryByPlacementKey.set(key, [e]);
        }
    }

    const resolvedEntries: TsLocPreMergeSignatureEntry[] = [];
    for (let i = 0; i < matched.length; i++) {
        const r = matched[i];
        const key =
            String(r.id | 0) +
            "|" +
            String(r.placementType | 0) +
            "|" +
            String(r.placementRotation | 0) +
            "|" +
            String(r.level | 0) +
            "|" +
            String(r.tileX | 0) +
            "|" +
            String(r.tileY | 0) +
            "|" +
            String(r.priority | 0);
        const arr = entryByPlacementKey.get(key);
        if (!arr || arr.length <= 0) {
            continue;
        }
        for (let j = 0; j < arr.length; j++) {
            resolvedEntries.push(arr[j]);
        }
    }

    if (resolvedEntries.length <= 0) {
        return [`  ts-premerge(${label}): <no-premerge-matches>`];
    }

    const uniqueSorted = (values: Iterable<number>): number[] =>
        Array.from(new Set<number>(values)).sort((a, b) => (a | 0) - (b | 0));
    const sceneHeights = uniqueSorted(resolvedEntries.map((e) => e.sceneHeight | 0));
    const contourGrounds = uniqueSorted(resolvedEntries.map((e) => e.contourGround | 0));
    const contourSceneXs = uniqueSorted(resolvedEntries.map((e) => e.contourSceneX | 0));
    const contourSceneZs = uniqueSorted(resolvedEntries.map((e) => e.contourSceneZ | 0));

    const variantHist = new Map<string, number>();
    for (let i = 0; i < resolvedEntries.length; i++) {
        const e = resolvedEntries[i];
        const key = `${e.variantType | 0}/${e.variantRotation | 0}`;
        variantHist.set(key, ((variantHist.get(key) ?? 0) + 1) | 0);
    }

    const limit = Math.max(1, maxLines | 0);
    const lines: string[] = [];
    lines.push(
        `  ts-premerge(${label}) matched=${matched.length} entries=${
            resolvedEntries.length
        } sceneHeights=${JSON.stringify(
            sceneHeights.slice(0, limit),
        )} contourGrounds=${JSON.stringify(contourGrounds.slice(0, limit))} contourSceneXCount=${
            contourSceneXs.length
        } contourSceneZCount=${contourSceneZs.length}`,
    );
    lines.push(
        `  ts-premerge(${label}) variants=${JSON.stringify(
            topHistogramEntries(variantHist, limit),
        )}`,
    );
    return lines;
}

function summarizeDeterministicSplitCardinalityForInstances(
    label: string,
    tsSceneLocRecords: readonly TsSceneLocRecord[] | undefined,
    tsLocPreMergeSignatureEntries: readonly TsLocPreMergeSignatureEntry[] | undefined,
    runtimeLocMergeDecisionEntries: readonly RuntimeLocMergeDecisionEntry[] | undefined,
    instances: ReadonlyArray<{
        sceneX: number;
        sceneZ: number;
        level: number;
        interactType: number;
        interactId: number;
    }>,
    maxVariants: number,
): string[] {
    if (!tsSceneLocRecords || tsSceneLocRecords.length <= 0) {
        return [`  split-cardinality(${label}): <no-ts-source-records>`];
    }
    if (!tsLocPreMergeSignatureEntries || tsLocPreMergeSignatureEntries.length <= 0) {
        return [`  split-cardinality(${label}): <no-ts-premerge-entries>`];
    }
    if (!runtimeLocMergeDecisionEntries || runtimeLocMergeDecisionEntries.length <= 0) {
        return [`  split-cardinality(${label}): <no-runtime-merge-entries>`];
    }

    const matched = collectTsSourceRecordsForPackedInstances(tsSceneLocRecords, instances);
    if (matched.length <= 0) {
        return [`  split-cardinality(${label}): <no-matched-records>`];
    }

    const variantHist = new Map<string, number>();
    for (let i = 0; i < matched.length; i++) {
        const rec = matched[i];
        const key =
            String(rec.id | 0) +
            "|" +
            String(rec.placementType | 0) +
            "|" +
            String(rec.placementRotation | 0) +
            "|" +
            String(rec.priority | 0);
        variantHist.set(key, ((variantHist.get(key) ?? 0) + 1) | 0);
    }
    const selectedVariantKeys = topHistogramEntries(variantHist, Math.max(1, maxVariants | 0)).map(
        ([k]) => k,
    );

    const countDistinctNumbers = (values: readonly number[]): number =>
        new Set<number>(values.map((v) => v | 0)).size | 0;
    const countDistinctKeys = <T>(entries: readonly T[], keyOf: (entry: T) => string): number =>
        new Set<string>(entries.map((entry) => keyOf(entry))).size | 0;

    const lines: string[] = [];
    lines.push(
        `  split-cardinality(${label}) matched=${matched.length} selectedVariants=${selectedVariantKeys.length}`,
    );

    for (let i = 0; i < selectedVariantKeys.length; i++) {
        const parts = selectedVariantKeys[i].split("|");
        if (parts.length !== 4) {
            continue;
        }
        const locTypeId = Number(parts[0]) | 0;
        const variantType = Number(parts[1]) | 0;
        const variantRotation = Number(parts[2]) | 0;
        const priority = Number(parts[3]) | 0;

        const tsEntries = tsLocPreMergeSignatureEntries.filter(
            (entry) =>
                (entry.locTypeId | 0) === locTypeId &&
                (entry.variantType | 0) === variantType &&
                (entry.variantRotation | 0) === variantRotation &&
                (entry.priority | 0) === priority,
        );
        const runtimeEntries = runtimeLocMergeDecisionEntries.filter(
            (entry) =>
                (entry.locTypeId | 0) === locTypeId &&
                (entry.variantType | 0) === variantType &&
                (entry.variantRotation | 0) === variantRotation &&
                (entry.priority | 0) === priority,
        );
        if (tsEntries.length <= 0 && runtimeEntries.length <= 0) {
            continue;
        }

        const tsSceneHeightCount = countDistinctNumbers(
            tsEntries.map((entry) => entry.sceneHeight | 0),
        );
        const tsContourGroundCount = countDistinctNumbers(
            tsEntries.map((entry) => entry.contourGround | 0),
        );
        const tsContourSceneXCount = countDistinctNumbers(
            tsEntries.map((entry) => entry.contourSceneX | 0),
        );
        const tsContourSceneZCount = countDistinctNumbers(
            tsEntries.map((entry) => entry.contourSceneZ | 0),
        );
        const tsModelIdsHashCount = countDistinctNumbers(
            tsEntries.map((entry) => entry.modelIdsHash | 0),
        );
        const tsForceMergeCount = countDistinctNumbers(
            tsEntries.map((entry) => entry.forceMerge | 0),
        );
        const tsIncludeLodCount = countDistinctNumbers(
            tsEntries.map((entry) => entry.includeLod | 0),
        );
        const tsLevelCount = countDistinctNumbers(tsEntries.map((entry) => entry.level | 0));
        const tsK0 = countDistinctKeys(
            tsEntries,
            (entry) =>
                `${entry.forceMerge | 0}|${entry.includeLod | 0}|${entry.level | 0}|${
                    entry.contourGround | 0
                }|${entry.modelIdsHash | 0}`,
        );
        const tsK1 = countDistinctKeys(
            tsEntries,
            (entry) =>
                `${entry.forceMerge | 0}|${entry.includeLod | 0}|${entry.level | 0}|${
                    entry.contourGround | 0
                }|${entry.modelIdsHash | 0}|${entry.sceneHeight | 0}`,
        );
        const tsK2 = countDistinctKeys(
            tsEntries,
            (entry) =>
                `${entry.forceMerge | 0}|${entry.includeLod | 0}|${entry.level | 0}|${
                    entry.contourGround | 0
                }|${entry.modelIdsHash | 0}|${entry.sceneHeight | 0}|${entry.contourSceneX | 0}|${
                    entry.contourSceneZ | 0
                }`,
        );

        const rtSceneHeightCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.sceneHeight | 0),
        );
        const rtContourGroundCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.contourGround | 0),
        );
        const rtContourSceneXCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.contourSceneX | 0),
        );
        const rtContourSceneZCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.contourSceneZ | 0),
        );
        const rtModelIdsHashCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.modelIdsHash | 0),
        );
        const rtContourProfileHashCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.contourProfileHash | 0),
        );
        const rtModelSignatureCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.modelSignature | 0),
        );
        const rtForceMergeCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.forceMerge | 0),
        );
        const rtIncludeLodCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.includeLod | 0),
        );
        const rtLevelCount = countDistinctNumbers(runtimeEntries.map((entry) => entry.level | 0));
        const rtContourSensitiveCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.contourSensitive | 0),
        );
        const rtChosenGroupCount = countDistinctNumbers(
            runtimeEntries.map((entry) => entry.chosenGroupIndex | 0),
        );
        const rtK0 = countDistinctKeys(
            runtimeEntries,
            (entry) =>
                `${entry.forceMerge | 0}|${entry.includeLod | 0}|${entry.level | 0}|${
                    entry.contourGround | 0
                }|${entry.modelIdsHash | 0}`,
        );
        const rtK1 = countDistinctKeys(
            runtimeEntries,
            (entry) =>
                `${entry.forceMerge | 0}|${entry.includeLod | 0}|${entry.level | 0}|${
                    entry.contourGround | 0
                }|${entry.modelIdsHash | 0}|${entry.sceneHeight | 0}`,
        );
        const rtK2 = countDistinctKeys(
            runtimeEntries,
            (entry) =>
                `${entry.forceMerge | 0}|${entry.includeLod | 0}|${entry.level | 0}|${
                    entry.contourGround | 0
                }|${entry.modelIdsHash | 0}|${entry.sceneHeight | 0}|${entry.contourSceneX | 0}|${
                    entry.contourSceneZ | 0
                }`,
        );

        const diffCandidates: Array<readonly [string, number, number]> = [
            ["sceneHeight", tsSceneHeightCount, rtSceneHeightCount],
            ["contourGround", tsContourGroundCount, rtContourGroundCount],
            ["contourSceneX", tsContourSceneXCount, rtContourSceneXCount],
            ["contourSceneZ", tsContourSceneZCount, rtContourSceneZCount],
            ["modelIdsHash", tsModelIdsHashCount, rtModelIdsHashCount],
            ["forceMerge", tsForceMergeCount, rtForceMergeCount],
            ["includeLod", tsIncludeLodCount, rtIncludeLodCount],
            ["level", tsLevelCount, rtLevelCount],
            ["k0", tsK0, rtK0],
            ["k1", tsK1, rtK1],
            ["k2", tsK2, rtK2],
        ];
        let firstDiff = "<none>";
        for (let di = 0; di < diffCandidates.length; di++) {
            const [name, tsValue, rtValue] = diffCandidates[di];
            if ((tsValue | 0) !== (rtValue | 0)) {
                firstDiff = `${name}:ts=${tsValue | 0},rt=${rtValue | 0}`;
                break;
            }
        }
        if (firstDiff === "<none>" && rtModelSignatureCount > 1) {
            firstDiff = `modelSignature:ts=<n/a>,rt=${rtModelSignatureCount | 0}`;
        }
        if (firstDiff === "<none>" && rtContourProfileHashCount > 1) {
            firstDiff = `contourProfileHash:ts=<n/a>,rt=${rtContourProfileHashCount | 0}`;
        }
        if (firstDiff === "<none>" && rtContourSensitiveCount > 1) {
            firstDiff = `contourSensitive:ts=<n/a>,rt=${rtContourSensitiveCount | 0}`;
        }
        if (firstDiff === "<none>" && (rtChosenGroupCount | 0) !== (tsK1 | 0)) {
            firstDiff =
                `chosenGroupIndex:tsK1=${tsK1 | 0},rtGroups=${rtChosenGroupCount | 0}` +
                ` (runtime-only split dimension likely)`;
        }

        const tsHeightGroundHist = new Map<string, number>();
        for (let i = 0; i < tsEntries.length; i++) {
            const entry = tsEntries[i];
            const key = `${entry.sceneHeight | 0}|${entry.contourGround | 0}`;
            tsHeightGroundHist.set(key, ((tsHeightGroundHist.get(key) ?? 0) + 1) | 0);
        }
        const rtHeightGroundHist = new Map<string, number>();
        for (let i = 0; i < runtimeEntries.length; i++) {
            const entry = runtimeEntries[i];
            const key = `${entry.sceneHeight | 0}|${entry.contourGround | 0}`;
            rtHeightGroundHist.set(key, ((rtHeightGroundHist.get(key) ?? 0) + 1) | 0);
        }
        const heightGroundDiff = new Set<string>([
            ...tsHeightGroundHist.keys(),
            ...rtHeightGroundHist.keys(),
        ]);
        const heightGroundDelta = Array.from(heightGroundDiff)
            .map((key) => {
                const tsCount = (tsHeightGroundHist.get(key) ?? 0) | 0;
                const rtCount = (rtHeightGroundHist.get(key) ?? 0) | 0;
                return {
                    key,
                    tsCount,
                    rtCount,
                    delta: (rtCount - tsCount) | 0,
                };
            })
            .filter((entry) => (entry.delta | 0) !== 0)
            .sort((a, b) => {
                const ad = Math.abs(a.delta | 0);
                const bd = Math.abs(b.delta | 0);
                if (ad !== bd) {
                    return bd - ad;
                }
                return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
            });
        const tsPlacementHist = new Map<string, number>();
        for (let i = 0; i < tsEntries.length; i++) {
            const entry = tsEntries[i];
            const key =
                `${entry.tileX | 0},${entry.tileY | 0}` +
                `|h=${entry.sceneHeight | 0}|cg=${entry.contourGround | 0}` +
                `|cx=${entry.contourSceneX | 0}|cz=${entry.contourSceneZ | 0}`;
            tsPlacementHist.set(key, ((tsPlacementHist.get(key) ?? 0) + 1) | 0);
        }
        const rtPlacementHist = new Map<string, number>();
        for (let i = 0; i < runtimeEntries.length; i++) {
            const entry = runtimeEntries[i];
            const key =
                `${entry.tileX | 0},${entry.tileY | 0}` +
                `|h=${entry.sceneHeight | 0}|cg=${entry.contourGround | 0}` +
                `|cx=${entry.contourSceneX | 0}|cz=${entry.contourSceneZ | 0}`;
            rtPlacementHist.set(key, ((rtPlacementHist.get(key) ?? 0) + 1) | 0);
        }
        const placementDiffKeys = new Set<string>([
            ...tsPlacementHist.keys(),
            ...rtPlacementHist.keys(),
        ]);
        const placementDelta = Array.from(placementDiffKeys)
            .map((key) => {
                const tsCount = (tsPlacementHist.get(key) ?? 0) | 0;
                const rtCount = (rtPlacementHist.get(key) ?? 0) | 0;
                return {
                    key,
                    tsCount,
                    rtCount,
                    delta: (rtCount - tsCount) | 0,
                };
            })
            .filter((entry) => (entry.delta | 0) !== 0)
            .sort((a, b) => {
                const ad = Math.abs(a.delta | 0);
                const bd = Math.abs(b.delta | 0);
                if (ad !== bd) {
                    return bd - ad;
                }
                return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
            });

        lines.push(
            `  split-cardinality(${label}) loc=${locTypeId} v=${variantType}/${variantRotation} pri=${priority} ts{n=${tsEntries.length} h=${tsSceneHeightCount} cg=${tsContourGroundCount} cx=${tsContourSceneXCount} cz=${tsContourSceneZCount} ids=${tsModelIdsHashCount} fm=${tsForceMergeCount} lod=${tsIncludeLodCount} lvl=${tsLevelCount} k0=${tsK0} k1=${tsK1} k2=${tsK2}} rt{n=${runtimeEntries.length} grp=${rtChosenGroupCount} cs=${rtContourSensitiveCount} h=${rtSceneHeightCount} cg=${rtContourGroundCount} cx=${rtContourSceneXCount} cz=${rtContourSceneZCount} ids=${rtModelIdsHashCount} cp=${rtContourProfileHashCount} sig=${rtModelSignatureCount} fm=${rtForceMergeCount} lod=${rtIncludeLodCount} lvl=${rtLevelCount} k0=${rtK0} k1=${rtK1} k2=${rtK2}} firstDiff=${firstDiff}`,
        );
        if (heightGroundDelta.length > 0) {
            lines.push(
                `  split-cardinality(${label}) heightGroundDelta=` +
                    JSON.stringify(heightGroundDelta.slice(0, 8)),
            );
        }
        if (placementDelta.length > 0) {
            lines.push(
                `  split-cardinality(${label}) placementDelta=` +
                    JSON.stringify(placementDelta.slice(0, 8)),
            );
        }
    }

    if (lines.length === 1) {
        lines.push(`  split-cardinality(${label}): <no-variant-data>`);
    }
    return lines;
}

function hashCommandCanonicalGeometry(
    vertices: Uint8Array,
    indices: Int32Array,
    cmdOffsetBytes: number,
    cmdElements: number,
): number {
    let h = 2166136261 >>> 0;
    h = fnv1a32UpdateInt(h, cmdElements | 0);

    const start = ((cmdOffsetBytes | 0) >> 2) | 0;
    const count = cmdElements | 0;
    if (start < 0 || count < 0 || start > indices.length || count > indices.length - start) {
        return fnv1a32UpdateInt(h, -1) | 0;
    }

    const vertexCount = (vertices.length / 16) | 0;
    const v = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const remap = new Map<number, number>();
    let next = 0;

    for (let i = 0; i < count; i++) {
        const original = indices[start + i] | 0;
        let mapped = remap.get(original);
        if (mapped === undefined) {
            mapped = next++;
            remap.set(original, mapped);
            if (original < 0 || original >= vertexCount) {
                h = fnv1a32UpdateInt(h, -2);
            } else {
                const base = (original * 16) | 0;
                const v0 = v.getUint32(base + 0, true) | 0;
                const v1 = v.getUint32(base + 4, true) | 0;
                const v2 = v.getUint32(base + 8, true) | 0;
                const v3 = v.getUint32(base + 12, true) | 0;
                h = fnv1a32UpdateInt(h, v0);
                h = fnv1a32UpdateInt(h, v1);
                h = fnv1a32UpdateInt(h, v2);
                h = fnv1a32UpdateInt(h, v3);
            }
        }
        h = fnv1a32UpdateInt(h, mapped | 0);
    }

    return h | 0;
}

type InteractGeometryBin = Readonly<{
    geometryHash: number;
    elements: number;
    commandCount: number;
    matchedInstances: number;
    sampleCmdIndices: number[];
    sampleFirstInstance:
        | {
              sceneX: number;
              sceneZ: number;
              level: number;
              contour: number;
              pri: number;
          }
        | undefined;
}>;

function collectInteractGeometryBinsForBucket(
    arrays: {
        cmdBucketIndices: Int32Array;
        cmdOffsets: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    vertices: Uint8Array,
    indices: Int32Array,
    interactType: number,
    interactId: number,
    bucket: number,
    limit: number,
): InteractGeometryBin[] {
    type MutableBin = {
        geometryHash: number;
        elements: number;
        commandCount: number;
        matchedInstances: number;
        sampleCmdIndices: number[];
        sampleFirstInstance:
            | {
                  sceneX: number;
                  sceneZ: number;
                  level: number;
                  contour: number;
                  pri: number;
              }
            | undefined;
    };

    const bins = new Map<string, MutableBin>();
    let instanceBase = 0;
    for (let cmdIndex = 0; cmdIndex < arrays.cmdBucketIndices.length; cmdIndex++) {
        const cmdBucket = arrays.cmdBucketIndices[cmdIndex] | 0;
        const cmdInstanceCount =
            cmdIndex < arrays.cmdInstanceCounts.length ? arrays.cmdInstanceCounts[cmdIndex] | 0 : 0;
        const baseWord = (instanceBase * 8) | 0;

        if (cmdBucket !== (bucket | 0) || cmdInstanceCount <= 0) {
            instanceBase += cmdInstanceCount;
            continue;
        }

        let matched = 0;
        let first:
            | {
                  sceneX: number;
                  sceneZ: number;
                  level: number;
                  contour: number;
                  pri: number;
              }
            | undefined;

        for (let j = 0; j < cmdInstanceCount; j++) {
            const off = baseWord + j * 8;
            if (off + 7 >= arrays.cmdPackedInstances.length) {
                break;
            }
            const it = arrays.cmdPackedInstances[off + 6] | 0;
            const id = arrays.cmdPackedInstances[off + 7] >>> 0;
            if (it === (interactType | 0) && id === interactId >>> 0) {
                matched++;
                if (!first) {
                    first = {
                        sceneX: arrays.cmdPackedInstances[off + 0] | 0,
                        sceneZ: arrays.cmdPackedInstances[off + 1] | 0,
                        level: arrays.cmdPackedInstances[off + 3] | 0,
                        contour: arrays.cmdPackedInstances[off + 4] | 0,
                        pri: arrays.cmdPackedInstances[off + 5] | 0,
                    };
                }
            }
        }

        if (matched > 0) {
            const cmdOffset =
                cmdIndex < arrays.cmdOffsets.length ? arrays.cmdOffsets[cmdIndex] | 0 : 0;
            const cmdElements =
                cmdIndex < arrays.cmdElements.length ? arrays.cmdElements[cmdIndex] | 0 : 0;
            const geometryHash = hashCommandCanonicalGeometry(
                vertices,
                indices,
                cmdOffset,
                cmdElements,
            );
            const key = String(geometryHash) + "|" + String(cmdElements);
            const bin = bins.get(key);
            if (bin) {
                bin.commandCount += 1;
                bin.matchedInstances += matched;
                if (bin.sampleCmdIndices.length < 4) {
                    bin.sampleCmdIndices.push(cmdIndex | 0);
                }
                if (!bin.sampleFirstInstance && first) {
                    bin.sampleFirstInstance = first;
                }
            } else {
                bins.set(key, {
                    geometryHash,
                    elements: cmdElements | 0,
                    commandCount: 1,
                    matchedInstances: matched,
                    sampleCmdIndices: [cmdIndex | 0],
                    sampleFirstInstance: first,
                });
            }
        }

        instanceBase += cmdInstanceCount;
    }

    return Array.from(bins.values())
        .sort((a, b) => {
            if (b.matchedInstances !== a.matchedInstances) {
                return (b.matchedInstances | 0) - (a.matchedInstances | 0);
            }
            if (b.commandCount !== a.commandCount) {
                return (b.commandCount | 0) - (a.commandCount | 0);
            }
            return (b.elements | 0) - (a.elements | 0);
        })
        .slice(0, Math.max(1, limit | 0));
}

function diffMultiInstanceBaseCommandsIgnoringInteract(
    tsInput: {
        cmdBucketIndices: Int32Array;
        cmdOffsets: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    cacheArrays: {
        cmdBucketIndices: Int32Array;
        cmdOffsets: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    tsSceneLocRecords: readonly TsSceneLocRecord[] | undefined,
    tsVertices?: Uint8Array,
    tsIndices?: Int32Array,
    cacheVertices?: Uint8Array,
    cacheIndices?: Int32Array,
    getTsModelHashStatsForLocIds?: (locTypeIds: readonly number[]) => readonly TsLocModelHashStat[],
    tsLocPreMergeSignatureEntries?: readonly TsLocPreMergeSignatureEntry[],
    runtimeCommandProvenanceEntries?: ReadonlyArray<RuntimeCommandProvenanceEntry>,
    runtimeLocMergeDecisionEntries?: ReadonlyArray<RuntimeLocMergeDecisionEntry>,
): void {
    function hashCmd(
        cmdIndex: number,
        cmdBucketIndices: Int32Array,
        cmdInstanceCounts: Int32Array,
        cmdPackedInstances: Int32Array,
    ): number {
        // Order-insensitive hash over (sceneX, sceneZ, hOff, level, contour, pri) for all instances.
        // We intentionally ignore interactType/interactId here; this is used to find missing draw commands
        // even when C++/TS disagree about what interact key lives in the merged pass.
        let sum = 0 >>> 0;
        let x = 0 >>> 0;

        let instanceBase = 0;
        for (let i = 0; i < cmdIndex && i < cmdInstanceCounts.length; i++) {
            instanceBase += cmdInstanceCounts[i] | 0;
        }
        const ic = cmdIndex < cmdInstanceCounts.length ? cmdInstanceCounts[cmdIndex] | 0 : 0;
        let off = (instanceBase * 8) | 0;
        for (let j = 0; j < ic; j++) {
            if (off + 5 >= cmdPackedInstances.length) {
                break;
            }
            let ih = 2166136261 >>> 0;
            const fields = [
                cmdPackedInstances[off + 0] | 0,
                cmdPackedInstances[off + 1] | 0,
                cmdPackedInstances[off + 2] | 0,
                cmdPackedInstances[off + 3] | 0,
                cmdPackedInstances[off + 4] | 0,
                cmdPackedInstances[off + 5] | 0,
            ];
            for (let k = 0; k < fields.length; k++) {
                ih ^= fields[k] >>> 0;
                ih = Math.imul(ih, 16777619) >>> 0;
            }
            sum = (sum + ih) >>> 0;
            x ^= ih;
            off += 8;
        }

        let h = 2166136261 >>> 0;
        h ^= x;
        h = Math.imul(h, 16777619) >>> 0;
        h ^= sum;
        h = Math.imul(h, 16777619) >>> 0;
        h ^= ic >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
        h ^= (cmdBucketIndices[cmdIndex] | 0) >>> 0;
        h = Math.imul(h, 16777619) >>> 0;
        return h >>> 0;
    }

    type Entry = { cmdIndex: number; hash: number; elements: number; instances: number };

    function collect(input: {
        cmdBucketIndices: Int32Array;
        cmdOffsets: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    }): Map<number, Entry[]> {
        const out = new Map<number, Entry[]>();
        for (let i = 0; i < input.cmdBucketIndices.length; i++) {
            const bucket = input.cmdBucketIndices[i] | 0;
            if (bucket !== 0) {
                continue;
            }
            const ic = i < input.cmdInstanceCounts.length ? input.cmdInstanceCounts[i] | 0 : 0;
            if (ic <= 1) {
                continue;
            }
            const h = hashCmd(
                i,
                input.cmdBucketIndices,
                input.cmdInstanceCounts,
                input.cmdPackedInstances,
            );
            const e: Entry = {
                cmdIndex: i,
                hash: h,
                elements: i < input.cmdElements.length ? input.cmdElements[i] | 0 : 0,
                instances: ic,
            };
            const arr = out.get(h);
            if (arr) {
                arr.push(e);
            } else {
                out.set(h, [e]);
            }
        }
        return out;
    }

    const ts = collect(tsInput);
    const cache = collect(cacheArrays);

    const missing: Entry[] = [];
    for (const [h, tsEntries] of ts.entries()) {
        const cacheEntries = cache.get(h);
        const missCount = (tsEntries.length | 0) - (cacheEntries ? cacheEntries.length | 0 : 0);
        for (let k = 0; k < missCount; k++) {
            missing.push(tsEntries[k]);
        }
    }

    if (missing.length === 0) {
        console.error("  base multi-instance diff: <none>");
        return;
    }

    missing.sort((a, b) => (b.elements | 0) - (a.elements | 0));
    console.error(`  base multi-instance diff: missingInCache=${missing.length}`);

    const emittedInteractBins = new Set<string>();
    const n = Math.min(6, missing.length);
    for (let i = 0; i < n; i++) {
        const m = missing[i];
        console.error(
            `  missing base cmd hash=${m.hash} tsCmdIndex=${m.cmdIndex} elements=${m.elements} instances=${m.instances}`,
        );
        // Print first instance fields for quick location.
        console.error(
            "  " +
                describeCommandAtIndex(
                    "ts",
                    tsInput.cmdBucketIndices,
                    tsInput.cmdOffsets,
                    tsInput.cmdElements,
                    tsInput.cmdInstanceCounts,
                    tsInput.cmdPackedInstances,
                    m.cmdIndex,
                ),
        );
        // Probe whether this interact key exists anywhere in cache streams (it might have been merged/baked).
        let instBase = 0;
        for (let k = 0; k < m.cmdIndex && k < tsInput.cmdInstanceCounts.length; k++) {
            instBase += tsInput.cmdInstanceCounts[k] | 0;
        }
        const off = (instBase * 8) | 0;
        if (off + 7 < tsInput.cmdPackedInstances.length) {
            const it = tsInput.cmdPackedInstances[off + 6] | 0;
            const id = tsInput.cmdPackedInstances[off + 7] >>> 0;
            if (it !== 0 && id !== 0xffff) {
                const cacheHits = findFirstCommandsWithInteractKey(
                    cacheArrays.cmdBucketIndices,
                    cacheArrays.cmdInstanceCounts,
                    cacheArrays.cmdPackedInstances,
                    it,
                    id,
                    12,
                );
                const tsHits = findFirstCommandsWithInteractKey(
                    tsInput.cmdBucketIndices,
                    tsInput.cmdInstanceCounts,
                    tsInput.cmdPackedInstances,
                    it,
                    id,
                    12,
                );
                console.error(
                    `  missing interactKey probe it=${it} id=${id} tsHits=${JSON.stringify(
                        tsHits,
                    )} cacheHits=${JSON.stringify(cacheHits)}`,
                );
                const want = {
                    sceneX: tsInput.cmdPackedInstances[off + 0] | 0,
                    sceneZ: tsInput.cmdPackedInstances[off + 1] | 0,
                    level: tsInput.cmdPackedInstances[off + 3] | 0,
                    contour: tsInput.cmdPackedInstances[off + 4] | 0,
                    pri: tsInput.cmdPackedInstances[off + 5] | 0,
                    instanceCount: m.instances | 0,
                };
                const cacheCmds = findFirstCommandsWithFirstInstanceFields(
                    cacheArrays.cmdBucketIndices,
                    cacheArrays.cmdInstanceCounts,
                    cacheArrays.cmdPackedInstances,
                    want,
                    8,
                );
                console.error(
                    `  missing first-inst match want=${JSON.stringify(
                        want,
                    )} cacheCmds=${JSON.stringify(cacheCmds)}`,
                );
                const cacheAnyInstCmds = findFirstCommandsWithAnyInstanceFields(
                    cacheArrays.cmdBucketIndices,
                    cacheArrays.cmdInstanceCounts,
                    cacheArrays.cmdPackedInstances,
                    want,
                    8,
                );
                console.error(
                    `  missing any-inst match want=${JSON.stringify(
                        want,
                    )} cacheCmds=${JSON.stringify(cacheAnyInstCmds)}`,
                );
                for (let ci = 0; ci < Math.min(cacheAnyInstCmds.length, 4); ci++) {
                    const hit = cacheAnyInstCmds[ci];
                    const cacheInstances = collectCommandInstances(
                        hit.cmdIndex,
                        cacheArrays.cmdInstanceCounts,
                        cacheArrays.cmdPackedInstances,
                    );
                    console.error(
                        `  missing any-inst cache cmd[${hit.cmdIndex}] bucket=${
                            hit.bucket
                        } instances=${hit.instanceCount}: ${JSON.stringify(cacheInstances)}`,
                    );
                }

                const tsInstances = collectCommandInstances(
                    m.cmdIndex,
                    tsInput.cmdInstanceCounts,
                    tsInput.cmdPackedInstances,
                );
                console.error(`  ts cmd instances: ${JSON.stringify(tsInstances)}`);
                const missingTsInstances: Array<{
                    index: number;
                    sceneX: number;
                    sceneZ: number;
                    level: number;
                    contour: number;
                    pri: number;
                }> = [];
                const tsInstanceRouting: Array<{
                    index: number;
                    cacheCmdIndex: number;
                    cacheBucket: number;
                    cacheInstanceCount: number;
                }> = [];
                for (let ti = 0; ti < tsInstances.length; ti++) {
                    const inst = tsInstances[ti];
                    const hits = findFirstCommandsWithAnyInstanceFields(
                        cacheArrays.cmdBucketIndices,
                        cacheArrays.cmdInstanceCounts,
                        cacheArrays.cmdPackedInstances,
                        {
                            sceneX: inst.sceneX | 0,
                            sceneZ: inst.sceneZ | 0,
                            level: inst.level | 0,
                            contour: inst.contour | 0,
                            pri: inst.pri | 0,
                        },
                        1,
                    );
                    if (hits.length <= 0) {
                        missingTsInstances.push({
                            index: ti | 0,
                            sceneX: inst.sceneX | 0,
                            sceneZ: inst.sceneZ | 0,
                            level: inst.level | 0,
                            contour: inst.contour | 0,
                            pri: inst.pri | 0,
                        });
                    } else {
                        tsInstanceRouting.push({
                            index: ti | 0,
                            cacheCmdIndex: hits[0].cmdIndex | 0,
                            cacheBucket: hits[0].bucket | 0,
                            cacheInstanceCount: hits[0].instanceCount | 0,
                        });
                    }
                }
                if (missingTsInstances.length > 0) {
                    console.error(
                        `  missing ts-instance keys in cache count=${missingTsInstances.length}: ` +
                            JSON.stringify(missingTsInstances.slice(0, 8)),
                    );
                } else if (tsInstanceRouting.length > 0) {
                    console.error(
                        `  ts-instance routing to cache commands: ` +
                            JSON.stringify(tsInstanceRouting.slice(0, 12)),
                    );
                    const routedOffBase = Array.from(
                        new Set(
                            tsInstanceRouting
                                .filter((entry) => (entry.cacheBucket | 0) !== 0)
                                .map((entry) => entry.cacheCmdIndex | 0),
                        ),
                    ).slice(0, 4);
                    for (let ri = 0; ri < routedOffBase.length; ri++) {
                        const cmdIndex = routedOffBase[ri] | 0;
                        console.error(
                            "  " +
                                describeCommandAtIndex(
                                    "cache-routed",
                                    cacheArrays.cmdBucketIndices,
                                    cacheArrays.cmdOffsets,
                                    cacheArrays.cmdElements,
                                    cacheArrays.cmdInstanceCounts,
                                    cacheArrays.cmdPackedInstances,
                                    cmdIndex,
                                ),
                        );
                    }
                }
                const tsLocProbeLines = describeTsLocSourceProbe(tsSceneLocRecords, tsInstances, 4);
                for (let pi = 0; pi < tsLocProbeLines.length; pi++) {
                    console.error(tsLocProbeLines[pi]);
                }
                const tsGroupingLines = describeTsLocGroupingCandidates(
                    tsSceneLocRecords,
                    tsInstances,
                    "ts-missing-base-cmd",
                    5,
                );
                for (let gi = 0; gi < tsGroupingLines.length; gi++) {
                    console.error(tsGroupingLines[gi]);
                }
                const tsModelPartitionLines = summarizeTsModelHashPartitionsForInstances(
                    "ts-missing-base-cmd",
                    tsSceneLocRecords,
                    tsInstances,
                    getTsModelHashStatsForLocIds,
                    4,
                );
                for (let gi = 0; gi < tsModelPartitionLines.length; gi++) {
                    console.error(tsModelPartitionLines[gi]);
                }
                const tsPreMergeFieldLines = summarizeTsPreMergeSignatureFieldsForInstances(
                    "ts-missing-base-cmd",
                    tsSceneLocRecords,
                    tsLocPreMergeSignatureEntries,
                    tsInstances,
                    6,
                );
                for (let gi = 0; gi < tsPreMergeFieldLines.length; gi++) {
                    console.error(tsPreMergeFieldLines[gi]);
                }
                const splitCardinalityLines = summarizeDeterministicSplitCardinalityForInstances(
                    "ts-missing-base-cmd",
                    tsSceneLocRecords,
                    tsLocPreMergeSignatureEntries,
                    runtimeLocMergeDecisionEntries,
                    tsInstances,
                    3,
                );
                for (let gi = 0; gi < splitCardinalityLines.length; gi++) {
                    console.error(splitCardinalityLines[gi]);
                }

                if (tsHits.length > 0) {
                    const seenTs = new Set<number>();
                    for (let hi = 0; hi < tsHits.length; hi++) {
                        const hit = tsHits[hi];
                        if (seenTs.has(hit.cmdIndex | 0)) continue;
                        seenTs.add(hit.cmdIndex | 0);
                        console.error(
                            "  " +
                                describeCommandAtIndex(
                                    "ts",
                                    tsInput.cmdBucketIndices,
                                    tsInput.cmdOffsets,
                                    tsInput.cmdElements,
                                    tsInput.cmdInstanceCounts,
                                    tsInput.cmdPackedInstances,
                                    hit.cmdIndex | 0,
                                ),
                        );
                    }
                }

                if (cacheHits.length > 0) {
                    const seen = new Set<number>();
                    const emittedRuntimeSplitReasons = new Set<string>();
                    let groupedPrinted = 0;
                    for (let hi = 0; hi < cacheHits.length; hi++) {
                        const hit = cacheHits[hi];
                        if (seen.has(hit.cmdIndex | 0)) continue;
                        seen.add(hit.cmdIndex | 0);
                        const cacheInstances = collectCommandInstances(
                            hit.cmdIndex | 0,
                            cacheArrays.cmdInstanceCounts,
                            cacheArrays.cmdPackedInstances,
                        );
                        console.error(
                            "  " +
                                describeCommandAtIndex(
                                    "cache",
                                    cacheArrays.cmdBucketIndices,
                                    cacheArrays.cmdOffsets,
                                    cacheArrays.cmdElements,
                                    cacheArrays.cmdInstanceCounts,
                                    cacheArrays.cmdPackedInstances,
                                    hit.cmdIndex | 0,
                                ),
                        );
                        if (
                            runtimeCommandProvenanceEntries &&
                            (hit.cmdIndex | 0) >= 0 &&
                            (hit.cmdIndex | 0) < runtimeCommandProvenanceEntries.length
                        ) {
                            const pe = runtimeCommandProvenanceEntries[hit.cmdIndex | 0];
                            console.error(
                                "  cache-hit provenance cmd=" +
                                    (hit.cmdIndex | 0) +
                                    " src=" +
                                    (pe.sourceKind | 0) +
                                    " loc=" +
                                    (pe.locTypeId | 0) +
                                    " placement=" +
                                    (pe.placementType | 0) +
                                    "/" +
                                    (pe.placementRotation | 0) +
                                    " variant=" +
                                    (pe.variantType | 0) +
                                    "/" +
                                    (pe.variantRotation | 0) +
                                    " pass=" +
                                    (pe.pass | 0) +
                                    " mergePath=" +
                                    (pe.mergePath | 0) +
                                    " splitSig=" +
                                    (pe.splitSignature | 0),
                            );
                            if (runtimeLocMergeDecisionEntries && (pe.locTypeId | 0) >= 0) {
                                const splitKey =
                                    String(pe.locTypeId | 0) +
                                    "|" +
                                    String(pe.variantType | 0) +
                                    "|" +
                                    String(pe.variantRotation | 0);
                                if (!emittedRuntimeSplitReasons.has(splitKey)) {
                                    emittedRuntimeSplitReasons.add(splitKey);
                                    const splitReasonLines =
                                        summarizeRuntimeSplitReasonsForLocVariant(
                                            runtimeLocMergeDecisionEntries,
                                            pe.locTypeId | 0,
                                            pe.variantType | 0,
                                            pe.variantRotation | 0,
                                            6,
                                        );
                                    for (let si = 0; si < splitReasonLines.length; si++) {
                                        console.error(splitReasonLines[si]);
                                    }
                                }
                            }
                        }
                        console.error(
                            `  cache cmd[${hit.cmdIndex}] bucket=${hit.bucket} instances=${
                                cacheInstances.length
                            }: ${JSON.stringify(cacheInstances)}`,
                        );
                        if (groupedPrinted < 8) {
                            const cacheGroupingLines = describeTsLocGroupingCandidates(
                                tsSceneLocRecords,
                                cacheInstances,
                                `cache-hit-${hit.cmdIndex | 0}`,
                                5,
                            );
                            for (let gi = 0; gi < cacheGroupingLines.length; gi++) {
                                console.error(cacheGroupingLines[gi]);
                            }
                            const cacheModelPartitionLines =
                                summarizeTsModelHashPartitionsForInstances(
                                    `cache-hit-${hit.cmdIndex | 0}`,
                                    tsSceneLocRecords,
                                    cacheInstances,
                                    getTsModelHashStatsForLocIds,
                                    3,
                                );
                            for (let gi = 0; gi < cacheModelPartitionLines.length; gi++) {
                                console.error(cacheModelPartitionLines[gi]);
                            }
                            const cachePreMergeFieldLines =
                                summarizeTsPreMergeSignatureFieldsForInstances(
                                    `cache-hit-${hit.cmdIndex | 0}`,
                                    tsSceneLocRecords,
                                    tsLocPreMergeSignatureEntries,
                                    cacheInstances,
                                    4,
                                );
                            for (let gi = 0; gi < cachePreMergeFieldLines.length; gi++) {
                                console.error(cachePreMergeFieldLines[gi]);
                            }
                            groupedPrinted++;
                        }
                    }
                }

                const interactKey = String(it | 0) + ":" + String(id >>> 0);
                if (
                    !emittedInteractBins.has(interactKey) &&
                    tsVertices instanceof Uint8Array &&
                    tsIndices instanceof Int32Array &&
                    cacheVertices instanceof Uint8Array &&
                    cacheIndices instanceof Int32Array
                ) {
                    emittedInteractBins.add(interactKey);
                    const tsBins = collectInteractGeometryBinsForBucket(
                        tsInput,
                        tsVertices,
                        tsIndices,
                        it,
                        id,
                        0,
                        8,
                    );
                    const cacheBins = collectInteractGeometryBinsForBucket(
                        cacheArrays,
                        cacheVertices,
                        cacheIndices,
                        it,
                        id,
                        0,
                        8,
                    );
                    console.error(
                        `  ts base geometry-bins it=${it} id=${id}: ${JSON.stringify(tsBins)}`,
                    );
                    console.error(
                        `  cache base geometry-bins it=${it} id=${id}: ${JSON.stringify(
                            cacheBins,
                        )}`,
                    );
                }
            }
        }
    }
}

function summarizeMergedDummyCommands(
    label: string,
    cmdBucketIndices: Int32Array,
    cmdOffsets: Int32Array,
    cmdElements: Int32Array,
    cmdInstanceCounts: Int32Array,
    cmdPackedInstances: Int32Array,
    bucket: number,
): void {
    type Stat = { count: number; elementsTotal: number; maxElements: number; sampleOffset: number };
    const stats = new Map<number, Stat>();

    let instanceBase = 0;
    for (let i = 0; i < cmdBucketIndices.length; i++) {
        const b = cmdBucketIndices[i] | 0;
        const ic = i < cmdInstanceCounts.length ? cmdInstanceCounts[i] | 0 : 0;
        const packedOff = (instanceBase * 8) | 0;
        if (b === bucket && ic === 1 && packedOff + 7 < cmdPackedInstances.length) {
            const sceneX = cmdPackedInstances[packedOff + 0] | 0;
            const sceneZ = cmdPackedInstances[packedOff + 1] | 0;
            const heightOffset = cmdPackedInstances[packedOff + 2] | 0;
            const priority = cmdPackedInstances[packedOff + 5] | 0;
            const interactType = cmdPackedInstances[packedOff + 6] | 0;
            const interactId = cmdPackedInstances[packedOff + 7] >>> 0;

            const isDummy =
                sceneX === 0 &&
                sceneZ === 0 &&
                heightOffset === 0 &&
                interactType === 0 &&
                interactId === 0xffff;
            if (isDummy) {
                const elements = i < cmdElements.length ? cmdElements[i] | 0 : 0;
                const offset = i < cmdOffsets.length ? cmdOffsets[i] | 0 : 0;
                const s = stats.get(priority) ?? {
                    count: 0,
                    elementsTotal: 0,
                    maxElements: 0,
                    sampleOffset: offset,
                };
                s.count++;
                s.elementsTotal += elements;
                if (elements > s.maxElements) {
                    s.maxElements = elements;
                    s.sampleOffset = offset;
                }
                stats.set(priority, s);
            }
        }
        instanceBase += ic;
    }

    const keys = Array.from(stats.keys()).sort((a, b) => a - b);
    if (keys.length === 0) {
        console.error(`  ${label} dummySummary bucket=${bucket}: <none>`);
        return;
    }
    const parts: string[] = [];
    for (const k of keys) {
        const s = stats.get(k)!;
        parts.push(
            `pri${k}:{n=${s.count} elementsTotal=${s.elementsTotal} max=${s.maxElements} sampleOff=${s.sampleOffset}}`,
        );
    }
    console.error(`  ${label} dummySummary bucket=${bucket}: ${parts.join(" ")}`);
}

function describeTerrainCommandLevelDiff(
    tsCmdBucketIndices: Int32Array,
    tsCmdElements: Int32Array,
    cacheCmdBucketIndices: Int32Array,
    cacheCmdElements: Int32Array,
): string | undefined {
    const tsTerrainCmds: number[] = [];
    const cacheTerrainCmds: number[] = [];
    for (let i = 0; i < tsCmdBucketIndices.length; i++) {
        if ((tsCmdBucketIndices[i] | 0) === 0) {
            tsTerrainCmds.push(tsCmdElements[i] | 0);
        }
    }
    for (let i = 0; i < cacheCmdBucketIndices.length; i++) {
        if ((cacheCmdBucketIndices[i] | 0) === 0) {
            cacheTerrainCmds.push(cacheCmdElements[i] | 0);
        }
    }
    const levels = Math.max(tsTerrainCmds.length, cacheTerrainCmds.length);
    if (levels <= 0) {
        return undefined;
    }
    const parts: string[] = [];
    for (let level = 0; level < levels; level++) {
        const tsElements = level < tsTerrainCmds.length ? tsTerrainCmds[level] : 0;
        const cacheElements = level < cacheTerrainCmds.length ? cacheTerrainCmds[level] : 0;
        if (tsElements !== cacheElements) {
            parts.push(
                `L${level}: ts=${tsElements} cache=${cacheElements} delta=${
                    cacheElements - tsElements
                }`,
            );
        }
    }
    if (parts.length === 0) {
        return "all-levels-match";
    }
    return parts.join("; ");
}

function describeFirstCommandStreamArrayMismatch(
    tsInput: {
        cmdBucketIndices: Int32Array;
        cmdOffsets: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    tsPayload: SdMapData,
    cacheArrays: {
        cmdBucketIndices: Int32Array;
        cmdOffsets: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
        vertices: Uint8Array;
        indices: Int32Array;
    },
): string | undefined {
    const fields: ReadonlyArray<
        | "cmdBucketIndices"
        | "cmdOffsets"
        | "cmdElements"
        | "cmdInstanceCounts"
        | "cmdPackedInstances"
    > = [
        "cmdBucketIndices",
        "cmdOffsets",
        "cmdElements",
        "cmdInstanceCounts",
        "cmdPackedInstances",
    ];
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const idx = firstArrayMismatchIndex(tsInput[field], cacheArrays[field]);
        if (idx >= 0) {
            const a = idx < tsInput[field].length ? tsInput[field][idx] | 0 : undefined;
            const b = idx < cacheArrays[field].length ? cacheArrays[field][idx] | 0 : undefined;
            return `${field}[${idx}] ts=${a ?? "<end>"} cache=${b ?? "<end>"}`;
        }
    }

    const verticesIdx = firstArrayMismatchIndex(tsPayload.vertices, cacheArrays.vertices);
    if (verticesIdx >= 0) {
        const a =
            verticesIdx < tsPayload.vertices.length
                ? tsPayload.vertices[verticesIdx] | 0
                : undefined;
        const b =
            verticesIdx < cacheArrays.vertices.length
                ? cacheArrays.vertices[verticesIdx] | 0
                : undefined;
        return `vertices[${verticesIdx}] ts=${a ?? "<end>"} cache=${b ?? "<end>"}`;
    }

    const indicesIdx = firstArrayMismatchIndex(tsPayload.indices, cacheArrays.indices);
    if (indicesIdx >= 0) {
        const a =
            indicesIdx < tsPayload.indices.length ? tsPayload.indices[indicesIdx] | 0 : undefined;
        const b =
            indicesIdx < cacheArrays.indices.length
                ? cacheArrays.indices[indicesIdx] | 0
                : undefined;
        return `indices[${indicesIdx}] ts=${a ?? "<end>"} cache=${b ?? "<end>"}`;
    }

    return undefined;
}

function describeFirstHeightMismatch(expected: Int16Array, actual: Int16Array): string {
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
        if ((expected[i] | 0) !== (actual[i] | 0)) {
            return `idx=${i} expected=${expected[i] | 0} actual=${actual[i] | 0}`;
        }
    }
    if (expected.length !== actual.length) {
        return `length expected=${expected.length} actual=${actual.length}`;
    }
    return "none";
}

function describeFirstByteMismatch(expected: Uint8Array, actual: Uint8Array): string {
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
        if ((expected[i] | 0) !== (actual[i] | 0)) {
            return `idx=${i} expected=${expected[i] | 0} actual=${actual[i] | 0}`;
        }
    }
    if (expected.length !== actual.length) {
        return `length expected=${expected.length} actual=${actual.length}`;
    }
    return "none";
}

function describeFirstI32Mismatch(expected: Int32Array, actual: Int32Array): string {
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
        if ((expected[i] | 0) !== (actual[i] | 0)) {
            return `idx=${i} expected=${expected[i] | 0} actual=${actual[i] | 0}`;
        }
    }
    if (expected.length !== actual.length) {
        return `length expected=${expected.length} actual=${actual.length}`;
    }
    return "none";
}

type PackedVertexStats = Readonly<{
    vertexCount: number;
    texturedCount: number;
    hslZeroCount: number;
    hslMin: number;
    hslMax: number;
    alphaMin: number;
    alphaMax: number;
    topTextureIds: ReadonlyArray<Readonly<[number, number]>>;
}>;

type PackedIndexStats = Readonly<{
    indexCount: number;
    triangleCount: number;
    minIndex: number;
    maxIndex: number;
    oobIndexCount: number;
    degenerateTriangleCount: number;
    mod3: number;
}>;

function summarizePackedVertices(bytes: Uint8Array): PackedVertexStats {
    const vertexCount = (bytes.length / 16) | 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const textureCounts = new Map<number, number>();

    let texturedCount = 0;
    let hslZeroCount = 0;
    let hslMin = 0x7fffffff;
    let hslMax = -0x7fffffff;
    let alphaMin = 0xff;
    let alphaMax = 0;

    for (let i = 0; i < vertexCount; i++) {
        const off = (i * 16) | 0;
        const v1 = view.getUint32(off + 4, true) >>> 0;
        const v2 = view.getUint32(off + 8, true) >>> 0;
        const v3 = view.getUint32(off + 12, true) >>> 0;

        const hsl = (v1 >>> 15) & 0xffff;
        if (hsl === 0) hslZeroCount++;
        if (hsl < hslMin) hslMin = hsl;
        if (hsl > hslMax) hslMax = hsl;

        const alpha = (v2 >>> 9) & 0xff;
        if (alpha < alphaMin) alphaMin = alpha;
        if (alpha > alphaMax) alphaMax = alpha;

        const isTextured = (v1 >>> 31) & 0x1;
        if (!isTextured) continue;
        texturedCount++;

        const texBits =
            ((hsl >>> 7) & 0x1ff) | (((v2 >>> 5) & 0x1) << 9) | (((v3 >>> 19) & 0x1) << 10);
        const textureId1Based = (texBits + 1) | 0;
        textureCounts.set(textureId1Based, (textureCounts.get(textureId1Based) ?? 0) + 1);
    }

    const topTextureIds = [...textureCounts.entries()]
        .sort((a, b) => (b[1] | 0) - (a[1] | 0))
        .slice(0, 12);

    if (vertexCount === 0) {
        hslMin = 0;
        hslMax = 0;
        alphaMin = 0;
        alphaMax = 0;
    }

    return {
        vertexCount,
        texturedCount,
        hslZeroCount,
        hslMin,
        hslMax,
        alphaMin,
        alphaMax,
        topTextureIds,
    };
}

function summarizeIndices(indices: Int32Array, vertexCount: number): PackedIndexStats {
    const indexCount = indices.length | 0;
    const mod3 = indexCount % 3;
    const triangleCount = Math.floor(indexCount / 3) | 0;

    let minIndex = 0x7fffffff;
    let maxIndex = -0x7fffffff;
    let oobIndexCount = 0;
    let degenerateTriangleCount = 0;

    for (let i = 0; i < indexCount; i++) {
        const idx = indices[i] | 0;
        if (idx < minIndex) minIndex = idx;
        if (idx > maxIndex) maxIndex = idx;
        if (idx < 0 || idx >= (vertexCount | 0)) {
            oobIndexCount++;
        }
    }

    for (let t = 0; t < triangleCount; t++) {
        const i0 = indices[t * 3 + 0] | 0;
        const i1 = indices[t * 3 + 1] | 0;
        const i2 = indices[t * 3 + 2] | 0;
        if (i0 === i1 || i1 === i2 || i0 === i2) {
            degenerateTriangleCount++;
        }
    }

    if (indexCount === 0) {
        minIndex = 0;
        maxIndex = 0;
    }

    return {
        indexCount,
        triangleCount,
        minIndex,
        maxIndex,
        oobIndexCount,
        degenerateTriangleCount,
        mod3,
    };
}

type PackedVertexPos = Readonly<{ x: number; y: number; z: number }>;
type PackedVertexDebug = Readonly<{
    x: number;
    y: number;
    z: number;
    hsl: number;
    isTextured: number;
    textureId: number;
    textureId1: number;
    hasBlend: number;
    blend: number;
    alpha: number;
    priority: number;
    u: number;
    v: number;
}>;

function decodePackedVertexPos(bytes: Uint8Array, vertexIndex: number): PackedVertexPos {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const off = (vertexIndex * 16) | 0;
    const v0 = view.getUint32(off + 0, true) >>> 0;
    const v1 = view.getUint32(off + 4, true) >>> 0;
    const v2 = view.getUint32(off + 8, true) >>> 0;

    const x = (((v0 >>> 17) & 0x7fff) - 0x4000) | 0;
    const y = -(((v1 >>> 0) & 0x7fff) - 0x4000) | 0;
    const z = (((v2 >>> 17) & 0x7fff) - 0x4000) | 0;
    return { x, y, z };
}

function decodePackedVertexDebug(bytes: Uint8Array, vertexIndex: number): PackedVertexDebug {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const off = (vertexIndex * 16) | 0;
    const v0 = view.getUint32(off + 0, true) >>> 0;
    const v1 = view.getUint32(off + 4, true) >>> 0;
    const v2 = view.getUint32(off + 8, true) >>> 0;
    const v3 = view.getUint32(off + 12, true) >>> 0;
    const hsl = (v1 >>> 15) & 0xffff;
    const isTextured = (v1 >>> 31) & 0x1;
    const textureIdBits =
        ((hsl >>> 7) & 0x1ff) | (((v2 >>> 5) & 0x1) << 9) | (((v3 >>> 19) & 0x1) << 10);
    const textureId1Bits = ((v3 >>> 0) & 0x3ff) | (((v3 >>> 20) & 0x1) << 10);
    const hasBlend = (v3 >>> 10) & 0x1;
    const blend = (v3 >>> 11) & 0xff;
    const alpha = (v2 >>> 9) & 0xff;
    const priority = (v2 >>> 6) & 0x7;
    const uPacked = (((v0 >>> 11) & 0x3f) | ((v2 & 0x1f) << 6)) & 0x7ff;
    const vPacked = (v0 & 0x7ff) >>> 0;
    const u = 16 - uPacked / 64;
    const v = 16 - vPacked / 64;
    return {
        x: (((v0 >>> 17) & 0x7fff) - 0x4000) | 0,
        y: -(((v1 >>> 0) & 0x7fff) - 0x4000) | 0,
        z: (((v2 >>> 17) & 0x7fff) - 0x4000) | 0,
        hsl,
        isTextured,
        textureId: isTextured ? (textureIdBits + 1) | 0 : -1,
        textureId1: hasBlend ? (textureId1Bits + 1) | 0 : -1,
        hasBlend,
        blend,
        alpha,
        priority,
        u,
        v,
    };
}

function summarizePackedVertexAtPosition(
    vertices: Uint8Array,
    target: Readonly<{ x: number; y: number; z: number }>,
): Readonly<{ total: number; byHsl: Array<Readonly<{ hsl: number; count: number }>> }> {
    const vertexCount = Math.floor(vertices.length / 16) | 0;
    const byHsl = new Map<number, number>();
    let total = 0;
    for (let i = 0; i < vertexCount; i++) {
        const v = decodePackedVertexDebug(vertices, i);
        if (
            (v.x | 0) !== (target.x | 0) ||
            (v.y | 0) !== (target.y | 0) ||
            (v.z | 0) !== (target.z | 0)
        ) {
            continue;
        }
        total++;
        byHsl.set(v.hsl | 0, ((byHsl.get(v.hsl | 0) ?? 0) + 1) | 0);
    }
    const sorted = [...byHsl.entries()]
        .map(([hsl, count]) => ({ hsl: hsl | 0, count: count | 0 }))
        .sort((a, b) => (b.count | 0) - (a.count | 0) || (a.hsl | 0) - (b.hsl | 0));
    return { total, byHsl: sorted };
}

function parseMismatchByteIndex(detail: string | undefined): number {
    if (!detail) {
        return -1;
    }
    const m = /idx=(\d+)/.exec(detail);
    return m ? Number(m[1]) | 0 : -1;
}

function tileFromVertexPos(
    pos: PackedVertexPos,
    borderTiles: number,
): Readonly<{ tileX: number; tileY: number }> {
    const vertexOffset = (borderTiles * -128) | 0;
    return {
        tileX: Math.floor((pos.x - vertexOffset) / 128) | 0,
        tileY: Math.floor((pos.z - vertexOffset) / 128) | 0,
    };
}

function toRuntimeOverlay(payload: SdMapData): RuntimeOverlay {
    return {
        heightMapTextureData: payload.heightMapTextureData,
        drawRanges: payload.drawRanges,
        modelInfoTextures: payload.modelInfoTextures,
    };
}

function createSceneBuildInput(
    deps: SdMapRenderDataTsBackendDeps,
    cacheInfo: CacheInfo,
    input: SdMapLoaderInput,
    runtimePath: "direct" | "cache",
): Record<string, unknown> {
    const borderSize = 6;
    const mapSquareSize = 64;
    const baseX = input.mapX * mapSquareSize - borderSize;
    const baseY = input.mapY * mapSquareSize - borderSize;
    const mapSize = mapSquareSize + borderSize * 2;
    return {
        baseX,
        baseY,
        sizeX: mapSize,
        sizeY: mapSize,
        smoothTerrain: input.smoothTerrain,
        locLoadType: 0,
        cacheGame: cacheInfo.game,
        cacheRevision: cacheInfo.revision,
        mapBytesProvider: deps.mapBytesProvider,
        locTypeLoader: deps.session.loaders.locTypeLoader,
        varProvider: deps.varProvider,
        varpValues: snapshotVarpValues(deps.varProvider),
        runtimePath,
    };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    setQuietMode(args.quiet);
    const cacheInfo = pickCache(loadCacheInfos(), args.cacheName);
    const loadedCache = loadCache(cacheInfo);

    const sessionResult = tryCreateCacheSession(loadedCache as any, new JSCompressionHandler());
    if (!sessionResult.ok) throw new Error(`Failed to create session for ${cacheInfo.name}`);
    const session = sessionResult.value;
    const loaders = session.loaders;

    const varProvider = new VarManagerProvider(session.varManager);
    const mapBytesProvider = new MapFileBytesProvider(
        loaders.mapFileLoader,
        loadedCache.xteas as any,
    );
    const locModelLoader = new LocModelLoader(
        loaders.locTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
        loaders.seqTypeLoader,
        loaders.seqFrameLoader,
        session.getSkeletalSeqLoader(),
    );
    const objModelLoader = new ObjModelLoader(
        loaders.objTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
    );
    const npcModelLoader = new NpcModelLoader(
        loaders.npcTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
        loaders.seqTypeLoader,
        loaders.seqFrameLoader,
        session.getSkeletalSeqLoader(),
        varProvider,
    );
    const sceneBuilder = new SceneBuilder(cacheInfo, {
        underlayTypeLoader: loaders.underlayTypeLoader,
        overlayTypeLoader: loaders.overlayTypeLoader,
        locTypeLoader: loaders.locTypeLoader,
        textureLoader: loaders.textureLoader,
        locModelLoader,
        varProvider,
    });
    const mapImageRenderer = new MapImageRenderer(
        loaders.textureLoader,
        loaders.locTypeLoader,
        loaders.mapScenes,
        loaders.mapFunctions,
    );

    const deps: SdMapRenderDataTsBackendDeps = {
        session,
        sceneBuilder,
        mapBytesProvider,
        locModelLoader,
        objModelLoader,
        npcModelLoader,
        mapImageRenderer,
        varProvider,
        objSpawns: [] as ObjSpawn[],
        npcSpawns: [] as NpcSpawn[],
    };
    const tsBackend = new SdMapRenderDataTsBackend(deps);

    const bridgeUrl = pathToFileURL(
        path.resolve(process.cwd(), "src/wasm/rs_map_render_backend_bridge.mjs"),
    ).href;
    const bridgeModule = (await import(bridgeUrl)) as Record<string, unknown>;
    const baseBridge = bridgeModule.mapRenderRuntimeBridge as RuntimeBridge;
    const bridge = { ...baseBridge, ...createScriptDebugWrappers() } as RuntimeBridge;
    if (
        !bridge ||
        typeof bridge.cacheSetBuildConfig !== "function" ||
        typeof bridge.cachePutBlobBatch !== "function" ||
        typeof bridge.cacheClearBlobDomain !== "function" ||
        typeof bridge.getLastMissingBlobEntries !== "function" ||
        typeof bridge.cacheSetVarps !== "function" ||
        typeof bridge.buildMapPacketFromCache !== "function" ||
        typeof bridge.getRuntimeCachedCommandStreamDigest !== "function" ||
        typeof bridge.getRuntimeCachedCommandStreamArrays !== "function"
    ) {
        throw new Error("mapRenderRuntimeBridge missing cache-v2 packet APIs");
    }
    if (!(await bridge.initRuntime())) {
        throw new Error("runtime bridge init failed");
    }
    const runtimeHandle =
        (typeof bridge.createRuntimeWithConfig === "function"
            ? await bridge.createRuntimeWithConfig({
                  cacheGame: cacheInfo.game,
                  cacheRevision: cacheInfo.revision,
                  sceneLevels: 4,
                  unitsTileHeightBasis: 128,
              })
            : typeof bridge.createRuntime === "function"
            ? await bridge.createRuntime()
            : undefined) ?? 0;
    if (runtimeHandle <= 0) throw new Error("failed to create runtime");
    const transparentTextureIds = collectTransparentTextureIdSet(
        sceneBuilder.services.textureLoader,
    );

    const squares =
        args.squares && args.squares.length > 0
            ? [...args.squares]
            : args.mode === "models-targeted"
            ? pickModelTargetSquares(
                  loaders.mapFileLoader.mapFileIndex,
                  mapBytesProvider,
                  args.limit,
              )
            : args.mode === "anim-maya-targeted"
            ? pickAnimMayaTargetSquares(
                  loaders.mapFileLoader.mapFileIndex,
                  mapBytesProvider,
                  {
                      locTypeLoader: loaders.locTypeLoader as any,
                      seqTypeLoader: loaders.seqTypeLoader as any,
                      varProvider,
                  },
                  args.limit,
              )
            : pickSquares(loaders.mapFileLoader.mapFileIndex, args.limit);
    if (squares.length <= 0) throw new Error("No map squares found");
    const profiles = resolveProfiles(args);
    logSummary(
        `map-render-runtime-cache-v2-parity: mode=${args.mode} profiles=${profiles
            .map((p) => p.name)
            .join(",")} squares=${
            args.summaryOnly
                ? `${squares.length} (summary-only)`
                : squares.map((s) => `${s.mapX}:${s.mapY}`).join(",")
        }`,
    );

    let totalMismatches = 0;
    for (const profile of profiles) {
        let mismatches = 0;
        const stageFailures = createStageFailureCounter();
        const stageFailuresGating = createStageFailureCounter();
        const stageFailureSquares = args.listFailingSquares ? createStageFailureSquareList() : undefined;
        const mismatchSquares: string[] | undefined = args.listFailingSquares ? [] : undefined;
        for (const square of squares) {
            const input: SdMapLoaderInput = {
                mapX: square.mapX,
                mapY: square.mapY,
                maxLevel: 3,
                loadObjs: profile.loadObjs,
                loadNpcs: profile.loadNpcs,
                loadLocs: profile.loadLocs,
                smoothTerrain: false,
                minimizeDrawCalls: false,
                loadedTextureIds: new Set<number>(),
            };
            const tsBridgeInput = await tsBackend.buildMapDataBridgeInput(input, {
                includeMinimapBlob: false,
                includeRuntimeCommandStreamInput: true,
                includeRuntimeSceneTileHeights: true,
                debugIncludeSceneCommandPlanDigest: args.stages === true,
                debugIncludeSceneCommandPlanOpsPacked: args.stages === true,
            });
            const tsData = tsBridgeInput.data;
            if (!tsData) {
                mismatches++;
                console.error(`missing ts map data at ${square.mapX},${square.mapY}`);
                continue;
            }

            bridge.resetRuntime(runtimeHandle);
            const sceneBuildInput = createByteDrivenSceneBuildInput(input, {
                mapBytesProvider,
                locTypeLoader: loaders.locTypeLoader,
                locModelLoader,
                seqTypeLoader: loaders.seqTypeLoader,
                seqFrameLoader: loaders.seqFrameLoader,
                skeletalSeqLoader: loaders.skeletalSeqLoader,
                textureLoader: loaders.textureLoader,
                underlayTypeLoader: loaders.underlayTypeLoader,
                overlayTypeLoader: loaders.overlayTypeLoader,
                varProvider,
                cacheGame: cacheInfo.game,
                cacheRevision: cacheInfo.revision,
            });
            // This digest is meaningful only after the cache inputs have been uploaded into the runtime.
            let cacheInputDigest: unknown = undefined;
            const cacheConfig =
                typeof bridge.debugGetRuntimeCacheConfig === "function"
                    ? await bridge.debugGetRuntimeCacheConfig(runtimeHandle)
                    : undefined;
            const cacheLoadedHeightHashBefore =
                typeof bridge.debugGetRuntimeLoadedHeightHash === "function"
                    ? await bridge.debugGetRuntimeLoadedHeightHash(runtimeHandle)
                    : undefined;
            const cacheSeedHashesBefore =
                typeof bridge.debugGetRuntimeMapInputHashes === "function"
                    ? await bridge.debugGetRuntimeMapInputHashes(runtimeHandle)
                    : undefined;
            const cacheCmdDigestBefore =
                await bridge.getRuntimeCachedCommandStreamDigest(runtimeHandle);
            const tsCmdDigest =
                tsBridgeInput.runtimeCommandStreamInput && tsData
                    ? digestTsRuntimeCommandStream(
                          tsBridgeInput.runtimeCommandStreamInput,
                          tsData,
                      )
                    : undefined;
            const tsPlanDigest =
                args.stages === true ? tsBridgeInput.debugSceneCommandPlanDigest : undefined;
            const tsPlanOpsPacked =
                args.stages === true ? tsBridgeInput.debugSceneCommandPlanOpsPacked : undefined;
            const tsBucketsDigest = undefined;
            const tsLocMergedDummyDigest =
                profile.loadLocs && tsBridgeInput.runtimeCommandStreamInput
                    ? computeTsLocMergedDummyDigest(tsBridgeInput.runtimeCommandStreamInput)
                    : undefined;
            const jsInputDigest = digestJsMapInput(sceneBuildInput);
            const request = buildRuntimeRequest(sceneBuildInput);
            const uploaded =
                !!request &&
                (await uploadRuntimeCacheForBuildRequest(
                    bridge,
                    runtimeHandle,
                    request,
                    sceneBuildInput,
                ));
            const cacheBlobStatsAfterUpload = undefined;
            cacheInputDigest =
                uploaded && typeof bridge.debugCollectCachedMapInputDigest === "function"
                    ? await bridge.debugCollectCachedMapInputDigest(runtimeHandle, sceneBuildInput)
                    : undefined;
            const packetRaw =
                uploaded && request
                    ? await bridge.buildMapPacketFromCache(runtimeHandle, request)
                    : undefined;
            const packet = packetRaw ? cloneRuntimePacketGeometry(packetRaw) : undefined;
            const cache = packetRaw ? runtimePacketToPayloadOverlay(packetRaw) : undefined;
            const cacheLoadedHeightHashAfter =
                typeof bridge.debugGetRuntimeLoadedHeightHash === "function"
                    ? await bridge.debugGetRuntimeLoadedHeightHash(runtimeHandle)
                    : undefined;
            const cacheSeedHashesAfter =
                typeof bridge.debugGetRuntimeMapInputHashes === "function"
                    ? await bridge.debugGetRuntimeMapInputHashes(runtimeHandle)
                    : undefined;
            const cacheCmdDigestAfter =
                await bridge.getRuntimeCachedCommandStreamDigest(runtimeHandle);
            const cacheCmdArraysAfter =
                await bridge.getRuntimeCachedCommandStreamArrays(runtimeHandle);
            const cacheLastBuildStats =
                typeof bridge.debugGetRuntimeLastBuildStats === "function"
                    ? await bridge.debugGetRuntimeLastBuildStats(runtimeHandle)
                    : undefined;
            const cacheLastCollectMapInputAfterBuild =
                typeof bridge.debugGetLastCollectMapInput === "function"
                    ? await bridge.debugGetLastCollectMapInput(runtimeHandle)
                    : undefined;
            const cacheLocPreMergeSignatures =
                typeof bridge.debugGetRuntimeLastLocPreMergeGroupKeySignatures === "function"
                    ? await bridge.debugGetRuntimeLastLocPreMergeGroupKeySignatures(runtimeHandle)
                    : undefined;
            const cacheLocPreMergeEntriesPacked =
                typeof bridge.debugGetRuntimeLastLocPreMergeGroupKeyEntriesPacked === "function"
                    ? await bridge.debugGetRuntimeLastLocPreMergeGroupKeyEntriesPacked(
                          runtimeHandle,
                      )
                    : undefined;
            const cacheLocMergeDecisionEntriesPacked =
                typeof bridge.debugGetRuntimeLastLocMergeDecisionEntriesPacked === "function"
                    ? await bridge.debugGetRuntimeLastLocMergeDecisionEntriesPacked(runtimeHandle)
                    : undefined;
            const cacheLocMergeEmitEntriesPacked =
                typeof bridge.debugGetRuntimeLastLocMergeEmitEntriesPacked === "function"
                    ? await bridge.debugGetRuntimeLastLocMergeEmitEntriesPacked(runtimeHandle)
                    : undefined;
            const cacheLocMergeNormalsTraceEntriesPacked =
                typeof bridge.debugGetRuntimeLastLocMergeNormalsTraceEntriesPacked === "function"
                    ? await bridge.debugGetRuntimeLastLocMergeNormalsTraceEntriesPacked(
                          runtimeHandle,
                      )
                    : undefined;
            const cacheCommandProvenancePacked =
                typeof bridge.debugGetRuntimeLastCommandProvenancePacked === "function"
                    ? await bridge.debugGetRuntimeLastCommandProvenancePacked(runtimeHandle)
                    : undefined;
            const runtimeCommandProvenanceEntries = parseRuntimeCommandProvenanceEntriesPacked(
                cacheCommandProvenancePacked,
            );
            const cacheSceneCommandPlanOpProvenancePacked =
                typeof bridge.debugGetRuntimeLastSceneCommandPlanOpProvenancePacked === "function"
                    ? await bridge.debugGetRuntimeLastSceneCommandPlanOpProvenancePacked(
                          runtimeHandle,
                      )
                    : undefined;
            const tsLocStageDigests =
                profile.loadLocs && cacheLastBuildStats
                    ? computeTsLocStageDigests(
                          sceneBuilder,
                          mapBytesProvider,
                          sceneBuildInput,
                          input.maxLevel,
                          loaders.modelLoader,
                      )
                    : undefined;
            const tsLocVariantStageDigest = tsLocStageDigests?.variant;
            const tsLocVariantDropDigest = tsLocStageDigests?.variantDrop;
            const tsLocPreMergeGroupKeyDigest = tsLocStageDigests?.preMergeGroupKey;
            const tsLocPreMergeSignatureEntries = tsLocStageDigests?.preMergeSignatureEntries;
            if (!cache || !packet) {
                const failure =
                    typeof (bridge as any).debugGetLastBuildFailure === "function"
                        ? await (bridge as any).debugGetLastBuildFailure(runtimeHandle)
                        : undefined;
                if (failure) {
                    console.warn("[map-render-backend] lastBuildFailure", failure);
                }
                const collectMapInput =
                    typeof (bridge as any).debugGetLastCollectMapInput === "function"
                        ? await (bridge as any).debugGetLastCollectMapInput(runtimeHandle)
                        : undefined;
                if (collectMapInput) {
                    console.warn("[map-render-backend] lastCollectMapInput", {
                        ...collectMapInput,
                        reasonName: describeCollectMapInputReason(collectMapInput.reason | 0),
                    });
                }
                const cmdStatus =
                    typeof (bridge as any).debugGetLastCommandStreamStatus === "function"
                        ? await (bridge as any).debugGetLastCommandStreamStatus(runtimeHandle)
                        : undefined;
                if (typeof cmdStatus === "number") {
                    console.warn("[map-render-backend] lastCommandStreamCoreStatus", cmdStatus);
                }
                const legacyModelState =
                    typeof (bridge as any).debugGetLastLegacyModelLoad === "function"
                        ? await (bridge as any).debugGetLastLegacyModelLoad(runtimeHandle)
                        : undefined;
                if (legacyModelState) {
                    console.warn("[map-render-backend] lastLegacyModelLoad", legacyModelState);
                }
                const missingType =
                    typeof (bridge as any).debugGetLastMissingType === "function"
                        ? await (bridge as any).debugGetLastMissingType(runtimeHandle)
                        : undefined;
                if (missingType) {
                    console.warn("[map-render-backend] lastMissingType", missingType);
                }
                // Scene-type init debugging was removed with the type-entry byte-provider path.
                // Packets are now deep-copied out of the wasm heap and released before returning.
                void packetRaw;
                mismatches++;
                console.error(`missing bridge packet/overlay at ${square.mapX},${square.mapY}`);
                continue;
            }
            const expected = digestPacketPayload(tsData);
            const cacheDigest = digestRuntimePacket(cache, packet);
            const mismatchKeys = (Object.keys(expected) as Array<keyof PacketDigest>).filter(
                (k) => expected[k] !== cacheDigest[k],
            );
            const packetStageResultBaseline = comparePacketDigests(tsData, cache, packet);

            const verticesDiffDetail = mismatchKeys.includes("vertices")
                ? tsData.vertices instanceof Uint8Array &&
                  packet.vertices instanceof Uint8Array
                    ? describeFirstByteMismatch(tsData.vertices, packet.vertices)
                    : `type ts=${String(
                          (tsData.vertices as any)?.constructor?.name,
                      )} cache=${String((packet.vertices as any)?.constructor?.name)}`
                : undefined;
            const indicesDiffDetail = mismatchKeys.includes("indices")
                ? tsData.indices instanceof Int32Array &&
                  packet.indices instanceof Int32Array
                    ? describeFirstI32Mismatch(tsData.indices, packet.indices)
                    : `type ts=${String(
                          (tsData.indices as any)?.constructor?.name,
                      )} cache=${String((packet.indices as any)?.constructor?.name)}`
                : undefined;

            let tsTerrainDigestStage: ReturnType<typeof summarizeTerrainGeometry> | undefined;
            let cacheTerrainDigestStage: unknown;
            let cacheTerrainGridStage:
                | {
                      levels: number;
                      width: number;
                      height: number;
                      border: number;
                      counts: Uint8Array;
                  }
                | undefined;
            let cacheSceneCommandPlanDigestStage: unknown;
            let cacheSceneCommandPlanOpsPackedStage: unknown;
            let cacheSceneBucketsDigestStage: unknown;
            let cacheLocRenderPlacementDigestStage: unknown;
            let tsSceneLightStageDigests: TsSceneLightStageDigests | undefined;
            let sceneLightStageResult: StageResult = { key: "sceneLightStage", ok: true };
            let sceneCommandPlanStageResult: StageResult = {
                key: "sceneCommandPlanStage",
                ok: true,
            };
            let sceneCommandPlanOpsStageResult: StageResult = {
                key: "sceneCommandPlanOpsStage",
                ok: true,
            };
            let sceneBucketsStageResult: StageResult = { key: "sceneBucketsStage", ok: true };
            let locRenderPlacementStageResult: StageResult = {
                key: "locRenderPlacementStage",
                ok: true,
            };
            let modelFacesStageResult: StageResult = { key: "modelFacesStage", ok: true };
            let planOnlySelfCheckStageResult: StageResult = {
                key: "planOnlySelfCheckStage",
                ok: true,
            };
            if (args.stages) {
                if (typeof bridge.debugGetRuntimeLastTerrainDigest === "function") {
                    try {
                        cacheTerrainDigestStage =
                            await bridge.debugGetRuntimeLastTerrainDigest(runtimeHandle);
                    } catch {
                        cacheTerrainDigestStage = undefined;
                    }
                }
                if (typeof bridge.debugGetRuntimeLastTerrainTileFaceCounts === "function") {
                    try {
                        cacheTerrainGridStage =
                            await bridge.debugGetRuntimeLastTerrainTileFaceCounts(runtimeHandle);
                    } catch {
                        cacheTerrainGridStage = undefined;
                    }
                }
                // Fetch runtime plan digests after a successful full build. These are used both for TS-vs-C++
                // stage parity (when TS emits the plan digest) and for the full-vs-plan-only self-check.
                if (packetRaw) {
                    if (typeof bridge.debugGetRuntimeLastSceneCommandPlanDigest === "function") {
                        try {
                            cacheSceneCommandPlanDigestStage =
                                await bridge.debugGetRuntimeLastSceneCommandPlanDigest(
                                    runtimeHandle,
                                );
                        } catch {
                            cacheSceneCommandPlanDigestStage = undefined;
                        }
                    }
                    if (typeof bridge.debugGetRuntimeLastSceneCommandPlanOpsPacked === "function") {
                        try {
                            cacheSceneCommandPlanOpsPackedStage =
                                await bridge.debugGetRuntimeLastSceneCommandPlanOpsPacked(
                                    runtimeHandle,
                                );
                        } catch {
                            cacheSceneCommandPlanOpsPackedStage = undefined;
                        }
                    }
                }
                if (tsPlanDigest) {
                    if (cacheSceneCommandPlanDigestStage !== undefined) {
                        sceneCommandPlanStageResult = compareSceneCommandPlanStageDigests(
                            tsPlanDigest,
                            cacheSceneCommandPlanDigestStage,
                        );
                    } else {
                        sceneCommandPlanStageResult = {
                            key: "sceneCommandPlanStage",
                            ok: false,
                            detail: "missing-cache-scene-command-plan-digest",
                        };
                    }
                }
                if (tsPlanOpsPacked) {
                    if (cacheSceneCommandPlanOpsPackedStage !== undefined) {
                        sceneCommandPlanOpsStageResult = compareSceneCommandPlanOpsPackedStage(
                            tsPlanOpsPacked,
                            cacheSceneCommandPlanOpsPackedStage,
                        );
                    } else {
                        sceneCommandPlanOpsStageResult = {
                            key: "sceneCommandPlanOpsStage",
                            ok: false,
                            detail: "missing-cache-scene-command-plan-ops",
                        };
                    }
                }
                // sceneBucketsStage: ts runtimeCommandBucketsInput was removed.
                if (typeof bridge.debugGetRuntimeLastLocRenderPlacementDigest === "function") {
                    try {
                        cacheLocRenderPlacementDigestStage =
                            await bridge.debugGetRuntimeLastLocRenderPlacementDigest(runtimeHandle);
                    } catch {
                        cacheLocRenderPlacementDigestStage = undefined;
                    }
                    if (profile.loadLocs) {
                        locRenderPlacementStageResult = compareLocRenderPlacementStageDigests(
                            tsLocStageDigests?.renderPlacement,
                            cacheLocRenderPlacementDigestStage,
                        );
                        if (!locRenderPlacementStageResult.ok) {
                            let cacheEntries: Int32Array | undefined;
                            if (
                                typeof bridge.debugGetRuntimeLastLocRenderPlacementEntriesPacked ===
                                "function"
                            ) {
                                try {
                                    cacheEntries =
                                        await bridge.debugGetRuntimeLastLocRenderPlacementEntriesPacked(
                                            runtimeHandle,
                                        );
                                } catch {
                                    cacheEntries = undefined;
                                }
                            }
                            const diff = diffLocRenderPlacementEntriesPacked(
                                tsLocStageDigests?.renderPlacementEntriesPacked,
                                cacheEntries,
                            );
                            const parts: string[] = [];
                            if (diff.missingInCache.length > 0) {
                                parts.push(`missingInCache=${diff.missingInCache.join(";")}`);
                            }
                            if (diff.extraInCache.length > 0) {
                                parts.push(`extraInCache=${diff.extraInCache.join(";")}`);
                            }
                            if (parts.length === 0) {
                                const firstPackedDiff =
                                    firstLocRenderPlacementEntriesPackedMismatch(
                                        tsLocStageDigests?.renderPlacementEntriesPacked,
                                        cacheEntries,
                                    );
                                if (firstPackedDiff) {
                                    parts.push(firstPackedDiff);
                                }
                            }
                            if (parts.length > 0) {
                                locRenderPlacementStageResult = {
                                    ...locRenderPlacementStageResult,
                                    detail: `${
                                        locRenderPlacementStageResult.detail ?? ""
                                    } ${parts.join(" ")}`.trim(),
                                };
                            }
                        }
                    }
                }
                if (profile.loadLocs) {
                    try {
                        modelFacesStageResult = await compareModelFacesStage(
                            runtimeHandle,
                            bridge,
                            tsLocStageDigests?.modelIdsUsed,
                            loaders.modelLoader,
                            transparentTextureIds,
                        );
                    } catch (e) {
                        modelFacesStageResult = {
                            key: "modelFacesStage",
                            ok: false,
                            detail: "exception: " + String(e),
                        };
                    }
                }
                if (profile.loadLocs) {
                    try {
                        tsSceneLightStageDigests = computeTsSceneLightStageDigests(
                            sceneBuilder,
                            mapBytesProvider,
                            sceneBuildInput,
                            input.maxLevel | 0,
                            profile.loadLocs,
                        );
                        sceneLightStageResult = compareSceneLightStageDigests(
                            tsSceneLightStageDigests,
                            cacheCmdArraysAfter,
                            profile.loadLocs,
                        );
                    } catch (e) {
                        sceneLightStageResult = {
                            key: "sceneLightStage",
                            ok: false,
                            detail: "exception: " + String(e),
                        };
                    }
                }
                try {
                    const borderSize = ((((sceneBuildInput.sizeX as number) | 0) - 64) / 2) | 0;
                    if (borderSize >= 0) {
                        const textureLoader = sceneBuilder.services.textureLoader;
                        const { textureIdIndexMap } = createSdTexturePacking(textureLoader);
                        const tsTerrainScene = buildSceneFromMapBytesProvider(
                            sceneBuilder,
                            mapBytesProvider,
                            (sceneBuildInput.baseX as number) | 0,
                            (sceneBuildInput.baseY as number) | 0,
                            (sceneBuildInput.sizeX as number) | 0,
                            (sceneBuildInput.sizeY as number) | 0,
                            !!sceneBuildInput.smoothTerrain,
                            profile.loadLocs ? LocLoadType.MODELS : LocLoadType.NO_MODELS,
                        );
                        tsTerrainDigestStage = summarizeTerrainGeometry(
                            tsTerrainScene,
                            borderSize,
                            input.maxLevel | 0,
                            textureIdIndexMap,
                        );

                        // When terrain digest mismatches, fetch the first few vertex records from both
                        // TS and wasm runtime to pinpoint the first differing field.
                        if (
                            typeof (bridge as any).debugGetRuntimeLastTerrainDigestSamplesPacked ===
                                "function" &&
                            tsTerrainDigestStage
                        ) {
                            try {
                                const canSetStart =
                                    typeof (bridge as any)
                                        .debugSetTerrainDigestSampleStartVertex === "function";
                                const starts = (() => {
                                    if (!canSetStart) {
                                        return [0];
                                    }
                                    // Dense coverage (step=512) to find the *first* field divergence without guessing
                                    // where in the tile scan it occurs. This does multiple rebuilds but only when
                                    // terrainDigestStage already mismatched.
                                    const total = tsTerrainDigestStage.verticesTotal | 0 || 0;
                                    const out: number[] = [];
                                    for (let s = 0; s < total; s += 512) {
                                        out.push(s | 0);
                                    }
                                    // Ensure we also cover the tail in case total isn't a multiple of 512.
                                    out.push(Math.max(0, (total - 512) | 0));
                                    // De-dup while preserving order.
                                    const seen = new Set<number>();
                                    return out.filter((v) => {
                                        if (seen.has(v)) return false;
                                        seen.add(v);
                                        return true;
                                    });
                                })();

                                for (let si = 0; si < starts.length; si++) {
                                    const start = starts[si] | 0;
                                    if (
                                        canSetStart &&
                                        request &&
                                        typeof bridge.buildMapPacketFromCache === "function"
                                    ) {
                                        await (
                                            bridge as any
                                        ).debugSetTerrainDigestSampleStartVertex(
                                            runtimeHandle,
                                            start,
                                        );
                                        // Rebuild so the runtime captures a different sample window.
                                        await bridge.buildMapPacketFromCache(
                                            runtimeHandle,
                                            request,
                                        );
                                    }

                                    const tsSamples = computeTerrainDigestSamplePackedFromTsDigest(
                                        tsTerrainScene,
                                        borderSize,
                                        input.maxLevel | 0,
                                        textureIdIndexMap,
                                        512,
                                        start,
                                    );
                                    const cacheSamples = await (
                                        bridge as any
                                    ).debugGetRuntimeLastTerrainDigestSamplesPacked(runtimeHandle);
                                    if (
                                        cacheSamples &&
                                        cacheSamples.stride === tsSamples.stride &&
                                        cacheSamples.packed.length > 0 &&
                                        tsSamples.packed.length > 0
                                    ) {
                                        const stride = tsSamples.stride | 0;
                                        const n = Math.min(
                                            tsSamples.count | 0,
                                            cacheSamples.count | 0,
                                            512,
                                        );
                                        let found = false;
                                        for (let i = 0; i < n; i++) {
                                            const base = i * stride;
                                            // Prefer a direct field mismatch (0..8) over the running-hash slot (9),
                                            // since hash mismatches alone can be caused by earlier divergences.
                                            for (let j = 0; j < 9 && j < stride; j++) {
                                                const a = tsSamples.packed[base + j] | 0;
                                                const b = cacheSamples.packed[base + j] | 0;
                                                if (a !== b) {
                                                    const tsRec = Array.from(
                                                        tsSamples.packed.slice(base, base + stride),
                                                    );
                                                    const cacheRec = Array.from(
                                                        cacheSamples.packed.slice(
                                                            base,
                                                            base + stride,
                                                        ),
                                                    );
                                                    console.log(
                                                        `[terrainDigestStage][sample-mismatch] start=${start} i=${i} j=${j} ts=${a} cache=${b}`,
                                                    );
                                                    console.log(
                                                        `  tsRec=${JSON.stringify(
                                                            tsRec,
                                                        )} cacheRec=${JSON.stringify(cacheRec)}`,
                                                    );
                                                    try {
                                                        if (
                                                            request &&
                                                            typeof (bridge as any)
                                                                .debugSetTerrainProbe ===
                                                                "function" &&
                                                            typeof (bridge as any)
                                                                .debugGetRuntimeLastTerrainProbe ===
                                                                "function" &&
                                                            typeof bridge.buildMapPacketFromCache ===
                                                                "function"
                                                        ) {
                                                            const vertexOffsetI =
                                                                ((borderSize | 0) * -128) | 0;
                                                            const vx =
                                                                (tsRec[0] | 0) - vertexOffsetI;
                                                            const vz =
                                                                (tsRec[2] | 0) - vertexOffsetI;
                                                            const gx = ((vx / 128) | 0) as number;
                                                            const gz = ((vz / 128) | 0) as number;
                                                            const candidates: Array<
                                                                [number, number]
                                                            > = [
                                                                [gx - 1, gz - 1],
                                                                [gx, gz],
                                                            ];
                                                            for (
                                                                let ci = 0;
                                                                ci < candidates.length;
                                                                ci++
                                                            ) {
                                                                const [tx, ty] = candidates[ci];
                                                                await (
                                                                    bridge as any
                                                                ).debugSetTerrainProbe(
                                                                    runtimeHandle,
                                                                    0,
                                                                    tx | 0,
                                                                    ty | 0,
                                                                );
                                                                await bridge.buildMapPacketFromCache(
                                                                    runtimeHandle,
                                                                    request,
                                                                );
                                                                const probe = await (
                                                                    bridge as any
                                                                ).debugGetRuntimeLastTerrainProbe(
                                                                    runtimeHandle,
                                                                );
                                                                if (probe && probe.hit) {
                                                                    console.log(
                                                                        `[terrainDigestStage][probe] level=${
                                                                            probe.level
                                                                        } tile=${probe.tileX},${
                                                                            probe.tileY
                                                                        } packed=${JSON.stringify(
                                                                            Array.from(
                                                                                probe.packed ?? [],
                                                                            ),
                                                                        )}`,
                                                                    );
                                                                    try {
                                                                        const lvl = (probe.level |
                                                                            0) as number;
                                                                        const tx = (probe.tileX |
                                                                            0) as number;
                                                                        const ty = (probe.tileY |
                                                                            0) as number;
                                                                        const packed =
                                                                            probe.packed ??
                                                                            new Int32Array();
                                                                        if (packed.length >= 24) {
                                                                            const occlW =
                                                                                packed[19] | 0;
                                                                            const occlS =
                                                                                packed[20] | 0;
                                                                            const occlE =
                                                                                packed[21] | 0;
                                                                            const occlN =
                                                                                packed[22] | 0;
                                                                            const occlC =
                                                                                packed[23] | 0;
                                                                            console.log(
                                                                                `[terrainDigestStage][probe-cpp] occl(W,S,E,N,C)=[${occlW},${occlS},${occlE},${occlN},${occlC}]`,
                                                                            );
                                                                        }
                                                                        // packed[24..31] are overlay base-HSL diagnostics.
                                                                        // packed[32..] are (optional) C++ occlusion-writer diagnostics for the east occlusion cell (occlE).
                                                                        if (
                                                                            packed.length >= 44 &&
                                                                            (packed[32] | 0) !== 0
                                                                        ) {
                                                                            const writerOriginalId =
                                                                                packed[33] | 0;
                                                                            const writerResolvedId =
                                                                                packed[34] | 0;
                                                                            const writerType =
                                                                                packed[35] | 0;
                                                                            const writerRot =
                                                                                packed[36] | 0;
                                                                            const writerTileX =
                                                                                packed[37] | 0;
                                                                            const writerTileY =
                                                                                packed[38] | 0;
                                                                            const writerSizeX =
                                                                                packed[39] | 0;
                                                                            const writerSizeY =
                                                                                packed[40] | 0;
                                                                            const writerIsEntity =
                                                                                packed[41] | 0;
                                                                            const writerStaticXzRadius =
                                                                                packed[42] | 0;
                                                                            const writerLightOccl =
                                                                                packed[43] | 0;
                                                                            const writerLevel =
                                                                                packed.length >= 45
                                                                                    ? packed[44] | 0
                                                                                    : -1;

                                                                            console.log(
                                                                                `[terrainDigestStage][probe-cpp-occE-writer] originalId=${writerOriginalId} resolvedId=${writerResolvedId} type=${writerType} rot=${writerRot} tile=${writerTileX},${writerTileY} size=${writerSizeX},${writerSizeY} isEntity=${writerIsEntity} staticXzRadius=${writerStaticXzRadius} lightOccl=${writerLightOccl} level=${writerLevel}`,
                                                                            );

                                                                            // Check whether TS scene actually added this loc to its tile set (best-effort).
                                                                            try {
                                                                                const tile = (
                                                                                    tsTerrainScene
                                                                                        .tiles?.[
                                                                                        lvl
                                                                                    ] as any
                                                                                )?.[writerTileX]?.[
                                                                                    writerTileY
                                                                                ];
                                                                                const locs: any[] =
                                                                                    Array.isArray(
                                                                                        tile?.locs,
                                                                                    )
                                                                                        ? tile.locs
                                                                                        : [];
                                                                                let matches = 0;
                                                                                let ctor =
                                                                                    "unknown";
                                                                                for (
                                                                                    let i = 0;
                                                                                    i < locs.length;
                                                                                    i++
                                                                                ) {
                                                                                    const loc =
                                                                                        locs[i];
                                                                                    if (
                                                                                        !loc ||
                                                                                        loc.tag ===
                                                                                            undefined
                                                                                    )
                                                                                        continue;
                                                                                    try {
                                                                                        const id =
                                                                                            getIdFromTag(
                                                                                                BigInt(
                                                                                                    loc.tag,
                                                                                                ),
                                                                                            );
                                                                                        if (
                                                                                            (id |
                                                                                                0) ===
                                                                                            (writerOriginalId |
                                                                                                0)
                                                                                        ) {
                                                                                            matches++;
                                                                                            ctor =
                                                                                                (loc
                                                                                                    .entity
                                                                                                    ?.constructor
                                                                                                    ?.name as
                                                                                                    | string
                                                                                                    | undefined) ??
                                                                                                "unknown";
                                                                                        }
                                                                                    } catch {}
                                                                                }
                                                                                console.log(
                                                                                    `[terrainDigestStage][probe-ts-occE-writer-tile] tile=${writerTileX},${writerTileY} locsLen=${
                                                                                        locs.length |
                                                                                        0
                                                                                    } idMatches=${
                                                                                        matches | 0
                                                                                    } entityCtor=${ctor}`,
                                                                                );
                                                                                if (
                                                                                    (matches |
                                                                                        0) ===
                                                                                    0
                                                                                ) {
                                                                                    // If TS didn't add this loc at the exact tile, try to find it elsewhere
                                                                                    // to distinguish "decode/offset bug" from "missing model so TS skipped".
                                                                                    const found: Array<{
                                                                                        level: number;
                                                                                        tileX: number;
                                                                                        tileY: number;
                                                                                        ctor: string;
                                                                                    }> = [];
                                                                                    try {
                                                                                        for (
                                                                                            let sl = 0;
                                                                                            sl < 4;
                                                                                            sl++
                                                                                        ) {
                                                                                            const plane: any =
                                                                                                (
                                                                                                    tsTerrainScene.tiles as any
                                                                                                )?.[
                                                                                                    sl
                                                                                                ];
                                                                                            if (
                                                                                                !plane
                                                                                            )
                                                                                                continue;
                                                                                            for (
                                                                                                let sx = 0;
                                                                                                sx <
                                                                                                plane.length;
                                                                                                sx++
                                                                                            ) {
                                                                                                const col: any =
                                                                                                    plane[
                                                                                                        sx
                                                                                                    ];
                                                                                                if (
                                                                                                    !col
                                                                                                )
                                                                                                    continue;
                                                                                                for (
                                                                                                    let sy = 0;
                                                                                                    sy <
                                                                                                    col.length;
                                                                                                    sy++
                                                                                                ) {
                                                                                                    const t: any =
                                                                                                        col[
                                                                                                            sy
                                                                                                        ];
                                                                                                    const ls: any[] =
                                                                                                        Array.isArray(
                                                                                                            t?.locs,
                                                                                                        )
                                                                                                            ? t.locs
                                                                                                            : [];
                                                                                                    if (
                                                                                                        ls.length ===
                                                                                                        0
                                                                                                    )
                                                                                                        continue;
                                                                                                    let hit =
                                                                                                        false;
                                                                                                    for (
                                                                                                        let i = 0;
                                                                                                        i <
                                                                                                        ls.length;
                                                                                                        i++
                                                                                                    ) {
                                                                                                        const loc =
                                                                                                            ls[
                                                                                                                i
                                                                                                            ];
                                                                                                        if (
                                                                                                            !loc ||
                                                                                                            loc.tag ===
                                                                                                                undefined
                                                                                                        )
                                                                                                            continue;
                                                                                                        try {
                                                                                                            const id =
                                                                                                                getIdFromTag(
                                                                                                                    BigInt(
                                                                                                                        loc.tag,
                                                                                                                    ),
                                                                                                                ) |
                                                                                                                0;
                                                                                                            if (
                                                                                                                (id |
                                                                                                                    0) ===
                                                                                                                (writerOriginalId |
                                                                                                                    0)
                                                                                                            ) {
                                                                                                                found.push(
                                                                                                                    {
                                                                                                                        level: sl,
                                                                                                                        tileX: sx,
                                                                                                                        tileY: sy,
                                                                                                                        ctor:
                                                                                                                            (loc
                                                                                                                                .entity
                                                                                                                                ?.constructor
                                                                                                                                ?.name as
                                                                                                                                | string
                                                                                                                                | undefined) ??
                                                                                                                            "unknown",
                                                                                                                    },
                                                                                                                );
                                                                                                                hit =
                                                                                                                    true;
                                                                                                                break;
                                                                                                            }
                                                                                                        } catch {}
                                                                                                    }
                                                                                                    if (
                                                                                                        hit &&
                                                                                                        found.length >=
                                                                                                            5
                                                                                                    ) {
                                                                                                        break;
                                                                                                    }
                                                                                                }
                                                                                                if (
                                                                                                    found.length >=
                                                                                                    5
                                                                                                )
                                                                                                    break;
                                                                                            }
                                                                                            if (
                                                                                                found.length >=
                                                                                                5
                                                                                            )
                                                                                                break;
                                                                                        }
                                                                                    } catch {}
                                                                                    if (
                                                                                        found.length >
                                                                                        0
                                                                                    ) {
                                                                                        console.log(
                                                                                            `[terrainDigestStage][probe-ts-occE-writer-find] id=${writerOriginalId} hits=${JSON.stringify(
                                                                                                found,
                                                                                            )}`,
                                                                                        );
                                                                                    } else {
                                                                                        console.log(
                                                                                            `[terrainDigestStage][probe-ts-occE-writer-find] id=${writerOriginalId} hits=[]`,
                                                                                        );
                                                                                    }
                                                                                }
                                                                            } catch (e) {
                                                                                console.log(
                                                                                    `[terrainDigestStage][probe-ts-occE-writer-tile] tile=${writerTileX},${writerTileY} error=${String(
                                                                                        e,
                                                                                    )}`,
                                                                                );
                                                                            }
                                                                        }
                                                                        const smooth =
                                                                            !!sceneBuildInput.smoothTerrain;
                                                                        const blended =
                                                                            sceneBuilder.blendUnderlays(
                                                                                tsTerrainScene,
                                                                                lvl,
                                                                            );
                                                                        const lights =
                                                                            tsTerrainScene.calculateTileLights(
                                                                                lvl,
                                                                            );

                                                                        const blendSw =
                                                                            (blended[tx]?.[ty] ??
                                                                                -1) | 0;
                                                                        let blendSe =
                                                                            (blended[tx + 1]?.[
                                                                                ty
                                                                            ] ?? -1) | 0;
                                                                        let blendNe =
                                                                            (blended[tx + 1]?.[
                                                                                ty + 1
                                                                            ] ?? -1) | 0;
                                                                        let blendNw =
                                                                            (blended[tx]?.[
                                                                                ty + 1
                                                                            ] ?? -1) | 0;
                                                                        if (
                                                                            !smooth ||
                                                                            blendSe === -1
                                                                        )
                                                                            blendSe = blendSw;
                                                                        if (
                                                                            !smooth ||
                                                                            blendNe === -1
                                                                        )
                                                                            blendNe = blendSw;
                                                                        if (
                                                                            !smooth ||
                                                                            blendNw === -1
                                                                        )
                                                                            blendNw = blendSw;

                                                                        const lightSw =
                                                                            (lights[tx]?.[ty] ??
                                                                                0) | 0;
                                                                        const lightSe =
                                                                            (lights[tx + 1]?.[ty] ??
                                                                                0) | 0;
                                                                        const lightNe =
                                                                            (lights[tx + 1]?.[
                                                                                ty + 1
                                                                            ] ?? 0) | 0;
                                                                        const lightNw =
                                                                            (lights[tx]?.[ty + 1] ??
                                                                                0) | 0;

                                                                        const adjustUnderlayLight =
                                                                            (
                                                                                hsl: number,
                                                                                light: number,
                                                                            ): number => {
                                                                                if (
                                                                                    (hsl | 0) ===
                                                                                    -1
                                                                                )
                                                                                    return 12345678;
                                                                                const numerator =
                                                                                    ((hsl | 0) &
                                                                                        127) *
                                                                                    (light | 0);
                                                                                let l =
                                                                                    (numerator >>
                                                                                        7) |
                                                                                    0;
                                                                                if (l < 2) l = 2;
                                                                                else if (l > 126)
                                                                                    l = 126;
                                                                                return (
                                                                                    (((hsl | 0) &
                                                                                        0xff80) +
                                                                                        l) |
                                                                                    0
                                                                                );
                                                                            };
                                                                        const uSw =
                                                                            adjustUnderlayLight(
                                                                                blendSw,
                                                                                lightSw,
                                                                            );
                                                                        const uSe =
                                                                            adjustUnderlayLight(
                                                                                blendSe,
                                                                                lightSe,
                                                                            );
                                                                        const uNe =
                                                                            adjustUnderlayLight(
                                                                                blendNe,
                                                                                lightNe,
                                                                            );
                                                                        const uNw =
                                                                            adjustUnderlayLight(
                                                                                blendNw,
                                                                                lightNw,
                                                                            );

                                                                        // Sanity: make sure TS and wasm are probing the same tile.
                                                                        // If these disagree, the underlying terrain bytes mapping or scene build bounds
                                                                        // are off (not just lighting/material logic).
                                                                        const tsUnderlayRaw =
                                                                            (tsTerrainScene.tileUnderlays?.[lvl]?.[
                                                                                tx
                                                                            ]?.[ty] ?? -999) | 0;
                                                                        const tsOverlayRaw =
                                                                            (tsTerrainScene.tileOverlays?.[lvl]?.[
                                                                                tx
                                                                            ]?.[ty] ?? -999) | 0;
                                                                        const tsShapeRaw =
                                                                            (tsTerrainScene.tileShapes?.[lvl]?.[
                                                                                tx
                                                                            ]?.[ty] ?? -999) | 0;
                                                                        const tsRotRaw =
                                                                            (tsTerrainScene.tileRotations?.[lvl]?.[
                                                                                tx
                                                                            ]?.[ty] ?? -999) | 0;
                                                                        const worldTileX =
                                                                            (((sceneBuildInput.baseX as number) | 0) +
                                                                                (tx | 0)) |
                                                                            0;
                                                                        const worldTileY =
                                                                            (((sceneBuildInput.baseY as number) | 0) +
                                                                                (ty | 0)) |
                                                                            0;
                                                                        const worldMapX =
                                                                            Math.floor(worldTileX / 64) | 0;
                                                                        const worldMapY =
                                                                            Math.floor(worldTileY / 64) | 0;
                                                                        const localX =
                                                                            (worldTileX - worldMapX * 64) | 0;
                                                                        const localY =
                                                                            (worldTileY - worldMapY * 64) | 0;
                                                                        console.log(
                                                                            `[terrainDigestStage][probe-ts-raw] lvl=${lvl} tile=${tx},${ty} world=${worldTileX},${worldTileY} map=${worldMapX},${worldMapY} local=${localX},${localY} underlayRaw=${tsUnderlayRaw} overlayRaw=${tsOverlayRaw} shape=${tsShapeRaw} rot=${tsRotRaw}`,
                                                                        );

                                                                        try {
                                                                            const decode =
                                                                                (bridge as any)
                                                                                    .debugDecodeCachedTerrainCell;
                                                                            if (typeof decode === "function") {
                                                                                const cell = (await decode(
                                                                                    runtimeHandle,
                                                                                    worldMapX,
                                                                                    worldMapY,
                                                                                    lvl,
                                                                                    localX,
                                                                                    localY,
                                                                                )) as any;
                                                                                console.log(
                                                                                    `[terrainDigestStage][probe-cache-cell] map=${worldMapX},${worldMapY} local=${localX},${localY} lvl=${lvl} ok=${!!cell?.ok} newFormat=${!!cell?.newFormat} bytesLen=${cell?.terrainBytesLength | 0} underlayRaw=${cell?.underlayRaw | 0} overlayRaw=${cell?.overlayRaw | 0} shape=${cell?.shape | 0} rot=${cell?.rotation | 0} flags=${cell?.renderFlags | 0} height=${cell?.height | 0}`,
                                                                                );
                                                                            }
                                                                        } catch (e) {
                                                                            console.log(
                                                                                `[terrainDigestStage][probe-cache-cell] failed: ${String(
                                                                                    e,
                                                                                )}`,
                                                                            );
                                                                        }

                                                                        console.log(
                                                                            `[terrainDigestStage][probe-ts] blend=[${blendSw},${blendSe},${blendNe},${blendNw}] light=[${lightSw},${lightSe},${lightNe},${lightNw}] underlayHsl=[${uSw},${uSe},${uNe},${uNw}]`,
                                                                        );

                                                                        // Also compute and log the exact light components for the NE light cell (tx+1,ty+1),
                                                                        // so we can attribute mismatches to height deltas vs occlusion.
                                                                        const heights =
                                                                            tsTerrainScene
                                                                                .tileHeights[lvl];
                                                                        const occ =
                                                                            tsTerrainScene
                                                                                .tileLightOcclusions[
                                                                                lvl
                                                                            ];
                                                                        const cellX = (tx + 1) | 0;
                                                                        const cellY = (ty + 1) | 0;
                                                                        const occW =
                                                                            (occ[cellX - 1]?.[
                                                                                cellY
                                                                            ] ?? 0) | 0;
                                                                        const occS =
                                                                            (occ[cellX]?.[
                                                                                cellY - 1
                                                                            ] ?? 0) | 0;
                                                                        const occE =
                                                                            (occ[cellX + 1]?.[
                                                                                cellY
                                                                            ] ?? 0) | 0;
                                                                        const occN =
                                                                            (occ[cellX]?.[
                                                                                cellY + 1
                                                                            ] ?? 0) | 0;
                                                                        const occC =
                                                                            (occ[cellX]?.[cellY] ??
                                                                                0) | 0;
                                                                        const lightOcclusion =
                                                                            ((occW >> 2) | 0) +
                                                                            ((occS >> 2) | 0) +
                                                                            ((occE >> 3) | 0) +
                                                                            ((occN >> 3) | 0) +
                                                                            ((occC >> 1) | 0);

                                                                        const heightDeltaX =
                                                                            (heights[cellX + 1]?.[
                                                                                cellY
                                                                            ] ?? 0) -
                                                                            (heights[cellX - 1]?.[
                                                                                cellY
                                                                            ] ?? 0);
                                                                        const heightDeltaY =
                                                                            (heights[cellX]?.[
                                                                                cellY + 1
                                                                            ] ?? 0) -
                                                                            (heights[cellX]?.[
                                                                                cellY - 1
                                                                            ] ?? 0);
                                                                        const HEIGHT_SCALE = 65536;
                                                                        const tileNormalLength =
                                                                            Math.trunc(
                                                                                Math.sqrt(
                                                                                    heightDeltaY *
                                                                                        heightDeltaY +
                                                                                        heightDeltaX *
                                                                                            heightDeltaX +
                                                                                        HEIGHT_SCALE,
                                                                                ),
                                                                            );
                                                                        const nx = Math.trunc(
                                                                            (heightDeltaX << 8) /
                                                                                tileNormalLength,
                                                                        );
                                                                        const ny = Math.trunc(
                                                                            HEIGHT_SCALE /
                                                                                tileNormalLength,
                                                                        );
                                                                        const nz = Math.trunc(
                                                                            (heightDeltaY << 8) /
                                                                                tileNormalLength,
                                                                        );

                                                                        const LIGHT_DIR_X = -50;
                                                                        const LIGHT_DIR_Y = -10;
                                                                        const LIGHT_DIR_Z = -50;
                                                                        const LIGHT_INTENSITY_BASE = 96;
                                                                        const LIGHT_INTENSITY_FACTOR = 768;
                                                                        const lightMagnitude =
                                                                            Math.trunc(
                                                                                Math.sqrt(
                                                                                    LIGHT_DIR_X *
                                                                                        LIGHT_DIR_X +
                                                                                        LIGHT_DIR_Y *
                                                                                            LIGHT_DIR_Y +
                                                                                        LIGHT_DIR_Z *
                                                                                            LIGHT_DIR_Z,
                                                                                ),
                                                                            );
                                                                        const lightIntensity =
                                                                            ((lightMagnitude *
                                                                                LIGHT_INTENSITY_FACTOR) >>
                                                                                8) |
                                                                            0;
                                                                        const dot =
                                                                            nx * LIGHT_DIR_X +
                                                                            ny * LIGHT_DIR_Y +
                                                                            nz * LIGHT_DIR_Z;
                                                                        const sunLight = Math.trunc(
                                                                            dot / lightIntensity +
                                                                                LIGHT_INTENSITY_BASE,
                                                                        );
                                                                        const shaded =
                                                                            (sunLight -
                                                                                lightOcclusion) |
                                                                            0;
                                                                        console.log(
                                                                            `[terrainDigestStage][probe-ts-ne] cell=${cellX},${cellY} heightDelta=[${heightDeltaX},${heightDeltaY}] tileNormalLength=${tileNormalLength} n=[${nx},${ny},${nz}] dot=${dot} sun=${sunLight} occl(W,S,E,N,C)=[${occW},${occS},${occE},${occN},${occC}] occlSum=${lightOcclusion} shaded=${shaded}`,
                                                                        );

                                                                        // Occlusion mismatch root-cause hunt: the NE light uses occE at (cellX+1,cellY).
                                                                        // List nearby locs that could have written that occlusion point and their computed occlusion value.
                                                                        const targetOccX =
                                                                            (cellX + 1) | 0;
                                                                        const targetOccY =
                                                                            cellY | 0;
                                                                        const seenTags =
                                                                            new Set<string>();
                                                                        const minX =
                                                                            Math.max(
                                                                                0,
                                                                                targetOccX - 4,
                                                                            ) | 0;
                                                                        const maxX =
                                                                            Math.min(
                                                                                tsTerrainScene.sizeX -
                                                                                    1,
                                                                                targetOccX + 4,
                                                                            ) | 0;
                                                                        const minY =
                                                                            Math.max(
                                                                                0,
                                                                                targetOccY - 4,
                                                                            ) | 0;
                                                                        const maxY =
                                                                            Math.min(
                                                                                tsTerrainScene.sizeY -
                                                                                    1,
                                                                                targetOccY + 4,
                                                                            ) | 0;
                                                                        const candidates: Array<{
                                                                            id: number;
                                                                            type: number;
                                                                            rotation: number;
                                                                            startX: number;
                                                                            startY: number;
                                                                            endX: number;
                                                                            endY: number;
                                                                            xzRadius: number | null;
                                                                            entityCtor: string;
                                                                            canMergeNormals: boolean;
                                                                            lightOcclusion: number;
                                                                            tag: string;
                                                                        }> = [];
                                                                        for (
                                                                            let sx = minX;
                                                                            sx <= maxX;
                                                                            sx++
                                                                        ) {
                                                                            for (
                                                                                let sy = minY;
                                                                                sy <= maxY;
                                                                                sy++
                                                                            ) {
                                                                                const tile =
                                                                                    tsTerrainScene
                                                                                        .tiles[lvl][
                                                                                        sx
                                                                                    ]?.[sy];
                                                                                if (!tile) continue;
                                                                                for (const loc of tile.locs) {
                                                                                    const tagStr =
                                                                                        String(
                                                                                            loc.tag,
                                                                                        );
                                                                                    if (
                                                                                        seenTags.has(
                                                                                            tagStr,
                                                                                        )
                                                                                    )
                                                                                        continue;
                                                                                    seenTags.add(
                                                                                        tagStr,
                                                                                    );
                                                                                    const startX =
                                                                                        loc.startX |
                                                                                        0;
                                                                                    const startY =
                                                                                        loc.startY |
                                                                                        0;
                                                                                    const endX =
                                                                                        loc.endX |
                                                                                        0;
                                                                                    const endY =
                                                                                        loc.endY |
                                                                                        0;
                                                                                    // Loc occlusion writes range [start..end+1] on each axis.
                                                                                    const writesOcc =
                                                                                        startX <=
                                                                                            targetOccX &&
                                                                                        targetOccX <=
                                                                                            endX +
                                                                                                1 &&
                                                                                        startY <=
                                                                                            targetOccY &&
                                                                                        targetOccY <=
                                                                                            endY +
                                                                                                1;
                                                                                    if (!writesOcc)
                                                                                        continue;

                                                                                    const id =
                                                                                        getIdFromTag(
                                                                                            loc.tag,
                                                                                        );
                                                                                    const type =
                                                                                        getLocPlacementType(
                                                                                            loc.flags,
                                                                                        ) | 0;
                                                                                    const rotation =
                                                                                        getLocPlacementRotation(
                                                                                            loc.flags,
                                                                                        ) | 0;
                                                                                    const xzRadius =
                                                                                        loc.entity.tryGetXZRadius();
                                                                                    const entityCtor =
                                                                                        (
                                                                                            loc.entity as any
                                                                                        )
                                                                                            ?.constructor
                                                                                            ?.name ??
                                                                                        typeof loc.entity;
                                                                                    const canMergeNormals =
                                                                                        !!(
                                                                                            loc.entity as any
                                                                                        )?.canMergeNormals?.();
                                                                                    let lightOcc = 15;
                                                                                    if (
                                                                                        xzRadius !==
                                                                                        null
                                                                                    ) {
                                                                                        lightOcc =
                                                                                            Math.trunc(
                                                                                                xzRadius /
                                                                                                    4,
                                                                                            );
                                                                                        if (
                                                                                            lightOcc >
                                                                                            30
                                                                                        )
                                                                                            lightOcc = 30;
                                                                                    }
                                                                                    candidates.push(
                                                                                        {
                                                                                            id,
                                                                                            type,
                                                                                            rotation,
                                                                                            startX,
                                                                                            startY,
                                                                                            endX,
                                                                                            endY,
                                                                                            xzRadius,
                                                                                            entityCtor,
                                                                                            canMergeNormals,
                                                                                            lightOcclusion:
                                                                                                lightOcc,
                                                                                            tag: tagStr,
                                                                                        },
                                                                                    );
                                                                                }
                                                                            }
                                                                        }
                                                                        candidates.sort(
                                                                            (a, b) =>
                                                                                (b.lightOcclusion |
                                                                                    0) -
                                                                                (a.lightOcclusion |
                                                                                    0),
                                                                        );
                                                                        console.log(
                                                                            `[terrainDigestStage][probe-ts-occE] targetOcc=${targetOccX},${targetOccY} value=${occE} candidatesTop=${JSON.stringify(
                                                                                candidates.slice(
                                                                                    0,
                                                                                    12,
                                                                                ),
                                                                            )}`,
                                                                        );

                                                                        // Dump loc-type resolution for the top candidate, and compare to C++ loc-type decode.
                                                                        if (candidates.length > 0) {
                                                                            const top =
                                                                                candidates[0]!;
                                                                            try {
                                                                                const locTypeLoader =
                                                                                    sceneBuilder
                                                                                        .services
                                                                                        .locTypeLoader;
                                                                                const varProvider =
                                                                                    sceneBuilder
                                                                                        .services
                                                                                        .varProvider;
                                                                                const baseRes =
                                                                                    locTypeLoader.tryLoad(
                                                                                        top.id,
                                                                                    );
                                                                                const base =
                                                                                    baseRes.ok
                                                                                        ? (baseRes.value as any)
                                                                                        : undefined;
                                                                                const baseHadTransforms =
                                                                                    base?.transforms !==
                                                                                        undefined &&
                                                                                    base?.transforms !==
                                                                                        null;
                                                                                const resolved =
                                                                                    resolveLocTypeForPlacement(
                                                                                        top.id,
                                                                                        locTypeLoader,
                                                                                        varProvider,
                                                                                    ) as any;
                                                                                const resolvedHasTransforms =
                                                                                    Array.isArray(
                                                                                        resolved?.transforms,
                                                                                    )
                                                                                        ? ((resolved
                                                                                              .transforms
                                                                                              ?.length ??
                                                                                              0) |
                                                                                              0) >
                                                                                          0
                                                                                        : !!resolved?.transforms;
                                                                                let seqId =
                                                                                    (resolved?.seqId ??
                                                                                        -1) | 0;
                                                                                const randomSeqIds =
                                                                                    resolved?.randomSeqIds as
                                                                                        | ReadonlyArray<number>
                                                                                        | undefined;
                                                                                if (
                                                                                    seqId === -1 &&
                                                                                    Array.isArray(
                                                                                        randomSeqIds,
                                                                                    ) &&
                                                                                    randomSeqIds.length >
                                                                                        0
                                                                                ) {
                                                                                    seqId =
                                                                                        (randomSeqIds[0] ??
                                                                                            -1) | 0;
                                                                                }
                                                                                const sceneBuilderIsEntity =
                                                                                    seqId !== -1 ||
                                                                                    (resolved?.transforms !==
                                                                                        undefined &&
                                                                                        resolved?.transforms !==
                                                                                            null);
                                                                                const paritySourceIsEntity =
                                                                                    seqId !== -1 ||
                                                                                    baseHadTransforms ||
                                                                                    resolvedHasTransforms;
                                                                                console.log(
                                                                                    `[terrainDigestStage][probe-ts-locType] id=${
                                                                                        top.id
                                                                                    } resolvedId=${
                                                                                        (resolved?.id ??
                                                                                            -1) | 0
                                                                                    } mergeNormals=${!!resolved?.mergeNormals} clipped=${!!resolved?.clipped} baseHadTransforms=${baseHadTransforms} resolvedHasTransforms=${resolvedHasTransforms} seqId=${seqId} sceneBuilderIsEntity=${sceneBuilderIsEntity} paritySourceIsEntity=${paritySourceIsEntity} transformVarbit=${
                                                                                        (resolved?.transformVarbit ??
                                                                                            -1) | 0
                                                                                    } transformVarp=${
                                                                                        (resolved?.transformVarp ??
                                                                                            -1) | 0
                                                                                    } transformsLen=${
                                                                                        Array.isArray(
                                                                                            resolved?.transforms,
                                                                                        )
                                                                                            ? resolved
                                                                                                  .transforms
                                                                                                  .length |
                                                                                              0
                                                                                            : -1
                                                                                    }`,
                                                                                );
                                                                            } catch {
                                                                                // ignore
                                                                            }
                                                                            try {
                                                                                if (
                                                                                    typeof (
                                                                                        bridge as any
                                                                                    )
                                                                                        .debugDecodeRuntimeLocType ===
                                                                                    "function"
                                                                                ) {
                                                                                    const cpp =
                                                                                        await (
                                                                                            bridge as any
                                                                                        ).debugDecodeRuntimeLocType(
                                                                                            runtimeHandle,
                                                                                            top.id |
                                                                                                0,
                                                                                        );
                                                                                    if (cpp) {
                                                                                        console.log(
                                                                                            `[terrainDigestStage][probe-cpp-locType] ${JSON.stringify(
                                                                                                cpp,
                                                                                            )}`,
                                                                                        );
                                                                                    }
                                                                                }
                                                                            } catch {
                                                                                // ignore
                                                                            }
                                                                        }
                                                                    } catch {
                                                                        // ignore
                                                                    }
                                                                    break;
                                                                }
                                                            }
                                                        }
                                                    } catch {
                                                        // ignore
                                                    }
                                                    found = true;
                                                    break;
                                                }
                                            }
                                            if (!found && stride > 9) {
                                                const a = tsSamples.packed[base + 9] | 0;
                                                const b = cacheSamples.packed[base + 9] | 0;
                                                if (a !== b) {
                                                    const tsRec = Array.from(
                                                        tsSamples.packed.slice(base, base + stride),
                                                    );
                                                    const cacheRec = Array.from(
                                                        cacheSamples.packed.slice(
                                                            base,
                                                            base + stride,
                                                        ),
                                                    );
                                                    console.log(
                                                        `[terrainDigestStage][sample-mismatch] start=${start} i=${i} j=9 ts=${a} cache=${b}`,
                                                    );
                                                    console.log(
                                                        `  tsRec=${JSON.stringify(
                                                            tsRec,
                                                        )} cacheRec=${JSON.stringify(cacheRec)}`,
                                                    );
                                                    found = true;
                                                }
                                            }
                                            if (found) break;
                                        }
                                        if (found) break;
                                    }
                                }
                            } catch {
                                // ignore
                            }
                        }
                    }
                } catch {
                    tsTerrainDigestStage = undefined;
                }
                if (
                    request &&
                    packetRaw &&
                    cacheSceneCommandPlanDigestStage !== undefined &&
                    cacheSceneCommandPlanOpsPackedStage !== undefined &&
                    typeof bridge.debugBuildMapPlanFromCache === "function" &&
                    typeof bridge.debugGetRuntimeLastSceneCommandPlanDigest === "function" &&
                    typeof bridge.debugGetRuntimeLastSceneCommandPlanOpsPacked === "function"
                ) {
                    try {
                        const ok = await bridge.debugBuildMapPlanFromCache(runtimeHandle, request);
                        if (!ok) {
                            planOnlySelfCheckStageResult = {
                                key: "planOnlySelfCheckStage",
                                ok: false,
                                detail: "plan-only-build-failed",
                            };
                        } else {
                            const planOnlyDigest =
                                await bridge.debugGetRuntimeLastSceneCommandPlanDigest(
                                    runtimeHandle,
                                );
                            const planOnlyOps =
                                await bridge.debugGetRuntimeLastSceneCommandPlanOpsPacked(
                                    runtimeHandle,
                                );
                            const digestMatch =
                                JSON.stringify(planOnlyDigest) ===
                                JSON.stringify(cacheSceneCommandPlanDigestStage);
                            const opsMatch =
                                JSON.stringify(planOnlyOps) ===
                                JSON.stringify(cacheSceneCommandPlanOpsPackedStage);
                            planOnlySelfCheckStageResult =
                                digestMatch && opsMatch
                                    ? { key: "planOnlySelfCheckStage", ok: true }
                                    : {
                                          key: "planOnlySelfCheckStage",
                                          ok: false,
                                          detail: !digestMatch
                                              ? "digest-mismatch-vs-full-build"
                                              : "ops-mismatch-vs-full-build",
                                      };
                            if (
                                args.debugStage === "planOnlySelfCheckStage" &&
                                !planOnlySelfCheckStageResult.ok
                            ) {
                                console.log(
                                    `[planOnlySelfCheckStage][debug] square=${square.mapX}:${square.mapY} profile=${profile.name} detail=${planOnlySelfCheckStageResult.detail}`,
                                );
                                console.log(
                                    `[planOnlySelfCheckStage][debug] fullDigest=${JSON.stringify(
                                        cacheSceneCommandPlanDigestStage,
                                    )}`,
                                );
                                console.log(
                                    `[planOnlySelfCheckStage][debug] planOnlyDigest=${JSON.stringify(
                                        planOnlyDigest,
                                    )}`,
                                );
                                const fullPacked =
                                    cacheSceneCommandPlanOpsPackedStage &&
                                    typeof cacheSceneCommandPlanOpsPackedStage === "object"
                                        ? (cacheSceneCommandPlanOpsPackedStage as any).packed
                                        : undefined;
                                const planPacked =
                                    planOnlyOps && typeof planOnlyOps === "object"
                                        ? (planOnlyOps as any).packed
                                        : undefined;
                                if (fullPacked instanceof Int32Array && planPacked instanceof Int32Array) {
                                    const mismatch = describeFirstI32Mismatch(fullPacked, planPacked);
                                    console.log(
                                        `[planOnlySelfCheckStage][debug] opsPackedDiff: ${mismatch}`,
                                    );
                                    const m = mismatch.match(/idx=(\\d+)/);
                                    if (m) {
                                        const idx = Number(m[1]) | 0;
                                        const start = Math.max(0, idx - 8);
                                        const end = Math.min(fullPacked.length, idx + 8);
                                        console.log(
                                            `[planOnlySelfCheckStage][debug] fullOpsPacked[${start}..${end}]=${Array.from(
                                                fullPacked.slice(start, end),
                                            ).join(",")}`,
                                        );
                                        console.log(
                                            `[planOnlySelfCheckStage][debug] planOnlyOpsPacked[${start}..${end}]=${Array.from(
                                                planPacked.slice(start, end),
                                            ).join(",")}`,
                                        );
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        planOnlySelfCheckStageResult = {
                            key: "planOnlySelfCheckStage",
                            ok: false,
                            detail: "exception: " + String(e),
                        };
                    }
                }
            }

            const stageResults: StageResult[] = [
                compareInputDigests(jsInputDigest, cacheInputDigest),
                compareCommandDigests(tsCmdDigest, cacheCmdDigestAfter),
                packetStageResultBaseline,
                args.stages ? sceneLightStageResult : { key: "sceneLightStage", ok: true },
                args.stages && typeof bridge.debugGetRuntimeLastTerrainDigest === "function"
                    ? compareTerrainDigestStageDigests(
                          tsTerrainDigestStage,
                          cacheTerrainDigestStage,
                      )
                    : { key: "terrainDigestStage", ok: true },
                args.stages
                    ? sceneCommandPlanStageResult
                    : { key: "sceneCommandPlanStage", ok: true },
                args.stages
                    ? sceneCommandPlanOpsStageResult
                    : { key: "sceneCommandPlanOpsStage", ok: true },
                args.stages ? sceneBucketsStageResult : { key: "sceneBucketsStage", ok: true },
                args.stages
                    ? locRenderPlacementStageResult
                    : { key: "locRenderPlacementStage", ok: true },
                args.stages ? modelFacesStageResult : { key: "modelFacesStage", ok: true },
                profile.loadLocs
                    ? compareLocVariantStageDigests(
                          tsLocVariantStageDigest,
                          cacheLastBuildStats as Record<string, unknown> | undefined,
                      )
                    : { key: "locVariantStage", ok: true },
                profile.loadLocs
                    ? compareLocVariantDropDigests(
                          tsLocVariantDropDigest,
                          cacheLastBuildStats as Record<string, unknown> | undefined,
                      )
                    : { key: "locVariantDropStage", ok: true },
                profile.loadLocs
                    ? compareLocPreMergeGroupKeyDigests(
                          tsLocPreMergeGroupKeyDigest,
                          cacheLastBuildStats as Record<string, unknown> | undefined,
                      )
                    : { key: "locPreMergeGroupKeyStage", ok: true },
                profile.loadLocs
                    ? compareLocPreMergeSignatureDigests(
                          tsLocPreMergeSignatureEntries,
                          cacheLocPreMergeSignatures,
                          cacheLocPreMergeEntriesPacked,
                      )
                    : { key: "locPreMergeSignatureStage", ok: true },
                profile.loadLocs
                    ? compareLocMergeDummyDigests(
                          tsLocMergedDummyDigest,
                          cacheLastBuildStats as Record<string, unknown> | undefined,
                      )
                    : { key: "locMergeDummyStage", ok: true },
                args.stages
                    ? planOnlySelfCheckStageResult
                    : { key: "planOnlySelfCheckStage", ok: true },
            ];

            // Packets are now deep-copied out of the wasm heap and released before returning.
            void packetRaw;
            for (let i = 0; i < stageResults.length; i++) {
                const r = stageResults[i];
                if (!r.ok) {
                    stageFailures[r.key] = (stageFailures[r.key] | 0) + 1;
                    if (!NON_GATING_STAGE_KEYS.has(r.key)) {
                        stageFailuresGating[r.key] = (stageFailuresGating[r.key] | 0) + 1;
                    }
                    if (stageFailureSquares) {
                        stageFailureSquares[r.key].push(`${square.mapX}:${square.mapY}(${profile.name})`);
                    }
                }
            }
            if (args.stages) {
                const stageLine = stageResults
                    .map(
                        (r) =>
                            r.key +
                            "=" +
                            (r.ok ? "ok" : "fail(" + (r.detail ? r.detail : "unknown") + ")"),
                    )
                    .join(" ");
                console.log(
                    "stage-parity " +
                        profile.name +
                        " " +
                        square.mapX +
                        ":" +
                        square.mapY +
                        " " +
                        stageLine,
                );
            }
            if (mismatchKeys.length > 0) {
                mismatches++;
                if (mismatchSquares) {
                    mismatchSquares.push(
                        `${square.mapX}:${square.mapY}(${profile.name})[${mismatchKeys.join(",")}]`,
                    );
                }
                if (args.summaryOnly) {
                    continue;
                }
                console.error(
                    `cache-v2 mismatch profile=${profile.name} at ${square.mapX},${
                        square.mapY
                    } keys=${mismatchKeys.join(",")}`,
                );
                for (const key of mismatchKeys) {
                    console.error(`  ${key}: ts=${expected[key]} cache=${cacheDigest[key]}`);
                }
                console.error(
                    `  map-input digest js=${JSON.stringify(jsInputDigest)} cache=${JSON.stringify(
                        cacheInputDigest ?? null,
                    )}`,
                );
                if (cacheBlobStatsAfterUpload) {
                    console.error(
                        `  runtime blob-stats after upload: ${JSON.stringify(cacheBlobStatsAfterUpload)}`,
                    );
                }
                if (cacheLastCollectMapInputAfterBuild) {
                    console.error(
                        `  runtime last-collect-map-input: ${JSON.stringify(cacheLastCollectMapInputAfterBuild)}`,
                    );
                }
                if (cacheConfig) {
                    console.error(`  runtime cache-config: ${JSON.stringify(cacheConfig)}`);
                }
                if (tsPlanDigest) {
                    console.error(
                        `  ts scene-command-plan digest: ${JSON.stringify(tsPlanDigest)}`,
                    );
                }
                if (cacheSceneCommandPlanDigestStage) {
                    console.error(
                        `  cache scene-command-plan digest: ${JSON.stringify(
                            cacheSceneCommandPlanDigestStage,
                        )}`,
                    );
                }
                if (args.quiet) {
                    try {
                        const tsCmdInput = tsBridgeInput.runtimeCommandStreamInput;
                        const cacheCmdArrays = cacheCmdArraysAfter;
                        if (
                            tsCmdInput &&
                            cacheCmdArrays &&
                            cacheCmdArrays.cmdInstanceCounts instanceof Int32Array &&
                            cacheCmdArrays.cmdPackedInstances instanceof Int32Array
                        ) {
                            const firstArrayDiff = describeFirstCommandStreamArrayMismatch(
                                tsCmdInput,
                                tsData,
                                cacheCmdArrays,
                            );
                            if (firstArrayDiff) {
                                console.error(
                                    `  first runtime command-stream array diff: ${firstArrayDiff}`,
                                );
                                // In --quiet mode we normally stop after emitting a single pointer to the
                                // first divergent array entry. For vertex/element diffs, print a compact
                                // decoded view so we can map the byte mismatch back to a concrete field.
                                try {
                                    if (
                                        firstArrayDiff.startsWith("vertices[") &&
                                        tsData.vertices instanceof Uint8Array &&
                                        cacheCmdArrays.vertices instanceof Uint8Array &&
                                        tsData.indices instanceof Int32Array &&
                                        cacheCmdArrays.indices instanceof Int32Array
                                    ) {
                                        const m = /^vertices\[(\d+)\]/.exec(firstArrayDiff);
                                        const mismatchByteIndex = m ? (Number(m[1]) | 0) : -1;
                                        const vertexIndex =
                                            mismatchByteIndex >= 0
                                                ? (Math.floor(mismatchByteIndex / 16) | 0)
                                                : -1;
                                        if (
                                            vertexIndex >= 0 &&
                                            vertexIndex * 16 + 15 < tsData.vertices.length &&
                                            vertexIndex * 16 + 15 < cacheCmdArrays.vertices.length
                                        ) {
                                            const tsVertex = decodePackedVertexDebug(
                                                tsData.vertices,
                                                vertexIndex,
                                            );
                                            const cacheVertex = decodePackedVertexDebug(
                                                cacheCmdArrays.vertices,
                                                vertexIndex,
                                            );
                                            console.error(
                                                `  first vertex-byte mismatch -> vertex=${vertexIndex} ts=${JSON.stringify(
                                                    tsVertex,
                                                )} cache=${JSON.stringify(cacheVertex)}`,
                                            );

                                            const tsElem = tsData.indices.indexOf(vertexIndex);
                                            const cacheElem =
                                                cacheCmdArrays.indices.indexOf(vertexIndex);
                                            console.error(
                                                `  vertex mismatch index refs: ts=${
                                                    tsElem >= 0 ? tsElem : "<none>"
                                                } cache=${cacheElem >= 0 ? cacheElem : "<none>"}`,
                                            );

                                            const pickElem = tsElem >= 0 ? tsElem : cacheElem;
                                            if (pickElem >= 0) {
                                                const triStart = (pickElem - (pickElem % 3)) | 0;
                                                const dumpTri = (
                                                    tag: string,
                                                    vertices: Uint8Array,
                                                    indices: Int32Array,
                                                ): void => {
                                                    if (
                                                        triStart < 0 ||
                                                        triStart + 2 >= indices.length
                                                    ) {
                                                        return;
                                                    }
                                                    const ia = indices[triStart] | 0;
                                                    const ib = indices[triStart + 1] | 0;
                                                    const ic = indices[triStart + 2] | 0;
                                                    const decode = (vi: number): unknown => {
                                                        if (
                                                            vi < 0 ||
                                                            vi * 16 + 15 >= vertices.length
                                                        ) {
                                                            return { vi, ok: false };
                                                        }
                                                        const v = decodePackedVertexDebug(
                                                            vertices,
                                                            vi,
                                                        );
                                                        return {
                                                            vi,
                                                            x: v.x | 0,
                                                            y: v.y | 0,
                                                            z: v.z | 0,
                                                            hsl: v.hsl | 0,
                                                            lightness: (v.hsl & 127) | 0,
                                                            isTextured: v.isTextured | 0,
                                                            textureId: v.textureId | 0,
                                                            u: v.u,
                                                            v: v.v,
                                                        };
                                                    };
                                                    console.error(
                                                        `  tri@${tag} elem=${pickElem} triStart=${triStart} idx=[${ia},${ib},${ic}]` +
                                                            ` vA=${JSON.stringify(decode(ia))}` +
                                                            ` vB=${JSON.stringify(decode(ib))}` +
                                                            ` vC=${JSON.stringify(decode(ic))}`,
                                                    );
                                                };
                                                dumpTri(
                                                    "ts",
                                                    tsData.vertices,
                                                    tsData.indices,
                                                );
                                                dumpTri(
                                                    "cache",
                                                    cacheCmdArrays.vertices,
                                                    cacheCmdArrays.indices,
                                                );

                                                const elemIndex = pickElem | 0;
                                                const findCmdForElement = (
                                                    arr: typeof cacheCmdArrays,
                                                    elementIndex: number,
                                                ): { cmdIndex: number; bucket: number } | undefined => {
                                                    const ei = elementIndex | 0;
                                                    for (let ci = 0; ci < arr.cmdOffsets.length; ci++) {
                                                        const start = (arr.cmdOffsets[ci] | 0) >> 2;
                                                        const count = arr.cmdElements[ci] | 0;
                                                        if (count <= 0) continue;
                                                        const end = start + count;
                                                        if (ei >= start && ei < end) {
                                                            return {
                                                                cmdIndex: ci | 0,
                                                                bucket: arr.cmdBucketIndices[ci] | 0,
                                                            };
                                                        }
                                                    }
                                                    return undefined;
                                                };
                                                const cmdHit = findCmdForElement(
                                                    cacheCmdArrays,
                                                    elemIndex,
                                                );
                                                if (cmdHit) {
                                                    console.error(
                                                        `  vertex mismatch maps to cmdIndex=${cmdHit.cmdIndex} bucket=${cmdHit.bucket}`,
                                                    );
                                                    for (const line of summarizeRuntimeCommandProvenanceEntriesAtIndices(
                                                        runtimeCommandProvenanceEntries,
                                                        [cmdHit.cmdIndex],
                                                    )) {
                                                        console.error(line);
                                                    }
                                                    try {
                                                        const prov =
                                                            runtimeCommandProvenanceEntries?.[
                                                                cmdHit.cmdIndex
                                                            ];
                                                        const baseLocId =
                                                            (prov?.locTypeId ?? -1) | 0;
                                                        if (
                                                            baseLocId >= 0 &&
                                                            typeof bridge.debugDecodeRuntimeLocType ===
                                                                "function"
                                                        ) {
                                                            await summarizeRuntimeLocTypeDecodeDiff(
                                                                [baseLocId],
                                                                sceneBuilder,
                                                                bridge,
                                                                runtimeHandle,
                                                            );
                                                        }
                                                    } catch (e) {
                                                        console.error(
                                                            "  quiet loc-type decode debug failed: " +
                                                                String(e),
                                                        );
                                                    }

                                                    // Compare bilinear height sampling (TS vs C++) at the mismatched vertex coordinate.
                                                    try {
                                                        if (
                                                            typeof (bridge as any)
                                                                .debugSetWorldHeightProbe ===
                                                                "function" &&
                                                            typeof (bridge as any)
                                                                .debugGetRuntimeLastWorldHeightProbe ===
                                                                "function" &&
                                                            typeof bridge.buildMapPacketFromCache ===
                                                                "function" &&
                                                            request &&
                                                            tsCmdInput
                                                        ) {
                                                            const cacheInsts = collectCommandInstances(
                                                                cmdHit.cmdIndex,
                                                                cacheCmdArrays.cmdInstanceCounts,
                                                                cacheCmdArrays.cmdPackedInstances,
                                                            );
                                                            const level =
                                                                (cacheInsts?.[0]?.level ?? 0) | 0;
                                                            const probeX = tsVertex.x | 0;
                                                            const probeZ = tsVertex.z | 0;
                                                            await (bridge as any).debugSetWorldHeightProbe(
                                                                runtimeHandle,
                                                                level,
                                                                probeX,
                                                                probeZ,
                                                            );
                                                            await bridge.buildMapPacketFromCache(
                                                                runtimeHandle,
                                                                request,
                                                            );
                                                            const probe = await (
                                                                bridge as any
                                                            ).debugGetRuntimeLastWorldHeightProbe(
                                                                runtimeHandle,
                                                            );
                                                            console.error(
                                                                `  cpp world-height-probe level=${level} world=(${probeX},${probeZ}) -> ${JSON.stringify(
                                                                    probe,
                                                                )}`,
                                                            );

                                                            const baseX =
                                                                (sceneBuildInput.baseX as number) |
                                                                0;
                                                            const baseY =
                                                                (sceneBuildInput.baseY as number) |
                                                                0;
                                                            const sizeX =
                                                                (sceneBuildInput.sizeX as number) |
                                                                0;
                                                            const sizeY =
                                                                (sceneBuildInput.sizeY as number) |
                                                                0;
                                                            const smoothUnderlays =
                                                                !!sceneBuildInput.smoothTerrain;
                                                            const tsScene = buildSceneFromMapBytesProvider(
                                                                sceneBuilder,
                                                                mapBytesProvider,
                                                                baseX,
                                                                baseY,
                                                                sizeX,
                                                                sizeY,
                                                                smoothUnderlays,
                                                                LocLoadType.NO_MODELS,
                                                            );
                                                            const hTs =
                                                                tsScene.getHeightInterpolated(
                                                                    level,
                                                                    probeX,
                                                                    probeZ,
                                                                ) | 0;
                                                            console.error(
                                                                `  ts world-height level=${level} world=(${probeX},${probeZ}) -> ${hTs}`,
                                                            );
                                                            if (probe?.packed instanceof Int32Array) {
                                                                const p = probe.packed;
                                                                const tx = p[1] | 0;
                                                                const tz = p[2] | 0;
                                                                const h00 = p[5] | 0;
                                                                const h10 = p[6] | 0;
                                                                const h01 = p[7] | 0;
                                                                const h11 = p[8] | 0;
                                                                const hCpp = p[14] | 0;
                                                                const ts00 =
                                                                    tsScene.tileHeights[level]?.[tx]?.[
                                                                        tz
                                                                    ] ?? 0;
                                                                const ts10 =
                                                                    tsScene.tileHeights[level]?.[
                                                                        tx + 1
                                                                    ]?.[tz] ?? 0;
                                                                const ts01 =
                                                                    tsScene.tileHeights[level]?.[tx]?.[
                                                                        tz + 1
                                                                    ] ?? 0;
                                                                const ts11 =
                                                                    tsScene.tileHeights[level]?.[
                                                                        tx + 1
                                                                    ]?.[tz + 1] ?? 0;
                                                                console.error(
                                                                    `  height-corners tx=${tx} tz=${tz} ts=[${ts00},${ts10},${ts01},${ts11}] cpp=[${h00},${h10},${h01},${h11}] hTs=${hTs} hCpp=${hCpp}`,
                                                                );
                                                            }
                                                        }
                                                    } catch (e) {
                                                        console.error(
                                                            "  quiet world-height-probe debug failed: " +
                                                                String(e),
                                                        );
                                                    }

                                                    // Check whether the underlying model decode already diverges (base vertex Y mismatch).
                                                    try {
                                                        const prov2 =
                                                            runtimeCommandProvenanceEntries?.[
                                                                cmdHit.cmdIndex
                                                            ];
                                                        const locTypeId =
                                                            (prov2?.locTypeId ?? -1) | 0;
                                                        if (locTypeId < 0) {
                                                            // No loc provenance for this command; skip.
                                                            throw new Error("missing-loc-type-id");
                                                        }
                                                        const tsLoc =
                                                            sceneBuilder.services.locTypeLoader.tryLoad(
                                                                locTypeId,
                                                            );
                                                        let modelId = -1;
                                                        if (tsLoc.ok) {
                                                            const locType: any = tsLoc.value as any;
                                                            const models: unknown = locType.models;
                                                            const types: unknown = locType.types;
                                                            const placementType =
                                                                (prov2?.placementType ?? -1) | 0;
                                                            if (
                                                                Array.isArray(models) &&
                                                                models.length > 0 &&
                                                                placementType >= 0
                                                            ) {
                                                                let idx = 0;
                                                                if (Array.isArray(types)) {
                                                                    const found = types.findIndex(
                                                                        (t: any) =>
                                                                            (t | 0) ===
                                                                            (placementType | 0),
                                                                    );
                                                                    if (found >= 0) {
                                                                        idx = found | 0;
                                                                    }
                                                                }
                                                                const group = (models as any)[idx];
                                                                if (Array.isArray(group) && group.length > 0) {
                                                                    modelId = (group[0] ?? -1) | 0;
                                                                }
                                                            }
                                                        }
                                                        if (
                                                            modelId >= 0 &&
                                                            typeof bridge.debugGetRuntimeModelVerticesDigest ===
                                                                "function"
                                                        ) {
                                                            const tsModel =
                                                                loaders.modelLoader.tryGet(modelId);
                                                            const tsModelDigest =
                                                                tsModel instanceof ModelData
                                                                    ? digestTsModelVerticesFromModelData(
                                                                          tsModel,
                                                                      )
                                                                    : undefined;
                                                            const cppModelDigest =
                                                                await bridge.debugGetRuntimeModelVerticesDigest(
                                                                    runtimeHandle,
                                                                    modelId,
                                                                );
                                                            console.error(
                                                                `  model-vertices-digest id=${modelId} ts=${JSON.stringify(
                                                                    tsModelDigest,
                                                                )} cpp=${JSON.stringify(
                                                                    cppModelDigest,
                                                                )}`,
                                                            );
                                                            if (
                                                                tsModelDigest &&
                                                                cppModelDigest &&
                                                                (tsModelDigest.hash | 0) !==
                                                                    ((cppModelDigest as any).hash |
                                                                        0) &&
                                                                typeof bridge.debugGetRuntimeModelVerticesSample ===
                                                                    "function"
                                                            ) {
                                                                const cppSample =
                                                                    await bridge.debugGetRuntimeModelVerticesSample(
                                                                        runtimeHandle,
                                                                        modelId,
                                                                    );
                                                                const toTriplets = (
                                                                    xyz: ReadonlyArray<number>,
                                                                ): string => {
                                                                    const out: string[] = [];
                                                                    for (
                                                                        let i = 0;
                                                                        i + 2 < xyz.length;
                                                                        i += 3
                                                                    ) {
                                                                        out.push(
                                                                            `(${xyz[i] ?? 0},${
                                                                                xyz[i + 1] ?? 0
                                                                            },${xyz[i + 2] ?? 0})`,
                                                                        );
                                                                    }
                                                                    return `[${out.join(",")}]`;
                                                                };
                                                                const tsSample = (() => {
                                                                    if (
                                                                        !(tsModel instanceof ModelData)
                                                                    ) {
                                                                        return undefined;
                                                                    }
                                                                    const n = Math.min(
                                                                        32,
                                                                        tsModel.verticesX?.length ??
                                                                            0,
                                                                        tsModel.verticesY?.length ??
                                                                            0,
                                                                        tsModel.verticesZ?.length ??
                                                                            0,
                                                                    );
                                                                    const xyz: number[] = [];
                                                                    for (let i = 0; i < n; i++) {
                                                                        xyz.push(
                                                                            (tsModel.verticesX[i] ??
                                                                                0) | 0,
                                                                            (tsModel.verticesY[i] ??
                                                                                0) | 0,
                                                                            (tsModel.verticesZ[i] ??
                                                                                0) | 0,
                                                                        );
                                                                    }
                                                                    return {
                                                                        version:
                                                                            (tsModel as any).version |
                                                                            0,
                                                                        verticesCount:
                                                                            tsModel.verticesCount |
                                                                            0,
                                                                        usedVertexCount:
                                                                            tsModel.usedVertexCount |
                                                                            0,
                                                                        faceCount:
                                                                            tsModel.faceCount | 0,
                                                                        written: n | 0,
                                                                        xyzTriplets: toTriplets(xyz),
                                                                    };
                                                                })();
                                                                const cppSampleSummary = cppSample
                                                                    ? {
                                                                          version:
                                                                              cppSample.version | 0,
                                                                          verticesCount:
                                                                              cppSample.verticesCount |
                                                                              0,
                                                                          usedVertexCount:
                                                                              cppSample.usedVertexCount |
                                                                              0,
                                                                          faceCount:
                                                                              cppSample.faceCount | 0,
                                                                          written:
                                                                              cppSample.written | 0,
                                                                          xyzTriplets: toTriplets(
                                                                              Array.from(
                                                                                  cppSample.xyz,
                                                                              ),
                                                                          ),
                                                                      }
                                                                    : undefined;
                                                                console.error(
                                                                    `  model-vertices-sample id=${modelId} ts=${JSON.stringify(
                                                                        tsSample,
                                                                    )} cpp=${JSON.stringify(
                                                                        cppSampleSummary,
                                                                    )}`,
                                                                );

                                                                if (
                                                                    tsModel instanceof ModelData &&
                                                                    typeof (bridge as any)
                                                                        .debugGetRuntimeModelVerticesSampleRange ===
                                                                        "function"
                                                                ) {
                                                                    try {
                                                                        const vx =
                                                                            tsModel.verticesX ??
                                                                            new Int32Array(0);
                                                                        const vy =
                                                                            tsModel.verticesY ??
                                                                            new Int32Array(0);
                                                                        const vz =
                                                                            tsModel.verticesZ ??
                                                                            new Int32Array(0);
                                                                        const total = Math.min(
                                                                            vx.length | 0,
                                                                            vy.length | 0,
                                                                            vz.length | 0,
                                                                        );
                                                                        const step = 32;
                                                                        let found = false;
                                                                        for (
                                                                            let start = 0;
                                                                            start < total;
                                                                            start += step
                                                                        ) {
                                                                            const range = await (
                                                                                bridge as any
                                                                            ).debugGetRuntimeModelVerticesSampleRange(
                                                                                runtimeHandle,
                                                                                modelId,
                                                                                start,
                                                                            );
                                                                            if (
                                                                                !range ||
                                                                                !(range.xyz instanceof Int32Array)
                                                                            ) {
                                                                                break;
                                                                            }
                                                                            const written =
                                                                                range.written | 0;
                                                                            for (
                                                                                let i = 0;
                                                                                i < written;
                                                                                i++
                                                                            ) {
                                                                                const idx =
                                                                                    (start + i) |
                                                                                    0;
                                                                                if (idx >= total) {
                                                                                    break;
                                                                                }
                                                                                const ox =
                                                                                    range.xyz[
                                                                                        i * 3 + 0
                                                                                    ] | 0;
                                                                                const oy =
                                                                                    range.xyz[
                                                                                        i * 3 + 1
                                                                                    ] | 0;
                                                                                const oz =
                                                                                    range.xyz[
                                                                                        i * 3 + 2
                                                                                    ] | 0;
                                                                                const tx =
                                                                                    vx[idx] | 0;
                                                                                const ty =
                                                                                    vy[idx] | 0;
                                                                                const tz =
                                                                                    vz[idx] | 0;
                                                                                if (
                                                                                    ox !== tx ||
                                                                                    oy !== ty ||
                                                                                    oz !== tz
                                                                                ) {
                                                                                    console.error(
                                                                                        `  model-vertices firstMismatch idx=${idx} ts=(${tx},${ty},${tz}) cpp=(${ox},${oy},${oz})`,
                                                                                    );
                                                                                    found = true;
                                                                                    break;
                                                                                }
                                                                            }
                                                                            if (found) break;
                                                                        }
                                                                        if (!found) {
                                                                            console.error(
                                                                                "  model-vertices firstMismatch=<not-found-in-ranges>",
                                                                            );
                                                                        }
                                                                    } catch (e) {
                                                                        console.error(
                                                                            "  model-vertices range-scan failed: " +
                                                                                String(e),
                                                                        );
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    } catch (e) {
                                                        console.error(
                                                            "  quiet model-vertices debug failed: " +
                                                                String(e),
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    } else if (
                                        firstArrayDiff.startsWith("indices[") &&
                                        tsData.indices instanceof Int32Array &&
                                        cacheCmdArrays.indices instanceof Int32Array
                                    ) {
                                        const m = /^indices\[(\d+)\]/.exec(firstArrayDiff);
                                        const elementIndex = m ? (Number(m[1]) | 0) : -1;
                                        if (elementIndex >= 0) {
                                            const ts = tsData.indices[elementIndex] | 0;
                                            const cache = cacheCmdArrays.indices[elementIndex] | 0;
                                            console.error(
                                                `  first index mismatch -> elem=${elementIndex} ts=${ts} cache=${cache}`,
                                            );
                                        }
                                    }
                                } catch (e) {
                                    console.error(
                                        "  quiet vertex/index decode debug failed: " + String(e),
                                    );
                                }
                                const m = /^\w+\[(\d+)\]/.exec(firstArrayDiff);
                                if (m && firstArrayDiff.startsWith("cmdPackedInstances[")) {
                                    const idx = Number(m[1]) | 0;
                                    const instanceGlobal = (idx / 8) | 0;
                                    const lane = idx & 7;
                                    let base = 0;
                                    let cmdIndex = -1;
                                    let instanceInCmd = -1;
                                    for (
                                        let ci = 0;
                                        ci < tsCmdInput.cmdInstanceCounts.length;
                                        ci++
                                    ) {
                                        const ic = tsCmdInput.cmdInstanceCounts[ci] | 0;
                                        if (instanceGlobal < base + ic) {
                                            cmdIndex = ci;
                                            instanceInCmd = (instanceGlobal - base) | 0;
                                            break;
                                        }
                                        base += ic;
                                    }
                                    if (cmdIndex >= 0) {
                                        const laneNames = [
                                            "sceneX",
                                            "sceneZ",
                                            "heightOffset",
                                            "level",
                                            "contour",
                                            "priority",
                                            "interactType",
                                            "interactId",
                                        ];
                                        const laneName = laneNames[lane] ?? "lane" + String(lane);
                                        const tsInst = collectCommandInstances(
                                            cmdIndex,
                                            tsCmdInput.cmdInstanceCounts,
                                            tsCmdInput.cmdPackedInstances,
                                        )[instanceInCmd];
                                        const cacheInst = collectCommandInstances(
                                            cmdIndex,
                                            cacheCmdArrays.cmdInstanceCounts,
                                            cacheCmdArrays.cmdPackedInstances,
                                        )[instanceInCmd];
                                        console.error(
                                            "  packed-instance mismatch maps to instanceGlobal=" +
                                                instanceGlobal +
                                                " cmd=" +
                                                cmdIndex +
                                                " instInCmd=" +
                                                instanceInCmd +
                                                " field=" +
                                                laneName,
                                        );
                                        console.error(
                                            "  ts packed instance=" + JSON.stringify(tsInst),
                                        );
                                        console.error(
                                            "  cache packed instance=" + JSON.stringify(cacheInst),
                                        );
                                        // Include provenance for quick root-cause mapping without the full debug dump.
                                        for (const line of summarizeRuntimeCommandProvenanceEntriesAtIndices(
                                            runtimeCommandProvenanceEntries,
                                            [cmdIndex],
                                        )) {
                                            console.error(line);
                                        }
                                        try {
                                            const prov =
                                                runtimeCommandProvenanceEntries?.[cmdIndex];
                                            const baseLocId = (prov?.locTypeId ?? -1) | 0;
                                            if (
                                                baseLocId >= 0 &&
                                                typeof bridge.debugDecodeRuntimeLocType ===
                                                    "function"
                                            ) {
                                                const tsResolvedId = (tsInst?.interactId ?? -1) | 0;
                                                const ids: number[] = [baseLocId];
                                                if (
                                                    tsResolvedId >= 0 &&
                                                    tsResolvedId !== baseLocId
                                                ) {
                                                    ids.push(tsResolvedId);
                                                }
                                                await summarizeRuntimeLocTypeDecodeDiff(
                                                    ids,
                                                    sceneBuilder,
                                                    bridge,
                                                    runtimeHandle,
                                                );
                                            }
                                        } catch (e) {
                                            console.error(
                                                "  quiet loc-type decode debug failed: " +
                                                    String(e),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error("  quiet first-array-diff debug failed: " + String(e));
                    }
                    continue;
                }
                if (
                    !sceneCommandPlanOpsStageResult.ok &&
                    tsPlanOpsPacked &&
                    cacheSceneCommandPlanOpsPackedStage instanceof Int32Array
                ) {
                    const sharedFirst = describeFirstSceneCommandPlanOpsSharedMismatch(
                        tsPlanOpsPacked,
                        cacheSceneCommandPlanOpsPackedStage,
                    );
                    if (sharedFirst !== "none") {
                        console.error(
                            `  scene-command-plan-ops first shared mismatch: ${sharedFirst}`,
                        );
                        if (cacheSceneCommandPlanOpProvenancePacked instanceof Int32Array) {
                            const m = /opIndex=(\d+)/.exec(sharedFirst);
                            const opIndex = m ? Number(m[1]) | 0 : -1;
                            const stride = 8;
                            const base = opIndex * stride;
                            if (
                                opIndex >= 0 &&
                                base >= 0 &&
                                base + stride <= cacheSceneCommandPlanOpProvenancePacked.length
                            ) {
                                const srcKind =
                                    cacheSceneCommandPlanOpProvenancePacked[base + 0] | 0;
                                const typeId =
                                    cacheSceneCommandPlanOpProvenancePacked[base + 1] | 0;
                                const placementType =
                                    cacheSceneCommandPlanOpProvenancePacked[base + 2] | 0;
                                const rotation =
                                    cacheSceneCommandPlanOpProvenancePacked[base + 3] | 0;
                                const modelId =
                                    cacheSceneCommandPlanOpProvenancePacked[base + 4] | 0;
                                const modelIdsHash =
                                    cacheSceneCommandPlanOpProvenancePacked[base + 5] | 0;
                                const levelHint =
                                    cacheSceneCommandPlanOpProvenancePacked[base + 6] | 0;
                                const priHint =
                                    cacheSceneCommandPlanOpProvenancePacked[base + 7] | 0;
                                console.error(
                                    `  cache plan-op provenance opIndex=${opIndex} src=${srcKind} typeId=${typeId} placementType=${placementType} rot=${rotation} modelId=${modelId} modelIdsHash=${modelIdsHash} levelHint=${levelHint} priHint=${priHint}`,
                                );
                                if (
                                    srcKind === 1 &&
                                    typeId >= 0 &&
                                    placementType >= 0 &&
                                    rotation >= 0
                                ) {
                                    try {
                                        const locTypeResult = loaders.locTypeLoader.tryLoad(typeId);
                                        const locType = locTypeResult?.ok
                                            ? locTypeResult.value
                                            : undefined;
                                        if (locType) {
                                            if (!!(locType as any).mergeNormals) {
                                                const lt: any = locType as any;
                                                let modelCountHint = -1;
                                                if (
                                                    Array.isArray(lt.types) &&
                                                    Array.isArray(lt.models)
                                                ) {
                                                    const idx = lt.types.findIndex(
                                                        (t: number) => (t | 0) === placementType,
                                                    );
                                                    if (idx >= 0 && Array.isArray(lt.models[idx])) {
                                                        modelCountHint =
                                                            lt.models[idx].length | 0 ?? -1;
                                                    }
                                                } else if (
                                                    Array.isArray(lt.models) &&
                                                    Array.isArray(lt.models[0])
                                                ) {
                                                    modelCountHint = lt.models[0].length | 0 ?? -1;
                                                }
                                                console.error(
                                                    `  ts face-split locType=${typeId} <skip mergeNormals>`,
                                                );
                                                console.error(
                                                    `  ts locType=${typeId} contourGroundType=${
                                                        lt.contourGroundType | 0
                                                    } contourGroundParam=${
                                                        lt.contourGroundParam | 0
                                                    } size=${lt.sizeX | 0}x${
                                                        lt.sizeY | 0
                                                    } modelCountHint=${modelCountHint}`,
                                                );
                                                try {
                                                    const modelHashBuf = new ModelHashBuffer(5000);
                                                    const ent: unknown = locModelLoader.getModel(
                                                        locType as any,
                                                        placementType,
                                                        rotation,
                                                        undefined,
                                                    );
                                                    if (
                                                        ent &&
                                                        typeof (ent as any).light === "function"
                                                    ) {
                                                        const model = (ent as any).light(
                                                            loaders.textureLoader,
                                                            (ent as any).ambient,
                                                            (ent as any).contrast,
                                                            -50,
                                                            -10,
                                                            -50,
                                                        );
                                                        const soloHash =
                                                            getModelHash(modelHashBuf, model) | 0;
                                                        console.error(
                                                            `  ts mergeNormals solo-lit modelHash=${soloHash}`,
                                                        );
                                                    }
                                                } catch (e) {
                                                    console.error(
                                                        `  ts mergeNormals solo-lit hash failed: ${e}`,
                                                    );
                                                }
                                                try {
                                                    const runtimeTrace =
                                                        parseRuntimeLocMergeNormalsTraceEntriesPacked(
                                                            cacheLocMergeNormalsTraceEntriesPacked,
                                                        );
                                                    const tsTrace =
                                                        captureTsMergeNormalsTraceForSquare(
                                                            sceneBuilder,
                                                            mapBytesProvider,
                                                            sceneBuildInput,
                                                            [typeId | 0],
                                                        );
                                                    const traceLines =
                                                        summarizeTsVsRuntimeMergeNormalsTrace(
                                                            tsTrace,
                                                            runtimeTrace,
                                                            [typeId | 0],
                                                        );
                                                    for (let ti = 0; ti < traceLines.length; ti++) {
                                                        console.error(traceLines[ti]);
                                                    }
                                                } catch (e) {
                                                    console.error(
                                                        `  ts/runtime mergeNormals trace compare failed: ${e}`,
                                                    );
                                                }
                                            } else if (modelId >= 0) {
                                                const baseModelData =
                                                    loaders.modelLoader.tryGet(modelId);
                                                if (baseModelData) {
                                                    // Mirror + placement mutations: follow LocModelLoader.getLocModelData + diagonal rotate.
                                                    const hasResize =
                                                        ((locType as any).modelSizeX | 0) !== 128 ||
                                                        ((locType as any).modelSizeHeight | 0) !==
                                                            128 ||
                                                        ((locType as any).modelSizeY | 0) !== 128;
                                                    const hasOffset =
                                                        ((locType as any).offsetX | 0) !== 0 ||
                                                        ((locType as any).offsetHeight | 0) !== 0 ||
                                                        ((locType as any).offsetY | 0) !== 0;

                                                    const isMirrored =
                                                        !!(locType as any).isRotated ||
                                                        (placementType ===
                                                            LocModelType.WALL_CORNER &&
                                                            rotation > 3);

                                                    const md = ModelData.copyFrom(
                                                        baseModelData,
                                                        true,
                                                        rotation === 0 && !hasResize && !hasOffset,
                                                        !(locType as any).recolorFrom,
                                                        false,
                                                    );
                                                    if (isMirrored) {
                                                        md.mirror();
                                                    }
                                                    if (
                                                        placementType ===
                                                            LocModelType.WALL_DECORATION_INSIDE &&
                                                        rotation > 3
                                                    ) {
                                                        md.rotate(256);
                                                        md.translate(45, 0, -45);
                                                    }
                                                    const sceneRot = rotation & 3;
                                                    if (sceneRot === 1) md.rotate90();
                                                    else if (sceneRot === 2) md.rotate180();
                                                    else if (sceneRot === 3) md.rotate270();

                                                    const recolorFrom = (locType as any)
                                                        .recolorFrom as number[] | undefined;
                                                    const recolorTo = (locType as any).recolorTo as
                                                        | number[]
                                                        | undefined;
                                                    if (Array.isArray(recolorFrom)) {
                                                        const retexture =
                                                            (locType as any).cacheInfo?.game ===
                                                                0 /* Runescape */ &&
                                                            ((locType as any).cacheInfo?.revision |
                                                                0) <=
                                                                377;
                                                        for (
                                                            let i = 0;
                                                            i < recolorFrom.length;
                                                            i++
                                                        ) {
                                                            const from = recolorFrom[i] | 0;
                                                            const to = (recolorTo?.[i] ?? from) | 0;
                                                            md.recolor(from, to);
                                                            if (retexture) md.retexture(from, to);
                                                        }
                                                    }
                                                    const retextureFrom = (locType as any)
                                                        .retextureFrom as number[] | undefined;
                                                    const retextureTo = (locType as any)
                                                        .retextureTo as number[] | undefined;
                                                    if (Array.isArray(retextureFrom)) {
                                                        for (
                                                            let i = 0;
                                                            i < retextureFrom.length;
                                                            i++
                                                        ) {
                                                            const from = retextureFrom[i] | 0;
                                                            const to =
                                                                (retextureTo?.[i] ?? from) | 0;
                                                            md.retexture(from, to);
                                                        }
                                                    }
                                                    if (hasResize) {
                                                        md.resize(
                                                            (locType as any).modelSizeX | 0,
                                                            (locType as any).modelSizeHeight | 0,
                                                            (locType as any).modelSizeY | 0,
                                                        );
                                                    }
                                                    if (hasOffset) {
                                                        md.translate(
                                                            (locType as any).offsetX | 0,
                                                            (locType as any).offsetHeight | 0,
                                                            (locType as any).offsetY | 0,
                                                        );
                                                    }
                                                    if (
                                                        placementType === LocModelType.NORMAL &&
                                                        rotation > 3
                                                    ) {
                                                        md.rotate(256);
                                                    }

                                                    const model = md.light(
                                                        sceneBuilder.services.textureLoader,
                                                        ((locType as any).ambient | 0) + 64,
                                                        ((locType as any).contrast | 0) + 768,
                                                        -50,
                                                        -10,
                                                        -50,
                                                    );
                                                    const textureLoader =
                                                        sceneBuilder.services.textureLoader;
                                                    const { opaqueFaces, transparentFaces } =
                                                        splitModelFacesByTransparency(
                                                            textureLoader,
                                                            model,
                                                        );
                                                    const texCounts = new Map<number, number>();
                                                    for (
                                                        let i = 0;
                                                        i < transparentFaces.length;
                                                        i++
                                                    ) {
                                                        const t = transparentFaces[i].textureId | 0;
                                                        if (t !== -1) {
                                                            texCounts.set(
                                                                t,
                                                                (texCounts.get(t) ?? 0) + 1,
                                                            );
                                                        }
                                                    }
                                                    const topTex = [...texCounts.entries()]
                                                        .sort((a, b) => (b[1] | 0) - (a[1] | 0))
                                                        .slice(0, 6)
                                                        .map(([t, c]) => `${t}:${c}`)
                                                        .join(",");
                                                    console.error(
                                                        `  ts face-split(locModelData) locType=${typeId} modelId=${modelId} t=${placementType} r=${rotation} opaqueFaces=${
                                                            opaqueFaces.length | 0
                                                        } transparentFaces=${
                                                            transparentFaces.length | 0
                                                        } topTransparentTex=[${topTex}]`,
                                                    );
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        console.error("  ts face-split debug failed: " + String(e));
                                    }
                                }
                            }
                        }
                    }
                    const multisetDiff = diffSceneCommandPlanOpsPackedMultiset(
                        tsPlanOpsPacked,
                        cacheSceneCommandPlanOpsPackedStage,
                        24,
                    );
                    if (multisetDiff.length > 0) {
                        console.error(
                            `  scene-command-plan-ops multiset diff (top ${
                                multisetDiff.length
                            }): ${JSON.stringify(multisetDiff)}`,
                        );
                    }
                    const shapeMultisetDiff = diffSceneCommandPlanOpsPackedShapeMultiset(
                        tsPlanOpsPacked,
                        cacheSceneCommandPlanOpsPackedStage,
                        24,
                    );
                    if (shapeMultisetDiff.length > 0) {
                        console.error(
                            `  scene-command-plan-ops shape-diff (top ${
                                shapeMultisetDiff.length
                            }): ${JSON.stringify(shapeMultisetDiff)}`,
                        );
                    }
                }
                try {
                    const borderSize = ((((sceneBuildInput.sizeX as number) | 0) - 64) / 2) | 0;
                    if (borderSize >= 0) {
                        const textureLoader = sceneBuilder.services.textureLoader;
                        const { textureIdIndexMap } = createSdTexturePacking(textureLoader);
                        const tsTerrainScene = buildSceneFromMapBytesProvider(
                            sceneBuilder,
                            mapBytesProvider,
                            (sceneBuildInput.baseX as number) | 0,
                            (sceneBuildInput.baseY as number) | 0,
                            (sceneBuildInput.sizeX as number) | 0,
                            (sceneBuildInput.sizeY as number) | 0,
                            !!sceneBuildInput.smoothTerrain,
                            LocLoadType.NO_MODELS,
                        );
                        const tsTerrainDigest = summarizeTerrainGeometry(
                            tsTerrainScene,
                            borderSize,
                            input.maxLevel | 0,
                            textureIdIndexMap,
                        );
                        if (!args.quiet) {
                            console.error(
                                `  ts terrain-digest: ${JSON.stringify(tsTerrainDigest)}`,
                            );
                        }
                    }
                } catch (e) {
                    if (!args.quiet) {
                        console.error("  ts terrain-digest compute failed: " + String(e));
                    }
                }
                if (cacheTerrainDigestStage) {
                    if (!args.quiet) {
                        console.error(
                            `  runtime terrain-digest: ${JSON.stringify(cacheTerrainDigestStage)}`,
                        );
                    }
                }
                if (cacheLoadedHeightHashBefore !== undefined) {
                    if (!args.quiet) {
                        console.error(
                            `  runtime loaded-height-hash before=${cacheLoadedHeightHashBefore}`,
                        );
                    }
                }
                if (cacheLoadedHeightHashAfter !== undefined) {
                    if (!args.quiet) {
                        console.error(
                            `  runtime loaded-height-hash after=${cacheLoadedHeightHashAfter}`,
                        );
                    }
                }
                if (cacheSeedHashesBefore) {
                    if (!args.quiet) {
                        console.error(
                            `  runtime map-input-hashes before=${JSON.stringify(
                                cacheSeedHashesBefore,
                            )}`,
                        );
                    }
                }
                if (cacheSeedHashesAfter) {
                    if (!args.quiet) {
                        console.error(
                            `  runtime map-input-hashes after=${JSON.stringify(
                                cacheSeedHashesAfter,
                            )}`,
                        );
                    }
                }
                if (cacheCmdDigestBefore) {
                    if (!args.quiet) {
                        console.error(
                            `  runtime cmd-digest before=${JSON.stringify(cacheCmdDigestBefore)}`,
                        );
                    }
                }
                if (cacheCmdDigestAfter) {
                    if (!args.quiet) {
                        console.error(
                            `  runtime cmd-digest after=${JSON.stringify(cacheCmdDigestAfter)}`,
                        );
                    }
                }
                if (cacheLastBuildStats) {
                    if (!args.quiet) {
                        console.error(
                            `  runtime build-stats after=${JSON.stringify(cacheLastBuildStats)}`,
                        );
                        if (tsLocVariantStageDigest) {
                            console.error(
                                `  ts loc-variant-stage=${JSON.stringify(tsLocVariantStageDigest)}`,
                            );
                        }
                        if (tsLocPreMergeGroupKeyDigest) {
                            console.error(
                                `  ts loc-pre-merge-group-key-stage=${JSON.stringify(
                                    tsLocPreMergeGroupKeyDigest,
                                )}`,
                            );
                        }
                        if (tsLocMergedDummyDigest) {
                            console.error(
                                `  ts loc-merge-dummy-stage=${JSON.stringify(
                                    tsLocMergedDummyDigest,
                                )}`,
                            );
                        }
                        if (tsLocMergedDummyDigest && cacheCmdArraysAfter) {
                            try {
                                const cacheCmdArraysAfterNN = cacheCmdArraysAfter!;
                                const tsRuntimeCmdInputNN =
                                    tsBridgeInput.runtimeCommandStreamInput!;
                                const cacheMergedDummyDigestFromArrays =
                                    computeTsLocMergedDummyDigest(cacheCmdArraysAfterNN);
                                console.error(
                                    `  cache loc-merge-dummy-stage (from arrays)=${JSON.stringify(
                                        cacheMergedDummyDigestFromArrays,
                                    )}`,
                                );
                                diffMergedDummyCommandMultiset(
                                    "cache-vs-ts",
                                    tsRuntimeCmdInputNN,
                                    cacheCmdArraysAfterNN,
                                    runtimeCommandProvenanceEntries,
                                    12,
                                );
                            } catch (e) {
                                console.error(
                                    "  cache loc-merge-dummy-stage (from arrays) compute failed: " +
                                        String(e),
                                );
                            }
                        }
                    }
                }
                const cacheTerrainGrid = cacheTerrainGridStage;
                const cacheTerrainGridLen = (cacheTerrainGrid?.counts?.length ?? 0) | 0;
                if (
                    (!cacheTerrainGrid || cacheTerrainGridLen <= 0) &&
                    typeof bridge.debugGetRuntimeLastTerrainTileFaceCounts === "function"
                ) {
                    console.error(
                        "  terrain-tile-face-count debug: no grid",
                        cacheTerrainGrid
                            ? {
                                  levels: cacheTerrainGrid.levels | 0,
                                  width: cacheTerrainGrid.width | 0,
                                  height: cacheTerrainGrid.height | 0,
                                  border: cacheTerrainGrid.border | 0,
                                  len: cacheTerrainGridLen,
                              }
                            : undefined,
                    );
                }
                if (cacheTerrainGrid && cacheTerrainGridLen > 0) {
                    try {
                        const baseX = (sceneBuildInput.baseX as number) | 0;
                        const baseY = (sceneBuildInput.baseY as number) | 0;
                        const sizeX = (sceneBuildInput.sizeX as number) | 0;
                        const sizeY = (sceneBuildInput.sizeY as number) | 0;
                        const smoothUnderlays = !!sceneBuildInput.smoothTerrain;
                        const tsScene = buildSceneFromMapBytesProvider(
                            sceneBuilder,
                            mapBytesProvider,
                            baseX,
                            baseY,
                            sizeX,
                            sizeY,
                            smoothUnderlays,
                            LocLoadType.MODELS,
                        );

                        const levels = cacheTerrainGrid.levels | 0;
                        const width = cacheTerrainGrid.width | 0;
                        const height = cacheTerrainGrid.height | 0;
                        const border = cacheTerrainGrid.border | 0;
                        const counts = cacheTerrainGrid.counts;
                        const startX = border | 0;
                        const startY = border | 0;
                        const endX = (startX + width) | 0;
                        const endY = (startY + height) | 0;

                        const mismatches: Array<{
                            level: number;
                            x: number;
                            y: number;
                            ts: number;
                            cpp: number;
                            underlay: number;
                            overlay: number;
                            shape: number;
                            rot: number;
                            tilePresent: number;
                            tileModelPresent: number;
                            tileModelFaces: number;
                        }> = [];

                        if (
                            startX >= 0 &&
                            startY >= 0 &&
                            endX <= tsScene.sizeX &&
                            endY <= tsScene.sizeY
                        ) {
                            const maxLevel = Math.min(levels, tsScene.tiles.length) | 0;
                            for (let level = 0; level < maxLevel; level++) {
                                for (let x = startX; x < endX; x++) {
                                    for (let y = startY; y < endY; y++) {
                                        const tile = tsScene.tiles[level][x][y];
                                        const tsFaces =
                                            tile && tile.minLevel <= 3 && tile.tileModel
                                                ? tile.tileModel.faces.length | 0
                                                : 0;
                                        const lx = (x - startX) | 0;
                                        const ly = (y - startY) | 0;
                                        const idxFlat =
                                            (((level * width + lx) * height + ly) | 0) >>> 0;
                                        const cppFaces =
                                            idxFlat < counts.length ? counts[idxFlat] | 0 : -1;
                                        if (cppFaces !== tsFaces) {
                                            mismatches.push({
                                                level,
                                                x,
                                                y,
                                                ts: tsFaces,
                                                cpp: cppFaces,
                                                underlay: tsScene.tileUnderlays[level][x][y] | 0,
                                                overlay: tsScene.tileOverlays[level][x][y] | 0,
                                                shape: tsScene.tileShapes[level][x][y] | 0,
                                                rot: tsScene.tileRotations[level][x][y] | 0,
                                                tilePresent: tile ? 1 : 0,
                                                tileModelPresent: tile && tile.tileModel ? 1 : 0,
                                                tileModelFaces:
                                                    tile && tile.tileModel
                                                        ? tile.tileModel.faces.length | 0
                                                        : 0,
                                            });
                                        }
                                    }
                                }
                            }
                        }

                        if (mismatches.length > 0) {
                            console.error(
                                "  terrain-tile-face-count mismatches: " +
                                    mismatches.length +
                                    " (showing up to 20)",
                            );
                            for (const m of mismatches.slice(0, 20)) {
                                const worldX = (baseX + m.x) | 0;
                                const worldY = (baseY + m.y) | 0;
                                console.error(
                                    "    tile L=" +
                                        m.level +
                                        " x=" +
                                        m.x +
                                        " y=" +
                                        m.y +
                                        " world=" +
                                        worldX +
                                        "," +
                                        worldY +
                                        " ts=" +
                                        m.ts +
                                        " cpp=" +
                                        m.cpp +
                                        " underlay=" +
                                        m.underlay +
                                        " overlay=" +
                                        m.overlay +
                                        " shape=" +
                                        m.shape +
                                        " rot=" +
                                        m.rot +
                                        " tile=" +
                                        m.tilePresent +
                                        " tileModel=" +
                                        m.tileModelPresent +
                                        " tileFaces=" +
                                        m.tileModelFaces,
                                );
                            }

                            const firstOverlayRaw = (mismatches[0]?.overlay ?? 0) | 0;
                            const overlayTypeId = (firstOverlayRaw - 1) | 0;
                            if (overlayTypeId >= 0) {
                                const tsOverlay =
                                    sceneBuilder.services.overlayTypeLoader.tryLoad(overlayTypeId);
                                const tsOverlayInfo = tsOverlay.ok
                                    ? {
                                          primaryRgb: tsOverlay.value.primaryRgb | 0,
                                          primaryHsl: tsOverlay.value.primaryHsl | 0,
                                          textureId: tsOverlay.value.textureId | 0,
                                          secondaryTextureId:
                                              tsOverlay.value.secondaryTextureId | 0,
                                          blendRgb: tsOverlay.value.blendRgb | 0,
                                          blendHsl: tsOverlay.value.blendHsl | 0,
                                          blendable: !!tsOverlay.value.blendable,
                                          blendPriority: tsOverlay.value.blendPriority | 0,
                                          hideUnderlay: !!tsOverlay.value.hideUnderlay,
                                          occludes: !!tsOverlay.value.occludes,
                                          textureSize: tsOverlay.value.textureSize | 0,
                                          blockShadow: !!tsOverlay.value.blockShadow,
                                      }
                                    : { ok: false };
                                const cppOverlayInfo =
                                    typeof bridge.debugDecodeRuntimeOverlayType === "function"
                                        ? await bridge.debugDecodeRuntimeOverlayType(
                                              runtimeHandle,
                                              overlayTypeId,
                                          )
                                        : undefined;
                                console.error(
                                    "  overlay-type debug id=" +
                                        overlayTypeId +
                                        " ts=" +
                                        JSON.stringify(tsOverlayInfo) +
                                        " cpp=" +
                                        JSON.stringify(cppOverlayInfo),
                                );
                            }

                            const firstTerrainMismatch = mismatches.find(
                                (m) => (m.ts | 0) > 0,
                            );
                            if (
                                firstTerrainMismatch &&
                                typeof bridge.debugSetTerrainProbe === "function" &&
                                typeof bridge.debugGetRuntimeLastTerrainProbe === "function" &&
                                typeof bridge.buildMapPacketFromCache === "function"
                            ) {
                                try {
                                    const px = firstTerrainMismatch.x | 0;
                                    const py = firstTerrainMismatch.y | 0;
                                    const pl = firstTerrainMismatch.level | 0;
                                    await bridge.debugSetTerrainProbe(runtimeHandle, pl, px, py);
                                    if (request) {
                                        await bridge.buildMapPacketFromCache(
                                            runtimeHandle,
                                            request,
                                        );
                                    }
                                    const probe =
                                        await bridge.debugGetRuntimeLastTerrainProbe(runtimeHandle);
                                    if (probe?.hit) {
                                        const p = probe.packed;
                                        const read = (idx: number): number => p[idx] | 0;
                                        const worldTileX =
                                            ((sceneBuildInput.baseX as number) |
                                                0) + (firstTerrainMismatch.x | 0);
                                        const worldTileY =
                                            ((sceneBuildInput.baseY as number) |
                                                0) + (firstTerrainMismatch.y | 0);
                                        const worldMapX = Math.floor(worldTileX / 64) | 0;
                                        const worldMapY = Math.floor(worldTileY / 64) | 0;
                                        const localX = (worldTileX - worldMapX * 64) | 0;
                                        const localY = (worldTileY - worldMapY * 64) | 0;
                                        console.error(
                                            "  terrain-probe cpp tile=" +
                                                `${probe.tileX | 0},${probe.tileY | 0}` +
                                                " level=" +
                                                (probe.level | 0) +
                                                " raw={underlay:" +
                                                read(0) +
                                                ",overlay:" +
                                                read(1) +
                                                ",shape:" +
                                                read(2) +
                                                ",rot:" +
                                                read(3) +
                                                "} hasEdgeHsls=" +
                                                read(4) +
                                                " underlayTex={packed:" +
                                                read(5) +
                                                ",size:" +
                                                read(6) +
                                                "}",
                                        );
                                        console.error(
                                            "  terrain-probe cpp underlayBlend=" +
                                                `[${read(7)},${read(8)},${read(9)},${read(10)}]` +
                                                " light=" +
                                                `[${read(11)},${read(12)},${read(13)},${read(14)}]` +
                                                " underlayHsl=" +
                                                `[${read(15)},${read(16)},${read(17)},${read(18)}]`,
                                        );
                                        console.error(
                                            "  terrain-probe cpp overlayBase corner=" +
                                                `[${read(24)},${read(25)},${read(26)},${read(27)}]` +
                                                " edge=" +
                                                `[${read(28)},${read(29)},${read(30)},${read(31)}]`,
                                        );
                                        console.error(
                                            "  terrain-probe cpp mapLookup world=" +
                                                `${read(45)},${read(46)}` +
                                                " map=" +
                                                `${read(47)},${read(48)}` +
                                                " local=" +
                                                `${read(49)},${read(50)}` +
                                                " mapIdx=" +
                                                read(51) +
                                                " terrainSlice={off:" +
                                                read(52) +
                                                ",len:" +
                                                read(53) +
                                                "} loadStatus=" +
                                                read(54) +
                                                " loadLen=" +
                                                read(55),
                                        );
                                        console.error(
                                            "  terrain-probe cpp mapDecode status=" +
                                                read(56) +
                                                " decodedRaw={underlay:" +
                                                read(57) +
                                                ",overlay:" +
                                                read(58) +
                                                ",shape:" +
                                                read(59) +
                                                "} emitContext={baseX:" +
                                                read(60) +
                                                ",baseY:" +
                                                read(61) +
                                                ",worldX:" +
                                                read(62) +
                                                ",worldY:" +
                                                read(63) +
                                                "}",
                                        );
                                        try {
                                            const decodeCachedTerrainCell = (bridge as any)
                                                ?.debugDecodeCachedTerrainCell;
                                            if (typeof decodeCachedTerrainCell === "function") {
                                                const decoded = await decodeCachedTerrainCell(
                                                    runtimeHandle,
                                                    worldMapX,
                                                    worldMapY,
                                                    firstTerrainMismatch.level | 0,
                                                    localX,
                                                    localY,
                                                );
                                                console.error(
                                                    "  terrain-probe cacheCell world=" +
                                                        `${worldTileX},${worldTileY}` +
                                                        " map=" +
                                                        `${worldMapX},${worldMapY}` +
                                                        " local=" +
                                                        `${localX},${localY}` +
                                                        " tsRaw={underlay:" +
                                                        ((firstTerrainMismatch.underlay | 0) - 1) +
                                                        ",overlay:" +
                                                        (firstTerrainMismatch.overlay | 0) +
                                                        ",shape:" +
                                                        (firstTerrainMismatch.shape | 0) +
                                                        ",rot:" +
                                                        (firstTerrainMismatch.rot | 0) +
                                                        "} cppDecoded=" +
                                                        JSON.stringify(decoded),
                                                );
                                            }
                                        } catch (e) {
                                            console.error(
                                                "  terrain-probe cacheCell debug failed: " +
                                                    String(e),
                                            );
                                        }
                                    } else {
                                        console.error(
                                            "  terrain-probe cpp did not hit first mismatch tile",
                                        );
                                    }
                                } catch (e) {
                                    console.error(
                                        "  terrain-probe cpp debug failed: " + String(e),
                                    );
                                }
                            }
                        }
                    } catch (e) {
                        console.error("  terrain-tile-face-count debug failed: " + String(e));
                    }
                }
                if (tsCmdDigest && !args.quiet) {
                    console.error(`  ts cmd-digest=${JSON.stringify(tsCmdDigest)}`);
                }
                if (mismatchKeys.includes("drawRanges")) {
                    const tsDrawRangeSummary = summarizeDrawRangeBuckets(tsData.drawRanges);
                    const cacheDrawRangeSummary = summarizeDrawRangeBuckets(cache.drawRanges);
                    console.error(
                        `  draw-range summary ts=${JSON.stringify(
                            tsDrawRangeSummary,
                        )} cache=${JSON.stringify(cacheDrawRangeSummary)}`,
                    );
                }
                if (mismatchKeys.includes("vertices") && verticesDiffDetail) {
                    console.error(`  vertices diff: ${verticesDiffDetail}`);
                    const mismatchByteIndex = parseMismatchByteIndex(verticesDiffDetail);
                    if (
                        mismatchByteIndex >= 0 &&
                        tsData.vertices instanceof Uint8Array &&
                        packet.vertices instanceof Uint8Array
                    ) {
                        const vertexIndex = Math.floor(mismatchByteIndex / 16) | 0;
                        if (
                            vertexIndex >= 0 &&
                            vertexIndex * 16 + 15 < tsData.vertices.length &&
                            vertexIndex * 16 + 15 < packet.vertices.length
                        ) {
                            const tsVertex = decodePackedVertexDebug(
                                tsData.vertices,
                                vertexIndex,
                            );
                            const cacheVertex = decodePackedVertexDebug(
                                packet.vertices,
                                vertexIndex,
                            );
                            console.error(
                                `  first vertex-byte mismatch -> vertex=${vertexIndex} ts=${JSON.stringify(
                                    tsVertex,
                                )} cache=${JSON.stringify(cacheVertex)}`,
                            );
                            const tsPosSummary = summarizePackedVertexAtPosition(
                                tsData.vertices,
                                tsVertex,
                            );
                            const cachePosSummary = summarizePackedVertexAtPosition(
                                packet.vertices,
                                tsVertex,
                            );
                            console.error(
                                `  mismatch-position summary ts=${JSON.stringify(
                                    tsPosSummary,
                                )} cache=${JSON.stringify(cachePosSummary)}`,
                            );

                            if (
                                tsData.indices instanceof Int32Array &&
                                packet.indices instanceof Int32Array &&
                                cacheCmdArraysAfter &&
                                tsBridgeInput.runtimeCommandStreamInput
                            ) {
                                const collectElementIndicesForVertex = (
                                    arr: Int32Array,
                                    targetVertexIndex: number,
                                    limit: number,
                                ): number[] => {
                                    const out: number[] = [];
                                    let from = 0;
                                    while (out.length < limit) {
                                        const idx = arr.indexOf(targetVertexIndex, from);
                                        if (idx < 0) break;
                                        out.push(idx | 0);
                                        from = (idx + 1) | 0;
                                    }
                                    return out;
                                };
                                const tsElementIndices = collectElementIndicesForVertex(
                                    tsData.indices,
                                    vertexIndex,
                                    8,
                                );
                                const cacheElementIndices = collectElementIndicesForVertex(
                                    packet.indices,
                                    vertexIndex,
                                    8,
                                );
                                const elementCandidates = Array.from(
                                    new Set<number>(
                                        [...tsElementIndices, ...cacheElementIndices].filter(
                                            (v) => v >= 0,
                                        ),
                                    ),
                                ).slice(0, 8);
                                const tsElementIndex = tsElementIndices[0] ?? -1;
                                const cacheElementIndex = cacheElementIndices[0] ?? -1;
                                const elementIndex =
                                    tsElementIndex >= 0
                                        ? tsElementIndex | 0
                                        : cacheElementIndex >= 0
                                        ? cacheElementIndex | 0
                                        : -1;
                                console.error(
                                    `  vertex mismatch index refs: ts=${JSON.stringify(
                                        tsElementIndices,
                                    )} cache=${JSON.stringify(cacheElementIndices)}`,
                                );

                                const dumpTriangleAtElement = (
                                    tag: string,
                                    vertices: Uint8Array,
                                    indices: Int32Array,
                                    element: number,
                                ): void => {
                                    const triStart = (element - (element % 3)) | 0;
                                    if (triStart < 0 || triStart + 2 >= indices.length) return;
                                    const ia = indices[triStart] | 0;
                                    const ib = indices[triStart + 1] | 0;
                                    const ic = indices[triStart + 2] | 0;
                                    const decode = (vi: number): unknown => {
                                        if (vi < 0 || vi * 16 + 15 >= vertices.length)
                                            return { vi, ok: false };
                                        const v = decodePackedVertexDebug(vertices, vi);
                                        return {
                                            vi,
                                            x: v.x | 0,
                                            y: v.y | 0,
                                            z: v.z | 0,
                                            hsl: v.hsl | 0,
                                            lightness: (v.hsl & 127) | 0,
                                            isTextured: v.isTextured | 0,
                                            textureId: v.textureId | 0,
                                            u: v.u,
                                            v: v.v,
                                        };
                                    };
                                    console.error(
                                        `  tri@${tag} elem=${element} triStart=${triStart} idx=[${ia},${ib},${ic}]` +
                                            ` vA=${JSON.stringify(decode(ia))}` +
                                            ` vB=${JSON.stringify(decode(ib))}` +
                                            ` vC=${JSON.stringify(decode(ic))}`,
                                    );
                                };

                                if (elementIndex >= 0) {
                                    const runtimeLocMergeEmitEntries =
                                        parseRuntimeLocMergeEmitEntriesPacked(
                                            cacheLocMergeEmitEntriesPacked,
                                        );
                                    const mergeEmitIdx =
                                        findRuntimeLocMergeEmitEntryIndexForElement(
                                            runtimeLocMergeEmitEntries,
                                            elementIndex,
                                        );
                                    if (mergeEmitIdx >= 0 && runtimeLocMergeEmitEntries) {
                                        const lo = Math.max(0, mergeEmitIdx - 1) | 0;
                                        const hi =
                                            Math.min(
                                                runtimeLocMergeEmitEntries.length - 1,
                                                mergeEmitIdx + 1,
                                            ) | 0;
                                        for (let i = lo; i <= hi; i++) {
                                            const tag =
                                                i === mergeEmitIdx
                                                    ? "  loc-merge-emit HIT"
                                                    : "  loc-merge-emit";
                                            console.error(
                                                `${tag} idx=${i} ${summarizeRuntimeLocMergeEmitEntry(
                                                    runtimeLocMergeEmitEntries[i],
                                                )}`,
                                            );
                                        }

                                        // If possible, compare the raw decoded ModelData vertices hash for the HIT modelId
                                        // (this distinguishes model decode issues from contour/scene issues).
                                        try {
                                            const hit = runtimeLocMergeEmitEntries[mergeEmitIdx];
                                            try {
                                                const runtimeLocMergeDecisionEntries =
                                                    parseRuntimeLocMergeDecisionEntriesPacked(
                                                        cacheLocMergeDecisionEntriesPacked,
                                                    );
                                                const group = runtimeLocMergeDecisionEntries
                                                    ?.filter((e) => {
                                                        return (
                                                            (e.locTypeId | 0) ===
                                                                (hit.locTypeId | 0) &&
                                                            (e.variantType | 0) ===
                                                                (hit.placementType | 0) &&
                                                            (e.variantRotation | 0) ===
                                                                (hit.placementRotation | 0) &&
                                                            (e.level | 0) === (hit.level | 0) &&
                                                            (e.chosenGroupIndex | 0) ===
                                                                (hit.groupIndex | 0)
                                                        );
                                                    })
                                                    .sort(
                                                        (a, b) =>
                                                            (a.placementOrder | 0) -
                                                            (b.placementOrder | 0),
                                                    );
                                                const decision =
                                                    group &&
                                                    (hit.instanceIndex | 0) >= 0 &&
                                                    (hit.instanceIndex | 0) < group.length
                                                        ? group[hit.instanceIndex | 0]
                                                        : undefined;
                                                if (decision) {
                                                    console.error(
                                                        `  loc-merge-decision HIT loc=${
                                                            hit.locTypeId | 0
                                                        } p=${decision.placementType | 0}/${
                                                            decision.placementRotation | 0
                                                        } v=${decision.variantType | 0}/${
                                                            decision.variantRotation | 0
                                                        } tile=${decision.tileX | 0},${
                                                            decision.tileY | 0
                                                        } sh=${decision.sceneHeight | 0} cx=${
                                                            decision.contourSceneX | 0
                                                        } cz=${decision.contourSceneZ | 0} grp=${
                                                            decision.chosenGroupIndex | 0
                                                        } ord=${decision.placementOrder | 0}`,
                                                    );
                                                } else {
                                                    console.error(
                                                        "  loc-merge-decision HIT: could not resolve decision entry for grp/inst",
                                                    );
                                                    try {
                                                        const mismatchTile = tileFromVertexPos(
                                                            tsVertex,
                                                            6,
                                                        );
                                                        const runtimePreMergeEntries =
                                                            parseRuntimeLocPreMergeEntriesPacked(
                                                                cacheLocPreMergeEntriesPacked,
                                                            );
                                                        const preMergeCandidates =
                                                            runtimePreMergeEntries
                                                                ?.filter((e) => {
                                                                    return (
                                                                        (e.locTypeId | 0) ===
                                                                            (hit.locTypeId | 0) &&
                                                                        (e.variantType | 0) ===
                                                                            (hit.placementType |
                                                                                0) &&
                                                                        (e.variantRotation | 0) ===
                                                                            (hit.placementRotation |
                                                                                0) &&
                                                                        (e.level | 0) ===
                                                                            (hit.level | 0) &&
                                                                        (e.tileX | 0) ===
                                                                            (mismatchTile.tileX |
                                                                                0) &&
                                                                        (e.tileY | 0) ===
                                                                            (mismatchTile.tileY | 0)
                                                                    );
                                                                })
                                                                .slice(0, 8) ?? [];
                                                        if (preMergeCandidates.length > 0) {
                                                            console.error(
                                                                "  loc-pre-merge candidates (showing up to 8): " +
                                                                    preMergeCandidates
                                                                        .map((e) => {
                                                                            return (
                                                                                `p=${
                                                                                    e.placementType |
                                                                                    0
                                                                                }/${
                                                                                    e.placementRotation |
                                                                                    0
                                                                                }` +
                                                                                ` v=${
                                                                                    e.variantType |
                                                                                    0
                                                                                }/${
                                                                                    e.variantRotation |
                                                                                    0
                                                                                }` +
                                                                                ` tile=${
                                                                                    e.tileX | 0
                                                                                },${e.tileY | 0}` +
                                                                                ` sh=${
                                                                                    e.sceneHeight |
                                                                                    0
                                                                                }` +
                                                                                ` cx=${
                                                                                    e.contourSceneX |
                                                                                    0
                                                                                }` +
                                                                                ` cz=${
                                                                                    e.contourSceneZ |
                                                                                    0
                                                                                }` +
                                                                                ` fm=${
                                                                                    e.forceMerge | 0
                                                                                }` +
                                                                                ` lod=${
                                                                                    e.includeLod | 0
                                                                                }` +
                                                                                ` ch=${
                                                                                    e.contourGround |
                                                                                    0
                                                                                }` +
                                                                                ` mh=${
                                                                                    e.modelIdsHash |
                                                                                    0
                                                                                }`
                                                                            );
                                                                        })
                                                                        .join(" ; "),
                                                            );
                                                        } else {
                                                            console.error(
                                                                "  loc-pre-merge candidates: <none> (for mismatch tile + variant)",
                                                            );
                                                        }
                                                    } catch (e) {
                                                        console.error(
                                                            "  loc-pre-merge candidates lookup failed: " +
                                                                String(e),
                                                        );
                                                    }
                                                }
                                            } catch (e) {
                                                console.error(
                                                    "  loc-merge-decision HIT failed: " + String(e),
                                                );
                                            }
                                            const hitLocId = hit.locTypeId | 0;
                                            const hitPlacementType = hit.placementType | 0;
                                            const hitRotation = hit.placementRotation | 0;
                                            const hitLevel = hit.level | 0;
                                            // For mergeNormals locs, the first geometry divergence is often due to a missing
                                            // or offset-shifted mergeNormals call. Compare TS vs runtime mergeNormals traces.
                                            try {
                                                const runtimeTrace =
                                                    parseRuntimeLocMergeNormalsTraceEntriesPacked(
                                                        cacheLocMergeNormalsTraceEntriesPacked,
                                                    );
                                                const tsTrace = captureTsMergeNormalsTraceForSquare(
                                                    sceneBuilder,
                                                    mapBytesProvider,
                                                    sceneBuildInput,
                                                    [hitLocId],
                                                );
                                                const traceLines =
                                                    summarizeTsVsRuntimeMergeNormalsTrace(
                                                        tsTrace,
                                                        runtimeTrace,
                                                        [hitLocId],
                                                    );
                                                for (let ti = 0; ti < traceLines.length; ti++) {
                                                    console.error(traceLines[ti]);
                                                }
                                            } catch (e) {
                                                console.error(
                                                    `  mergeNormals-trace compare failed: ${String(
                                                        e,
                                                    )}`,
                                                );
                                            }
                                            const locTypeLoader =
                                                sceneBuilder.services.locTypeLoader;
                                            const varProvider = sceneBuilder.services.varProvider;
                                            const tsBase = locTypeLoader.tryLoad(hitLocId);
                                            if (tsBase.ok) {
                                                const resolved =
                                                    tsBase.value.transform(
                                                        varProvider,
                                                        locTypeLoader,
                                                    ) ?? tsBase.value;
                                                let modelId = -1;
                                                const types = resolved.types as
                                                    | number[]
                                                    | undefined;
                                                const models = resolved.models as
                                                    | number[][]
                                                    | undefined;
                                                if (!types) {
                                                    // TS LocModelLoader: when `types` is absent, only NORMAL uses `models[0]`.
                                                    if (
                                                        (hitPlacementType | 0) ===
                                                        (LocModelType.NORMAL | 0)
                                                    ) {
                                                        modelId =
                                                            ((models?.[0]?.[0] as
                                                                | number
                                                                | undefined) ?? -1) | 0;
                                                    }
                                                } else {
                                                    for (
                                                        let ti = 0;
                                                        ti < types.length &&
                                                        ti < (models?.length ?? 0);
                                                        ti++
                                                    ) {
                                                        if (
                                                            ((types[ti] ?? -1) | 0) ===
                                                            hitPlacementType
                                                        ) {
                                                            modelId =
                                                                ((models?.[ti]?.[0] as
                                                                    | number
                                                                    | undefined) ?? -1) | 0;
                                                            break;
                                                        }
                                                    }
                                                }
                                                if (modelId >= 0) {
                                                    let tsModel: unknown;
                                                    try {
                                                        tsModel =
                                                            loaders.modelLoader.tryGet(modelId);
                                                    } catch {
                                                        tsModel = undefined;
                                                    }
                                                    const tsDigest =
                                                        tsModel instanceof ModelData
                                                            ? digestTsModelVerticesFromModelData(
                                                                  tsModel,
                                                              )
                                                            : undefined;
                                                    const cppDigest =
                                                        typeof bridge.debugGetRuntimeModelVerticesDigest ===
                                                        "function"
                                                            ? await bridge.debugGetRuntimeModelVerticesDigest(
                                                                  runtimeHandle,
                                                                  modelId,
                                                              )
                                                            : undefined;
                                                    console.error(
                                                        `  model-vertices-digest HIT modelId=${modelId} ts=${JSON.stringify(
                                                            tsDigest,
                                                        )} cpp=${JSON.stringify(cppDigest)}`,
                                                    );

                                                    const toTriplets = (
                                                        xyz: ReadonlyArray<number>,
                                                    ): string => {
                                                        const out: string[] = [];
                                                        for (
                                                            let i = 0;
                                                            i + 2 < xyz.length;
                                                            i += 3
                                                        ) {
                                                            out.push(
                                                                `(${xyz[i] ?? 0},${
                                                                    xyz[i + 1] ?? 0
                                                                },${xyz[i + 2] ?? 0})`,
                                                            );
                                                        }
                                                        return `[${out.join(",")}]`;
                                                    };

                                                    const tsSample = (() => {
                                                        if (!(tsModel instanceof ModelData)) {
                                                            return undefined;
                                                        }
                                                        const n = Math.min(
                                                            32,
                                                            tsModel.verticesX?.length ?? 0,
                                                            tsModel.verticesY?.length ?? 0,
                                                            tsModel.verticesZ?.length ?? 0,
                                                        );
                                                        const xyz: number[] = [];
                                                        for (let i = 0; i < n; i++) {
                                                            xyz.push(
                                                                (tsModel.verticesX[i] ?? 0) | 0,
                                                                (tsModel.verticesY[i] ?? 0) | 0,
                                                                (tsModel.verticesZ[i] ?? 0) | 0,
                                                            );
                                                        }
                                                        return {
                                                            version: (tsModel as any).version | 0,
                                                            verticesCount:
                                                                tsModel.verticesCount | 0,
                                                            usedVertexCount:
                                                                tsModel.usedVertexCount | 0,
                                                            faceCount: tsModel.faceCount | 0,
                                                            written: n | 0,
                                                            xyzTriplets: toTriplets(xyz),
                                                        };
                                                    })();

                                                    const cppSample =
                                                        typeof bridge.debugGetRuntimeModelVerticesSample ===
                                                        "function"
                                                            ? await bridge.debugGetRuntimeModelVerticesSample(
                                                                  runtimeHandle,
                                                                  modelId,
                                                              )
                                                            : undefined;
                                                    const cppSampleSummary = cppSample
                                                        ? {
                                                              version: cppSample.version | 0,
                                                              verticesCount:
                                                                  cppSample.verticesCount | 0,
                                                              usedVertexCount:
                                                                  cppSample.usedVertexCount | 0,
                                                              faceCount: cppSample.faceCount | 0,
                                                              written: cppSample.written | 0,
                                                              xyzTriplets: toTriplets(
                                                                  Array.from(cppSample.xyz),
                                                              ),
                                                          }
                                                        : undefined;
                                                    console.error(
                                                        `  model-vertices-sample HIT modelId=${modelId} ts=${JSON.stringify(
                                                            tsSample,
                                                        )} cpp=${JSON.stringify(cppSampleSummary)}`,
                                                    );

                                                    // Compare contour baseline inputs (sceneHeight + contourSceneX/Z) for the mismatch tile.
                                                    try {
                                                        const mismatchTile = tileFromVertexPos(
                                                            tsVertex,
                                                            6,
                                                        );
                                                        const runtimeLocMergeDecisionEntries =
                                                            parseRuntimeLocMergeDecisionEntriesPacked(
                                                                cacheLocMergeDecisionEntriesPacked,
                                                            );
                                                        const decisionFromTile =
                                                            runtimeLocMergeDecisionEntries?.find(
                                                                (e) => {
                                                                    return (
                                                                        (e.locTypeId | 0) ===
                                                                            hitLocId &&
                                                                        (e.variantType | 0) ===
                                                                            hitPlacementType &&
                                                                        (e.variantRotation | 0) ===
                                                                            hitRotation &&
                                                                        (e.level | 0) ===
                                                                            hitLevel &&
                                                                        (e.tileX | 0) ===
                                                                            (mismatchTile.tileX |
                                                                                0) &&
                                                                        (e.tileY | 0) ===
                                                                            (mismatchTile.tileY |
                                                                                0) &&
                                                                        (e.chosenGroupIndex | 0) ===
                                                                            (hit.groupIndex | 0)
                                                                    );
                                                                },
                                                            ) ??
                                                            runtimeLocMergeDecisionEntries?.find(
                                                                (e) => {
                                                                    return (
                                                                        (e.locTypeId | 0) ===
                                                                            hitLocId &&
                                                                        (e.variantType | 0) ===
                                                                            hitPlacementType &&
                                                                        (e.variantRotation | 0) ===
                                                                            hitRotation &&
                                                                        (e.level | 0) ===
                                                                            hitLevel &&
                                                                        (e.tileX | 0) ===
                                                                            (mismatchTile.tileX |
                                                                                0) &&
                                                                        (e.tileY | 0) ===
                                                                            (mismatchTile.tileY | 0)
                                                                    );
                                                                },
                                                            );

                                                        const decision =
                                                            decisionFromTile ??
                                                            (() => {
                                                                const group =
                                                                    runtimeLocMergeDecisionEntries
                                                                        ?.filter((e) => {
                                                                            return (
                                                                                (e.locTypeId |
                                                                                    0) ===
                                                                                    hitLocId &&
                                                                                (e.variantType |
                                                                                    0) ===
                                                                                    hitPlacementType &&
                                                                                (e.variantRotation |
                                                                                    0) ===
                                                                                    hitRotation &&
                                                                                (e.level | 0) ===
                                                                                    hitLevel &&
                                                                                (e.chosenGroupIndex |
                                                                                    0) ===
                                                                                    (hit.groupIndex |
                                                                                        0)
                                                                            );
                                                                        })
                                                                        .sort(
                                                                            (a, b) =>
                                                                                (a.placementOrder |
                                                                                    0) -
                                                                                (b.placementOrder |
                                                                                    0),
                                                                        );
                                                                const idx = hit.instanceIndex | 0;
                                                                return group &&
                                                                    idx >= 0 &&
                                                                    idx < group.length
                                                                    ? group[idx]
                                                                    : undefined;
                                                            })();

                                                        if (decision) {
                                                            console.error(
                                                                "  contour-baseline(runtime) loc=" +
                                                                    hitLocId +
                                                                    " p=" +
                                                                    hitPlacementType +
                                                                    "/" +
                                                                    hitRotation +
                                                                    " lvl=" +
                                                                    hitLevel +
                                                                    " tile=" +
                                                                    (decision.tileX | 0) +
                                                                    "," +
                                                                    (decision.tileY | 0) +
                                                                    " sh=" +
                                                                    (decision.sceneHeight | 0) +
                                                                    " cx=" +
                                                                    (decision.contourSceneX | 0) +
                                                                    " cz=" +
                                                                    (decision.contourSceneZ | 0) +
                                                                    " contour=" +
                                                                    (decision.contourGround | 0),
                                                            );
                                                        } else {
                                                            console.error(
                                                                "  contour-baseline(runtime) missing for loc=" +
                                                                    hitLocId +
                                                                    " p=" +
                                                                    hitPlacementType +
                                                                    "/" +
                                                                    hitRotation +
                                                                    " lvl=" +
                                                                    hitLevel +
                                                                    " grp=" +
                                                                    (hit.groupIndex | 0) +
                                                                    " inst=" +
                                                                    (hit.instanceIndex | 0) +
                                                                    " mismatchTile=" +
                                                                    mismatchTile.tileX +
                                                                    "," +
                                                                    mismatchTile.tileY,
                                                            );
                                                        }

                                                        const scene =
                                                            buildSceneFromMapBytesProvider(
                                                                sceneBuilder,
                                                                mapBytesProvider,
                                                                (sceneBuildInput.baseX as number) |
                                                                    0,
                                                                (sceneBuildInput.baseY as number) |
                                                                    0,
                                                                (sceneBuildInput.sizeX as number) |
                                                                    0,
                                                                (sceneBuildInput.sizeY as number) |
                                                                    0,
                                                                !!sceneBuildInput.smoothTerrain,
                                                                LocLoadType.NO_MODELS,
                                                            );
                                                        const locTypeResult =
                                                            locTypeLoader.tryLoad(hitLocId);
                                                        if (locTypeResult.ok) {
                                                            const locType = locTypeResult.value;
                                                            let sizeX = (locType as any).sizeX | 0;
                                                            let sizeY = (locType as any).sizeY | 0;
                                                            if (
                                                                (hitRotation | 0) === 1 ||
                                                                (hitRotation | 0) === 3
                                                            ) {
                                                                const swap = sizeX;
                                                                sizeX = sizeY;
                                                                sizeY = swap;
                                                            }
                                                            const tileX =
                                                                ((decision?.tileX ??
                                                                    mismatchTile.tileX) as number) |
                                                                0;
                                                            const tileY =
                                                                ((decision?.tileY ??
                                                                    mismatchTile.tileY) as number) |
                                                                0;
                                                            let startX: number;
                                                            let endX: number;
                                                            if (
                                                                tileX + sizeX <=
                                                                (scene.sizeX | 0)
                                                            ) {
                                                                startX = (sizeX >> 1) + tileX;
                                                                endX = ((sizeX + 1) >> 1) + tileX;
                                                            } else {
                                                                startX = tileX;
                                                                endX = tileX + 1;
                                                            }
                                                            let startY: number;
                                                            let endY: number;
                                                            if (
                                                                tileY + sizeY <=
                                                                (scene.sizeY | 0)
                                                            ) {
                                                                startY = (sizeY >> 1) + tileY;
                                                                endY = ((sizeY + 1) >> 1) + tileY;
                                                            } else {
                                                                startY = tileY;
                                                                endY = tileY + 1;
                                                            }
                                                            const hm =
                                                                scene.tileHeights[hitLevel | 0];
                                                            const centerHeightSum =
                                                                (hm[endX][endY] | 0) +
                                                                (hm[startX][endY] | 0) +
                                                                (hm[startX][startY] | 0) +
                                                                (hm[endX][startY] | 0);
                                                            const centerHeight =
                                                                (centerHeightSum >> 2) | 0;
                                                            const entityX =
                                                                ((tileX << 7) + (sizeX << 6)) | 0;
                                                            const entityZ =
                                                                ((tileY << 7) + (sizeY << 6)) | 0;
                                                            console.error(
                                                                "  contour-baseline(ts) loc=" +
                                                                    hitLocId +
                                                                    " p=" +
                                                                    hitPlacementType +
                                                                    "/" +
                                                                    hitRotation +
                                                                    " lvl=" +
                                                                    hitLevel +
                                                                    " tile=" +
                                                                    tileX +
                                                                    "," +
                                                                    tileY +
                                                                    " sh=" +
                                                                    centerHeight +
                                                                    " cx=" +
                                                                    entityX +
                                                                    " cz=" +
                                                                    entityZ,
                                                            );

                                                            // Infer the baked model translation by matching the packed vertex
                                                            // against the local (per-loc) model vertices.
                                                            try {
                                                                const borderTiles = 6;
                                                                const baseSceneX =
                                                                    ((tileX - borderTiles) * 128 +
                                                                        64) |
                                                                    0;
                                                                const baseSceneZ =
                                                                    ((tileY - borderTiles) * 128 +
                                                                        64) |
                                                                    0;

                                                                // TS reference for wall-decoration displacement: load wall loc type from tag id.
                                                                try {
                                                                    const tile = (scene as any)
                                                                        ?.tiles?.[hitLevel | 0]?.[
                                                                        tileX | 0
                                                                    ]?.[tileY | 0];
                                                                    const decor =
                                                                        tile?.wallDecoration;
                                                                    const wall = tile?.wall;
                                                                    console.error(
                                                                        "  wall-decoration(ts) " +
                                                                            JSON.stringify({
                                                                                hasWall: !!wall,
                                                                                wallTag: wall?.tag
                                                                                    ? String(
                                                                                          wall.tag,
                                                                                      )
                                                                                    : undefined,
                                                                                hasDecor: !!decor,
                                                                                decorOffsetX:
                                                                                    decor?.offsetX ??
                                                                                    undefined,
                                                                                decorOffsetY:
                                                                                    decor?.offsetY ??
                                                                                    undefined,
                                                                                decorX:
                                                                                    decor?.x ??
                                                                                    undefined,
                                                                                decorY:
                                                                                    decor?.y ??
                                                                                    undefined,
                                                                            }),
                                                                    );
                                                                    const wallTag =
                                                                        scene.getWallTag(
                                                                            hitLevel | 0,
                                                                            tileX | 0,
                                                                            tileY | 0,
                                                                        );
                                                                    const wallLocId =
                                                                        getIdFromTag(
                                                                            wallTag as any,
                                                                        ) | 0;
                                                                    const wallLoc =
                                                                        locTypeLoader.tryLoad(
                                                                            wallLocId,
                                                                        );
                                                                    const wallDecorDisp = wallLoc.ok
                                                                        ? ((wallLoc.value as any)
                                                                              .decorDisplacement ??
                                                                              0) | 0
                                                                        : -1;
                                                                    console.error(
                                                                        `  wall-decor-displacement(ts) wallLocId=${wallLocId} decorDisplacement=${wallDecorDisp}`,
                                                                    );
                                                                    if (
                                                                        typeof bridge.debugDecodeRuntimeLocType ===
                                                                            "function" &&
                                                                        wallLocId > 0
                                                                    ) {
                                                                        const cpp =
                                                                            await bridge.debugDecodeRuntimeLocType(
                                                                                runtimeHandle,
                                                                                wallLocId,
                                                                            );
                                                                        console.error(
                                                                            `  wall-decor-displacement(cpp) wallLocId=${wallLocId} ${JSON.stringify(
                                                                                cpp,
                                                                            )}`,
                                                                        );
                                                                    }
                                                                } catch (e) {
                                                                    console.error(
                                                                        "  wall-decor-displacement(ts) failed: " +
                                                                            String(e),
                                                                    );
                                                                }

                                                                const heightMap =
                                                                    scene.tileHeights[hitLevel | 0];
                                                                const heightMapAbove =
                                                                    (hitLevel | 0) <
                                                                    (scene.levels | 0) - 1
                                                                        ? scene.tileHeights[
                                                                              (hitLevel | 0) + 1
                                                                          ]
                                                                        : undefined;
                                                                const contourGroundInfo = {
                                                                    type:
                                                                        ((resolved as any)
                                                                            .contourGroundType ??
                                                                            0) | 0,
                                                                    param:
                                                                        ((resolved as any)
                                                                            .contourGroundParam ??
                                                                            0) | 0,
                                                                    heightMap,
                                                                    heightMapAbove,
                                                                    entityX,
                                                                    entityY: centerHeight,
                                                                    entityZ,
                                                                };
                                                                const variantType =
                                                                    ((decision?.variantType ??
                                                                        hitPlacementType) as number) |
                                                                    0;
                                                                const variantRot =
                                                                    ((decision?.variantRotation ??
                                                                        hitRotation) as number) | 0;
                                                                const model =
                                                                    locModelLoader.getModel(
                                                                        resolved,
                                                                        variantType as any,
                                                                        variantRot,
                                                                        contourGroundInfo as any,
                                                                    );
                                                                const vx = (model as any)
                                                                    ?.verticesX as
                                                                    | Int32Array
                                                                    | undefined;
                                                                const vz = (model as any)
                                                                    ?.verticesZ as
                                                                    | Int32Array
                                                                    | undefined;
                                                                if (
                                                                    vx instanceof Int32Array &&
                                                                    vz instanceof Int32Array
                                                                ) {
                                                                    const n =
                                                                        Math.min(
                                                                            vx.length | 0,
                                                                            vz.length | 0,
                                                                            4096,
                                                                        ) | 0;
                                                                    const bestNear = (
                                                                        packed: Readonly<{
                                                                            x: number;
                                                                            z: number;
                                                                        }>,
                                                                    ): ReadonlyArray<
                                                                        Readonly<{
                                                                            sceneX: number;
                                                                            sceneZ: number;
                                                                            dx: number;
                                                                            dz: number;
                                                                        }>
                                                                    > => {
                                                                        const out: Array<
                                                                            Readonly<{
                                                                                sceneX: number;
                                                                                sceneZ: number;
                                                                                dx: number;
                                                                                dz: number;
                                                                            }>
                                                                        > = [];
                                                                        for (
                                                                            let i = 0;
                                                                            i < n;
                                                                            i++
                                                                        ) {
                                                                            const sceneX =
                                                                                ((packed.x | 0) -
                                                                                    (vx[i] | 0)) |
                                                                                0;
                                                                            const sceneZ =
                                                                                ((packed.z | 0) -
                                                                                    (vz[i] | 0)) |
                                                                                0;
                                                                            const dx =
                                                                                (sceneX -
                                                                                    baseSceneX) |
                                                                                0;
                                                                            const dz =
                                                                                (sceneZ -
                                                                                    baseSceneZ) |
                                                                                0;
                                                                            if (
                                                                                Math.abs(dx) <=
                                                                                    32 &&
                                                                                Math.abs(dz) <= 32
                                                                            ) {
                                                                                out.push({
                                                                                    sceneX,
                                                                                    sceneZ,
                                                                                    dx,
                                                                                    dz,
                                                                                });
                                                                                if (out.length >= 6)
                                                                                    break;
                                                                            }
                                                                        }
                                                                        return out;
                                                                    };
                                                                    const tsInferred = bestNear({
                                                                        x: tsVertex.x | 0,
                                                                        z: tsVertex.z | 0,
                                                                    });
                                                                    const cppInferred = bestNear({
                                                                        x: cacheVertex.x | 0,
                                                                        z: cacheVertex.z | 0,
                                                                    });
                                                                    console.error(
                                                                        "  inferred-translation base=(" +
                                                                            baseSceneX +
                                                                            "," +
                                                                            baseSceneZ +
                                                                            ") ts=" +
                                                                            JSON.stringify(
                                                                                tsInferred,
                                                                            ) +
                                                                            " cpp=" +
                                                                            JSON.stringify(
                                                                                cppInferred,
                                                                            ),
                                                                    );
                                                                }
                                                            } catch (e) {
                                                                console.error(
                                                                    "  inferred-translation failed: " +
                                                                        String(e),
                                                                );
                                                            }
                                                        }
                                                    } catch (e) {
                                                        console.error(
                                                            "  contour-baseline HIT failed: " +
                                                                String(e),
                                                        );
                                                    }

                                                    // Compare placement-mutated loc model vertices (before contour/lighting) TS vs C++.
                                                    try {
                                                        const tsLocMd =
                                                            locModelLoader.getLocModelData(
                                                                resolved,
                                                                hitPlacementType as any,
                                                                hitRotation,
                                                            );
                                                        const tsLocSample = (() => {
                                                            if (!(tsLocMd instanceof ModelData)) {
                                                                return undefined;
                                                            }
                                                            const n = Math.min(
                                                                32,
                                                                tsLocMd.verticesX?.length ?? 0,
                                                                tsLocMd.verticesY?.length ?? 0,
                                                                tsLocMd.verticesZ?.length ?? 0,
                                                            );
                                                            const xyz: number[] = [];
                                                            for (let i = 0; i < n; i++) {
                                                                xyz.push(
                                                                    (tsLocMd.verticesX[i] ?? 0) | 0,
                                                                    (tsLocMd.verticesY[i] ?? 0) | 0,
                                                                    (tsLocMd.verticesZ[i] ?? 0) | 0,
                                                                );
                                                            }
                                                            return {
                                                                version:
                                                                    (tsLocMd as any).version | 0,
                                                                verticesCount:
                                                                    tsLocMd.verticesCount | 0,
                                                                usedVertexCount:
                                                                    tsLocMd.usedVertexCount | 0,
                                                                faceCount: tsLocMd.faceCount | 0,
                                                                written: n | 0,
                                                                xyzTriplets: toTriplets(xyz),
                                                            };
                                                        })();
                                                        const cppLocSample =
                                                            typeof bridge.debugGetRuntimeLocModelVerticesSample ===
                                                            "function"
                                                                ? await bridge.debugGetRuntimeLocModelVerticesSample(
                                                                      runtimeHandle,
                                                                      hitLocId,
                                                                      hitPlacementType,
                                                                      hitRotation,
                                                                      modelId,
                                                                  )
                                                                : undefined;
                                                        const cppLocSampleSummary = cppLocSample
                                                            ? {
                                                                  version: cppLocSample.version | 0,
                                                                  verticesCount:
                                                                      cppLocSample.verticesCount |
                                                                      0,
                                                                  usedVertexCount:
                                                                      cppLocSample.usedVertexCount |
                                                                      0,
                                                                  faceCount:
                                                                      cppLocSample.faceCount | 0,
                                                                  written: cppLocSample.written | 0,
                                                                  xyzTriplets: toTriplets(
                                                                      Array.from(cppLocSample.xyz),
                                                                  ),
                                                              }
                                                            : undefined;
                                                        console.error(
                                                            `  loc-model-vertices-sample HIT loc=${hitLocId} modelId=${modelId} ts=${JSON.stringify(
                                                                tsLocSample,
                                                            )} cpp=${JSON.stringify(
                                                                cppLocSampleSummary,
                                                            )}`,
                                                        );

                                                        // Infer the effective sampled height from the mismatched packed vertex,
                                                        // and compare it to TS Scene.getHeightInterpolated at the expected worldX/Z.
                                                        try {
                                                            const runtimeLocMergeDecisionEntries =
                                                                parseRuntimeLocMergeDecisionEntriesPacked(
                                                                    cacheLocMergeDecisionEntriesPacked,
                                                                );
                                                            const group =
                                                                runtimeLocMergeDecisionEntries
                                                                    ?.filter((e) => {
                                                                        return (
                                                                            (e.locTypeId | 0) ===
                                                                                hitLocId &&
                                                                            (e.placementType |
                                                                                0) ===
                                                                                hitPlacementType &&
                                                                            (e.placementRotation |
                                                                                0) ===
                                                                                hitRotation &&
                                                                            (e.level | 0) ===
                                                                                hitLevel &&
                                                                            (e.chosenGroupIndex |
                                                                                0) ===
                                                                                (hit.groupIndex | 0)
                                                                        );
                                                                    })
                                                                    .sort(
                                                                        (a, b) =>
                                                                            (a.placementOrder | 0) -
                                                                            (b.placementOrder | 0),
                                                                    );
                                                            const decision =
                                                                group &&
                                                                (hit.instanceIndex | 0) >= 0 &&
                                                                (hit.instanceIndex | 0) <
                                                                    group.length
                                                                    ? group[hit.instanceIndex | 0]
                                                                    : undefined;
                                                            if (!decision) {
                                                                console.error(
                                                                    "  height-infer HIT: could not resolve decision entry for grp/inst",
                                                                );
                                                                return;
                                                            }

                                                            const startEl = hit.startElement | 0;
                                                            const elCount = hit.elements | 0;
                                                            if (
                                                                !(
                                                                    tsData.indices instanceof
                                                                        Int32Array &&
                                                                    packet.indices instanceof
                                                                        Int32Array &&
                                                                    startEl >= 0 &&
                                                                    elCount > 0 &&
                                                                    startEl + elCount <=
                                                                        tsData.indices
                                                                            .length &&
                                                                    startEl + elCount <=
                                                                        packet.indices.length
                                                                )
                                                            ) {
                                                                console.error(
                                                                    "  height-infer HIT: indices range out of bounds",
                                                                );
                                                                return;
                                                            }
                                                            const seg = packet.indices.subarray(
                                                                startEl,
                                                                startEl + elCount,
                                                            );
                                                            const uniq: number[] = [];
                                                            const seen = new Set<number>();
                                                            for (let i = 0; i < seg.length; i++) {
                                                                const v = seg[i] | 0;
                                                                if (!seen.has(v)) {
                                                                    seen.add(v);
                                                                    uniq.push(v);
                                                                }
                                                            }
                                                            let min = 0;
                                                            let max = 0;
                                                            if (uniq.length > 0) {
                                                                min = uniq[0] | 0;
                                                                max = uniq[0] | 0;
                                                                for (
                                                                    let i = 1;
                                                                    i < uniq.length;
                                                                    i++
                                                                ) {
                                                                    const v = uniq[i] | 0;
                                                                    if (v < min) min = v;
                                                                    if (v > max) max = v;
                                                                }
                                                            }
                                                            const contiguous =
                                                                uniq.length > 0 &&
                                                                ((max - min + 1) | 0) ===
                                                                    (uniq.length | 0);
                                                            const localIdx = contiguous
                                                                ? (vertexIndex - min) | 0
                                                                : -1;
                                                            console.error(
                                                                `  height-infer HIT: emitRange startEl=${startEl} elements=${elCount} uniqVerts=${uniq.length} vMin=${min} vMax=${max} contiguous=${contiguous} localIdx=${localIdx}`,
                                                            );
                                                            if (
                                                                !(tsLocMd instanceof ModelData) ||
                                                                localIdx < 0
                                                            ) {
                                                                return;
                                                            }
                                                            if (
                                                                localIdx >=
                                                                    (tsLocMd.verticesX?.length ??
                                                                        0) ||
                                                                localIdx >=
                                                                    (tsLocMd.verticesY?.length ??
                                                                        0) ||
                                                                localIdx >=
                                                                    (tsLocMd.verticesZ?.length ?? 0)
                                                            ) {
                                                                return;
                                                            }
                                                            const baseY =
                                                                (tsLocMd.verticesY[localIdx] ?? 0) |
                                                                0;
                                                            const localX =
                                                                (tsLocMd.verticesX[localIdx] ?? 0) |
                                                                0;
                                                            const localZ =
                                                                (tsLocMd.verticesZ[localIdx] ?? 0) |
                                                                0;
                                                            // Merged-dummy path bakes placement height into vertex Y; infer the sampled terrain height as (y - baseY).
                                                            const hFromTsVertex =
                                                                ((tsVertex.y | 0) - baseY) | 0;
                                                            const hFromCacheVertex =
                                                                ((cacheVertex.y | 0) - baseY) | 0;

                                                            const worldX =
                                                                ((decision.contourSceneX | 0) +
                                                                    localX) |
                                                                0;
                                                            const worldZ =
                                                                ((decision.contourSceneZ | 0) +
                                                                    localZ) |
                                                                0;
                                                            const scene =
                                                                buildSceneFromMapBytesProvider(
                                                                    sceneBuilder,
                                                                    mapBytesProvider,
                                                                    (sceneBuildInput.baseX as number) |
                                                                        0,
                                                                    (sceneBuildInput.baseY as number) |
                                                                        0,
                                                                    (sceneBuildInput.sizeX as number) |
                                                                        0,
                                                                    (sceneBuildInput.sizeY as number) |
                                                                        0,
                                                                    !!sceneBuildInput.smoothTerrain,
                                                                    LocLoadType.NO_MODELS,
                                                                );
                                                            const hTs =
                                                                scene.getHeightInterpolated(
                                                                    hitLevel | 0,
                                                                    worldX,
                                                                    worldZ,
                                                                ) | 0;
                                                            const hTsAtPackedVertex =
                                                                scene.getHeightInterpolated(
                                                                    hitLevel | 0,
                                                                    tsVertex.x | 0,
                                                                    tsVertex.z | 0,
                                                                ) | 0;
                                                            let bestDx = 0;
                                                            let bestDz = 0;
                                                            let bestDist = 0x7fffffff;
                                                            let hitCount = 0;
                                                            const R = 128;
                                                            for (let dz = -R; dz <= R; dz++) {
                                                                for (let dx = -R; dx <= R; dx++) {
                                                                    const hh =
                                                                        scene.getHeightInterpolated(
                                                                            hitLevel | 0,
                                                                            (worldX + dx) | 0,
                                                                            (worldZ + dz) | 0,
                                                                        ) | 0;
                                                                    if (
                                                                        (hh | 0) ===
                                                                        (hFromCacheVertex | 0)
                                                                    ) {
                                                                        hitCount++;
                                                                        const dist =
                                                                            ((dx * dx) | 0) +
                                                                            ((dz * dz) | 0);
                                                                        if (
                                                                            (dist | 0) <
                                                                            (bestDist | 0)
                                                                        ) {
                                                                            bestDist = dist | 0;
                                                                            bestDx = dx | 0;
                                                                            bestDz = dz | 0;
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                            console.error(
                                                                `  height-infer HIT: local=(${localX},${baseY},${localZ}) world=(${worldX},${worldZ}) hTs=${hTs} hTsAtPackedVertex=${hTsAtPackedVertex} hFromTsVertex=${hFromTsVertex} hFromCacheVertex=${hFromCacheVertex} cacheHeightHits=${hitCount} bestOffset=(${bestDx},${bestDz}) bestDist2=${bestDist}`,
                                                            );

                                                            // Ask C++ to probe the bilinear height sample at the expected world coordinate.
                                                            try {
                                                                if (
                                                                    typeof (bridge as any)
                                                                        .debugSetWorldHeightProbe ===
                                                                        "function" &&
                                                                    typeof (bridge as any)
                                                                        .debugGetRuntimeLastWorldHeightProbe ===
                                                                        "function" &&
                                                                    typeof bridge.buildMapPacketFromCache ===
                                                                        "function" &&
                                                                    request
                                                                ) {
                                                                    const probeX = tsVertex.x | 0;
                                                                    const probeZ = tsVertex.z | 0;
                                                                    await (
                                                                        bridge as any
                                                                    ).debugSetWorldHeightProbe(
                                                                        runtimeHandle,
                                                                        hitLevel | 0,
                                                                        probeX,
                                                                        probeZ,
                                                                    );
                                                                    await bridge.buildMapPacketFromCache(
                                                                        runtimeHandle,
                                                                        request,
                                                                    );
                                                                    const probe = await (
                                                                        bridge as any
                                                                    ).debugGetRuntimeLastWorldHeightProbe(
                                                                        runtimeHandle,
                                                                    );
                                                                    console.error(
                                                                        `  cpp world-height-probe(level=${
                                                                            hitLevel | 0
                                                                        }, world=(${probeX},${probeZ})) -> ${JSON.stringify(
                                                                            probe,
                                                                        )}`,
                                                                    );
                                                                    if (
                                                                        (probe?.rawHit | 0) === 0 &&
                                                                        ((bestDx | 0) !== 0 ||
                                                                            (bestDz | 0) !== 0)
                                                                    ) {
                                                                        const altX =
                                                                            (probeX + bestDx) | 0;
                                                                        const altZ =
                                                                            (probeZ + bestDz) | 0;
                                                                        await (
                                                                            bridge as any
                                                                        ).debugSetWorldHeightProbe(
                                                                            runtimeHandle,
                                                                            hitLevel | 0,
                                                                            altX,
                                                                            altZ,
                                                                        );
                                                                        await bridge.buildMapPacketFromCache(
                                                                            runtimeHandle,
                                                                            request,
                                                                        );
                                                                        const alt = await (
                                                                            bridge as any
                                                                        ).debugGetRuntimeLastWorldHeightProbe(
                                                                            runtimeHandle,
                                                                        );
                                                                        console.error(
                                                                            `  cpp world-height-probe ALT(bestOffset=(${
                                                                                bestDx | 0
                                                                            },${
                                                                                bestDz | 0
                                                                            })) world=(${altX},${altZ}) -> ${JSON.stringify(
                                                                                alt,
                                                                            )}`,
                                                                        );
                                                                    }
                                                                }
                                                            } catch (e) {
                                                                console.error(
                                                                    "  cpp world-height-probe HIT failed: " +
                                                                        String(e),
                                                                );
                                                            }
                                                        } catch (e) {
                                                            console.error(
                                                                "  height-infer HIT failed: " +
                                                                    String(e),
                                                            );
                                                        }
                                                    } catch (e) {
                                                        console.error(
                                                            "  loc-model-vertices-sample HIT failed: " +
                                                                String(e),
                                                        );
                                                    }
                                                } else {
                                                    console.error(
                                                        `  model-vertices-digest HIT: could not resolve modelId for loc=${hitLocId} type=${hitPlacementType}`,
                                                    );
                                                }
                                            }
                                        } catch (e) {
                                            console.error(
                                                `  model-vertices-digest HIT failed: ${String(e)}`,
                                            );
                                        }
                                    } else {
                                        console.error(
                                            "  loc-merge-emit: no entry matched elementIndex=" +
                                                (elementIndex | 0),
                                        );
                                    }

                                    const findCommandIndexForElement = (
                                        cmdOffsets: Int32Array,
                                        cmdElements: Int32Array,
                                        targetElement: number,
                                    ): number => {
                                        for (let i = 0; i < cmdOffsets.length; i++) {
                                            const start = ((cmdOffsets[i] | 0) >> 2) | 0;
                                            const count =
                                                i < cmdElements.length ? cmdElements[i] | 0 : 0;
                                            if (count <= 0) continue;
                                            const end = (start + count) | 0;
                                            if (targetElement >= start && targetElement < end) {
                                                return i;
                                            }
                                        }
                                        return -1;
                                    };

                                    const tsCmdIndex = findCommandIndexForElement(
                                        tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                        tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                        elementIndex,
                                    );
                                    const cacheCmdIndex = findCommandIndexForElement(
                                        cacheCmdArraysAfter.cmdOffsets,
                                        cacheCmdArraysAfter.cmdElements,
                                        elementIndex,
                                    );
                                    console.error(
                                        "  vertex mismatch maps to element=" +
                                            elementIndex +
                                            " tsCmd=" +
                                            tsCmdIndex +
                                            " cacheCmd=" +
                                            cacheCmdIndex +
                                            " tsElem=" +
                                            tsElementIndex +
                                            " cacheElem=" +
                                            cacheElementIndex,
                                    );

                                    // If the mismatched vertex is referenced multiple times, show which commands/triangles touch it.
                                    if (elementCandidates.length > 0) {
                                        for (let i = 0; i < elementCandidates.length; i++) {
                                            const e = elementCandidates[i] | 0;
                                            const tci = findCommandIndexForElement(
                                                tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                                tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                                e,
                                            );
                                            const cci = findCommandIndexForElement(
                                                cacheCmdArraysAfter.cmdOffsets,
                                                cacheCmdArraysAfter.cmdElements,
                                                e,
                                            );
                                            const prov =
                                                runtimeCommandProvenanceEntries &&
                                                cci >= 0 &&
                                                cci < runtimeCommandProvenanceEntries.length
                                                    ? runtimeCommandProvenanceEntries[cci]
                                                    : undefined;
                                            console.error(
                                                `  vertexRef[${i}] element=${e} tsCmd=${tci} cacheCmd=${cci}` +
                                                    ` prov=${
                                                        prov
                                                            ? summarizeRuntimeCommandProvenanceEntriesAtIndices(
                                                                  runtimeCommandProvenanceEntries,
                                                                  [cci],
                                                              )[0]
                                                            : "n/a"
                                                    }`,
                                            );
                                            dumpTriangleAtElement(
                                                "ts",
                                                tsData.vertices,
                                                tsData.indices,
                                                e,
                                            );
                                            dumpTriangleAtElement(
                                                "cache",
                                                packet.vertices,
                                                packet.indices,
                                                e,
                                            );
                                        }
                                    }

                                    if (runtimeCommandProvenanceEntries) {
                                        const cacheSourceCmd = (() => {
                                            for (
                                                let ci = 0;
                                                ci < cacheCmdArraysAfter.cmdOffsets.length &&
                                                ci < cacheCmdArraysAfter.cmdElements.length;
                                                ci++
                                            ) {
                                                const start =
                                                    ((cacheCmdArraysAfter.cmdOffsets[ci] | 0) >>
                                                        2) |
                                                    0;
                                                const count =
                                                    cacheCmdArraysAfter.cmdElements[ci] | 0;
                                                if (count <= 0) {
                                                    continue;
                                                }
                                                const end = (start + count) | 0;
                                                if (
                                                    !(elementIndex >= start && elementIndex < end)
                                                ) {
                                                    continue;
                                                }
                                                const prov =
                                                    ci >= 0 &&
                                                    ci < runtimeCommandProvenanceEntries.length
                                                        ? runtimeCommandProvenanceEntries[ci]
                                                        : undefined;
                                                if (!prov || (prov.sourceKind | 0) !== 3) {
                                                    continue;
                                                }
                                                return ci | 0;
                                            }
                                            return -1;
                                        })();
                                        if (cacheSourceCmd >= 0) {
                                            console.error(
                                                "  " +
                                                    describeCommandAtIndex(
                                                        "cache-source",
                                                        cacheCmdArraysAfter.cmdBucketIndices,
                                                        cacheCmdArraysAfter.cmdOffsets,
                                                        cacheCmdArraysAfter.cmdElements,
                                                        cacheCmdArraysAfter.cmdInstanceCounts,
                                                        cacheCmdArraysAfter.cmdPackedInstances,
                                                        cacheSourceCmd,
                                                    ),
                                            );
                                            const sourceProvLines =
                                                summarizeRuntimeCommandProvenanceEntriesAtIndices(
                                                    runtimeCommandProvenanceEntries,
                                                    [cacheSourceCmd],
                                                );
                                            for (let pi = 0; pi < sourceProvLines.length; pi++) {
                                                console.error(sourceProvLines[pi]);
                                            }
                                            const sourceProv =
                                                cacheSourceCmd >= 0 &&
                                                cacheSourceCmd <
                                                    runtimeCommandProvenanceEntries.length
                                                    ? runtimeCommandProvenanceEntries[
                                                          cacheSourceCmd
                                                      ]
                                                    : undefined;
                                            const sourceLocTypeId = sourceProv?.locTypeId ?? -1;
                                            if (sourceLocTypeId >= 0) {
                                                await summarizeRuntimeLocTypeDecodeDiff(
                                                    [sourceLocTypeId],
                                                    sceneBuilder,
                                                    bridge,
                                                    runtimeHandle,
                                                );
                                                const sourceTsModelHashStats =
                                                    collectTsLocModelHashStats(
                                                        sceneBuilder,
                                                        mapBytesProvider,
                                                        sceneBuildInput,
                                                        input.maxLevel | 0,
                                                        locModelLoader,
                                                        [sourceLocTypeId],
                                                    );
                                                const sourceTsModelHashLines =
                                                    summarizeTsLocModelHashStats(
                                                        sourceTsModelHashStats,
                                                        "vertex-mismatch-source",
                                                        12,
                                                    );
                                                for (
                                                    let li = 0;
                                                    li < sourceTsModelHashLines.length;
                                                    li++
                                                ) {
                                                    console.error(sourceTsModelHashLines[li]);
                                                }
                                                const sourceMergeDecisionEntries =
                                                    parseRuntimeLocMergeDecisionEntriesPacked(
                                                        cacheLocMergeDecisionEntriesPacked,
                                                    );
                                                const sourceMergeDecisionLines =
                                                    summarizeRuntimeLocMergeDecisionEntries(
                                                        sourceMergeDecisionEntries,
                                                        [sourceLocTypeId],
                                                    );
                                                for (
                                                    let li = 0;
                                                    li < sourceMergeDecisionLines.length;
                                                    li++
                                                ) {
                                                    console.error(sourceMergeDecisionLines[li]);
                                                }
                                            }
                                        }
                                    }
                                    if (tsCmdIndex >= 0) {
                                        console.error(
                                            "  " +
                                                describeCommandAtIndex(
                                                    "ts",
                                                    tsBridgeInput.runtimeCommandStreamInput
                                                        .cmdBucketIndices,
                                                    tsBridgeInput.runtimeCommandStreamInput
                                                        .cmdOffsets,
                                                    tsBridgeInput.runtimeCommandStreamInput
                                                        .cmdElements,
                                                    tsBridgeInput.runtimeCommandStreamInput
                                                        .cmdInstanceCounts,
                                                    tsBridgeInput.runtimeCommandStreamInput
                                                        .cmdPackedInstances,
                                                    tsCmdIndex,
                                                ),
                                        );
                                    }
                                    if (cacheCmdIndex >= 0) {
                                        console.error(
                                            "  " +
                                                describeCommandAtIndex(
                                                    "cache",
                                                    cacheCmdArraysAfter.cmdBucketIndices,
                                                    cacheCmdArraysAfter.cmdOffsets,
                                                    cacheCmdArraysAfter.cmdElements,
                                                    cacheCmdArraysAfter.cmdInstanceCounts,
                                                    cacheCmdArraysAfter.cmdPackedInstances,
                                                    cacheCmdIndex,
                                                ),
                                        );
                                    }
                                    const vertexProvLines =
                                        summarizeRuntimeCommandProvenanceEntriesAtIndices(
                                            runtimeCommandProvenanceEntries,
                                            [tsCmdIndex, cacheCmdIndex].filter((v) => v >= 0),
                                        );
                                    for (let pi = 0; pi < vertexProvLines.length; pi++) {
                                        console.error(vertexProvLines[pi]);
                                    }
                                    if (tsCmdIndex >= 0 && cacheCmdIndex >= 0) {
                                        const tsStart =
                                            ((tsBridgeInput.runtimeCommandStreamInput.cmdOffsets[
                                                tsCmdIndex
                                            ] |
                                                0) >>
                                                2) |
                                            0;
                                        const tsCount =
                                            tsBridgeInput.runtimeCommandStreamInput.cmdElements[
                                                tsCmdIndex
                                            ] | 0;
                                        const cacheStart =
                                            ((cacheCmdArraysAfter.cmdOffsets[cacheCmdIndex] | 0) >>
                                                2) |
                                            0;
                                        const cacheCount =
                                            cacheCmdArraysAfter.cmdElements[cacheCmdIndex] | 0;
                                        const compareCount = Math.min(tsCount, cacheCount) | 0;

                                        let yMismatchCount = 0;
                                        const yDeltaCounts = new Map<number, number>();
                                        for (let e = 0; e < compareCount; e++) {
                                            const tsElement = (tsStart + e) | 0;
                                            const cacheElement = (cacheStart + e) | 0;
                                            if (
                                                tsElement < 0 ||
                                                cacheElement < 0 ||
                                                tsElement >= tsData.indices.length ||
                                                cacheElement >= packet.indices.length
                                            ) {
                                                continue;
                                            }
                                            const tsVertexIndex =
                                                tsData.indices[tsElement] | 0;
                                            const cacheVertexIndex =
                                                packet.indices[cacheElement] | 0;
                                            if (
                                                tsVertexIndex < 0 ||
                                                cacheVertexIndex < 0 ||
                                                tsVertexIndex * 16 + 15 >=
                                                    tsData.vertices.length ||
                                                cacheVertexIndex * 16 + 15 >= packet.vertices.length
                                            ) {
                                                continue;
                                            }
                                            const tsY =
                                                decodePackedVertexDebug(
                                                    tsData.vertices,
                                                    tsVertexIndex,
                                                ).y | 0;
                                            const cacheY =
                                                decodePackedVertexDebug(
                                                    packet.vertices,
                                                    cacheVertexIndex,
                                                ).y | 0;
                                            if (tsY !== cacheY) {
                                                yMismatchCount++;
                                                const deltaY = (tsY - cacheY) | 0;
                                                yDeltaCounts.set(
                                                    deltaY,
                                                    (yDeltaCounts.get(deltaY) ?? 0) + 1,
                                                );
                                            }
                                        }
                                        const topYDelta = Array.from(yDeltaCounts.entries())
                                            .sort((a, b) => b[1] - a[1])
                                            .slice(0, 5)
                                            .map(([deltaY, count]) => ({ deltaY, count }));
                                        console.error(
                                            "  command y-delta summary tsCmd=" +
                                                tsCmdIndex +
                                                " cacheCmd=" +
                                                cacheCmdIndex +
                                                " compareElements=" +
                                                compareCount +
                                                " yMismatchCount=" +
                                                yMismatchCount +
                                                " top=" +
                                                JSON.stringify(topYDelta),
                                        );
                                    }
                                }
                            }

                            try {
                                const overlayTypeId = 5;
                                const tsOverlay =
                                    sceneBuilder.services.overlayTypeLoader.tryLoad(overlayTypeId);
                                const tsOverlayInfo = tsOverlay.ok
                                    ? {
                                          primaryHsl: tsOverlay.value.primaryHsl | 0,
                                          blendHsl: tsOverlay.value.blendHsl | 0,
                                          textureId: tsOverlay.value.textureId | 0,
                                          secondaryTextureId:
                                              tsOverlay.value.secondaryTextureId | 0,
                                          blendable: !!tsOverlay.value.blendable,
                                          blendPriority: tsOverlay.value.blendPriority | 0,
                                      }
                                    : { ok: false };
                                const cppOverlayInfo =
                                    typeof bridge.debugDecodeRuntimeOverlayType === "function"
                                        ? await bridge.debugDecodeRuntimeOverlayType(
                                              runtimeHandle,
                                              overlayTypeId,
                                          )
                                        : undefined;
                                console.error(
                                    `  overlay-type id=5 ts=${JSON.stringify(
                                        tsOverlayInfo,
                                    )} cpp=${JSON.stringify(cppOverlayInfo)}`,
                                );
                            } catch (e) {
                                console.error(`  overlay-type debug failed: ${String(e)}`);
                            }
                            const borderTiles = (((sceneBuildInput.sizeX as number) - 64) / 2) | 0;
                            if (borderTiles >= 0) {
                                const tsTile = tileFromVertexPos(tsVertex, borderTiles);
                                const cacheTile = tileFromVertexPos(cacheVertex, borderTiles);
                                console.error(
                                    `  first vertex-byte mismatch tile ts=${JSON.stringify(
                                        tsTile,
                                    )} cache=${JSON.stringify(cacheTile)}`,
                                );
                                // If available, re-run the runtime build with a terrain probe enabled for tiles around
                                // this vertex so we can diff overlay base-HSL sampling decisions against TS.
                                const runtimeTerrainProbesByTile = new Map<
                                    string,
                                    {
                                        hit: boolean;
                                        level: number;
                                        tileX: number;
                                        tileY: number;
                                        packed: Int32Array;
                                    }
                                >();
                                try {
                                    // Terrain vertex debug currently keys off a single level. The first mismatch we're
                                    // chasing is level=0 terrain (cmd[0]); keep this simple.
                                    const probeLevel = 0;
                                    if (
                                        typeof bridge.debugSetTerrainProbe === "function" &&
                                        typeof bridge.debugGetRuntimeLastTerrainProbe ===
                                            "function" &&
                                        typeof bridge.buildMapPacketFromCache === "function" &&
                                        request
                                    ) {
                                        const baseX = tsTile.tileX | 0;
                                        const baseY = tsTile.tileY | 0;
                                        for (let dx = -1; dx <= 0; dx++) {
                                            for (let dy = -1; dy <= 0; dy++) {
                                                const px = (baseX + dx) | 0;
                                                const py = (baseY + dy) | 0;
                                                await bridge.debugSetTerrainProbe(
                                                    runtimeHandle,
                                                    probeLevel,
                                                    px,
                                                    py,
                                                );
                                                // Rebuild to populate lastBuiltCommandStream.debugTerrainProbePacked.
                                                await bridge.buildMapPacketFromCache(
                                                    runtimeHandle,
                                                    request,
                                                );
                                                const probe =
                                                    await bridge.debugGetRuntimeLastTerrainProbe(
                                                        runtimeHandle,
                                                    );
                                                if (
                                                    probe?.hit &&
                                                    (probe.level | 0) === probeLevel
                                                ) {
                                                    runtimeTerrainProbesByTile.set(
                                                        `${probe.tileX | 0},${probe.tileY | 0}`,
                                                        probe,
                                                    );
                                                }
                                            }
                                        }
                                    }
                                } catch (e) {
                                    console.error(
                                        `  runtime terrain-probe debug failed: ${String(e)}`,
                                    );
                                    runtimeTerrainProbesByTile.clear();
                                }
                                try {
                                    const tsScene = buildSceneFromMapBytesProvider(
                                        sceneBuilder,
                                        mapBytesProvider,
                                        (sceneBuildInput.baseX as number) | 0,
                                        (sceneBuildInput.baseY as number) | 0,
                                        (sceneBuildInput.sizeX as number) | 0,
                                        (sceneBuildInput.sizeY as number) | 0,
                                        !!sceneBuildInput.smoothTerrain,
                                        LocLoadType.MODELS,
                                    );
                                    const tx = tsTile.tileX | 0;
                                    const ty = tsTile.tileY | 0;
                                    const read3 = (
                                        arr: unknown,
                                        l: number,
                                        x: number,
                                        y: number,
                                    ): number => {
                                        const levelArr = (arr as unknown as ArrayLike<unknown>)?.[
                                            l
                                        ] as ArrayLike<unknown> | undefined;
                                        const xArr = levelArr?.[x] as
                                            | ArrayLike<unknown>
                                            | undefined;
                                        const v = xArr?.[y] as number | undefined;
                                        return (v ?? 0) | 0;
                                    };
                                    const sceneVertexOffset = (borderTiles * -128) | 0;
                                    for (let level = 0; level < tsScene.levels; level++) {
                                        if (
                                            tx < 0 ||
                                            ty < 0 ||
                                            tx >= tsScene.sizeX ||
                                            ty >= tsScene.sizeY
                                        ) {
                                            continue;
                                        }
                                        const lights = tsScene.calculateTileLights(level);
                                        const lightSw =
                                            ((lights[tx] as Int32Array | undefined)?.[ty] ?? 0) | 0;
                                        const lightSe =
                                            ((lights[tx + 1] as Int32Array | undefined)?.[ty] ??
                                                0) | 0;
                                        const lightNe =
                                            ((lights[tx + 1] as Int32Array | undefined)?.[ty + 1] ??
                                                0) | 0;
                                        const lightNw =
                                            ((lights[tx] as Int32Array | undefined)?.[ty + 1] ??
                                                0) | 0;
                                        const occW =
                                            ((
                                                tsScene.tileLightOcclusions[level]?.[tx - 1] as
                                                    | Uint8Array
                                                    | undefined
                                            )?.[ty] ?? 0) | 0;
                                        const occS =
                                            ((
                                                tsScene.tileLightOcclusions[level]?.[tx] as
                                                    | Uint8Array
                                                    | undefined
                                            )?.[ty - 1] ?? 0) | 0;
                                        const occE =
                                            ((
                                                tsScene.tileLightOcclusions[level]?.[tx + 1] as
                                                    | Uint8Array
                                                    | undefined
                                            )?.[ty] ?? 0) | 0;
                                        const occN =
                                            ((
                                                tsScene.tileLightOcclusions[level]?.[tx] as
                                                    | Uint8Array
                                                    | undefined
                                            )?.[ty + 1] ?? 0) | 0;
                                        const occC =
                                            ((
                                                tsScene.tileLightOcclusions[level]?.[tx] as
                                                    | Uint8Array
                                                    | undefined
                                            )?.[ty] ?? 0) | 0;
                                        const occWeighted =
                                            ((occW >> 2) +
                                                (occS >> 2) +
                                                (occE >> 3) +
                                                (occN >> 3) +
                                                (occC >> 1)) |
                                            0;
                                        console.error(
                                            `  ts tile occ level=${level} x=${tx} y=${ty} raw=[${occW},${occS},${occE},${occN},${occC}] weighted=${occWeighted}`,
                                        );
                                        console.error(
                                            `  ts tile context level=${level} x=${tx} y=${ty} underlay=${read3(
                                                tsScene.tileUnderlays,
                                                level,
                                                tx,
                                                ty,
                                            )} overlay=${read3(
                                                tsScene.tileOverlays,
                                                level,
                                                tx,
                                                ty,
                                            )} shape=${read3(
                                                tsScene.tileShapes,
                                                level,
                                                tx,
                                                ty,
                                            )} rot=${read3(
                                                tsScene.tileRotations,
                                                level,
                                                tx,
                                                ty,
                                            )} lightSw=${lightSw} lightSe=${lightSe} lightNe=${lightNe} lightNw=${lightNw}`,
                                        );
                                        const tile = tsScene.tiles[level][tx][ty];
                                        if (tile?.tileModel) {
                                            const model = tile.tileModel;
                                            console.error(
                                                `  ts tile model hsl level=${level} underlay=[${model.underlayHslSw},${model.underlayHslSe},${model.underlayHslNe},${model.underlayHslNw}] overlay=[${model.overlayHslSw},${model.overlayHslSe},${model.overlayHslNe},${model.overlayHslNw}]`,
                                            );
                                            const runtimeTerrainProbe =
                                                runtimeTerrainProbesByTile.get(
                                                    `${tx | 0},${ty | 0}`,
                                                );
                                            if (
                                                runtimeTerrainProbe?.hit &&
                                                (runtimeTerrainProbe.level | 0) === (level | 0)
                                            ) {
                                                const p = runtimeTerrainProbe.packed;
                                                const clampLight = (v: number): number => {
                                                    v |= 0;
                                                    if (v < 2) return 2;
                                                    if (v > 126) return 126;
                                                    return v;
                                                };
                                                const adjustOverlayLightLocal = (
                                                    hsl: number,
                                                    light: number,
                                                ): number => {
                                                    hsl |= 0;
                                                    light |= 0;
                                                    if (hsl === -2) {
                                                        return 12345678;
                                                    }
                                                    if (hsl === -1) {
                                                        return clampLight(light);
                                                    }
                                                    let outLight = (((hsl & 127) * light) >> 7) | 0;
                                                    outLight = clampLight(outLight);
                                                    return ((hsl & 0xff80) + outLight) | 0;
                                                };
                                                const cornerBase = [
                                                    p[24] | 0,
                                                    p[25] | 0,
                                                    p[26] | 0,
                                                    p[27] | 0,
                                                ];
                                                const edgeBase = [
                                                    p[28] | 0,
                                                    p[29] | 0,
                                                    p[30] | 0,
                                                    p[31] | 0,
                                                ];
                                                const runtimeOverlayCornerHsl = [
                                                    adjustOverlayLightLocal(cornerBase[0], lightSw),
                                                    adjustOverlayLightLocal(cornerBase[1], lightSe),
                                                    adjustOverlayLightLocal(cornerBase[2], lightNe),
                                                    adjustOverlayLightLocal(cornerBase[3], lightNw),
                                                ];
                                                const lightS = ((lightSw + lightSe) >> 1) | 0;
                                                const lightE = ((lightSe + lightNe) >> 1) | 0;
                                                const lightN = ((lightNe + lightNw) >> 1) | 0;
                                                const lightW = ((lightNw + lightSw) >> 1) | 0;
                                                const runtimeOverlayEdgeHsl = [
                                                    adjustOverlayLightLocal(edgeBase[0], lightS),
                                                    adjustOverlayLightLocal(edgeBase[1], lightE),
                                                    adjustOverlayLightLocal(edgeBase[2], lightN),
                                                    adjustOverlayLightLocal(edgeBase[3], lightW),
                                                ];
                                                console.error(
                                                    `  runtime terrain-probe overlayBase corner=${JSON.stringify(
                                                        cornerBase,
                                                    )} edge=${JSON.stringify(edgeBase)}`,
                                                );
                                                console.error(
                                                    `  runtime terrain-probe overlayHsl corner=${JSON.stringify(
                                                        runtimeOverlayCornerHsl,
                                                    )} edge=${JSON.stringify(
                                                        runtimeOverlayEdgeHsl,
                                                    )}`,
                                                );
                                            }
                                        }
                                        for (let cx = tx - 1; cx <= tx; cx++) {
                                            for (let cy = ty - 1; cy <= ty; cy++) {
                                                if (
                                                    cx < 0 ||
                                                    cy < 0 ||
                                                    cx >= tsScene.sizeX ||
                                                    cy >= tsScene.sizeY
                                                ) {
                                                    continue;
                                                }
                                                const nTile = tsScene.tiles[level][cx][cy];
                                                const m = nTile?.tileModel;
                                                if (!m) {
                                                    continue;
                                                }
                                                const faces = m.faces
                                                    .map((f, i) => ({ i, f }))
                                                    .filter(({ f }) =>
                                                        f.vertices.some((v) => {
                                                            const worldX =
                                                                ((v.x | 0) + sceneVertexOffset) | 0;
                                                            const worldZ =
                                                                ((v.z | 0) + sceneVertexOffset) | 0;
                                                            return (
                                                                worldX === (tsVertex.x | 0) &&
                                                                (v.y | 0) === (tsVertex.y | 0) &&
                                                                worldZ === (tsVertex.z | 0)
                                                            );
                                                        }),
                                                    )
                                                    .slice(0, 2)
                                                    .map(({ i, f }) => ({
                                                        face: i,
                                                        verts: f.vertices.map((v) => ({
                                                            x: ((v.x | 0) + sceneVertexOffset) | 0,
                                                            y: v.y | 0,
                                                            z: ((v.z | 0) + sceneVertexOffset) | 0,
                                                            hsl: v.hsl | 0,
                                                            tex: v.textureId | 0,
                                                        })),
                                                    }));
                                                if (faces.length > 0) {
                                                    console.error(
                                                        `  ts shared-corner tile level=${level} x=${cx} y=${cy} underlay=${read3(
                                                            tsScene.tileUnderlays,
                                                            level,
                                                            cx,
                                                            cy,
                                                        )} overlay=${read3(
                                                            tsScene.tileOverlays,
                                                            level,
                                                            cx,
                                                            cy,
                                                        )} shape=${read3(
                                                            tsScene.tileShapes,
                                                            level,
                                                            cx,
                                                            cy,
                                                        )} rot=${read3(
                                                            tsScene.tileRotations,
                                                            level,
                                                            cx,
                                                            cy,
                                                        )} faces=${JSON.stringify(faces)}`,
                                                    );
                                                    const runtimeCornerProbe =
                                                        runtimeTerrainProbesByTile.get(
                                                            `${cx | 0},${cy | 0}`,
                                                        );
                                                    if (
                                                        runtimeCornerProbe?.hit &&
                                                        (runtimeCornerProbe.level | 0) ===
                                                            (level | 0)
                                                    ) {
                                                        const p = runtimeCornerProbe.packed;
                                                        const clampLight = (v: number): number => {
                                                            v |= 0;
                                                            if (v < 2) return 2;
                                                            if (v > 126) return 126;
                                                            return v;
                                                        };
                                                        const adjustOverlayLightLocal = (
                                                            hsl: number,
                                                            light: number,
                                                        ): number => {
                                                            hsl |= 0;
                                                            light |= 0;
                                                            if (hsl === -2) {
                                                                return 12345678;
                                                            }
                                                            if (hsl === -1) {
                                                                return clampLight(light);
                                                            }
                                                            let outLight =
                                                                (((hsl & 127) * light) >> 7) | 0;
                                                            outLight = clampLight(outLight);
                                                            return ((hsl & 0xff80) + outLight) | 0;
                                                        };
                                                        const cornerBase = [
                                                            p[24] | 0,
                                                            p[25] | 0,
                                                            p[26] | 0,
                                                            p[27] | 0,
                                                        ];
                                                        const edgeBase = [
                                                            p[28] | 0,
                                                            p[29] | 0,
                                                            p[30] | 0,
                                                            p[31] | 0,
                                                        ];
                                                        const lSw =
                                                            ((
                                                                lights[cx] as Int32Array | undefined
                                                            )?.[cy] ?? 0) | 0;
                                                        const lSe =
                                                            ((
                                                                lights[cx + 1] as
                                                                    | Int32Array
                                                                    | undefined
                                                            )?.[cy] ?? 0) | 0;
                                                        const lNe =
                                                            ((
                                                                lights[cx + 1] as
                                                                    | Int32Array
                                                                    | undefined
                                                            )?.[cy + 1] ?? 0) | 0;
                                                        const lNw =
                                                            ((
                                                                lights[cx] as Int32Array | undefined
                                                            )?.[cy + 1] ?? 0) | 0;
                                                        const overlayCornerHsl = [
                                                            adjustOverlayLightLocal(
                                                                cornerBase[0],
                                                                lSw,
                                                            ),
                                                            adjustOverlayLightLocal(
                                                                cornerBase[1],
                                                                lSe,
                                                            ),
                                                            adjustOverlayLightLocal(
                                                                cornerBase[2],
                                                                lNe,
                                                            ),
                                                            adjustOverlayLightLocal(
                                                                cornerBase[3],
                                                                lNw,
                                                            ),
                                                        ];
                                                        const lS = ((lSw + lSe) >> 1) | 0;
                                                        const lE = ((lSe + lNe) >> 1) | 0;
                                                        const lN = ((lNe + lNw) >> 1) | 0;
                                                        const lW = ((lNw + lSw) >> 1) | 0;
                                                        const overlayEdgeHsl = [
                                                            adjustOverlayLightLocal(
                                                                edgeBase[0],
                                                                lS,
                                                            ),
                                                            adjustOverlayLightLocal(
                                                                edgeBase[1],
                                                                lE,
                                                            ),
                                                            adjustOverlayLightLocal(
                                                                edgeBase[2],
                                                                lN,
                                                            ),
                                                            adjustOverlayLightLocal(
                                                                edgeBase[3],
                                                                lW,
                                                            ),
                                                        ];
                                                        console.error(
                                                            `  runtime shared-corner-probe tile level=${level} x=${cx} y=${cy} overlayBase corner=${JSON.stringify(
                                                                cornerBase,
                                                            )} edge=${JSON.stringify(edgeBase)}`,
                                                        );
                                                        console.error(
                                                            `  runtime shared-corner-probe tile level=${level} x=${cx} y=${cy} overlayHsl corner=${JSON.stringify(
                                                                overlayCornerHsl,
                                                            )} edge=${JSON.stringify(
                                                                overlayEdgeHsl,
                                                            )}`,
                                                        );
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    const globalMatches: Array<Record<string, number>> = [];
                                    for (let l = 0; l < tsScene.levels; l++) {
                                        for (let sx = 0; sx < tsScene.sizeX; sx++) {
                                            for (let sy = 0; sy < tsScene.sizeY; sy++) {
                                                const scanTile = tsScene.tiles[l][sx][sy];
                                                const scanModel = scanTile?.tileModel;
                                                if (!scanModel) {
                                                    continue;
                                                }
                                                let hit = false;
                                                for (
                                                    let fi = 0;
                                                    fi < scanModel.faces.length && !hit;
                                                    fi++
                                                ) {
                                                    const face = scanModel.faces[fi];
                                                    for (let vi = 0; vi < 3; vi++) {
                                                        const v = face.vertices[vi];
                                                        const worldX =
                                                            ((v.x | 0) + sceneVertexOffset) | 0;
                                                        const worldZ =
                                                            ((v.z | 0) + sceneVertexOffset) | 0;
                                                        if (
                                                            worldX === (tsVertex.x | 0) &&
                                                            (v.y | 0) === (tsVertex.y | 0) &&
                                                            worldZ === (tsVertex.z | 0)
                                                        ) {
                                                            hit = true;
                                                            break;
                                                        }
                                                    }
                                                }
                                                if (hit) {
                                                    globalMatches.push({
                                                        level: l,
                                                        x: sx,
                                                        y: sy,
                                                        underlay: read3(
                                                            tsScene.tileUnderlays,
                                                            l,
                                                            sx,
                                                            sy,
                                                        ),
                                                        overlay: read3(
                                                            tsScene.tileOverlays,
                                                            l,
                                                            sx,
                                                            sy,
                                                        ),
                                                        shape: read3(tsScene.tileShapes, l, sx, sy),
                                                        rot: read3(
                                                            tsScene.tileRotations,
                                                            l,
                                                            sx,
                                                            sy,
                                                        ),
                                                    });
                                                    if (globalMatches.length >= 12) {
                                                        break;
                                                    }
                                                }
                                            }
                                            if (globalMatches.length >= 12) {
                                                break;
                                            }
                                        }
                                        if (globalMatches.length >= 12) {
                                            break;
                                        }
                                    }
                                    if (globalMatches.length > 0) {
                                        console.error(
                                            `  ts global face matches for vertex=${JSON.stringify(
                                                globalMatches,
                                            )}`,
                                        );
                                    } else {
                                        console.error("  ts global face matches for vertex=[]");
                                    }
                                } catch (e) {
                                    console.error(`  ts tile context debug failed: ${String(e)}`);
                                }
                            }
                        }
                    }
                }
                if (mismatchKeys.includes("indices") && indicesDiffDetail) {
                    console.error("  indices diff: " + indicesDiffDetail);

                    const m = /idx=(\d+)/.exec(indicesDiffDetail);
                    if (m && cacheCmdArraysAfter && tsBridgeInput.runtimeCommandStreamInput) {
                        const elementIndex = Number(m[1]) | 0;
                        const findCommandIndexForElement = (
                            cmdOffsets: Int32Array,
                            cmdElements: Int32Array,
                            targetElement: number,
                        ): number => {
                            for (let i = 0; i < cmdOffsets.length; i++) {
                                const start = ((cmdOffsets[i] | 0) >> 2) | 0;
                                const count = i < cmdElements.length ? cmdElements[i] | 0 : 0;
                                if (count <= 0) continue;
                                const end = (start + count) | 0;
                                if (targetElement >= start && targetElement < end) {
                                    return i;
                                }
                            }
                            return -1;
                        };

                        const tsCmdIndex = findCommandIndexForElement(
                            tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                            tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                            elementIndex,
                        );
                        const cacheCmdIndex = findCommandIndexForElement(
                            cacheCmdArraysAfter.cmdOffsets,
                            cacheCmdArraysAfter.cmdElements,
                            elementIndex,
                        );

                        console.error(
                            "  indices mismatch command ts=" +
                                tsCmdIndex +
                                " cache=" +
                                cacheCmdIndex +
                                " element=" +
                                elementIndex,
                        );

                        if (tsCmdIndex >= 0) {
                            console.error(
                                "  " +
                                    describeCommandAtIndex(
                                        "ts",
                                        tsBridgeInput.runtimeCommandStreamInput.cmdBucketIndices,
                                        tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                        tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                        tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                        tsBridgeInput.runtimeCommandStreamInput.cmdPackedInstances,
                                        tsCmdIndex,
                                    ),
                            );
                        }
                        if (cacheCmdIndex >= 0) {
                            console.error(
                                "  " +
                                    describeCommandAtIndex(
                                        "cache",
                                        cacheCmdArraysAfter.cmdBucketIndices,
                                        cacheCmdArraysAfter.cmdOffsets,
                                        cacheCmdArraysAfter.cmdElements,
                                        cacheCmdArraysAfter.cmdInstanceCounts,
                                        cacheCmdArraysAfter.cmdPackedInstances,
                                        cacheCmdIndex,
                                    ),
                            );
                        }
                    }
                }
                if (
                    profile.name === "terrain-only" &&
                    indicesDiffDetail &&
                    tsData.vertices instanceof Uint8Array &&
                    packet.vertices instanceof Uint8Array &&
                    tsData.indices instanceof Int32Array &&
                    packet.indices instanceof Int32Array
                ) {
                    const m = /idx=(\d+)/.exec(indicesDiffDetail);
                    const idx = m ? Number(m[1]) | 0 : -1;
                    if (idx >= 0) {
                        const t = Math.floor(idx / 3) | 0;
                        const i0ts = tsData.indices[t * 3 + 0] | 0;
                        const i1ts = tsData.indices[t * 3 + 1] | 0;
                        const i2ts = tsData.indices[t * 3 + 2] | 0;
                        const i0c = packet.indices[t * 3 + 0] | 0;
                        const i1c = packet.indices[t * 3 + 1] | 0;
                        const i2c = packet.indices[t * 3 + 2] | 0;
                        const p0ts = decodePackedVertexPos(tsData.vertices, i0ts);
                        const p1ts = decodePackedVertexPos(tsData.vertices, i1ts);
                        const p2ts = decodePackedVertexPos(tsData.vertices, i2ts);
                        const p0c = decodePackedVertexPos(packet.vertices, i0c);
                        const p1c = decodePackedVertexPos(packet.vertices, i1c);
                        const p2c = decodePackedVertexPos(packet.vertices, i2c);
                        console.error(
                            `  terrain-only first indices tri t=${t} ts=[${i0ts},${i1ts},${i2ts}] cache=[${i0c},${i1c},${i2c}]`,
                        );
                        console.error(
                            `  terrain-only tri-pos ts=${JSON.stringify([
                                p0ts,
                                p1ts,
                                p2ts,
                            ])} cache=${JSON.stringify([p0c, p1c, p2c])}`,
                        );
                    }
                }
                if (
                    profile.name === "terrain-only" &&
                    (mismatchKeys.includes("vertices") || mismatchKeys.includes("indices")) &&
                    tsData.vertices instanceof Uint8Array &&
                    packet.vertices instanceof Uint8Array &&
                    tsData.indices instanceof Int32Array &&
                    packet.indices instanceof Int32Array
                ) {
                    const tsVertexStats = summarizePackedVertices(tsData.vertices);
                    const cacheVertexStats = summarizePackedVertices(packet.vertices);
                    const tsIndexStats = summarizeIndices(
                        tsData.indices,
                        tsVertexStats.vertexCount,
                    );
                    const cacheIndexStats = summarizeIndices(
                        packet.indices,
                        cacheVertexStats.vertexCount,
                    );
                    console.error(
                        `  terrain-only vertex-stats ts=${JSON.stringify(
                            tsVertexStats,
                        )} cache=${JSON.stringify(cacheVertexStats)}`,
                    );
                    console.error(
                        `  terrain-only index-stats ts=${JSON.stringify(
                            tsIndexStats,
                        )} cache=${JSON.stringify(cacheIndexStats)}`,
                    );
                    console.error(
                        `  terrain-only drawRanges base=${JSON.stringify(
                            Array.from(tsData.drawRanges.base),
                        )} interact=${JSON.stringify(
                            Array.from(tsData.drawRanges.interact),
                        )}`,
                    );
                    if (cacheIndexStats.degenerateTriangleCount > 0) {
                        try {
                            const baseX = (sceneBuildInput.baseX as number) | 0;
                            const baseY = (sceneBuildInput.baseY as number) | 0;
                            const sizeX = (sceneBuildInput.sizeX as number) | 0;
                            const sizeY = (sceneBuildInput.sizeY as number) | 0;
                            const smoothUnderlays = !!sceneBuildInput.smoothTerrain;
                            const tsScene = buildSceneFromMapBytesProvider(
                                sceneBuilder,
                                mapBytesProvider,
                                baseX,
                                baseY,
                                sizeX,
                                sizeY,
                                smoothUnderlays,
                                LocLoadType.MODELS,
                            );

                            const borderTiles = 6;
                            const vertexOffset = (-borderTiles * 128) | 0;
                            const triCount = cacheIndexStats.triangleCount | 0;
                            const maxScan = Math.min(triCount, 20000) | 0;
                            const byKey = new Map<string, number>();
                            const samples: Array<Record<string, number>> = [];

                            for (let t = 0; t < maxScan; t++) {
                                const i0 = packet.indices[t * 3 + 0] | 0;
                                const i1 = packet.indices[t * 3 + 1] | 0;
                                const i2 = packet.indices[t * 3 + 2] | 0;
                                if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
                                    continue;
                                }
                                const pos = decodePackedVertexPos(packet.vertices, i0);
                                const tileX = Math.floor((pos.x - vertexOffset) / 128) | 0;
                                const tileY = Math.floor((pos.z - vertexOffset) / 128) | 0;
                                let level = 0;
                                if (
                                    tileX < 0 ||
                                    tileY < 0 ||
                                    tileX >= tsScene.sizeX ||
                                    tileY >= tsScene.sizeY
                                ) {
                                    continue;
                                }
                                const shape = tsScene.tileShapes[level][tileX][tileY] | 0;
                                const rot = tsScene.tileRotations[level][tileX][tileY] | 0;
                                const overlay = tsScene.tileOverlays[level][tileX][tileY] | 0;
                                const underlay = tsScene.tileUnderlays[level][tileX][tileY] | 0;
                                const key = `L${level} shape=${shape} rot=${rot} overlay=${overlay} underlay=${underlay}`;
                                byKey.set(key, (byKey.get(key) ?? 0) + 1);
                                if (samples.length < 12) {
                                    const p0 = decodePackedVertexPos(packet.vertices, i0);
                                    const p1 = decodePackedVertexPos(packet.vertices, i1);
                                    const p2 = decodePackedVertexPos(packet.vertices, i2);
                                    samples.push({
                                        t,
                                        i0,
                                        i1,
                                        i2,
                                        p0x: p0.x,
                                        p0z: p0.z,
                                        p1x: p1.x,
                                        p1z: p1.z,
                                        p2x: p2.x,
                                        p2z: p2.z,
                                        tileX,
                                        tileY,
                                        shape,
                                        rot,
                                        overlay,
                                        underlay,
                                    });
                                }
                            }

                            const top = [...byKey.entries()]
                                .sort((a, b) => (b[1] | 0) - (a[1] | 0))
                                .slice(0, 10);
                            console.error(
                                `  terrain-only degenerate-tris: scanned=${maxScan}/${triCount} distinctKeys=${
                                    byKey.size
                                } top=${JSON.stringify(top)}`,
                            );
                            if (samples.length > 0) {
                                console.error(
                                    `  terrain-only degenerate samples=${JSON.stringify(samples)}`,
                                );
                            }
                        } catch (e) {
                            console.error("  terrain-only degenerate debug failed: " + String(e));
                        }
                    }
                }
                const normalizedCacheCmdDigest = normalizeRuntimeCommandDigest(cacheCmdDigestAfter);
                if (tsCmdDigest && normalizedCacheCmdDigest) {
                    const firstCmdDiff = firstRuntimeCommandDigestMismatch(
                        tsCmdDigest,
                        normalizedCacheCmdDigest,
                    );
                    if (firstCmdDiff) {
                        console.error(`  first runtime cmd-digest diff: ${firstCmdDiff}`);
                    }
                    const firstBucketDiff = firstBucketCommandCountMismatch(
                        tsCmdDigest,
                        normalizedCacheCmdDigest,
                    );
                    if (firstBucketDiff) {
                        console.error(`  first runtime bucket-count diff: ${firstBucketDiff}`);
                        const tsBucketSummary = DRAW_BUCKET_KEYS.map(
                            (name, idx) => `${name}:${(tsCmdDigest.bucketCmdCounts[idx] ?? 0) | 0}`,
                        ).join(" ");
                        const cacheBucketSummary = DRAW_BUCKET_KEYS.map(
                            (name, idx) =>
                                `${name}:${
                                    (normalizedCacheCmdDigest.bucketCmdCounts[idx] ?? 0) | 0
                                }`,
                        ).join(" ");
                        console.error(`  runtime bucket-counts ts: ${tsBucketSummary}`);
                        console.error(`  runtime bucket-counts cache: ${cacheBucketSummary}`);
                    }
                }
                if (
                    (mismatchKeys.includes("drawRanges") ||
                        (tsCmdDigest &&
                            normalizedCacheCmdDigest &&
                            tsCmdDigest.cmdPackedInstancesHash !==
                                normalizedCacheCmdDigest.cmdPackedInstancesHash)) &&
                    tsBridgeInput.runtimeCommandStreamInput &&
                    tsData &&
                    cacheCmdArraysAfter &&
                    tsBridgeInput.runtimeCommandStreamInput.cmdOffsets.length <= 32
                ) {
                    console.error(
                        "  ts cmdOffsets=" +
                            JSON.stringify(
                                Array.from(tsBridgeInput.runtimeCommandStreamInput.cmdOffsets),
                            ),
                    );
                    console.error(
                        "  cache cmdOffsets=" +
                            JSON.stringify(Array.from(cacheCmdArraysAfter.cmdOffsets)),
                    );
                    console.error(
                        "  ts cmdElements=" +
                            JSON.stringify(
                                Array.from(tsBridgeInput.runtimeCommandStreamInput.cmdElements),
                            ),
                    );
                    console.error(
                        "  cache cmdElements=" +
                            JSON.stringify(Array.from(cacheCmdArraysAfter.cmdElements)),
                    );
                    console.error(
                        "  ts cmdBucketIndices=" +
                            JSON.stringify(
                                Array.from(
                                    tsBridgeInput.runtimeCommandStreamInput.cmdBucketIndices,
                                ),
                            ),
                    );
                    console.error(
                        "  cache cmdBucketIndices=" +
                            JSON.stringify(Array.from(cacheCmdArraysAfter.cmdBucketIndices)),
                    );
                    console.error(
                        "  ts cmdInstanceCounts=" +
                            JSON.stringify(
                                Array.from(
                                    tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                ),
                            ),
                    );
                    console.error(
                        "  cache cmdInstanceCounts=" +
                            JSON.stringify(Array.from(cacheCmdArraysAfter.cmdInstanceCounts)),
                    );
                    const terrainLevelDiff = describeTerrainCommandLevelDiff(
                        tsBridgeInput.runtimeCommandStreamInput.cmdBucketIndices,
                        tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                        cacheCmdArraysAfter.cmdBucketIndices,
                        cacheCmdArraysAfter.cmdElements,
                    );
                    if (terrainLevelDiff) {
                        console.error(`  terrain-level element diff: ${terrainLevelDiff}`);
                    }
                }
                if (
                    (mismatchKeys.includes("drawRanges") ||
                        (tsCmdDigest &&
                            normalizedCacheCmdDigest &&
                            tsCmdDigest.cmdPackedInstancesHash !==
                                normalizedCacheCmdDigest.cmdPackedInstancesHash)) &&
                    tsBridgeInput.runtimeCommandStreamInput &&
                    tsData &&
                    cacheCmdArraysAfter
                ) {
                    let tsSceneLocRecords: TsSceneLocRecord[] | undefined;
                    let tsSceneForLocProbe: any | undefined;
                    let tsSceneLocRecordsAttempted = false;
                    const ensureTsSceneLocRecords = (): readonly TsSceneLocRecord[] | undefined => {
                        if (tsSceneLocRecordsAttempted) {
                            return tsSceneLocRecords;
                        }
                        tsSceneLocRecordsAttempted = true;
                        try {
                            const borderSize =
                                ((((sceneBuildInput.sizeX as number) | 0) - 64) / 2) | 0;
                            if (borderSize >= 0) {
                                const scene = buildSceneFromMapBytesProvider(
                                    sceneBuilder,
                                    mapBytesProvider,
                                    (sceneBuildInput.baseX as number) | 0,
                                    (sceneBuildInput.baseY as number) | 0,
                                    (sceneBuildInput.sizeX as number) | 0,
                                    (sceneBuildInput.sizeY as number) | 0,
                                    !!sceneBuildInput.smoothTerrain,
                                    LocLoadType.MODELS,
                                );
                                tsSceneForLocProbe = scene;
                                tsSceneLocRecords = collectTsSceneLocRecords(
                                    scene,
                                    borderSize,
                                    input.maxLevel | 0,
                                );
                            }
                        } catch (e) {
                            console.error("  ts-source loc probe setup failed: " + String(e));
                        }
                        return tsSceneLocRecords;
                    };
                    const tsModelHashStatsMemo = new Map<string, readonly TsLocModelHashStat[]>();
                    const runtimeCommandProvenanceEntriesForDiff = runtimeCommandProvenanceEntries;
                    const getTsModelHashStatsForLocIds = (
                        locTypeIds: readonly number[],
                    ): readonly TsLocModelHashStat[] => {
                        const ids = Array.from(
                            new Set<number>(
                                (locTypeIds ?? []).map((id) => id | 0).filter((id) => id >= 0),
                            ),
                        ).sort((a, b) => a - b);
                        if (ids.length <= 0) {
                            return [];
                        }
                        const key = ids.join(",");
                        const cached = tsModelHashStatsMemo.get(key);
                        if (cached) {
                            return cached;
                        }
                        try {
                            const stats = collectTsLocModelHashStats(
                                sceneBuilder,
                                mapBytesProvider,
                                sceneBuildInput,
                                input.maxLevel | 0,
                                locModelLoader,
                                ids,
                            );
                            tsModelHashStatsMemo.set(key, stats);
                            return stats;
                        } catch (e) {
                            console.error(
                                "  ts-model-hash memo compute failed ids=" + key + ": " + String(e),
                            );
                            tsModelHashStatsMemo.set(key, []);
                            return [];
                        }
                    };

                    const firstArrayDiff = describeFirstCommandStreamArrayMismatch(
                        tsBridgeInput.runtimeCommandStreamInput,
                        tsData,
                        cacheCmdArraysAfter,
                    );
                    if (firstArrayDiff) {
                        console.error(
                            `  first runtime command-stream array diff: ${firstArrayDiff}`,
                        );
                        const m = /^\w+\[(\d+)\]/.exec(firstArrayDiff);
                        if (m) {
                            const idx = Number(m[1]) | 0;
                            let describeBase = idx | 0;
                            if (firstArrayDiff.startsWith("cmdPackedInstances[")) {
                                const instanceGlobal = (idx / 8) | 0;
                                const lane = idx & 7;
                                let base = 0;
                                let cmdIndex = -1;
                                let instanceInCmd = -1;
                                for (
                                    let ci = 0;
                                    ci <
                                    tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts
                                        .length;
                                    ci++
                                ) {
                                    const ic =
                                        tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts[
                                            ci
                                        ] | 0;
                                    if (instanceGlobal < base + ic) {
                                        cmdIndex = ci;
                                        instanceInCmd = (instanceGlobal - base) | 0;
                                        break;
                                    }
                                    base += ic;
                                }
                                if (cmdIndex >= 0) {
                                    describeBase = cmdIndex | 0;
                                    const laneNames = [
                                        "sceneX",
                                        "sceneZ",
                                        "heightOffset",
                                        "level",
                                        "contour",
                                        "priority",
                                        "interactType",
                                        "interactId",
                                    ];
                                    const laneName = laneNames[lane] ?? "lane" + String(lane);
                                    const tsInst = collectCommandInstances(
                                        cmdIndex,
                                        tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                        tsBridgeInput.runtimeCommandStreamInput.cmdPackedInstances,
                                    )[instanceInCmd];
                                    const cacheInst = collectCommandInstances(
                                        cmdIndex,
                                        cacheCmdArraysAfter.cmdInstanceCounts,
                                        cacheCmdArraysAfter.cmdPackedInstances,
                                    )[instanceInCmd];
                                    console.error(
                                        "  packed-instance mismatch maps to instanceGlobal=" +
                                            instanceGlobal +
                                            " cmd=" +
                                            cmdIndex +
                                            " instInCmd=" +
                                            instanceInCmd +
                                            " field=" +
                                            laneName,
                                    );
                                    console.error("  ts packed instance=" + JSON.stringify(tsInst));
                                    console.error(
                                        "  cache packed instance=" + JSON.stringify(cacheInst),
                                    );
                                    try {
                                        const tsInsts = collectCommandInstances(
                                            cmdIndex,
                                            tsBridgeInput.runtimeCommandStreamInput
                                                .cmdInstanceCounts,
                                            tsBridgeInput.runtimeCommandStreamInput
                                                .cmdPackedInstances,
                                        );
                                        const cacheInsts = collectCommandInstances(
                                            cmdIndex,
                                            cacheCmdArraysAfter.cmdInstanceCounts,
                                            cacheCmdArraysAfter.cmdPackedInstances,
                                        );
                                        const norm = (v: any) => JSON.stringify(v);
                                        const tsSorted = tsInsts.map(norm).slice().sort();
                                        const cacheSorted = cacheInsts.map(norm).slice().sort();
                                        const multisetEqual =
                                            tsSorted.length === cacheSorted.length &&
                                            tsSorted.every((s, i) => s === cacheSorted[i]);
                                        console.error(
                                            "  cmd-instance-set ts=" +
                                                JSON.stringify(tsInsts) +
                                                " cache=" +
                                                JSON.stringify(cacheInsts) +
                                                " multisetEqual=" +
                                                String(multisetEqual),
                                        );
                                    } catch (e) {
                                        console.error(
                                            "  cmd-instance-set diff failed: " + String(e),
                                        );
                                    }

                                    // Tile-state probe: infer tile from packed instance and print TS wall/wallDecoration state.
                                    try {
                                        ensureTsSceneLocRecords();
                                        const scene: any = tsSceneForLocProbe;
                                        if (scene) {
                                            const dump = (label: string, inst: any) => {
                                                const sx = inst?.sceneX | 0;
                                                const sz = inst?.sceneZ | 0;
                                                const lvl = inst?.level | 0;
                                                const tx = (sx / 128) | 0;
                                                const ty = (sz / 128) | 0;
                                                const baseX = tx * 128 + 64;
                                                const baseZ = ty * 128 + 64;
                                                const dx = (sx - baseX) | 0;
                                                const dz = (sz - baseZ) | 0;
                                                const tile = scene.tiles?.[lvl]?.[tx]?.[ty];
                                                const wd = tile?.wallDecoration;
                                                const locs: any[] = Array.isArray(tile?.locs)
                                                    ? tile.locs
                                                    : [];
                                                const locIds = locs.slice(0, 6).map((l) => {
                                                    try {
                                                        return getIdFromTag(l.tag);
                                                    } catch {
                                                        return -1;
                                                    }
                                                });
                                                const wallTag =
                                                    typeof scene.getWallTag === "function"
                                                        ? scene.getWallTag(lvl, tx, ty)
                                                        : undefined;
                                                console.error(
                                                    `  tile-probe(${label}) lvl=${lvl} tile=${tx},${ty} base=(${baseX},${baseZ}) inst=(${sx},${sz}) d=(${dx},${dz}) tileExists=${!!tile} wallTag=${
                                                        wallTag ? String(wallTag) : "none"
                                                    } wallDecor=${
                                                        wd
                                                            ? JSON.stringify({
                                                                  offsetX: wd.offsetX,
                                                                  offsetY: wd.offsetY,
                                                                  tag: String(wd.tag ?? 0n),
                                                              })
                                                            : "none"
                                                    } locCount=${
                                                        locs.length
                                                    } locIds=${JSON.stringify(locIds)}`,
                                                );
                                            };
                                            dump("ts", tsInst);
                                            dump("cache", cacheInst);
                                        }
                                    } catch (e) {
                                        console.error("  tile-probe failed: " + String(e));
                                    }
                                }
                            }
                            const describeIdxs = [
                                describeBase - 1,
                                describeBase,
                                describeBase + 1,
                                describeBase + 2,
                            ].filter((v) => v >= 0);
                            for (const i of describeIdxs) {
                                console.error(
                                    "  " +
                                        describeCommandAtIndex(
                                            "ts",
                                            tsBridgeInput.runtimeCommandStreamInput
                                                .cmdBucketIndices,
                                            tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                            tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                            tsBridgeInput.runtimeCommandStreamInput
                                                .cmdInstanceCounts,
                                            tsBridgeInput.runtimeCommandStreamInput
                                                .cmdPackedInstances,
                                            i,
                                        ),
                                );
                            }
                            for (const i of describeIdxs) {
                                console.error(
                                    "  " +
                                        describeCommandAtIndex(
                                            "cache",
                                            cacheCmdArraysAfter.cmdBucketIndices,
                                            cacheCmdArraysAfter.cmdOffsets,
                                            cacheCmdArraysAfter.cmdElements,
                                            cacheCmdArraysAfter.cmdInstanceCounts,
                                            cacheCmdArraysAfter.cmdPackedInstances,
                                            i,
                                        ),
                                );
                            }
                            const provenanceLines =
                                summarizeRuntimeCommandProvenanceEntriesAtIndices(
                                    runtimeCommandProvenanceEntriesForDiff,
                                    describeIdxs,
                                );
                            for (let pi = 0; pi < provenanceLines.length; pi++) {
                                console.error(provenanceLines[pi]);
                            }
                            const tsInstancesAtFirstDiff = collectCommandInstances(
                                describeBase,
                                tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                tsBridgeInput.runtimeCommandStreamInput.cmdPackedInstances,
                            );
                            const tsFirstDiffGroupingLines = describeTsLocGroupingCandidates(
                                ensureTsSceneLocRecords(),
                                tsInstancesAtFirstDiff,
                                "first-array-diff-ts-cmd-" + String(describeBase | 0),
                                5,
                            );
                            for (let gi = 0; gi < tsFirstDiffGroupingLines.length; gi++) {
                                console.error(tsFirstDiffGroupingLines[gi]);
                            }
                            const cacheInstancesAtFirstDiff = collectCommandInstances(
                                describeBase,
                                cacheCmdArraysAfter.cmdInstanceCounts,
                                cacheCmdArraysAfter.cmdPackedInstances,
                            );
                            const cacheFirstDiffGroupingLines = describeTsLocGroupingCandidates(
                                ensureTsSceneLocRecords(),
                                cacheInstancesAtFirstDiff,
                                "first-array-diff-cache-cmd-" + String(describeBase | 0),
                                4,
                            );
                            for (let gi = 0; gi < cacheFirstDiffGroupingLines.length; gi++) {
                                console.error(cacheFirstDiffGroupingLines[gi]);
                            }

                            // Animated loc placeholders are zero-element commands with a single LOC instance.
                            // When command counts diverge by +4 (base/alpha + interact/alpha), this tends to
                            // isolate the one extra/missing animated placement.
                            try {
                                const collectPlaceholderKeys = (
                                    cmdBucketIndices: Int32Array,
                                    cmdOffsets: Int32Array,
                                    cmdElements: Int32Array,
                                    cmdInstanceCounts: Int32Array,
                                    cmdPackedInstances: Int32Array,
                                    bucketIndex: number,
                                ): Set<string> => {
                                    const out = new Set<string>();
                                    let instanceBase = 0;
                                    for (let ci = 0; ci < cmdBucketIndices.length; ci++) {
                                        const b = cmdBucketIndices[ci] | 0;
                                        const o = ci < cmdOffsets.length ? cmdOffsets[ci] | 0 : 0;
                                        const e = ci < cmdElements.length ? cmdElements[ci] | 0 : 0;
                                        const ic =
                                            ci < cmdInstanceCounts.length
                                                ? cmdInstanceCounts[ci] | 0
                                                : 0;
                                        if (
                                            b === (bucketIndex | 0) &&
                                            o === 0 &&
                                            e === 0 &&
                                            ic === 1
                                        ) {
                                            const off = (instanceBase * 8) | 0;
                                            if (off + 7 < cmdPackedInstances.length) {
                                                const sceneX = cmdPackedInstances[off + 0] | 0;
                                                const sceneZ = cmdPackedInstances[off + 1] | 0;
                                                const level = cmdPackedInstances[off + 3] | 0;
                                                const contour = cmdPackedInstances[off + 4] | 0;
                                                const pri = cmdPackedInstances[off + 5] | 0;
                                                const interactType =
                                                    cmdPackedInstances[off + 6] | 0;
                                                const interactId =
                                                    cmdPackedInstances[off + 7] >>> 0;
                                                if (interactType === 1 /*LOC*/) {
                                                    out.add(
                                                        `${interactId}|x${sceneX}|z${sceneZ}|l${level}|c${contour}|p${pri}`,
                                                    );
                                                }
                                            }
                                        }
                                        instanceBase += ic;
                                    }
                                    return out;
                                };
                                const tsBasePlaceholders = collectPlaceholderKeys(
                                    tsBridgeInput.runtimeCommandStreamInput.cmdBucketIndices,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdPackedInstances,
                                    0,
                                );
                                const cacheBasePlaceholders = collectPlaceholderKeys(
                                    cacheCmdArraysAfter.cmdBucketIndices,
                                    cacheCmdArraysAfter.cmdOffsets,
                                    cacheCmdArraysAfter.cmdElements,
                                    cacheCmdArraysAfter.cmdInstanceCounts,
                                    cacheCmdArraysAfter.cmdPackedInstances,
                                    0,
                                );
                                const tsAlphaPlaceholders = collectPlaceholderKeys(
                                    tsBridgeInput.runtimeCommandStreamInput.cmdBucketIndices,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdPackedInstances,
                                    1,
                                );
                                const cacheAlphaPlaceholders = collectPlaceholderKeys(
                                    cacheCmdArraysAfter.cmdBucketIndices,
                                    cacheCmdArraysAfter.cmdOffsets,
                                    cacheCmdArraysAfter.cmdElements,
                                    cacheCmdArraysAfter.cmdInstanceCounts,
                                    cacheCmdArraysAfter.cmdPackedInstances,
                                    1,
                                );

                                const diffSet = (a: Set<string>, b: Set<string>): string[] => {
                                    const out: string[] = [];
                                    for (const k of a) {
                                        if (!b.has(k)) out.push(k);
                                    }
                                    out.sort();
                                    return out;
                                };
                                const extraBase = diffSet(
                                    cacheBasePlaceholders,
                                    tsBasePlaceholders,
                                );
                                const missingBase = diffSet(
                                    tsBasePlaceholders,
                                    cacheBasePlaceholders,
                                );
                                const extraAlpha = diffSet(
                                    cacheAlphaPlaceholders,
                                    tsAlphaPlaceholders,
                                );
                                const missingAlpha = diffSet(
                                    tsAlphaPlaceholders,
                                    cacheAlphaPlaceholders,
                                );

                                if (
                                    extraBase.length ||
                                    missingBase.length ||
                                    extraAlpha.length ||
                                    missingAlpha.length
                                ) {
                                    console.error(
                                        `  animated-placeholder diff base: extra=${extraBase.length} missing=${missingBase.length} alpha: extra=${extraAlpha.length} missing=${missingAlpha.length}`,
                                    );
                                    if (extraBase.length)
                                        console.error(
                                            `  extra base placeholders (up to 10)=${JSON.stringify(
                                                extraBase.slice(0, 10),
                                            )}`,
                                        );
                                    if (missingBase.length)
                                        console.error(
                                            `  missing base placeholders (up to 10)=${JSON.stringify(
                                                missingBase.slice(0, 10),
                                            )}`,
                                        );
                                    if (extraAlpha.length)
                                        console.error(
                                            `  extra alpha placeholders (up to 10)=${JSON.stringify(
                                                extraAlpha.slice(0, 10),
                                            )}`,
                                        );
                                    if (missingAlpha.length)
                                        console.error(
                                            `  missing alpha placeholders (up to 10)=${JSON.stringify(
                                                missingAlpha.slice(0, 10),
                                            )}`,
                                        );

                                    const probe = (extraBase[0] ??
                                        extraAlpha[0] ??
                                        missingBase[0] ??
                                        missingAlpha[0]) as string | undefined;
                                    if (probe) {
                                        const m =
                                            /^(\d+)\|x(-?\d+)\|z(-?\d+)\|l(-?\d+)\|c(-?\d+)\|p(-?\d+)$/.exec(
                                                probe,
                                            );
                                        if (m) {
                                            const wantInteractId = Number(m[1]) >>> 0;
                                            const wantSceneX = Number(m[2]) | 0;
                                            const wantSceneZ = Number(m[3]) | 0;
                                            const wantLevel = Number(m[4]) | 0;
                                            const wantContour = Number(m[5]) | 0;
                                            const wantPri = Number(m[6]) | 0;
                                            const findExactFirstInstanceHits = (
                                                label: string,
                                                cmdBucketIndices: Int32Array,
                                                cmdOffsets: Int32Array,
                                                cmdElements: Int32Array,
                                                cmdInstanceCounts: Int32Array,
                                                cmdPackedInstances: Int32Array,
                                                limit: number,
                                            ): void => {
                                                const hits: Array<{
                                                    cmdIndex: number;
                                                    bucket: number;
                                                    offset: number;
                                                    elements: number;
                                                }> = [];
                                                let instanceBase = 0;
                                                for (
                                                    let ci = 0;
                                                    ci < cmdBucketIndices.length;
                                                    ci++
                                                ) {
                                                    const ic =
                                                        ci < cmdInstanceCounts.length
                                                            ? cmdInstanceCounts[ci] | 0
                                                            : 0;
                                                    const off = (instanceBase * 8) | 0;
                                                    if (
                                                        ic > 0 &&
                                                        off + 7 < cmdPackedInstances.length
                                                    ) {
                                                        const sceneX =
                                                            cmdPackedInstances[off + 0] | 0;
                                                        const sceneZ =
                                                            cmdPackedInstances[off + 1] | 0;
                                                        const level =
                                                            cmdPackedInstances[off + 3] | 0;
                                                        const contour =
                                                            cmdPackedInstances[off + 4] | 0;
                                                        const pri = cmdPackedInstances[off + 5] | 0;
                                                        const interactType =
                                                            cmdPackedInstances[off + 6] | 0;
                                                        const interactId =
                                                            cmdPackedInstances[off + 7] >>> 0;
                                                        if (
                                                            interactType === 1 &&
                                                            interactId === wantInteractId &&
                                                            sceneX === wantSceneX &&
                                                            sceneZ === wantSceneZ &&
                                                            level === wantLevel &&
                                                            contour === wantContour &&
                                                            pri === wantPri
                                                        ) {
                                                            hits.push({
                                                                cmdIndex: ci,
                                                                bucket: cmdBucketIndices[ci] | 0,
                                                                offset:
                                                                    ci < cmdOffsets.length
                                                                        ? cmdOffsets[ci] | 0
                                                                        : 0,
                                                                elements:
                                                                    ci < cmdElements.length
                                                                        ? cmdElements[ci] | 0
                                                                        : 0,
                                                            });
                                                            if (hits.length >= limit) break;
                                                        }
                                                    }
                                                    instanceBase += ic;
                                                }
                                                console.error(
                                                    `  animated-placeholder probe ${label} key=${probe} hits=${JSON.stringify(
                                                        hits,
                                                    )}`,
                                                );
                                            };
                                            const findInteractAtScenePos = (
                                                label: string,
                                                cmdBucketIndices: Int32Array,
                                                cmdOffsets: Int32Array,
                                                cmdElements: Int32Array,
                                                cmdInstanceCounts: Int32Array,
                                                cmdPackedInstances: Int32Array,
                                                limit: number,
                                            ): void => {
                                                const hits: Array<{
                                                    cmdIndex: number;
                                                    bucket: number;
                                                    offset: number;
                                                    elements: number;
                                                    instanceIndex: number;
                                                    contour: number;
                                                    pri: number;
                                                }> = [];
                                                let instanceBase = 0;
                                                for (
                                                    let ci = 0;
                                                    ci < cmdBucketIndices.length;
                                                    ci++
                                                ) {
                                                    const ic =
                                                        ci < cmdInstanceCounts.length
                                                            ? cmdInstanceCounts[ci] | 0
                                                            : 0;
                                                    const baseWord = (instanceBase * 8) | 0;
                                                    for (let j = 0; j < ic; j++) {
                                                        const off = baseWord + j * 8;
                                                        if (off + 7 >= cmdPackedInstances.length)
                                                            break;
                                                        const sceneX =
                                                            cmdPackedInstances[off + 0] | 0;
                                                        const sceneZ =
                                                            cmdPackedInstances[off + 1] | 0;
                                                        const level =
                                                            cmdPackedInstances[off + 3] | 0;
                                                        const contour =
                                                            cmdPackedInstances[off + 4] | 0;
                                                        const pri = cmdPackedInstances[off + 5] | 0;
                                                        const interactType =
                                                            cmdPackedInstances[off + 6] | 0;
                                                        const interactId =
                                                            cmdPackedInstances[off + 7] >>> 0;
                                                        if (
                                                            interactType === 1 &&
                                                            interactId === wantInteractId &&
                                                            sceneX === wantSceneX &&
                                                            sceneZ === wantSceneZ &&
                                                            level === wantLevel
                                                        ) {
                                                            hits.push({
                                                                cmdIndex: ci,
                                                                bucket: cmdBucketIndices[ci] | 0,
                                                                offset:
                                                                    ci < cmdOffsets.length
                                                                        ? cmdOffsets[ci] | 0
                                                                        : 0,
                                                                elements:
                                                                    ci < cmdElements.length
                                                                        ? cmdElements[ci] | 0
                                                                        : 0,
                                                                instanceIndex: j,
                                                                contour,
                                                                pri,
                                                            });
                                                            if (hits.length >= limit) break;
                                                        }
                                                    }
                                                    if (hits.length >= limit) break;
                                                    instanceBase += ic;
                                                }
                                                console.error(
                                                    `  animated-placeholder probe ${label} interactAtPos hits=${JSON.stringify(
                                                        hits,
                                                    )}`,
                                                );
                                            };
                                            findExactFirstInstanceHits(
                                                "ts",
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdBucketIndices,
                                                tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                                tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdInstanceCounts,
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdPackedInstances,
                                                12,
                                            );
                                            findExactFirstInstanceHits(
                                                "cache",
                                                cacheCmdArraysAfter.cmdBucketIndices,
                                                cacheCmdArraysAfter.cmdOffsets,
                                                cacheCmdArraysAfter.cmdElements,
                                                cacheCmdArraysAfter.cmdInstanceCounts,
                                                cacheCmdArraysAfter.cmdPackedInstances,
                                                12,
                                            );
                                            findInteractAtScenePos(
                                                "ts",
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdBucketIndices,
                                                tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                                tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdInstanceCounts,
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdPackedInstances,
                                                12,
                                            );
                                            findInteractAtScenePos(
                                                "cache",
                                                cacheCmdArraysAfter.cmdBucketIndices,
                                                cacheCmdArraysAfter.cmdOffsets,
                                                cacheCmdArraysAfter.cmdElements,
                                                cacheCmdArraysAfter.cmdInstanceCounts,
                                                cacheCmdArraysAfter.cmdPackedInstances,
                                                12,
                                            );
                                            const findAnyLocInstancesAtPos = (
                                                label: string,
                                                cmdBucketIndices: Int32Array,
                                                cmdInstanceCounts: Int32Array,
                                                cmdPackedInstances: Int32Array,
                                                limit: number,
                                            ): void => {
                                                const hits: Array<{
                                                    cmdIndex: number;
                                                    bucket: number;
                                                    instanceIndex: number;
                                                    id: number;
                                                    contour: number;
                                                    pri: number;
                                                }> = [];
                                                let instanceBase = 0;
                                                for (
                                                    let ci = 0;
                                                    ci < cmdBucketIndices.length;
                                                    ci++
                                                ) {
                                                    const ic =
                                                        ci < cmdInstanceCounts.length
                                                            ? cmdInstanceCounts[ci] | 0
                                                            : 0;
                                                    const baseWord = (instanceBase * 8) | 0;
                                                    for (let j = 0; j < ic; j++) {
                                                        const off = baseWord + j * 8;
                                                        if (off + 7 >= cmdPackedInstances.length)
                                                            break;
                                                        const sceneX =
                                                            cmdPackedInstances[off + 0] | 0;
                                                        const sceneZ =
                                                            cmdPackedInstances[off + 1] | 0;
                                                        const level =
                                                            cmdPackedInstances[off + 3] | 0;
                                                        const contour =
                                                            cmdPackedInstances[off + 4] | 0;
                                                        const pri = cmdPackedInstances[off + 5] | 0;
                                                        const interactType =
                                                            cmdPackedInstances[off + 6] | 0;
                                                        const interactId =
                                                            cmdPackedInstances[off + 7] >>> 0;
                                                        if (
                                                            interactType === 1 &&
                                                            sceneX === wantSceneX &&
                                                            sceneZ === wantSceneZ &&
                                                            level === wantLevel
                                                        ) {
                                                            hits.push({
                                                                cmdIndex: ci,
                                                                bucket: cmdBucketIndices[ci] | 0,
                                                                instanceIndex: j,
                                                                id: interactId,
                                                                contour,
                                                                pri,
                                                            });
                                                            if (hits.length >= limit) break;
                                                        }
                                                    }
                                                    if (hits.length >= limit) break;
                                                    instanceBase += ic;
                                                }
                                                console.error(
                                                    `  animated-placeholder probe ${label} anyLocAtPos hits=${JSON.stringify(
                                                        hits,
                                                    )}`,
                                                );
                                            };
                                            findAnyLocInstancesAtPos(
                                                "ts",
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdBucketIndices,
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdInstanceCounts,
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdPackedInstances,
                                                12,
                                            );
                                            findAnyLocInstancesAtPos(
                                                "cache",
                                                cacheCmdArraysAfter.cmdBucketIndices,
                                                cacheCmdArraysAfter.cmdInstanceCounts,
                                                cacheCmdArraysAfter.cmdPackedInstances,
                                                12,
                                            );
                                            const listKeysForId = (
                                                set: Set<string>,
                                                id: number,
                                            ): string[] => {
                                                const prefix = String(id >>> 0) + "|";
                                                const out: string[] = [];
                                                for (const k of set) {
                                                    if (k.startsWith(prefix)) out.push(k);
                                                }
                                                out.sort();
                                                return out;
                                            };
                                            console.error(
                                                `  animated-placeholder probe tsBaseKeysForId=${JSON.stringify(
                                                    listKeysForId(
                                                        tsBasePlaceholders,
                                                        wantInteractId,
                                                    ).slice(0, 10),
                                                )}`,
                                            );
                                            console.error(
                                                `  animated-placeholder probe cacheBaseKeysForId=${JSON.stringify(
                                                    listKeysForId(
                                                        cacheBasePlaceholders,
                                                        wantInteractId,
                                                    ).slice(0, 10),
                                                )}`,
                                            );
                                            console.error(
                                                `  animated-placeholder probe tsAlphaKeysForId=${JSON.stringify(
                                                    listKeysForId(
                                                        tsAlphaPlaceholders,
                                                        wantInteractId,
                                                    ).slice(0, 10),
                                                )}`,
                                            );
                                            console.error(
                                                `  animated-placeholder probe cacheAlphaKeysForId=${JSON.stringify(
                                                    listKeysForId(
                                                        cacheAlphaPlaceholders,
                                                        wantInteractId,
                                                    ).slice(0, 10),
                                                )}`,
                                            );
                                            const tsInteractAny = findFirstCommandsWithInteractKey(
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdBucketIndices,
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdInstanceCounts,
                                                tsBridgeInput.runtimeCommandStreamInput
                                                    .cmdPackedInstances,
                                                1,
                                                wantInteractId,
                                                12,
                                            );
                                            const cacheInteractAny =
                                                findFirstCommandsWithInteractKey(
                                                    cacheCmdArraysAfter.cmdBucketIndices,
                                                    cacheCmdArraysAfter.cmdInstanceCounts,
                                                    cacheCmdArraysAfter.cmdPackedInstances,
                                                    1,
                                                    wantInteractId,
                                                    12,
                                                );
                                            console.error(
                                                `  animated-placeholder probe interactAny tsHits=${JSON.stringify(
                                                    tsInteractAny,
                                                )} cacheHits=${JSON.stringify(cacheInteractAny)}`,
                                            );
                                            const recs = ensureTsSceneLocRecords();
                                            if (recs) {
                                                const rec = recs.find(
                                                    (r) =>
                                                        r.id >>> 0 === wantInteractId &&
                                                        (r.sceneX | 0) === wantSceneX &&
                                                        (r.sceneZ | 0) === wantSceneZ &&
                                                        (r.level | 0) === wantLevel &&
                                                        (r.priority | 0) === wantPri,
                                                );
                                                console.error(
                                                    `  animated-placeholder probe tsSceneLocRecord=${
                                                        rec ? JSON.stringify(rec) : "<none>"
                                                    }`,
                                                );
                                                if (rec) {
                                                    try {
                                                        const borderSize =
                                                            ((((sceneBuildInput.sizeX as number) |
                                                                0) -
                                                                64) /
                                                                2) |
                                                            0;
                                                        const tsSceneProbe =
                                                            buildSceneFromMapBytesProvider(
                                                                sceneBuilder,
                                                                mapBytesProvider,
                                                                (sceneBuildInput.baseX as number) |
                                                                    0,
                                                                (sceneBuildInput.baseY as number) |
                                                                    0,
                                                                (sceneBuildInput.sizeX as number) |
                                                                    0,
                                                                (sceneBuildInput.sizeY as number) |
                                                                    0,
                                                                !!sceneBuildInput.smoothTerrain,
                                                                LocLoadType.MODELS,
                                                            );
                                                        const tile: any =
                                                            tsSceneProbe.tiles?.[rec.level | 0]?.[
                                                                rec.tileX | 0
                                                            ]?.[rec.tileY | 0];
                                                        const locs: any[] = Array.isArray(
                                                            tile?.locs,
                                                        )
                                                            ? tile.locs
                                                            : [];
                                                        let found: any = undefined;
                                                        for (const loc of locs) {
                                                            if (
                                                                !loc ||
                                                                (loc.startX | 0) !==
                                                                    (rec.tileX | 0) ||
                                                                (loc.startY | 0) !== (rec.tileY | 0)
                                                            ) {
                                                                continue;
                                                            }
                                                            const id =
                                                                getIdFromTag(loc.tag as never) | 0;
                                                            if (id >>> 0 === wantInteractId) {
                                                                found = loc;
                                                                break;
                                                            }
                                                        }
                                                        const ent: any = found?.entity;
                                                        const entId =
                                                            ent && typeof ent.id === "number"
                                                                ? ent.id | 0
                                                                : undefined;
                                                        const entSeq =
                                                            ent && typeof ent.seqId === "number"
                                                                ? ent.seqId | 0
                                                                : undefined;
                                                        const entType =
                                                            ent && typeof ent.type === "number"
                                                                ? ent.type | 0
                                                                : undefined;
                                                        const entRot =
                                                            ent && typeof ent.rotation === "number"
                                                                ? ent.rotation | 0
                                                                : undefined;
                                                        const entCtor =
                                                            ent && (ent as any).constructor
                                                                ? String(
                                                                      (ent as any).constructor
                                                                          .name ?? "",
                                                                  )
                                                                : "";
                                                        console.error(
                                                            `  animated-placeholder probe tsScene entityFound=${
                                                                found ? 1 : 0
                                                            } entityCtor=${entCtor} entityId=${
                                                                entId ?? "<none>"
                                                            } entitySeq=${
                                                                entSeq ?? "<none>"
                                                            } entityType=${
                                                                entType ?? "<none>"
                                                            } entityRot=${entRot ?? "<none>"}`,
                                                        );
                                                    } catch (e) {
                                                        console.error(
                                                            "  animated-placeholder probe tsScene entity inspect failed: " +
                                                                String(e),
                                                        );
                                                    }
                                                }
                                            }
                                            try {
                                                const base =
                                                    sceneBuilder.services.locTypeLoader.tryLoad(
                                                        wantInteractId | 0,
                                                    );
                                                if (base.ok) {
                                                    const baseLoc = base.value;
                                                    let resolvedLoc = baseLoc;
                                                    if (baseLoc.transforms) {
                                                        const tvb =
                                                            (baseLoc.transformVarbit ?? -1) | 0;
                                                        const tvp =
                                                            (baseLoc.transformVarp ?? -1) | 0;
                                                        let transformIndex = -1;
                                                        if (tvb !== -1) {
                                                            transformIndex =
                                                                varProvider.getVarbit(tvb) | 0;
                                                        } else if (tvp !== -1) {
                                                            transformIndex =
                                                                varProvider.getVarp(tvp) | 0;
                                                        }
                                                        let sceneBuilderVarbit = -1;
                                                        let sceneBuilderVarp = -1;
                                                        try {
                                                            if (tvb !== -1) {
                                                                sceneBuilderVarbit =
                                                                    (
                                                                        sceneBuilder.services
                                                                            .varProvider as any
                                                                    ).getVarbit?.(tvb) ?? -1;
                                                            } else if (tvp !== -1) {
                                                                sceneBuilderVarp =
                                                                    (
                                                                        sceneBuilder.services
                                                                            .varProvider as any
                                                                    ).getVarp?.(tvp) ?? -1;
                                                            }
                                                        } catch {
                                                            // ignore
                                                        }
                                                        const transforms = baseLoc.transforms;
                                                        let transformId = -1;
                                                        if (
                                                            transformIndex >= 0 &&
                                                            transformIndex <
                                                                transforms.length - 1 &&
                                                            transforms[transformIndex] !== -1
                                                        ) {
                                                            transformId =
                                                                transforms[transformIndex] | 0;
                                                        } else {
                                                            transformId =
                                                                transforms[transforms.length - 1] |
                                                                0;
                                                        }
                                                        console.error(
                                                            `  animated-placeholder probe tsLocType transformVarbit=${tvb} transformVarp=${tvp} transformIndex=${transformIndex} transformId=${transformId} sbVarbit=${sceneBuilderVarbit} sbVarp=${sceneBuilderVarp}`,
                                                        );
                                                    }
                                                    if (baseLoc.transforms) {
                                                        const transformed = baseLoc.transform(
                                                            varProvider,
                                                            sceneBuilder.services.locTypeLoader,
                                                        );
                                                        if (transformed) {
                                                            resolvedLoc = transformed;
                                                        }
                                                    }
                                                    console.error(
                                                        `  animated-placeholder probe tsLocType resolvedId=${
                                                            resolvedLoc.id | 0
                                                        } baseSeq=${
                                                            baseLoc.seqId | 0
                                                        } resolvedSeq=${
                                                            resolvedLoc.seqId | 0
                                                        } transforms=${
                                                            Array.isArray(baseLoc.transforms)
                                                                ? baseLoc.transforms.length
                                                                : 0
                                                        }`,
                                                    );
                                                    const seqId = resolvedLoc.seqId | 0;
                                                    if (seqId >= 0) {
                                                        const seqRes =
                                                            loaders.seqTypeLoader.tryLoad(seqId);
                                                        if (seqRes.ok) {
                                                            const seq = seqRes.value;
                                                            const hasMaya =
                                                                typeof seq.hasAnimMayaSeq ===
                                                                "function"
                                                                    ? !!seq.hasAnimMayaSeq()
                                                                    : (seq.animMayaId | 0) >= 0;
                                                            const frameIdsLen = Array.isArray(
                                                                (seq as any).frameIds,
                                                            )
                                                                ? (seq as any).frameIds.length | 0
                                                                : (seq as any).frameIds
                                                                ? ((seq as any).frameIds
                                                                      .length as number) | 0
                                                                : -1;
                                                            const mayaDur =
                                                                typeof (seq as any)
                                                                    .getAnimMayaDuration ===
                                                                "function"
                                                                    ? ((
                                                                          seq as any
                                                                      ).getAnimMayaDuration() as number) |
                                                                      0
                                                                    : (((seq as any)
                                                                          .animMayaEnd as number) |
                                                                          0) -
                                                                      (((seq as any)
                                                                          .animMayaStart as number) |
                                                                          0);
                                                            let seqFrameAlphaCount = -1;
                                                            if (!hasMaya && Array.isArray((seq as any).frameIds)) {
                                                                seqFrameAlphaCount = 0;
                                                                const frameIds = (seq as any).frameIds as number[];
                                                                for (let fi = 0; fi < frameIds.length; fi++) {
                                                                    const frameId = frameIds[fi] | 0;
                                                                    const frame =
                                                                        loaders.seqFrameLoader.tryGet(frameId);
                                                                    if ((frame as any)?.hasAlphaTransform === true) {
                                                                        seqFrameAlphaCount++;
                                                                    }
                                                                }
                                                            }
                                                            console.error(
                                                                `  animated-placeholder probe tsSeqType id=${seqId} ok hasMaya=${
                                                                    hasMaya ? 1 : 0
                                                                } frameIdsLen=${frameIdsLen} mayaDur=${mayaDur} frameAlphaCount=${seqFrameAlphaCount}`,
                                                            );
                                                        } else {
                                                            console.error(
                                                                `  animated-placeholder probe tsSeqType id=${seqId} load failed`,
                                                            );
                                                        }
                                                    }
                                                } else {
                                                    console.error(
                                                        "  animated-placeholder probe tsLocType base load failed",
                                                    );
                                                }
                                            } catch (e) {
                                                console.error(
                                                    "  animated-placeholder probe tsLocType resolve failed: " +
                                                        String(e),
                                                );
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error("  animated-placeholder diff failed: " + String(e));
                            }
                            // Summarize merged-dummy commands (sceneX/Z=0, interact NONE/0xffff) by priority.
                            summarizeMergedDummyCommands(
                                "ts",
                                tsBridgeInput.runtimeCommandStreamInput.cmdBucketIndices,
                                tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                tsBridgeInput.runtimeCommandStreamInput.cmdPackedInstances,
                                /*bucket=*/ 0,
                            );
                            summarizeMergedDummyCommands(
                                "cache",
                                cacheCmdArraysAfter.cmdBucketIndices,
                                cacheCmdArraysAfter.cmdOffsets,
                                cacheCmdArraysAfter.cmdElements,
                                cacheCmdArraysAfter.cmdInstanceCounts,
                                cacheCmdArraysAfter.cmdPackedInstances,
                                /*bucket=*/ 0,
                            );
                            summarizeMergedDummyCommands(
                                "ts",
                                tsBridgeInput.runtimeCommandStreamInput.cmdBucketIndices,
                                tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                tsBridgeInput.runtimeCommandStreamInput.cmdPackedInstances,
                                /*bucket=*/ 1,
                            );

                            // If the mismatch neighborhood contains an interactive instance, see if it exists anywhere in TS/cache streams.
                            const probe = describeIdxs.length > 0 ? describeIdxs[0] | 0 : -1;
                            if (probe >= 0) {
                                const probeDesc = describeCommandAtIndex(
                                    "ts",
                                    tsBridgeInput.runtimeCommandStreamInput.cmdBucketIndices,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                    tsBridgeInput.runtimeCommandStreamInput.cmdPackedInstances,
                                    probe,
                                );
                                const mProbe = /interact=(\w+) id=(\d+)/.exec(probeDesc);
                                if (mProbe && mProbe[1] !== "NONE") {
                                    const id = Number(mProbe[2]) >>> 0;
                                    const typeMap: Record<string, number> = {
                                        LOC: 1,
                                        OBJ: 2,
                                        NPC: 3,
                                    };
                                    const it = typeMap[mProbe[1]] ?? -1;
                                    if (it > 0) {
                                        const tsHits = findFirstCommandsWithInteractKey(
                                            tsBridgeInput.runtimeCommandStreamInput
                                                .cmdBucketIndices,
                                            tsBridgeInput.runtimeCommandStreamInput
                                                .cmdInstanceCounts,
                                            tsBridgeInput.runtimeCommandStreamInput
                                                .cmdPackedInstances,
                                            it,
                                            id,
                                            8,
                                        );
                                        const cacheHits = findFirstCommandsWithInteractKey(
                                            cacheCmdArraysAfter.cmdBucketIndices,
                                            cacheCmdArraysAfter.cmdInstanceCounts,
                                            cacheCmdArraysAfter.cmdPackedInstances,
                                            it,
                                            id,
                                            8,
                                        );
                                        console.error(
                                            `  interact-probe type=${
                                                mProbe[1]
                                            } id=${id} tsHits=${JSON.stringify(
                                                tsHits,
                                            )} cacheHits=${JSON.stringify(cacheHits)}`,
                                        );
                                        const mFields =
                                            /sceneX=(\-?\d+) sceneZ=(\-?\d+) .* level=(\-?\d+) contour=(\-?\d+) pri=(\-?\d+) /.exec(
                                                probeDesc,
                                            );
                                        if (mFields) {
                                            const want = {
                                                sceneX: Number(mFields[1]) | 0,
                                                sceneZ: Number(mFields[2]) | 0,
                                                level: Number(mFields[3]) | 0,
                                                contour: Number(mFields[4]) | 0,
                                                pri: Number(mFields[5]) | 0,
                                                instanceCount: 2,
                                            };
                                            const cacheFirstHits =
                                                findFirstCommandsWithFirstInstanceFields(
                                                    cacheCmdArraysAfter.cmdBucketIndices,
                                                    cacheCmdArraysAfter.cmdInstanceCounts,
                                                    cacheCmdArraysAfter.cmdPackedInstances,
                                                    want,
                                                    8,
                                                );
                                            console.error(
                                                `  first-inst-probe want=${JSON.stringify(
                                                    want,
                                                )} cacheCmds=${JSON.stringify(cacheFirstHits)}`,
                                            );
                                        }
                                    }
                                }
                            }
                            summarizeMergedDummyCommands(
                                "cache",
                                cacheCmdArraysAfter.cmdBucketIndices,
                                cacheCmdArraysAfter.cmdOffsets,
                                cacheCmdArraysAfter.cmdElements,
                                cacheCmdArraysAfter.cmdInstanceCounts,
                                cacheCmdArraysAfter.cmdPackedInstances,
                                /*bucket=*/ 1,
                            );
                            // If merged-dummy stats are drifting, show a multiset diff that ignores offsets.
                            try {
                                const tsDummy = computeTsLocMergedDummyDigest(
                                    tsBridgeInput.runtimeCommandStreamInput,
                                );
                                const cacheDummy =
                                    computeTsLocMergedDummyDigest(cacheCmdArraysAfter);
                                console.error(
                                    `  ts merged-dummy digest (from arrays)=${JSON.stringify(
                                        tsDummy,
                                    )}`,
                                );
                                console.error(
                                    `  cache merged-dummy digest (from arrays)=${JSON.stringify(
                                        cacheDummy,
                                    )}`,
                                );
                                diffMergedDummyCommandMultiset(
                                    "first-array-diff",
                                    tsBridgeInput.runtimeCommandStreamInput,
                                    cacheCmdArraysAfter,
                                    runtimeCommandProvenanceEntriesForDiff,
                                    12,
                                );
                            } catch (e) {
                                console.error("  merged-dummy multiset diff failed: " + String(e));
                            }
                            summarizeZeroElementInteractCommands(
                                "ts",
                                tsBridgeInput.runtimeCommandStreamInput.cmdBucketIndices,
                                tsBridgeInput.runtimeCommandStreamInput.cmdOffsets,
                                tsBridgeInput.runtimeCommandStreamInput.cmdElements,
                                tsBridgeInput.runtimeCommandStreamInput.cmdInstanceCounts,
                                tsBridgeInput.runtimeCommandStreamInput.cmdPackedInstances,
                                /*bucket=*/ 4,
                            );
                            summarizeZeroElementInteractCommands(
                                "cache",
                                cacheCmdArraysAfter.cmdBucketIndices,
                                cacheCmdArraysAfter.cmdOffsets,
                                cacheCmdArraysAfter.cmdElements,
                                cacheCmdArraysAfter.cmdInstanceCounts,
                                cacheCmdArraysAfter.cmdPackedInstances,
                                /*bucket=*/ 4,
                            );
                            summarizeMergedInteractElementDiff(
                                tsBridgeInput.runtimeCommandStreamInput,
                                cacheCmdArraysAfter,
                            );
                            const topMergedInteractLocIds =
                                collectTopMergedInteractLocIdsByElementDelta(
                                    tsBridgeInput.runtimeCommandStreamInput,
                                    cacheCmdArraysAfter,
                                    8,
                                );
                            summarizeInteractAnyInstanceDiffForLocIds(
                                tsBridgeInput.runtimeCommandStreamInput,
                                cacheCmdArraysAfter,
                                Array.from(
                                    new Set<number>([
                                        ...topMergedInteractLocIds,
                                        48619,
                                        48599,
                                        48499,
                                        48495,
                                        48665,
                                        48666,
                                        48667,
                                        48668,
                                        48669,
                                    ]),
                                ).slice(0, 12),
                            );
                            const decodeLocIds = Array.from(
                                new Set<number>([
                                    ...topMergedInteractLocIds,
                                    42188,
                                    42189,
                                    48436,
                                    14875,
                                    41433,
                                    42521,
                                    42522,
                                    42665,
                                    42755,
                                    48495,
                                    48497,
                                    48499,
                                    48529,
                                    48532,
                                    48557,
                                ]),
                            );
                            if (decodeLocIds.length > 0) {
                                await summarizeRuntimeLocTypeDecodeDiff(
                                    decodeLocIds,
                                    sceneBuilder,
                                    bridge,
                                    runtimeHandle,
                                );
                            }
                            // Include the known-problematic floor decoration locs even when they're
                            // not in the "top deltas" set (small deltas still matter for geometry parity).
                            const tsModelHashStats = getTsModelHashStatsForLocIds(
                                Array.from(
                                    new Set<number>([
                                        ...topMergedInteractLocIds,
                                        48436,
                                        33458,
                                        48619,
                                        48620,
                                        48495,
                                        48497,
                                        1651,
                                        4735,
                                        4736,
                                        4737,
                                        4738,
                                    ]),
                                ).slice(0, 24),
                            );
                            const tsModelHashLines = summarizeTsLocModelHashStats(
                                tsModelHashStats,
                                "top-merged-interact",
                                8,
                            );
                            for (let li = 0; li < tsModelHashLines.length; li++) {
                                console.error(tsModelHashLines[li]);
                            }
                            const debugTsLocIds = [48436, 48495, 48497];
                            for (let di = 0; di < debugTsLocIds.length; di++) {
                                const id = debugTsLocIds[di] | 0;
                                const rows = tsModelHashStats
                                    .filter((s) => (s.locTypeId | 0) === id)
                                    .sort((a, b) => {
                                        if ((a.placementType | 0) !== (b.placementType | 0)) {
                                            return (a.placementType | 0) - (b.placementType | 0);
                                        }
                                        if (
                                            (a.placementRotation | 0) !==
                                            (b.placementRotation | 0)
                                        ) {
                                            return (
                                                (a.placementRotation | 0) -
                                                (b.placementRotation | 0)
                                            );
                                        }
                                        if ((b.count | 0) !== (a.count | 0)) {
                                            return (b.count | 0) - (a.count | 0);
                                        }
                                        return (a.modelHash | 0) - (b.modelHash | 0);
                                    });
                                if (rows.length <= 0) {
                                    console.error(`  ts-model-hash(debug) id=${id} <none>`);
                                    continue;
                                }
                                console.error(
                                    `  ts-model-hash(debug) id=${id} rows=${rows.length}`,
                                );
                                for (let ri = 0; ri < rows.length; ri++) {
                                    const r = rows[ri];
                                    console.error(
                                        `  ts-model-hash(debug) id=${id} t=${
                                            r.placementType | 0
                                        } r=${r.placementRotation | 0} hash=${
                                            r.modelHash | 0
                                        } opaque=${r.opaqueElements | 0} alpha=${
                                            r.alphaElements | 0
                                        } count=${r.count | 0}`,
                                    );
                                }
                            }

                            const runtimeLocMergeDecisionEntries =
                                parseRuntimeLocMergeDecisionEntriesPacked(
                                    cacheLocMergeDecisionEntriesPacked,
                                );
                            // When merged geometry is drifting for mergeNormals locs, diff the mergeNormals call trace.
                            // This is much more actionable than diffing final index buffers.
                            try {
                                const traceLocIds = Array.from(
                                    new Set<number>(topMergedInteractLocIds),
                                ).slice(0, 6);
                                if (traceLocIds.length > 0) {
                                    const runtimeTrace =
                                        parseRuntimeLocMergeNormalsTraceEntriesPacked(
                                            cacheLocMergeNormalsTraceEntriesPacked,
                                        );
                                    const tsTrace = captureTsMergeNormalsTraceForSquare(
                                        sceneBuilder,
                                        mapBytesProvider,
                                        sceneBuildInput,
                                        traceLocIds,
                                    );
                                    const traceLines = summarizeTsVsRuntimeMergeNormalsTrace(
                                        tsTrace,
                                        runtimeTrace,
                                        traceLocIds,
                                    );
                                    for (let ti = 0; ti < traceLines.length && ti < 80; ti++) {
                                        console.error(traceLines[ti]);
                                    }
                                }
                            } catch (e) {
                                console.error(
                                    `  mergeNormals trace compare (topMergedInteractLocIds) failed: ${e}`,
                                );
                            }
                            const mergeDecisionLines = summarizeRuntimeLocMergeDecisionEntries(
                                runtimeLocMergeDecisionEntries,
                                Array.from(
                                    new Set<number>([
                                        ...topMergedInteractLocIds,
                                        48436,
                                        33458,
                                        48619,
                                        48495,
                                        48497,
                                    ]),
                                ).slice(0, 24),
                            );
                            for (let li = 0; li < mergeDecisionLines.length; li++) {
                                console.error(mergeDecisionLines[li]);
                            }
                            if (
                                runtimeLocMergeDecisionEntries &&
                                runtimeLocMergeDecisionEntries.length > 0
                            ) {
                                // Localize the failing floor-decoration hide-occluded case around the first bad placements.
                                const minX = 18;
                                const maxX = 21;
                                const minY = 45;
                                const maxY = 48;
                                const region = runtimeLocMergeDecisionEntries
                                    .filter(
                                        (e) =>
                                            (e.placementType | 0) === 22 &&
                                            (e.tileX | 0) >= minX &&
                                            (e.tileX | 0) <= maxX &&
                                            (e.tileY | 0) >= minY &&
                                            (e.tileY | 0) <= maxY,
                                    )
                                    .sort((a, b) => {
                                        if ((a.level | 0) !== (b.level | 0))
                                            return (a.level | 0) - (b.level | 0);
                                        if ((a.tileX | 0) !== (b.tileX | 0))
                                            return (a.tileX | 0) - (b.tileX | 0);
                                        if ((a.tileY | 0) !== (b.tileY | 0))
                                            return (a.tileY | 0) - (b.tileY | 0);
                                        if ((a.locTypeId | 0) !== (b.locTypeId | 0))
                                            return (a.locTypeId | 0) - (b.locTypeId | 0);
                                        return (a.variantRotation | 0) - (b.variantRotation | 0);
                                    });
                                console.error(
                                    `  runtime floor22 region x=${minX}..${maxX} y=${minY}..${maxY} entries=${region.length}`,
                                );
                                for (let i = 0; i < region.length; i++) {
                                    const e = region[i];
                                    console.error(
                                        `  runtime floor22 region lvl=${e.level | 0} tile=${
                                            e.tileX | 0
                                        },${e.tileY | 0} id=${e.locTypeId | 0} v=${
                                            e.variantType | 0
                                        }/${e.variantRotation | 0} o/a=${
                                            e.opaqueElementsPerInstance | 0
                                        }/${e.alphaElementsPerInstance | 0} sig=${
                                            e.modelSignature | 0
                                        } ids=${e.modelIdsHash | 0}`,
                                    );
                                }
                            }
                            const modelSignalCompareLines = summarizeTsVsRuntimeModelSignal(
                                tsModelHashStats,
                                runtimeLocMergeDecisionEntries,
                                Array.from(
                                    new Set<number>([
                                        ...topMergedInteractLocIds,
                                        48619,
                                        48495,
                                        48497,
                                    ]),
                                ).slice(0, 24),
                                16,
                            );
                            for (let li = 0; li < modelSignalCompareLines.length; li++) {
                                console.error(modelSignalCompareLines[li]);
                            }
                            const groupingCompareLocIds = Array.from(
                                new Set<number>([48619, ...topMergedInteractLocIds]),
                            ).slice(0, 4);
                            for (let gi = 0; gi < groupingCompareLocIds.length; gi++) {
                                const locId = groupingCompareLocIds[gi] | 0;
                                const compareLines = summarizeTsVsRuntimeLocGrouping(
                                    tsLocPreMergeSignatureEntries,
                                    runtimeLocMergeDecisionEntries,
                                    locId,
                                );
                                for (let li = 0; li < compareLines.length; li++) {
                                    console.error(compareLines[li]);
                                }
                            }

                            const debugFloorLocIds = [
                                14875, 42521, 42522, 42665, 42755, 48495, 48497,
                            ];
                            for (let di = 0; di < debugFloorLocIds.length; di++) {
                                const id = debugFloorLocIds[di] >>> 0;
                                const tsBins = collectInteractGeometryBinsForBucket(
                                    tsBridgeInput.runtimeCommandStreamInput,
                                    tsData.vertices,
                                    tsData.indices,
                                    1,
                                    id,
                                    4,
                                    8,
                                );
                                const cacheBins = collectInteractGeometryBinsForBucket(
                                    cacheCmdArraysAfter,
                                    packet.vertices,
                                    packet.indices,
                                    1,
                                    id,
                                    4,
                                    8,
                                );
                                console.error(
                                    "  debug interact-geom it=1 id=" +
                                        id +
                                        " ts=" +
                                        JSON.stringify(tsBins) +
                                        " cache=" +
                                        JSON.stringify(cacheBins),
                                );
                            }
                            const tsSceneLocRecordsForDiff = ensureTsSceneLocRecords();

                            diffMultiInstanceBaseCommandsIgnoringInteract(
                                tsBridgeInput.runtimeCommandStreamInput,
                                cacheCmdArraysAfter,
                                tsSceneLocRecordsForDiff,
                                tsData.vertices,
                                tsData.indices,
                                packet.vertices,
                                packet.indices,
                                getTsModelHashStatsForLocIds,
                                tsLocPreMergeSignatureEntries,
                                runtimeCommandProvenanceEntriesForDiff,
                                runtimeLocMergeDecisionEntries,
                            );
                        }
                    }
                }

                if (mismatchKeys.includes("modelInfo")) {
                    try {
                        const t = tsData;
                        const buckets: Array<keyof SdMapData["drawRanges"]> = [
                            "interact",
                            "interactAlpha",
                            "interactLod",
                            "interactLodAlpha",
                        ];
                        for (const b of buckets) {
                            const tsInst = decodeModelInfoTextureInstances(
                                t.drawRanges[b],
                                t.modelInfoTextures[b],
                            );
                            const cacheInst = decodeModelInfoTextureInstances(
                                cache.drawRanges[b],
                                cache.modelInfoTextures[b],
                            );
                            if (tsInst.length !== cacheInst.length) {
                                console.error(
                                    `  modelInfo bucket=${b} instanceCount ts=${tsInst.length} cache=${cacheInst.length}`,
                                );
                            }
                            const n = Math.min(tsInst.length, cacheInst.length, 8);
                            if (n > 0) {
                                console.error(
                                    `  modelInfo bucket=${b} ts=` +
                                        JSON.stringify(
                                            tsInst
                                                .slice(0, n)
                                                .map((v) => [
                                                    v.priority,
                                                    v.interactType,
                                                    v.interactId,
                                                ]),
                                        ) +
                                        ` cache=` +
                                        JSON.stringify(
                                            cacheInst
                                                .slice(0, n)
                                                .map((v) => [
                                                    v.priority,
                                                    v.interactType,
                                                    v.interactId,
                                                ]),
                                        ),
                                );
                            }
                        }
                    } catch (e) {
                        console.error("  modelInfo debug decode failed: " + String(e));
                    }
                }
                if (mismatchKeys.includes("heightMap")) {
                    console.error(
                        `  height diff: ${describeFirstHeightMismatch(
                            toRuntimeOverlay(tsData).heightMapTextureData,
                            cache.heightMapTextureData,
                        )}`,
                    );
                }
            }
        }

        totalMismatches += mismatches;
        logSummary(
            `map-render-runtime-cache-v2-parity: profile=${profile.name} cache=${cacheInfo.name} squares=${squares.length} mismatches=${mismatches}`,
        );
        if (mismatchSquares && mismatchSquares.length > 0) {
            const preview = mismatchSquares.slice(0, 50);
            logSummary(
                `map-render-runtime-cache-v2-parity: profile=${profile.name} mismatch-squares count=${mismatchSquares.length} sample=${preview.join(",")}`,
            );
        }
        if (args.stages) {
            logSummary(
                "map-render-runtime-cache-v2-parity: profile=" +
                    profile.name +
                    " stage-failures-all " +
                    formatStageFailureSummary(stageFailures),
            );
            logSummary(
                "map-render-runtime-cache-v2-parity: profile=" +
                    profile.name +
                    " stage-failures-gating " +
                    formatStageFailureSummary(stageFailuresGating),
            );
            if (stageFailureSquares) {
                for (let i = 0; i < STAGE_KEYS.length; i++) {
                    const key = STAGE_KEYS[i];
                    const list = stageFailureSquares[key];
                    if (list.length <= 0) continue;
                    const preview = list.slice(0, 20);
                    logSummary(
                        `map-render-runtime-cache-v2-parity: profile=${profile.name} failing-squares ${key} count=${list.length} sample=${preview.join(",")}`,
                    );
                }
            }
        }
    }

    bridge.destroyRuntime(runtimeHandle);
    if (totalMismatches > 0) process.exit(1);
}

function dumpUnhandled(e: unknown): void {
    try {
        if (e instanceof Error) {
            console.error(String(e));
            if (e.stack) console.error(e.stack);
            return;
        }
        const t = typeof e;
        const tag = Object.prototype.toString.call(e);
        console.error(`unhandled throw: type=${t} tag=${tag}`);
        if (e && t === "object") {
            try {
                console.error("keys:", Object.keys(e as any));
            } catch {
                // ignore
            }
            try {
                console.error("json:", JSON.stringify(e));
            } catch {
                // ignore
            }
        } else {
            console.error("value:", String(e));
        }
    } catch {
        console.error("unhandled throw (failed to dump)");
    }
}

main().catch((e) => {
    dumpUnhandled(e);
    process.exit(1);
});

function summarizeZeroElementInteractCommands(
    label: string,
    cmdBucketIndices: Int32Array,
    cmdOffsets: Int32Array,
    cmdElements: Int32Array,
    cmdInstanceCounts: Int32Array,
    cmdPackedInstances: Int32Array,
    bucket: number,
): void {
    type Stat = { count: number; sampleOffset: number };
    const stats = new Map<number, Stat>();

    let instanceBase = 0;
    for (let i = 0; i < cmdBucketIndices.length; i++) {
        const b = cmdBucketIndices[i] | 0;
        const ic = i < cmdInstanceCounts.length ? cmdInstanceCounts[i] | 0 : 0;
        const elements = i < cmdElements.length ? cmdElements[i] | 0 : 0;
        const packedOff = (instanceBase * 8) | 0;
        if (
            b === bucket &&
            elements === 0 &&
            ic === 1 &&
            packedOff + 7 < cmdPackedInstances.length
        ) {
            const interactType = cmdPackedInstances[packedOff + 6] | 0;
            const interactId = cmdPackedInstances[packedOff + 7] >>> 0;
            if (interactType === 1 && interactId !== 0xffff) {
                const offset = i < cmdOffsets.length ? cmdOffsets[i] | 0 : 0;
                const s = stats.get(interactId) ?? { count: 0, sampleOffset: offset };
                s.count++;
                if (offset < s.sampleOffset) {
                    s.sampleOffset = offset;
                }
                stats.set(interactId, s);
            }
        }
        instanceBase += ic;
    }

    const ids = Array.from(stats.keys()).sort((a, b) => {
        const ac = stats.get(a)?.count ?? 0;
        const bc = stats.get(b)?.count ?? 0;
        if (ac !== bc) return bc - ac;
        return a - b;
    });
    if (ids.length === 0) {
        console.error(`  ${label} zeroInteractSummary bucket=${bucket}: <none>`);
        return;
    }
    const parts: string[] = [];
    const n = Math.min(ids.length, 12);
    for (let i = 0; i < n; i++) {
        const id = ids[i];
        const s = stats.get(id)!;
        parts.push(`id=${id}:{n=${s.count} firstOff=${s.sampleOffset}}`);
    }
    console.error(`  ${label} zeroInteractSummary bucket=${bucket}: ${parts.join(" ")}`);
}

type MergedInteractElementStat = {
    count: number;
    elementsTotal: number;
};

type InteractAnyInstanceStat = {
    commandCount: number;
    instanceCount: number;
    elementsByCommands: number;
    elementsByInstances: number;
};

function collectInteractAnyInstanceStats(
    input: {
        cmdBucketIndices: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    bucket: number,
    interactType: number,
): Map<number, InteractAnyInstanceStat> {
    const stats = new Map<number, InteractAnyInstanceStat>();
    let instanceBase = 0;
    for (let i = 0; i < input.cmdBucketIndices.length; i++) {
        const b = input.cmdBucketIndices[i] | 0;
        const ic = i < input.cmdInstanceCounts.length ? input.cmdInstanceCounts[i] | 0 : 0;
        const elements = i < input.cmdElements.length ? input.cmdElements[i] | 0 : 0;
        if (b === bucket && ic > 0 && elements > 0) {
            const perCommandCounts = new Map<number, number>();
            const packedOff = (instanceBase * 8) | 0;
            for (let ii = 0; ii < ic; ii++) {
                const instOff = packedOff + ii * 8;
                if (instOff + 7 >= input.cmdPackedInstances.length) {
                    break;
                }
                const it = input.cmdPackedInstances[instOff + 6] | 0;
                const id = input.cmdPackedInstances[instOff + 7] >>> 0;
                if (it !== interactType || id === 0xffff) {
                    continue;
                }
                perCommandCounts.set(id, ((perCommandCounts.get(id) ?? 0) + 1) | 0);
            }
            for (const [id, count] of perCommandCounts.entries()) {
                const s = stats.get(id) ?? {
                    commandCount: 0,
                    instanceCount: 0,
                    elementsByCommands: 0,
                    elementsByInstances: 0,
                };
                s.commandCount = (s.commandCount + 1) | 0;
                s.instanceCount = (s.instanceCount + count) | 0;
                s.elementsByCommands = (s.elementsByCommands + elements) | 0;
                s.elementsByInstances = (s.elementsByInstances + Math.imul(elements, count)) | 0;
                stats.set(id, s);
            }
        }
        instanceBase += ic;
    }
    return stats;
}

function summarizeInteractAnyInstanceDiffForLocIds(
    tsInput: {
        cmdBucketIndices: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    cacheInput: {
        cmdBucketIndices: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    locIds: readonly number[],
): void {
    if (locIds.length === 0) {
        return;
    }
    const bucketNames = ["interact", "interactAlpha", "interactLod", "interactLodAlpha"] as const;
    for (let bi = 0; bi < bucketNames.length; bi++) {
        const bucket = 4 + bi;
        const name = bucketNames[bi];
        const tsStats = collectInteractAnyInstanceStats(tsInput, bucket, 1);
        const cacheStats = collectInteractAnyInstanceStats(cacheInput, bucket, 1);
        const parts: string[] = [];
        for (let i = 0; i < locIds.length; i++) {
            const id = locIds[i] >>> 0;
            const ts = tsStats.get(id) ?? {
                commandCount: 0,
                instanceCount: 0,
                elementsByCommands: 0,
                elementsByInstances: 0,
            };
            const cache = cacheStats.get(id) ?? {
                commandCount: 0,
                instanceCount: 0,
                elementsByCommands: 0,
                elementsByInstances: 0,
            };
            if (
                ts.commandCount === cache.commandCount &&
                ts.instanceCount === cache.instanceCount &&
                ts.elementsByCommands === cache.elementsByCommands &&
                ts.elementsByInstances === cache.elementsByInstances
            ) {
                continue;
            }
            parts.push(
                `id=${id}:{tsCmd=${ts.commandCount} cacheCmd=${cache.commandCount} tsInst=${ts.instanceCount} cacheInst=${cache.instanceCount} tsEC=${ts.elementsByCommands} cacheEC=${cache.elementsByCommands} tsEI=${ts.elementsByInstances} cacheEI=${cache.elementsByInstances}}`,
            );
        }
        if (parts.length === 0) {
            console.error(`  interactAnyInstanceDiff ${name}: <none>`);
        } else {
            console.error(`  interactAnyInstanceDiff ${name}: ${parts.join(" ")}`);
        }
    }
}

function collectMergedInteractElementStats(
    cmdBucketIndices: Int32Array,
    cmdElements: Int32Array,
    cmdInstanceCounts: Int32Array,
    cmdPackedInstances: Int32Array,
    bucket: number,
): Map<number, MergedInteractElementStat> {
    const stats = new Map<number, MergedInteractElementStat>();
    let instanceBase = 0;
    for (let i = 0; i < cmdBucketIndices.length; i++) {
        const b = cmdBucketIndices[i] | 0;
        const ic = i < cmdInstanceCounts.length ? cmdInstanceCounts[i] | 0 : 0;
        const elements = i < cmdElements.length ? cmdElements[i] | 0 : 0;
        const packedOff = (instanceBase * 8) | 0;
        if (b === bucket && elements > 0 && ic === 1 && packedOff + 7 < cmdPackedInstances.length) {
            const sceneX = cmdPackedInstances[packedOff + 0] | 0;
            const sceneZ = cmdPackedInstances[packedOff + 1] | 0;
            const heightOffset = cmdPackedInstances[packedOff + 2] | 0;
            const contour = cmdPackedInstances[packedOff + 4] | 0;
            const interactType = cmdPackedInstances[packedOff + 6] | 0;
            const interactId = cmdPackedInstances[packedOff + 7] >>> 0;
            const isMergedInteract =
                sceneX === 0 &&
                sceneZ === 0 &&
                heightOffset === 0 &&
                contour === 2 &&
                interactType === 1 &&
                interactId !== 0xffff;
            if (isMergedInteract) {
                const s = stats.get(interactId) ?? { count: 0, elementsTotal: 0 };
                s.count++;
                s.elementsTotal += elements;
                stats.set(interactId, s);
            }
        }
        instanceBase += ic;
    }
    return stats;
}

function summarizeMergedInteractElementDiff(
    tsInput: {
        cmdBucketIndices: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    cacheInput: {
        cmdBucketIndices: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
): void {
    const bucketNames = ["interact", "interactAlpha", "interactLod", "interactLodAlpha"] as const;
    for (let bi = 0; bi < bucketNames.length; bi++) {
        const bucket = 4 + bi;
        const name = bucketNames[bi];
        const tsStats = collectMergedInteractElementStats(
            tsInput.cmdBucketIndices,
            tsInput.cmdElements,
            tsInput.cmdInstanceCounts,
            tsInput.cmdPackedInstances,
            bucket,
        );
        const cacheStats = collectMergedInteractElementStats(
            cacheInput.cmdBucketIndices,
            cacheInput.cmdElements,
            cacheInput.cmdInstanceCounts,
            cacheInput.cmdPackedInstances,
            bucket,
        );

        const ids = new Set<number>();
        for (const id of tsStats.keys()) ids.add(id);
        for (const id of cacheStats.keys()) ids.add(id);

        const deltas: Array<{
            id: number;
            tsElements: number;
            cacheElements: number;
            tsCount: number;
            cacheCount: number;
            delta: number;
        }> = [];
        for (const id of ids) {
            const ts = tsStats.get(id) ?? { count: 0, elementsTotal: 0 };
            const cache = cacheStats.get(id) ?? { count: 0, elementsTotal: 0 };
            const delta = (cache.elementsTotal | 0) - (ts.elementsTotal | 0);
            if (delta !== 0 || (cache.count | 0) !== (ts.count | 0)) {
                deltas.push({
                    id: id >>> 0,
                    tsElements: ts.elementsTotal | 0,
                    cacheElements: cache.elementsTotal | 0,
                    tsCount: ts.count | 0,
                    cacheCount: cache.count | 0,
                    delta: delta | 0,
                });
            }
        }

        if (deltas.length === 0) {
            console.error(`  mergedInteractDiff ${name}: <none>`);
            continue;
        }

        deltas.sort((a, b) => {
            const ad = Math.abs(a.delta | 0);
            const bd = Math.abs(b.delta | 0);
            if (ad !== bd) return bd - ad;
            return (a.id >>> 0) - (b.id >>> 0);
        });

        const n = Math.min(deltas.length, 12);
        const parts: string[] = [];
        for (let i = 0; i < n; i++) {
            const d = deltas[i];
            parts.push(
                `id=${d.id}:{tsE=${d.tsElements} cacheE=${d.cacheElements} dE=${d.delta} tsN=${d.tsCount} cacheN=${d.cacheCount}}`,
            );
        }
        console.error(`  mergedInteractDiff ${name}: ${parts.join(" ")}`);
    }
}

function collectTopMergedInteractLocIdsByElementDelta(
    tsInput: {
        cmdBucketIndices: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    cacheInput: {
        cmdBucketIndices: Int32Array;
        cmdElements: Int32Array;
        cmdInstanceCounts: Int32Array;
        cmdPackedInstances: Int32Array;
    },
    maxIds: number,
): number[] {
    const scoreById = new Map<number, number>();
    for (let bucket = 4; bucket <= 7; bucket++) {
        const tsStats = collectMergedInteractElementStats(
            tsInput.cmdBucketIndices,
            tsInput.cmdElements,
            tsInput.cmdInstanceCounts,
            tsInput.cmdPackedInstances,
            bucket,
        );
        const cacheStats = collectMergedInteractElementStats(
            cacheInput.cmdBucketIndices,
            cacheInput.cmdElements,
            cacheInput.cmdInstanceCounts,
            cacheInput.cmdPackedInstances,
            bucket,
        );
        const ids = new Set<number>();
        for (const id of tsStats.keys()) ids.add(id);
        for (const id of cacheStats.keys()) ids.add(id);
        for (const id of ids) {
            const ts = tsStats.get(id) ?? { count: 0, elementsTotal: 0 };
            const cache = cacheStats.get(id) ?? { count: 0, elementsTotal: 0 };
            const elementDelta = Math.abs((cache.elementsTotal | 0) - (ts.elementsTotal | 0));
            const countDelta = Math.abs((cache.count | 0) - (ts.count | 0));
            if (elementDelta === 0 && countDelta === 0) {
                continue;
            }
            const score = (elementDelta * 1000 + countDelta) | 0;
            const prev = scoreById.get(id) ?? 0;
            if (score > prev) {
                scoreById.set(id, score);
            }
        }
    }
    return Array.from(scoreById.entries())
        .sort((a, b) => {
            if (a[1] !== b[1]) return b[1] - a[1];
            return (a[0] >>> 0) - (b[0] >>> 0);
        })
        .slice(0, Math.max(0, maxIds | 0))
        .map(([id]) => id >>> 0);
}

async function summarizeRuntimeLocTypeDecodeDiff(
    locTypeIds: readonly number[],
    sceneBuilder: SceneBuilder,
    bridge: RuntimeBridge,
    runtimeHandle: number,
): Promise<void> {
    if (locTypeIds.length === 0) {
        return;
    }
    if (typeof bridge.debugDecodeRuntimeLocType !== "function") {
        console.error(
            "  loc-type decode debug unavailable: bridge missing debugDecodeRuntimeLocType",
        );
        return;
    }

    const locTypeLoader = sceneBuilder.services.locTypeLoader;
    const varProvider = sceneBuilder.services.varProvider;
    for (let i = 0; i < locTypeIds.length; i++) {
        const locTypeId = locTypeIds[i] | 0;
        const tsBase = locTypeLoader.tryLoad(locTypeId);
        const tsInfo = tsBase.ok
            ? (() => {
                  const base = tsBase.value;
                  const resolved = base.transform(varProvider, locTypeLoader) ?? base;
                  const countModelIds = (models: number[][] | undefined): number => {
                      if (!models) return 0;
                      let total = 0;
                      for (let mi = 0; mi < models.length; mi++) {
                          total += (models[mi]?.length ?? 0) | 0;
                      }
                      return total | 0;
                  };
                  const firstModelId = (models: number[][] | undefined): number => {
                      if (!models) return -1;
                      for (let mi = 0; mi < models.length; mi++) {
                          if ((models[mi]?.length ?? 0) > 0) {
                              return (models[mi][0] ?? -1) | 0;
                          }
                      }
                      return -1;
                  };
                  const typeModelPairs = (
                      types: number[] | undefined,
                      models: number[][] | undefined,
                  ): unknown => {
                      if (!types || !models) return undefined;
                      const out: Array<[number, number]> = [];
                      const n = Math.min(types.length | 0, models.length | 0) | 0;
                      for (let i = 0; i < n; i++) {
                          const t = (types[i] ?? -1) | 0;
                          const mid = ((models[i]?.[0] as number | undefined) ?? -1) | 0;
                          out.push([t, mid]);
                      }
                      return out;
                  };
                  return {
                      id: base.id | 0,
                      resolvedId: resolved.id | 0,
                      mergeNormals: !!base.mergeNormals,
                      resolvedMergeNormals: !!resolved.mergeNormals,
                      contourGroundType: base.contourGroundType | 0,
                      resolvedContourGroundType: resolved.contourGroundType | 0,
                      contouredGround: base.contouredGround | 0,
                      resolvedContouredGround: resolved.contouredGround | 0,
                      contourGroundParam: base.contourGroundParam | 0,
                      resolvedContourGroundParam: resolved.contourGroundParam | 0,
                      decorDisplacement: base.decorDisplacement | 0,
                      resolvedDecorDisplacement: resolved.decorDisplacement | 0,
                      ambient: base.ambient | 0,
                      contrast: base.contrast | 0,
                      resolvedAmbient: resolved.ambient | 0,
                      resolvedContrast: resolved.contrast | 0,
                      hasTypes: !!base.types,
                      resolvedHasTypes: !!resolved.types,
                      typeCount: (base.types?.length ?? 0) | 0,
                      resolvedTypeCount: (resolved.types?.length ?? 0) | 0,
                      modelGroupCount: (base.models?.length ?? 0) | 0,
                      resolvedModelGroupCount: (resolved.models?.length ?? 0) | 0,
                      modelIdCount: countModelIds(base.models),
                      resolvedModelIdCount: countModelIds(resolved.models),
                      firstType: ((base.types?.[0] as number | undefined) ?? -1) | 0,
                      resolvedFirstType: ((resolved.types?.[0] as number | undefined) ?? -1) | 0,
                      firstModelId: firstModelId(base.models),
                      resolvedFirstModelId: firstModelId(resolved.models),
                      typeModelPairs: typeModelPairs(
                          base.types as number[] | undefined,
                          base.models,
                      ),
                      resolvedTypeModelPairs: typeModelPairs(
                          resolved.types as number[] | undefined,
                          resolved.models,
                      ),
                      transformsCount: (base.transforms?.length ?? 0) | 0,
                      transformVarbit: base.transformVarbit | 0,
                      transformVarp: base.transformVarp | 0,
                  };
              })()
            : { ok: false };
        const cppInfo = await bridge.debugDecodeRuntimeLocType(runtimeHandle, locTypeId);
        console.error(
            "  loc-type decode id=" +
                locTypeId +
                " ts=" +
                JSON.stringify(tsInfo) +
                " cpp=" +
                JSON.stringify(cppInfo),
        );
    }
}

type TsLocModelHashStat = Readonly<{
    locTypeId: number;
    placementType: number;
    placementRotation: number;
    modelHash: number;
    opaqueElements: number;
    alphaElements: number;
    count: number;
}>;

function collectTsLocModelHashStats(
    sceneBuilder: SceneBuilder,
    mapBytesProvider: MapFileBytesProvider,
    sceneBuildInput: Record<string, unknown>,
    maxLevel: number,
    locModelLoader: LocModelLoader,
    targetLocIds: readonly number[],
): TsLocModelHashStat[] {
    if (!targetLocIds || targetLocIds.length <= 0) {
        return [];
    }
    const borderSize = ((((sceneBuildInput.sizeX as number) | 0) - 64) / 2) | 0;
    if (borderSize < 0) {
        return [];
    }

    const scene = buildSceneFromMapBytesProvider(
        sceneBuilder,
        mapBytesProvider,
        (sceneBuildInput.baseX as number) | 0,
        (sceneBuildInput.baseY as number) | 0,
        (sceneBuildInput.sizeX as number) | 0,
        (sceneBuildInput.sizeY as number) | 0,
        !!sceneBuildInput.smoothTerrain,
        LocLoadType.MODELS,
    );
    const records = collectTsSceneLocRecords(scene, borderSize, maxLevel | 0);
    const locTypeLoader = sceneBuilder.services.locTypeLoader;
    const varProvider = sceneBuilder.services.varProvider;
    const textureLoader = sceneBuilder.services.textureLoader;
    const targetIdSet = new Set<number>(targetLocIds.map((id) => id | 0));
    const modelHashBuf = new ModelHashBuffer(5000);

    type MutableStat = {
        locTypeId: number;
        placementType: number;
        placementRotation: number;
        modelHash: number;
        opaqueElements: number;
        alphaElements: number;
        count: number;
    };
    const byKey = new Map<string, MutableStat>();

    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const locTypeId = record.id | 0;
        if (!targetIdSet.has(locTypeId)) {
            continue;
        }

        const resolvedLocType = resolveLocTypeForPlacement(locTypeId, locTypeLoader, varProvider);
        if (!resolvedLocType) {
            continue;
        }

        let seqId = (resolvedLocType.seqId ?? -1) | 0;
        const randomSeqIds = (resolvedLocType as { randomSeqIds?: ReadonlyArray<number> })
            .randomSeqIds;
        if (seqId === -1 && Array.isArray(randomSeqIds) && randomSeqIds.length > 0) {
            seqId = (randomSeqIds[0] ?? -1) | 0;
        }
        if (seqId !== -1) {
            continue;
        }

        let sizeX = resolvedLocType.sizeX | 0;
        let sizeY = resolvedLocType.sizeY | 0;
        const placementRotation = record.placementRotation | 0;
        if ((placementRotation & 1) !== 0) {
            const swap = sizeX;
            sizeX = sizeY;
            sizeY = swap;
        }

        const level = record.level | 0;
        const tileX = record.tileX | 0;
        const tileY = record.tileY | 0;
        const centerHeight = computeTsLocSceneHeight(
            scene,
            resolvedLocType,
            level,
            tileX,
            tileY,
            placementRotation,
        );
        const contourGroundInfo = {
            type: resolvedLocType.contourGroundType | 0,
            param: resolvedLocType.contourGroundParam | 0,
            heightMap: scene.tileHeights[level],
            heightMapAbove: level < scene.levels - 1 ? scene.tileHeights[level + 1] : undefined,
            entityX: (tileX << 7) + (sizeX << 6),
            entityY: centerHeight | 0,
            entityZ: (tileY << 7) + (sizeY << 6),
        };

        const model = locModelLoader.getModelAnimated(
            resolvedLocType,
            (record.placementType | 0) as LocModelType,
            placementRotation,
            -1,
            -1,
            contourGroundInfo,
        );
        if (!model) {
            continue;
        }

        const modelHash = getModelHash(modelHashBuf, model) | 0;
        const faces = getModelFaces(model);
        let opaqueElements = 0;
        let alphaElements = 0;
        for (let fi = 0; fi < faces.length; fi++) {
            if (isModelFaceTransparent(textureLoader, faces[fi])) {
                alphaElements += 3;
            } else {
                opaqueElements += 3;
            }
        }

        const key =
            String(locTypeId) +
            "|" +
            String(record.placementType | 0) +
            "|" +
            String(placementRotation) +
            "|" +
            String(modelHash) +
            "|" +
            String(opaqueElements) +
            "|" +
            String(alphaElements);
        const stat = byKey.get(key);
        if (stat) {
            stat.count = (stat.count + 1) | 0;
        } else {
            byKey.set(key, {
                locTypeId,
                placementType: record.placementType | 0,
                placementRotation,
                modelHash,
                opaqueElements,
                alphaElements,
                count: 1,
            });
        }
    }

    return Array.from(byKey.values()).sort((a, b) => {
        if ((a.locTypeId | 0) !== (b.locTypeId | 0)) {
            return (a.locTypeId | 0) - (b.locTypeId | 0);
        }
        if ((a.placementType | 0) !== (b.placementType | 0)) {
            return (a.placementType | 0) - (b.placementType | 0);
        }
        if ((a.placementRotation | 0) !== (b.placementRotation | 0)) {
            return (a.placementRotation | 0) - (b.placementRotation | 0);
        }
        if ((b.count | 0) !== (a.count | 0)) {
            return (b.count | 0) - (a.count | 0);
        }
        return (a.modelHash | 0) - (b.modelHash | 0);
    });
}

function summarizeTsLocModelHashStats(
    stats: readonly TsLocModelHashStat[],
    label: string,
    maxLines: number,
): string[] {
    if (!stats || stats.length <= 0) {
        return [`  ts-model-hash(${label}): <none>`];
    }

    const byTypeRot = new Map<string, { hashes: Set<number>; total: number }>();
    for (let i = 0; i < stats.length; i++) {
        const s = stats[i];
        const key = `${s.locTypeId | 0}|t${s.placementType | 0}|r${s.placementRotation | 0}`;
        const v = byTypeRot.get(key) ?? { hashes: new Set<number>(), total: 0 };
        v.hashes.add(s.modelHash | 0);
        v.total = (v.total + (s.count | 0)) | 0;
        byTypeRot.set(key, v);
    }

    const lines: string[] = [];
    const lineLimit = Math.max(1, maxLines | 0);
    const typeRotSummary = Array.from(byTypeRot.entries())
        .map(([key, v]) => [key, { placements: v.total | 0, hashes: v.hashes.size | 0 }] as const)
        .sort((a, b) => {
            if ((b[1].hashes | 0) !== (a[1].hashes | 0)) {
                return (b[1].hashes | 0) - (a[1].hashes | 0);
            }
            if ((b[1].placements | 0) !== (a[1].placements | 0)) {
                return (b[1].placements | 0) - (a[1].placements | 0);
            }
            return a[0].localeCompare(b[0]);
        })
        .slice(0, lineLimit)
        .map(([key, v]) => [key, `${v.placements}/${v.hashes}`] as const);

    lines.push(
        `  ts-model-hash(${label}) byTypeRot placements/hashCount=${JSON.stringify(
            typeRotSummary,
        )}`,
    );

    const topStats = [...stats]
        .sort((a, b) => {
            if ((b.count | 0) !== (a.count | 0)) {
                return (b.count | 0) - (a.count | 0);
            }
            if ((a.locTypeId | 0) !== (b.locTypeId | 0)) {
                return (a.locTypeId | 0) - (b.locTypeId | 0);
            }
            if ((a.placementType | 0) !== (b.placementType | 0)) {
                return (a.placementType | 0) - (b.placementType | 0);
            }
            if ((a.placementRotation | 0) !== (b.placementRotation | 0)) {
                return (a.placementRotation | 0) - (b.placementRotation | 0);
            }
            return (a.modelHash | 0) - (b.modelHash | 0);
        })
        .slice(0, lineLimit);

    for (let i = 0; i < topStats.length && lines.length < lineLimit; i++) {
        const s = topStats[i];
        lines.push(
            `  ts-model-hash(${label}) id=${s.locTypeId | 0} t=${s.placementType | 0} r=${
                s.placementRotation | 0
            } hash=${s.modelHash | 0} opaque=${s.opaqueElements | 0} alpha=${
                s.alphaElements | 0
            } count=${s.count | 0}`,
        );
    }

    return lines;
}

function summarizeTsVsRuntimeModelSignal(
    tsStats: readonly TsLocModelHashStat[] | undefined,
    runtimeEntries: readonly RuntimeLocMergeDecisionEntry[] | undefined,
    locTypeIds: readonly number[],
    maxLines: number,
): string[] {
    if (!tsStats || tsStats.length <= 0) {
        return ["  model-signal-compare: <no-ts-model-hash-stats>"];
    }
    if (!runtimeEntries || runtimeEntries.length <= 0) {
        return ["  model-signal-compare: <no-runtime-merge-entries>"];
    }

    const targetSet = new Set<number>((locTypeIds ?? []).map((id) => id | 0));
    const isTarget = (locTypeId: number): boolean =>
        targetSet.size <= 0 || targetSet.has(locTypeId | 0);

    type Agg = {
        locTypeId: number;
        variantType: number;
        variantRotation: number;
        tsPlacements: number;
        tsHashes: Set<number>;
        rtEntries: number;
        rtSignatures: Set<number>;
        rtGroups: Set<number>;
    };
    const byKey = new Map<string, Agg>();
    const getAgg = (locTypeId: number, variantType: number, variantRotation: number): Agg => {
        const key = `${locTypeId | 0}|t${variantType | 0}|r${variantRotation | 0}`;
        const existing = byKey.get(key);
        if (existing) {
            return existing;
        }
        const created: Agg = {
            locTypeId: locTypeId | 0,
            variantType: variantType | 0,
            variantRotation: variantRotation | 0,
            tsPlacements: 0,
            tsHashes: new Set<number>(),
            rtEntries: 0,
            rtSignatures: new Set<number>(),
            rtGroups: new Set<number>(),
        };
        byKey.set(key, created);
        return created;
    };

    for (let i = 0; i < tsStats.length; i++) {
        const s = tsStats[i];
        if (!isTarget(s.locTypeId | 0)) {
            continue;
        }
        const agg = getAgg(s.locTypeId | 0, s.placementType | 0, s.placementRotation | 0);
        agg.tsPlacements = (agg.tsPlacements + (s.count | 0)) | 0;
        agg.tsHashes.add(s.modelHash | 0);
    }

    for (let i = 0; i < runtimeEntries.length; i++) {
        const e = runtimeEntries[i];
        const locTypeId = e.locTypeId | 0;
        if (!isTarget(locTypeId)) {
            continue;
        }
        const agg = getAgg(locTypeId, e.variantType | 0, e.variantRotation | 0);
        agg.rtEntries = (agg.rtEntries + 1) | 0;
        agg.rtSignatures.add(e.modelSignature | 0);
        agg.rtGroups.add(e.chosenGroupIndex | 0);
    }

    const rows = Array.from(byKey.values());
    if (rows.length <= 0) {
        return ["  model-signal-compare: <no-target-rows>"];
    }

    rows.sort((a, b) => {
        const aSigDelta = Math.abs((a.rtSignatures.size | 0) - (a.tsHashes.size | 0));
        const bSigDelta = Math.abs((b.rtSignatures.size | 0) - (b.tsHashes.size | 0));
        if (aSigDelta !== bSigDelta) {
            return bSigDelta - aSigDelta;
        }
        const aGroupDelta = Math.abs((a.rtGroups.size | 0) - (a.tsHashes.size | 0));
        const bGroupDelta = Math.abs((b.rtGroups.size | 0) - (b.tsHashes.size | 0));
        if (aGroupDelta !== bGroupDelta) {
            return bGroupDelta - aGroupDelta;
        }
        const aEntryDelta = Math.abs((a.rtEntries | 0) - (a.tsPlacements | 0));
        const bEntryDelta = Math.abs((b.rtEntries | 0) - (b.tsPlacements | 0));
        if (aEntryDelta !== bEntryDelta) {
            return bEntryDelta - aEntryDelta;
        }
        if ((a.locTypeId | 0) !== (b.locTypeId | 0)) {
            return (a.locTypeId | 0) - (b.locTypeId | 0);
        }
        if ((a.variantType | 0) !== (b.variantType | 0)) {
            return (a.variantType | 0) - (b.variantType | 0);
        }
        return (a.variantRotation | 0) - (b.variantRotation | 0);
    });

    const lineLimit = Math.max(1, maxLines | 0);
    let mismatchRows = 0;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (
            (r.tsHashes.size | 0) !== (r.rtSignatures.size | 0) ||
            (r.tsHashes.size | 0) !== (r.rtGroups.size | 0) ||
            (r.tsPlacements | 0) !== (r.rtEntries | 0)
        ) {
            mismatchRows++;
        }
    }

    const lines: string[] = [];
    lines.push(
        `  model-signal-compare rows=${rows.length} mismatches=${mismatchRows} targets=${
            targetSet.size > 0
                ? Array.from(targetSet)
                      .sort((a, b) => a - b)
                      .join(",")
                : "<all>"
        }`,
    );

    const n = Math.min(lineLimit, rows.length);
    for (let i = 0; i < n; i++) {
        const r = rows[i];
        const tsHashCount = r.tsHashes.size | 0;
        const rtSigCount = r.rtSignatures.size | 0;
        const rtGroupCount = r.rtGroups.size | 0;
        const dSig = (rtSigCount - tsHashCount) | 0;
        const dGrp = (rtGroupCount - tsHashCount) | 0;
        const dN = ((r.rtEntries | 0) - (r.tsPlacements | 0)) | 0;
        lines.push(
            `  model-signal-compare key=${r.locTypeId | 0}|t${r.variantType | 0}|r${
                r.variantRotation | 0
            } ts{n=${r.tsPlacements | 0} hash=${tsHashCount}} rt{n=${
                r.rtEntries | 0
            } sig=${rtSigCount} grp=${rtGroupCount}} dSig=${dSig} dGrp=${dGrp} dN=${dN}`,
        );
    }
    return lines;
}

type TsMergeNormalsTraceEntityInfo = Readonly<{
    locTypeId: number;
    sourceKind: number;
    level: number;
    tileX: number;
    tileY: number;
    sizeX: number;
    sizeY: number;
}>;

type TsMergeNormalsTraceEntry = Readonly<{
    aLocTypeId: number;
    aSourceKind: number;
    aLevel: number;
    aTileX: number;
    aTileY: number;
    aSizeX: number;
    aSizeY: number;
    bLocTypeId: number;
    bSourceKind: number;
    bLevel: number;
    bTileX: number;
    bTileY: number;
    bSizeX: number;
    bSizeY: number;
    offX: number;
    offY: number;
    offZ: number;
    hideOccluded: number;
}>;

function collectTsMergeNormalsEntityInfo(
    scene: Scene,
): Map<ModelData, TsMergeNormalsTraceEntityInfo> {
    const out = new Map<ModelData, TsMergeNormalsTraceEntityInfo>();
    const setIfModel = (entity: unknown, info: TsMergeNormalsTraceEntityInfo): void => {
        if (!(entity instanceof ModelData)) {
            return;
        }
        if (!out.has(entity)) {
            out.set(entity, info);
        }
    };

    for (let level = 0; level < scene.levels; level++) {
        for (let tileX = 0; tileX < scene.sizeX; tileX++) {
            for (let tileY = 0; tileY < scene.sizeY; tileY++) {
                const tile = scene.tiles[level][tileX][tileY];
                if (!tile) {
                    continue;
                }
                if (tile.wall) {
                    const locTypeId = getIdFromTag(tile.wall.tag as any) | 0;
                    setIfModel(tile.wall.entity0, {
                        locTypeId,
                        sourceKind: 1,
                        level,
                        tileX,
                        tileY,
                        sizeX: 1,
                        sizeY: 1,
                    });
                    setIfModel(tile.wall.entity1, {
                        locTypeId,
                        sourceKind: 2,
                        level,
                        tileX,
                        tileY,
                        sizeX: 1,
                        sizeY: 1,
                    });
                }
                for (let i = 0; i < tile.locs.length; i++) {
                    const loc = tile.locs[i];
                    setIfModel(loc.entity, {
                        locTypeId: getIdFromTag(loc.tag as any) | 0,
                        sourceKind: 3,
                        level: loc.level | 0,
                        tileX: loc.startX | 0,
                        tileY: loc.startY | 0,
                        sizeX: (loc.endX - loc.startX + 1) | 0,
                        sizeY: (loc.endY - loc.startY + 1) | 0,
                    });
                }
                if (tile.floorDecoration) {
                    setIfModel(tile.floorDecoration.entity, {
                        locTypeId: getIdFromTag(tile.floorDecoration.tag as any) | 0,
                        sourceKind: 4,
                        level,
                        tileX,
                        tileY,
                        sizeX: 1,
                        sizeY: 1,
                    });
                }
            }
        }
    }
    return out;
}

function captureTsMergeNormalsTraceForSquare(
    sceneBuilder: SceneBuilder,
    mapBytesProvider: MapFileBytesProvider,
    sceneBuildInput: Record<string, unknown>,
    locTypeIds: readonly number[],
): ReadonlyArray<TsMergeNormalsTraceEntry> {
    const baseX = (sceneBuildInput.baseX as number) | 0;
    const baseY = (sceneBuildInput.baseY as number) | 0;
    const sizeX = (sceneBuildInput.sizeX as number) | 0;
    const sizeY = (sceneBuildInput.sizeY as number) | 0;
    const smoothTerrain = !!sceneBuildInput.smoothTerrain;
    const context = createSceneBuildContext(
        baseX,
        baseY,
        sizeX,
        sizeY,
        smoothTerrain,
        LocLoadType.MODELS,
    );
    const scene = new Scene(Scene.MAX_LEVELS, context.sizeX, context.sizeY);
    const emptyTerrainIds = decodeTerrainStage(sceneBuilder, mapBytesProvider, scene, context);
    fillEmptyTerrainStage(sceneBuilder, scene, context, emptyTerrainIds);
    decodeLocsStage(sceneBuilder, mapBytesProvider, scene, context);
    sceneBuilder.addTileModels(scene, smoothTerrain);
    scene.setTileMinLevels();

    const infoByModel = collectTsMergeNormalsEntityInfo(scene);
    const targetSet = new Set<number>((locTypeIds ?? []).map((id) => id | 0));
    const events: TsMergeNormalsTraceEntry[] = [];
    const proto = ModelData.prototype as unknown as {
        mergeNormals: (
            other: unknown,
            offX: number,
            offY: number,
            offZ: number,
            hideOccluded: boolean,
            scratch: unknown,
        ) => unknown;
    };
    const originalMergeNormals = proto.mergeNormals;
    if (typeof originalMergeNormals !== "function") {
        return events;
    }
    proto.mergeNormals = function (
        this: ModelData,
        other: unknown,
        offX: number,
        offY: number,
        offZ: number,
        hideOccluded: boolean,
        scratch: unknown,
    ): unknown {
        const aInfo = infoByModel.get(this);
        const bInfo = other instanceof ModelData ? infoByModel.get(other) : undefined;
        if (aInfo && bInfo) {
            const capture =
                targetSet.size <= 0 ||
                targetSet.has(aInfo.locTypeId | 0) ||
                targetSet.has(bInfo.locTypeId | 0);
            if (capture) {
                events.push({
                    aLocTypeId: aInfo.locTypeId | 0,
                    aSourceKind: aInfo.sourceKind | 0,
                    aLevel: aInfo.level | 0,
                    aTileX: aInfo.tileX | 0,
                    aTileY: aInfo.tileY | 0,
                    aSizeX: aInfo.sizeX | 0,
                    aSizeY: aInfo.sizeY | 0,
                    bLocTypeId: bInfo.locTypeId | 0,
                    bSourceKind: bInfo.sourceKind | 0,
                    bLevel: bInfo.level | 0,
                    bTileX: bInfo.tileX | 0,
                    bTileY: bInfo.tileY | 0,
                    bSizeX: bInfo.sizeX | 0,
                    bSizeY: bInfo.sizeY | 0,
                    offX: offX | 0,
                    offY: offY | 0,
                    offZ: offZ | 0,
                    hideOccluded: hideOccluded ? 1 : 0,
                });
            }
        }
        return originalMergeNormals.call(this, other, offX, offY, offZ, hideOccluded, scratch);
    };
    try {
        scene.light(sceneBuilder.textureLoader, -50, -10, -50);
    } finally {
        proto.mergeNormals = originalMergeNormals;
    }
    return events;
}

function summarizeTsVsRuntimeMergeNormalsTrace(
    tsEntries: readonly TsMergeNormalsTraceEntry[],
    runtimeEntries: readonly RuntimeLocMergeNormalsTraceEntry[] | undefined,
    locTypeIds: readonly number[],
): string[] {
    const targetSet = new Set<number>((locTypeIds ?? []).map((id) => id | 0));
    const isTarget = (aLocTypeId: number, bLocTypeId: number): boolean =>
        targetSet.size <= 0 || targetSet.has(aLocTypeId | 0) || targetSet.has(bLocTypeId | 0);

    const tsFiltered = tsEntries.filter((e) => isTarget(e.aLocTypeId | 0, e.bLocTypeId | 0));
    const runtimeFiltered = (runtimeEntries ?? []).filter((e) =>
        isTarget(e.aLocTypeId | 0, e.bLocTypeId | 0),
    );

    const toKeyTs = (e: TsMergeNormalsTraceEntry): string =>
        `${e.aLocTypeId}|${e.aLevel},${e.aTileX},${e.aTileY},${e.aSizeX}x${e.aSizeY}` +
        `->${e.bLocTypeId}|${e.bLevel},${e.bTileX},${e.bTileY},${e.bSizeX}x${e.bSizeY}` +
        ` off=${e.offX},${e.offY},${e.offZ} hide=${e.hideOccluded}`;
    const toKeyRuntime = (e: RuntimeLocMergeNormalsTraceEntry): string =>
        `${e.aLocTypeId}|${e.aLevel},${e.aTileX},${e.aTileY},${e.aSizeX}x${e.aSizeY}` +
        `->${e.bLocTypeId}|${e.bLevel},${e.bTileX},${e.bTileY},${e.bSizeX}x${e.bSizeY}` +
        ` off=${e.offX},${e.offY},${e.offZ} hide=${e.hideOccluded}`;

    const lines: string[] = [];
    lines.push(
        `  mergeNormals-trace ts=${tsFiltered.length} runtime=${runtimeFiltered.length} targets=${
            targetSet.size > 0
                ? Array.from(targetSet)
                      .sort((a, b) => a - b)
                      .join(",")
                : "<all>"
        }`,
    );
    if (!runtimeEntries) {
        lines.push("  mergeNormals-trace runtime=<missing>");
        return lines;
    }

    const minLen = Math.min(tsFiltered.length, runtimeFiltered.length);
    let firstDiff = -1;
    for (let i = 0; i < minLen; i++) {
        if (toKeyTs(tsFiltered[i]) !== toKeyRuntime(runtimeFiltered[i])) {
            firstDiff = i;
            break;
        }
    }
    if (firstDiff < 0 && tsFiltered.length !== runtimeFiltered.length) {
        firstDiff = minLen;
    }
    if (firstDiff < 0) {
        lines.push("  mergeNormals-trace firstDiff=<none>");
        return lines;
    }

    lines.push(`  mergeNormals-trace firstDiffIndex=${firstDiff}`);
    const start = Math.max(0, firstDiff - 3);
    const end = Math.min(Math.max(tsFiltered.length, runtimeFiltered.length), firstDiff + 4);
    for (let i = start; i < end; i++) {
        const ts = i < tsFiltered.length ? tsFiltered[i] : undefined;
        const rt = i < runtimeFiltered.length ? runtimeFiltered[i] : undefined;
        const tsStr = ts ? `${toKeyTs(ts)} src=${ts.aSourceKind}->${ts.bSourceKind}` : "<none>";
        const rtStr = rt
            ? `${toKeyRuntime(rt)} merged=${rt.mergedCount | 0} kind=${rt.callKind | 0}`
            : "<none>";
        lines.push(`    [${i}] ts=${tsStr}`);
        lines.push(`    [${i}] rt=${rtStr}`);
    }
    return lines;
}
