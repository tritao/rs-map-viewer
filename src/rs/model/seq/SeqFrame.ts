import { Archive } from "../../cache/format/Archive";
import { CacheInfo, GameType } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { DatSeqBase, LegacySeqBase, SeqBase } from "./SeqBase";
import { SeqBaseLoader } from "./SeqBaseLoader";
import { SeqTransformType } from "./SeqTransformType";

export class SeqFrameDecodeScratch {
    transformGroupCache: Int32Array = new Int32Array(500);
    transformXCache: Int32Array = new Int32Array(500);
    transformYCache: Int32Array = new Int32Array(500);
    transformZCache: Int32Array = new Int32Array(500);
    resetOriginGroupsCache: Int32Array = new Int32Array(500);

    ensureCapacity(size: number): void {
        if (this.transformGroupCache.length >= size) {
            return;
        }

        let nextSize = this.transformGroupCache.length;
        while (nextSize < size) {
            nextSize = Math.max(1, nextSize * 2);
        }

        const nextGroup = new Int32Array(nextSize);
        nextGroup.set(this.transformGroupCache);
        this.transformGroupCache = nextGroup;

        const nextX = new Int32Array(nextSize);
        nextX.set(this.transformXCache);
        this.transformXCache = nextX;

        const nextY = new Int32Array(nextSize);
        nextY.set(this.transformYCache);
        this.transformYCache = nextY;

        const nextZ = new Int32Array(nextSize);
        nextZ.set(this.transformZCache);
        this.transformZCache = nextZ;

        const nextReset = new Int32Array(nextSize);
        nextReset.set(this.resetOriginGroupsCache);
        this.resetOriginGroupsCache = nextReset;
    }
}

export class SeqFrame {
    constructor(
        readonly frameLength: number,
        readonly base: SeqBase,
        readonly transformCount: number,
        readonly transformGroups: number[],
        readonly transformX: number[],
        readonly transformY: number[],
        readonly transformZ: number[],
        readonly resetOriginGroups: number[],
        readonly hasAlphaTransform: boolean,
        readonly hasColorTransform: boolean = false,
    ) {}
}

