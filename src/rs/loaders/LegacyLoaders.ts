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

function requireArchive(index: CacheIndex, archiveId: number, description: string): Archive {
    const archive = index.tryGetArchive(archiveId);
    if (!archive) {
        throw new Error(
            `Missing ${description} archive (index=${index.id} archive=${archiveId})`,
        );
    }
    return archive;
}

export function createLegacyLoaders(cacheInfo: CacheInfo, cacheSystem: CacheSystem): Loaders {
    const configIndex = cacheSystem.getIndex(LegacyIndexId.configs);
    const configArchive = requireArchive(configIndex, 0, "legacy config");

    const mediaIndex = cacheSystem.getIndex(LegacyIndexId.media);
    const mediaArchive = requireArchive(mediaIndex, 0, "legacy media");

    const textureIndex = cacheSystem.getIndex(LegacyIndexId.textures);
    const textureArchive = requireArchive(textureIndex, 0, "legacy texture");

    const modelIndex = cacheSystem.getIndex(LegacyIndexId.models);
    const modelArchive = requireArchive(modelIndex, 0, "legacy model");

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

        modelLoader: LegacyModelLoader.create(modelArchive),
        seqFrameLoader: LegacySeqFrameLoader.create(modelArchive),
        skeletalSeqLoader: undefined,

        mapFileLoader: new LegacyMapFileLoader(mapIndex, new Dat2MapIndex(mapIndex)),

        mapScenes: loadMapScenes(mediaArchive),
        mapFunctions: loadMapFunctions(mediaArchive),
    };
}
