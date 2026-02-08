import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import { Archive } from "../../cache/format/Archive";
import { ArchiveBytesProvider } from "../../io/BytesProvider";
import { ArchiveTypeLoader, DatTypeLoader, IndexTypeLoader, TypeLoader } from "../TypeLoader";
import { SeqType } from "./SeqType";

export type SeqTypeLoader = TypeLoader<SeqType>;

export class DatSeqTypeLoader {
    static create(cacheInfo: CacheInfo, configArchive: Archive): SeqTypeLoader {
        return DatTypeLoader.create(SeqType, cacheInfo, configArchive, "seq");
    }
}

export class ArchiveSeqTypeLoader extends ArchiveTypeLoader<SeqType> implements SeqTypeLoader {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(SeqType, cacheInfo, new ArchiveBytesProvider(archive));
    }
}

export class IndexSeqTypeLoader extends IndexTypeLoader<SeqType> implements SeqTypeLoader {
    constructor(cacheInfo: CacheInfo, index: CacheIndex) {
        super(SeqType, cacheInfo, index, 7);
    }
}
