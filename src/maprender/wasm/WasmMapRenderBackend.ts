import { getWindowObjSpawns } from "../../data/obj/ObjSpawn";
import { NpcSpawnResolver } from "../../data/npc/NpcSpawnResolver";
import { errorToString } from "../../util/ErrorUtil";
import { LocLoadType } from "../../rs/scene/SceneBuilder";
import { Scene } from "../../rs/scene/Scene";
import { buildSceneFromMapBytesProvider } from "../../rs/scene/buildSceneFromMapBytesProvider";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeHandle,
} from "../../wasm/MapRenderRuntimeBridgeAbi";
import { mapRenderRuntimeBridge } from "../../wasm/rs_map_runtime_bridge.mjs";
import type {
    MapRenderBackend,
    MapRenderBackendKind,
    MapRenderBackendOptions,
    MapRenderBuildDeps,
    RenderDataResult,
} from "../MapRenderBackend";
import { collectSdMapDataTransferables } from "../MapRenderBackend";
import type {
    ObjRenderData,
    SdMapData,
    SdMapLoaderInput,
} from "../MapRenderPayload";
import type {
    MapRuntimeBootstrap,
    MapRuntimeRegistration,
} from "../../runtime/MapRuntimePayload";
import {
    buildMapRuntimePayloads,
} from "../../runtime/MapRuntimePayload";
import { mapObjStateFromRenderData } from "../MapObjState";
import { buildNpcGeometry } from "../build/NpcGeometryBuilder";
import { buildObjRenderData } from "../build/ObjRenderDataBuilder";
import { createBootstrapData } from "../../runtime/sim/NpcBootstrap";
import {
    MapRenderByteDrivenSceneBuildInput,
    WasmCacheUploader,
    createByteDrivenSceneBuildInput,
    createSceneBuildCacheProvider,
} from "./WasmCacheUploader";
import { runtimePacketToPayloadOverlay } from "./WasmPacketOverlay";

type WasmMapRenderDataBridge = MapRenderRuntimeBridgeV2;
type BuiltNpcFallbackData = Readonly<{
    npcVertices: Uint8Array | undefined;
    npcIndices: Int32Array | undefined;
    npcDrawRangesBase: Int32Array | undefined;
    npcDrawRangesAlpha: Int32Array | undefined;
    npcOrderKeys: Int32Array | undefined;
    npcTypeAnimationTable: ReturnType<typeof createBootstrapData>["npcTypeAnimationTable"];
}>;

export class WasmMapRenderBackend implements MapRenderBackend {
    private static readonly MAP_SQUARE_SIZE = 64;

    readonly kind: MapRenderBackendKind = "cpp-wasm";
    private readonly bridge: WasmMapRenderDataBridge = mapRenderRuntimeBridge;
    private runtimeInitPromise: Promise<boolean> | undefined;
    private runtimeHandlePromise: Promise<MapRenderRuntimeHandle | undefined> | undefined;
    private runtimeHandle: MapRenderRuntimeHandle | undefined;
    private readonly cacheUploader = new WasmCacheUploader();
    private readonly npcSpawnResolver = new NpcSpawnResolver();
    private readonly cacheProvider = (() => {
        const { session } = this.deps;
        const loaders = session.loaders;
        return createSceneBuildCacheProvider({
            mapBytesProvider: this.deps.mapBytesProvider,
            locTypeLoader: loaders.locTypeLoader,
            objTypeLoader: loaders.objTypeLoader,
            modelLoader: loaders.modelLoader,
            seqTypeLoader: loaders.seqTypeLoader,
            seqFrameLoader: loaders.seqFrameLoader,
            skeletalSeqLoader: loaders.skeletalSeqLoader,
            npcTypeLoader: loaders.npcTypeLoader,
            basTypeLoader: loaders.basTypeLoader,
            underlayTypeLoader: loaders.underlayTypeLoader,
            overlayTypeLoader: loaders.overlayTypeLoader,
            varbitLoader: session.varManager.varbitLoader,
            textureLoader: loaders.textureLoader,
        });
    })();