export class LegacySeqFrame {
    static load(modelArchive: Archive, scratch: SeqFrameDecodeScratch = new SeqFrameDecodeScratch()): SeqFrame[] {
        const bases = LegacySeqBase.load(modelArchive);

        const headFile = modelArchive.getFileNamed("frame_head.dat");
        const tran1File = modelArchive.getFileNamed("frame_tran1.dat");
        const tran2File = modelArchive.getFileNamed("frame_tran2.dat");
        const delFile = modelArchive.getFileNamed("frame_del.dat");
        if (!headFile || !tran1File || !tran2File || !delFile) {
            throw new Error("Missing legacy frame archive files (frame_head/frame_tran1/frame_tran2/frame_del)");
        }

        const head = new ByteBuffer(headFile.data);
        const tran1 = new ByteBuffer(tran1File.data);
        const tran2 = new ByteBuffer(tran2File.data);
        const del = new ByteBuffer(delFile.data);

        const frameCount = head.readUnsignedShort();
        const lastFrameId = head.readUnsignedShort();

        const frames: SeqFrame[] = new Array(lastFrameId + 1);
        for (let f = 0; f < frameCount; f++) {
            const frameId = head.readUnsignedShort();

            const frameLength = del.readUnsignedByte();

            const baseId = head.readUnsignedShort();
            const base = bases[baseId];
            const count = head.readUnsignedByte();

            scratch.ensureCapacity(count);

            let transformCount = 0;
            let resetOriginGroup = -1;
            let lastResetOriginGroup = -1;

            let hasAlphaTransform = false;

            for (let i = 0; i < count; i++) {
                const type = base.types[i];

                if (type === SeqTransformType.ORIGIN) {
                    resetOriginGroup = i;
                }

                const flag = tran1.readUnsignedByte();
                if (flag === 0) {
                    continue;
                }

                if (type === SeqTransformType.ORIGIN) {
                    lastResetOriginGroup = i;
                }

                scratch.transformGroupCache[transformCount] = i;

                let defaultValue = 0;
                if (type === SeqTransformType.SCALE) {
                    defaultValue = 128;
                }

                if ((flag & 0x1) !== 0) {
                    scratch.transformXCache[transformCount] = tran2.readSmart2();
                } else {
                    scratch.transformXCache[transformCount] = defaultValue;
                }

                if ((flag & 0x2) !== 0) {
                    scratch.transformYCache[transformCount] = tran2.readSmart2();
                } else {
                    scratch.transformYCache[transformCount] = defaultValue;
                }

                if ((flag & 0x4) !== 0) {
                    scratch.transformZCache[transformCount] = tran2.readSmart2();
                } else {
                    scratch.transformZCache[transformCount] = defaultValue;
                }

                scratch.resetOriginGroupsCache[transformCount] = -1;
                if (
                    type === SeqTransformType.TRANSLATE ||
                    type === SeqTransformType.ROTATE ||
                    type === SeqTransformType.SCALE
                ) {
                    if (resetOriginGroup > lastResetOriginGroup) {
                        scratch.resetOriginGroupsCache[transformCount] = resetOriginGroup;
                        lastResetOriginGroup = resetOriginGroup;
                    }
                } else if (type === SeqTransformType.ALPHA) {
                    hasAlphaTransform = true;
                }
                transformCount++;
            }

            const transformGroups: number[] = new Array(transformCount);
            const transformX: number[] = new Array(transformCount);
            const transformY: number[] = new Array(transformCount);
            const transformZ: number[] = new Array(transformCount);
            const resetOriginGroups: number[] = new Array(transformCount);
            for (let i = 0; i < transformCount; i++) {
                transformGroups[i] = scratch.transformGroupCache[i];
                transformX[i] = scratch.transformXCache[i];
                transformY[i] = scratch.transformYCache[i];
                transformZ[i] = scratch.transformZCache[i];
                resetOriginGroups[i] = scratch.resetOriginGroupsCache[i];
            }

            frames[frameId] = new SeqFrame(
                frameLength,
                base,
                transformCount,
                transformGroups,
                transformX,
                transformY,
                transformZ,
                resetOriginGroups,
                hasAlphaTransform,
            );
        }

        return frames;
    }
}

export class DatSeqFrame {
    static tryLoad(
        frames: Map<number, SeqFrame>,
        data: Uint8Array,
        scratch: SeqFrameDecodeScratch = new SeqFrameDecodeScratch(),
    ): boolean {
        try {
            DatSeqFrame.load(frames, data, scratch);
            return true;
        } catch {
            return false;
        }
    }

