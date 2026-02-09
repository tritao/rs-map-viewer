import { SdMapRenderDataTsBackend } from "../renderer/loader/SdMapRenderDataTsBackend";
import type {
    BuildMapDataPayloadOptions,
    SdMapRenderDataTsBackendDeps,
} from "../renderer/loader/SdMapRenderDataTsBackend";
import { SdMapData } from "../renderer/loader/SdMapData";
import { SdMapLoaderInput } from "../renderer/loader/SdMapLoaderInput";
import type { NpcSpawn } from "../data/npc/NpcSpawn";
import { errorToString } from "../util/ErrorUtil";
import {
    MapRenderDataPayload,
    MapRenderDataPayloadResult,
    payloadResultToRenderDataResult,
    validateMapRenderPayload,
} from "./MapRenderDataContract";
import type { RenderDataResult } from "./RenderDataLoader";

export type MapRenderDataBackendKind = "ts" | "cpp-wasm";

export type MapRenderDataBackendOptions = Readonly<{
    cppWasmModuleUrl?: string;
    telemetry?: boolean;
    cppWasmRolloutMode?: "active" | "shadow";
    cppWasmShadowSampleRate?: number;
}>;

export type MapRenderDataBackendDeps = SdMapRenderDataTsBackendDeps;

export interface MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind;
    buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>>;
    reset(): void;
}

const CPP_WASM_OUTCOME_KEYS = [
    "success",
    "bridgeMissing",
    "tsPayloadEmpty",
    "bridgeReturnedEmpty",
    "bridgeKeptStaging",
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
        bridgeKeptStaging: 0,
        validationFailed: 0,
        bridgeError: 0,
    };
}

const CPP_WASM_SHADOW_OUTCOME_KEYS = [
    "skipped",
    "success",
    "bridgeMissing",
    "stagedPayloadEmpty",
    "bridgeReturnedEmpty",
    "bridgeKeptStaging",
    "validationFailed",
    "digestMismatch",
    "bridgeError",
] as const;

type CppWasmShadowOutcome = (typeof CPP_WASM_SHADOW_OUTCOME_KEYS)[number];
type CppWasmShadowOutcomeStats = Record<CppWasmShadowOutcome, number>;

function createCppWasmShadowOutcomeStats(): CppWasmShadowOutcomeStats {
    return {
        skipped: 0,
        success: 0,
        bridgeMissing: 0,
        stagedPayloadEmpty: 0,
        bridgeReturnedEmpty: 0,
        bridgeKeptStaging: 0,
        validationFailed: 0,
        digestMismatch: 0,
        bridgeError: 0,
    };
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

function hashI32Array(data: ArrayLike<number>, seed: number): number {
    let h = seed >>> 0;
    for (let i = 0; i < data.length; i++) {
        h = fnv1a32UpdateInt(h, data[i] | 0);
    }
    return h >>> 0;
}

function hashDrawRanges(
    ranges: ReadonlyArray<readonly [number, number, number]>,
    seed: number,
): number {
    let h = seed >>> 0;
    for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        h = fnv1a32UpdateInt(h, r[0] | 0);
        h = fnv1a32UpdateInt(h, r[1] | 0);
        h = fnv1a32UpdateInt(h, r[2] | 0);
    }
    return h >>> 0;
}

type MapRenderPayloadDigest = Readonly<{
    verticesLength: number;
    indicesLength: number;
    heightMapLength: number;
    verticesHash: number;
    indicesHash: number;
    heightMapHash: number;
    drawRangesHash: number;
    modelInfoHash: number;
}>;