    constructor(
        private readonly deps: MapRenderBuildDeps,
        private readonly options: MapRenderBackendOptions | undefined,
    ) {}

    private async buildNpcFallbackData(
        input: SdMapLoaderInput,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
    ): Promise<BuiltNpcFallbackData | undefined> {
        // TODO: move this NPC animation bootstrap data production into the cpp-wasm packet/runtime
        // output so the wasm backend remains the single source of truth for static map runtime payloads.
        if (input.loadNpcs !== true) {
            return undefined;
        }

        const loaders = this.deps.session.loaders;
        const npcSpawns = await this.npcSpawnResolver.resolveSpawns(
            {
                mapBytesProvider: this.deps.mapBytesProvider,
                cacheInfo: this.deps.session.cache.info,
                npcSpawnDecodeBackend: this.deps.npcSpawnDecodeBackend,
                fallbackNpcSpawns: this.deps.fallbackNpcSpawns,
            },
            {
                loadNpcs: true,
                mapX: input.mapX,
                mapY: input.mapY,
                maxLevel: input.maxLevel,
                borderSize: borderSize | 0,
                tileRenderFlagsLevel1,
                npcTypeLoader: loaders.npcTypeLoader,
            },
        );

        const npcGeometry = buildNpcGeometry({
            loadNpcs: true,
            includeNpcAnimationFrames: true,
            npcSpawns,
            textureLoader: loaders.textureLoader,
            npcModelLoader: this.deps.npcModelLoader,
            npcTypeLoader: loaders.npcTypeLoader,
            seqTypeLoader: loaders.seqTypeLoader,
            basTypeLoader: loaders.basTypeLoader,
        });
        if ((npcGeometry.npcs.length | 0) <= 0) {
            return undefined;
        }

        const bootstrap = createBootstrapData({
            mapId: getMapSquareId(input.mapX | 0, input.mapY | 0),
            npcsIn: npcGeometry.npcs,
        });

        return {
            npcVertices: npcGeometry.npcVertices,
            npcIndices: npcGeometry.npcIndices,
            npcDrawRangesBase: npcGeometry.npcDrawRangesBase,
            npcDrawRangesAlpha: npcGeometry.npcDrawRangesAlpha,
            npcOrderKeys:
                (npcGeometry.npcs.length | 0) > 0
                    ? Int32Array.from(npcGeometry.npcs, (npc) => npc.orderKey ?? -1)
                    : undefined,
            npcTypeAnimationTable: bootstrap.npcTypeAnimationTable,
        };
    }

    private static createRuntimeCacheBuildRequest(
        sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    ): MapRenderRuntimeBuildRequest | undefined {
        const sizeX = sceneBuildInput.sizeX | 0;
        const sizeY = sceneBuildInput.sizeY | 0;
        if (sizeX <= 0 || sizeY <= 0) {
            return undefined;
        }
        const borderX = ((sizeX - WasmMapRenderBackend.MAP_SQUARE_SIZE) / 2) | 0;
        const borderY = ((sizeY - WasmMapRenderBackend.MAP_SQUARE_SIZE) / 2) | 0;
        if (
            borderX < 0 ||
            borderY < 0 ||
            borderX !== borderY ||
            sizeX !== WasmMapRenderBackend.MAP_SQUARE_SIZE + borderX * 2 ||
            sizeY !== WasmMapRenderBackend.MAP_SQUARE_SIZE + borderY * 2
        ) {
            return undefined;
        }
        return {
            mapX: sceneBuildInput.mapX | 0,
            mapY: sceneBuildInput.mapY | 0,
            borderSize: borderX,
            sizeX,
            sizeY,
            cacheGame: sceneBuildInput.cacheGame | 0,
            cacheRevision: sceneBuildInput.cacheRevision | 0,
            unitsTileHeightBasis: sceneBuildInput.unitsTileHeightBasis | 0,
            smoothTerrain: sceneBuildInput.smoothTerrain,
            locLoadType: sceneBuildInput.locLoadType | 0,
            minimizeDrawCalls: sceneBuildInput.minimizeDrawCalls,
            loadLocs: sceneBuildInput.loadLocs,
            loadObjs: sceneBuildInput.loadObjs,
            loadNpcs: sceneBuildInput.loadNpcs,
        };
    }

