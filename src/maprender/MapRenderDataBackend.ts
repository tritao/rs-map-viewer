import type { SdMapData } from "./payload/SdMapData";
import { SdMapLoaderInput } from "./payload/SdMapLoaderInput";
import { MAP_RENDER_DRAW_BUCKET_KEYS, type MapRenderDrawBucketKey } from "./payload/SdRenderableData";
import type { MapRenderBuildDeps } from "./MapRenderBuildDeps";
import type { BackendKind } from "../util/BackendKind";
import { errorToString } from "../util/ErrorUtil";
import type {
    MapRenderRuntimeBridgeV2,
    MapRenderRuntimeBuildRequest,
    MapRenderRuntimeHandle,
    MapRenderRuntimePacket,
} from "../wasm/MapRenderRuntimeBridgeAbi";
// Import the runtime surface directly. The wasm module is still loaded lazily via initRuntime().
import { mapRenderRuntimeBridge } from "../wasm/rs_map_render_backend_bridge.mjs";
import {
    MapRenderByteDrivenSceneBuildInput,
    WasmCacheUploader,
    createByteDrivenSceneBuildInput,
} from "./wasm/WasmCacheUploader";
import { runtimePacketToPayloadOverlay } from "./wasm/WasmPacketOverlay";
import { MapRenderTsBackend } from "./ts/MapRenderTsBackend";

export type RenderDataResult<T> = Readonly<{
    data: T;
    transferables: Transferable[];
}>;

export type MapRenderDataBackendKind = BackendKind;

export type MapRenderDataBackendOptions = Readonly<{
    telemetry?: boolean;
}>;

export interface MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind;
    buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>>;
    reset(): void;
    // Exposes the underlying C++ wasm runtime handle when this backend is "cpp-wasm".
    // This allows the worker tick path to use the same runtime instance that built the map packets.
    getCppWasmRuntimeHandle?(): MapRenderRuntimeHandle | undefined;
}

function sdMapDataTransferables(data: SdMapData): Transferable[] {
    const loadedTextureBuffers = Array.from(data.loadedTextures.values()).map(
        (pixels) => pixels.buffer as Transferable,
    );
    const transferables: Transferable[] = [
        ...data.tileRenderFlags.flat().map((buf) => buf.buffer as Transferable),
        ...loadedTextureBuffers,
        data.vertices.buffer as Transferable,
        data.indices.buffer as Transferable,
        data.heightMapTextureData.buffer as Transferable,
        data.usedTextureIds.buffer as Transferable,
    ];
    for (const key of MAP_RENDER_DRAW_BUCKET_KEYS) {
        transferables.push(
            data.modelInfoTextures[key].buffer as Transferable,
            data.drawRanges[key].buffer as Transferable,
        );
    }
    if (
        data.npcVertices instanceof Uint8Array &&
        data.npcIndices instanceof Int32Array &&
        data.npcDrawRangesBase instanceof Int32Array
    ) {
        transferables.push(
            data.npcVertices.buffer as Transferable,
            data.npcIndices.buffer as Transferable,
            data.npcDrawRangesBase.buffer as Transferable,
        );
        if (data.npcDrawRangesAlpha) {
            transferables.push(data.npcDrawRangesAlpha.buffer as Transferable);
        }
        if (data.npcOrderKeys) {
            transferables.push(data.npcOrderKeys.buffer as Transferable);
        }
    }
    return transferables;
}

