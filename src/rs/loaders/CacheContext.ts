import { CacheSystem } from "../cache/CacheSystem";
import { createCacheSystemFromFiles } from "../cache/platform/CacheStoreFromFiles";
import { BasTypeLoader } from "../config/bastype/BasTypeLoader";
import { LocTypeLoader } from "../config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../config/objtype/ObjTypeLoader";
import { SeqTypeLoader } from "../config/seqtype/SeqTypeLoader";
import { VarManager } from "../config/vartype/VarManager";
import { MapFileIndex } from "../map/MapFileIndex";
import { SeqFrameLoader } from "../model/seq/SeqFrameLoader";
import { TextureLoader } from "../texture/TextureLoader";
import { LoadedCache } from "../../util/Caches";
import { CompressionHandler } from "../compression/CompressionHandler";
import { createLoaders } from "./createLoaders";

export class CacheContext {
    // Cache
    cache: LoadedCache;
    cacheSystem!: CacheSystem;

    textureLoader!: TextureLoader;
    seqTypeLoader!: SeqTypeLoader;
    seqFrameLoader!: SeqFrameLoader;

    locTypeLoader!: LocTypeLoader;
    objTypeLoader!: ObjTypeLoader;
    npcTypeLoader!: NpcTypeLoader;

    basTypeLoader!: BasTypeLoader;

    varManager!: VarManager;

    mapFileIndex!: MapFileIndex;

    constructor(cache: LoadedCache, compressionHandler: CompressionHandler) {
        this.cache = cache;
        this.cacheSystem = createCacheSystemFromFiles(cache.type, cache.bundle, compressionHandler);
        const loaders = createLoaders(cache.info, this.cacheSystem);

        this.textureLoader = loaders.textureLoader;
        this.seqTypeLoader = loaders.seqTypeLoader;
        this.seqFrameLoader = loaders.seqFrameLoader;
        this.locTypeLoader = loaders.locTypeLoader;
        this.objTypeLoader = loaders.objTypeLoader;
        this.npcTypeLoader = loaders.npcTypeLoader;
        this.basTypeLoader = loaders.basTypeLoader;

        this.varManager = new VarManager(loaders.varBitTypeLoader);
        const questTypeLoader = loaders.questTypeLoader;
        if (questTypeLoader) {
            this.varManager.setQuestsCompleted(questTypeLoader);
        }

        const mapFileLoader = loaders.mapFileLoader;
        this.mapFileIndex = mapFileLoader.mapFileIndex;
    }
}
