import { Result, err, ok } from "../../../util/Result";
import { CacheIndex } from "../../cache/CacheIndex";
import { CacheInfo } from "../../cache/CacheInfo";
import { Archive } from "../../cache/format/Archive";
import { DecodeError, notFoundError, withDecodeErrorContext } from "../../core/DecodeError";
import { EnumeratingBytesProvider, IndexFileBytesProvider } from "../../io/BytesProvider";
import { EnumeratingGroupBytesProviderFactory } from "../../io/GroupBytesProviderFactory";
import { ArchiveNamedBytesProvider } from "../../io/NamedBytesProvider";
import { SeqBaseLoader } from "./SeqBaseLoader";
import {
    DatSeqFrame,
    LegacySeqFrame,
    SeqFrame,
    SeqFrameDecodeScratch,
} from "./SeqFrame";
import { SeqFrameMap } from "./SeqFrameMap";
import { decodeDat2SeqFrameMapFromSource } from "./decodeDat2SeqFrameMap";

export interface SeqFrameLoader {
    tryLoad(id: number): Result<SeqFrame, DecodeError>;
    tryGet(id: number): SeqFrame | undefined;
    tryLoadBytes(id: number): Uint8Array | undefined;

    clearCache(): void;
}

export type LegacySeqFrameFileBytes = Readonly<{
    baseHeadBytes: Uint8Array;
    baseTypeBytes: Uint8Array;
    baseLabelBytes: Uint8Array;
    frameHeadBytes: Uint8Array;
    frameTran1Bytes: Uint8Array;
    frameTran2Bytes: Uint8Array;
    frameDelBytes: Uint8Array;
}>;

export class LegacySeqFrameLoader implements SeqFrameLoader {
    static create(modelArchive: Archive): LegacySeqFrameLoader {
        const source = new ArchiveNamedBytesProvider(modelArchive);
        const baseHeadBytes = source.getBytes("base_head.dat");
        const baseTypeBytes = source.getBytes("base_type.dat");
        const baseLabelBytes = source.getBytes("base_label.dat");
        const frameHeadBytes = source.getBytes("frame_head.dat");
        const frameTran1Bytes = source.getBytes("frame_tran1.dat");
        const frameTran2Bytes = source.getBytes("frame_tran2.dat");
        const frameDelBytes = source.getBytes("frame_del.dat");
        if (
            !baseHeadBytes ||
            !baseTypeBytes ||
            !baseLabelBytes ||
            !frameHeadBytes ||
            !frameTran1Bytes ||
            !frameTran2Bytes ||
            !frameDelBytes
        ) {
            throw new Error(
                "Missing legacy seq-frame archive files (base_head/base_type/base_label/frame_head/frame_tran1/frame_tran2/frame_del)",
            );
        }
        const files: LegacySeqFrameFileBytes = {
            baseHeadBytes,
            baseTypeBytes,
            baseLabelBytes,
            frameHeadBytes,
            frameTran1Bytes,
            frameTran2Bytes,
            frameDelBytes,
        };
        return new LegacySeqFrameLoader(LegacySeqFrame.load(source), files);
    }

    constructor(
        readonly frames: SeqFrame[],
        private readonly legacyFiles: LegacySeqFrameFileBytes,
    ) {}

    tryGetLegacySeqFrameFileBytes(): LegacySeqFrameFileBytes {
        return this.legacyFiles;
    }

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

    tryLoadBytes(id: number): Uint8Array | undefined {
        // Legacy seq frames are provided to wasm as raw legacy frame/bas file bytes (not per-frame RSQF bytes).
        return undefined;
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
        const frameMapIdByFrameId: Map<number, number> = new Map();

        for (const frameMapId of frameMapSource.getIds()) {
            const bytes = frameMapSource.getBytes(frameMapId);
            if (!bytes) {
                continue;
            }
            if (!DatSeqFrame.tryLoadResult(frames, bytes, scratch, frameMapId, frameMapIdByFrameId).ok) {
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

        return new DatSeqFrameLoader(frames, frameMapSource, frameMapIdByFrameId);
    }

    constructor(
        readonly frames: Map<number, SeqFrame>,
        private readonly frameMapSource: EnumeratingBytesProvider,
        private readonly frameMapIdByFrameId: Map<number, number>,
    ) {}

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

    tryLoadBytes(id: number): Uint8Array | undefined {
        // Dat seq frames do not have stable per-frame raw bytes in the cache.
        // Runtime uses raw frame-map blobs instead (uploaded by map id).
        return undefined;
    }

    tryGetFrameMapBlobForFrameId(
        frameId: number,
    ): Readonly<{ frameMapId: number; bytes: Uint8Array }> | undefined {
        const mapId = this.frameMapIdByFrameId.get(frameId | 0);
        if (mapId === undefined) {
            return undefined;
        }
        const bytes = this.frameMapSource.getBytes(mapId);
        if (!bytes) {
            return undefined;
        }
        return { frameMapId: mapId | 0, bytes };
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
                e = withDecodeErrorContext(frameError, { id, typeName: "Dat2SeqFrame" });
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

    tryLoadBytes(id: number): Uint8Array | undefined {
        const frameMapId = id >> 16;
        const frameId = id & 0xffff;
        // Prefer raw cache bytes for wasm: C++ can decode dat2 seq frames directly.
        const group = this.animGroupSourceFactory.getGroup(frameMapId);
        return group?.getBytes(frameId) ?? undefined;
    }

    clearCache(): void {
        this.frameMaps.clear();
        this.baseLoader.clearCache();
        this.errors.clear();
    }
}
