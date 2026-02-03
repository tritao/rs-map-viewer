import { COSINE, SINE } from "../MathConstants";
import { ByteBuffer } from "../io/ByteBuffer";
import { Entity } from "../core/Entity";
import { TextureLoader } from "../texture/TextureLoader";
import { FaceNormal } from "./FaceNormal";
import { ContourGroundType } from "./ContourGroundType";
import { Model } from "./Model";
import { LegacyModelLoader, LegacyModelMetadata } from "./ModelLoader";
import { computeTextureCoords } from "./TextureMapper";
import { VertexNormal } from "./VertexNormal";

export class MergeNormalsScratch {
    private stamp: number = 1;

    model0VertexStamp: Int32Array = new Int32Array(10000);
    model1VertexStamp: Int32Array = new Int32Array(10000);

    nextStamp(model0VertexCount: number, model1VertexCount: number): number {
        if (this.stamp >= 0x7ffffffe) {
            this.model0VertexStamp.fill(0);
            this.model1VertexStamp.fill(0);
            this.stamp = 1;
        } else {
            this.stamp++;
        }

        this.ensureCapacity0(model0VertexCount);
        this.ensureCapacity1(model1VertexCount);
        return this.stamp;
    }

    private ensureCapacity0(size: number): void {
        if (this.model0VertexStamp.length >= size) {
            return;
        }
        let nextSize = this.model0VertexStamp.length;
        while (nextSize < size) {
            nextSize = Math.max(1, nextSize * 2);
        }
        this.model0VertexStamp = new Int32Array(nextSize);
    }

    private ensureCapacity1(size: number): void {
        if (this.model1VertexStamp.length >= size) {
            return;
        }
        let nextSize = this.model1VertexStamp.length;
        while (nextSize < size) {
            nextSize = Math.max(1, nextSize * 2);
        }
        this.model1VertexStamp = new Int32Array(nextSize);
    }
}

export class ModelData extends Entity {
    version: number;

    verticesCount: number;
    usedVertexCount: number;

    verticesX!: Int32Array;
    verticesY!: Int32Array;
    verticesZ!: Int32Array;

    contourVerticesY?: Int32Array;

    faceCount: number;

    indices1!: Int32Array;
    indices2!: Int32Array;
    indices3!: Int32Array;

    faceRenderTypes?: Int8Array;
    faceRenderPriorities!: Int8Array;

    faceAlphas!: Int8Array;

    textureCoords?: Int8Array;

    faceColors!: Uint16Array;
    faceTextures?: Int16Array;

    priority: number;

    textureFaceCount!: number;
    textureRenderTypes!: Int8Array;

    textureMappingP!: Int16Array;
    textureMappingM!: Int16Array;
    textureMappingN!: Int16Array;

    textureScaleX!: Int32Array;
    textureScaleY!: Int32Array;
    textureScaleZ!: Int32Array;
    textureRotation!: Int8Array;
    textureDirection!: Int8Array;
    textureSpeed!: Int32Array;

    textureTransU!: Int32Array;
    textureTransV!: Int32Array;

    vertexSkins?: Int32Array;
    faceSkins?: Int32Array;

    vertexLabels!: Int32Array[];
    faceLabels!: Int32Array[];

    animMayaGroups!: Int32Array[];
    animMayaScales!: Int32Array[];

    faceNormals?: FaceNormal[];
    normals?: VertexNormal[];
    mergedNormals?: VertexNormal[];

    ambient!: number;
    contrast!: number;

    isBoundsCalculated: boolean;

    minHeight!: number;

    minX!: number;
    maxX!: number;

    minY!: number;
    maxY!: number;

    minZ!: number;
    maxZ!: number;

    static merge(models: ModelData[], count: number): ModelData {
        const model = new ModelData();
        model.merge(models, count);
        return model;
    }

    static decode(data: Int8Array): ModelData {
        const model = new ModelData();
        model.decode(data);
        return model;
    }

    static decodeLegacy(loader: LegacyModelLoader, meta: LegacyModelMetadata): ModelData {
        const model = new ModelData();
        model.decodeLegacy(loader, meta);
        return model;
    }

    static copyFrom(
        model: ModelData,
        shallowIndices: boolean,
        shallowVertices: boolean,
        shallowColors: boolean,
        shallowTextures: boolean,
    ): ModelData {
        const copy = new ModelData();
        copy.copyFrom(model, shallowIndices, shallowVertices, shallowColors, shallowTextures);
        return copy;
    }

    // TODO: replace with the one from ColorUtil
    static adjustLightness(hsl: number, lightness: number): number {
        lightness = ((hsl & 127) * lightness) >> 7;
        if (lightness < 2) {
            lightness = 2;
        } else if (lightness > 126) {
            lightness = 126;
        }

        return (hsl & 0xff80) + lightness;
    }

    static clampLightness(lightness: number): number {
        if (lightness < 2) {
            lightness = 2;
        } else if (lightness > 126) {
            lightness = 126;
        }
        return lightness | 0;
    }

    static mergeNormals(
        model0: ModelData,
        model1: ModelData,
        offsetX: number,
        offsetY: number,
        offsetZ: number,
        hideOccludedFaces: boolean,
        scratch: MergeNormalsScratch,
    ): void {
        model0.calculateBounds();
        model0.calculateVertexNormals();
        model1.calculateBounds();
        model1.calculateVertexNormals();

        if (!model0.normals || !model1.normals) {
            return;
        }

        const stamp = scratch.nextStamp(
            Math.max(model0.usedVertexCount, model0.verticesCount),
            Math.max(model1.usedVertexCount, model1.verticesCount),
        );
        const model0VertexStamp = scratch.model0VertexStamp;
        const model1VertexStamp = scratch.model1VertexStamp;

        const verticesY0 = model0.contourVerticesY || model0.verticesY;
        const verticesY1 = model1.contourVerticesY || model1.verticesY;

        let mergedCount = 0;

        for (let v0 = 0; v0 < model0.usedVertexCount; v0++) {
            const normal0 = model0.normals[v0];
            if (normal0.magnitude === 0) {
                continue;
            }
            const y = verticesY0[v0] - offsetY;
            if (y > model1.minHeight) {
                continue;
            }
            const x = model0.verticesX[v0] - offsetX;
            if (x < model1.minX || x > model1.maxX) {
                continue;
            }
            const z = model0.verticesZ[v0] - offsetZ;
            if (z < model1.minZ || z > model1.maxZ) {
                continue;
            }

            for (let v1 = 0; v1 < model1.usedVertexCount; v1++) {
                const normal1 = model1.normals[v1];
                if (
                    x !== model1.verticesX[v1] ||
                    z !== model1.verticesZ[v1] ||
                    y !== verticesY1[v1] ||
                    normal1.magnitude === 0
                ) {
                    continue;
                }

                if (!model0.mergedNormals) {
                    model0.mergedNormals = new Array(model0.usedVertexCount);
                }
                if (!model1.mergedNormals) {
                    model1.mergedNormals = new Array(model1.usedVertexCount);
                }

                let mergedNormal0 = model0.mergedNormals[v0];
                if (!mergedNormal0) {
                    mergedNormal0 = model0.mergedNormals[v0] = VertexNormal.copy(normal0);
                }
                let mergedNormal1 = model1.mergedNormals[v1];
                if (!mergedNormal1) {
                    mergedNormal1 = model1.mergedNormals[v1] = VertexNormal.copy(normal1);
                }

                mergedNormal0.x += normal1.x;
                mergedNormal0.y += normal1.y;
                mergedNormal0.z += normal1.z;
                mergedNormal0.magnitude += normal1.magnitude;
                mergedNormal1.x += normal0.x;
                mergedNormal1.y += normal0.y;
                mergedNormal1.z += normal0.z;
                mergedNormal1.magnitude += normal0.magnitude;

                mergedCount++;

                model0VertexStamp[v0] = stamp;
                model1VertexStamp[v1] = stamp;
            }
        }

        if (mergedCount >= 3 && hideOccludedFaces) {
            for (let i = 0; i < model0.faceCount; i++) {
                if (
                    model0VertexStamp[model0.indices1[i]] === stamp &&
                    model0VertexStamp[model0.indices2[i]] === stamp &&
                    model0VertexStamp[model0.indices3[i]] === stamp
                ) {
                    if (!model0.faceRenderTypes) {
                        model0.faceRenderTypes = new Int8Array(model0.faceCount);
                    }

                    model0.faceRenderTypes[i] = 2;
                }
            }
            for (let i = 0; i < model1.faceCount; i++) {
                if (
                    model1VertexStamp[model1.indices1[i]] === stamp &&
                    model1VertexStamp[model1.indices2[i]] === stamp &&
                    model1VertexStamp[model1.indices3[i]] === stamp
                ) {
                    if (!model1.faceRenderTypes) {
                        model1.faceRenderTypes = new Int8Array(model1.faceCount);
                    }

                    model1.faceRenderTypes[i] = 2;
                }
            }
        }
    }

    constructor() {
        super();
        this.version = -1;
        this.verticesCount = 0;
        this.usedVertexCount = 0;
        this.faceCount = 0;
        this.priority = 0;
        this.isBoundsCalculated = false;
    }

    canMergeNormals(): boolean {
        return true;
    }

    mergeNormals(
        entity: Entity,
        offsetX: number,
        offsetY: number,
        offsetZ: number,
        hideOccluded: boolean,
        scratch?: MergeNormalsScratch,
    ): void {
        if (!entity.canMergeNormals()) {
            return;
        }
        ModelData.mergeNormals(
            this,
            entity as ModelData,
            offsetX,
            offsetY,
            offsetZ,
            hideOccluded,
            scratch ?? new MergeNormalsScratch(),
        );
    }

    merge(models: ModelData[], count: number): void {
        this.version = 12;
        this.verticesCount = 0;
        this.faceCount = 0;
        this.textureFaceCount = 0;
        this.priority = -1;

        let hasRenderTypes = false;
        let hasRenderPriorities = false;
        let hasAlphas = false;
        let hasFaceSkins = false;
        let hasTextures = false;
        let hasTextureCoords = false;
        let hasMayaGroups = false;

        for (let i = 0; i < count; i++) {
            const model = models[i];
            if (model) {
                this.verticesCount += model.verticesCount;
                this.faceCount += model.faceCount;
                this.textureFaceCount += model.textureFaceCount;
                if (model.faceRenderPriorities) {
                    hasRenderPriorities = true;
                } else {
                    if (this.priority === -1) {
                        this.priority = model.priority;
                    }

                    if (this.priority !== model.priority) {
                        hasRenderPriorities = true;
                    }
                }

                hasRenderTypes ||= !!model.faceRenderTypes;
                hasAlphas ||= !!model.faceAlphas;
                hasFaceSkins ||= !!model.faceSkins;
                hasTextures ||= !!model.faceTextures;
                hasTextureCoords ||= !!model.textureCoords;
                hasMayaGroups ||= !!model.animMayaGroups;
            }
        }

        this.verticesX = new Int32Array(this.verticesCount);
        this.verticesY = new Int32Array(this.verticesCount);
        this.verticesZ = new Int32Array(this.verticesCount);
        this.vertexSkins = new Int32Array(this.verticesCount);
        this.indices1 = new Int32Array(this.faceCount);
        this.indices2 = new Int32Array(this.faceCount);
        this.indices3 = new Int32Array(this.faceCount);
        if (hasRenderTypes) {
            this.faceRenderTypes = new Int8Array(this.faceCount);
        }

        if (hasRenderPriorities) {
            this.faceRenderPriorities = new Int8Array(this.faceCount);
        }

        if (hasAlphas) {
            this.faceAlphas = new Int8Array(this.faceCount);
        }

        if (hasFaceSkins) {
            this.faceSkins = new Int32Array(this.faceCount);
        }

        if (hasTextures) {
            this.faceTextures = new Int16Array(this.faceCount);
        }

        if (hasTextureCoords) {
            this.textureCoords = new Int8Array(this.faceCount);
        }

        if (hasMayaGroups) {
            this.animMayaGroups = new Array(this.verticesCount);
            this.animMayaScales = new Array(this.verticesCount);
        }

        this.faceColors = new Uint16Array(this.faceCount);
        if (this.textureFaceCount > 0) {
            this.textureRenderTypes = new Int8Array(this.textureFaceCount);
            this.textureMappingP = new Int16Array(this.textureFaceCount);
            this.textureMappingM = new Int16Array(this.textureFaceCount);
            this.textureMappingN = new Int16Array(this.textureFaceCount);
            this.textureScaleX = new Int32Array(this.textureFaceCount);
            this.textureScaleY = new Int32Array(this.textureFaceCount);
            this.textureScaleZ = new Int32Array(this.textureFaceCount);
            this.textureRotation = new Int8Array(this.textureFaceCount);
            this.textureDirection = new Int8Array(this.textureFaceCount);
            this.textureSpeed = new Int32Array(this.textureFaceCount);
            this.textureTransU = new Int32Array(this.textureFaceCount);
            this.textureTransV = new Int32Array(this.textureFaceCount);
        }

        this.verticesCount = 0;
        this.faceCount = 0;
        this.textureFaceCount = 0;

        for (let i = 0; i < count; i++) {
            const model = models[i];
            if (!model) {
                continue;
            }
            for (let f = 0; f < model.faceCount; f++) {
                if (hasRenderTypes && model.faceRenderTypes && this.faceRenderTypes) {
                    this.faceRenderTypes[this.faceCount] = model.faceRenderTypes[f];
                }

                if (hasRenderPriorities) {
                    if (model.faceRenderPriorities) {
                        this.faceRenderPriorities[this.faceCount] = model.faceRenderPriorities[f];
                    } else {
                        this.faceRenderPriorities[this.faceCount] = model.priority;
                    }
                }

                if (hasAlphas && model.faceAlphas) {
                    this.faceAlphas[this.faceCount] = model.faceAlphas[f];
                }

                if (hasFaceSkins && this.faceSkins) {
                    if (model.faceSkins) {
                        this.faceSkins[this.faceCount] = model.faceSkins[f];
                    } else {
                        this.faceSkins[this.faceCount] = -1;
                    }
                }

                if (hasTextures && this.faceTextures) {
                    if (model.faceTextures) {
                        this.faceTextures[this.faceCount] = model.faceTextures[f];
                    } else {
                        this.faceTextures[this.faceCount] = -1;
                    }
                }

                if (hasTextureCoords && this.textureCoords) {
                    if (model.textureCoords && model.textureCoords[f] !== -1) {
                        this.textureCoords[this.faceCount] =
                            this.textureFaceCount + model.textureCoords[f];
                    } else {
                        this.textureCoords[this.faceCount] = -1;
                    }
                }

                this.faceColors[this.faceCount] = model.faceColors[f];
                this.indices1[this.faceCount] = this.copyVertex(model, model.indices1[f]);
                this.indices2[this.faceCount] = this.copyVertex(model, model.indices2[f]);
                this.indices3[this.faceCount] = this.copyVertex(model, model.indices3[f]);
                this.faceCount++;
            }

            for (let f = 0; f < model.textureFaceCount; f++) {
                const type = (this.textureRenderTypes[this.textureFaceCount] =
                    model.textureRenderTypes[f]);
                if (type === 0) {
                    this.textureMappingP[this.textureFaceCount] = this.copyVertex(
                        model,
                        model.textureMappingP[f],
                    );
                    this.textureMappingM[this.textureFaceCount] = this.copyVertex(
                        model,
                        model.textureMappingM[f],
                    );
                    this.textureMappingN[this.textureFaceCount] = this.copyVertex(
                        model,
                        model.textureMappingN[f],
                    );
                }
                if (type >= 1 && type <= 3) {
                    this.textureMappingP[this.textureFaceCount] = model.textureMappingP[f];
                    this.textureMappingM[this.textureFaceCount] = model.textureMappingM[f];
                    this.textureMappingN[this.textureFaceCount] = model.textureMappingN[f];
                    this.textureScaleX[this.textureFaceCount] = model.textureScaleX[f];
                    this.textureScaleY[this.textureFaceCount] = model.textureScaleY[f];
                    this.textureScaleZ[this.textureFaceCount] = model.textureScaleZ[f];
                    this.textureRotation[this.textureFaceCount] = model.textureRotation[f];
                    this.textureDirection[this.textureFaceCount] = model.textureDirection[f];
                    this.textureSpeed[this.textureFaceCount] = model.textureSpeed[f];
                }

                if (type === 2) {
                    this.textureTransU[this.textureFaceCount] = model.textureTransU[f];
                    this.textureTransV[this.textureFaceCount] = model.textureTransV[f];
                }

                this.textureFaceCount++;
            }
        }
        // TODO: this is different in rs2
        this.usedVertexCount = this.verticesCount;
    }