class TsMapRenderDataBackend implements MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind = "ts";
    private readonly backend: MapRenderTsBackend;

    constructor(deps: MapRenderBuildDeps) {
        this.backend = new MapRenderTsBackend(deps);
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
    private static readonly MAP_SQUARE_SIZE = 64;

    readonly kind: MapRenderDataBackendKind = "cpp-wasm";
    private readonly bridge: CppWasmMapRenderDataBridge = mapRenderRuntimeBridge;
    private runtimeInitPromise: Promise<boolean> | undefined;
    private runtimeHandlePromise: Promise<MapRenderRuntimeHandle | undefined> | undefined;
    private runtimeHandle: MapRenderRuntimeHandle | undefined;
    private readonly cacheUploader = new WasmCacheUploader();

    constructor(
        private readonly deps: MapRenderBuildDeps,
        private readonly options: MapRenderDataBackendOptions | undefined,
    ) {}

    private static createRuntimeCacheBuildRequest(
        sceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    ): MapRenderRuntimeBuildRequest | undefined {
        const sizeX = sceneBuildInput.sizeX | 0;
        const sizeY = sceneBuildInput.sizeY | 0;
        if (sizeX <= 0 || sizeY <= 0) {
            return undefined;
        }
        const borderX = ((sizeX - CppWasmMapRenderDataBackend.MAP_SQUARE_SIZE) / 2) | 0;
        const borderY = ((sizeY - CppWasmMapRenderDataBackend.MAP_SQUARE_SIZE) / 2) | 0;
        if (
            borderX < 0 ||
            borderY < 0 ||
            borderX !== borderY ||
            sizeX !== CppWasmMapRenderDataBackend.MAP_SQUARE_SIZE + borderX * 2 ||
            sizeY !== CppWasmMapRenderDataBackend.MAP_SQUARE_SIZE + borderY * 2
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
        const { session, mapBytesProvider, objSpawns } = this.deps;
        const loaders = session.loaders;
        const varManager = session.varManager;
        const seqTypeLoader = loaders.seqTypeLoader;
        const seqFrameLoader = loaders.seqFrameLoader;
        const skeletalSeqLoader = loaders.skeletalSeqLoader;
        const values = varManager.values;
        const varbitLoader = varManager.varbitLoader;
        return createByteDrivenSceneBuildInput(input, {
            mapBytesProvider,
            locTypeLoader: loaders.locTypeLoader,
            objTypeLoader: loaders.objTypeLoader,
            locModelLoader: {
                modelLoader: loaders.modelLoader,
                textureLoader: loaders.textureLoader,
                seqTypeLoader,
                seqFrameLoader,
                skeletalSeqLoader,
            },
            seqTypeLoader,
            seqFrameLoader,
            skeletalSeqLoader,
            textureLoader: session.getTextureLoader(),
            npcTypeLoader: loaders.npcTypeLoader,
            basTypeLoader: loaders.basTypeLoader,
            underlayTypeLoader: loaders.underlayTypeLoader,
            overlayTypeLoader: loaders.overlayTypeLoader,
            varProvider: {
                varManager,
                values,
                varbitLoader,
            },
            objSpawns,
            cacheGame: session.cache.info.game,
            cacheRevision: session.cache.info.revision,
        });
    }

    private static selectNpcPayload(
        packet: MapRenderRuntimePacket,
        input: SdMapLoaderInput,
    ): Readonly<{
        npcDrawRangesBase?: Int32Array;
        npcDrawRangesAlpha?: Int32Array;
        npcVertices?: Uint8Array;
        npcIndices?: Int32Array;
        npcOrderKeys?: Int32Array;
    }> {
        const npcDrawRangesBase =
            packet.npcDrawRangesBase instanceof Int32Array ? packet.npcDrawRangesBase : undefined;
        const npcDrawRangesAlpha =
            packet.npcDrawRangesAlpha instanceof Int32Array ? packet.npcDrawRangesAlpha : undefined;
        const npcVertices = packet.npcVertices instanceof Uint8Array ? packet.npcVertices : undefined;
        const npcIndices = packet.npcIndices instanceof Int32Array ? packet.npcIndices : undefined;
        const npcOrderKeys = packet.npcOrderKeys instanceof Int32Array ? packet.npcOrderKeys : undefined;

        const npcRangesLen = npcDrawRangesBase ? npcDrawRangesBase.length | 0 : 0;
        const npcSlotCount = npcRangesLen > 0 ? ((npcRangesLen / 3) | 0) : 0;
        const npcVerticesLen = npcVertices ? npcVertices.length | 0 : 0;
        const npcIndicesLen = npcIndices ? npcIndices.length | 0 : 0;
        const npcOrderKeysLen = npcOrderKeys ? npcOrderKeys.length | 0 : 0;

        const hasNpcRangeStride = (npcRangesLen % 3) === 0;
        const hasNpcRanges = npcRangesLen > 0;
        const hasNpcGeometry = npcVerticesLen > 0 && npcIndicesLen > 0;
        const hasNpcOrderKeysAligned =
            hasNpcRanges && hasNpcRangeStride && npcOrderKeysLen === npcSlotCount;
        const keepNpcPayload = hasNpcRanges && hasNpcGeometry && hasNpcOrderKeysAligned;

        const hasAnyNpcPayloadField =
            hasNpcRanges ||
            hasNpcGeometry ||
            npcOrderKeysLen > 0 ||
            npcVerticesLen > 0 ||
            npcIndicesLen > 0;
        if (hasAnyNpcPayloadField && (hasNpcRanges !== hasNpcGeometry || !hasNpcOrderKeysAligned)) {
            console.warn(
                `[map-render][cpp-wasm] dropping inconsistent npc payload for ${input.mapX},${input.mapY} ` +
                    `(ranges=${npcRangesLen} verts=${npcVerticesLen} indices=${npcIndicesLen} ` +
                    `slots=${npcSlotCount} orderKeys=${npcOrderKeysLen})`,
            );
        }

        return keepNpcPayload
            ? {
                  npcDrawRangesBase,
                  npcDrawRangesAlpha,
                  npcVertices,
                  npcIndices,
                  npcOrderKeys,
              }
            : {};
    }

    private async buildWithBridge(
        bridge: CppWasmMapRenderDataBridge,
        runtimeHandle: MapRenderRuntimeHandle,
        input: SdMapLoaderInput,
        byteDrivenSceneBuildInput: MapRenderByteDrivenSceneBuildInput,
    ): Promise<SdMapData | undefined> {
        const request =
            CppWasmMapRenderDataBackend.createRuntimeCacheBuildRequest(byteDrivenSceneBuildInput);
        if (!request) {
            return undefined;
        }
        const buildResult = await this.cacheUploader.prepareAndBuildMapPacketFromCacheDetailed(
            bridge,
            runtimeHandle,
            request,
            byteDrivenSceneBuildInput,
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
        const npcPayload = CppWasmMapRenderDataBackend.selectNpcPayload(packet, input);

        return {
            mapX: input.mapX | 0,
            mapY: input.mapY | 0,
            cacheName: this.deps.session.cache.info.name,
            maxLevel: input.maxLevel | 0,
            loadObjs: input.loadObjs === true,
            loadNpcs: input.loadNpcs === true,
            loadLocs: input.loadLocs === true,
            smoothTerrain: input.smoothTerrain === true,
            borderSize: request.borderSize | 0,
            tileRenderFlags: CppWasmMapRenderDataBackend.createEmptyTileRenderFlags(
                levels,
                sizeX,
                sizeY,
            ),
            minimapBlob: new Blob(),
            vertices: packet.vertices,
            indices: packet.indices,
            modelInfoTextures: overlay.modelInfoTextures,
            heightMapTextureData: overlay.heightMapTextureData,
            drawRanges: overlay.drawRanges,
            locsAnimated: [],
            usedTextureIds: packet.usedTextureIds,
            loadedTextures: new Map(),
            ...npcPayload,
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
            const bridgePayload = await this.buildWithBridge(
                bridge,
                runtimeHandle,
                input,
                byteDrivenSceneBuildInput,
            );
            if (!bridgePayload) {
                return { data: undefined, transferables: [] };
            }
            return {
                data: bridgePayload,
                transferables: sdMapDataTransferables(bridgePayload),
            };
        } catch (e) {
            console.warn(`[map-render-backend] cpp-wasm buildMapData failed: ${errorToString(e)}`);
            return { data: undefined, transferables: [] };
        }
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
    deps: MapRenderBuildDeps,
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
