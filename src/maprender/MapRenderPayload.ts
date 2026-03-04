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
