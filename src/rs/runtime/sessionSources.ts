import { Archive } from "../cache/format/Archive";
import { DatConfigArchiveId } from "../cache/ConfigArchiveId";
import { Dat2IndexId, DatIndexId } from "../cache/IndexId";
import { EnumeratingBytesProvider, IndexFileBytesProvider } from "../io/BytesProvider";
import { CacheSession } from "./createCacheSession";

export function tryGetDat2SpriteSource(session: CacheSession): EnumeratingBytesProvider | undefined {
    const index = session.tryGetIndex(Dat2IndexId.sprites);
    if (!index) {
        return undefined;
    }
    return new IndexFileBytesProvider(index, 0);
}

export function tryGetDatMediaArchive(session: CacheSession): Archive | undefined {
    const configIndex = session.tryGetIndex(DatIndexId.configs);
    if (!configIndex) {
        return undefined;
    }
    return configIndex.tryGetArchive(DatConfigArchiveId.media);
}

