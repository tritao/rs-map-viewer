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

    async buildMapData(
        input: SdMapLoaderInput,
    ): Promise<RenderDataResult<SdMapData | undefined>> {
        const t0 = this.options?.telemetry ? performance.now() : 0;
        const bridge = await this.loadBridge();
        if (!bridge) {
            return this.fallback.buildMapData(input);
        }
        const tsPayloadResult = await this.fallback.buildMapDataPayload(input, {
            includeStagingSceneHeights: true,
        });
        if (!tsPayloadResult.data) {
            return payloadResultToRenderDataResult(tsPayloadResult);
        }
        try {
            const payloadResult = await bridge.buildMapData(input, tsPayloadResult);
            if (!payloadResult?.data) {
                return payloadResultToRenderDataResult(tsPayloadResult);
            }
            const validationIssues = validateMapRenderPayload(payloadResult.data);
            if (validationIssues.length > 0) {
                console.warn(
                    `[map-render-backend] invalid payload from cpp-wasm backend: ${validationIssues.join(
                        "; ",
                    )}`,
                );
                return payloadResultToRenderDataResult(tsPayloadResult);
            }
            if (this.options?.telemetry) {
                const dt = performance.now() - t0;
                console.log(
                    `[map-render] square=${input.mapX},${input.mapY} backend=cpp-wasm totalMs=${dt.toFixed(
                        1,
                    )} usedWasmHeightMap=${payloadResult.data.staging === undefined}`,
                );
            }
            return payloadResultToRenderDataResult(payloadResult);
        } catch (e) {
            console.warn(`[map-render-backend] cpp-wasm buildMapData failed: ${errorToString(e)}`);
            return payloadResultToRenderDataResult(tsPayloadResult);
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