    copyVertex(model: ModelData, index: number): number {
        let newVertexCount = -1;
        const vertX = model.verticesX[index];
        const vertY = model.verticesY[index];
        const vertZ = model.verticesZ[index];

        for (let i = 0; i < this.verticesCount; i++) {
            if (
                vertX === this.verticesX[i] &&
                vertY === this.verticesY[i] &&
                vertZ === this.verticesZ[i]
            ) {
                newVertexCount = i;
                break;
            }
        }

        if (newVertexCount === -1) {
            this.verticesX[this.verticesCount] = vertX;
            this.verticesY[this.verticesCount] = vertY;
            this.verticesZ[this.verticesCount] = vertZ;
            if (model.vertexSkins && this.vertexSkins) {
                this.vertexSkins[this.verticesCount] = model.vertexSkins[index];
            } else if (this.vertexSkins) {
                this.vertexSkins![this.verticesCount] = -1;
            }

            if (model.animMayaGroups) {
                this.animMayaGroups[this.verticesCount] = model.animMayaGroups[index];
                this.animMayaScales[this.verticesCount] = model.animMayaScales[index];
            }

            newVertexCount = this.verticesCount++;
        }

        return newVertexCount;
    }

    decode(data: Int8Array): void {
        if (data[data.length - 1] === -3 && data[data.length - 2] === -1) {
            this.decodeV3(data);
            this.usedVertexCount = this.verticesCount;
        } else if (data[data.length - 1] === -2 && data[data.length - 2] === -1) {
            this.decodeV2(data);
            this.usedVertexCount = this.verticesCount;
        } else if (data[data.length - 1] === -1 && data[data.length - 2] === -1) {
            this.decodeV1(data);
        } else {
            this.decodeOld(data);
        }
    }

    decodeV3(data: Int8Array): void {
        this.version = 3;
        const buf1 = new ByteBuffer(data);
        const buf2 = new ByteBuffer(data);
        const buf3 = new ByteBuffer(data);
        const buf4 = new ByteBuffer(data);
        const buf5 = new ByteBuffer(data);
        const buf6 = new ByteBuffer(data);
        const buf7 = new ByteBuffer(data);
        buf1.offset = data.length - 26;
        const vertexCount = buf1.readUnsignedShort();
        const faceCount = buf1.readUnsignedShort();
        const texTriangleCount = buf1.readUnsignedByte();
        const hasFaceRenderTypes = buf1.readUnsignedByte();
        const priorityOrFlag = buf1.readUnsignedByte();
        const hasFaceAlphas = buf1.readUnsignedByte();
        const hasFaceSkins = buf1.readUnsignedByte();
        const hasFaceTextures = buf1.readUnsignedByte();
        const hasVertexSkins = buf1.readUnsignedByte();
        const hasMayaGroups = buf1.readUnsignedByte();
        const vertexDeltaXDataLength = buf1.readUnsignedShort();
        const vertexDeltaYDataLength = buf1.readUnsignedShort();
        const vertexDeltaZDataLength = buf1.readUnsignedShort();
        const faceIndexDataLength = buf1.readUnsignedShort();
        const textureCoordDataLength = buf1.readUnsignedShort();
        const vertexSkinAndMayaDataLength = buf1.readUnsignedShort();
        let simpleTextureFaceCount = 0;
        let complexTextureFaceCount = 0;
        let cubeTextureFaceCount = 0;
        if (texTriangleCount > 0) {
            this.textureRenderTypes = new Int8Array(texTriangleCount);
            buf1.offset = 0;

            for (let i = 0; i < texTriangleCount; i++) {
                const type = (this.textureRenderTypes[i] = buf1.readByte());
                if (type === 0) {
                    simpleTextureFaceCount++;
                }

                if (type >= 1 && type <= 3) {
                    complexTextureFaceCount++;
                }

                if (type === 2) {
                    cubeTextureFaceCount++;
                }
            }
        }

        let offset = texTriangleCount + vertexCount;
        const faceRenderTypeOffset = offset;
        if (hasFaceRenderTypes === 1) {
            offset += faceCount;
        }

        const faceIndexTypeOffset = offset;
        offset += faceCount;
        const facePriorityOffset = offset;
        if (priorityOrFlag === 255) {
            offset += faceCount;
        }

        const faceSkinOffset = offset;
        if (hasFaceSkins === 1) {
            offset += faceCount;
        }

        const vertexSkinAndMayaOffset = offset;
        offset += vertexSkinAndMayaDataLength;
        const faceAlphaOffset = offset;
        if (hasFaceAlphas === 1) {
            offset += faceCount;
        }

        const faceIndexDataOffset = offset;
        offset += faceIndexDataLength;
        const faceTextureOffset = offset;
        if (hasFaceTextures === 1) {
            offset += faceCount * 2;
        }

        const textureCoordOffset = offset;
        offset += textureCoordDataLength;
        const faceColorOffset = offset;
        offset += faceCount * 2;
        const vertexDeltaXOffset = offset;
        offset += vertexDeltaXDataLength;
        const vertexDeltaYOffset = offset;
        offset += vertexDeltaYDataLength;
        const vertexDeltaZOffset = offset;
        offset += vertexDeltaZDataLength;
        const simpleTextureMappingOffset = offset;
        offset += simpleTextureFaceCount * 6;
        const complexTextureMappingOffset = offset;
        offset += complexTextureFaceCount * 6;
        const complexTextureScaleOffset = offset;
        offset += complexTextureFaceCount * 6;
        const complexTextureRotationOffset = offset;
        offset += complexTextureFaceCount * 2;
        const complexTextureDirectionOffset = offset;
        offset += complexTextureFaceCount;
        const complexTextureTranslationOffset = offset;
        offset += complexTextureFaceCount * 2 + cubeTextureFaceCount * 2;
        this.verticesCount = vertexCount;
        this.faceCount = faceCount;
        this.textureFaceCount = texTriangleCount;
        this.verticesX = new Int32Array(vertexCount);
        this.verticesY = new Int32Array(vertexCount);
        this.verticesZ = new Int32Array(vertexCount);
        this.indices1 = new Int32Array(faceCount);
        this.indices2 = new Int32Array(faceCount);
        this.indices3 = new Int32Array(faceCount);
        if (hasVertexSkins === 1) {
            this.vertexSkins = new Int32Array(vertexCount);
        }

        if (hasFaceRenderTypes === 1) {
            this.faceRenderTypes = new Int8Array(faceCount);
        }

        if (priorityOrFlag === 255) {
            this.faceRenderPriorities = new Int8Array(faceCount);
        } else {
            this.priority = priorityOrFlag;
        }

        if (hasFaceAlphas === 1) {
            this.faceAlphas = new Int8Array(faceCount);
        }

        if (hasFaceSkins === 1) {
            this.faceSkins = new Int32Array(faceCount);
        }

        if (hasFaceTextures === 1) {
            this.faceTextures = new Int16Array(faceCount);
        }

        if (hasFaceTextures === 1 && texTriangleCount > 0) {
            this.textureCoords = new Int8Array(faceCount);
        }

        if (hasMayaGroups === 1) {
            this.animMayaGroups = new Array(vertexCount);
            this.animMayaScales = new Array(vertexCount);
        }

        this.faceColors = new Uint16Array(faceCount);
        if (texTriangleCount > 0) {
            this.textureMappingP = new Int16Array(texTriangleCount);
            this.textureMappingM = new Int16Array(texTriangleCount);
            this.textureMappingN = new Int16Array(texTriangleCount);
            if (complexTextureFaceCount > 0) {
                this.textureScaleX = new Int32Array(complexTextureFaceCount);
                this.textureScaleY = new Int32Array(complexTextureFaceCount);
                this.textureScaleZ = new Int32Array(complexTextureFaceCount);
                this.textureRotation = new Int8Array(complexTextureFaceCount);
                this.textureDirection = new Int8Array(complexTextureFaceCount);
                this.textureSpeed = new Int32Array(complexTextureFaceCount);
            }
            if (cubeTextureFaceCount > 0) {
                this.textureTransU = new Int32Array(cubeTextureFaceCount);
                this.textureTransV = new Int32Array(cubeTextureFaceCount);
            }
        }

        buf1.offset = texTriangleCount;
        buf2.offset = vertexDeltaXOffset;
        buf3.offset = vertexDeltaYOffset;
        buf4.offset = vertexDeltaZOffset;
        buf5.offset = vertexSkinAndMayaOffset;
        let lastVertX = 0;
        let lastVertY = 0;
        let lastVertZ = 0;

        for (let i = 0; i < vertexCount; i++) {
            const flag = buf1.readUnsignedByte();
            let deltaVertX = 0;
            if ((flag & 1) !== 0) {
                deltaVertX = buf2.readSmart2();
            }

            let deltaVertY = 0;
            if ((flag & 2) !== 0) {
                deltaVertY = buf3.readSmart2();
            }

            let deltaVertZ = 0;
            if ((flag & 4) !== 0) {
                deltaVertZ = buf4.readSmart2();
            }

            this.verticesX[i] = lastVertX + deltaVertX;
            this.verticesY[i] = lastVertY + deltaVertY;
            this.verticesZ[i] = lastVertZ + deltaVertZ;
            lastVertX = this.verticesX[i];
            lastVertY = this.verticesY[i];
            lastVertZ = this.verticesZ[i];
            if (hasVertexSkins === 1 && this.vertexSkins) {
                this.vertexSkins[i] = buf5.readUnsignedByte();
            }
        }

        if (hasMayaGroups === 1) {
            for (let i = 0; i < vertexCount; i++) {
                const mayaGroupCount = buf5.readUnsignedByte();
                this.animMayaGroups[i] = new Int32Array(mayaGroupCount);
                this.animMayaScales[i] = new Int32Array(mayaGroupCount);

                for (let j = 0; j < mayaGroupCount; j++) {
                    this.animMayaGroups[i][j] = buf5.readUnsignedByte();
                    this.animMayaScales[i][j] = buf5.readUnsignedByte();
                }
            }
        }

        buf1.offset = faceColorOffset;
        buf2.offset = faceRenderTypeOffset;
        buf3.offset = facePriorityOffset;
        buf4.offset = faceAlphaOffset;
        buf5.offset = faceSkinOffset;
        buf6.offset = faceTextureOffset;
        buf7.offset = textureCoordOffset;

        for (let i = 0; i < faceCount; i++) {
            this.faceColors[i] = buf1.readUnsignedShort();
            if (hasFaceRenderTypes === 1 && this.faceRenderTypes) {
                this.faceRenderTypes[i] = buf2.readByte();
            }

            if (priorityOrFlag === 255) {
                this.faceRenderPriorities[i] = buf3.readByte();
            }

            if (hasFaceAlphas === 1) {
                this.faceAlphas[i] = buf4.readByte();
            }

            if (hasFaceSkins === 1 && this.faceSkins) {
                this.faceSkins[i] = buf5.readUnsignedByte();
            }

            if (hasFaceTextures === 1 && this.faceTextures) {
                this.faceTextures[i] = buf6.readUnsignedShort() - 1;
            }

            if (this.textureCoords && this.faceTextures && this.faceTextures[i] !== -1) {
                this.textureCoords[i] = buf7.readUnsignedByte() - 1;
            }
        }

        buf1.offset = faceIndexDataOffset;
        buf2.offset = faceIndexTypeOffset;
        let index1 = 0;
        let index2 = 0;
        let index3 = 0;
        let lastIndex = 0;

        for (let i = 0; i < faceCount; i++) {
            const type = buf2.readUnsignedByte();
            if (type === 1) {
                index1 = buf1.readSmart2() + lastIndex;
                index2 = buf1.readSmart2() + index1;
                index3 = buf1.readSmart2() + index2;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
            }

            if (type === 2) {
                index2 = index3;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
            }

            if (type === 3) {
                index1 = index3;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
            }

            if (type === 4) {
                const tmpIndex = index1;
                index1 = index2;
                index2 = tmpIndex;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = tmpIndex;
                this.indices3[i] = index3;
            }
        }

        buf1.offset = simpleTextureMappingOffset;
        buf2.offset = complexTextureMappingOffset;
        buf3.offset = complexTextureScaleOffset;
        buf4.offset = complexTextureRotationOffset;
        buf5.offset = complexTextureDirectionOffset;
        buf6.offset = complexTextureTranslationOffset;

        for (let i = 0; i < texTriangleCount; i++) {
            const type = this.textureRenderTypes[i] & 255;
            if (type === 0) {
                this.textureMappingP[i] = buf1.readUnsignedShort();
                this.textureMappingM[i] = buf1.readUnsignedShort();
                this.textureMappingN[i] = buf1.readUnsignedShort();
            }
        }

        buf1.offset = offset;
        const extraDataFlag = buf1.readUnsignedByte();
        if (extraDataFlag !== 0) {
            // new ModelData0();
            buf1.readUnsignedShort();
            buf1.readUnsignedShort();
            buf1.readUnsignedShort();
            buf1.readInt();
        }
    }

