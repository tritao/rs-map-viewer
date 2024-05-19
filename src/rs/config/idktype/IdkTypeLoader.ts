import { Archive } from "../../cache/Archive";
import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import { IdkType } from "./IdkType";
import { ArchiveTypeLoader, DatTypeLoader, IndexTypeLoader, TypeLoader } from "../TypeLoader";

export type IdkTypeLoader = TypeLoader<IdkType>;

export class DatIdkTypeLoader {
    static load(cacheInfo: CacheInfo, configArchive: Archive): IdkTypeLoader {
        return DatTypeLoader.load(IdkType, cacheInfo, configArchive, "idk");
    }
}

export class ArchiveIdkTypeLoader extends ArchiveTypeLoader<IdkType> implements IdkTypeLoader {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(IdkType, cacheInfo, archive);
    }
}

export class IndexIdkTypeLoader extends IndexTypeLoader<IdkType> implements IdkTypeLoader {
    constructor(cacheInfo: CacheInfo, index: CacheIndex) {
        super(IdkType, cacheInfo, index, 7);
    }
}
