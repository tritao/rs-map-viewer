import { BIT_MASKS } from "../MathConstants";
import { Archive } from "../cache/format/Archive";
import { CacheIndex } from "../cache/CacheIndex";
import { CacheInfo } from "../cache/CacheInfo";
import { ByteBuffer } from "../io/ByteBuffer";
import { CountedBytesProvider } from "../io/BytesProvider";
import { NamedBytesProvider } from "../io/NamedBytesProvider";
import { DecodeError, decodeFailedError, notFoundError } from "../errors/DecodeError";
import { Result, err, ok } from "../../util/Result";
import { Type } from "./Type";
import { decodeTypeFromBytes } from "./decode/decodeType";

export interface TypeLoader<T> {
    tryLoad(id: number): Result<T, DecodeError>;

    getCount(): number;

    clearCache(): void;
}

export function loadOrNull<T>(loader: TypeLoader<T>, id: number): T | undefined {
    const result = loader.tryLoad(id);
    return result.ok ? result.value : undefined;
}

export function loadOrThrow<T>(loader: TypeLoader<T>, id: number): T {
    const result = loader.tryLoad(id);
    if (result.ok) {
        return result.value;
    }
    const e = result.error;
    const opcode = e.kind === "decode_failed" ? e.opcode : undefined;
    const offset = e.kind === "decode_failed" ? e.offset : undefined;
    throw new Error(
        `${e.typeName}: failed to load id=${e.id} (${e.kind})` +
            (opcode !== undefined ? ` opcode=${opcode}` : "") +
            (offset !== undefined ? ` offset=${offset}` : ""),
    );
}

export type TypeConstructor<T extends Type> = new (id: number, cacheInfo: CacheInfo) => T;

export class DummyTypeLoader<T extends Type> implements TypeLoader<T> {
    constructor(
        readonly cacheInfo: CacheInfo,
        readonly typeConstructor: TypeConstructor<T>,
    ) {}

    tryLoad(id: number): Result<T, DecodeError> {
        return ok(new this.typeConstructor(id, this.cacheInfo));
    }

    getCount(): number {
        return 0;
    }

    clearCache(): void {}
}

export abstract class BaseTypeLoader<T extends Type> implements TypeLoader<T> {
    // TODO: maybe don't cache by default
    cache: Map<number, T> = new Map();
    errors: Map<number, DecodeError> = new Map();

    constructor(
        readonly typeConstructor: TypeConstructor<T>,
        readonly cacheInfo: CacheInfo,
    ) {}

    abstract getData(id: number): Uint8Array | undefined;

    tryLoad(id: number): Result<T, DecodeError> {
        const cached = this.cache.get(id);
        if (cached) {
            return ok(cached);
        }
        const cachedError = this.errors.get(id);
        if (cachedError) {
            return err(cachedError);
        }

        const typeName = this.typeConstructor.name || "Type";

        let data: Uint8Array | undefined;
        try {
            data = this.getData(id);
        } catch (cause) {
            const e = decodeFailedError({
                typeName,
                id,
                message: `${typeName}: failed to obtain data for id=${id}`,
                cause,
            });
            this.errors.set(id, e);
            return err(e);
        }

        if (!data) {
            const e = notFoundError(typeName, id);
            this.errors.set(id, e);
            return err(e);
        }

        const decoded = decodeTypeFromBytes(this.typeConstructor, this.cacheInfo, id, data);
        if (!decoded.ok) {
            this.errors.set(id, decoded.error);
            return decoded;
        }

        this.cache.set(id, decoded.value);
        this.errors.delete(id);
        return decoded;
    }

    abstract getCount(): number;

    clearCache(): void {
        this.cache.clear();
        this.errors.clear();
    }
}

export class ArchiveTypeLoader<T extends Type> extends BaseTypeLoader<T> {
    constructor(
        readonly typeConstructor: TypeConstructor<T>,
        readonly cacheInfo: CacheInfo,
        readonly source: CountedBytesProvider,
    ) {
        super(typeConstructor, cacheInfo);
    }

    override getData(id: number): Uint8Array | undefined {
        return this.source.getBytes(id);
    }

    override getCount(): number {
        return this.source.getCount();
    }

    // Inherit BaseTypeLoader.tryLoad for caching + error handling.
}

export class IndexTypeLoader<T extends Type> extends BaseTypeLoader<T> {
    count: number;

    archives: Map<number, Archive> = new Map();

    constructor(
        readonly typeConstructor: new (id: number, cacheInfo: CacheInfo) => T,
        readonly cacheInfo: CacheInfo,
        readonly index: CacheIndex,
        readonly fileIdBits: number = 8,
    ) {
        super(typeConstructor, cacheInfo);
        const filesPerArchive = 1 << fileIdBits;
        const lastArchiveId = index.getLastArchiveId();
        this.count = lastArchiveId < 0 ? 0 : lastArchiveId * filesPerArchive + index.getFileCount(lastArchiveId);
    }

