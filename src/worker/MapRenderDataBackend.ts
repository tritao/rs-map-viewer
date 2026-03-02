import type { ObjSpawn } from "../data/obj/ObjSpawn";
import { SdMapData } from "../maprender/payload/SdMapData";
import { SdMapLoaderInput } from "../maprender/payload/SdMapLoaderInput";
import { SdMapRenderDataTsBackend } from "../maprender/backend/SdMapRenderDataTsBackend";
import type { SdMapRenderDataTsBackendDeps } from "../maprender/backend/SdMapRenderDataTsBackend";
import type { MapBytesProvider } from "../rs/map/MapBytesProvider";
import type { CollisionData } from "../rs/scene/CollisionMap";
import { RenderableType } from "../renderer/Renderer";
import type { BackendKind } from "../util/BackendKind";
import { errorToString } from "../util/ErrorUtil";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeCreateConfig,
    MapRenderRuntimeHandle,
} from "../wasm/MapRenderRuntimeBridgeAbi";
// Import the runtime surface directly. The wasm module is still loaded lazily via initRuntime().
import { mapRenderRuntimeBridge } from "../wasm/rs_map_render_backend_bridge.mjs";
import { runtimePacketToPayloadOverlay, sdMapDataTransferables } from "./MapRenderDataContract";
import type { RenderDataResult } from "./RenderDataLoader";
import {
    MapRenderByteDrivenSceneBuildInput,
    MapRenderRuntimeCacheV2Uploader,
    createByteDrivenSceneBuildInput,
} from "./runtime-cache/MapRenderRuntimeCacheV2Uploader";

export type MapRenderDataBackendKind = BackendKind;

export type MapRenderDataBackendOptions = Readonly<{
    telemetry?: boolean;
}>;

export type MapRenderDataBackendDeps = SdMapRenderDataTsBackendDeps;

export interface MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind;
    buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>>;
    reset(): void;
    // Exposes the underlying C++ wasm runtime handle when this backend is "cpp-wasm".
    // This allows the worker tick path to use the same runtime instance that built the map packets.
    getCppWasmRuntimeHandle?(): MapRenderRuntimeHandle | undefined;
}

const CPP_WASM_OUTCOME_KEYS = [
    "success",
    "bridgeMissing",
    "tsPayloadEmpty",
    "bridgeReturnedEmpty",
    "validationFailed",
    "bridgeError",
] as const;

type CppWasmBuildOutcome = (typeof CPP_WASM_OUTCOME_KEYS)[number];
type CppWasmBuildOutcomeStats = Record<CppWasmBuildOutcome, number>;

function createCppWasmBuildOutcomeStats(): CppWasmBuildOutcomeStats {
    return {
        success: 0,
        bridgeMissing: 0,
        tsPayloadEmpty: 0,
        bridgeReturnedEmpty: 0,
        validationFailed: 0,
        bridgeError: 0,
    };
}

const MAP_SQUARE_SIZE = 64;