    static load(
        frames: Map<number, SeqFrame>,
        data: Uint8Array,
        scratch: SeqFrameDecodeScratch = new SeqFrameDecodeScratch(),
    ): void {
        const footerBuffer = new ByteBuffer(data);

        footerBuffer.offset = data.length - 8;
        const frameMapOffset = footerBuffer.readUnsignedShort();
        const flagOffset = footerBuffer.readUnsignedShort();
        const transformOffset = footerBuffer.readUnsignedShort();
        const frameLengthOffset = footerBuffer.readUnsignedShort();
        let totalOffset = 0;

        const frameMapBuffer = new ByteBuffer(data);
        frameMapBuffer.offset = totalOffset;
        totalOffset += frameMapOffset + 2;

        const flagBuffer = new ByteBuffer(data);
        flagBuffer.offset = totalOffset;
        totalOffset += flagOffset;

        const transformBuffer = new ByteBuffer(data);
        transformBuffer.offset = totalOffset;
        totalOffset += transformOffset;

        const frameLengthBuffer = new ByteBuffer(data);
        frameLengthBuffer.offset = totalOffset;
        totalOffset += frameLengthOffset;

        const baseBuffer = new ByteBuffer(data);
        baseBuffer.offset = totalOffset;

        const base = DatSeqBase.load(baseBuffer);

        const frameCount = frameMapBuffer.readUnsignedShort();
        for (let f = 0; f < frameCount; f++) {
            const frameId = frameMapBuffer.readUnsignedShort();
            const frameLength = frameLengthBuffer.readUnsignedByte();
            const count = frameMapBuffer.readUnsignedByte();

            scratch.ensureCapacity(count);

            let transformCount = 0;
            let resetOriginGroup = -1;
            let lastResetOriginGroup = -1;

            let hasAlphaTransform = false;

            for (let i = 0; i < count; i++) {
                const type = base.types[i];

                if (type === SeqTransformType.ORIGIN) {
                    resetOriginGroup = i;
                }

                const flag = flagBuffer.readUnsignedByte();
                if (flag === 0) {
                    continue;
                }

                if (type === SeqTransformType.ORIGIN) {
                    lastResetOriginGroup = i;
                }

                scratch.transformGroupCache[transformCount] = i;

                let defaultValue = 0;
                if (type === SeqTransformType.SCALE) {
                    defaultValue = 128;
                }

                if ((flag & 0x1) !== 0) {
                    scratch.transformXCache[transformCount] = transformBuffer.readSmart2();
                } else {
                    scratch.transformXCache[transformCount] = defaultValue;
                }

                if ((flag & 0x2) !== 0) {
                    scratch.transformYCache[transformCount] = transformBuffer.readSmart2();
                } else {
                    scratch.transformYCache[transformCount] = defaultValue;
                }

                if ((flag & 0x4) !== 0) {
                    scratch.transformZCache[transformCount] = transformBuffer.readSmart2();
                } else {
                    scratch.transformZCache[transformCount] = defaultValue;
                }

                scratch.resetOriginGroupsCache[transformCount] = -1;
                if (
                    type === SeqTransformType.TRANSLATE ||
                    type === SeqTransformType.ROTATE ||
                    type === SeqTransformType.SCALE
                ) {
                    if (resetOriginGroup > lastResetOriginGroup) {
                        scratch.resetOriginGroupsCache[transformCount] = resetOriginGroup;
                        lastResetOriginGroup = resetOriginGroup;
                    }
                } else if (type === SeqTransformType.ALPHA) {
                    hasAlphaTransform = true;
                }
                transformCount++;
            }

            const transformGroups: number[] = new Array(transformCount);
            const transformX: number[] = new Array(transformCount);
            const transformY: number[] = new Array(transformCount);
            const transformZ: number[] = new Array(transformCount);
            const resetOriginGroups: number[] = new Array(transformCount);
            for (let i = 0; i < transformCount; i++) {
                transformGroups[i] = scratch.transformGroupCache[i];
                transformX[i] = scratch.transformXCache[i];
                transformY[i] = scratch.transformYCache[i];
                transformZ[i] = scratch.transformZCache[i];
                resetOriginGroups[i] = scratch.resetOriginGroupsCache[i];
            }

            frames.set(
                frameId,
                new SeqFrame(
                    frameLength,
                    base,
                    transformCount,
                    transformGroups,
                    transformX,
                    transformY,
                    transformZ,
                    resetOriginGroups,
                    hasAlphaTransform,
                ),
            );
        }
    }
}

