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
import { DummyVarBitTypeLoader, VarBitTypeLoader } from "../config/vartype/bit/VarBitTypeLoader";
import { Dat2MapIndex } from "../map/MapFileIndex";
import { LegacyMapFileLoader, MapFileLoader } from "../map/MapFileLoader";
import { LegacyModelLoader } from "../model/ModelLoader";
import { LegacySeqFrameLoader, SeqFrameLoader } from "../model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../sprite/IndexedSprite";
import { DatTextureLoader } from "../texture/DatTextureLoader";
import { TextureLoader } from "../texture/TextureLoader";
import { Archive } from "../cache/format/Archive";
import { CacheIndex } from "../cache/CacheIndex";
import { CacheInfo } from "../cache/CacheInfo";
import { CacheSystem } from "../cache/CacheSystem";
import { LegacyIndexId } from "../cache/IndexId";
import { loadMapFunctions, loadMapScenes } from "./DatLoaders";
import { Loaders } from "./Loaders";

export function createLegacyLoaders(cacheInfo: CacheInfo, cacheSystem: CacheSystem): Loaders {
    const configIndex = cacheSystem.getIndex(LegacyIndexId.configs);
    const configArchive = configIndex.getArchive(0);

    const mediaIndex = cacheSystem.getIndex(LegacyIndexId.media);
    const mediaArchive = mediaIndex.getArchive(0);

    const textureIndex = cacheSystem.getIndex(LegacyIndexId.textures);
    const textureArchive = textureIndex.getArchive(0);

    const modelIndex = cacheSystem.getIndex(LegacyIndexId.models);
    const modelArchive = modelIndex.getArchive(0);

    const mapIndex = cacheSystem.getIndex(LegacyIndexId.maps);

    const floTypeLoader = DatFloorTypeLoader.create(cacheInfo, configArchive);
    const textureLoader = new DatTextureLoader(textureArchive, [
        DatTextureLoader.WATER_DROPLETS_TEXTURE_ID,
        24,
    ]);

    return {
        underlayTypeLoader: floTypeLoader,
        overlayTypeLoader: floTypeLoader,

        varBitTypeLoader: new DummyVarBitTypeLoader(cacheInfo),

        locTypeLoader: DatLocTypeLoader.create(cacheInfo, configArchive),
        npcTypeLoader: DatNpcTypeLoader.create(cacheInfo, configArchive),
        objTypeLoader: DatObjTypeLoader.create(cacheInfo, configArchive),

        seqTypeLoader: DatSeqTypeLoader.create(cacheInfo, configArchive),

        basTypeLoader: new DummyBasTypeLoader(cacheInfo),

        questTypeLoader: undefined,

        textureLoader,

        modelLoader: LegacyModelLoader.load(modelArchive),
        seqFrameLoader: LegacySeqFrameLoader.load(modelArchive),
        skeletalSeqLoader: undefined,

        mapFileLoader: new LegacyMapFileLoader(mapIndex, new Dat2MapIndex(mapIndex)),

        mapScenes: loadMapScenes(mediaArchive),
        mapFunctions: loadMapFunctions(mediaArchive),
    };
}