function createRuntimeCacheBuildRequest(
    sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
): MapRenderRuntimeBuildRequest | undefined {
    const sizeX = sceneBuildInput.sizeX | 0;
    const sizeY = sceneBuildInput.sizeY | 0;
    if (sizeX <= 0 || sizeY <= 0) {
        return undefined;
    }
    const borderX = ((sizeX - MAP_SQUARE_SIZE) / 2) | 0;
    const borderY = ((sizeY - MAP_SQUARE_SIZE) / 2) | 0;
    if (
        borderX < 0 ||
        borderY < 0 ||
        borderX !== borderY ||
        sizeX !== MAP_SQUARE_SIZE + borderX * 2 ||
        sizeY !== MAP_SQUARE_SIZE + borderY * 2
    ) {
        return undefined;
    }
    const borderSize = borderX;
    return {
        mapX: sceneBuildInput.mapX | 0,
        mapY: sceneBuildInput.mapY | 0,
        borderSize,
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

function createEmptyTileRenderFlags(levels: number, sizeX: number, sizeY: number): Uint8Array[][] {
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

function createEmptyCollisionDatas(levels: number, sizeX: number, sizeY: number): CollisionData[] {
    const lv = Math.max(0, levels | 0);
    const sx = Math.max(0, sizeX | 0);
    const sy = Math.max(0, sizeY | 0);
    const out: CollisionData[] = new Array(lv);
    for (let l = 0; l < lv; l++) {
        out[l] = {
            sizeX: sx,
            sizeY: sy,
            flags: new Int32Array(sx * sy),
        };
    }
    return out;
}

class TsMapRenderDataBackend implements MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind = "ts";
    private readonly backend: SdMapRenderDataTsBackend;

    constructor(deps: MapRenderDataBackendDeps) {
        this.backend = new SdMapRenderDataTsBackend(deps);
    }

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const data = await this.backend.buildMapData(input);
        return {
            data,
            transferables: data ? sdMapDataTransferables(data) : [],
        };
    }

    reset(): void {
        this.backend.reset();
    }
}

type CppWasmMapRenderDataBridge = MapRenderRuntimeBridgeV2;

class CppWasmMapRenderDataBackend implements MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind = "cpp-wasm";
    private readonly bridge: CppWasmMapRenderDataBridge =
        mapRenderRuntimeBridge as unknown as CppWasmMapRenderDataBridge;
    private runtimeInitPromise: Promise<boolean> | undefined;
    private runtimeHandlePromise: Promise<MapRenderRuntimeHandle | undefined> | undefined;
    private runtimeHandle: MapRenderRuntimeHandle | undefined;
    private readonly outcomeStats: CppWasmBuildOutcomeStats = createCppWasmBuildOutcomeStats();
    private readonly mapBytesProvider: MapBytesProvider;
    private readonly cacheName: string;
    private readonly cacheGame: number;
    private readonly cacheRevision: number;
    private readonly locTypeLoader: unknown;
    private readonly objTypeLoader: unknown;
    private readonly locModelLoader: unknown;
    private readonly seqTypeLoader: unknown;
    private readonly seqFrameLoader: unknown;
    private readonly skeletalSeqLoader: unknown;
    private readonly textureLoader: unknown;
    private readonly npcTypeLoader: unknown;
    private readonly basTypeLoader: unknown;
    private readonly underlayTypeLoader: unknown;
    private readonly overlayTypeLoader: unknown;
    private readonly varProvider: unknown;
    private readonly objSpawns: ReadonlyArray<ObjSpawn>;
    private readonly cacheUploader = new MapRenderRuntimeCacheV2Uploader();
    private buildCalls = 0;

    constructor(
        deps: MapRenderDataBackendDeps,
        private readonly options: MapRenderDataBackendOptions | undefined,
    ) {
        this.mapBytesProvider = deps.mapBytesProvider;
        this.cacheName = deps.session.cache.info.name;
        this.cacheGame = deps.session.cache.info.game;
        this.cacheRevision = deps.session.cache.info.revision;
        this.locTypeLoader = deps.session.loaders.locTypeLoader;
        this.objTypeLoader = deps.session.loaders.objTypeLoader;
        this.locModelLoader = deps.locModelLoader;
        this.seqTypeLoader = deps.session.loaders.seqTypeLoader;
        this.seqFrameLoader = deps.session.loaders.seqFrameLoader;
        this.skeletalSeqLoader = deps.session.loaders.skeletalSeqLoader;
        this.textureLoader = deps.session.getTextureLoader();
        this.npcTypeLoader = deps.session.loaders.npcTypeLoader;
        this.basTypeLoader = deps.session.loaders.basTypeLoader;
        this.underlayTypeLoader = deps.session.loaders.underlayTypeLoader;
        this.overlayTypeLoader = deps.session.loaders.overlayTypeLoader;
        this.varProvider = deps.varProvider;
        this.objSpawns = deps.objSpawns;
    }

    private async ensureRuntimeInitialized(bridge: CppWasmMapRenderDataBridge): Promise<boolean> {
        if (!this.runtimeInitPromise) {
            this.runtimeInitPromise = bridge.initRuntime();
        }
        return this.runtimeInitPromise;
    }

    private async ensureRuntimeHandle(
        bridge: CppWasmMapRenderDataBridge,
    ): Promise<MapRenderRuntimeHandle | undefined> {
        if (!this.runtimeHandlePromise) {
            this.runtimeHandlePromise = bridge.createRuntimeWithConfig({
                cacheGame: this.cacheGame | 0,
                cacheRevision: this.cacheRevision | 0,
                sceneLevels: 4,
                unitsTileHeightBasis: 8,
            } as MapRenderRuntimeCreateConfig);
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
        return createByteDrivenSceneBuildInput(input, {
            mapBytesProvider: this.mapBytesProvider,
            locTypeLoader: this.locTypeLoader,
            objTypeLoader: this.objTypeLoader,
            locModelLoader: this.locModelLoader,
            seqTypeLoader: this.seqTypeLoader,
            seqFrameLoader: this.seqFrameLoader,
            skeletalSeqLoader: this.skeletalSeqLoader,
            textureLoader: this.textureLoader,
            npcTypeLoader: this.npcTypeLoader,
            basTypeLoader: this.basTypeLoader,
            underlayTypeLoader: this.underlayTypeLoader,
            overlayTypeLoader: this.overlayTypeLoader,
            varProvider: this.varProvider,
            objSpawns: this.objSpawns,
            cacheGame: this.cacheGame,
            cacheRevision: this.cacheRevision,
        });
    }

    private async buildWithBridge(
        bridge: CppWasmMapRenderDataBridge,
        runtimeHandle: MapRenderRuntimeHandle,
        input: SdMapLoaderInput,
        byteDrivenSceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    ): Promise<SdMapData | undefined> {
        const request = createRuntimeCacheBuildRequest(byteDrivenSceneBuildInput);
        if (!request) {
            return undefined;
        }
        const uploadedBase = await this.cacheUploader.uploadRuntimeCacheForBuildRequest(
            bridge,
            runtimeHandle,
            request,
            byteDrivenSceneBuildInput,
        );
        if (!uploadedBase) {
            return undefined;
        }
        for (let pass = 0; pass < 12; pass++) {
            const packet = await bridge.buildMapPacketFromCache(runtimeHandle, request);
            const overlay = runtimePacketToPayloadOverlay(packet);
            if (this.options?.telemetry) {
                const npcVerticesLen =
                    packet?.npcVertices instanceof Uint8Array ? packet.npcVertices.length | 0 : -1;
                const npcIndicesLen =
                    packet?.npcIndices instanceof Int32Array ? packet.npcIndices.length | 0 : -1;
                const npcDrawRangesBaseLen =
                    packet?.npcDrawRangesBase instanceof Int32Array
                        ? packet.npcDrawRangesBase.length | 0
                        : -1;
                const npcDrawRangesAlphaLen =
                    packet?.npcDrawRangesAlpha instanceof Int32Array
                        ? packet.npcDrawRangesAlpha.length | 0
                        : -1;
                const npcOrderKeysLen =
                    packet?.npcOrderKeys instanceof Int32Array ? packet.npcOrderKeys.length | 0 : -1;
                console.log("[map-render][telemetry][cpp-wasm] buildMapPacket npc payload", {
                    square: `${input.mapX}:${input.mapY}`,
                    pass: pass | 0,
                    loadNpcs: request.loadNpcs === true,
                    hasPacket: packet !== undefined,
                    npcVerticesLen,
                    npcIndicesLen,
                    npcDrawRangesBaseLen,
                    npcDrawRangesAlphaLen,
                    npcOrderKeysLen,
                });
            }
            const missing = await bridge.getLastMissingBlobEntries(runtimeHandle);
            if (missing && (missing.domains.length | 0) > 0) {
                // Even if we got *some* geometry back (e.g. terrain-only), treat any missing
                // blob entries as an incomplete build and retry after uploading them.
                const okMissing = await this.cacheUploader.uploadMissingBlobEntriesForBuildRequest(
                    bridge,
                    runtimeHandle,
                    missing,
                    byteDrivenSceneBuildInput,
                );
                if (!okMissing) {
                    return undefined;
                }
                continue;
            }

            const hasGeometry =
                overlay &&
                packet?.vertices instanceof Uint8Array &&
                packet.vertices.length > 0 &&
                packet?.indices instanceof Int32Array &&
                packet.indices.length > 0 &&
                packet?.usedTextureIds instanceof Int32Array;
            if (!hasGeometry) {
                return undefined;
            }

            const levels = packet.levels | 0;
            const sizeX = packet.sizeX | 0;
            const sizeY = packet.sizeY | 0;
            const npcDrawRangesBase =
                packet.npcDrawRangesBase instanceof Int32Array ? packet.npcDrawRangesBase : undefined;
            const npcDrawRangesAlpha =
                packet.npcDrawRangesAlpha instanceof Int32Array ? packet.npcDrawRangesAlpha : undefined;
            const npcVertices = packet.npcVertices instanceof Uint8Array ? packet.npcVertices : undefined;
            const npcIndices = packet.npcIndices instanceof Int32Array ? packet.npcIndices : undefined;
            const npcOrderKeys = packet.npcOrderKeys instanceof Int32Array ? packet.npcOrderKeys : undefined;
            const npcRangesLen = npcDrawRangesBase ? npcDrawRangesBase.length | 0 : 0;
            const npcVerticesLen = npcVertices ? npcVertices.length | 0 : 0;
            const npcIndicesLen = npcIndices ? npcIndices.length | 0 : 0;
            const hasNpcRanges = npcRangesLen > 0;
            const hasNpcGeometry = npcVerticesLen > 0 && npcIndicesLen > 0;
            const keepNpcPayload = hasNpcRanges && hasNpcGeometry;
            if (hasNpcRanges !== hasNpcGeometry) {
                console.warn(
                    `[map-render][cpp-wasm] dropping inconsistent npc payload for ${input.mapX},${input.mapY} ` +
                        `(ranges=${npcRangesLen} verts=${npcVerticesLen} indices=${npcIndicesLen})`,
                );
            }
            if (this.options?.telemetry && request.loadNpcs === true && !keepNpcPayload) {
                const [npcBuildStats, missingType, legacyModelLoad] = await Promise.all([
                    bridge.debugGetLastNpcBuildStats?.(runtimeHandle),
                    bridge.debugGetLastMissingType?.(runtimeHandle),
                    bridge.debugGetLastLegacyModelLoad?.(runtimeHandle),
                ]);
                console.warn("[map-render][telemetry][cpp-wasm] npc payload empty diagnostics", {
                    square: `${input.mapX}:${input.mapY}`,
                    pass: pass | 0,
                    npcRangesLen,
                    npcVerticesLen,
                    npcIndicesLen,
                    npcBuildStats,
                    missingType,
                    legacyModelLoad,
                });
            }

            return {
                type: RenderableType.Map,
                mapX: input.mapX | 0,
                mapY: input.mapY | 0,
                cacheName: this.cacheName,
                maxLevel: input.maxLevel | 0,
                loadObjs: input.loadObjs === true,
                loadNpcs: input.loadNpcs === true,
                loadLocs: input.loadLocs === true,
                smoothTerrain: input.smoothTerrain === true,
                borderSize: request.borderSize | 0,
                tileRenderFlags: createEmptyTileRenderFlags(levels, sizeX, sizeY),
                collisionDatas: createEmptyCollisionDatas(levels, sizeX, sizeY),
                minimapBlob: new Blob(),
                vertices: packet.vertices,
                indices: packet.indices,
                modelInfoTextures: overlay.modelInfoTextures,
                heightMapTextureData: overlay.heightMapTextureData,
                drawRanges: overlay.drawRanges,
                locsAnimated: [],
                npcs: [],
                usedTextureIds: packet.usedTextureIds,
                loadedTextures: new Map(),
                npcDrawRangesBase: keepNpcPayload ? npcDrawRangesBase : undefined,
                npcDrawRangesAlpha: keepNpcPayload ? npcDrawRangesAlpha : undefined,
                npcVertices: keepNpcPayload ? npcVertices : undefined,
                npcIndices: keepNpcPayload ? npcIndices : undefined,
                npcOrderKeys: keepNpcPayload ? npcOrderKeys : undefined,
            };
        }
        return undefined;
    }

    private trackOutcome(
        outcome: CppWasmBuildOutcome,
        input: SdMapLoaderInput,
        totalMs?: number,
        details?: string,
    ): void {
        this.outcomeStats[outcome]++;
        this.buildCalls++;
        if (!this.options?.telemetry) {
            return;
        }
        const suffix = details ? ` details=${details}` : "";
        const timing = totalMs !== undefined ? ` totalMs=${totalMs.toFixed(1)}` : "";
        console.log(
            `[map-render] square=${input.mapX},${input.mapY} backend=cpp-wasm outcome=${outcome}${timing}${suffix}`,
        );
        if (this.buildCalls % 25 === 0) {
            const summary = CPP_WASM_OUTCOME_KEYS.map((k) => `${k}=${this.outcomeStats[k]}`).join(
                " ",
            );
            console.log(`[map-render] backend=cpp-wasm outcomes ${summary}`);
        }
    }

    private async buildMapDataActive(
        input: SdMapLoaderInput,
        t0: number | undefined,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        const bridge = this.bridge;
        if (!(await this.ensureRuntimeInitialized(bridge))) {
            this.trackOutcome(
                "bridgeMissing",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                "runtimeInitFailed",
            );
            return { data: undefined, transferables: [] };
        }
        const runtimeHandle = await this.ensureRuntimeHandle(bridge);
        if (runtimeHandle === undefined) {
            this.trackOutcome(
                "bridgeMissing",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                "runtimeHandleMissing",
            );
            return { data: undefined, transferables: [] };
        }
        const byteDrivenSceneBuildInput = this.createByteDrivenSceneBuildInput(input);
        try {
            const bridgePayload = await this.buildWithBridge(
                bridge,
                runtimeHandle,
                input,
                byteDrivenSceneBuildInput,
            );
            if (!bridgePayload) {
                this.trackOutcome(
                    "bridgeReturnedEmpty",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                    "runtimePacketMissingOrIncompleteGeometry_or_build_failed=true",
                );
                return { data: undefined, transferables: [] };
            }
            this.trackOutcome(
                "success",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return {
                data: bridgePayload,
                transferables: sdMapDataTransferables(bridgePayload),
            };
        } catch (e) {
            console.warn(`[map-render-backend] cpp-wasm buildMapData failed: ${errorToString(e)}`);
            this.trackOutcome(
                "bridgeError",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                errorToString(e),
            );
            return { data: undefined, transferables: [] };
        }
    }

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const t0 = this.options?.telemetry ? performance.now() : undefined;
        return this.buildMapDataActive(input, t0);
    }

    getCppWasmRuntimeHandle(): MapRenderRuntimeHandle | undefined {
        return this.runtimeHandle;
    }

    reset(): void {
        this.cacheUploader.reset();
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

export function createMapRenderDataBackend(
    kind: MapRenderDataBackendKind,
    deps: MapRenderDataBackendDeps,
    options?: MapRenderDataBackendOptions,
): MapRenderDataBackend {
    if (kind === "cpp-wasm") {
        return new CppWasmMapRenderDataBackend(deps, options);
    }
    return new TsMapRenderDataBackend({
        ...deps,
        telemetry: options?.telemetry,
    });
}
