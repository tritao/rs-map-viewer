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
import { err, ok, Result } from "../../util/Result";
import { errorToString } from "../../util/ErrorUtil";

function requireIndex(cacheSystem: CacheSystem, indexId: number, description: string): Result<CacheIndex, string> {
    const index = cacheSystem.tryGetIndex(indexId);
    if (!index) {
        return err(`Missing ${description} index (index=${indexId})`);
    }
    return ok(index);
}

function requireArchive(index: CacheIndex, archiveId: number, description: string): Result<Archive, string> {
    const archive = index.tryGetArchive(archiveId);
    if (!archive) {
        return err(`Missing ${description} archive (index=${index.id} archive=${archiveId})`);
    }
    return ok(archive);
}

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
    const result = tryCreateDatLoaders(cacheInfo, _cacheType, cacheSystem);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.value;
}

export function tryCreateDatLoaders(
    cacheInfo: CacheInfo,
    _cacheType: CacheType,
    cacheSystem: CacheSystem,
): Result<Loaders, string> {
    const configIndexResult = requireIndex(cacheSystem, DatIndexId.configs, "dat configs");
    if (!configIndexResult.ok) {
        return configIndexResult;
    }
    const configIndex = configIndexResult.value;

    const configArchiveResult = requireArchive(configIndex, DatConfigArchiveId.configs, "dat config");
    if (!configArchiveResult.ok) {
        return configArchiveResult;
    }
    const configArchive = configArchiveResult.value;

    const mediaArchiveResult = requireArchive(configIndex, DatConfigArchiveId.media, "dat media");
    if (!mediaArchiveResult.ok) {
        return mediaArchiveResult;
    }
    const mediaArchive = mediaArchiveResult.value;

    let floTypeLoader: OverlayFloorTypeLoader;
    try {
        floTypeLoader = DatFloorTypeLoader.create(cacheInfo, configArchive);
    } catch (e) {
        return err(`Failed creating floor type loader: ${errorToString(e)}`);
    }

    let varBitTypeLoader: VarBitTypeLoader;
    if (cacheInfo.revision < 254) {
        varBitTypeLoader = new DummyVarBitTypeLoader(cacheInfo);
    } else {
        try {
            varBitTypeLoader = DatVarBitTypeLoader.create(cacheInfo, configArchive);
        } catch (e) {
            return err(`Failed creating varbit loader: ${errorToString(e)}`);
        }
    }

    const textureArchiveResult = requireArchive(configIndex, DatConfigArchiveId.textures, "dat textures");
    if (!textureArchiveResult.ok) {
        return textureArchiveResult;
    }
    const textureArchive = textureArchiveResult.value;

    const animatedTextureIds = [DatTextureLoader.WATER_DROPLETS_TEXTURE_ID, 24];
    if (cacheInfo.revision > 289) {
        animatedTextureIds.push(34, 40);
    }
    const textureLoader = new DatTextureLoader(textureArchive, animatedTextureIds);

    const mapIndexResult = requireIndex(cacheSystem, DatIndexId.maps, "dat maps");
    if (!mapIndexResult.ok) {
        return mapIndexResult;
    }
    const mapIndex = mapIndexResult.value;

    const versionListArchiveResult = requireArchive(
        configIndex,
        DatConfigArchiveId.versionList,
        "dat version list",
    );
    if (!versionListArchiveResult.ok) {
        return versionListArchiveResult;
    }

    let mapFileIndex: DatMapFileIndex;
    try {
        mapFileIndex = DatMapFileIndex.create(versionListArchiveResult.value);
    } catch (e) {
        return err(`Failed creating map file index: ${errorToString(e)}`);
    }

    let locTypeLoader: LocTypeLoader;
    let npcTypeLoader: NpcTypeLoader;
    let objTypeLoader: ObjTypeLoader;
    let seqTypeLoader: SeqTypeLoader;
    try {
        locTypeLoader = DatLocTypeLoader.create(cacheInfo, configArchive);
        npcTypeLoader = DatNpcTypeLoader.create(cacheInfo, configArchive);
        objTypeLoader = DatObjTypeLoader.create(cacheInfo, configArchive);
        seqTypeLoader = DatSeqTypeLoader.create(cacheInfo, configArchive);
    } catch (e) {
        return err(`Failed creating dat type loaders: ${errorToString(e)}`);
    }

    const modelsIndexResult = requireIndex(cacheSystem, DatIndexId.models, "dat models");
    if (!modelsIndexResult.ok) {
        return modelsIndexResult;
    }
    const animationsIndexResult = requireIndex(cacheSystem, DatIndexId.animations, "dat animations");
    if (!animationsIndexResult.ok) {
        return animationsIndexResult;
    }

    return ok({
        underlayTypeLoader: floTypeLoader,
        overlayTypeLoader: floTypeLoader,

        varBitTypeLoader,

        locTypeLoader,
        npcTypeLoader,
        objTypeLoader,

        seqTypeLoader,

        basTypeLoader: new DummyBasTypeLoader(cacheInfo),

        questTypeLoader: undefined,

        textureLoader,

        modelLoader: IndexModelLoader.create(modelsIndexResult.value),
        seqFrameLoader: DatSeqFrameLoader.create(animationsIndexResult.value),
        skeletalSeqLoader: undefined,

        mapFileLoader: new MapFileLoader(mapIndex, mapFileIndex),

        mapScenes: loadMapScenes(mediaArchive),
        mapFunctions: loadMapFunctions(mediaArchive),
    });
}
