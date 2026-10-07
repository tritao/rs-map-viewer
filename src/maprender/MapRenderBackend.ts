import type { MapRenderBuildAdapter } from "../core/build/MapRenderBuildAdapter";
import type { MapRenderContentSession } from "../core/build/MapRenderContentSession";
import type { NpcSpawn } from "../data/npc/NpcSpawn";
import type { ObjSpawn } from "../data/obj/ObjSpawn";
import type { MapRuntimeBootstrap, MapRuntimeRegistration } from "../runtime/MapRuntimePayload";
import type { BackendKind } from "../util/BackendKind";
import type { MapRenderRuntimeHandle } from "../wasm/MapRenderRuntimeBridgeAbi";
import type { SdMapData, SdMapLoaderInput } from "./MapRenderPayload";
import { MAP_RENDER_DRAW_BUCKET_KEYS } from "./MapRenderPayload";
import { MapRenderTsBackend } from "./ts/MapRenderTsBackend";
import { WasmMapRenderBackend } from "./wasm/WasmMapRenderBackend";

export type NpcSpawnDecodeBackend = Readonly<{
    name: BackendKind;
    filtersLoginScreenProps?: boolean;
    decodeNpcSpawnsFromBytes(
        tileRenderFlagsLevel1: Uint8Array[],
        borderSize: number,
        mapX: number,
        mapY: number,
        data: Uint8Array,
        npcLoginScreenPropsById?: Uint8Array,
        requiredLoginScreenPropsMask?: number,
    ): Promise<NpcSpawn[] | undefined>;
}>;

export type MapRenderBuildDeps = Readonly<{
    contentSession: MapRenderContentSession;
    buildAdapter: MapRenderBuildAdapter;
    objSpawns: ObjSpawn[];
    fallbackNpcSpawns?: ReadonlyArray<NpcSpawn>;
    npcSpawnDecodeBackend?: NpcSpawnDecodeBackend;
    telemetry?: boolean;
}>;

function pushTransferableUnique(
    out: Transferable[],
    seen: Set<Transferable>,
    transferable: Transferable | undefined,
): void {
    if (!transferable || seen.has(transferable)) {
        return;
    }
    seen.add(transferable);
    out.push(transferable);
}

export function collectSdMapDataTransferables(data: SdMapData): Transferable[] {
    const transferables: Transferable[] = [];
    const seen = new Set<Transferable>();
    for (const tileFlags of data.tileRenderFlags.flat()) {
        pushTransferableUnique(transferables, seen, tileFlags.buffer as Transferable);
    }
    for (const pixels of data.loadedTextures.values()) {
        pushTransferableUnique(transferables, seen, pixels.buffer as Transferable);
    }
    pushTransferableUnique(transferables, seen, data.vertices.buffer as Transferable);
    pushTransferableUnique(transferables, seen, data.indices.buffer as Transferable);
    pushTransferableUnique(transferables, seen, data.heightMapTextureData.buffer as Transferable);
    pushTransferableUnique(transferables, seen, data.usedTextureIds.buffer as Transferable);
    for (const key of MAP_RENDER_DRAW_BUCKET_KEYS) {
        pushTransferableUnique(
            transferables,
            seen,
            data.modelInfoTextures[key].buffer as Transferable,
        );
        pushTransferableUnique(transferables, seen, data.drawRanges[key].buffer as Transferable);
    }
    if (
        data.npcVertices instanceof Uint8Array &&
        data.npcIndices instanceof Int32Array &&
        data.npcDrawRangesBase instanceof Int32Array
    ) {
        pushTransferableUnique(transferables, seen, data.npcVertices.buffer as Transferable);
        pushTransferableUnique(transferables, seen, data.npcIndices.buffer as Transferable);
        pushTransferableUnique(transferables, seen, data.npcDrawRangesBase.buffer as Transferable);
        if (data.npcDrawRangesAlpha) {
            pushTransferableUnique(
                transferables,
                seen,
                data.npcDrawRangesAlpha.buffer as Transferable,
            );
        }
    }
    return transferables;
}

export type RenderDataResult<T> = Readonly<{
    data: T;
    transferables: Transferable[];
    runtimeRegistration?: MapRuntimeRegistration;
    runtimeBootstrap?: MapRuntimeBootstrap;
}>;

export type MapRenderBackendKind = BackendKind;

export type MapRenderBackendOptions = Readonly<{
    telemetry?: boolean;
}>;

export interface MapRenderBackend {
    readonly kind: MapRenderBackendKind;
    buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>>;
    reset(): void;
    // Exposes the underlying wasm runtime handle when this backend is "wasm".
    // This allows the worker tick path to use the same runtime instance that built the map packets.
    getWasmRuntimeHandle?(): MapRenderRuntimeHandle | undefined;
}

class TsMapRenderBackend implements MapRenderBackend {
    readonly kind: MapRenderBackendKind = "ts";
    private readonly backend: MapRenderTsBackend;

    constructor(deps: MapRenderBuildDeps) {
        this.backend = new MapRenderTsBackend(deps);
    }

    async buildMapData(input: SdMapLoaderInput): Promise<RenderDataResult<SdMapData | undefined>> {
        const result = await this.backend.buildMapData(input);
        const data = result.data;
        return {
            data,
            transferables: data ? collectSdMapDataTransferables(data) : [],
            runtimeRegistration: result.runtimeRegistration,
            runtimeBootstrap: result.runtimeBootstrap,
        };
    }

    reset(): void {
        this.backend.reset();
    }
}

export function createMapRenderBackend(
    kind: MapRenderBackendKind,
    deps: MapRenderBuildDeps,
    options?: MapRenderBackendOptions,
): MapRenderBackend {
    if (kind === "wasm") {
        return new WasmMapRenderBackend(deps, options);
    }
    return new TsMapRenderBackend({
        ...deps,
        telemetry: options?.telemetry,
    });
}
