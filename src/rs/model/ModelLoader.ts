import { Archive } from "../cache/format/Archive";
import { CacheIndex } from "../cache/CacheIndex";
import { ByteBuffer } from "../io/ByteBuffer";
import { ModelData } from "./ModelData";

export interface ModelLoader {
    getModel(id: number): ModelData | undefined;
    getCount(): number;
}

export class IndexModelLoader implements ModelLoader {
    modelIndex: CacheIndex;

    constructor(modelIndex: CacheIndex) {
        this.modelIndex = modelIndex;
    }

    getCount(): number {
        return this.modelIndex.getArchiveCount()
    }

    getModel(id: number): ModelData | undefined {
        try {
            const file = this.modelIndex.getFile(id, 0);
            return (file && ModelData.decode(file.data)) ?? undefined;
        } catch (e) {
            console.error("Failed loading model file", id, e);
            return undefined;
        }
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
    head: ByteBuffer;
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

    count: number;

    metadatas: LegacyModelMetadata[];

    static load(modelArchive: Archive): LegacyModelLoader {
        return new LegacyModelLoader(modelArchive);
    }

    private constructor(modelArchive: Archive) {
        const requireBuffer = (name: string): ByteBuffer => {
            const file = modelArchive.getFileNamed(name);
            if (!file) {
                throw new Error(`Missing legacy model archive file: ${name}`);
            }
            return new ByteBuffer(file.data);
        };

        this.head = requireBuffer("ob_head.dat");
        this.face1 = requireBuffer("ob_face1.dat");
        this.face2 = requireBuffer("ob_face2.dat");
        this.face3 = requireBuffer("ob_face3.dat");
        this.face4 = requireBuffer("ob_face4.dat");
        this.face5 = requireBuffer("ob_face5.dat");
        this.point1 = requireBuffer("ob_point1.dat");
        this.point2 = requireBuffer("ob_point2.dat");
        this.point3 = requireBuffer("ob_point3.dat");
        this.point4 = requireBuffer("ob_point4.dat");
        this.point5 = requireBuffer("ob_point5.dat");
        this.vertex1 = requireBuffer("ob_vertex1.dat");
        this.vertex2 = requireBuffer("ob_vertex2.dat");
        this.axis = requireBuffer("ob_axis.dat");

        const count = (this.count = this.head.readUnsignedShort());

        this.metadatas = new Array(count + 100);

        let vertexTextureDataOffset = 0;
        let labelDataOffset = 0;
        let triangleColorDataOffset = 0;
        let triangleInfoDataOffset = 0;
        let trianglePriorityDataOffset = 0;
        let triangleAlphaDataOffset = 0;
        let triangleSkinDataOffset = 0;

        for (let i = 0; i < count; i++) {
            const index = this.head.readUnsignedShort();
            const meta = (this.metadatas[index] = new LegacyModelMetadata());
            meta.vertexCount = this.head.readUnsignedShort();
            meta.triangleCount = this.head.readUnsignedShort();
            meta.texturedTriangleCount = this.head.readUnsignedByte();
            meta.vertexFlagsOffset = this.point1.offset;
            meta.vertexXOffset = this.point2.offset;
            meta.vertexYOffset = this.point3.offset;
            meta.vertexZOffset = this.point4.offset;
            meta.faceVerticesOffset = this.vertex1.offset;
            meta.faceOrientationsOffset = this.vertex2.offset;
            const hasInfo = this.head.readUnsignedByte();
            const hasPriorities = this.head.readUnsignedByte();
            const hasAlpha = this.head.readUnsignedByte();
            const hasSkins = this.head.readUnsignedByte();
            const hasLabels = this.head.readUnsignedByte();
            for (let v = 0; v < meta.vertexCount; v++) {
                const flags = this.point1.readUnsignedByte();
                if ((flags & 0x1) !== 0) {
                    this.point2.readSmart2();
                }
                if ((flags & 0x2) !== 0) {
                    this.point3.readSmart2();
                }
                if ((flags & 0x4) !== 0) {
                    this.point4.readSmart2();
                }
            }

            for (let t = 0; t < meta.triangleCount; t++) {
                const type = this.vertex2.readUnsignedByte();
                if (type === 1) {
                    this.vertex1.readSmart2();
                    this.vertex1.readSmart2();
                }
                this.vertex1.readSmart2();
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

    getCount(): number {
        throw new Error("Method not implemented.");
    }

    getModel(id: number): ModelData | undefined {
        const meta = this.metadatas[id];
        if (!meta) {
            return undefined;
        }
        return ModelData.decodeLegacy(this, meta);
    }
}
