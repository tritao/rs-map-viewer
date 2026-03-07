import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import type { LocAnimatedData } from "../runtime/entities/LocAnimatedData";

export const MAP_RENDER_DRAW_BUCKET_KEYS = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
] as const;

export type MapRenderDrawBucketKey = (typeof MAP_RENDER_DRAW_BUCKET_KEYS)[number];

export type SdRenderableModelInfoTextures = {
    readonly base: Uint16Array;
    readonly alpha: Uint16Array;

    readonly lod: Uint16Array;
    readonly lodAlpha: Uint16Array;

    readonly interact: Uint16Array;
    readonly interactAlpha: Uint16Array;

    readonly interactLod: Uint16Array;
    readonly interactLodAlpha: Uint16Array;
};

export type SdRenderableDrawRanges = {
    readonly base: Int32Array;
    readonly alpha: Int32Array;

    readonly lod: Int32Array;
    readonly lodAlpha: Int32Array;

    readonly interact: Int32Array;
    readonly interactAlpha: Int32Array;

    readonly interactLod: Int32Array;
    readonly interactLodAlpha: Int32Array;
};

export type SdRenderableData = {
    readonly cacheName: string;

    readonly borderSize: number;
    readonly tileRenderFlags: Uint8Array[][];

    readonly vertices: Uint8Array;
    readonly indices: Int32Array;

    readonly modelInfoTextures: SdRenderableModelInfoTextures;
    readonly drawRanges: SdRenderableDrawRanges;

    readonly locsAnimated: LocAnimatedData[];

    readonly loadedTextures: Map<number, Int32Array>;
    readonly npcDrawRangesBase?: Int32Array;
    readonly npcDrawRangesAlpha?: Int32Array;
    readonly npcVertices?: Uint8Array;
    readonly npcIndices?: Int32Array;
    readonly npcOrderKeys?: Int32Array;
};

export interface MapData {
    mapX: number;
    mapY: number;

    cacheName: string;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;
    loadLocs: boolean;

    smoothTerrain: boolean;

    minimapBlob: Blob;
}

export type MapRuntimeRegistration = Readonly<{
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>;
}>;

export type MapRuntimeBootstrap = Readonly<{
    maxLevel: number;
    npcOrderKeys: Int32Array;
}>;

export type SdMapData = MapData &
    SdRenderableData & {
        readonly mapX: number;
        readonly mapY: number;

        readonly loadLocs: boolean;

        readonly minimapBlob: Blob;
        readonly heightMapTextureData: Int16Array;
        readonly usedTextureIds: Int32Array;
        // Maps NpcType -> animation frame drawRanges within this map's npc geometry buffers.
        // Used by the worker tick pipeline to patch npc draw ranges per-frame.
        readonly npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
    };

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

export function buildMapRuntimeRegistration(data: SdMapData): MapRuntimeRegistration {
    return {
        borderSize: data.borderSize | 0,
        tileRenderFlagsLevel1: data.tileRenderFlags[1] ?? [],
        locsAnimated: data.locsAnimated,
        npcTypeAnimationTable: data.npcTypeAnimationTable ?? [],
    };
}

export function buildMapRuntimeBootstrap(data: SdMapData): MapRuntimeBootstrap {
    return {
        maxLevel: data.maxLevel | 0,
        npcOrderKeys: data.npcOrderKeys ?? new Int32Array(0),
    };
}

export type SdMapLoaderInput = {
    mapX: number;
    mapY: number;

    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;
    loadLocs: boolean;

    smoothTerrain: boolean;

    minimizeDrawCalls: boolean;

    loadedTextureIds: Int32Array;
};

export function sdMapDataTransferables(data: SdMapData): Transferable[] {
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
        if (data.npcOrderKeys) {
            pushTransferableUnique(transferables, seen, data.npcOrderKeys.buffer as Transferable);
        }
    }
    return transferables;
}