    decodeV2(data: Int8Array): void {
        this.version = 2;
        let hasRenderType = false;
        let isTextured = false;
        const buf1 = new ByteBuffer(data);
        const buf2 = new ByteBuffer(data);
        const buf3 = new ByteBuffer(data);
        const buf4 = new ByteBuffer(data);
        const buf5 = new ByteBuffer(data);
        buf1.offset = data.length - 23;
        const vertexCount = buf1.readUnsignedShort();
        const faceCount = buf1.readUnsignedShort();
        const texTriangleCount = buf1.readUnsignedByte();
        const usesTextures = buf1.readUnsignedByte();
        const priorityOrFlag = buf1.readUnsignedByte();
        const hasFaceAlphas = buf1.readUnsignedByte();
        const hasFaceSkins = buf1.readUnsignedByte();
        const hasVertexSkins = buf1.readUnsignedByte();
        const hasMayaGroups = buf1.readUnsignedByte();
        const vertexDeltaXDataLength = buf1.readUnsignedShort();
        const vertexDeltaYDataLength = buf1.readUnsignedShort();
        const vertexDeltaZDataLength = buf1.readUnsignedShort();
        const faceIndexDataLength = buf1.readUnsignedShort();
        const vertexSkinAndMayaDataLength = buf1.readUnsignedShort();
        const baseOffset = 0;
        let offset = baseOffset + vertexCount;
        const faceIndexTypeOffset = offset;
        offset += faceCount;
        const facePriorityOffset = offset;
        if (priorityOrFlag === 255) {
            offset += faceCount;
        }

        const faceSkinOffset = offset;
        if (hasFaceSkins === 1) {
            offset += faceCount;
        }

        const faceFlagOffset = offset;
        if (usesTextures === 1) {
            offset += faceCount;
        }

        const vertexSkinAndMayaOffset = offset;
        offset += vertexSkinAndMayaDataLength;
        const faceAlphaOffset = offset;
        if (hasFaceAlphas === 1) {
            offset += faceCount;
        }

        const faceIndexDataOffset = offset;
        offset += faceIndexDataLength;
        const faceColorOffset = offset;
        offset += faceCount * 2;
        const textureTriangleMappingOffset = offset;
        offset += texTriangleCount * 6;
        const vertexDeltaXOffset = offset;
        offset += vertexDeltaXDataLength;
        const vertexDeltaYOffset = offset;
        offset += vertexDeltaYDataLength;
        const vertexDeltaZOffset = offset;
        // Note: V2 doesn't use `vertexDeltaZDataLength` for any subsequent offsets here.
        this.verticesCount = vertexCount;
        this.faceCount = faceCount;
        this.textureFaceCount = texTriangleCount;
        this.verticesX = new Int32Array(vertexCount);
        this.verticesY = new Int32Array(vertexCount);
        this.verticesZ = new Int32Array(vertexCount);
        this.indices1 = new Int32Array(faceCount);
        this.indices2 = new Int32Array(faceCount);
        this.indices3 = new Int32Array(faceCount);
        if (texTriangleCount > 0) {
            this.textureRenderTypes = new Int8Array(texTriangleCount);
            this.textureMappingP = new Int16Array(texTriangleCount);
            this.textureMappingM = new Int16Array(texTriangleCount);
            this.textureMappingN = new Int16Array(texTriangleCount);
        }

        if (hasVertexSkins === 1) {
            this.vertexSkins = new Int32Array(vertexCount);
        }

        if (usesTextures === 1) {
            this.faceRenderTypes = new Int8Array(faceCount);
            this.textureCoords = new Int8Array(faceCount);
            this.faceTextures = new Int16Array(faceCount);
        }

        if (priorityOrFlag === 255) {
            this.faceRenderPriorities = new Int8Array(faceCount);
        } else {
            this.priority = priorityOrFlag;
        }

        if (hasFaceAlphas === 1) {
            this.faceAlphas = new Int8Array(faceCount);
        }

        if (hasFaceSkins === 1) {
            this.faceSkins = new Int32Array(faceCount);
        }

        if (hasMayaGroups === 1) {
            this.animMayaGroups = new Array(vertexCount);
            this.animMayaScales = new Array(vertexCount);
        }

        this.faceColors = new Uint16Array(faceCount);
        buf1.offset = baseOffset;
        buf2.offset = vertexDeltaXOffset;
        buf3.offset = vertexDeltaYOffset;
        buf4.offset = vertexDeltaZOffset;
        buf5.offset = vertexSkinAndMayaOffset;
        let lastVertX = 0;
        let lastVertY = 0;
        let lastVertZ = 0;

        for (let i = 0; i < vertexCount; i++) {
            const flag = buf1.readUnsignedByte();
            let deltaVertX = 0;
            if ((flag & 1) !== 0) {
                deltaVertX = buf2.readSmart2();
            }

            let deltaVertY = 0;
            if ((flag & 2) !== 0) {
                deltaVertY = buf3.readSmart2();
            }

            let deltaVertZ = 0;
            if ((flag & 4) !== 0) {
                deltaVertZ = buf4.readSmart2();
            }

            this.verticesX[i] = lastVertX + deltaVertX;
            this.verticesY[i] = lastVertY + deltaVertY;
            this.verticesZ[i] = lastVertZ + deltaVertZ;
            lastVertX = this.verticesX[i];
            lastVertY = this.verticesY[i];
            lastVertZ = this.verticesZ[i];
            if (hasVertexSkins === 1 && this.vertexSkins) {
                this.vertexSkins[i] = buf5.readUnsignedByte();
            }
        }

        if (hasMayaGroups === 1) {
            for (let i = 0; i < vertexCount; i++) {
                const mayaGroupCount = buf5.readUnsignedByte();
                this.animMayaGroups[i] = new Int32Array(mayaGroupCount);
                this.animMayaScales[i] = new Int32Array(mayaGroupCount);

                for (let j = 0; j < mayaGroupCount; j++) {
                    this.animMayaGroups[i][j] = buf5.readUnsignedByte();
                    this.animMayaScales[i][j] = buf5.readUnsignedByte();
                }
            }
        }

        buf1.offset = faceColorOffset;
        buf2.offset = faceFlagOffset;
        buf3.offset = facePriorityOffset;
        buf4.offset = faceAlphaOffset;
        buf5.offset = faceSkinOffset;

        for (let i = 0; i < faceCount; i++) {
            this.faceColors[i] = buf1.readUnsignedShort();
            if (
                usesTextures === 1 &&
                this.faceRenderTypes &&
                this.textureCoords &&
                this.faceTextures
            ) {
                const faceFlag = buf2.readUnsignedByte();
                if ((faceFlag & 1) === 1) {
                    this.faceRenderTypes[i] = 1;
                    hasRenderType = true;
                } else {
                    this.faceRenderTypes[i] = 0;
                }

                if ((faceFlag & 2) === 2) {
                    this.textureCoords[i] = faceFlag >> 2;
                    this.faceTextures[i] = this.faceColors[i];
                    this.faceColors[i] = 127;
                    if (this.faceTextures[i] !== -1) {
                        isTextured = true;
                    }
                } else {
                    this.textureCoords[i] = -1;
                    this.faceTextures[i] = -1;
                }
            }

            if (priorityOrFlag === 255) {
                this.faceRenderPriorities[i] = buf3.readByte();
            }

            if (hasFaceAlphas === 1) {
                this.faceAlphas[i] = buf4.readByte();
            }

            if (hasFaceSkins === 1 && this.faceSkins) {
                this.faceSkins[i] = buf5.readUnsignedByte();
            }
        }

        buf1.offset = faceIndexDataOffset;
        buf2.offset = faceIndexTypeOffset;
        let index1 = 0;
        let index2 = 0;
        let index3 = 0;
        let lastIndex = 0;

        for (let i = 0; i < faceCount; i++) {
            const faceIndexType = buf2.readUnsignedByte();
            if (faceIndexType === 1) {
                index1 = buf1.readSmart2() + lastIndex;
                index2 = buf1.readSmart2() + index1;
                index3 = buf1.readSmart2() + index2;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
            }

            if (faceIndexType === 2) {
                index2 = index3;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
            }

            if (faceIndexType === 3) {
                index1 = index3;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
            }

            if (faceIndexType === 4) {
                const tmpIndex = index1;
                index1 = index2;
                index2 = tmpIndex;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = tmpIndex;
                this.indices3[i] = index3;
            }
        }

        buf1.offset = textureTriangleMappingOffset;

        for (let i = 0; i < texTriangleCount; i++) {
            this.textureRenderTypes[i] = 0;
            this.textureMappingP[i] = buf1.readUnsignedShort();
            this.textureMappingM[i] = buf1.readUnsignedShort();
            this.textureMappingN[i] = buf1.readUnsignedShort();
        }

        if (this.textureCoords) {
            let hasValidTexFace = false;

            for (let i = 0; i < faceCount; i++) {
                const coord = this.textureCoords[i] & 255;
                if (coord !== 255) {
                    if (
                        this.indices1[i] === (this.textureMappingP[coord] & 0xffff) &&
                        this.indices2[i] === (this.textureMappingM[coord] & 0xffff) &&
                        this.indices3[i] === (this.textureMappingN[coord] & 0xffff)
                    ) {
                        this.textureCoords[i] = -1;
                    } else {
                        hasValidTexFace = true;
                    }
                }
            }

            if (!hasValidTexFace) {
                this.textureCoords = undefined;
            }
        }

        if (!isTextured) {
            this.faceTextures = undefined;
        }

        if (!hasRenderType) {
            this.faceRenderTypes = undefined;
        }
    }

    scaleDown(n: number): void {
        for (let i = 0; i < this.verticesCount; i++) {
            this.verticesX[i] >>= n;
            this.verticesY[i] >>= n;
            this.verticesZ[i] >>= n;
        }
        if (this.textureFaceCount > 0 && this.textureScaleX) {
            for (let i = 0; i < this.textureFaceCount; i++) {
                this.textureScaleX[i] >>= n;
                this.textureScaleY[i] >>= n;
                if (this.textureRenderTypes[i] !== 1) {
                    this.textureScaleZ[i] >>= n;
                }
            }
        }
    }

