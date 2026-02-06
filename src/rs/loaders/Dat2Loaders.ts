import {
    ArchiveBasTypeLoader,
    BasTypeLoader,
    DummyBasTypeLoader,
} from "../config/bastype/BasTypeLoader";
import { GraphicsDefaults } from "../config/defaults/GraphicsDefaults";
import {
    ArchiveOverlayFloorTypeLoader,
    ArchiveUnderlayFloorTypeLoader,
    FloorTypeLoader,
    OverlayFloorTypeLoader,
} from "../config/floortype/FloorTypeLoader";
import {
    ArchiveLocTypeLoader,
    IndexLocTypeLoader,
    LocTypeLoader,
} from "../config/loctype/LocTypeLoader";
import { MapSceneTypeLoader } from "../config/mapscenetype/MapSceneTypeLoader";
import {
    ArchiveMapElementTypeLoader,
    MapElementTypeLoader,
} from "../config/meltype/MapElementTypeLoader";
import {
    ArchiveNpcTypeLoader,
    IndexNpcTypeLoader,
    NpcTypeLoader,
} from "../config/npctype/NpcTypeLoader";
import {
    ArchiveObjTypeLoader,
    IndexObjTypeLoader,
    ObjTypeLoader,
} from "../config/objtype/ObjTypeLoader";
import { ArchiveQuestTypeLoader, QuestTypeLoader } from "../config/questtype/QuestTypeLoader";
import {
    ArchiveSeqTypeLoader,
    IndexSeqTypeLoader,
    SeqTypeLoader,
} from "../config/seqtype/SeqTypeLoader";
import {
    ArchiveVarBitTypeLoader,
    IndexVarBitTypeLoader,
    VarBitTypeLoader,
} from "../config/vartype/bit/VarBitTypeLoader";
import { Dat2MapIndex, MapFileIndex } from "../map/MapFileIndex";
import { MapFileLoader } from "../map/MapFileLoader";
import { IndexModelLoader, ModelLoader } from "../model/ModelLoader";
import { Dat2SeqBaseLoader, SeqBaseLoader } from "../model/seq/SeqBaseLoader";
import { Dat2SeqFrameLoader, SeqFrameLoader } from "../model/seq/SeqFrameLoader";
import { ProviderSkeletalSeqLoader, SkeletalSeqLoader } from "../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../sprite/IndexedSprite";
import { SpriteLoader } from "../sprite/SpriteLoader";
import { OldProceduralTextureLoader } from "../texture/OldProceduralTextureLoader";
import { ProceduralTextureLoader } from "../texture/ProceduralTextureLoader";
import { SpriteTextureLoader } from "../texture/SpriteTextureLoader";
import { TextureLoader } from "../texture/TextureLoader";
import { IndexFileBytesProvider, IndexSmartFileBytesProvider, EnumeratingArchiveBytesProvider } from "../io/BytesProvider";
import { CacheIndex } from "../cache/CacheIndex";
import { CacheInfo, GameType } from "../cache/CacheInfo";
import { CacheSystem } from "../cache/CacheSystem";
import { CacheType } from "../cache/CacheType";
import { Archive } from "../cache/format/Archive";
import { Dat2ConfigArchiveId, OsrsConfigArchiveId, Rs2ConfigArchiveId } from "../cache/ConfigArchiveId";
import { Dat2IndexId, Rs2IndexId } from "../cache/IndexId";
import { CacheRules, computeCacheRules } from "./CacheRules";
import { Loaders } from "./Loaders";
import { IndexArchiveProvider } from "../io/ArchiveProvider";
import { err, ok, Result } from "../../util/Result";
import { createFailed, InitError, initErrorToString, missingArchive, missingIndex } from "./InitError";
import { ArchiveProviderGroupBytesProviderFactory } from "../io/GroupBytesProviderFactory";

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

function loadMapElementSprites(
    spriteIndex: CacheIndex,
    mapElementTypeLoader: MapElementTypeLoader,
): IndexedSprite[] {
    const spriteSource = new IndexFileBytesProvider(spriteIndex, 0);
    const mapElementSprites = new Array<IndexedSprite>(mapElementTypeLoader.getCount());
    for (let i = 0; i < mapElementSprites.length; i++) {
        const result = mapElementTypeLoader.tryLoad(i);
        if (!result.ok) {
            continue;
        }
        const mapElement = result.value;
        if (mapElement.spriteId === -1) {
            continue;
        }
        const sprite = SpriteLoader.loadIntoIndexedSpriteFromSource(spriteSource, mapElement.spriteId);
        if (sprite) {
            mapElementSprites[i] = sprite;
        }
    }
    return mapElementSprites;
}