function digestMapRenderPayload(data: MapRenderDataPayload): MapRenderPayloadDigest {
    let drawRangesHash = 2166136261 >>> 0;
    drawRangesHash = hashDrawRanges(data.drawRanges.base, drawRangesHash);
    drawRangesHash = hashDrawRanges(data.drawRanges.alpha, drawRangesHash);
    drawRangesHash = hashDrawRanges(data.drawRanges.lod, drawRangesHash);
    drawRangesHash = hashDrawRanges(data.drawRanges.lodAlpha, drawRangesHash);
    drawRangesHash = hashDrawRanges(data.drawRanges.interact, drawRangesHash);
    drawRangesHash = hashDrawRanges(data.drawRanges.interactAlpha, drawRangesHash);
    drawRangesHash = hashDrawRanges(data.drawRanges.interactLod, drawRangesHash);
    drawRangesHash = hashDrawRanges(data.drawRanges.interactLodAlpha, drawRangesHash);

    let modelInfoHash = 2166136261 >>> 0;
    modelInfoHash = hashI32Array(data.modelInfoTextures.base, modelInfoHash);
    modelInfoHash = hashI32Array(data.modelInfoTextures.alpha, modelInfoHash);
    modelInfoHash = hashI32Array(data.modelInfoTextures.lod, modelInfoHash);
    modelInfoHash = hashI32Array(data.modelInfoTextures.lodAlpha, modelInfoHash);
    modelInfoHash = hashI32Array(data.modelInfoTextures.interact, modelInfoHash);
    modelInfoHash = hashI32Array(data.modelInfoTextures.interactAlpha, modelInfoHash);
    modelInfoHash = hashI32Array(data.modelInfoTextures.interactLod, modelInfoHash);
    modelInfoHash = hashI32Array(data.modelInfoTextures.interactLodAlpha, modelInfoHash);

    return {
        verticesLength: data.vertices.length | 0,
        indicesLength: data.indices.length | 0,
        heightMapLength: data.heightMapTextureData.length | 0,
        verticesHash: hashI32Array(data.vertices, 2166136261 >>> 0),
        indicesHash: hashI32Array(data.indices, 2166136261 >>> 0),
        heightMapHash: hashI32Array(data.heightMapTextureData, 2166136261 >>> 0),
        drawRangesHash,
        modelInfoHash,
    };
}

function digestMismatchKeys(
    expected: MapRenderPayloadDigest,
    actual: MapRenderPayloadDigest,
): string[] {
    const keys: (keyof MapRenderPayloadDigest)[] = [
        "verticesLength",
        "indicesLength",
        "heightMapLength",
        "verticesHash",
        "indicesHash",
        "heightMapHash",
        "drawRangesHash",
        "modelInfoHash",
    ];
    return keys.filter((key) => expected[key] !== actual[key]);
}

function stripStagingFromPayloadResult(
    result: MapRenderDataPayloadResult,
): MapRenderDataPayloadResult {
    if (!result.data || result.data.staging === undefined) {
        return result;
    }
    return {
        data: {
            ...result.data,
            staging: undefined,
        },
    };
}

class TsMapRenderDataBackend implements MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind = "ts";
    private readonly backend: SdMapRenderDataTsBackend;

    constructor(deps: MapRenderDataBackendDeps) {
        this.backend = new SdMapRenderDataTsBackend(deps);
    }

    buildMapDataPayload(
        input: SdMapLoaderInput,
        options?: BuildMapDataPayloadOptions,
    ): Promise<MapRenderDataPayloadResult> {
        return this.backend.buildMapDataPayload(input, options);
    }

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const payloadResult = await this.buildMapDataPayload(input);
        return payloadResultToRenderDataResult(payloadResult);
    }

    reset(): void {
        this.backend.reset();
    }
}

export interface CppWasmMapRenderDataBridge {
    buildMapData(
        input: SdMapLoaderInput,
        tsPayloadResult: MapRenderDataPayloadResult,
    ): Promise<MapRenderDataPayloadResult | undefined>;
    decodeNpcSpawnsFromBytes?(
        tileRenderFlagsLevel1: Uint8Array[],
        borderSize: number,
        mapX: number,
        mapY: number,
        data: Uint8Array,
        npcLoginScreenPropsById?: Uint8Array,
        requiredLoginScreenPropsMask?: number,
    ): Promise<NpcSpawn[] | undefined>;
    reset?(): void;
}

function resolveCppWasmBridgeExport(
    mod: Record<string, unknown>,
): CppWasmMapRenderDataBridge | undefined {
    const candidates: unknown[] = [mod.default, mod.cppWasmMapRenderDataBridge, mod.mapRenderDataBridge];
    for (const c of candidates) {
        if (c && typeof c === "object" && "buildMapData" in c) {
            const bridge = c as CppWasmMapRenderDataBridge;
            if (typeof bridge.buildMapData === "function") {
                return bridge;
            }
        }
    }
    return undefined;
}

async function tryLoadCppWasmBridge(
    moduleUrl?: string,
): Promise<CppWasmMapRenderDataBridge | undefined> {
    const url = moduleUrl ?? "/wasm/rs_map_render_backend_bridge.mjs";
    try {
        const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
        const bridge = resolveCppWasmBridgeExport(mod);
        if (!bridge) {
            console.warn(`[map-render-backend] cpp-wasm module missing bridge export: ${url}`);
        }
        return bridge;
    } catch (e) {
        console.warn(
            `[map-render-backend] failed to load cpp-wasm module ${url}: ${errorToString(e)}`,
        );
        return undefined;
    }
}