export class Dat2SeqFrame {
    static tryLoad(
        cacheInfo: CacheInfo,
        baseLoader: SeqBaseLoader,
        data: Uint8Array,
        scratch: SeqFrameDecodeScratch = new SeqFrameDecodeScratch(),
    ): SeqFrame | undefined {
        try {
            const buf = new ByteBuffer(data);
            const dataBuf = new ByteBuffer(data);

            if (cacheInfo.game === GameType.Runescape && cacheInfo.revision >= 610) {
                buf.readUnsignedByte();
            }

            const baseId = buf.readUnsignedShort();

            const base = baseLoader.load(baseId);
            if (!base) {
                return undefined;
            }

            const count = buf.readUnsignedByte();

            scratch.ensureCapacity(count);

            dataBuf.offset = buf.offset + count;

            let transformCount = 0;
            let resetOriginGroup = -1;
            let lastResetOriginGroup = -1;

            let hasAlphaTransform = false;
            let hasColorTransform = false;

            for (let i = 0; i < count; i++) {
                const type = base.types[i];

                if (type === SeqTransformType.ORIGIN) {
                    resetOriginGroup = i;
                }

                const flag = buf.readUnsignedByte();
                if (flag === 0) {
                    continue;
                }

                if (type === SeqTransformType.ORIGIN) {
                    lastResetOriginGroup = i;
                }

                scratch.transformGroupCache[transformCount] = i;

                let defaultValue = 0;
                if (type === SeqTransformType.SCALE || type === SeqTransformType.TYPE_10) {
                    defaultValue = 128;
                }

                if ((flag & 0x1) !== 0) {
                    scratch.transformXCache[transformCount] = dataBuf.readSmart2();
                } else {
                    scratch.transformXCache[transformCount] = defaultValue;
                }

                if ((flag & 0x2) !== 0) {
                    scratch.transformYCache[transformCount] = dataBuf.readSmart2();
                } else {
                    scratch.transformYCache[transformCount] = defaultValue;
                }

                if ((flag & 0x4) !== 0) {
                    scratch.transformZCache[transformCount] = dataBuf.readSmart2();
                } else {
                    scratch.transformZCache[transformCount] = defaultValue;
                }

                if (cacheInfo.game === GameType.Runescape && cacheInfo.revision >= 610) {
                    if (type === SeqTransformType.ORIGIN || type === SeqTransformType.TRANSLATE) {
                        scratch.transformXCache[transformCount] >>= 2;
                        scratch.transformYCache[transformCount] >>= 2;
                        scratch.transformZCache[transformCount] >>= 2;
                    } else if (type === SeqTransformType.ROTATE) {
                        scratch.transformXCache[transformCount] >>= 4;
                        scratch.transformYCache[transformCount] >>= 4;
                        scratch.transformZCache[transformCount] >>= 4;
                    } else if (type === SeqTransformType.SCALE) {
                        // See original `load()` implementation.
                    }
                }

                scratch.resetOriginGroupsCache[transformCount] = -1;
                if (
                    type === SeqTransformType.TRANSLATE ||
                    type === SeqTransformType.ROTATE ||
                    type === SeqTransformType.SCALE
                ) {
                    if (resetOriginGroup > lastResetOriginGroup) {
                        scratch.resetOriginGroupsCache[transformCount] = resetOriginGroup;
                        lastResetOriginGroup = resetOriginGroup;
                    }
                } else if (type === SeqTransformType.ALPHA) {
                    hasAlphaTransform = true;
                } else if (type === SeqTransformType.LIGHT) {
                    hasColorTransform = true;
                }
                transformCount++;
            }

            if (count !== 0 && dataBuf.offset !== data.length) {
                return undefined;
            }

            const transformGroups: number[] = new Array(transformCount);
            const transformX: number[] = new Array(transformCount);
            const transformY: number[] = new Array(transformCount);
            const transformZ: number[] = new Array(transformCount);
            const resetOriginGroups: number[] = new Array(transformCount);
            for (let i = 0; i < transformCount; i++) {
                transformGroups[i] = scratch.transformGroupCache[i];
                transformX[i] = scratch.transformXCache[i];
                transformY[i] = scratch.transformYCache[i];
                transformZ[i] = scratch.transformZCache[i];
                resetOriginGroups[i] = scratch.resetOriginGroupsCache[i];
            }

            return new SeqFrame(
                0,
                base,
                transformCount,
                transformGroups,
                transformX,
                transformY,
                transformZ,
                resetOriginGroups,
                hasAlphaTransform,
                hasColorTransform,
            );
        } catch (e) {
            return undefined;
        }
    }

    static load(
        cacheInfo: CacheInfo,
        baseLoader: SeqBaseLoader,
        data: Uint8Array,
        scratch: SeqFrameDecodeScratch = new SeqFrameDecodeScratch(),
    ): SeqFrame {
        const decoded = this.tryLoad(cacheInfo, baseLoader, data, scratch);
        if (!decoded) {
            throw new Error("Failed decoding Dat2 seq frame");
        }
        return decoded;
    }
}
