import { CacheInfo } from "../../cache/CacheInfo";
import { Archive } from "../../cache/format/Archive";
import { EnumeratingBytesProvider, EnumeratingArchiveBytesProvider } from "../../io/BytesProvider";
import { SeqBaseLoader } from "./SeqBaseLoader";
import { Dat2SeqFrame, SeqFrame, SeqFrameDecodeScratch } from "./SeqFrame";
import { SeqFrameMap } from "./SeqFrameMap";

export function decodeDat2SeqFrameMapFromSource(
    cacheInfo: CacheInfo,
    baseLoader: SeqBaseLoader,
    source: EnumeratingBytesProvider,
    scratch: SeqFrameDecodeScratch = new SeqFrameDecodeScratch(),
): SeqFrameMap {
    const ids = source.getIds();
    let maxId = -1;
    for (let i = 0; i < ids.length; i++) {
        maxId = Math.max(maxId, ids[i]);
    }

    const frames: Array<SeqFrame | undefined> = new Array(maxId + 1);
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const bytes = source.getBytes(id);
        if (!bytes) {
            continue;
        }
        const frame = Dat2SeqFrame.tryLoad(cacheInfo, baseLoader, bytes, scratch);
        if (frame) {
            frames[id] = frame;
        }
    }
    return new SeqFrameMap(frames);
}

export function decodeDat2SeqFrameMapFromArchive(
    cacheInfo: CacheInfo,
    baseLoader: SeqBaseLoader,
    archive: Archive,
    scratch: SeqFrameDecodeScratch = new SeqFrameDecodeScratch(),
): SeqFrameMap {
    return decodeDat2SeqFrameMapFromSource(
        cacheInfo,
        baseLoader,
        new EnumeratingArchiveBytesProvider(archive),
        scratch,
    );
}
