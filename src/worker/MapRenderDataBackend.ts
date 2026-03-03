import type { SdMapData } from "../maprender/payload/SdMapData";
import { SdMapLoaderInput } from "../maprender/payload/SdMapLoaderInput";
import {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type MapRenderDrawBucketKey,
} from "../maprender/payload/SdRenderableData";
import { SdMapRenderDataTsBackend } from "../maprender/backend/SdMapRenderDataTsBackend";
import type { MapRenderBuildDeps } from "../maprender/MapRenderBuildDeps";
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
    MapRenderRuntimeCacheV2Uploader,
    createByteDrivenSceneBuildInput,
} from "./runtime-cache/MapRenderRuntimeCacheV2Uploader";

export type RenderDataResult<T> = Readonly<{
    data: T;
    transferables: Transferable[];
}>;

export type MapRenderDataBackendKind = BackendKind;

export type MapRenderDataBackendOptions = Readonly<{
    telemetry?: boolean;
}>;

export type MapRenderDataBackendDeps = MapRenderBuildDeps;

export interface MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind;
    buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>>;
    reset(): void;
    // Exposes the underlying C++ wasm runtime handle when this backend is "cpp-wasm".
    // This allows the worker tick path to use the same runtime instance that built the map packets.
    getCppWasmRuntimeHandle?(): MapRenderRuntimeHandle | undefined;
}

type MapRenderPayloadOverlay = Readonly<
    Pick<SdMapData, "heightMapTextureData" | "drawRanges" | "modelInfoTextures">
>;

type RuntimePacketOverlayFailure = Readonly<{
    reason: string;
    detail?: Readonly<Record<string, unknown>>;
}>;

type ValidatedOverlayInput = Readonly<{
    bucketCmdCounts: Int32Array;
    bucketModelInfoLengths: Int32Array;
    drawRangesPacked: Int32Array;
    modelInfoTextureBuckets: ReadonlyArray<Uint16Array>;
    heightMapTextureData: Int16Array;
}>;

type OverlayValidationResult =
    | Readonly<{ ok: true; value: ValidatedOverlayInput }>
    | Readonly<{ ok: false; failure: RuntimePacketOverlayFailure }>;

const MAP_RENDER_DRAW_BUCKET_COUNT = MAP_RENDER_DRAW_BUCKET_KEYS.length;
const EMPTY_I32_ARRAY = new Int32Array(0);
const EMPTY_U16_ARRAY = new Uint16Array(0);

function valueTypeTag(value: unknown): string {
    return Object.prototype.toString.call(value);
}