    private static createEmptyTileRenderFlags(
        levels: number,
        sizeX: number,
        sizeY: number,
    ): Uint8Array[][] {
        const lv = Math.max(0, levels | 0);
        const sx = Math.max(0, sizeX | 0);
        const sy = Math.max(0, sizeY | 0);
        const out: Uint8Array[][] = new Array(lv);
        for (let l = 0; l < lv; l++) {
            const cols: Uint8Array[] = new Array(sx);
            for (let x = 0; x < sx; x++) {
                cols[x] = new Uint8Array(sy);
            }
            out[l] = cols;
        }
        return out;
    }

    private async ensureRuntimeInitialized(): Promise<boolean> {
        if (!this.runtimeInitPromise) {
            this.runtimeInitPromise = this.bridge.initRuntime();
        }
        return this.runtimeInitPromise;
    }

    private async ensureRuntimeHandle(): Promise<MapRenderRuntimeHandle | undefined> {
        if (!this.runtimeHandlePromise) {
            this.runtimeHandlePromise = this.bridge.createRuntimeWithConfig({
                cacheGame: this.deps.session.cache.info.game | 0,
                cacheRevision: this.deps.session.cache.info.revision | 0,
                sceneLevels: 4,
                unitsTileHeightBasis: 8,
            });
        }
        const runtimeHandle = await this.runtimeHandlePromise;
        if (runtimeHandle !== undefined) {
            this.runtimeHandle = runtimeHandle;
        }
        return runtimeHandle;
    }

    private createByteDrivenSceneBuildInput(
        input: SdMapLoaderInput,
    ): MapRenderByteDrivenSceneBuildInput {
        const { session, objSpawns } = this.deps;
        const varManager = session.varManager;
        const varpValues =
            varManager.values instanceof Int32Array
                ? new Int32Array(varManager.values)
                : new Int32Array(0);
        return createByteDrivenSceneBuildInput(input, {
            objSpawns,
            varpValues,
            cacheProvider: this.cacheProvider,
            cacheGame: session.cache.info.game,
            cacheRevision: session.cache.info.revision,
        });
    }

