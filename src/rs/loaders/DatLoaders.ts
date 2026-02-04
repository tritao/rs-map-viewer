import { BasTypeLoader, DummyBasTypeLoader } from "../config/bastype/BasTypeLoader";
import {
    DatFloorTypeLoader,
    FloorTypeLoader,
    OverlayFloorTypeLoader,
} from "../config/floortype/FloorTypeLoader";
import { DatLocTypeLoader, LocTypeLoader } from "../config/loctype/LocTypeLoader";
import { DatNpcTypeLoader, NpcTypeLoader } from "../config/npctype/NpcTypeLoader";
import { DatObjTypeLoader, ObjTypeLoader } from "../config/objtype/ObjTypeLoader";
import { QuestTypeLoader } from "../config/questtype/QuestTypeLoader";
import { DatSeqTypeLoader, SeqTypeLoader } from "../config/seqtype/SeqTypeLoader";
import {
    DatVarBitTypeLoader,
    DummyVarBitTypeLoader,
    VarBitTypeLoader,
} from "../config/vartype/bit/VarBitTypeLoader";
import { DatMapFileIndex } from "../map/MapFileIndex";
import { MapFileLoader } from "../map/MapFileLoader";
import { IndexModelLoader, ModelLoader } from "../model/ModelLoader";
import { DatSeqFrameLoader, SeqFrameLoader } from "../model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../sprite/IndexedSprite";
import { SpriteLoader } from "../sprite/SpriteLoader";
import { DatTextureLoader } from "../texture/DatTextureLoader";
import { TextureLoader } from "../texture/TextureLoader";
import { Archive } from "../cache/format/Archive";
import { CacheIndex } from "../cache/CacheIndex";
import { CacheInfo } from "../cache/CacheInfo";
import { CacheSystem } from "../cache/CacheSystem";
import { CacheType } from "../cache/CacheType";
import { DatConfigArchiveId } from "../cache/ConfigArchiveId";
import { DatIndexId } from "../cache/IndexId";
import { Loaders } from "./Loaders";

export function loadMapSprites(mediaArchive: Archive, name: string): IndexedSprite[] {
    return SpriteLoader.loadIndexedSpritesDat(mediaArchive, name);
}

export function loadMapScenes(mediaArchive: Archive): IndexedSprite[] {
    return loadMapSprites(mediaArchive, "mapscene");
}

export function loadMapFunctions(mediaArchive: Archive): IndexedSprite[] {
    return loadMapSprites(mediaArchive, "mapfunction");
}

export function createDatLoaders(
    cacheInfo: CacheInfo,
    _cacheType: CacheType,
    cacheSystem: CacheSystem,
): Loaders {
    const configIndex = cacheSystem.getIndex(DatIndexId.configs);
    const configArchive = configIndex.getArchive(DatConfigArchiveId.configs);
    const mediaArchive = configIndex.getArchive(DatConfigArchiveId.media);

    const floTypeLoader = DatFloorTypeLoader.create(cacheInfo, configArchive);

    const varBitTypeLoader =
        cacheInfo.revision < 254
            ? new DummyVarBitTypeLoader(cacheInfo)
            : DatVarBitTypeLoader.create(cacheInfo, configArchive);

    const textureArchive = configIndex.getArchive(DatConfigArchiveId.textures);
    const animatedTextureIds = [DatTextureLoader.WATER_DROPLETS_TEXTURE_ID, 24];
    if (cacheInfo.revision > 289) {
        animatedTextureIds.push(34, 40);
    }
    const textureLoader = new DatTextureLoader(textureArchive, animatedTextureIds);

    const mapIndex = cacheSystem.getIndex(DatIndexId.maps);
    const versionListArchive = configIndex.getArchive(DatConfigArchiveId.versionList);
    const mapFileIndex = DatMapFileIndex.create(versionListArchive);

    return {
        underlayTypeLoader: floTypeLoader,
        overlayTypeLoader: floTypeLoader,

        varBitTypeLoader,

        locTypeLoader: DatLocTypeLoader.create(cacheInfo, configArchive),
        npcTypeLoader: DatNpcTypeLoader.create(cacheInfo, configArchive),
        objTypeLoader: DatObjTypeLoader.create(cacheInfo, configArchive),

        seqTypeLoader: DatSeqTypeLoader.create(cacheInfo, configArchive),

        basTypeLoader: new DummyBasTypeLoader(cacheInfo),

        questTypeLoader: undefined,

        textureLoader,

        modelLoader: new IndexModelLoader(cacheSystem.getIndex(DatIndexId.models)),
        seqFrameLoader: DatSeqFrameLoader.create(cacheSystem.getIndex(DatIndexId.animations)),
        skeletalSeqLoader: undefined,

        mapFileLoader: new MapFileLoader(mapIndex, mapFileIndex),

        mapScenes: loadMapScenes(mediaArchive),
        mapFunctions: loadMapFunctions(mediaArchive),
    };
}
