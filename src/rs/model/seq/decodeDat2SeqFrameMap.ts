import { Archive } from "../../cache/format/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { SeqBaseLoader } from "./SeqBaseLoader";
import { Dat2SeqFrame, SeqFrame, SeqFrameDecodeScratch } from "./SeqFrame";
import { SeqFrameMap } from "./SeqFrameMap";

export function decodeDat2SeqFrameMapFromArchive(
    cacheInfo: CacheInfo,
    baseLoader: SeqBaseLoader,
    archive: Archive,
    scratch: SeqFrameDecodeScratch = new SeqFrameDecodeScratch(),
): SeqFrameMap {
    const frames: SeqFrame[] = new Array(archive.lastFileId);
    for (const file of archive.files) {
        frames[file.id] = Dat2SeqFrame.load(cacheInfo, baseLoader, file.data, scratch);
    }
    return new SeqFrameMap(frames);
}
