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
    MapRenderDataPayloadResult,
    payloadResultToRenderDataResult,
    validateMapRenderPayload,
} from "./MapRenderDataContract";
import type { RenderDataResult } from "./RenderDataLoader";

export type MapRenderDataBackendKind = "ts" | "cpp-wasm";

export type MapRenderDataBackendOptions = Readonly<{
    cppWasmModuleUrl?: string;
    telemetry?: boolean;
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
    private buildCalls = 0;

    constructor(
        deps: MapRenderDataBackendDeps,
        private readonly options: MapRenderDataBackendOptions | undefined,
    ) {
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

    async buildMapData(
        input: SdMapLoaderInput,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        const t0 = this.options?.telemetry ? performance.now() : 0;
        const bridge = await this.loadBridge();
        if (!bridge) {
            this.trackOutcome(
                "bridgeMissing",
                input,
                this.options?.telemetry ? performance.now() - t0 : undefined,
            );
            return this.fallback.buildMapData(input);
        }
        const tsPayloadResult = await this.fallback.buildMapDataPayload(input, {
            includeStagingSceneHeights: true,
            includeStagingDrawCommands: true,
            preferWasmPacking: true,
        });
        if (!tsPayloadResult.data) {
            this.trackOutcome(
                "tsPayloadEmpty",
                input,
                this.options?.telemetry ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult(tsPayloadResult);
        }
        try {
            const payloadResult = await bridge.buildMapData(input, tsPayloadResult);
            if (!payloadResult?.data) {
                this.trackOutcome(
                    "bridgeReturnedEmpty",
                    input,
                    this.options?.telemetry ? performance.now() - t0 : undefined,
                );
                return this.fallback.buildMapData(input);
            }
            if (payloadResult.data.staging !== undefined) {
                this.trackOutcome(
                    "bridgeKeptStaging",
                    input,
                    this.options?.telemetry ? performance.now() - t0 : undefined,
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
                    this.options?.telemetry ? performance.now() - t0 : undefined,
                    validationIssues[0],
                );
                return this.fallback.buildMapData(input);
            }
            this.trackOutcome(
                "success",
                input,
                this.options?.telemetry ? performance.now() - t0 : undefined,
            );
            return payloadResultToRenderDataResult(payloadResult);
        } catch (e) {
            console.warn(`[map-render-backend] cpp-wasm buildMapData failed: ${errorToString(e)}`);
            this.trackOutcome(
                "bridgeError",
                input,
                this.options?.telemetry ? performance.now() - t0 : undefined,
                errorToString(e),
            );
            return this.fallback.buildMapData(input);
        }
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