function validateRuntimePacketForOverlay(packet: MapRenderRuntimePacket): OverlayValidationResult {
    const fail = (
        reason: string,
        detail?: Readonly<Record<string, unknown>>,
    ): OverlayValidationResult => ({
        ok: false,
        failure: { reason, detail },
    });
    const packetVersion = packet.packetVersion | 0;
    if (packetVersion !== 1 && packetVersion !== 2 && packetVersion !== 3) {
        return fail("unsupported_packet_version", { packetVersion });
    }
    const bucketCmdCounts = packet.bucketCmdCounts;
    const bucketModelInfoLengths = packet.bucketModelInfoLengths;
    const drawRangesPacked = packet.drawRangesPacked;
    const modelInfoTextureBuckets = packet.modelInfoTextureBuckets;
    const heightMapTextureData = packet.heightMapTextureData;

    if (
        bucketCmdCounts.length !== MAP_RENDER_DRAW_BUCKET_COUNT ||
        bucketModelInfoLengths.length !== MAP_RENDER_DRAW_BUCKET_COUNT
    ) {
        return fail("bucket_lengths_invalid", {
            bucketCmdCountsLength: bucketCmdCounts.length | 0,
            bucketModelInfoLengthsLength: bucketModelInfoLengths.length | 0,
            expected: MAP_RENDER_DRAW_BUCKET_COUNT | 0,
        });
    }

    let totalCmdCount = 0;
    let totalModelInfoLength = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const cmdCount = bucketCmdCounts[i] | 0;
        const modelInfoLength = bucketModelInfoLengths[i] | 0;
        if (cmdCount < 0 || modelInfoLength < 0) {
            return fail("negative_bucket_values", {
                bucketIndex: i,
                bucketKey: MAP_RENDER_DRAW_BUCKET_KEYS[i],
                cmdCount,
                modelInfoLength,
            });
        }
        totalCmdCount += cmdCount;
        totalModelInfoLength += modelInfoLength;
    }
    if ((packet.totalModelInfoLength | 0) !== totalModelInfoLength) {
        return fail("total_model_info_length_mismatch", {
            packetTotalModelInfoLength: packet.totalModelInfoLength | 0,
            computedTotalModelInfoLength: totalModelInfoLength | 0,
        });
    }
    if (
        !(drawRangesPacked instanceof Int32Array) ||
        drawRangesPacked.length !== totalCmdCount * 3
    ) {
        return fail("draw_ranges_packed_invalid", {
            drawRangesPackedType: valueTypeTag(drawRangesPacked),
            drawRangesPackedLength:
                drawRangesPacked instanceof Int32Array ? drawRangesPacked.length | 0 : -1,
            expectedLength: (totalCmdCount * 3) | 0,
        });
    }
    if (
        !Array.isArray(modelInfoTextureBuckets) ||
        modelInfoTextureBuckets.length !== MAP_RENDER_DRAW_BUCKET_COUNT
    ) {
        return fail("model_info_buckets_shape_invalid", {
            modelInfoTextureBucketsType: valueTypeTag(modelInfoTextureBuckets),
            modelInfoTextureBucketsLength: Array.isArray(modelInfoTextureBuckets)
                ? modelInfoTextureBuckets.length | 0
                : -1,
            expected: MAP_RENDER_DRAW_BUCKET_COUNT | 0,
        });
    }

    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const modelInfoLength = bucketModelInfoLengths[i] | 0;
        const packetBucketModelInfo = modelInfoTextureBuckets[i];
        if (
            !(packetBucketModelInfo instanceof Uint16Array) ||
            packetBucketModelInfo.length !== modelInfoLength
        ) {
            return fail("model_info_bucket_invalid", {
                bucketIndex: i,
                bucketKey: key,
                modelInfoLengthExpected: modelInfoLength,
                modelInfoTypeActual: valueTypeTag(packetBucketModelInfo),
                modelInfoLengthActual:
                    packetBucketModelInfo instanceof Uint16Array
                        ? packetBucketModelInfo.length | 0
                        : -1,
            });
        }
    }
    return {
        ok: true,
        value: {
            bucketCmdCounts,
            bucketModelInfoLengths,
            drawRangesPacked,
            modelInfoTextureBuckets,
            heightMapTextureData,
        },
    };
}

function buildOverlayFromValidatedRuntimePacket(input: ValidatedOverlayInput): MapRenderPayloadOverlay {
    const drawRanges = {} as Record<MapRenderDrawBucketKey, Int32Array>;
    const modelInfoTextures = {} as Record<MapRenderDrawBucketKey, Uint16Array>;

    let drawRangeCursor = 0;
    for (let i = 0; i < MAP_RENDER_DRAW_BUCKET_COUNT; i++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[i];
        const cmdCount = input.bucketCmdCounts[i] | 0;
        const bucketRangeLen = cmdCount * 3;
        drawRanges[key] =
            bucketRangeLen > 0
                ? input.drawRangesPacked.slice(drawRangeCursor, drawRangeCursor + bucketRangeLen)
                : EMPTY_I32_ARRAY;
        drawRangeCursor += bucketRangeLen;

        const modelInfoLength = input.bucketModelInfoLengths[i] | 0;
        const packetBucketModelInfo = input.modelInfoTextureBuckets[i];
        modelInfoTextures[key] = modelInfoLength > 0 ? packetBucketModelInfo : EMPTY_U16_ARRAY;
    }

    return {
        heightMapTextureData: input.heightMapTextureData,
        drawRanges: drawRanges as SdMapData["drawRanges"],
        modelInfoTextures: modelInfoTextures as SdMapData["modelInfoTextures"],
    };
}

