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
    const frames: Array<SeqFrame | undefined> = new Array(archive.lastFileId);
    for (const file of archive.files) {
        const frame = Dat2SeqFrame.tryLoad(cacheInfo, baseLoader, file.data, scratch);
        if (frame) {
            frames[file.id] = frame;
        }
    }
    return new SeqFrameMap(frames);
}
