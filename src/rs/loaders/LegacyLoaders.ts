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
import { CacheIndexMapBytesProvider, LegacyMapFileLoader, MapFileLoader } from "../map/MapFileLoader";
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
import { ArchiveNamedBytesProvider } from "../io/NamedBytesProvider";
import { loadMapFunctions, loadMapScenes } from "./DatLoaders";
import { Loaders } from "./Loaders";
import { err, ok, Result } from "../../util/Result";
import { createFailed, InitError, initErrorToString, missingArchive, missingIndex } from "./InitError";

function requireIndex(cacheSystem: CacheSystem, indexId: number, description: string): Result<CacheIndex, InitError> {
    const index = cacheSystem.tryGetIndex(indexId);
    if (!index) {
        return err(missingIndex(indexId, description));
    }
    return ok(index);
}

function requireArchive(index: CacheIndex, archiveId: number, description: string): Result<Archive, InitError> {
    const archive = index.tryGetArchive(archiveId);
    if (!archive) {
        return err(missingArchive(index.id, archiveId, description));
    }
    return ok(archive);
}

export function createLegacyLoaders(cacheInfo: CacheInfo, cacheSystem: CacheSystem): Loaders {
    const result = tryCreateLegacyLoaders(cacheInfo, cacheSystem);
    if (!result.ok) {
        throw new Error(initErrorToString(result.error));
    }
    return result.value;
}

export function tryCreateLegacyLoaders(cacheInfo: CacheInfo, cacheSystem: CacheSystem): Result<Loaders, InitError> {
    const configIndexResult = requireIndex(cacheSystem, LegacyIndexId.configs, "legacy configs");
    if (!configIndexResult.ok) {
        return configIndexResult;
    }
    const configIndex = configIndexResult.value;
    const configArchiveResult = requireArchive(configIndex, 0, "legacy config");
    if (!configArchiveResult.ok) {
        return configArchiveResult;
    }
    const configArchive = configArchiveResult.value;

    const mediaIndexResult = requireIndex(cacheSystem, LegacyIndexId.media, "legacy media");
    if (!mediaIndexResult.ok) {
        return mediaIndexResult;
    }
    const mediaArchiveResult = requireArchive(mediaIndexResult.value, 0, "legacy media");
    if (!mediaArchiveResult.ok) {
        return mediaArchiveResult;
    }
    const mediaArchive = mediaArchiveResult.value;

    const textureIndexResult = requireIndex(cacheSystem, LegacyIndexId.textures, "legacy textures");
    if (!textureIndexResult.ok) {
        return textureIndexResult;
    }
    const textureArchiveResult = requireArchive(textureIndexResult.value, 0, "legacy texture");
    if (!textureArchiveResult.ok) {
        return textureArchiveResult;
    }
    const textureArchive = textureArchiveResult.value;

    const modelIndexResult = requireIndex(cacheSystem, LegacyIndexId.models, "legacy models");
    if (!modelIndexResult.ok) {
        return modelIndexResult;
    }
    const modelArchiveResult = requireArchive(modelIndexResult.value, 0, "legacy model");
    if (!modelArchiveResult.ok) {
        return modelArchiveResult;
    }
    const modelArchive = modelArchiveResult.value;

    const mapIndexResult = requireIndex(cacheSystem, LegacyIndexId.maps, "legacy maps");
    if (!mapIndexResult.ok) {
        return mapIndexResult;
    }
    const mapIndex = mapIndexResult.value;

    let floTypeLoader: OverlayFloorTypeLoader;
    let locTypeLoader: LocTypeLoader;
    let npcTypeLoader: NpcTypeLoader;
    let objTypeLoader: ObjTypeLoader;
    let seqTypeLoader: SeqTypeLoader;
    try {
        floTypeLoader = DatFloorTypeLoader.create(cacheInfo, configArchive);
        locTypeLoader = DatLocTypeLoader.create(cacheInfo, configArchive);
        npcTypeLoader = DatNpcTypeLoader.create(cacheInfo, configArchive);
        objTypeLoader = DatObjTypeLoader.create(cacheInfo, configArchive);
        seqTypeLoader = DatSeqTypeLoader.create(cacheInfo, configArchive);
    } catch (e) {
        return err(createFailed("legacy dat type loaders", e));
    }

    const textureLoader = new DatTextureLoader(textureArchive, [
        DatTextureLoader.WATER_DROPLETS_TEXTURE_ID,
        24,
    ]);

    let modelLoader: LegacyModelLoader;
    let seqFrameLoader: SeqFrameLoader;
    try {
        modelLoader = LegacyModelLoader.create(modelArchive);
        seqFrameLoader = LegacySeqFrameLoader.create(modelArchive);
    } catch (e) {
        return err(createFailed("legacy model/seq loaders", e));
    }

    return ok({
        underlayTypeLoader: floTypeLoader,
        overlayTypeLoader: floTypeLoader,

        varBitTypeLoader: new DummyVarBitTypeLoader(cacheInfo),

        locTypeLoader,
        npcTypeLoader,
        objTypeLoader,

        seqTypeLoader,

        basTypeLoader: new DummyBasTypeLoader(cacheInfo),

        questTypeLoader: undefined,

        textureLoader,

        modelLoader,
        seqFrameLoader,
        skeletalSeqLoader: undefined,

        mapFileLoader: new LegacyMapFileLoader(new CacheIndexMapBytesProvider(mapIndex), new Dat2MapIndex(mapIndex)),

        mapScenes: loadMapScenes(new ArchiveNamedBytesProvider(mediaArchive)),
        mapFunctions: loadMapFunctions(new ArchiveNamedBytesProvider(mediaArchive)),
    });
}
