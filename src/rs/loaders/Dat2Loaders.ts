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
import { ArchiveSkeletalSeqLoader, SkeletalSeqLoader } from "../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../sprite/IndexedSprite";
import { SpriteLoader } from "../sprite/SpriteLoader";
import { OldProceduralTextureLoader } from "../texture/OldProceduralTextureLoader";
import { ProceduralTextureLoader } from "../texture/ProceduralTextureLoader";
import { SpriteTextureLoader } from "../texture/SpriteTextureLoader";
import { TextureLoader } from "../texture/TextureLoader";
import { IndexFileBytesProvider, IndexSmartFileBytesProvider } from "../io/BytesProvider";
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

function requireArchive(index: CacheIndex, archiveId: number, description: string): Archive {
    const archive = index.tryGetArchive(archiveId);
    if (!archive) {
        throw new Error(`Missing ${description} archive (index=${index.id} archive=${archiveId})`);
    }
    return archive;
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
    const rules: CacheRules = computeCacheRules(cacheInfo, cacheSystem);

    const configIndex = cacheSystem.getIndex(Dat2IndexId.configs);
    const spriteIndex = cacheSystem.getIndex(Dat2IndexId.sprites);
    const spriteSource = new IndexFileBytesProvider(spriteIndex, 0);

    const underlayTypeLoader = new ArchiveUnderlayFloorTypeLoader(
        cacheInfo,
        requireArchive(configIndex, Dat2ConfigArchiveId.underlays, "dat2 underlays"),
    );
    const overlayTypeLoader = new ArchiveOverlayFloorTypeLoader(
        cacheInfo,
        requireArchive(configIndex, Dat2ConfigArchiveId.overlays, "dat2 overlays"),
    );

    const varBitTypeLoader: VarBitTypeLoader = rules.isIndexConfigs
        ? new IndexVarBitTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.varbits))
        : new ArchiveVarBitTypeLoader(
              cacheInfo,
              requireArchive(configIndex, Dat2ConfigArchiveId.varbits, "dat2 varbits"),
          );

    const locTypeLoader: LocTypeLoader = rules.isIndexConfigs
        ? new IndexLocTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.locs))
        : new ArchiveLocTypeLoader(
              cacheInfo,
              requireArchive(configIndex, Dat2ConfigArchiveId.locs, "dat2 locs"),
          );

    const npcTypeLoader: NpcTypeLoader = rules.isIndexConfigs
        ? new IndexNpcTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.npcs))
        : new ArchiveNpcTypeLoader(
              cacheInfo,
              requireArchive(configIndex, Dat2ConfigArchiveId.npcs, "dat2 npcs"),
          );

    const objTypeLoader: ObjTypeLoader = rules.isIndexConfigs
        ? new IndexObjTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.objs))
        : new ArchiveObjTypeLoader(
              cacheInfo,
              requireArchive(configIndex, Dat2ConfigArchiveId.objs, "dat2 objs"),
          );

    const seqTypeLoader: SeqTypeLoader = rules.isIndexConfigs
        ? new IndexSeqTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.seqs))
        : new ArchiveSeqTypeLoader(
              cacheInfo,
              requireArchive(configIndex, Dat2ConfigArchiveId.seqs, "dat2 seqs"),
          );

    const basTypeLoader: BasTypeLoader =
        rules.bas.mode === "archive"
            ? new ArchiveBasTypeLoader(
                  cacheInfo,
                  requireArchive(configIndex, Rs2ConfigArchiveId.bas, "bas"),
              )
            : new DummyBasTypeLoader(cacheInfo);

    const questTypeLoader: QuestTypeLoader | undefined =
        rules.quests.mode === "archive"
            ? new ArchiveQuestTypeLoader(
                  cacheInfo,
                  requireArchive(configIndex, Rs2ConfigArchiveId.quests, "quests"),
              )
            : undefined;

    const textureIndex = cacheSystem.getIndex(Dat2IndexId.textures);
    const textureLoader: TextureLoader = (() => {
        switch (rules.texture.mode) {
            case "sprite":
                return SpriteTextureLoader.create(textureIndex.tryGetArchive(0), new IndexFileBytesProvider(spriteIndex, 0));
            case "materials": {
                const materialIndex = cacheSystem.getIndex(Rs2IndexId.materials);
                return ProceduralTextureLoader.create(
                    rules.texture.hasAlphaMaterialField,
                    rules.texture.hasAlphaOperation,
                    materialIndex,
                    new IndexSmartFileBytesProvider(textureIndex, null),
                    new IndexFileBytesProvider(spriteIndex, 0),
                );
            }
            case "old_procedural":
                return OldProceduralTextureLoader.create(textureIndex.tryGetArchive(0), new IndexFileBytesProvider(spriteIndex, 0));
        }
    })();

    const modelLoader: ModelLoader = IndexModelLoader.create(cacheSystem.getIndex(Dat2IndexId.models));

    const seqBaseLoader: SeqBaseLoader = Dat2SeqBaseLoader.create(
        cacheInfo,
        cacheSystem.getIndex(Dat2IndexId.skeletons),
    );
    const animationsIndex = cacheSystem.getIndex(Dat2IndexId.animations);
    const animationsArchiveProvider = new IndexArchiveProvider(animationsIndex);
    const seqFrameLoader: SeqFrameLoader = new Dat2SeqFrameLoader(
        cacheInfo,
        animationsArchiveProvider,
        seqBaseLoader,
    );
    const skeletalSeqLoader: SkeletalSeqLoader | undefined = new ArchiveSkeletalSeqLoader(
        animationsArchiveProvider,
        seqBaseLoader,
    );

    const mapIndex = cacheSystem.getIndex(Dat2IndexId.maps);
    const mapFileIndex = new Dat2MapIndex(mapIndex);
    const mapFileLoader: MapFileLoader = new MapFileLoader(mapIndex, mapFileIndex);

    const mapScenes: IndexedSprite[] = (() => {
        if (rules.mapScenes.mode === "archive") {
            const mapScenesArchive = requireArchive(configIndex, Rs2ConfigArchiveId.mapScenes, "map scenes");
            const mapSceneTypeLoader = new MapSceneTypeLoader(cacheInfo, mapScenesArchive);

            const mapSceneSprites = new Array<IndexedSprite>(mapScenesArchive.lastFileId + 1);
            for (let i = 0; i < mapScenesArchive.fileIds.length; i++) {
                const id = mapScenesArchive.fileIds[i];
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
            return mapSceneSprites;
        }

        const graphicDefaults = GraphicsDefaults.create(cacheInfo, cacheSystem);
        if (graphicDefaults.mapScenes === -1) {
            return [];
        }
        const sprites = SpriteLoader.loadIntoIndexedSpritesFromSource(spriteSource, graphicDefaults.mapScenes);
        if (!sprites) {
            throw new Error("Failed to load map scenes");
        }
        return sprites;
    })();

    const mapFunctions: IndexedSprite[] = (() => {
        switch (rules.mapFunctions.mode) {
            case "osrs_archive": {
                const mapElementArchive = requireArchive(
                    configIndex,
                    OsrsConfigArchiveId.mapFunctions,
                    "osrs map functions",
                );
                const mapElementTypeLoader = new ArchiveMapElementTypeLoader(cacheInfo, mapElementArchive);
                return loadMapElementSprites(spriteIndex, mapElementTypeLoader);
            }
            case "rs2_archive": {
                const mapElementArchive = requireArchive(
                    configIndex,
                    Rs2ConfigArchiveId.mapFunctions,
                    "rs2 map functions",
                );
                const mapElementTypeLoader = new ArchiveMapElementTypeLoader(cacheInfo, mapElementArchive);
                return loadMapElementSprites(spriteIndex, mapElementTypeLoader);
            }
            case "graphics_defaults": {
                const graphicDefaults = GraphicsDefaults.create(cacheInfo, cacheSystem);
                if (graphicDefaults.mapFunctions === -1) {
                    return [];
                }

                const sprites = SpriteLoader.loadIntoIndexedSpritesFromSource(
                    spriteSource,
                    graphicDefaults.mapFunctions,
                );
                if (!sprites) {
                    throw new Error("Failed to load map functions");
                }

                return sprites;
            }
        }
    })();

    return {
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
    };
}
