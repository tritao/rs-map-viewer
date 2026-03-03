import { CacheType } from "../cache/CacheType";
import { BasTypeLoader } from "../config/bastype/BasTypeLoader";
import { FloorTypeLoader, OverlayFloorTypeLoader } from "../config/floortype/FloorTypeLoader";
import { LocTypeLoader } from "../config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../config/objtype/ObjTypeLoader";
import { QuestTypeLoader } from "../config/questtype/QuestTypeLoader";
import { SeqTypeLoader } from "../config/seqtype/SeqTypeLoader";
import { VarBitTypeLoader } from "../config/vartype/bit/VarBitTypeLoader";
import { MapFileLoader } from "../map/MapFileLoader";
import { ModelLoader } from "../model/ModelLoader";
import { SeqFrameLoader } from "../model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../sprite/IndexedSprite";
import { TextureLoader } from "../texture/TextureLoader";

export type OptionalIndexedSprite = IndexedSprite | undefined;
export type CacheClearable = { clearCache(): void };

export type LoaderCapabilities = Readonly<{
    cacheType: CacheType;
    hasQuestTypeLoader: boolean;
    hasSkeletalSeqLoader: boolean;
    hasDistinctUnderlayTypeLoader: boolean;
}>;

export type ModelService = Pick<
    ModelLoader,
    "tryLoad" | "tryGet" | "tryLoadBytes" | "getCount" | "clearCache"
>;
export type SeqFrameService = Pick<
    SeqFrameLoader,
    "tryLoad" | "tryGet" | "tryLoadBytes" | "clearCache"
>;
export type SkeletalSeqService = Pick<
    SkeletalSeqLoader,
    "tryLoad" | "tryGet" | "tryLoadBytes" | "baseLoader" | "clearCache"
>;
export type TextureService = Pick<
    TextureLoader,
    | "getTextureIds"
    | "getTextureIndex"
    | "isSmall"
    | "isSd"
    | "isTransparent"
    | "getAverageHsl"
    | "getAnimationUv"
    | "getMaterial"
    | "tryGetMaterial"
    | "tryLoadMaterial"
    | "tryGetPixelsRgb"
    | "tryGetPixelsArgb"
    | "tryLoadPixelsRgb"
    | "tryLoadPixelsArgb"
    | "clearCache"
>;
export type MapFileService = Pick<
    MapFileLoader,
    | "mapFileIndex"
    | "tryLoadTerrainBytes"
    | "tryGetTerrainBytes"
    | "tryLoadLocBytes"
    | "tryGetLocBytes"
    | "tryLoadNpcSpawnBytes"
    | "tryGetNpcSpawnBytes"
>;

export type Loaders = Readonly<{
    capabilities: LoaderCapabilities;

    underlayTypeLoader: FloorTypeLoader;
    overlayTypeLoader: OverlayFloorTypeLoader;

    varBitTypeLoader: VarBitTypeLoader;

    locTypeLoader: LocTypeLoader;
    npcTypeLoader: NpcTypeLoader;
    objTypeLoader: ObjTypeLoader;

    seqTypeLoader: SeqTypeLoader;

    basTypeLoader: BasTypeLoader;

    questTypeLoader?: QuestTypeLoader;

    textureLoader: TextureService;

    modelLoader: ModelService;
    seqFrameLoader: SeqFrameService;
    skeletalSeqLoader?: SkeletalSeqService;

    mapFileLoader: MapFileService;

    mapScenes: ReadonlyArray<OptionalIndexedSprite>;
    mapFunctions: ReadonlyArray<OptionalIndexedSprite>;
}>;

export function createLoaderCapabilities(
    cacheType: CacheType,
    hasQuestTypeLoader: boolean,
    hasSkeletalSeqLoader: boolean,
    hasDistinctUnderlayTypeLoader: boolean,
): LoaderCapabilities {
    return {
        cacheType,
        hasQuestTypeLoader,
        hasSkeletalSeqLoader,
        hasDistinctUnderlayTypeLoader,
    };
}

export function getQuestTypeLoader(loaders: Loaders): QuestTypeLoader | undefined {
    return loaders.capabilities.hasQuestTypeLoader ? loaders.questTypeLoader : undefined;
}

export function getSkeletalSeqLoader(loaders: Loaders): SkeletalSeqService | undefined {
    return loaders.capabilities.hasSkeletalSeqLoader ? loaders.skeletalSeqLoader : undefined;
}

export function clearLoaderCaches(loaders: Loaders): void {
    const cleared = new Set<unknown>();
    const clear = (value: CacheClearable | undefined): void => {
        if (!value || cleared.has(value)) {
            return;
        }
        cleared.add(value);
        value.clearCache();
    };

    clear(loaders.underlayTypeLoader);
    clear(loaders.overlayTypeLoader);
    clear(loaders.varBitTypeLoader);
    clear(loaders.locTypeLoader);
    clear(loaders.npcTypeLoader);
    clear(loaders.objTypeLoader);
    clear(loaders.seqTypeLoader);
    clear(loaders.basTypeLoader);
    clear(getQuestTypeLoader(loaders));
    clear(loaders.textureLoader);
    clear(loaders.modelLoader);
    clear(loaders.seqFrameLoader);
    clear(getSkeletalSeqLoader(loaders));
}
