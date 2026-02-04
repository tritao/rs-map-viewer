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
import { CacheLoaderFactory } from "./CacheLoaderFactory";
import { CacheRules, computeCacheRules } from "./CacheRules";

export class Dat2CacheLoaderFactory implements CacheLoaderFactory {
    readonly rules: CacheRules;

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly cacheType: CacheType,
        readonly cacheSystem: CacheSystem,
    ) {
        this.rules = computeCacheRules(cacheInfo, cacheSystem);
    }

    getUnderlayTypeLoader(): FloorTypeLoader {
        const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
        const underlaysArchive = configIndex.getArchive(Dat2ConfigArchiveId.underlays);
        return new ArchiveUnderlayFloorTypeLoader(this.cacheInfo, underlaysArchive);
    }

    getOverlayTypeLoader(): OverlayFloorTypeLoader {
        const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
        const overlaysArchive = configIndex.getArchive(Dat2ConfigArchiveId.overlays);
        return new ArchiveOverlayFloorTypeLoader(this.cacheInfo, overlaysArchive);
    }

    getVarBitTypeLoader(): VarBitTypeLoader {
        if (this.rules.isIndexConfigs) {
            const varbitsIndex = this.cacheSystem.getIndex(Rs2IndexId.varbits);
            return new IndexVarBitTypeLoader(this.cacheInfo, varbitsIndex);
        } else {
            const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
            const varbitsArchive = configIndex.getArchive(Dat2ConfigArchiveId.varbits);
            return new ArchiveVarBitTypeLoader(this.cacheInfo, varbitsArchive);
        }
    }

    getLocTypeLoader(): LocTypeLoader {
        if (this.rules.isIndexConfigs) {
            const locsIndex = this.cacheSystem.getIndex(Rs2IndexId.locs);
            return new IndexLocTypeLoader(this.cacheInfo, locsIndex);
        } else {
            const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
            const locsArchive = configIndex.getArchive(Dat2ConfigArchiveId.locs);
            return new ArchiveLocTypeLoader(this.cacheInfo, locsArchive);
        }
    }

    getNpcTypeLoader(): NpcTypeLoader {
        if (this.rules.isIndexConfigs) {
            const npcIndex = this.cacheSystem.getIndex(Rs2IndexId.npcs);
            return new IndexNpcTypeLoader(this.cacheInfo, npcIndex);
        } else {
            const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
            const npcsArchive = configIndex.getArchive(Dat2ConfigArchiveId.npcs);
            return new ArchiveNpcTypeLoader(this.cacheInfo, npcsArchive);
        }
    }

    getObjTypeLoader(): ObjTypeLoader {
        if (this.rules.isIndexConfigs) {
            const objIndex = this.cacheSystem.getIndex(Rs2IndexId.objs);
            return new IndexObjTypeLoader(this.cacheInfo, objIndex);
        } else {
            const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
            const objsArchive = configIndex.getArchive(Dat2ConfigArchiveId.objs);
            return new ArchiveObjTypeLoader(this.cacheInfo, objsArchive);
        }
    }

    getSeqTypeLoader(): SeqTypeLoader {
        if (this.rules.isIndexConfigs) {
            const seqIndex = this.cacheSystem.getIndex(Rs2IndexId.seqs);
            return new IndexSeqTypeLoader(this.cacheInfo, seqIndex);
        } else {
            const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
            const seqsArchive = configIndex.getArchive(Dat2ConfigArchiveId.seqs);
            return new ArchiveSeqTypeLoader(this.cacheInfo, seqsArchive);
        }
    }

    getBasTypeLoader(): BasTypeLoader {
        if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision >= 530) {
            const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
            try {
                const basArchive = configIndex.getArchive(Rs2ConfigArchiveId.bas);
                return new ArchiveBasTypeLoader(this.cacheInfo, basArchive);
            } catch (e) {
                console.error("Failed to load bastype archive", e);
            }
        }
        return new DummyBasTypeLoader(this.cacheInfo);
    }

    getQuestTypeLoader(): QuestTypeLoader | undefined {
        const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
        if (
            this.cacheInfo.game === GameType.Runescape &&
            configIndex.archiveExists(Rs2ConfigArchiveId.quests)
        ) {
            try {
                const questArchive = configIndex.getArchive(Rs2ConfigArchiveId.quests);
                return new ArchiveQuestTypeLoader(this.cacheInfo, questArchive);
            } catch (e) {
                console.error("Failed to load questtype archive", e);
            }
        }
        return undefined;
    }

    getTextureLoader(): TextureLoader {
        const textureIndex = this.cacheSystem.getIndex(Dat2IndexId.textures);
        const spriteIndex = this.cacheSystem.getIndex(Dat2IndexId.sprites);
        switch (this.rules.texture.mode) {
            case "sprite":
                return SpriteTextureLoader.load(textureIndex, spriteIndex);
            case "materials": {
                const materialIndex = this.cacheSystem.getIndex(Rs2IndexId.materials);
                return ProceduralTextureLoader.load(
                    this.rules.texture.hasAlphaMaterialField,
                    this.rules.texture.hasAlphaOperation,
                    materialIndex,
                    textureIndex,
                    spriteIndex,
                );
            }
            case "old_procedural":
                return OldProceduralTextureLoader.load(textureIndex, spriteIndex);
        }
    }

    getModelLoader(): ModelLoader {
        const modelIndex = this.cacheSystem.getIndex(Dat2IndexId.models);
        return new IndexModelLoader(modelIndex);
    }

    getSeqBaseLoader(): SeqBaseLoader {
        const index = this.cacheSystem.getIndex(Dat2IndexId.skeletons);
        return new IndexSeqBaseLoader(this.cacheInfo, index);
    }

    getSeqFrameLoader(): SeqFrameLoader {
        const index = this.cacheSystem.getIndex(Dat2IndexId.animations);
        return new Dat2SeqFrameLoader(this.cacheInfo, index, this.getSeqBaseLoader());
    }

    getSkeletalSeqLoader(): SkeletalSeqLoader | undefined {
        const index = this.cacheSystem.getIndex(Dat2IndexId.animations);
        return new IndexSkeletalSeqLoader(index, this.getSeqBaseLoader());
    }

    getMapFileLoader(): MapFileLoader {
        const mapIndex = this.cacheSystem.getIndex(Dat2IndexId.maps);
        const mapFileIndex = new Dat2MapIndex(mapIndex);
        return new MapFileLoader(mapIndex, mapFileIndex);
    }

    getMapScenes(): IndexedSprite[] {
        const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
        const spriteIndex = this.cacheSystem.getIndex(Dat2IndexId.sprites);

        if (
            this.cacheInfo.game === GameType.Runescape &&
            configIndex.archiveExists(Rs2ConfigArchiveId.mapScenes)
        ) {
            const mapScenesArchive = configIndex.getArchive(Rs2ConfigArchiveId.mapScenes);
            const mapSceneTypeLoader = new MapSceneTypeLoader(this.cacheInfo, mapScenesArchive);

            const mapSceneSprites = new Array<IndexedSprite>(mapScenesArchive.lastFileId);
            for (let i = 0; i < mapScenesArchive.fileIds.length; i++) {
                const id = mapScenesArchive.fileIds[i];
                const mapScene = mapSceneTypeLoader.load(id);
                if (mapScene.spriteId !== -1) {
                    const sprite = SpriteLoader.loadIntoIndexedSprite(spriteIndex, mapScene.spriteId);
                    if (sprite) {
                        mapSceneSprites[id] = sprite;
                    }
                }
            }

            return mapSceneSprites;
        } else {
            const graphicDefaults = GraphicsDefaults.load(this.cacheInfo, this.cacheSystem);
            if (graphicDefaults.mapScenes === -1) {
                return [];
            }
            const mapScenes = SpriteLoader.loadIntoIndexedSprites(
                spriteIndex,
                graphicDefaults.mapScenes,
            );
            if (!mapScenes) {
                throw new Error("Failed to load map scenes");
            }

            return mapScenes;
        }
    }

    loadMapElementSprites(
        spriteIndex: CacheIndex,
        mapElementTypeLoader: MapElementTypeLoader,
    ): IndexedSprite[] {
        const mapElementSprites = new Array<IndexedSprite>(mapElementTypeLoader.getCount());
        for (let i = 0; i < mapElementSprites.length; i++) {
            const mapElement = mapElementTypeLoader.load(i);
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

    getMapFunctions(): IndexedSprite[] {
        const configIndex = this.cacheSystem.getIndex(Dat2IndexId.configs);
        const spriteIndex = this.cacheSystem.getIndex(Dat2IndexId.sprites);

        if (
            this.cacheInfo.game === GameType.Oldschool &&
            configIndex.archiveExists(OsrsConfigArchiveId.mapFunctions)
        ) {
            const mapElementArchive = configIndex.getArchive(OsrsConfigArchiveId.mapFunctions);
            const mapElementTypeLoader = new ArchiveMapElementTypeLoader(
                this.cacheInfo,
                mapElementArchive,
            );

            return this.loadMapElementSprites(spriteIndex, mapElementTypeLoader);
        } else if (
            this.cacheInfo.game === GameType.Runescape &&
            configIndex.archiveExists(Rs2ConfigArchiveId.mapFunctions)
        ) {
            const mapElementArchive = configIndex.getArchive(Rs2ConfigArchiveId.mapFunctions);
            const mapElementTypeLoader = new ArchiveMapElementTypeLoader(
                this.cacheInfo,
                mapElementArchive,
            );

            return this.loadMapElementSprites(spriteIndex, mapElementTypeLoader);
        } else {
            const graphicDefaults = GraphicsDefaults.load(this.cacheInfo, this.cacheSystem);
            if (graphicDefaults.mapFunctions === -1) {
                return [];
            }

            const mapFunctions = SpriteLoader.loadIntoIndexedSprites(
                spriteIndex,
                graphicDefaults.mapFunctions,
            );

            if (!mapFunctions) {
                throw new Error("Failed to load map functions");
            }

            return mapFunctions;
        }
    }
}