export function createDat2Loaders(
    cacheInfo: CacheInfo,
    _cacheType: CacheType,
    cacheSystem: CacheSystem,
): Loaders {
    const result = tryCreateDat2Loaders(cacheInfo, _cacheType, cacheSystem);
    if (!result.ok) {
        throw new Error(initErrorToString(result.error));
    }
    return result.value;
}

export function tryCreateDat2Loaders(
    cacheInfo: CacheInfo,
    _cacheType: CacheType,
    cacheSystem: CacheSystem,
): Result<Loaders, InitError> {
    let rules: CacheRules;
    try {
        rules = computeCacheRules(cacheInfo, cacheSystem);
    } catch (e) {
        return err(createFailed("cache rules", e));
    }

    const configIndexResult = requireIndex(cacheSystem, Dat2IndexId.configs, "dat2 configs");
    if (!configIndexResult.ok) {
        return configIndexResult;
    }
    const configIndex = configIndexResult.value;

    const spriteIndexResult = requireIndex(cacheSystem, Dat2IndexId.sprites, "dat2 sprites");
    if (!spriteIndexResult.ok) {
        return spriteIndexResult;
    }
    const spriteIndex = spriteIndexResult.value;

    const spriteSource = new IndexFileBytesProvider(spriteIndex, 0);

    const underlaysArchiveResult = requireArchive(configIndex, Dat2ConfigArchiveId.underlays, "dat2 underlays");
    if (!underlaysArchiveResult.ok) {
        return underlaysArchiveResult;
    }
    const underlayTypeLoader = new ArchiveUnderlayFloorTypeLoader(cacheInfo, underlaysArchiveResult.value);

    const overlaysArchiveResult = requireArchive(configIndex, Dat2ConfigArchiveId.overlays, "dat2 overlays");
    if (!overlaysArchiveResult.ok) {
        return overlaysArchiveResult;
    }
    const overlayTypeLoader = new ArchiveOverlayFloorTypeLoader(cacheInfo, overlaysArchiveResult.value);

    let varBitTypeLoader: VarBitTypeLoader;
    if (rules.isIndexConfigs) {
        const varbitsIndexResult = requireIndex(cacheSystem, Rs2IndexId.varbits, "rs2 varbits");
        if (!varbitsIndexResult.ok) {
            return varbitsIndexResult;
        }
        varBitTypeLoader = new IndexVarBitTypeLoader(cacheInfo, varbitsIndexResult.value);
    } else {
        const varbitsArchiveResult = requireArchive(configIndex, Dat2ConfigArchiveId.varbits, "dat2 varbits");
        if (!varbitsArchiveResult.ok) {
            return varbitsArchiveResult;
        }
        varBitTypeLoader = new ArchiveVarBitTypeLoader(cacheInfo, varbitsArchiveResult.value);
    }

    let locTypeLoader: LocTypeLoader;
    if (rules.isIndexConfigs) {
        const locsIndexResult = requireIndex(cacheSystem, Rs2IndexId.locs, "rs2 locs");
        if (!locsIndexResult.ok) {
            return locsIndexResult;
        }
        locTypeLoader = new IndexLocTypeLoader(cacheInfo, locsIndexResult.value);
    } else {
        const locsArchiveResult = requireArchive(configIndex, Dat2ConfigArchiveId.locs, "dat2 locs");
        if (!locsArchiveResult.ok) {
            return locsArchiveResult;
        }
        locTypeLoader = new ArchiveLocTypeLoader(cacheInfo, locsArchiveResult.value);
    }

    let npcTypeLoader: NpcTypeLoader;
    if (rules.isIndexConfigs) {
        const npcsIndexResult = requireIndex(cacheSystem, Rs2IndexId.npcs, "rs2 npcs");
        if (!npcsIndexResult.ok) {
            return npcsIndexResult;
        }
        npcTypeLoader = new IndexNpcTypeLoader(cacheInfo, npcsIndexResult.value);
    } else {
        const npcsArchiveResult = requireArchive(configIndex, Dat2ConfigArchiveId.npcs, "dat2 npcs");
        if (!npcsArchiveResult.ok) {
            return npcsArchiveResult;
        }
        npcTypeLoader = new ArchiveNpcTypeLoader(cacheInfo, npcsArchiveResult.value);
    }

    let objTypeLoader: ObjTypeLoader;
    if (rules.isIndexConfigs) {
        const objsIndexResult = requireIndex(cacheSystem, Rs2IndexId.objs, "rs2 objs");
        if (!objsIndexResult.ok) {
            return objsIndexResult;
        }
        objTypeLoader = new IndexObjTypeLoader(cacheInfo, objsIndexResult.value);
    } else {
        const objsArchiveResult = requireArchive(configIndex, Dat2ConfigArchiveId.objs, "dat2 objs");
        if (!objsArchiveResult.ok) {
            return objsArchiveResult;
        }
        objTypeLoader = new ArchiveObjTypeLoader(cacheInfo, objsArchiveResult.value);
    }

    let seqTypeLoader: SeqTypeLoader;
    if (rules.isIndexConfigs) {
        const seqsIndexResult = requireIndex(cacheSystem, Rs2IndexId.seqs, "rs2 seqs");
        if (!seqsIndexResult.ok) {
            return seqsIndexResult;
        }
        seqTypeLoader = new IndexSeqTypeLoader(cacheInfo, seqsIndexResult.value);
    } else {
        const seqsArchiveResult = requireArchive(configIndex, Dat2ConfigArchiveId.seqs, "dat2 seqs");
        if (!seqsArchiveResult.ok) {
            return seqsArchiveResult;
        }
        seqTypeLoader = new ArchiveSeqTypeLoader(cacheInfo, seqsArchiveResult.value);
    }

    let basTypeLoader: BasTypeLoader;
    if (rules.bas.mode === "archive") {
        const basArchiveResult = requireArchive(configIndex, Rs2ConfigArchiveId.bas, "bas");
        if (!basArchiveResult.ok) {
            return basArchiveResult;
        }
        basTypeLoader = new ArchiveBasTypeLoader(cacheInfo, basArchiveResult.value);
    } else {
        basTypeLoader = new DummyBasTypeLoader(cacheInfo);
    }

    let questTypeLoader: QuestTypeLoader | undefined;
    if (rules.quests.mode === "archive") {
        const questsArchiveResult = requireArchive(configIndex, Rs2ConfigArchiveId.quests, "quests");
        if (!questsArchiveResult.ok) {
            return questsArchiveResult;
        }
        questTypeLoader = new ArchiveQuestTypeLoader(cacheInfo, questsArchiveResult.value);
    } else {
        questTypeLoader = undefined;
    }

    const textureIndexResult = requireIndex(cacheSystem, Dat2IndexId.textures, "dat2 textures");
    if (!textureIndexResult.ok) {
        return textureIndexResult;
    }
    const textureIndex = textureIndexResult.value;

    let textureLoader: TextureLoader;
    switch (rules.texture.mode) {
        case "sprite":
            textureLoader = SpriteTextureLoader.create(
                (() => {
                    const archive = textureIndex.tryGetArchive(0);
                    return archive ? new EnumeratingArchiveBytesProvider(archive) : undefined;
                })(),
                new IndexFileBytesProvider(spriteIndex, 0),
            );
            break;
        case "materials": {
            const materialsIndexResult = requireIndex(cacheSystem, Rs2IndexId.materials, "rs2 materials");
            if (!materialsIndexResult.ok) {
                return materialsIndexResult;
            }
            try {
                textureLoader = ProceduralTextureLoader.create(
                    rules.texture.hasAlphaMaterialField,
                    rules.texture.hasAlphaOperation,
                    materialsIndexResult.value,
                    new IndexSmartFileBytesProvider(textureIndex, null),
                    new IndexFileBytesProvider(spriteIndex, 0),
                );
            } catch (e) {
                return err(createFailed("procedural texture loader", e));
            }
            break;
        }
        case "old_procedural":
            textureLoader = OldProceduralTextureLoader.create(
                (() => {
                    const archive = textureIndex.tryGetArchive(0);
                    return archive ? new EnumeratingArchiveBytesProvider(archive) : undefined;
                })(),
                new IndexFileBytesProvider(spriteIndex, 0),
            );
            break;
    }

    const modelsIndexResult = requireIndex(cacheSystem, Dat2IndexId.models, "dat2 models");
    if (!modelsIndexResult.ok) {
        return modelsIndexResult;
    }
    const modelLoader: ModelLoader = IndexModelLoader.create(modelsIndexResult.value);

    const skeletonsIndexResult = requireIndex(cacheSystem, Dat2IndexId.skeletons, "dat2 skeletons");
    if (!skeletonsIndexResult.ok) {
        return skeletonsIndexResult;
    }
    const seqBaseLoader: SeqBaseLoader = Dat2SeqBaseLoader.create(cacheInfo, skeletonsIndexResult.value);

    const animationsIndexResult = requireIndex(cacheSystem, Dat2IndexId.animations, "dat2 animations");
    if (!animationsIndexResult.ok) {
        return animationsIndexResult;
    }
    const animationsArchiveProvider = new IndexArchiveProvider(animationsIndexResult.value);

    const groupFactory = new ArchiveProviderGroupBytesProviderFactory(animationsArchiveProvider);

    const seqFrameLoader: SeqFrameLoader = new Dat2SeqFrameLoader(cacheInfo, groupFactory, seqBaseLoader);
    const skeletalSeqLoader: SkeletalSeqLoader | undefined = new ProviderSkeletalSeqLoader(groupFactory, seqBaseLoader);

    const mapsIndexResult = requireIndex(cacheSystem, Dat2IndexId.maps, "dat2 maps");
    if (!mapsIndexResult.ok) {
        return mapsIndexResult;
    }
    const mapIndex = mapsIndexResult.value;
    const mapFileIndex: MapFileIndex = new Dat2MapIndex(mapIndex);
    const mapFileLoader: MapFileLoader = new MapFileLoader(mapIndex, mapFileIndex);

    let mapScenes: IndexedSprite[];
    if (rules.mapScenes.mode === "archive") {
        const mapScenesArchiveResult = requireArchive(configIndex, Rs2ConfigArchiveId.mapScenes, "map scenes");
        if (!mapScenesArchiveResult.ok) {
            return mapScenesArchiveResult;
        }
        const mapScenesArchive = mapScenesArchiveResult.value;
        const mapSceneTypeLoader = new MapSceneTypeLoader(cacheInfo, mapScenesArchive);

        const mapSceneSprites = new Array<IndexedSprite>(mapScenesArchive.lastFileId + 1);
        const mapScenesSource = new EnumeratingArchiveBytesProvider(mapScenesArchive);
        for (const id of mapScenesSource.getIds()) {
            const result = mapSceneTypeLoader.tryLoad(id);
            if (!result.ok) {
                continue;
            }
            const mapScene = result.value;
            if (mapScene.spriteId !== -1) {
                const sprite = SpriteLoader.loadIntoIndexedSpriteFromSource(spriteSource, mapScene.spriteId);
                if (sprite) {
                    mapSceneSprites[id] = sprite;
                }
            }
        }
        mapScenes = mapSceneSprites;
    } else {
        const graphicDefaultsResult = GraphicsDefaults.tryCreate(cacheInfo, cacheSystem);
        if (!graphicDefaultsResult.ok) {
            mapScenes = [];
        } else {
            const graphicDefaults = graphicDefaultsResult.value;
            if (graphicDefaults.mapScenes === -1) {
                mapScenes = [];
            } else {
            const sprites = SpriteLoader.loadIntoIndexedSpritesFromSource(spriteSource, graphicDefaults.mapScenes);
            if (!sprites) {
                mapScenes = [];
            } else {
                mapScenes = sprites;
            }
            }
        }
    }

    let mapFunctions: IndexedSprite[];
    switch (rules.mapFunctions.mode) {
        case "osrs_archive": {
            const mapElementArchiveResult = requireArchive(
                configIndex,
                OsrsConfigArchiveId.mapFunctions,
                "osrs map functions",
            );
            if (!mapElementArchiveResult.ok) {
                return mapElementArchiveResult;
            }
            const mapElementTypeLoader = new ArchiveMapElementTypeLoader(cacheInfo, mapElementArchiveResult.value);
            mapFunctions = loadMapElementSprites(spriteIndex, mapElementTypeLoader);
            break;
        }
        case "rs2_archive": {
            const mapElementArchiveResult = requireArchive(
                configIndex,
                Rs2ConfigArchiveId.mapFunctions,
                "rs2 map functions",
            );
            if (!mapElementArchiveResult.ok) {
                return mapElementArchiveResult;
            }
            const mapElementTypeLoader = new ArchiveMapElementTypeLoader(cacheInfo, mapElementArchiveResult.value);
            mapFunctions = loadMapElementSprites(spriteIndex, mapElementTypeLoader);
            break;
        }
        case "graphics_defaults": {
            const graphicDefaultsResult = GraphicsDefaults.tryCreate(cacheInfo, cacheSystem);
            if (!graphicDefaultsResult.ok) {
                mapFunctions = [];
                break;
            }

            const graphicDefaults = graphicDefaultsResult.value;
            if (graphicDefaults.mapFunctions === -1) {
                mapFunctions = [];
                break;
            }

            const sprites = SpriteLoader.loadIntoIndexedSpritesFromSource(spriteSource, graphicDefaults.mapFunctions);
            if (!sprites) {
                mapFunctions = [];
                break;
            }

            mapFunctions = sprites;
            break;
        }
    }

    return ok({
        underlayTypeLoader,
        overlayTypeLoader,

        varBitTypeLoader,

        locTypeLoader,
        npcTypeLoader,
        objTypeLoader,

        seqTypeLoader,

        basTypeLoader,

        questTypeLoader,

        textureLoader,

        modelLoader,
        seqFrameLoader,
        skeletalSeqLoader,

        mapFileLoader,

        mapScenes,
        mapFunctions,
    });
}