class CppWasmMapRenderDataBackend implements MapRenderDataBackend {
    readonly kind: MapRenderDataBackendKind = "cpp-wasm";
    private bridgePromise: Promise<CppWasmMapRenderDataBridge | undefined> | undefined;
    private readonly fallback: TsMapRenderDataBackend;
    private readonly outcomeStats: CppWasmBuildOutcomeStats = createCppWasmBuildOutcomeStats();
    private readonly shadowOutcomeStats: CppWasmShadowOutcomeStats = createCppWasmShadowOutcomeStats();
    private readonly rolloutMode: "active" | "shadow";
    private readonly shadowSampleRate: number;
    private buildCalls = 0;
    private shadowCalls = 0;

    constructor(
        deps: MapRenderDataBackendDeps,
        private readonly options: MapRenderDataBackendOptions | undefined,
    ) {
        this.rolloutMode = options?.cppWasmRolloutMode ?? "active";
        const requestedShadowSampleRate = options?.cppWasmShadowSampleRate;
        this.shadowSampleRate = Number.isFinite(requestedShadowSampleRate)
            ? Math.max(0, Math.min(1, requestedShadowSampleRate!))
            : this.rolloutMode === "shadow"
              ? 1
              : 0;
        this.fallback = new TsMapRenderDataBackend({
            ...deps,
            telemetry: options?.telemetry,
            npcSpawnDecodeBackend: {
                name: "cpp-wasm",
                filtersLoginScreenProps: true,
                decodeNpcSpawnsFromBytes: async (
                    tileRenderFlagsLevel1: Uint8Array[],
                    borderSize: number,
                    mapX: number,
                    mapY: number,
                    data: Uint8Array,
                    npcLoginScreenPropsById?: Uint8Array,
                    requiredLoginScreenPropsMask?: number,
                ) => {
                    const bridge = await this.loadBridge();
                    if (!bridge?.decodeNpcSpawnsFromBytes) {
                        return undefined;
                    }
                    return bridge.decodeNpcSpawnsFromBytes(
                        tileRenderFlagsLevel1,
                        borderSize,
                        mapX,
                        mapY,
                        data,
                        npcLoginScreenPropsById,
                        requiredLoginScreenPropsMask,
                    );
                },
            },
        });
    }

    private loadBridge(): Promise<CppWasmMapRenderDataBridge | undefined> {
        if (!this.bridgePromise) {
            this.bridgePromise = tryLoadCppWasmBridge(this.options?.cppWasmModuleUrl);
        }
        return this.bridgePromise;
    }

    private shouldRunShadowSample(): boolean {
        if (this.shadowSampleRate <= 0) {
            return false;
        }
        return Math.random() < this.shadowSampleRate;
    }

