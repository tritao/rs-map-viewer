import { Archive } from "../../cache/format/Archive";
import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import { EnumeratingBytesProvider, IndexFileBytesProvider } from "../../io/BytesProvider";
import { ArchiveProvider } from "../../io/ArchiveProvider";
import { SeqBaseLoader } from "./SeqBaseLoader";
import { Dat2SeqFrame, DatSeqFrame, LegacySeqFrame, SeqFrame, SeqFrameDecodeScratch } from "./SeqFrame";
import { SeqFrameMap } from "./SeqFrameMap";
import { decodeDat2SeqFrameMapFromArchive } from "./decodeDat2SeqFrameMap";

export interface SeqFrameLoader {
    tryLoad(id: number): SeqFrame | undefined;

    clearCache(): void;
}

export class LegacySeqFrameLoader implements SeqFrameLoader {
    static create(modelArchive: Archive): LegacySeqFrameLoader {
        return new LegacySeqFrameLoader(LegacySeqFrame.load(modelArchive));
    }

    constructor(readonly frames: SeqFrame[]) {}

    tryLoad(id: number): SeqFrame | undefined {
        return this.frames[id];
    }

    clearCache(): void {}
}

export class DatSeqFrameLoader implements SeqFrameLoader {
    static create(frameMapIndex: CacheIndex): DatSeqFrameLoader {
        return DatSeqFrameLoader.createFromSource(new IndexFileBytesProvider(frameMapIndex, 0));
    }

    static createFromSource(frameMapSource: EnumeratingBytesProvider): DatSeqFrameLoader {
        const frames: Map<number, SeqFrame> = new Map();
        const scratch = new SeqFrameDecodeScratch();

        for (const frameMapId of frameMapSource.getIds()) {
            const bytes = frameMapSource.getBytes(frameMapId);
            if (!bytes) {
                continue;
            }
            if (!DatSeqFrame.tryLoad(frames, bytes, scratch)) {
                console.error("Failed loading frame map " + frameMapId);
            }
        }

        return new DatSeqFrameLoader(frames);
    }

    constructor(readonly frames: Map<number, SeqFrame>) {}

    tryLoad(id: number): SeqFrame | undefined {
        return this.frames.get(id);
    }

    clearCache(): void {}
}

export class Dat2SeqFrameLoader implements SeqFrameLoader {
    frameMaps: Map<number, SeqFrameMap> = new Map();
    private readonly errors: Set<number> = new Set();
    private readonly scratch = new SeqFrameDecodeScratch();

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly animArchiveProvider: ArchiveProvider,
        readonly baseLoader: SeqBaseLoader,
    ) {}

    // changed 610
    tryLoad(id: number): SeqFrame | undefined {
        if (this.errors.has(id)) {
            return undefined;
        }
        const frameMapId = id >> 16;
        const frameId = id & 0xffff;

        let frameMap = this.frameMaps.get(frameMapId);
        if (!frameMap) {
            const archive = this.animArchiveProvider.getArchive(frameMapId);
            if (!archive) {
                this.errors.add(id);
                return undefined;
            }

            frameMap = decodeDat2SeqFrameMapFromArchive(
                this.cacheInfo,
                this.baseLoader,
                archive,
                this.scratch,
            );
            this.frameMaps.set(frameMapId, frameMap);
        }

        const frame = frameMap.frames[frameId];
        if (!frame) {
            if (!this.errors.has(id)) {
                console.error("Failed decoding seq frame", id);
                this.errors.add(id);
            }
            return undefined;
        }
        return frame;
    }

    clearCache(): void {
        this.frameMaps.clear();
        this.baseLoader.clearCache();
        this.errors.clear();
    }
}
