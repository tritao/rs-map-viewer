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
import { CacheLoaderFactory } from "./CacheLoaderFactory";

export function loadMapSprites(mediaArchive: Archive, name: string): IndexedSprite[] {
    // TODO: maybe there is a way to check how many sprites there are
    const sprites = new Array<IndexedSprite>();
    let i = 0;
    while (true) {
        try {
            sprites[i] = SpriteLoader.loadIndexedSpriteDat(mediaArchive, name, i);
            i++;
        } catch (e) {
            break;
        }
    }

    return sprites;
}

export function loadMapScenes(mediaArchive: Archive): IndexedSprite[] {
    return loadMapSprites(mediaArchive, "mapscene");
}

export function loadMapFunctions(mediaArchive: Archive): IndexedSprite[] {
    return loadMapSprites(mediaArchive, "mapfunction");
}

export class DatCacheLoaderFactory implements CacheLoaderFactory {
    configIndex: CacheIndex;
    configArchive: Archive;
    mediaArchive: Archive;

    floTypeLoader?: OverlayFloorTypeLoader;

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly cacheType: CacheType,
        readonly cacheSystem: CacheSystem,
    ) {
        this.configIndex = cacheSystem.getIndex(DatIndexId.configs);
        this.configArchive = this.configIndex.getArchive(DatConfigArchiveId.configs);
        this.mediaArchive = this.configIndex.getArchive(DatConfigArchiveId.media);
    }

    getFloTypeLoader(): OverlayFloorTypeLoader {
        if (!this.floTypeLoader) {
            this.floTypeLoader = DatFloorTypeLoader.load(this.cacheInfo, this.configArchive);
        }
        return this.floTypeLoader;
    }

    getUnderlayTypeLoader(): FloorTypeLoader {
        return this.getFloTypeLoader();
    }

    getOverlayTypeLoader(): OverlayFloorTypeLoader {
        return this.getFloTypeLoader();
    }

    getVarBitTypeLoader(): VarBitTypeLoader {
        if (this.cacheInfo.revision < 254) {
            return new DummyVarBitTypeLoader(this.cacheInfo);
        }
        return DatVarBitTypeLoader.load(this.cacheInfo, this.configArchive);
    }

    getLocTypeLoader(): LocTypeLoader {
        return DatLocTypeLoader.load(this.cacheInfo, this.configArchive);
    }

    getNpcTypeLoader(): NpcTypeLoader {
        return DatNpcTypeLoader.load(this.cacheInfo, this.configArchive);
    }

    getObjTypeLoader(): ObjTypeLoader {
        return DatObjTypeLoader.load(this.cacheInfo, this.configArchive);
    }

    getSeqTypeLoader(): SeqTypeLoader {
        return DatSeqTypeLoader.load(this.cacheInfo, this.configArchive);
    }

    getBasTypeLoader(): BasTypeLoader {
        return new DummyBasTypeLoader(this.cacheInfo);
    }

    getQuestTypeLoader(): QuestTypeLoader | undefined {
        return undefined;
    }

    getTextureLoader(): TextureLoader {
        const textureArchive = this.configIndex.getArchive(DatConfigArchiveId.textures);
        const animatedTextureIds = [DatTextureLoader.WATER_DROPLETS_TEXTURE_ID, 24];
        if (this.cacheInfo.revision > 289) {
            animatedTextureIds.push(34, 40);
        }
        return new DatTextureLoader(textureArchive, animatedTextureIds);
    }

    getModelLoader(): ModelLoader {
        const modelIndex = this.cacheSystem.getIndex(DatIndexId.models);
        return new IndexModelLoader(modelIndex);
    }

    getSeqFrameLoader(): SeqFrameLoader {
        const seqFrameIndex = this.cacheSystem.getIndex(DatIndexId.animations);
        return DatSeqFrameLoader.load(seqFrameIndex);
    }

    getSkeletalSeqLoader(): SkeletalSeqLoader | undefined {
        return undefined;
    }

    getMapFileLoader(): MapFileLoader {
        const mapIndex = this.cacheSystem.getIndex(DatIndexId.maps);
        const versionListArchive = this.configIndex.getArchive(DatConfigArchiveId.versionList);
        const mapFileIndex = DatMapFileIndex.load(versionListArchive);
        return new MapFileLoader(mapIndex, mapFileIndex);
    }

    getMapScenes(): IndexedSprite[] {
        return loadMapScenes(this.mediaArchive);
    }

    getMapFunctions(): IndexedSprite[] {
        return loadMapFunctions(this.mediaArchive);
    }
}
