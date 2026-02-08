import { Result, err, ok } from "../../util/Result";
import { CacheIndex } from "../cache/CacheIndex";
import { Archive } from "../cache/format/Archive";
import { DecodeError, decodeFailedError, notFoundError } from "../errors/DecodeError";
import { ByteBuffer } from "../io/ByteBuffer";
import { CountedBytesProvider, IndexFileBytesProvider } from "../io/BytesProvider";
import { ArchiveNamedBytesProvider, NamedBytesProvider } from "../io/NamedBytesProvider";
import { ModelData } from "./ModelData";

export interface ModelLoader {
    tryLoad(id: number): Result<ModelData, DecodeError>;
    tryGet(id: number): ModelData | undefined;
    getCount(): number;
    clearCache(): void;
}

export class IndexModelLoader implements ModelLoader {
    static create(modelIndex: CacheIndex): IndexModelLoader {
        return new IndexModelLoader(new IndexFileBytesProvider(modelIndex, 0));
    }

    constructor(readonly modelSource: CountedBytesProvider) {}

    private readonly errors: Map<number, DecodeError> = new Map();

    getCount(): number {
        return this.modelSource.getCount();
    }

    tryLoad(id: number): Result<ModelData, DecodeError> {
        const cachedError = this.errors.get(id);
        if (cachedError) {
            return err(cachedError);
        }

        const bytes = this.modelSource.getBytes(id);
        if (!bytes) {
            return err(notFoundError("ModelData", id));
        }

        try {
            return ok(ModelData.decode(bytes));
        } catch (cause) {
            const e = decodeFailedError({
                typeName: "ModelData",
                id,
                message: `ModelData: failed decoding id=${id}`,
                cause,
            });
            this.errors.set(id, e);
            return err(e);
        }
    }

    tryGet(id: number): ModelData | undefined {
        const result = this.tryLoad(id);
        return result.ok ? result.value : undefined;
    }

    clearCache(): void {
        this.errors.clear();
    }
}

export class LegacyModelMetadata {
    vertexCount: number = 0;
    triangleCount: number = 0;
    texturedTriangleCount: number = 0;
    vertexFlagsOffset: number = 0;
    vertexXOffset: number = 0;
    vertexYOffset: number = 0;
    vertexZOffset: number = 0;
    faceVerticesOffset: number = 0;
    faceOrientationsOffset: number = 0;
    faceColorsOffset: number = 0;
    faceInfosOffset: number = 0;
    facePrioritiesOffset: number = 0;
    faceAlphasOffset: number = 0;
    faceLabelsOffset: number = 0;
    vertexLabelsOffset: number = 0;
    faceTextureAxisOffset: number = 0;
}

export class LegacyModelLoader implements ModelLoader {
    readonly count: number;
    readonly metadatas: Array<LegacyModelMetadata | undefined>;

    private readonly face1Bytes: Uint8Array;
    private readonly face2Bytes: Uint8Array;
    private readonly face3Bytes: Uint8Array;
    private readonly face4Bytes: Uint8Array;
    private readonly face5Bytes: Uint8Array;
    private readonly point1Bytes: Uint8Array;
    private readonly point2Bytes: Uint8Array;
    private readonly point3Bytes: Uint8Array;
    private readonly point4Bytes: Uint8Array;
    private readonly point5Bytes: Uint8Array;
    private readonly vertex1Bytes: Uint8Array;
    private readonly vertex2Bytes: Uint8Array;
    private readonly axisBytes: Uint8Array;

    static create(modelArchive: Archive): LegacyModelLoader {
        return LegacyModelLoader.createFromSource(new ArchiveNamedBytesProvider(modelArchive));
    }

    static createFromSource(source: NamedBytesProvider): LegacyModelLoader {
        return new LegacyModelLoader(source);
    }

