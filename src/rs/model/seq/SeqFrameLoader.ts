import { Archive } from "../../cache/format/Archive";
import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import { CountedBytesProvider, IndexFileBytesProvider } from "../../io/BytesProvider";
import { SeqBaseLoader } from "./SeqBaseLoader";
import { Dat2SeqFrame, DatSeqFrame, LegacySeqFrame, SeqFrame, SeqFrameDecodeScratch } from "./SeqFrame";
import { SeqFrameMap } from "./SeqFrameMap";

export interface SeqFrameLoader {
    load(id: number): SeqFrame | undefined;

    clearCache(): void;
}

export class LegacySeqFrameLoader implements SeqFrameLoader {
    static create(modelArchive: Archive): LegacySeqFrameLoader {
        return new LegacySeqFrameLoader(LegacySeqFrame.load(modelArchive));
    }

    constructor(readonly frames: SeqFrame[]) {}

    load(id: number): SeqFrame | undefined {
        return this.frames[id];
    }

    clearCache(): void {}
}

export class DatSeqFrameLoader implements SeqFrameLoader {
    static create(frameMapIndex: CacheIndex): DatSeqFrameLoader {
        return DatSeqFrameLoader.createFromSource(new IndexFileBytesProvider(frameMapIndex, 0));
    }

    static createFromSource(frameMapSource: CountedBytesProvider): DatSeqFrameLoader {
        const frames: Map<number, SeqFrame> = new Map();
        const scratch = new SeqFrameDecodeScratch();

        for (let i = 0; i < frameMapSource.getCount(); i++) {
            try {
                const bytes = frameMapSource.getBytes(i);
                if (!bytes) {
                    continue;
                }
                DatSeqFrame.load(frames, bytes, scratch);
            } catch (e) {
                console.error("Failed loading frame map " + i, e);
            }
        }

        return new DatSeqFrameLoader(frames);
    }

    constructor(readonly frames: Map<number, SeqFrame>) {}

    load(id: number): SeqFrame | undefined {
        return this.frames.get(id);
    }

    clearCache(): void {}
}

export class Dat2SeqFrameLoader implements SeqFrameLoader {
    frameMaps: Map<number, SeqFrameMap> = new Map();

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly animIndex: CacheIndex,
        readonly baseLoader: SeqBaseLoader,
    ) {}

    // changed 610
    load(id: number): SeqFrame | undefined {
        const frameMapId = id >> 16;
        const frameId = id & 0xffff;

        let frameMap = this.frameMaps.get(frameMapId);
        if (!frameMap) {
            const archive = this.animIndex.getArchive(frameMapId);

            const frames: SeqFrame[] = new Array(archive.lastFileId);
            const scratch = new SeqFrameDecodeScratch();

            for (const file of archive.files) {
                frames[file.id] = Dat2SeqFrame.load(this.cacheInfo, this.baseLoader, file.data, scratch);
            }

            frameMap = new SeqFrameMap(frames);
            this.frameMaps.set(frameMapId, frameMap);
        }

        return frameMap.frames[frameId];
    }

    clearCache(): void {
        this.frameMaps.clear();
        this.baseLoader.clearCache();
    }
}