    private shouldIncludeMinimapBlob(): boolean {
        return typeof OffscreenCanvas !== "undefined";
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
            const summary = CPP_WASM_OUTCOME_KEYS.map(
                (k) => `${k}=${this.outcomeStats[k]}`,
            ).join(" ");
            console.log(`[map-render] backend=cpp-wasm outcomes ${summary}`);
        }
    }

    private trackShadowOutcome(
        outcome: CppWasmShadowOutcome,
        input: SdMapLoaderInput,
        totalMs?: number,
        details?: string,
    ): void {
        this.shadowOutcomeStats[outcome]++;
        this.shadowCalls++;
        if (!this.options?.telemetry) {
            return;
        }
        const suffix = details ? ` details=${details}` : "";
        const timing = totalMs !== undefined ? ` totalMs=${totalMs.toFixed(1)}` : "";
        console.log(
            `[map-render] square=${input.mapX},${input.mapY} backend=cpp-wasm-shadow outcome=${outcome}${timing}${suffix}`,
        );
        if (this.shadowCalls % 25 === 0) {
            const summary = CPP_WASM_SHADOW_OUTCOME_KEYS.map(
                (k) => `${k}=${this.shadowOutcomeStats[k]}`,
            ).join(" ");
            console.log(`[map-render] backend=cpp-wasm-shadow outcomes ${summary}`);
        }
    }

    private async buildMapDataActive(
        input: SdMapLoaderInput,
        t0: number | undefined,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        const bridge = await this.loadBridge();
        if (!bridge) {
            this.trackOutcome(
                "bridgeMissing",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return this.fallback.buildMapData(input);
        }
        const tsPayloadResult = await this.fallback.buildMapDataPayload(input, {
            includeStagingSceneHeights: true,
            includeStagingDrawCommands: true,
            preferWasmPacking: true,
            includeMinimapBlob: this.shouldIncludeMinimapBlob(),
        });
        if (!tsPayloadResult.data) {
            this.trackOutcome(
                "tsPayloadEmpty",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult(tsPayloadResult);
        }
        try {
            const payloadResult = await bridge.buildMapData(input, tsPayloadResult);
            if (!payloadResult?.data) {
                this.trackOutcome(
                    "bridgeReturnedEmpty",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                );
                return this.fallback.buildMapData(input);
            }
            if (payloadResult.data.staging !== undefined) {
                this.trackOutcome(
                    "bridgeKeptStaging",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                );
                return this.fallback.buildMapData(input);
            }
            const validationIssues = validateMapRenderPayload(payloadResult.data);
            if (validationIssues.length > 0) {
                console.warn(
                    `[map-render-backend] invalid payload from cpp-wasm backend: ${validationIssues.join(
                        "; ",
                    )}`,
                );
                this.trackOutcome(
                    "validationFailed",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                    validationIssues[0],
                );
                return this.fallback.buildMapData(input);
            }
            this.trackOutcome(
                "success",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult(payloadResult);
        } catch (e) {
            console.warn(`[map-render-backend] cpp-wasm buildMapData failed: ${errorToString(e)}`);
            this.trackOutcome(
                "bridgeError",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                errorToString(e),
            );
            return this.fallback.buildMapData(input);
        }
    }

    private async buildMapDataShadow(
        input: SdMapLoaderInput,
        t0: number | undefined,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        const tsBaselineWithStaging = await this.fallback.buildMapDataPayload(input, {
            includeStagingSceneHeights: true,
            includeStagingDrawCommands: true,
            includeMinimapBlob: this.shouldIncludeMinimapBlob(),
        });
        if (!tsBaselineWithStaging.data) {
            return payloadResultToRenderDataResult(tsBaselineWithStaging);
        }
        const tsBaseline = stripStagingFromPayloadResult(tsBaselineWithStaging);
        const tsBaselineData = tsBaseline.data;
        if (!tsBaselineData) {
            return payloadResultToRenderDataResult(tsBaseline);
        }
        if (!this.shouldRunShadowSample()) {
            this.trackShadowOutcome(
                "skipped",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult(tsBaseline);
        }

        const bridge = await this.loadBridge();
        if (!bridge) {
            this.trackShadowOutcome(
                "bridgeMissing",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult(tsBaseline);
        }

        if (!tsBaselineWithStaging.data.staging) {
            this.trackShadowOutcome(
                "stagedPayloadEmpty",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult(tsBaseline);
        }

        try {
            const payloadResult = await bridge.buildMapData(input, tsBaselineWithStaging);
            if (!payloadResult?.data) {
                this.trackShadowOutcome(
                    "bridgeReturnedEmpty",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                );
                return payloadResultToRenderDataResult(tsBaseline);
            }
            if (payloadResult.data.staging !== undefined) {
                this.trackShadowOutcome(
                    "bridgeKeptStaging",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                );
                return payloadResultToRenderDataResult(tsBaseline);
            }
            const validationIssues = validateMapRenderPayload(payloadResult.data);
            if (validationIssues.length > 0) {
                this.trackShadowOutcome(
                    "validationFailed",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                    validationIssues[0],
                );
                return payloadResultToRenderDataResult(tsBaseline);
            }

            const expectedDigest = digestMapRenderPayload(tsBaselineData);
            const actualDigest = digestMapRenderPayload(payloadResult.data);
            const mismatchKeys = digestMismatchKeys(expectedDigest, actualDigest);
            if (mismatchKeys.length > 0) {
                this.trackShadowOutcome(
                    "digestMismatch",
                    input,
                    t0 !== undefined ? performance.now() - t0 : undefined,
                    mismatchKeys.join(","),
                );
                return payloadResultToRenderDataResult(tsBaseline);
            }

            this.trackShadowOutcome(
                "success",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult(tsBaseline);
        } catch (e) {
            this.trackShadowOutcome(
                "bridgeError",
                input,
                t0 !== undefined ? performance.now() - t0 : undefined,
                errorToString(e),
            );
            return payloadResultToRenderDataResult(tsBaseline);
        }
    }

    async buildMapData(
        input: SdMapLoaderInput,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        const t0 = this.options?.telemetry ? performance.now() : undefined;
        if (this.rolloutMode === "shadow") {
            return this.buildMapDataShadow(input, t0);
        }
        return this.buildMapDataActive(input, t0);
    }

    reset(): void {
        this.fallback.reset();
        if (this.bridgePromise) {
            this.bridgePromise.then((bridge) => bridge?.reset?.());
        }
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