    decodeV1(data: Int8Array): void {
        this.version = 1;
        const buf1 = new ByteBuffer(data);
        const buf2 = new ByteBuffer(data);
        const buf3 = new ByteBuffer(data);
        const buf4 = new ByteBuffer(data);
        const buf5 = new ByteBuffer(data);
        const buf6 = new ByteBuffer(data);
        const buf7 = new ByteBuffer(data);
        buf1.offset = data.length - 23;
        const vertexCount = buf1.readUnsignedShort();
        const faceCount = buf1.readUnsignedShort();
        const texFaceCount = buf1.readUnsignedByte();
        const flags = buf1.readUnsignedByte();
        const hasFaceRenderTypes = (flags & 0x1) === 1;
        const hasParticles = (flags & 0x2) === 2;
        const hasBillboards = (flags & 0x4) === 4;
        const hasVersion = (flags & 0x8) === 8;
        if (hasVersion) {
            buf1.offset -= 7;
            this.version = buf1.readUnsignedByte();
            buf1.offset += 6;
        }
        const modelPriority = buf1.readUnsignedByte();
        const hasFaceAlpha = buf1.readUnsignedByte();
        const hasFaceSkins = buf1.readUnsignedByte();
        const hasFaceTextures = buf1.readUnsignedByte();
        const hasVertexSkins = buf1.readUnsignedByte();
        const modelVerticesX = buf1.readUnsignedShort();
        const modelVerticesY = buf1.readUnsignedShort();
        const modelVerticesZ = buf1.readUnsignedShort();
        const faceIndices = buf1.readUnsignedShort();
        const textureIndices = buf1.readUnsignedShort();
        let simpleTextureFaceCount = 0;
        let complexTextureFaceCount = 0;
        let cubeTextureFaceCount = 0;
        if (texFaceCount > 0) {
            this.textureRenderTypes = new Int8Array(texFaceCount);
            buf1.offset = 0;

            for (let i = 0; i < texFaceCount; i++) {
                const type = (this.textureRenderTypes[i] = buf1.readByte());
                if (type === 0) {
                    simpleTextureFaceCount++;
                }

                if (type >= 1 && type <= 3) {
                    complexTextureFaceCount++;
                }

                if (type === 2) {
                    cubeTextureFaceCount++;
                }
            }
        }

        let offset = texFaceCount + vertexCount;
        const vertexFlagsOffset = offset;
        if (hasFaceRenderTypes) {
            offset += faceCount;
        }

        const faceCompressTypeOffset = offset;
        offset += faceCount;
        const facePrioritiesOffset = offset;
        if (modelPriority === 255) {
            offset += faceCount;
        }

        const faceSkinsOffset = offset;
        if (hasFaceSkins === 1) {
            offset += faceCount;
        }

        const vertexSkinsOffset = offset;
        if (hasVertexSkins === 1) {
            offset += vertexCount;
        }

        const faceAlphasOffset = offset;
        if (hasFaceAlpha === 1) {
            offset += faceCount;
        }

        const faceIndicesOffset = offset;
        offset += faceIndices;
        const faceMaterialsOffset = offset;
        if (hasFaceTextures === 1) {
            offset += faceCount * 2;
        }

        const faceTextureIndicesOffset = offset;
        offset += textureIndices;
        const faceColorsOffset = offset;
        offset += faceCount * 2;
        const xVertexOffset = offset;
        offset += modelVerticesX;
        const yVertexOffset = offset;
        offset += modelVerticesY;
        const zVertexOffset = offset;
        offset += modelVerticesZ;
        const simpleTexturesOffset = offset;
        offset += simpleTextureFaceCount * 6;
        const complexTexturesOffset = offset;
        offset += complexTextureFaceCount * 6;
        let textureBytes = 6;
        if (this.version === 14) {
            textureBytes = 7;
        } else if (this.version >= 15) {
            textureBytes = 9;
        }
        const texturesScalesOffset = offset;
        offset += complexTextureFaceCount * textureBytes;
        const texturesRotationOffset = offset;
        offset += complexTextureFaceCount;
        const texturesDirectionOffset = offset;
        offset += complexTextureFaceCount;
        const texturesTranslationOffset = offset;
        offset += complexTextureFaceCount + cubeTextureFaceCount * 2;
        const particleEffectsOffset = offset;
        this.verticesCount = vertexCount;
        this.faceCount = faceCount;
        this.textureFaceCount = texFaceCount;
        this.verticesX = new Int32Array(vertexCount);
        this.verticesY = new Int32Array(vertexCount);
        this.verticesZ = new Int32Array(vertexCount);
        this.indices1 = new Int32Array(faceCount);
        this.indices2 = new Int32Array(faceCount);
        this.indices3 = new Int32Array(faceCount);
        if (hasVertexSkins === 1) {
            this.vertexSkins = new Int32Array(vertexCount);
        }

        if (hasFaceRenderTypes) {
            this.faceRenderTypes = new Int8Array(faceCount);
        }

        if (modelPriority === 255) {
            this.faceRenderPriorities = new Int8Array(faceCount);
        } else {
            this.priority = modelPriority;
        }

        if (hasFaceAlpha === 1) {
            this.faceAlphas = new Int8Array(faceCount);
        }

        if (hasFaceSkins === 1) {
            this.faceSkins = new Int32Array(faceCount);
        }

        if (hasFaceTextures === 1) {
            this.faceTextures = new Int16Array(faceCount);
        }

        if (hasFaceTextures === 1 && texFaceCount > 0) {
            this.textureCoords = new Int8Array(faceCount);
        }

        this.faceColors = new Uint16Array(faceCount);
        if (texFaceCount > 0) {
            this.textureMappingP = new Int16Array(texFaceCount);
            this.textureMappingM = new Int16Array(texFaceCount);
            this.textureMappingN = new Int16Array(texFaceCount);
            if (complexTextureFaceCount > 0) {
                this.textureScaleX = new Int32Array(complexTextureFaceCount);
                this.textureScaleY = new Int32Array(complexTextureFaceCount);
                this.textureScaleZ = new Int32Array(complexTextureFaceCount);
                this.textureRotation = new Int8Array(complexTextureFaceCount);
                this.textureDirection = new Int8Array(complexTextureFaceCount);
                this.textureSpeed = new Int32Array(complexTextureFaceCount);
            }
            if (cubeTextureFaceCount > 0) {
                this.textureTransU = new Int32Array(cubeTextureFaceCount);
                this.textureTransV = new Int32Array(cubeTextureFaceCount);
            }
        }

        buf1.offset = texFaceCount;
        buf2.offset = xVertexOffset;
        buf3.offset = yVertexOffset;
        buf4.offset = zVertexOffset;
        buf5.offset = vertexSkinsOffset;
        let lastVertX = 0;
        let lastVertY = 0;
        let lastVertZ = 0;

        for (let i = 0; i < vertexCount; i++) {
            const flag = buf1.readUnsignedByte();
            let deltaVertX = 0;
            if ((flag & 1) !== 0) {
                deltaVertX = buf2.readSmart2();
            }

            let deltaVertY = 0;
            if ((flag & 2) !== 0) {
                deltaVertY = buf3.readSmart2();
            }

            let deltaVertZ = 0;
            if ((flag & 4) !== 0) {
                deltaVertZ = buf4.readSmart2();
            }

            this.verticesX[i] = lastVertX + deltaVertX;
            this.verticesY[i] = lastVertY + deltaVertY;
            this.verticesZ[i] = lastVertZ + deltaVertZ;
            lastVertX = this.verticesX[i];
            lastVertY = this.verticesY[i];
            lastVertZ = this.verticesZ[i];
            if (hasVertexSkins === 1 && this.vertexSkins) {
                this.vertexSkins[i] = buf5.readUnsignedByte();
            }
        }

        buf1.offset = faceColorsOffset;
        buf2.offset = vertexFlagsOffset;
        buf3.offset = facePrioritiesOffset;
        buf4.offset = faceAlphasOffset;
        buf5.offset = faceSkinsOffset;
        buf6.offset = faceMaterialsOffset;
        buf7.offset = faceTextureIndicesOffset;

        for (let i = 0; i < faceCount; i++) {
            this.faceColors[i] = buf1.readUnsignedShort();
            if (hasFaceRenderTypes && this.faceRenderTypes) {
                this.faceRenderTypes[i] = buf2.readByte();
            }

            if (modelPriority === 255) {
                this.faceRenderPriorities[i] = buf3.readByte();
            }

            if (hasFaceAlpha === 1) {
                this.faceAlphas[i] = buf4.readByte();
            }

            if (hasFaceSkins === 1 && this.faceSkins) {
                this.faceSkins[i] = buf5.readUnsignedByte();
            }

            if (hasFaceTextures === 1 && this.faceTextures) {
                this.faceTextures[i] = buf6.readUnsignedShort() - 1;
            }

            if (this.textureCoords) {
                if (this.faceTextures && this.faceTextures[i] !== -1) {
                    this.textureCoords[i] = buf7.readUnsignedByte() - 1;
                } else {
                    this.textureCoords[i] = -1;
                }
            }
        }

        buf1.offset = faceIndicesOffset;
        buf2.offset = faceCompressTypeOffset;
        let index1 = 0;
        let index2 = 0;
        let index3 = 0;
        let lastIndex = 0;

        this.usedVertexCount = -1;
        for (let i = 0; i < faceCount; i++) {
            const type = buf2.readUnsignedByte();
            if (type === 1) {
                index1 = buf1.readSmart2() + lastIndex;
                index2 = buf1.readSmart2() + index1;
                index3 = buf1.readSmart2() + index2;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
                if (index1 > this.usedVertexCount) {
                    this.usedVertexCount = index1;
                }
                if (index2 > this.usedVertexCount) {
                    this.usedVertexCount = index2;
                }
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }

            if (type === 2) {
                index2 = index3;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }

            if (type === 3) {
                index1 = index3;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }

            if (type === 4) {
                const tmpIndex = index1;
                index1 = index2;
                index2 = tmpIndex;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = tmpIndex;
                this.indices3[i] = index3;
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }
        }
        this.usedVertexCount++;

        buf1.offset = simpleTexturesOffset;
        buf2.offset = complexTexturesOffset;
        buf3.offset = texturesScalesOffset;
        buf4.offset = texturesRotationOffset;
        buf5.offset = texturesDirectionOffset;
        buf6.offset = texturesTranslationOffset;

        this.decodeTextureMapping(buf1, buf2, buf3, buf4, buf5, buf6);

        buf1.offset = offset;

        if (this.version >= 13) {
            this.scaleDown(2);
        }

        // const extraDataFlag = buf1.readUnsignedByte();
        // if (extraDataFlag !== 0) {
        //     // new ModelData0();
        //     buf1.readUnsignedShort();
        //     buf1.readUnsignedShort();
        //     buf1.readUnsignedShort();
        //     buf1.readInt();
        // }
    }

    decodeTextureMapping(
        simpleBuffer: ByteBuffer,
        complexBuffer: ByteBuffer,
        scaleBuffer: ByteBuffer,
        rotationBuffer: ByteBuffer,
        directionBuffer: ByteBuffer,
        translationBuffer: ByteBuffer,
    ): void {
        for (let i = 0; i < this.textureFaceCount; i++) {
            const type = this.textureRenderTypes[i] & 0xff;
            if (type === 0) {
                this.textureMappingP[i] = simpleBuffer.readUnsignedShort();
                this.textureMappingM[i] = simpleBuffer.readUnsignedShort();
                this.textureMappingN[i] = simpleBuffer.readUnsignedShort();
            }
            if (type === 1) {
                this.textureMappingP[i] = complexBuffer.readUnsignedShort();
                this.textureMappingM[i] = complexBuffer.readUnsignedShort();
                this.textureMappingN[i] = complexBuffer.readUnsignedShort();
                if (this.version < 15) {
                    this.textureScaleX[i] = scaleBuffer.readUnsignedShort();
                    if (this.version >= 14) {
                        this.textureScaleY[i] = scaleBuffer.readMedium();
                    } else {
                        this.textureScaleY[i] = scaleBuffer.readUnsignedShort();
                    }
                    this.textureScaleZ[i] = scaleBuffer.readUnsignedShort();
                } else {
                    this.textureScaleX[i] = scaleBuffer.readMedium();
                    this.textureScaleY[i] = scaleBuffer.readMedium();
                    this.textureScaleZ[i] = scaleBuffer.readMedium();
                }
                this.textureRotation[i] = rotationBuffer.readByte();
                this.textureDirection[i] = directionBuffer.readByte();
                this.textureSpeed[i] = translationBuffer.readByte();
            }
            if (type === 2) {
                this.textureMappingP[i] = complexBuffer.readUnsignedShort();
                this.textureMappingM[i] = complexBuffer.readUnsignedShort();
                this.textureMappingN[i] = complexBuffer.readUnsignedShort();
                if (this.version < 15) {
                    this.textureScaleX[i] = scaleBuffer.readUnsignedShort();
                    if (this.version >= 14) {
                        this.textureScaleY[i] = scaleBuffer.readMedium();
                    } else {
                        this.textureScaleY[i] = scaleBuffer.readUnsignedShort();
                    }
                    this.textureScaleZ[i] = scaleBuffer.readUnsignedShort();
                } else {
                    this.textureScaleX[i] = scaleBuffer.readMedium();
                    this.textureScaleY[i] = scaleBuffer.readMedium();
                    this.textureScaleZ[i] = scaleBuffer.readMedium();
                }
                this.textureRotation[i] = rotationBuffer.readByte();
                this.textureDirection[i] = directionBuffer.readByte();
                this.textureSpeed[i] = translationBuffer.readByte();
                this.textureTransU[i] = translationBuffer.readByte();
                this.textureTransV[i] = translationBuffer.readByte();
            }
            if (type === 3) {
                // same as 1, TODO: combine
                this.textureMappingP[i] = complexBuffer.readUnsignedShort();
                this.textureMappingM[i] = complexBuffer.readUnsignedShort();
                this.textureMappingN[i] = complexBuffer.readUnsignedShort();
                if (this.version < 15) {
                    this.textureScaleX[i] = scaleBuffer.readUnsignedShort();
                    if (this.version >= 14) {
                        this.textureScaleY[i] = scaleBuffer.readMedium();
                    } else {
                        this.textureScaleY[i] = scaleBuffer.readUnsignedShort();
                    }
                    this.textureScaleZ[i] = scaleBuffer.readUnsignedShort();
                } else {
                    this.textureScaleX[i] = scaleBuffer.readMedium();
                    this.textureScaleY[i] = scaleBuffer.readMedium();
                    this.textureScaleZ[i] = scaleBuffer.readMedium();
                }
                this.textureRotation[i] = rotationBuffer.readByte();
                this.textureDirection[i] = directionBuffer.readByte();
                this.textureSpeed[i] = translationBuffer.readByte();
            }
        }
    }

