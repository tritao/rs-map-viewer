import type { ObjSpawn } from "../data/obj/ObjSpawn";
import type { MapBytesProvider } from "../rs/map/MapBytesProvider";
import type { Result } from "../util/Result";

export type TypeEntryLoaderLike<T = unknown> = Readonly<{
    tryLoad?: (id: number) => Result<T, unknown> | undefined;
    tryLoadBytes?: (id: number) => Uint8Array | Int8Array | undefined;
}>;

export type LegacyModelFileBytes = Readonly<{
    headBytes: Uint8Array;
    face1Bytes: Uint8Array;
    face2Bytes: Uint8Array;
    face3Bytes: Uint8Array;
    face4Bytes: Uint8Array;
    face5Bytes: Uint8Array;
    point1Bytes: Uint8Array;
    point2Bytes: Uint8Array;
    point3Bytes: Uint8Array;
    point4Bytes: Uint8Array;
    point5Bytes: Uint8Array;
    vertex1Bytes: Uint8Array;
    vertex2Bytes: Uint8Array;
    axisBytes: Uint8Array;
}>;

export type LegacySeqFrameFileBytes = Readonly<{
    baseHeadBytes: Uint8Array;
    baseTypeBytes: Uint8Array;
    baseLabelBytes: Uint8Array;
    frameHeadBytes: Uint8Array;
    frameTran1Bytes: Uint8Array;
    frameTran2Bytes: Uint8Array;
    frameDelBytes: Uint8Array;
}>;

export type DatSeqFrameMapBlob = Readonly<{ frameMapId: number; bytes: Uint8Array }>;

export type ModelLoaderLike = TypeEntryLoaderLike & Readonly<{
    tryGetLegacyModelFileBytes?: () => LegacyModelFileBytes;
}>;

export type SeqFrameLoaderLike = TypeEntryLoaderLike & Readonly<{
    tryGet?: (id: number) => Result<unknown, unknown> | unknown;
    baseLoader?: TypeEntryLoaderLike;
    tryGetLegacySeqFrameFileBytes?: () => LegacySeqFrameFileBytes;
    tryGetFrameMapBlobForFrameId?: (id: number) => DatSeqFrameMapBlob | undefined;
}>;

export type SkeletalSeqLoaderLike = TypeEntryLoaderLike & Readonly<{
    tryGet?: (id: number) => Result<unknown, unknown> | unknown;
    baseLoader?: TypeEntryLoaderLike;
}>;

export type TextureLoaderLike = Readonly<{
    getTextureIds?: () => number[];
    isSd?: (id: number) => boolean;
    isTransparent?: (id: number) => boolean;
}>;

export type LocModelLoaderLike = Readonly<{
    modelLoader?: ModelLoaderLike;
    textureLoader?: TextureLoaderLike;
    seqTypeLoader?: TypeEntryLoaderLike;
    seqFrameLoader?: SeqFrameLoaderLike;
    skeletalSeqLoader?: SkeletalSeqLoaderLike;
}>;

export type VarProviderLike = Readonly<{
    values?: Int32Array;
    varbitLoader?: TypeEntryLoaderLike;
    varManager?: Readonly<{
        values?: Int32Array;
        varbitLoader?: TypeEntryLoaderLike;
    }>;
}>;

type SceneBuildLoaders = Readonly<{
    locTypeLoader: TypeEntryLoaderLike;
    objTypeLoader?: TypeEntryLoaderLike;
    locModelLoader: LocModelLoaderLike;
    seqTypeLoader?: TypeEntryLoaderLike;
    seqFrameLoader?: SeqFrameLoaderLike;
    skeletalSeqLoader?: SkeletalSeqLoaderLike;
    textureLoader?: TextureLoaderLike;
    npcTypeLoader?: TypeEntryLoaderLike;
    basTypeLoader?: TypeEntryLoaderLike;
    varProvider: VarProviderLike;
    underlayTypeLoader?: TypeEntryLoaderLike;
    overlayTypeLoader?: TypeEntryLoaderLike;
}>;

export type MapRenderSceneBuildInputDeps = Readonly<
    SceneBuildLoaders & {
        mapBytesProvider: MapBytesProvider;
        objSpawns?: ReadonlyArray<ObjSpawn>;
        cacheGame: number;
        cacheRevision: number;
    }
>;