    private async buildWithBridge(
        bridge: WasmMapRenderDataBridge,
        runtimeHandle: MapRenderRuntimeHandle,
        input: SdMapLoaderInput,
        byteDrivenSceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    ): Promise<
        | {
              data: SdMapData;
              runtimeRegistration: MapRuntimeRegistration;
              runtimeBootstrap: MapRuntimeBootstrap;
          }
        | undefined
    > {
        const staticBuildInput =
            input.loadObjs === true
                ? { ...byteDrivenSceneBuildInput, loadObjs: false }
                : byteDrivenSceneBuildInput;
        const request = WasmMapRenderBackend.createRuntimeCacheBuildRequest(staticBuildInput);
        if (!request) {
            return undefined;
        }
        const buildResult = await this.cacheUploader.prepareAndBuildMapPacketFromCacheDetailed(
            bridge,
            runtimeHandle,
            request,
            staticBuildInput,
        );
        if (!buildResult.ok) {
            console.warn("[map-render][cpp-wasm] prepareAndBuildMapPacketFromCache failed", {
                square: `${input.mapX}:${input.mapY}`,
                reason: buildResult.reason,
                status: buildResult.status,
                passesTried: buildResult.passesTried,
                missingCount: buildResult.missingCount,
                lastBuildFailure: buildResult.lastBuildFailure,
            });
            return undefined;
        }
        const packet = buildResult.packet;
        if (!packet) {
            return undefined;
        }
        const overlay = runtimePacketToPayloadOverlay(packet);
        if (!overlay) {
            return undefined;
        }
        if (
            !(packet.vertices instanceof Uint8Array) ||
            packet.vertices.length <= 0 ||
            !(packet.indices instanceof Int32Array) ||
            packet.indices.length <= 0 ||
            !(packet.usedTextureIds instanceof Int32Array)
        ) {
            return undefined;
        }

        const levels = packet.levels | 0;
        const sizeX = packet.sizeX | 0;
        const sizeY = packet.sizeY | 0;

        const borderSize = request.borderSize | 0;
        const npcFallbackData = await this.buildNpcFallbackData(
            input,
            borderSize,
            WasmMapRenderBackend.createEmptyTileRenderFlags(levels, sizeX, sizeY)[1] ?? [],
        );
        // TODO: if the shared TS/runtime 50,50 NPC issue is fixed upstream, re-check whether this
        // wasm-only NPC geometry backfill is still needed and remove it if it becomes redundant.
        const shouldUseFallbackNpcGeometry =
            input.loadNpcs === true &&
            npcFallbackData !== undefined &&
            (
                !(packet.npcVertices instanceof Uint8Array) ||
                packet.npcVertices.length <= 0 ||
                !(packet.npcIndices instanceof Int32Array) ||
                packet.npcIndices.length <= 0 ||
                !(packet.npcDrawRangesBase instanceof Int32Array) ||
                packet.npcDrawRangesBase.length <= 0
            );
        const tileRenderFlags = WasmMapRenderBackend.createEmptyTileRenderFlags(levels, sizeX, sizeY);
        const data: SdMapData = {
            mapId: ((input.mapX << 8) | input.mapY) & 0xffff,
            mapX: input.mapX | 0,
            mapY: input.mapY | 0,
            cacheName: this.deps.session.cache.info.name,
            maxLevel: input.maxLevel | 0,
            loadObjs: input.loadObjs === true,
            loadNpcs: input.loadNpcs === true,
            loadLocs: input.loadLocs === true,
            smoothTerrain: input.smoothTerrain === true,
            borderSize,
            tileRenderFlags,
            minimapBlob: new Blob(),
            vertices: packet.vertices,
            indices: packet.indices,
            modelInfoTextures: overlay.modelInfoTextures,
            heightMapTextureData: overlay.heightMapTextureData,
            drawRanges: overlay.drawRanges,
            usedTextureIds: packet.usedTextureIds,
            loadedTextures: new Map(),
            npcDrawRangesBase: shouldUseFallbackNpcGeometry
                ? npcFallbackData?.npcDrawRangesBase
                : packet.npcDrawRangesBase,
            npcDrawRangesAlpha: shouldUseFallbackNpcGeometry
                ? npcFallbackData?.npcDrawRangesAlpha
                : packet.npcDrawRangesAlpha,
            npcVertices: shouldUseFallbackNpcGeometry
                ? npcFallbackData?.npcVertices
                : packet.npcVertices,
            npcIndices: shouldUseFallbackNpcGeometry
                ? npcFallbackData?.npcIndices
                : packet.npcIndices,
        };
        const objSpawns =
            input.loadObjs === true
                ? getWindowObjSpawns(
                      this.deps.objSpawns,
                      input.maxLevel | 0,
                      input.mapX * WasmMapRenderBackend.MAP_SQUARE_SIZE - borderSize,
                      input.mapY * WasmMapRenderBackend.MAP_SQUARE_SIZE - borderSize,
                      WasmMapRenderBackend.MAP_SQUARE_SIZE + borderSize * 2,
                      WasmMapRenderBackend.MAP_SQUARE_SIZE + borderSize * 2,
                  )
                : [];
        let objRenderData: ObjRenderData | undefined;
        if (objSpawns.length > 0) {
            const scene = buildSceneFromMapBytesProvider(
                this.deps.sceneBuilder,
                this.deps.mapBytesProvider,
                input.mapX * Scene.MAP_SQUARE_SIZE - borderSize,
                input.mapY * Scene.MAP_SQUARE_SIZE - borderSize,
                Scene.MAP_SQUARE_SIZE + borderSize * 2,
                Scene.MAP_SQUARE_SIZE + borderSize * 2,
                input.smoothTerrain === true,
                input.loadLocs ? LocLoadType.MODELS : LocLoadType.NO_MODELS,
                input.locPlacementOverrides,
            );
            objRenderData = buildObjRenderData({
                loadObjs: true,
                objTypeLoader: this.deps.session.loaders.objTypeLoader,
                objModelLoader: this.deps.objModelLoader,
                scene,
                textureLoader: this.deps.session.loaders.textureLoader,
                baseX: input.mapX * Scene.MAP_SQUARE_SIZE - borderSize,
                baseY: input.mapY * Scene.MAP_SQUARE_SIZE - borderSize,
                borderSize,
                objSpawns,
                minimizeDrawCalls: input.minimizeDrawCalls,
            });
        }
        const runtimePayloads = buildMapRuntimePayloads({
            borderSize,
            tileRenderFlags: data.tileRenderFlags,
            locsAnimated: [],
            npcTypeAnimationTable: npcFallbackData?.npcTypeAnimationTable ?? [],
            npcOrderKeys: shouldUseFallbackNpcGeometry
                ? npcFallbackData?.npcOrderKeys
                : packet.npcOrderKeys,
            mapObjState: mapObjStateFromRenderData(objRenderData),
        });
        return {
            data,
            runtimeRegistration: runtimePayloads.runtimeRegistration,
            runtimeBootstrap: runtimePayloads.runtimeBootstrap,
        };
    }

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const bridge = this.bridge;
        if (!(await this.ensureRuntimeInitialized())) {
            return { data: undefined, transferables: [] };
        }
        const runtimeHandle = await this.ensureRuntimeHandle();
        if (runtimeHandle === undefined) {
            return { data: undefined, transferables: [] };
        }
        const byteDrivenSceneBuildInput = this.createByteDrivenSceneBuildInput(input);
        try {
            const result = await this.buildWithBridge(
                bridge,
                runtimeHandle,
                input,
                byteDrivenSceneBuildInput,
            );
            if (!result) {
                return { data: undefined, transferables: [] };
            }
            return {
                data: result.data,
                transferables: collectSdMapDataTransferables(result.data),
                runtimeRegistration: result.runtimeRegistration,
                runtimeBootstrap: result.runtimeBootstrap,
            };
        } catch (e) {
            console.warn(`[map-render-backend] cpp-wasm buildMapData failed: ${errorToString(e)}`);
            return { data: undefined, transferables: [] };
        }
    }

    // Exposes the underlying C++ wasm runtime handle when this backend is "cpp-wasm".
    // This allows the worker tick path to use the same runtime instance that built the map packets.
    getCppWasmRuntimeHandle(): MapRenderRuntimeHandle | undefined {
        return this.runtimeHandle;
    }

    reset(): void {
        this.cacheUploader.reset();
        this.npcSpawnResolver.reset();
        this.runtimeInitPromise = undefined;
        const runtimeHandle = this.runtimeHandle;
        this.runtimeHandle = undefined;
        this.runtimeHandlePromise = undefined;
        if (runtimeHandle !== undefined) {
            this.bridge.resetRuntime(runtimeHandle);
            this.bridge.destroyRuntime(runtimeHandle);
        }
        this.bridge.reset?.();
    }
}
