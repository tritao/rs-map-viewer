import { Result, err, ok } from "../../../util/Result";
import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import { Archive } from "../../cache/format/Archive";
import { DecodeError, notFoundError } from "../../errors/DecodeError";
import { EnumeratingBytesProvider, IndexFileBytesProvider } from "../../io/BytesProvider";
import { EnumeratingGroupBytesProviderFactory } from "../../io/GroupBytesProviderFactory";
import { SeqBaseLoader } from "./SeqBaseLoader";
import { DatSeqFrame, LegacySeqFrame, SeqFrame, SeqFrameDecodeScratch } from "./SeqFrame";
import { SeqFrameMap } from "./SeqFrameMap";
import { decodeDat2SeqFrameMapFromSource } from "./decodeDat2SeqFrameMap";

export interface SeqFrameLoader {
    tryLoad(id: number): Result<SeqFrame, DecodeError>;
    tryGet(id: number): SeqFrame | undefined;

    clearCache(): void;
}

export class LegacySeqFrameLoader implements SeqFrameLoader {
    static create(modelArchive: Archive): LegacySeqFrameLoader {
        return new LegacySeqFrameLoader(LegacySeqFrame.loadFromArchive(modelArchive));
    }

    constructor(readonly frames: SeqFrame[]) {}

    tryLoad(id: number): Result<SeqFrame, DecodeError> {
        const frame = this.frames[id];
        if (!frame) {
            return err(notFoundError("LegacySeqFrame", id));
        }
        return ok(frame);
    }

    tryGet(id: number): SeqFrame | undefined {
        const result = this.tryLoad(id);
        return result.ok ? result.value : undefined;
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
        const failedFrameMapIds: number[] = [];

        for (const frameMapId of frameMapSource.getIds()) {
            const bytes = frameMapSource.getBytes(frameMapId);
            if (!bytes) {
                continue;
            }
            if (!DatSeqFrame.tryLoadResult(frames, bytes, scratch, frameMapId).ok) {
                failedFrameMapIds.push(frameMapId);
            }
        }

        if (failedFrameMapIds.length > 0) {
            const preview = failedFrameMapIds.slice(0, 10).join(", ");
            console.error(
                `DatSeqFrameLoader: failed loading ${failedFrameMapIds.length} frame maps` +
                    (failedFrameMapIds.length <= 10 ? ` (${preview})` : ` (first: ${preview})`),
            );
        }

        return new DatSeqFrameLoader(frames);
    }

    constructor(readonly frames: Map<number, SeqFrame>) {}

    tryLoad(id: number): Result<SeqFrame, DecodeError> {
        const frame = this.frames.get(id);
        if (!frame) {
            return err(notFoundError("DatSeqFrame", id));
        }
        return ok(frame);
    }

    tryGet(id: number): SeqFrame | undefined {
        const result = this.tryLoad(id);
        return result.ok ? result.value : undefined;
    }

    clearCache(): void {}
}

export class Dat2SeqFrameLoader implements SeqFrameLoader {
    frameMaps: Map<number, SeqFrameMap> = new Map();
    private readonly errors: Map<number, DecodeError> = new Map();
    private readonly scratch = new SeqFrameDecodeScratch();

    constructor(
        readonly cacheInfo: CacheInfo,
        readonly animGroupSourceFactory: EnumeratingGroupBytesProviderFactory,
        readonly baseLoader: SeqBaseLoader,
    ) {}

    // changed 610
    tryLoad(id: number): Result<SeqFrame, DecodeError> {
        const cachedError = this.errors.get(id);
        if (cachedError) {
            return err(cachedError);
        }
        const frameMapId = id >> 16;
        const frameId = id & 0xffff;

        let frameMap = this.frameMaps.get(frameMapId);
        if (!frameMap) {
            const source = this.animGroupSourceFactory.getEnumeratingGroup(frameMapId);
            if (!source) {
                const e = notFoundError("Dat2SeqFrame", id);
                this.errors.set(id, e);
                return err(e);
            }

            frameMap = decodeDat2SeqFrameMapFromSource(
                this.cacheInfo,
                this.baseLoader,
                source,
                this.scratch,
            );
            this.frameMaps.set(frameMapId, frameMap);
        }

        const frame = frameMap.frames[frameId];
        if (!frame) {
            const frameError = frameMap.errors.get(frameId);
            let e: DecodeError;
            if (frameError) {
                e =
                    frameError.id === id
                        ? frameError
                        : { ...frameError, id, typeName: frameError.typeName ?? "Dat2SeqFrame" };
            } else {
                e = notFoundError("Dat2SeqFrame", id);
            }
            this.errors.set(id, e);
            return err(e);
        }
        return ok(frame);
    }

    tryGet(id: number): SeqFrame | undefined {
        const result = this.tryLoad(id);
        return result.ok ? result.value : undefined;
    }

    clearCache(): void {
        this.frameMaps.clear();
        this.baseLoader.clearCache();
        this.errors.clear();
    }
}