    decodeOld(data: Int8Array): void {
        this.version = 0;
        let hasRenderType = false;
        let isTextured = false;
        const buf1 = new ByteBuffer(data);
        const buf2 = new ByteBuffer(data);
        const buf3 = new ByteBuffer(data);
        const buf4 = new ByteBuffer(data);
        const buf5 = new ByteBuffer(data);
        buf1.offset = data.length - 18;
        const vertexCount = buf1.readUnsignedShort();
        const faceCount = buf1.readUnsignedShort();
        const texTriangleCount = buf1.readUnsignedByte();
        const usesTextures = buf1.readUnsignedByte();
        const priorityOrFlag = buf1.readUnsignedByte();
        const hasFaceAlphas = buf1.readUnsignedByte();
        const hasFaceSkins = buf1.readUnsignedByte();
        const hasVertexSkins = buf1.readUnsignedByte();
        const vertexDeltaXDataLength = buf1.readUnsignedShort();
        const vertexDeltaYDataLength = buf1.readUnsignedShort();
        const vertexDeltaZDataLength = buf1.readUnsignedShort();
        const faceIndexDataLength = buf1.readUnsignedShort();
        const baseOffset = 0;
        let offset = baseOffset + vertexCount;
        const faceIndexTypeOffset = offset;
        offset += faceCount;
        const facePriorityOffset = offset;
        if (priorityOrFlag === 255) {
            offset += faceCount;
        }

        const faceSkinOffset = offset;
        if (hasFaceSkins === 1) {
            offset += faceCount;
        }

        const faceFlagOffset = offset;
        if (usesTextures === 1) {
            offset += faceCount;
        }

        const vertexSkinsOffset = offset;
        if (hasVertexSkins === 1) {
            offset += vertexCount;
        }

        const faceAlphaOffset = offset;
        if (hasFaceAlphas === 1) {
            offset += faceCount;
        }

        const faceIndexDataOffset = offset;
        offset += faceIndexDataLength;
        const faceColorOffset = offset;
        offset += faceCount * 2;
        const textureTriangleMappingOffset = offset;
        offset += texTriangleCount * 6;
        const vertexDeltaXOffset = offset;
        offset += vertexDeltaXDataLength;
        const vertexDeltaYOffset = offset;
        offset += vertexDeltaYDataLength;
        const vertexDeltaZOffset = offset;
        // Note: V0 doesn't use `vertexDeltaZDataLength` for any subsequent offsets here.
        this.verticesCount = vertexCount;
        this.faceCount = faceCount;
        this.textureFaceCount = texTriangleCount;
        this.verticesX = new Int32Array(vertexCount);
        this.verticesY = new Int32Array(vertexCount);
        this.verticesZ = new Int32Array(vertexCount);
        this.indices1 = new Int32Array(faceCount);
        this.indices2 = new Int32Array(faceCount);
        this.indices3 = new Int32Array(faceCount);
        if (texTriangleCount > 0) {
            this.textureRenderTypes = new Int8Array(texTriangleCount);
            this.textureMappingP = new Int16Array(texTriangleCount);
            this.textureMappingM = new Int16Array(texTriangleCount);
            this.textureMappingN = new Int16Array(texTriangleCount);
        }

        if (hasVertexSkins === 1) {
            this.vertexSkins = new Int32Array(vertexCount);
        }

        if (usesTextures === 1) {
            this.faceRenderTypes = new Int8Array(faceCount);
            this.textureCoords = new Int8Array(faceCount);
            this.faceTextures = new Int16Array(faceCount);
        }

        if (priorityOrFlag === 255) {
            this.faceRenderPriorities = new Int8Array(faceCount);
        } else {
            this.priority = priorityOrFlag;
        }

        if (hasFaceAlphas === 1) {
            this.faceAlphas = new Int8Array(faceCount);
        }

        if (hasFaceSkins === 1) {
            this.faceSkins = new Int32Array(faceCount);
        }

        this.faceColors = new Uint16Array(faceCount);
        buf1.offset = baseOffset;
        buf2.offset = vertexDeltaXOffset;
        buf3.offset = vertexDeltaYOffset;
        buf4.offset = vertexDeltaZOffset;
        buf5.offset = vertexSkinsOffset;
        let lastVertX = 0;
        let lastVertY = 0;
        let lastVertZ = 0;

        for (let i = 0; i < vertexCount; i++) {
            const flag = buf1.readUnsignedByte();
            let deltaVertX = 0;
            if ((flag & 1) !== 0) {
                deltaVertX = buf2.readSmart2();
            }

            let deltaVertY = 0;
            if ((flag & 2) !== 0) {
                deltaVertY = buf3.readSmart2();
            }

            let deltaVertZ = 0;
            if ((flag & 4) !== 0) {
                deltaVertZ = buf4.readSmart2();
            }

            this.verticesX[i] = lastVertX + deltaVertX;
            this.verticesY[i] = lastVertY + deltaVertY;
            this.verticesZ[i] = lastVertZ + deltaVertZ;
            lastVertX = this.verticesX[i];
            lastVertY = this.verticesY[i];
            lastVertZ = this.verticesZ[i];
            if (hasVertexSkins === 1 && this.vertexSkins) {
                this.vertexSkins[i] = buf5.readUnsignedByte();
            }
        }

        buf1.offset = faceColorOffset;
        buf2.offset = faceFlagOffset;
        buf3.offset = facePriorityOffset;
        buf4.offset = faceAlphaOffset;
        buf5.offset = faceSkinOffset;

        for (let i = 0; i < faceCount; i++) {
            this.faceColors[i] = buf1.readUnsignedShort();
            if (
                usesTextures === 1 &&
                this.faceRenderTypes &&
                this.textureCoords &&
                this.faceTextures
            ) {
                const flag = buf2.readUnsignedByte();
                if ((flag & 1) === 1) {
                    this.faceRenderTypes[i] = 1;
                    hasRenderType = true;
                } else {
                    this.faceRenderTypes[i] = 0;
                }

                if ((flag & 2) === 2) {
                    this.textureCoords[i] = flag >> 2;
                    this.faceTextures[i] = this.faceColors[i];
                    this.faceColors[i] = 127;
                    if (this.faceTextures[i] !== -1) {
                        isTextured = true;
                    }
                } else {
                    this.textureCoords[i] = -1;
                    this.faceTextures[i] = -1;
                }
            }

            if (priorityOrFlag === 255) {
                this.faceRenderPriorities[i] = buf3.readByte();
            }

            if (hasFaceAlphas === 1) {
                this.faceAlphas[i] = buf4.readByte();
            }

            if (hasFaceSkins === 1 && this.faceSkins) {
                this.faceSkins[i] = buf5.readUnsignedByte();
            }
        }

        buf1.offset = faceIndexDataOffset;
        buf2.offset = faceIndexTypeOffset;
        let index1 = 0;
        let index2 = 0;
        let index3 = 0;
        let lastIndex = 0;

        this.usedVertexCount = -1;
        for (let i = 0; i < faceCount; i++) {
            const type = buf2.readUnsignedByte();
            if (type === 1) {
                index1 = buf1.readSmart2() + lastIndex;
                index2 = buf1.readSmart2() + index1;
                index3 = buf1.readSmart2() + index2;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
                if (index1 > this.usedVertexCount) {
                    this.usedVertexCount = index1;
                }
                if (index2 > this.usedVertexCount) {
                    this.usedVertexCount = index2;
                }
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }

            if (type === 2) {
                index2 = index3;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }

            if (type === 3) {
                index1 = index3;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }

            if (type === 4) {
                const tmpIndex = index1;
                index1 = index2;
                index2 = tmpIndex;
                index3 = buf1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = tmpIndex;
                this.indices3[i] = index3;
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }
        }
        this.usedVertexCount++;

        buf1.offset = textureTriangleMappingOffset;

        for (let i = 0; i < texTriangleCount; i++) {
            this.textureRenderTypes[i] = 0;
            this.textureMappingP[i] = buf1.readUnsignedShort();
            this.textureMappingM[i] = buf1.readUnsignedShort();
            this.textureMappingN[i] = buf1.readUnsignedShort();
        }

        if (this.textureCoords) {
            let hasValidTexFace = false;

            for (let i = 0; i < faceCount; i++) {
                const index = this.textureCoords[i] & 255;
                if (index !== 255) {
                    if (
                        this.indices1[i] === (this.textureMappingP[index] & 0xffff) &&
                        this.indices2[i] === (this.textureMappingM[index] & 0xffff) &&
                        this.indices3[i] === (this.textureMappingN[index] & 0xffff)
                    ) {
                        this.textureCoords[i] = -1;
                    } else {
                        hasValidTexFace = true;
                    }
                }
            }

            if (!hasValidTexFace) {
                this.textureCoords = undefined;
            }
        }

        if (!isTextured) {
            this.faceTextures = undefined;
        }

        if (!hasRenderType) {
            this.faceRenderTypes = undefined;
        }
    }

