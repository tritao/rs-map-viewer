import { Result, err, ok } from "../../../util/Result";
import { CacheInfo, GameType } from "../../cache/CacheInfo";
import { Archive } from "../../cache/format/Archive";
import { DecodeError, decodeFailedError } from "../../errors/DecodeError";
import { ByteBuffer } from "../../io/ByteBuffer";
import { ArchiveNamedBytesProvider, NamedBytesProvider } from "../../io/NamedBytesProvider";
import { SkeletalBase } from "../skeletal/SkeletalBase";
import { SeqTransformType } from "./SeqTransformType";

export class SeqBase {
    constructor(
        readonly id: number,
        readonly count: number,
        readonly types: SeqTransformType[],
        readonly transformActor: boolean[],
        readonly masks: Uint16Array,
        readonly labels: number[][],
        readonly skeletalBase?: SkeletalBase,
    ) {}
}

export class LegacySeqBase {
    static load(source: NamedBytesProvider): SeqBase[] {
        const headBytes = source.getBytes("base_head.dat");
        const typeBytes = source.getBytes("base_type.dat");
        const labelBytes = source.getBytes("base_label.dat");
        if (!headBytes || !typeBytes || !labelBytes) {
            throw new Error("Missing legacy base archive files (base_head/base_type/base_label)");
        }

        const head = new ByteBuffer(headBytes);
        const type = new ByteBuffer(typeBytes);
        const label = new ByteBuffer(labelBytes);

        const baseCount = head.readUnsignedShort();
        const lastBaseId = head.readUnsignedShort();

        const bases: SeqBase[] = Array.from(
            { length: lastBaseId + 1 },
            () => undefined as unknown as SeqBase,
        );
        for (let i = 0; i < baseCount; i++) {
            const id = head.readUnsignedShort();
            const count = head.readUnsignedByte();

            // const count = buf.readUnsignedByte();
            const types: SeqTransformType[] = Array.from(
                { length: count },
                () => 0 as SeqTransformType,
            );
            const transformActor: boolean[] = Array.from({ length: count }, () => true);
            const masks = new Uint16Array(count).fill(-1);
            const labels: number[][] = Array.from({ length: count }, () => []);

            for (let j = 0; j < count; j++) {
                types[j] = type.readUnsignedByte();

                const subCount = label.readUnsignedByte();
                labels[j] = Array.from({ length: subCount }, () => 0);
                for (let l = 0; l < subCount; l++) {
                    labels[j][l] = label.readUnsignedByte();
                }
            }

            bases[id] = new SeqBase(id, count, types, transformActor, masks, labels);
        }

        return bases;
    }

    static loadFromArchive(modelArchive: Archive): SeqBase[] {
        return LegacySeqBase.load(new ArchiveNamedBytesProvider(modelArchive));
    }
}

export class DatSeqBase {
    static load(buf: ByteBuffer): SeqBase {
        const count = buf.readUnsignedByte();
        const types: SeqTransformType[] = Array.from(
            { length: count },
            () => 0 as SeqTransformType,
        );
        const transformActor: boolean[] = Array.from({ length: count }, () => true);
        const masks = new Uint16Array(count).fill(-1);
        const labels: number[][] = Array.from({ length: count }, () => []);

        for (let i = 0; i < count; i++) {
            types[i] = buf.readUnsignedByte();
        }

        for (let i = 0; i < count; i++) {
            const subCount = buf.readUnsignedByte();
            labels[i] = Array.from({ length: subCount }, () => 0);
            for (let l = 0; l < subCount; l++) {
                labels[i][l] = buf.readUnsignedByte();
            }
        }

        return new SeqBase(-1, count, types, transformActor, masks, labels);
    }
}

export class Dat2SeqBase {
    static load(cacheInfo: CacheInfo, id: number, data: Uint8Array): SeqBase {
        const buf = new ByteBuffer(data);
        const count = buf.readUnsignedByte();
        const types: SeqTransformType[] = Array.from(
            { length: count },
            () => 0 as SeqTransformType,
        );
        const transformActor: boolean[] = Array.from({ length: count }, () => false);
        const masks = new Uint16Array(count);
        const labels: number[][] = Array.from({ length: count }, () => []);

        for (let i = 0; i < count; i++) {
            types[i] = buf.readUnsignedByte();
            if (types[i] === SeqTransformType.TYPE_6) {
                types[i] = SeqTransformType.ROTATE;
            }
        }

        if (cacheInfo.game === GameType.Runescape && cacheInfo.revision >= 481) {
            for (let i = 0; i < count; i++) {
                transformActor[i] = buf.readUnsignedByte() === 1;
            }
        } else {
            transformActor.fill(true);
        }

        if (cacheInfo.game === GameType.Runescape && cacheInfo.revision >= 530) {
            for (let i = 0; i < count; i++) {
                masks[i] = buf.readUnsignedShort();
            }
        } else {
            masks.fill(-1);
        }

        for (let i = 0; i < count; i++) {
            labels[i] = Array.from({ length: buf.readUnsignedByte() }, () => 0);
        }

        for (let i = 0; i < count; i++) {
            for (let l = 0; l < labels[i].length; l++) {
                labels[i][l] = buf.readUnsignedByte();
            }
        }

        let skeletalBase: SkeletalBase | undefined;
        if (buf.remaining > 0) {
            const boneCount = buf.readUnsignedShort();
            if (boneCount > 0) {
                skeletalBase = new SkeletalBase(buf, boneCount);
            }
        }
        return new SeqBase(id, count, types, transformActor, masks, labels, skeletalBase);
    }

    static tryLoad(cacheInfo: CacheInfo, id: number, data: Uint8Array): SeqBase | undefined {
        const result = Dat2SeqBase.tryLoadResult(cacheInfo, id, data);
        return result.ok ? result.value : undefined;
    }

    static tryLoadResult(
        cacheInfo: CacheInfo,
        id: number,
        data: Uint8Array,
    ): Result<SeqBase, DecodeError> {
        try {
            return ok(Dat2SeqBase.load(cacheInfo, id, data));
        } catch (cause) {
            return err(
                decodeFailedError({
                    typeName: "SeqBase",
                    id,
                    message: `SeqBase: failed decoding id=${id}`,
                    cause,
                }),
            );
        }
    }
}