    private constructor(source: NamedBytesProvider) {
        const requireBytes = (name: string): Uint8Array => {
            const bytes = source.getBytes(name);
            if (!bytes) {
                throw new Error(`Missing legacy model archive file: ${name}`);
            }
            return bytes;
        };

        const headBytes = requireBytes("ob_head.dat");
        this.face1Bytes = requireBytes("ob_face1.dat");
        this.face2Bytes = requireBytes("ob_face2.dat");
        this.face3Bytes = requireBytes("ob_face3.dat");
        this.face4Bytes = requireBytes("ob_face4.dat");
        this.face5Bytes = requireBytes("ob_face5.dat");
        this.point1Bytes = requireBytes("ob_point1.dat");
        this.point2Bytes = requireBytes("ob_point2.dat");
        this.point3Bytes = requireBytes("ob_point3.dat");
        this.point4Bytes = requireBytes("ob_point4.dat");
        this.point5Bytes = requireBytes("ob_point5.dat");
        this.vertex1Bytes = requireBytes("ob_vertex1.dat");
        this.vertex2Bytes = requireBytes("ob_vertex2.dat");
        this.axisBytes = requireBytes("ob_axis.dat");

        // Decode metadata using local cursors. The loader must be re-entrant: runtime decode should not share mutable
        // offsets/cursors across calls (important for multi-threaded worker/session ports).
        const head = new ByteBuffer(headBytes);
        const point1 = new ByteBuffer(this.point1Bytes);
        const point2 = new ByteBuffer(this.point2Bytes);
        const point3 = new ByteBuffer(this.point3Bytes);
        const point4 = new ByteBuffer(this.point4Bytes);
        const vertex1 = new ByteBuffer(this.vertex1Bytes);
        const vertex2 = new ByteBuffer(this.vertex2Bytes);

        const count = (this.count = head.readUnsignedShort());

        this.metadatas = Array.from({ length: count + 100 }, () => undefined);

        let vertexTextureDataOffset = 0;
        let labelDataOffset = 0;
        let triangleColorDataOffset = 0;
        let triangleInfoDataOffset = 0;
        let trianglePriorityDataOffset = 0;
        let triangleAlphaDataOffset = 0;
        let triangleSkinDataOffset = 0;

        for (let i = 0; i < count; i++) {
            const index = head.readUnsignedShort();
            const meta = (this.metadatas[index] = new LegacyModelMetadata());
            meta.vertexCount = head.readUnsignedShort();
            meta.triangleCount = head.readUnsignedShort();
            meta.texturedTriangleCount = head.readUnsignedByte();
            meta.vertexFlagsOffset = point1.offset;
            meta.vertexXOffset = point2.offset;
            meta.vertexYOffset = point3.offset;
            meta.vertexZOffset = point4.offset;
            meta.faceVerticesOffset = vertex1.offset;
            meta.faceOrientationsOffset = vertex2.offset;
            const hasInfo = head.readUnsignedByte();
            const hasPriorities = head.readUnsignedByte();
            const hasAlpha = head.readUnsignedByte();
            const hasSkins = head.readUnsignedByte();
            const hasLabels = head.readUnsignedByte();
            for (let v = 0; v < meta.vertexCount; v++) {
                const flags = point1.readUnsignedByte();
                if ((flags & 0x1) !== 0) {
                    point2.readSmart2();
                }
                if ((flags & 0x2) !== 0) {
                    point3.readSmart2();
                }
                if ((flags & 0x4) !== 0) {
                    point4.readSmart2();
                }
            }

            for (let t = 0; t < meta.triangleCount; t++) {
                const type = vertex2.readUnsignedByte();
                if (type === 1) {
                    vertex1.readSmart2();
                    vertex1.readSmart2();
                }
                vertex1.readSmart2();
            }

            meta.faceColorsOffset = triangleColorDataOffset;
            triangleColorDataOffset += meta.triangleCount * 2;
            if (hasInfo === 1) {
                meta.faceInfosOffset = triangleInfoDataOffset;
                triangleInfoDataOffset += meta.triangleCount;
            } else {
                meta.faceInfosOffset = -1;
            }
            if (hasPriorities === 255) {
                meta.facePrioritiesOffset = trianglePriorityDataOffset;
                trianglePriorityDataOffset += meta.triangleCount;
            } else {
                meta.facePrioritiesOffset = -hasPriorities - 1;
            }
            if (hasAlpha === 1) {
                meta.faceAlphasOffset = triangleAlphaDataOffset;
                triangleAlphaDataOffset += meta.triangleCount;
            } else {
                meta.faceAlphasOffset = -1;
            }
            if (hasSkins === 1) {
                meta.faceLabelsOffset = triangleSkinDataOffset;
                triangleSkinDataOffset += meta.triangleCount;
            } else {
                meta.faceLabelsOffset = -1;
            }
            if (hasLabels === 1) {
                meta.vertexLabelsOffset = labelDataOffset;
                labelDataOffset += meta.vertexCount;
            } else {
                meta.vertexLabelsOffset = -1;
            }
            meta.faceTextureAxisOffset = vertexTextureDataOffset;
            vertexTextureDataOffset += meta.texturedTriangleCount;
        }
    }

    createDecodeBuffers(): {
        face1: ByteBuffer;
        face2: ByteBuffer;
        face3: ByteBuffer;
        face4: ByteBuffer;
        face5: ByteBuffer;
        point1: ByteBuffer;
        point2: ByteBuffer;
        point3: ByteBuffer;
        point4: ByteBuffer;
        point5: ByteBuffer;
        vertex1: ByteBuffer;
        vertex2: ByteBuffer;
        axis: ByteBuffer;
    } {
        return {
            face1: new ByteBuffer(this.face1Bytes),
            face2: new ByteBuffer(this.face2Bytes),
            face3: new ByteBuffer(this.face3Bytes),
            face4: new ByteBuffer(this.face4Bytes),
            face5: new ByteBuffer(this.face5Bytes),
            point1: new ByteBuffer(this.point1Bytes),
            point2: new ByteBuffer(this.point2Bytes),
            point3: new ByteBuffer(this.point3Bytes),
            point4: new ByteBuffer(this.point4Bytes),
            point5: new ByteBuffer(this.point5Bytes),
            vertex1: new ByteBuffer(this.vertex1Bytes),
            vertex2: new ByteBuffer(this.vertex2Bytes),
            axis: new ByteBuffer(this.axisBytes),
        };
    }

    getCount(): number {
        return this.count;
    }

    tryLoad(id: number): Result<ModelData, DecodeError> {
        const meta = this.metadatas[id];
        if (!meta) {
            return err(notFoundError("LegacyModelData", id));
        }
        try {
            return ok(ModelData.decodeLegacy(this, meta));
        } catch (cause) {
            return err(
                decodeFailedError({
                    typeName: "LegacyModelData",
                    id,
                    message: `LegacyModelData: failed decoding id=${id}`,
                    cause,
                }),
            );
        }
    }

    tryGet(id: number): ModelData | undefined {
        const result = this.tryLoad(id);
        return result.ok ? result.value : undefined;
    }

    clearCache(): void {}
}