    decodeLegacy(loader: LegacyModelLoader, meta: LegacyModelMetadata) {
        let hasRenderType = false;
        let isTextured = false;

        this.verticesCount = meta.vertexCount;
        this.faceCount = meta.triangleCount;
        this.textureFaceCount = meta.texturedTriangleCount;
        this.verticesX = new Int32Array(this.verticesCount);
        this.verticesY = new Int32Array(this.verticesCount);
        this.verticesZ = new Int32Array(this.verticesCount);
        this.indices1 = new Int32Array(this.faceCount);
        this.indices2 = new Int32Array(this.faceCount);
        this.indices3 = new Int32Array(this.faceCount);
        if (this.textureFaceCount > 0) {
            this.textureRenderTypes = new Int8Array(this.textureFaceCount);
            this.textureMappingP = new Int16Array(this.textureFaceCount);
            this.textureMappingM = new Int16Array(this.textureFaceCount);
            this.textureMappingN = new Int16Array(this.textureFaceCount);
        }

        if (meta.vertexLabelsOffset >= 0) {
            this.vertexSkins = new Int32Array(this.verticesCount);
        }

        if (meta.faceInfosOffset >= 0) {
            this.faceRenderTypes = new Int8Array(this.faceCount);
            this.textureCoords = new Int8Array(this.faceCount);
            this.faceTextures = new Int16Array(this.faceCount);
        }

        if (meta.facePrioritiesOffset >= 0) {
            this.faceRenderPriorities = new Int8Array(this.faceCount);
        } else {
            this.priority = -meta.facePrioritiesOffset - 1;
        }

        if (meta.faceAlphasOffset >= 0) {
            this.faceAlphas = new Int8Array(this.faceCount);
        }

        if (meta.faceLabelsOffset >= 0) {
            this.faceSkins = new Int32Array(this.faceCount);
        }

        this.faceColors = new Uint16Array(this.faceCount);

        loader.point1.offset = meta.vertexFlagsOffset;
        loader.point2.offset = meta.vertexXOffset;
        loader.point3.offset = meta.vertexYOffset;
        loader.point4.offset = meta.vertexZOffset;
        loader.point5.offset = meta.vertexLabelsOffset;

        let lastVertX = 0;
        let lastVertY = 0;
        let lastVertZ = 0;

        for (let i = 0; i < this.verticesCount; i++) {
            const flag = loader.point1.readUnsignedByte();
            let deltaVertX = 0;
            if ((flag & 0x1) !== 0) {
                deltaVertX = loader.point2.readSmart2();
            }

            let deltaVertY = 0;
            if ((flag & 0x2) !== 0) {
                deltaVertY = loader.point3.readSmart2();
            }

            let deltaVertZ = 0;
            if ((flag & 0x4) !== 0) {
                deltaVertZ = loader.point4.readSmart2();
            }

            this.verticesX[i] = lastVertX + deltaVertX;
            this.verticesY[i] = lastVertY + deltaVertY;
            this.verticesZ[i] = lastVertZ + deltaVertZ;
            lastVertX = this.verticesX[i];
            lastVertY = this.verticesY[i];
            lastVertZ = this.verticesZ[i];
            if (this.vertexSkins) {
                this.vertexSkins[i] = loader.point5.readUnsignedByte();
            }
        }

        loader.face1.offset = meta.faceColorsOffset;
        loader.face2.offset = meta.faceInfosOffset;
        loader.face3.offset = meta.facePrioritiesOffset;
        loader.face4.offset = meta.faceAlphasOffset;
        loader.face5.offset = meta.faceLabelsOffset;

        for (let i = 0; i < this.faceCount; i++) {
            this.faceColors[i] = loader.face1.readUnsignedShort();
            if (this.faceRenderTypes && this.textureCoords && this.faceTextures) {
                const flag = loader.face2.readUnsignedByte();
                if ((flag & 0x1) === 1) {
                    this.faceRenderTypes[i] = 1;
                    hasRenderType = true;
                } else {
                    this.faceRenderTypes[i] = 0;
                }

                if ((flag & 0x2) === 2) {
                    this.textureCoords[i] = flag >> 2;
                    this.faceTextures[i] = this.faceColors[i];
                    this.faceColors[i] = 127;
                    if (this.faceTextures[i] !== -1) {
                        isTextured = true;
                    }
                } else {
                    this.textureCoords[i] = -1;
                    this.faceTextures[i] = -1;
                }
            }

            if (this.faceRenderPriorities) {
                this.faceRenderPriorities[i] = loader.face3.readByte();
            }

            if (this.faceAlphas) {
                this.faceAlphas[i] = loader.face4.readByte();
            }

            if (this.faceSkins) {
                this.faceSkins[i] = loader.face5.readUnsignedByte();
            }
        }

        loader.vertex1.offset = meta.faceVerticesOffset;
        loader.vertex2.offset = meta.faceOrientationsOffset;

        let index1 = 0;
        let index2 = 0;
        let index3 = 0;
        let lastIndex = 0;

        this.usedVertexCount = -1;
        for (let i = 0; i < this.faceCount; i++) {
            const type = loader.vertex2.readUnsignedByte();
            if (type === 1) {
                index1 = loader.vertex1.readSmart2() + lastIndex;
                index2 = loader.vertex1.readSmart2() + index1;
                index3 = loader.vertex1.readSmart2() + index2;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
                if (index1 > this.usedVertexCount) {
                    this.usedVertexCount = index1;
                }
                if (index2 > this.usedVertexCount) {
                    this.usedVertexCount = index2;
                }
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }

            if (type === 2) {
                index2 = index3;
                index3 = loader.vertex1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }

            if (type === 3) {
                index1 = index3;
                index3 = loader.vertex1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = index2;
                this.indices3[i] = index3;
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }

            if (type === 4) {
                const temp = index1;
                index1 = index2;
                index2 = temp;
                index3 = loader.vertex1.readSmart2() + lastIndex;
                lastIndex = index3;
                this.indices1[i] = index1;
                this.indices2[i] = temp;
                this.indices3[i] = index3;
                if (index3 > this.usedVertexCount) {
                    this.usedVertexCount = index3;
                }
            }
        }
        this.usedVertexCount++;

        loader.axis.offset = meta.faceTextureAxisOffset * 6;

        for (let i = 0; i < this.textureFaceCount; i++) {
            this.textureRenderTypes[i] = 0;
            this.textureMappingP[i] = loader.axis.readUnsignedShort();
            this.textureMappingM[i] = loader.axis.readUnsignedShort();
            this.textureMappingN[i] = loader.axis.readUnsignedShort();
        }

        if (this.textureCoords) {
            let hasValidTexFace = false;

            for (let i = 0; i < this.faceCount; i++) {
                const index = this.textureCoords[i] & 255;
                if (index !== 255) {
                    if (
                        this.indices1[i] === (this.textureMappingP[index] & 0xffff) &&
                        this.indices2[i] === (this.textureMappingM[index] & 0xffff) &&
                        this.indices3[i] === (this.textureMappingN[index] & 0xffff)
                    ) {
                        this.textureCoords[i] = -1;
                    } else {
                        hasValidTexFace = true;
                    }
                }
            }

            if (!hasValidTexFace) {
                this.textureCoords = undefined;
            }
        }

        if (!isTextured) {
            this.faceTextures = undefined;
        }

        if (!hasRenderType) {
            this.faceRenderTypes = undefined;
        }
    }

    copyFrom(
        model: ModelData,
        shallowIndices: boolean,
        shallowVertices: boolean,
        shallowColors: boolean,
        shallowTextures: boolean,
    ): void {
        this.verticesCount = model.verticesCount;
        this.usedVertexCount = model.usedVertexCount;
        this.faceCount = model.faceCount;
        this.textureFaceCount = model.textureFaceCount;

        if (shallowIndices) {
            this.indices1 = model.indices1;
            this.indices2 = model.indices2;
            this.indices3 = model.indices3;
        } else {
            this.indices1 = new Int32Array(this.faceCount);
            this.indices2 = new Int32Array(this.faceCount);
            this.indices3 = new Int32Array(this.faceCount);

            for (let i = 0; i < this.faceCount; i++) {
                this.indices1[i] = model.indices1[i];
                this.indices2[i] = model.indices2[i];
                this.indices3[i] = model.indices3[i];
            }
        }

        if (shallowVertices) {
            this.verticesX = model.verticesX;
            this.verticesY = model.verticesY;
            this.verticesZ = model.verticesZ;
        } else {
            this.verticesX = new Int32Array(this.verticesCount);
            this.verticesY = new Int32Array(this.verticesCount);
            this.verticesZ = new Int32Array(this.verticesCount);

            for (let i = 0; i < this.verticesCount; i++) {
                this.verticesX[i] = model.verticesX[i];
                this.verticesY[i] = model.verticesY[i];
                this.verticesZ[i] = model.verticesZ[i];
            }
        }

        if (shallowColors) {
            this.faceColors = model.faceColors;
        } else {
            this.faceColors = new Uint16Array(this.faceCount);

            for (let i = 0; i < this.faceCount; i++) {
                this.faceColors[i] = model.faceColors[i];
            }
        }

        if (!shallowTextures && model.faceTextures) {
            this.faceTextures = new Int16Array(this.faceCount);

            for (let i = 0; i < this.faceCount; i++) {
                this.faceTextures[i] = model.faceTextures[i];
            }
        } else {
            this.faceTextures = model.faceTextures;
        }

        this.faceAlphas = model.faceAlphas;
        this.faceRenderTypes = model.faceRenderTypes;
        this.faceRenderPriorities = model.faceRenderPriorities;
        this.textureCoords = model.textureCoords;
        this.priority = model.priority;
        this.textureRenderTypes = model.textureRenderTypes;
        this.textureMappingP = model.textureMappingP;
        this.textureMappingM = model.textureMappingM;
        this.textureMappingN = model.textureMappingN;
        this.textureScaleX = model.textureScaleX;
        this.textureScaleY = model.textureScaleY;
        this.textureScaleZ = model.textureScaleZ;
        this.textureRotation = model.textureRotation;
        this.textureDirection = model.textureDirection;
        this.textureSpeed = model.textureSpeed;
        this.textureTransU = model.textureTransU;
        this.textureTransV = model.textureTransV;
        this.vertexSkins = model.vertexSkins;
        this.faceSkins = model.faceSkins;
        this.vertexLabels = model.vertexLabels;
        this.faceLabels = model.faceLabels;
        this.normals = model.normals;
        this.faceNormals = model.faceNormals;
        this.mergedNormals = model.mergedNormals;
        this.animMayaGroups = model.animMayaGroups;
        this.animMayaScales = model.animMayaScales;
        this.ambient = model.ambient;
        this.contrast = model.contrast;
    }

    copy(): ModelData {
        const model = new ModelData();
        if (this.faceRenderTypes) {
            model.faceRenderTypes = new Int8Array(this.faceCount);

            for (let i = 0; i < this.faceCount; i++) {
                model.faceRenderTypes[i] = this.faceRenderTypes[i];
            }
        }

        model.verticesCount = this.verticesCount;
        model.usedVertexCount = this.usedVertexCount;
        model.faceCount = this.faceCount;
        model.textureFaceCount = this.textureFaceCount;
        model.verticesX = this.verticesX;
        model.verticesY = this.verticesY;
        model.verticesZ = this.verticesZ;
        model.indices1 = this.indices1;
        model.indices2 = this.indices2;
        model.indices3 = this.indices3;
        model.faceRenderPriorities = this.faceRenderPriorities;
        model.faceAlphas = this.faceAlphas;
        model.textureCoords = this.textureCoords;
        model.faceColors = this.faceColors;
        model.faceTextures = this.faceTextures;
        model.priority = this.priority;
        model.textureRenderTypes = this.textureRenderTypes;
        model.textureMappingP = this.textureMappingP;
        model.textureMappingM = this.textureMappingM;
        model.textureMappingN = this.textureMappingN;
        model.textureScaleX = this.textureScaleX;
        model.textureScaleY = this.textureScaleY;
        model.textureScaleZ = this.textureScaleZ;
        model.textureRotation = this.textureRotation;
        model.textureDirection = this.textureDirection;
        model.textureSpeed = this.textureSpeed;
        model.textureTransU = this.textureTransU;
        model.textureTransV = this.textureTransV;
        model.vertexSkins = this.vertexSkins;
        model.faceSkins = this.faceSkins;
        model.vertexLabels = this.vertexLabels;
        model.faceLabels = this.faceLabels;
        model.normals = this.normals;
        model.faceNormals = this.faceNormals;
        model.ambient = this.ambient;
        model.contrast = this.contrast;
        return model;
    }

