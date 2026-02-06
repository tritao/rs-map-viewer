import { Archive } from "../../cache/format/Archive";
import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import {
    ArchiveTypeLoader,
    IndexTypeLoader,
    IndexedDatTypeLoader,
    TypeLoader,
} from "../TypeLoader";
import { ArchiveBytesProvider } from "../../io/BytesProvider";
import { LocType } from "./LocType";

export type LocTypeLoader = TypeLoader<LocType>;

export class DatLocTypeLoader {
    static create(cacheInfo: CacheInfo, configArchive: Archive): LocTypeLoader {
        return IndexedDatTypeLoader.create(LocType, cacheInfo, configArchive, "loc");
    }
}

export class ArchiveLocTypeLoader extends ArchiveTypeLoader<LocType> implements LocTypeLoader {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(LocType, cacheInfo, new ArchiveBytesProvider(archive));
    }
}

export class IndexLocTypeLoader extends IndexTypeLoader<LocType> implements LocTypeLoader {
    constructor(cacheInfo: CacheInfo, index: CacheIndex) {
        super(LocType, cacheInfo, index);
    }
}
