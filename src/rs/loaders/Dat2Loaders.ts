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
import { IndexSeqBaseLoader, SeqBaseLoader } from "../model/seq/SeqBaseLoader";
import { Dat2SeqFrameLoader, SeqFrameLoader } from "../model/seq/SeqFrameLoader";
import { IndexSkeletalSeqLoader, SkeletalSeqLoader } from "../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../sprite/IndexedSprite";
import { SpriteLoader } from "../sprite/SpriteLoader";
import { OldProceduralTextureLoader } from "../texture/OldProceduralTextureLoader";
import { ProceduralTextureLoader } from "../texture/ProceduralTextureLoader";
import { SpriteTextureLoader } from "../texture/SpriteTextureLoader";
import { TextureLoader } from "../texture/TextureLoader";
import { CacheIndex } from "../cache/CacheIndex";
import { CacheInfo, GameType } from "../cache/CacheInfo";
import { CacheSystem } from "../cache/CacheSystem";
import { CacheType } from "../cache/CacheType";
import { Dat2ConfigArchiveId, OsrsConfigArchiveId, Rs2ConfigArchiveId } from "../cache/ConfigArchiveId";
import { Dat2IndexId, Rs2IndexId } from "../cache/IndexId";
import { CacheRules, computeCacheRules } from "./CacheRules";
import { Loaders } from "./Loaders";

function loadMapElementSprites(
    spriteIndex: CacheIndex,
    mapElementTypeLoader: MapElementTypeLoader,
): IndexedSprite[] {
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
        const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, mapElement.spriteId);
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

    const underlayTypeLoader = new ArchiveUnderlayFloorTypeLoader(
        cacheInfo,
        configIndex.getArchive(Dat2ConfigArchiveId.underlays),
    );
    const overlayTypeLoader = new ArchiveOverlayFloorTypeLoader(
        cacheInfo,
        configIndex.getArchive(Dat2ConfigArchiveId.overlays),
    );

    const varBitTypeLoader: VarBitTypeLoader = rules.isIndexConfigs
        ? new IndexVarBitTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.varbits))
        : new ArchiveVarBitTypeLoader(cacheInfo, configIndex.getArchive(Dat2ConfigArchiveId.varbits));

    const locTypeLoader: LocTypeLoader = rules.isIndexConfigs
        ? new IndexLocTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.locs))
        : new ArchiveLocTypeLoader(cacheInfo, configIndex.getArchive(Dat2ConfigArchiveId.locs));

    const npcTypeLoader: NpcTypeLoader = rules.isIndexConfigs
        ? new IndexNpcTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.npcs))
        : new ArchiveNpcTypeLoader(cacheInfo, configIndex.getArchive(Dat2ConfigArchiveId.npcs));

    const objTypeLoader: ObjTypeLoader = rules.isIndexConfigs
        ? new IndexObjTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.objs))
        : new ArchiveObjTypeLoader(cacheInfo, configIndex.getArchive(Dat2ConfigArchiveId.objs));

    const seqTypeLoader: SeqTypeLoader = rules.isIndexConfigs
        ? new IndexSeqTypeLoader(cacheInfo, cacheSystem.getIndex(Rs2IndexId.seqs))
        : new ArchiveSeqTypeLoader(cacheInfo, configIndex.getArchive(Dat2ConfigArchiveId.seqs));

    const basTypeLoader: BasTypeLoader =
        rules.bas.mode === "archive"
            ? new ArchiveBasTypeLoader(cacheInfo, configIndex.getArchive(Rs2ConfigArchiveId.bas))
            : new DummyBasTypeLoader(cacheInfo);

    const questTypeLoader: QuestTypeLoader | undefined =
        rules.quests.mode === "archive"
            ? new ArchiveQuestTypeLoader(cacheInfo, configIndex.getArchive(Rs2ConfigArchiveId.quests))
            : undefined;

    const textureIndex = cacheSystem.getIndex(Dat2IndexId.textures);
    const textureLoader: TextureLoader = (() => {
        switch (rules.texture.mode) {
            case "sprite":
                return SpriteTextureLoader.load(textureIndex, spriteIndex);
            case "materials": {
                const materialIndex = cacheSystem.getIndex(Rs2IndexId.materials);
                return ProceduralTextureLoader.load(
                    rules.texture.hasAlphaMaterialField,
                    rules.texture.hasAlphaOperation,
                    materialIndex,
                    textureIndex,
                    spriteIndex,
                );
            }
            case "old_procedural":
                return OldProceduralTextureLoader.load(textureIndex, spriteIndex);
        }
    })();

    const modelLoader: ModelLoader = new IndexModelLoader(cacheSystem.getIndex(Dat2IndexId.models));

    const seqBaseLoader: SeqBaseLoader = new IndexSeqBaseLoader(
        cacheInfo,
        cacheSystem.getIndex(Dat2IndexId.skeletons),
    );
    const animationsIndex = cacheSystem.getIndex(Dat2IndexId.animations);
    const seqFrameLoader: SeqFrameLoader = new Dat2SeqFrameLoader(cacheInfo, animationsIndex, seqBaseLoader);
    const skeletalSeqLoader: SkeletalSeqLoader | undefined = new IndexSkeletalSeqLoader(
        animationsIndex,
        seqBaseLoader,
    );

    const mapIndex = cacheSystem.getIndex(Dat2IndexId.maps);
    const mapFileIndex = new Dat2MapIndex(mapIndex);
    const mapFileLoader: MapFileLoader = new MapFileLoader(mapIndex, mapFileIndex);

    const mapScenes: IndexedSprite[] = (() => {
        if (rules.mapScenes.mode === "archive") {
            const mapScenesArchive = configIndex.getArchive(Rs2ConfigArchiveId.mapScenes);
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
                    const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, mapScene.spriteId);
                    if (sprite) {
                        mapSceneSprites[id] = sprite;
                    }
                }
            }
            return mapSceneSprites;
        }

        const graphicDefaults = GraphicsDefaults.load(cacheInfo, cacheSystem);
        if (graphicDefaults.mapScenes === -1) {
            return [];
        }
        const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, graphicDefaults.mapScenes);
        if (!sprites) {
            throw new Error("Failed to load map scenes");
        }
        return sprites;
    })();

    const mapFunctions: IndexedSprite[] = (() => {
        switch (rules.mapFunctions.mode) {
            case "osrs_archive": {
                const mapElementArchive = configIndex.getArchive(OsrsConfigArchiveId.mapFunctions);
                const mapElementTypeLoader = new ArchiveMapElementTypeLoader(cacheInfo, mapElementArchive);
                return loadMapElementSprites(spriteIndex, mapElementTypeLoader);
            }
            case "rs2_archive": {
                const mapElementArchive = configIndex.getArchive(Rs2ConfigArchiveId.mapFunctions);
                const mapElementTypeLoader = new ArchiveMapElementTypeLoader(cacheInfo, mapElementArchive);
                return loadMapElementSprites(spriteIndex, mapElementTypeLoader);
            }
            case "graphics_defaults": {
                const graphicDefaults = GraphicsDefaults.load(cacheInfo, cacheSystem);
                if (graphicDefaults.mapFunctions === -1) {
                    return [];
                }

                const sprites = SpriteLoader.loadIntoIndexedSprites(spriteIndex, graphicDefaults.mapFunctions);
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