    contourGround(
        type: ContourGroundType,
        param: number,
        heightMap: Int32Array[],
        heightMapAbove: Int32Array[] | undefined,
        sceneX: number,
        sceneHeight: number,
        sceneZ: number,
    ): ModelData {
        if (this.usedVertexCount === 0) {
            return this;
        }
        this.calculateBounds();
        let startX = sceneX + this.minX;
        let endX = sceneX + this.maxX;
        let startY = sceneZ + this.minZ;
        let endY = sceneZ + this.maxZ;
        if (
            (type === ContourGroundType.WarpToTerrain ||
                type === ContourGroundType.WarpToTerrainFadeByVertexHeight ||
                type === ContourGroundType.AlignToSlope ||
                type === ContourGroundType.WarpBetweenPlanes) &&
            (startX < 0 ||
                (endX + 128) >> 7 >= heightMap.length ||
                startY < 0 ||
                (endY + 128) >> 7 >= heightMap[0].length)
        ) {
            return this;
        }
        if (type === ContourGroundType.WarpToPlaneAbove || type === ContourGroundType.WarpBetweenPlanes) {
            if (heightMapAbove === undefined) {
                return this;
            }
            if (
                startX < 0 ||
                (endX + 128) >> 7 >= heightMapAbove.length ||
                startY < 0 ||
                (endY + 128) >> 7 >= heightMapAbove[0].length
            ) {
                return this;
            }
        } else {
            startX >>= 7;
            endX = (endX + 127) >> 7;
            startY >>= 7;
            endY = (endY + 127) >> 7;
            if (
                heightMap[startX][startY] === sceneHeight &&
                heightMap[endX][startY] === sceneHeight &&
                heightMap[startX][endY] === sceneHeight &&
                heightMap[endX][endY] === sceneHeight
            ) {
                return this;
            }
        }
        const model = new ModelData();
        model.verticesCount = this.verticesCount;
        model.usedVertexCount = this.usedVertexCount;
        model.faceCount = this.faceCount;
        model.textureFaceCount = this.textureFaceCount;
        model.verticesX = this.verticesX;
        model.verticesZ = this.verticesZ;
        model.indices1 = this.indices1;
        model.indices2 = this.indices2;
        model.indices3 = this.indices3;
        model.faceRenderTypes = this.faceRenderTypes;
        model.faceRenderPriorities = this.faceRenderPriorities;
        model.faceAlphas = this.faceAlphas;
        model.textureCoords = this.textureCoords;
        model.faceColors = this.faceColors;
        model.faceTextures = this.faceTextures;
        model.priority = this.priority;
        model.textureRenderTypes = this.textureRenderTypes;
        model.textureMappingP = this.textureMappingP;
        model.textureMappingM = this.textureMappingM;
        model.textureMappingN = this.textureMappingN;
        model.textureScaleX = this.textureScaleX;
        model.textureScaleY = this.textureScaleY;
        model.textureScaleZ = this.textureScaleZ;
        model.textureRotation = this.textureRotation;
        model.textureDirection = this.textureDirection;
        model.textureSpeed = this.textureSpeed;
        model.textureTransU = this.textureTransU;
        model.textureTransV = this.textureTransV;
        model.vertexSkins = this.vertexSkins;
        model.faceSkins = this.faceSkins;
        model.vertexLabels = this.vertexLabels;
        model.faceLabels = this.faceLabels;
        model.ambient = this.ambient;
        model.contrast = this.contrast;
        model.verticesY = this.verticesY;
        model.contourVerticesY = new Int32Array(model.verticesCount);

        if (type === ContourGroundType.AlignToSlope) {
            const paramU16 = param & 0xffff;
            const sizeX = (paramU16 & 0xff) * 4;
            const sizeZ = ((paramU16 >> 8) & 0xff) * 4;

            model.verticesX = this.verticesX.slice();
            model.verticesY = this.verticesY.slice();
            model.verticesZ = this.verticesZ.slice();
            model.contourVerticesY = undefined;

            const halfSizeX = (sizeX / 2) | 0;
            const halfSizeZ = (sizeZ / 2) | 0;

            const h00 = ModelData.sampleHeightMap(heightMap, sceneX - halfSizeX, sceneZ - halfSizeZ);
            const h10 = ModelData.sampleHeightMap(heightMap, sceneX + halfSizeX, sceneZ - halfSizeZ);
            const h01 = ModelData.sampleHeightMap(heightMap, sceneX - halfSizeX, sceneZ + halfSizeZ);
            const h11 = ModelData.sampleHeightMap(heightMap, sceneX + halfSizeX, sceneZ + halfSizeZ);

            const minTop = Math.min(h00, h10);
            const minBottom = Math.min(h01, h11);
            const minRight = Math.min(h10, h11);
            const minLeft = Math.min(h00, h01);

            const angleFactor = 2048.0 / (2.0 * Math.PI);
            if (sizeZ !== 0) {
                const pitch = (Math.atan2(minTop - minBottom, sizeZ) * angleFactor) & 0x7ff;
                if (pitch !== 0) {
                    model.rotateX(pitch);
                }
            }
            if (sizeX !== 0) {
                const roll = (Math.atan2(minLeft - minRight, sizeX) * angleFactor) & 0x7ff;
                if (roll !== 0) {
                    model.rotateZ(roll);
                }
            }

            let diagSumMin = h00 + h11;
            const otherDiagSum = h10 + h01;
            if (otherDiagSum < diagSumMin) {
                diagSumMin = otherDiagSum;
            }
            const yOffset = (diagSumMin >> 1) - sceneHeight;
            if (yOffset !== 0) {
                model.translate(0, yOffset, 0);
            }

            model.invalidate();
            return model;
        }

        if (type === ContourGroundType.WarpToTerrain) {
            for (let i = 0; i < model.usedVertexCount; i++) {
                const vx = this.verticesX[i] + sceneX;
                const vz = this.verticesZ[i] + sceneZ;
                const rx = vx & 0x7f;
                const rz = vz & 0x7f;
                const tx = vx >> 7;
                const tz = vz >> 7;
                const h0 = (heightMap[tx][tz] * (128 - rx) + heightMap[tx + 1][tz] * rx) >> 7;
                const h1 =
                    (heightMap[tx][tz + 1] * (128 - rx) + heightMap[tx + 1][tz + 1] * rx) >> 7;
                const height = (h0 * (128 - rz) + h1 * rz) >> 7;
                model.contourVerticesY[i] = this.verticesY[i] + height - sceneHeight;
            }
            for (let i = model.usedVertexCount; i < model.verticesCount; i++) {
                const vx = this.verticesX[i] + sceneX;
                const vz = this.verticesZ[i] + sceneZ;
                const rx = vx & 0x7f;
                const rz = vz & 0x7f;
                const tx = vx >> 7;
                const tz = vz >> 7;
                if (
                    tx >= 0 &&
                    tx < heightMap.length - 1 &&
                    tz >= 0 &&
                    tz < heightMap[0].length - 1
                ) {
                    const h0 = (heightMap[tx][tz] * (128 - rx) + heightMap[tx + 1][tz] * rx) >> 7;
                    const h1 =
                        (heightMap[tx][tz + 1] * (128 - rx) + heightMap[tx + 1][tz + 1] * rx) >> 7;
                    const height = (h0 * (128 - rz) + h1 * rz) >> 7;
                    model.contourVerticesY[i] = this.verticesY[i] + height - sceneHeight;
                }
            }
        } else if (type === ContourGroundType.WarpToTerrainFadeByVertexHeight) {
            for (let i = 0; i < model.usedVertexCount; i++) {
                const yRatio = ((this.verticesY[i] << 16) / -this.height) | 0;
                if (yRatio < param) {
                    const vx = this.verticesX[i] + sceneX;
                    const vz = this.verticesZ[i] + sceneZ;
                    const rx = vx & 0x7f;
                    const rz = vz & 0x7f;
                    const tx = vx >> 7;
                    const tz = vz >> 7;
                    const h0 = (heightMap[tx][tz] * (128 - rx) + heightMap[tx + 1][tz] * rx) >> 7;
                    const h1 =
                        (heightMap[tx][tz + 1] * (128 - rx) + heightMap[tx + 1][tz + 1] * rx) >> 7;
                    const height = (h0 * (128 - rz) + h1 * rz) >> 7;
                    model.contourVerticesY[i] =
                        this.verticesY[i] + ((height - sceneHeight) * (param - yRatio)) / param;
                } else {
                    model.contourVerticesY[i] = this.verticesY[i];
                }
            }
            for (let i = model.usedVertexCount; i < model.verticesCount; i++) {
                const yRatio = ((this.verticesY[i] << 16) / -this.height) | 0;
                if (yRatio < param) {
                    const vx = this.verticesX[i] + sceneX;
                    const vz = this.verticesZ[i] + sceneZ;
                    const rx = vx & 0x7f;
                    const rz = vz & 0x7f;
                    const tx = vx >> 7;
                    const tz = vz >> 7;
                    if (
                        tx >= 0 &&
                        tx < heightMap.length - 1 &&
                        tz >= 0 &&
                        tz < heightMap[0].length - 1
                    ) {
                        const h0 =
                            (heightMap[tx][tz] * (128 - rx) + heightMap[tx + 1][tz] * rx) >> 7;
                        const h1 =
                            (heightMap[tx][tz + 1] * (128 - rx) + heightMap[tx + 1][tz + 1] * rx) >>
                            7;
                        const height = (h0 * (128 - rz) + h1 * rz) >> 7;
                        model.contourVerticesY[i] =
                            this.verticesY[i] + ((height - sceneHeight) * (param - yRatio)) / param;
                    }
                } else {
                    model.contourVerticesY[i] = this.verticesY[i];
                }
            }
        } else if (type === ContourGroundType.WarpToPlaneAbove) {
            const deltaY = this.maxY - this.minY;
            for (let i = 0; i < model.usedVertexCount; i++) {
                const vx = this.verticesX[i] + sceneX;
                const vz = this.verticesZ[i] + sceneZ;
                const rx = vx & 0x7f;
                const rz = vz & 0x7f;
                const tx = vx >> 7;
                const tz = vz >> 7;
                const h0 =
                    (heightMapAbove![tx][tz] * (128 - rx) + heightMapAbove![tx + 1][tz] * rx) >> 7;
                const h1 =
                    (heightMapAbove![tx][tz + 1] * (128 - rx) +
                        heightMapAbove![tx + 1][tz + 1] * rx) >>
                    7;
                const height = (h0 * (128 - rz) + h1 * rz) >> 7;
                model.contourVerticesY[i] = this.verticesY[i] + height - sceneHeight + deltaY;
            }
        } else if (type === ContourGroundType.WarpBetweenPlanes) {
            const deltaY = this.maxY - this.minY;
            for (let i = 0; i < model.usedVertexCount; i++) {
                const vx = this.verticesX[i] + sceneX;
                const vz = this.verticesZ[i] + sceneZ;
                const rx = vx & 0x7f;
                const rz = vz & 0x7f;
                const tx = vx >> 7;
                const tz = vz >> 7;
                let h0 = (heightMap[tx][tz] * (128 - rx) + heightMap[tx + 1][tz] * rx) >> 7;
                let h1 = (heightMap[tx][tz + 1] * (128 - rx) + heightMap[tx + 1][tz + 1] * rx) >> 7;
                const height = (h0 * (128 - rz) + h1 * rz) >> 7;
                h0 = (heightMapAbove![tx][tz] * (128 - rx) + heightMapAbove![tx + 1][tz] * rx) >> 7;
                h1 =
                    (heightMapAbove![tx][tz + 1] * (128 - rx) +
                        heightMapAbove![tx + 1][tz + 1] * rx) >>
                    7;
                const heightAbove = (h0 * (128 - rz) + h1 * rz) >> 7;
                const deltaHeight = height - heightAbove;

                model.contourVerticesY[i] =
                    (((((this.verticesY[i] << 8) / deltaY) | 0) * deltaHeight) >> 8) -
                    (sceneHeight - height);

                // there is something wrong with this calculation, possibly something to do with scaling down
                // model.contourVerticesY[i] -= 13;
                // model.contourVerticesY[i] = this.verticesY[i];
            }
        }

        model.invalidate();
        return model;
    }

    static sampleHeightMap(heightMap: Int32Array[], x: number, z: number): number {
        const tileX = x >> 7;
        const tileZ = z >> 7;
        if (
            tileX < 0 ||
            tileZ < 0 ||
            tileX >= heightMap.length - 1 ||
            tileZ >= heightMap[0].length - 1
        ) {
            return 0;
        }
        const rx = x & 0x7f;
        const rz = z & 0x7f;
        const h0 =
            (heightMap[tileX][tileZ] * (128 - rx) + heightMap[tileX + 1][tileZ] * rx) >> 7;
        const h1 =
            (heightMap[tileX][tileZ + 1] * (128 - rx) + heightMap[tileX + 1][tileZ + 1] * rx) >>
            7;
        return (h0 * (128 - rz) + h1 * rz) >> 7;
    }

    computeAnimationTables(): void {
        let skin: number;
        if (this.vertexSkins) {
            const labelCounts: number[] = new Array(256).fill(0);
            let highestSkin = 0;

            const vertexCount = this.usedVertexCount;
            for (let i = 0; i < vertexCount; i++) {
                skin = this.vertexSkins[i];
                if (skin >= 0) {
                    labelCounts[skin]++;
                    if (skin > highestSkin) {
                        highestSkin = skin;
                    }
                }
            }

            this.vertexLabels = new Array(highestSkin + 1);

            for (let i = 0; i <= highestSkin; i++) {
                this.vertexLabels[i] = new Int32Array(labelCounts[i]);
                labelCounts[i] = 0;
            }

            for (let label = 0; label < vertexCount; label++) {
                const skin = this.vertexSkins[label];
                if (skin >= 0) {
                    this.vertexLabels[skin][labelCounts[skin]++] = label;
                }
            }

            this.vertexSkins = undefined;
        }

        if (this.faceSkins) {
            const labelCounts: number[] = new Array(256).fill(0);
            let highestSkin = 0;

            for (let i = 0; i < this.faceCount; i++) {
                skin = this.faceSkins[i];
                if (skin >= 0) {
                    labelCounts[skin]++;
                    if (skin > highestSkin) {
                        highestSkin = skin;
                    }
                }
            }

            this.faceLabels = new Array(highestSkin + 1);

            for (let i = 0; i <= highestSkin; i++) {
                this.faceLabels[i] = new Int32Array(labelCounts[i]);
                labelCounts[i] = 0;
            }

            for (let label = 0; label < this.faceCount; label++) {
                const skin = this.faceSkins[label];
                if (skin >= 0) {
                    this.faceLabels[skin][labelCounts[skin]++] = label;
                }
            }

            this.faceSkins = undefined;
        }
    }

    rotate90(): void {
        for (let i = 0; i < this.verticesCount; i++) {
            const temp = this.verticesX[i];
            this.verticesX[i] = this.verticesZ[i];
            this.verticesZ[i] = -temp;
        }

        this.invalidate();
    }

    rotate180(): void {
        for (let i = 0; i < this.verticesCount; i++) {
            this.verticesX[i] = -this.verticesX[i];
            this.verticesZ[i] = -this.verticesZ[i];
        }

        this.invalidate();
    }

    rotate270(): void {
        for (let i = 0; i < this.verticesCount; i++) {
            const temp = this.verticesZ[i];
            this.verticesZ[i] = this.verticesX[i];
            this.verticesX[i] = -temp;
        }

        this.invalidate();
    }

    rotate(angle: number): void {
        const sin = SINE[angle];
        const cos = COSINE[angle];

        for (let i = 0; i < this.verticesCount; i++) {
            const temp = (sin * this.verticesZ[i] + cos * this.verticesX[i]) >> 16;
            this.verticesZ[i] = (cos * this.verticesZ[i] - sin * this.verticesX[i]) >> 16;
            this.verticesX[i] = temp;
        }

        this.invalidate();
    }

    rotateX(angle: number): void {
        const sin = SINE[angle];
        const cos = COSINE[angle];
        for (let i = 0; i < this.verticesCount; i++) {
            const y = this.verticesY[i];
            const z = this.verticesZ[i];
            this.verticesY[i] = (y * cos - z * sin) >> 16;
            this.verticesZ[i] = (y * sin + z * cos) >> 16;
        }
        this.invalidate();
    }

    rotateZ(angle: number): void {
        const sin = SINE[angle];
        const cos = COSINE[angle];
        for (let i = 0; i < this.verticesCount; i++) {
            const x = this.verticesX[i];
            const y = this.verticesY[i];
            this.verticesX[i] = (x * cos - y * sin) >> 16;
            this.verticesY[i] = (x * sin + y * cos) >> 16;
        }
        this.invalidate();
    }

    translate(x: number, y: number, z: number): void {
        for (let i = 0; i < this.verticesCount; i++) {
            this.verticesX[i] += x;
            this.verticesY[i] += y;
            this.verticesZ[i] += z;
        }

        this.invalidate();
    }

    recolor(from: number, to: number): void {
        for (let i = 0; i < this.faceCount; i++) {
            if (this.faceColors[i] === from) {
                this.faceColors[i] = to;
            }
        }
    }

    retexture(from: number, to: number): void {
        if (this.faceTextures) {
            for (let i = 0; i < this.faceCount; i++) {
                if (this.faceTextures[i] === from) {
                    this.faceTextures[i] = to;
                }
            }
        }
    }

    mirror() {
        for (let i = 0; i < this.verticesCount; i++) {
            this.verticesZ[i] = -this.verticesZ[i];
        }

        for (let i = 0; i < this.faceCount; i++) {
            const temp = this.indices1[i];
            this.indices1[i] = this.indices3[i];
            this.indices3[i] = temp;
        }

        this.invalidate();
    }