function runtimePacketToPayloadOverlay(
    packet: MapRenderRuntimePacket | undefined,
): MapRenderPayloadOverlay | undefined {
    if (!packet) {
        return undefined;
    }
    const validated = validateRuntimePacketForOverlay(packet);
    return validated.ok ? buildOverlayFromValidatedRuntimePacket(validated.value) : undefined;
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

const CPP_WASM_OUTCOME_KEYS = [
    "success",
    "bridgeMissing",
    "bridgeReturnedEmpty",
    "bridgeError",
] as const;

type CppWasmBuildOutcome = (typeof CPP_WASM_OUTCOME_KEYS)[number];
type CppWasmBuildOutcomeStats = Record<CppWasmBuildOutcome, number>;

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
    private static readonly MAP_SQUARE_SIZE = 64;

    readonly kind: MapRenderDataBackendKind = "cpp-wasm";
    private readonly bridge: CppWasmMapRenderDataBridge = mapRenderRuntimeBridge;
    private runtimeInitPromise: Promise<boolean> | undefined;
    private runtimeHandlePromise: Promise<MapRenderRuntimeHandle | undefined> | undefined;
    private runtimeHandle: MapRenderRuntimeHandle | undefined;
    private readonly outcomeStats: CppWasmBuildOutcomeStats = {
        success: 0,
        bridgeMissing: 0,
        bridgeReturnedEmpty: 0,
        bridgeError: 0,
    };
    private readonly cacheUploader = new MapRenderRuntimeCacheV2Uploader();
    private buildCalls = 0;

    constructor(
        private readonly deps: MapRenderDataBackendDeps,
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
        const prepareResult = await this.cacheUploader.prepareRuntimeForBuildRequestDetailed(
            bridge,
            runtimeHandle,
            request,
            byteDrivenSceneBuildInput,
        );
        if (!prepareResult.ok) {
            console.warn("[map-render][cpp-wasm] prepareRuntimeForBuildRequest failed", {
                square: `${input.mapX}:${input.mapY}`,
                reason: prepareResult.reason,
                status: prepareResult.status,
                passesTried: prepareResult.passesTried,
                missingCount: prepareResult.missingCount,
                lastBuildFailure: prepareResult.lastBuildFailure,
            });
            return undefined;
        }
        const packet = await bridge.buildMapPacketFromCache(runtimeHandle, request);
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
                pass: 0,
                loadNpcs: request.loadNpcs === true,
                hasPacket: packet !== undefined,
                npcVerticesLen,
                npcIndicesLen,
                npcDrawRangesBaseLen,
                npcDrawRangesAlphaLen,
                npcOrderKeysLen,
            });
        }
        if (!packet) {
            return undefined;
        }
        const overlay = runtimePacketToPayloadOverlay(packet);
        if (!overlay) {
            return undefined;
        }
        const missing = await bridge.getLastMissingBlobEntries(runtimeHandle);
        if (missing && (missing.domains.length | 0) > 0) {
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
        const npcDrawRangesBase =
            packet.npcDrawRangesBase instanceof Int32Array ? packet.npcDrawRangesBase : undefined;
        const npcDrawRangesAlpha =
            packet.npcDrawRangesAlpha instanceof Int32Array ? packet.npcDrawRangesAlpha : undefined;
        const npcVertices = packet.npcVertices instanceof Uint8Array ? packet.npcVertices : undefined;
        const npcIndices = packet.npcIndices instanceof Int32Array ? packet.npcIndices : undefined;
        const npcOrderKeys =
            packet.npcOrderKeys instanceof Int32Array ? packet.npcOrderKeys : undefined;
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
            hasNpcRanges || hasNpcGeometry || npcOrderKeysLen > 0 || npcVerticesLen > 0 || npcIndicesLen > 0;
        if (hasAnyNpcPayloadField && (hasNpcRanges !== hasNpcGeometry || !hasNpcOrderKeysAligned)) {
            console.warn(
                `[map-render][cpp-wasm] dropping inconsistent npc payload for ${input.mapX},${input.mapY} ` +
                    `(ranges=${npcRangesLen} verts=${npcVerticesLen} indices=${npcIndicesLen} ` +
                    `slots=${npcSlotCount} orderKeys=${npcOrderKeysLen})`,
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
                pass: 0,
                npcRangesLen,
                npcVerticesLen,
                npcIndicesLen,
                npcSlotCount,
                npcOrderKeysLen,
                npcBuildStats,
                missingType,
                legacyModelLoad,
            });
        }

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
            npcDrawRangesBase: keepNpcPayload ? npcDrawRangesBase : undefined,
            npcDrawRangesAlpha: keepNpcPayload ? npcDrawRangesAlpha : undefined,
            npcVertices: keepNpcPayload ? npcVertices : undefined,
            npcIndices: keepNpcPayload ? npcIndices : undefined,
            npcOrderKeys: keepNpcPayload ? npcOrderKeys : undefined,
        };
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

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const t0 = this.options?.telemetry ? performance.now() : undefined;
        const bridge = this.bridge;
        if (!(await this.ensureRuntimeInitialized())) {
            this.trackOutcome(
                "bridgeMissing",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                "runtimeInitFailed",
            );
            return { data: undefined, transferables: [] };
        }
        const runtimeHandle = await this.ensureRuntimeHandle();
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