    override getData(id: number): Uint8Array | undefined {
        const archiveId = id >> this.fileIdBits;
        const fileId = id & BIT_MASKS[this.fileIdBits - 1];

        let archive = this.archives.get(archiveId);
        if (!archive) {
            archive = this.index.tryGetArchive(archiveId);
            if (!archive) {
                return undefined;
            }
            this.archives.set(archiveId, archive);
        }
        return archive.getFile(fileId)?.data;
    }

    override getCount(): number {
        return this.count;
    }

    override clearCache(): void {
        super.clearCache();
        this.archives.clear();
    }
}

export class DatTypeLoader<T extends Type> implements TypeLoader<T> {
    static create<T extends Type>(
        typeConstructor: TypeConstructor<T>,
        cacheInfo: CacheInfo,
        configArchive: Archive,
        name: string,
    ): DatTypeLoader<T> {
        const file = configArchive.getFileNamed(name + ".dat");
        if (!file) {
            throw new Error(name + ".dat not found");
        }
        const buffer = new ByteBuffer(file.data);

        const count = buffer.readUnsignedShort();
        const types = new Array<T>(count);
        for (let i = 0; i < count; i++) {
            const type = (types[i] = new typeConstructor(i, cacheInfo));
            type.decode(buffer);
            type.post();
        }

        return new DatTypeLoader(types);
    }

    constructor(readonly types: T[]) {}

    tryLoad(id: number): Result<T, DecodeError> {
        const type = this.types[id];
        if (!type) {
            return err(notFoundError("DatTypeLoader", id));
        }
        return ok(type);
    }

    getCount(): number {
        return this.types.length;
    }

    clearCache(): void {}
}

export class IndexedDatTypeLoader<T extends Type> extends BaseTypeLoader<T> {
    static create<T extends Type>(
        typeConstructor: TypeConstructor<T>,
        cacheInfo: CacheInfo,
        configArchive: Archive,
        name: string,
    ): IndexedDatTypeLoader<T> {
        const dataFile = configArchive.getFileNamed(name + ".dat");
        const indexFile = configArchive.getFileNamed(name + ".idx");
        if (!dataFile) {
            throw new Error(name + ".dat not found");
        }
        if (!indexFile) {
            throw new Error(name + ".idx not found");
        }
        return IndexedDatTypeLoader.createFromBytes(typeConstructor, cacheInfo, dataFile.data, indexFile.data, name);
    }

    static createFromNamedBytes<T extends Type>(
        typeConstructor: TypeConstructor<T>,
        cacheInfo: CacheInfo,
        source: NamedBytesProvider,
        name: string,
    ): IndexedDatTypeLoader<T> {
        const datBytes = source.getBytes(name + ".dat");
        if (!datBytes) {
            throw new Error(name + ".dat not found");
        }
        const idxBytes = source.getBytes(name + ".idx");
        if (!idxBytes) {
            throw new Error(name + ".idx not found");
        }
        return IndexedDatTypeLoader.createFromBytes(typeConstructor, cacheInfo, datBytes, idxBytes, name);
    }

    private static createFromBytes<T extends Type>(
        typeConstructor: TypeConstructor<T>,
        cacheInfo: CacheInfo,
        datBytes: Uint8Array,
        idxBytes: Uint8Array,
        _name: string,
    ): IndexedDatTypeLoader<T> {
        const indexBuffer = new ByteBuffer(idxBytes);
        const count = indexBuffer.readUnsignedShort();

        const dataOffsets = new Int32Array(count);
        const dataLengths = new Int32Array(count);

        // Data entries start after the leading u16 count.
        let offset = indexBuffer.offset;
        for (let i = 0; i < count; i++) {
            const length = indexBuffer.readUnsignedShort();
            dataOffsets[i] = offset;
            dataLengths[i] = length;
            offset += length;
        }

        return new IndexedDatTypeLoader(
            typeConstructor,
            cacheInfo,
            count,
            datBytes,
            dataOffsets,
            dataLengths,
        );
    }

    constructor(
        typeConstructor: TypeConstructor<T>,
        cacheInfo: CacheInfo,
        readonly count: number,
        readonly data: Uint8Array,
        readonly dataOffsets: Int32Array,
        readonly dataLengths: Int32Array,
    ) {
        super(typeConstructor, cacheInfo);
    }

    override getData(id: number): Uint8Array | undefined {
        if (id < 0 || id >= this.count) {
            return undefined;
        }
        const start = this.dataOffsets[id];
        const length = this.dataLengths[id];
        if (start < 0 || length < 0 || start + length > this.data.length) {
            return undefined;
        }
        return this.data.subarray(start, start + length);
    }

    getCount(): number {
        return this.count;
    }

    override clearCache(): void {
        super.clearCache();
    }
}