    resize(resizeX: number, resizeY: number, resizeZ: number): void {
        for (let i = 0; i < this.verticesCount; i++) {
            this.verticesX[i] = ((this.verticesX[i] * resizeX) / 128) | 0;
            this.verticesY[i] = ((this.verticesY[i] * resizeY) / 128) | 0;
            this.verticesZ[i] = ((this.verticesZ[i] * resizeZ) / 128) | 0;
        }

        this.invalidate();
    }

    calculateVertexNormals(): void {
        if (!this.normals) {
            this.normals = new Array(this.usedVertexCount);

            for (let i = 0; i < this.usedVertexCount; i++) {
                this.normals[i] = new VertexNormal();
            }

            const verticesY = this.contourVerticesY || this.verticesY;

            for (let i = 0; i < this.faceCount; i++) {
                const indexA = this.indices1[i];
                const indexB = this.indices2[i];
                const indexC = this.indices3[i];
                const dxAB = this.verticesX[indexB] - this.verticesX[indexA];
                const dyAB = verticesY[indexB] - verticesY[indexA];
                const dzAB = this.verticesZ[indexB] - this.verticesZ[indexA];
                const dxAC = this.verticesX[indexC] - this.verticesX[indexA];
                const dyAC = verticesY[indexC] - verticesY[indexA];
                const dzAC = this.verticesZ[indexC] - this.verticesZ[indexA];
                let normalX = dyAB * dzAC - dyAC * dzAB;
                let normalY = dzAB * dxAC - dzAC * dxAB;
                let normalZ = dxAB * dyAC - dxAC * dyAB;

                while (
                    normalX > 8192 ||
                    normalY > 8192 ||
                    normalZ > 8192 ||
                    normalX < -8192 ||
                    normalY < -8192 ||
                    normalZ < -8192
                ) {
                    normalX >>= 1;
                    normalY >>= 1;
                    normalZ >>= 1;
                }

                let normalLength =
                    Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ) | 0;
                if (normalLength <= 0) {
                    normalLength = 1;
                }

                normalX = ((normalX * 256) / normalLength) | 0;
                normalY = ((normalY * 256) / normalLength) | 0;
                normalZ = ((normalZ * 256) / normalLength) | 0;
                let type;
                if (!this.faceRenderTypes) {
                    type = 0;
                } else {
                    type = this.faceRenderTypes[i];
                }

                if (type === 0) {
                    let normal = this.normals[indexA];
                    normal.x += normalX;
                    normal.y += normalY;
                    normal.z += normalZ;
                    normal.magnitude++;
                    normal = this.normals[indexB];
                    normal.x += normalX;
                    normal.y += normalY;
                    normal.z += normalZ;
                    normal.magnitude++;
                    normal = this.normals[indexC];
                    normal.x += normalX;
                    normal.y += normalY;
                    normal.z += normalZ;
                    normal.magnitude++;
                } else if (type === 1) {
                    if (!this.faceNormals) {
                        this.faceNormals = new Array(this.faceCount);
                    }

                    this.faceNormals[i] = new FaceNormal(normalX, normalY, normalZ);
                }
            }
        }
    }

    invalidate(): void {
        this.normals = undefined;
        this.mergedNormals = undefined;
        this.faceNormals = undefined;
        this.isBoundsCalculated = false;
    }

    calculateBounds(): void {
        if (!this.isBoundsCalculated) {
            this.height = 0;
            this.minHeight = 0;

            this.minX = 999999;
            this.maxX = -999999;

            this.minY = 999999;
            this.maxY = -999999;

            this.minZ = 99999;
            this.maxZ = -99999;

            const verticesY = this.contourVerticesY ?? this.verticesY;

            for (let i = 0; i < this.usedVertexCount; i++) {
                const vertX = this.verticesX[i];
                const vertY = verticesY[i];
                const vertZ = this.verticesZ[i];
                // min/max x
                if (vertX < this.minX) {
                    this.minX = vertX;
                }
                if (vertX > this.maxX) {
                    this.maxX = vertX;
                }

                // min/max y
                if (this.minY > vertY) {
                    this.minY = vertY;
                }
                if (this.maxY < vertY) {
                    this.maxY = vertY;
                }

                // min/max z
                if (vertZ < this.minZ) {
                    this.minZ = vertZ;
                }
                if (vertZ > this.maxZ) {
                    this.maxZ = vertZ;
                }

                // height
                if (-vertY > this.height) {
                    this.height = -vertY;
                }
                if (vertY > this.minHeight) {
                    this.minHeight = vertY;
                }
            }

            this.isBoundsCalculated = true;
        }
    }

    light(
        textureLoader: TextureLoader,
        ambient: number,
        contrast: number,
        lightX: number,
        lightY: number,
        lightZ: number,
    ): Model {
        this.calculateVertexNormals();
        if (!this.normals) {
            throw new Error("Failed to calculate normals. This should not be possible.");
        }
        const magnitude = Math.sqrt(lightZ * lightZ + lightX * lightX + lightY * lightY) | 0;
        const lightIntensity = (magnitude * contrast) >> 8;
        const model = new Model();
        model.faceColors1 = new Int32Array(this.faceCount);
        model.faceColors2 = new Int32Array(this.faceCount);
        model.faceColors3 = new Int32Array(this.faceCount);
        model.faceColors = this.faceColors;

        model.uvs = computeTextureCoords(textureLoader, this);
        if (this.faceTextures) {
            model.faceTextures = new Int16Array(this.faceCount);
            for (let i = 0; i < this.faceCount; i++) {
                const textureId = this.faceTextures[i];
                if (textureId !== -1 && textureLoader.isSd(textureId)) {
                    model.faceTextures[i] = this.faceTextures[i];
                } else {
                    model.faceTextures[i] = -1;
                }
            }
        } else {
            model.faceTextures = undefined;
        }
        if (this.textureFaceCount > 0 && this.textureCoords) {
            const textureCoords = new Int32Array(this.textureFaceCount);

            for (let i = 0; i < this.faceCount; i++) {
                if (this.textureCoords[i] !== -1) {
                    textureCoords[this.textureCoords[i] & 0xff]++;
                }
            }

            model.texTriangleCount = 0;

            for (let i = 0; i < this.textureFaceCount; i++) {
                if (textureCoords[i] > 0 && this.textureRenderTypes[i] === 0) {
                    model.texTriangleCount++;
                }
            }

            model.textureMappingP = new Int32Array(model.texTriangleCount);
            model.textureMappingM = new Int32Array(model.texTriangleCount);
            model.textureMappingN = new Int32Array(model.texTriangleCount);

            let mapIndex = 0;
            for (let i = 0; i < this.textureFaceCount; i++) {
                if (textureCoords[i] > 0 && this.textureRenderTypes[i] === 0) {
                    model.textureMappingP[mapIndex] = this.textureMappingP[i] & 0xffff;
                    model.textureMappingM[mapIndex] = this.textureMappingM[i] & 0xffff;
                    model.textureMappingN[mapIndex] = this.textureMappingN[i] & 0xffff;
                    textureCoords[i] = mapIndex++;
                } else {
                    textureCoords[i] = -1;
                }
            }

            model.textureCoords = new Int8Array(this.faceCount);

            for (let i = 0; i < this.faceCount; i++) {
                if (this.textureCoords[i] !== -1) {
                    model.textureCoords[i] = textureCoords[this.textureCoords[i] & 0xff];
                } else {
                    model.textureCoords[i] = -1;
                }
            }
        }

        for (let i = 0; i < this.faceCount; i++) {
            let type;
            if (!this.faceRenderTypes) {
                type = 0;
            } else {
                type = this.faceRenderTypes[i];
            }

            let alpha;
            if (this.faceAlphas) {
                alpha = this.faceAlphas[i];
            } else {
                alpha = 0;
            }

            let texture;
            if (model.faceTextures) {
                texture = model.faceTextures[i];
            } else {
                texture = -1;
            }

            if (alpha === -2) {
                type = 3;
            }

            if (alpha === -1) {
                type = 2;
            }

            if (texture === -1) {
                if (type === 0) {
                    const color = this.faceColors[i] & 0xffff;

                    let normal: VertexNormal;
                    if (this.mergedNormals && this.mergedNormals[this.indices1[i]]) {
                        normal = this.mergedNormals[this.indices1[i]];
                    } else {
                        normal = this.normals[this.indices1[i]];
                    }
                    let shade17 =
                        (ambient +
                            (lightY * normal.y + lightZ * normal.z + lightX * normal.x) /
                                (lightIntensity * normal.magnitude)) <<
                        17;
                    model.faceColors1[i] =
                        shade17 | ModelData.adjustLightness(color, shade17 >> 17);

                    if (this.mergedNormals && this.mergedNormals[this.indices2[i]]) {
                        normal = this.mergedNormals[this.indices2[i]];
                    } else {
                        normal = this.normals[this.indices2[i]];
                    }
                    shade17 =
                        (ambient +
                            (lightY * normal.y + lightZ * normal.z + lightX * normal.x) /
                                (lightIntensity * normal.magnitude)) <<
                        17;
                    model.faceColors2[i] =
                        shade17 | ModelData.adjustLightness(color, shade17 >> 17);

                    if (this.mergedNormals && this.mergedNormals[this.indices3[i]]) {
                        normal = this.mergedNormals[this.indices3[i]];
                    } else {
                        normal = this.normals[this.indices3[i]];
                    }
                    shade17 =
                        (ambient +
                            (lightY * normal.y + lightZ * normal.z + lightX * normal.x) /
                                (lightIntensity * normal.magnitude)) <<
                        17;
                    model.faceColors3[i] =
                        shade17 | ModelData.adjustLightness(color, shade17 >> 17);
                } else if (type === 1 && this.faceNormals) {
                    const normal = this.faceNormals[i];
                    const shade17 =
                        (ambient +
                            (lightY * normal.y + lightZ * normal.z + lightX * normal.x) /
                                ((lightIntensity >> 1) + lightIntensity)) <<
                        17;
                    model.faceColors1[i] =
                        shade17 |
                        ModelData.adjustLightness(this.faceColors[i] & 0xffff, shade17 >> 17);
                    model.faceColors3[i] = -1;
                } else if (type === 3) {
                    model.faceColors1[i] = 128;
                    model.faceColors3[i] = -1;
                } else {
                    model.faceColors3[i] = -2;
                }
            } else if (type === 0) {
                let normal: VertexNormal;
                if (this.mergedNormals && this.mergedNormals[this.indices1[i]]) {
                    normal = this.mergedNormals[this.indices1[i]];
                } else {
                    normal = this.normals[this.indices1[i]];
                }

                let lightness =
                    ambient +
                    (lightY * normal.y + lightZ * normal.z + lightX * normal.x) /
                        (lightIntensity * normal.magnitude);
                model.faceColors1[i] = ModelData.clampLightness(lightness);
                if (this.mergedNormals && this.mergedNormals[this.indices2[i]]) {
                    normal = this.mergedNormals[this.indices2[i]];
                } else {
                    normal = this.normals[this.indices2[i]];
                }

                lightness =
                    ambient +
                    (lightY * normal.y + lightZ * normal.z + lightX * normal.x) /
                        (lightIntensity * normal.magnitude);
                model.faceColors2[i] = ModelData.clampLightness(lightness);
                if (this.mergedNormals && this.mergedNormals[this.indices3[i]]) {
                    normal = this.mergedNormals[this.indices3[i]];
                } else {
                    normal = this.normals[this.indices3[i]];
                }

                lightness =
                    ambient +
                    (lightY * normal.y + lightZ * normal.z + lightX * normal.x) /
                        (lightIntensity * normal.magnitude);
                model.faceColors3[i] = ModelData.clampLightness(lightness);
            } else if (type === 1 && this.faceNormals) {
                const normal = this.faceNormals[i];
                const lightness =
                    ambient +
                    (lightY * normal.y + lightZ * normal.z + lightX * normal.x) /
                        ((lightIntensity >> 1) + lightIntensity);
                model.faceColors1[i] = ModelData.clampLightness(lightness);
                model.faceColors3[i] = -1;
            } else {
                model.faceColors3[i] = -2;
            }
        }

        this.computeAnimationTables();
        model.verticesCount = this.verticesCount;
        model.usedVertexCount = this.usedVertexCount;
        model.verticesX = this.verticesX;
        model.verticesY = this.verticesY;
        model.verticesZ = this.verticesZ;
        model.contourVerticesY = this.contourVerticesY;
        model.faceCount = this.faceCount;
        model.indices1 = this.indices1;
        model.indices2 = this.indices2;
        model.indices3 = this.indices3;
        model.faceRenderPriorities = this.faceRenderPriorities;
        model.faceAlphas = this.faceAlphas;
        model.priority = this.priority;
        model.vertexLabels = this.vertexLabels;
        model.faceLabels = this.faceLabels;
        // model.faceTextures = this.faceTextures;
        model.textureScaleX = this.textureScaleX;
        model.textureScaleY = this.textureScaleY;
        model.textureScaleZ = this.textureScaleZ;
        model.textureRotation = this.textureRotation;
        model.textureDirection = this.textureDirection;
        model.textureSpeed = this.textureSpeed;
        model.textureTransU = this.textureTransU;
        model.textureTransV = this.textureTransV;
        model.animMayaGroups = this.animMayaGroups;
        model.animMayaScales = this.animMayaScales;
        return model;
    }
}
