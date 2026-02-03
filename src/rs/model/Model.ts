import { mat4, vec3 } from "gl-matrix";

import { COSINE, SINE } from "../MathConstants";
import { Entity } from "../core/Entity";
import { ContourGroundType } from "./ContourGroundType";
import { ModelData } from "./ModelData";
import { SeqBase } from "./seq/SeqBase";
import { SeqFrame } from "./seq/SeqFrame";
import { SeqTransformType } from "./seq/SeqTransformType";
import { SkeletalBase } from "./skeletal/SkeletalBase";
import { SkeletalPools } from "./skeletal/SkeletalPools";
import { SkeletalSeq } from "./skeletal/SkeletalSeq";

export class Model extends Entity {
    private animateOriginX: number = 0;
    private animateOriginY: number = 0;
    private animateOriginZ: number = 0;

    private readonly skeletalTransformMatrix: mat4 = mat4.create();
    private readonly skeletalScalingMatrix: mat4 = mat4.create();
    private readonly skeletalBoneMatrix: mat4 = mat4.create();
    private readonly skeletalScaleVector = vec3.create();
    private readonly skeletalPools = new SkeletalPools();

    version: number = 0;

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

    faceColors1!: Int32Array;
    faceColors2!: Int32Array;
    faceColors3!: Int32Array;

    // For animations
    faceColors!: Uint16Array;
    changedLight: boolean = false;

    faceRenderPriorities!: Int8Array;
    faceAlphas!: Int8Array;

    textureCoords!: Int8Array;

    faceTextures?: Int16Array;

    priority: number;

    texTriangleCount: number;
    textureRenderTypes!: Int8Array;

    textureMappingP!: Int32Array;
    textureMappingM!: Int32Array;
    textureMappingN!: Int32Array;

    textureScaleX!: Int32Array;
    textureScaleY!: Int32Array;
    textureScaleZ!: Int32Array;
    textureRotation!: Int8Array;
    textureDirection!: Int8Array;
    textureSpeed!: Int32Array;

    textureTransU!: Int32Array;
    textureTransV!: Int32Array;

    uvs?: Float32Array;

    vertexLabels!: Int32Array[];
    faceLabels!: Int32Array[];

    animMayaGroups!: Int32Array[];
    animMayaScales!: Int32Array[];

    isClickable: boolean;

    boundsType!: number;
    bottomY!: number;
    xzRadius!: number;
    diameter!: number;
    radius!: number;

    minHeight!: number;
    minX!: number;
    maxX!: number;
    minY!: number;
    maxY!: number;
    maxZ!: number;
    minZ!: number;

    xMid!: number;
    yMid!: number;
    zMid!: number;

    xMidOffset: number;
    yMidOffset: number;
    zMidOffset: number;

    overrideHue!: number;
    overrideSaturation!: number;
    overrideLightness!: number;
    overrideAmount!: number;

    contourHeight: number = 0;

    static copy(model: Model): Model {
        return Model.merge([model], 1);
    }

    static copyAnimated(
        model: Model,
        shallowTransparencies: boolean,
        shallowColors: boolean,
    ): Model {
        const copy: Model = Object.assign(Object.create(Object.getPrototypeOf(model)), model);
        // const copy = new Model();

        copy.verticesX = new Int32Array(model.verticesCount);
        copy.verticesY = new Int32Array(model.verticesCount);
        copy.verticesZ = new Int32Array(model.verticesCount);

        for (let i = 0; i < model.verticesCount; i++) {
            copy.verticesX[i] = model.verticesX[i];
            copy.verticesY[i] = model.verticesY[i];
            copy.verticesZ[i] = model.verticesZ[i];
        }

        if (shallowTransparencies) {
            copy.faceAlphas = model.faceAlphas;
        } else {
            copy.faceAlphas = new Int8Array(model.faceCount);
            if (model.faceAlphas) {
                for (let i = 0; i < model.faceCount; i++) {
                    copy.faceAlphas[i] = model.faceAlphas[i];
                }
            } else {
                copy.faceAlphas.fill(0);
            }
        }

        if (!shallowColors) {
            copy.faceColors = new Uint16Array(model.faceCount);
            copy.faceColors1 = new Int32Array(model.faceCount);
            copy.faceColors2 = new Int32Array(model.faceCount);
            copy.faceColors3 = new Int32Array(model.faceCount);
            for (let i = 0; i < model.faceCount; i++) {
                copy.faceColors[i] = model.faceColors[i];
                copy.faceColors1[i] = model.faceColors1[i];
                copy.faceColors2[i] = model.faceColors2[i];
                copy.faceColors3[i] = model.faceColors3[i];
            }
        }

        return copy;
    }

    static merge(models: Model[], count: number): Model {
        const model = new Model();
        model.merge(models, count);
        return model;
    }

    private resetAnimateOrigin(): void {
        this.animateOriginX = 0;
        this.animateOriginY = 0;
        this.animateOriginZ = 0;
    }

    constructor() {
        super();
        this.verticesCount = 0;
        this.usedVertexCount = 0;
        this.faceCount = 0;
        this.priority = 0;
        this.texTriangleCount = 0;
        this.isClickable = false;
        this.xMidOffset = -1;
        this.yMidOffset = -1;
        this.zMidOffset = -1;
    }

    merge(models: Model[], count: number): void {
        let hasRenderPriority = false;
        let hasAlpha = false;
        let hasTexture = false;
        let hasTextureCoord = false;
        this.verticesCount = 0;
        this.faceCount = 0;
        this.texTriangleCount = 0;
        this.priority = -1;

        for (let i = 0; i < count; i++) {
            const model = models[i];
            if (model) {
                this.verticesCount += model.verticesCount;
                this.faceCount += model.faceCount;
                this.texTriangleCount += model.texTriangleCount;
                if (model.faceRenderPriorities) {
                    hasRenderPriority = true;
                } else {
                    if (this.priority === -1) {
                        this.priority = model.priority;
                    }

                    if (this.priority !== model.priority) {
                        hasRenderPriority = true;
                    }
                }

                hasAlpha ||= !!model.faceAlphas;
                hasTexture ||= !!model.faceTextures;
                hasTextureCoord ||= !!model.textureCoords;
            }
        }

        this.verticesX = new Int32Array(this.verticesCount);
        this.verticesY = new Int32Array(this.verticesCount);
        this.verticesZ = new Int32Array(this.verticesCount);
        this.indices1 = new Int32Array(this.faceCount);
        this.indices2 = new Int32Array(this.faceCount);
        this.indices3 = new Int32Array(this.faceCount);
        this.faceColors1 = new Int32Array(this.faceCount);
        this.faceColors2 = new Int32Array(this.faceCount);
        this.faceColors3 = new Int32Array(this.faceCount);
        this.faceColors = new Uint16Array(this.faceCount);
        if (hasRenderPriority) {
            this.faceRenderPriorities = new Int8Array(this.faceCount);
        }

        if (hasAlpha) {
            this.faceAlphas = new Int8Array(this.faceCount);
        }

        if (hasTexture) {
            this.faceTextures = new Int16Array(this.faceCount);
        }

        if (hasTextureCoord) {
            this.textureCoords = new Int8Array(this.faceCount);
        }

        if (this.texTriangleCount > 0) {
            this.textureMappingP = new Int32Array(this.texTriangleCount);
            this.textureMappingM = new Int32Array(this.texTriangleCount);
            this.textureMappingN = new Int32Array(this.texTriangleCount);
            this.textureScaleX = new Int32Array(this.texTriangleCount);
            this.textureScaleY = new Int32Array(this.texTriangleCount);
            this.textureScaleZ = new Int32Array(this.texTriangleCount);
            this.textureRotation = new Int8Array(this.texTriangleCount);
            this.textureDirection = new Int8Array(this.texTriangleCount);
            this.textureSpeed = new Int32Array(this.texTriangleCount);
            this.textureTransU = new Int32Array(this.texTriangleCount);
            this.textureTransV = new Int32Array(this.texTriangleCount);
        }

        this.verticesCount = 0;
        this.faceCount = 0;
        this.texTriangleCount = 0;

        for (let i = 0; i < count; i++) {
            const model = models[i];
            if (model) {
                for (let f = 0; f < model.faceCount; f++) {
                    this.indices1[this.faceCount] = this.verticesCount + model.indices1[f];
                    this.indices2[this.faceCount] = this.verticesCount + model.indices2[f];
                    this.indices3[this.faceCount] = this.verticesCount + model.indices3[f];
                    this.faceColors1[this.faceCount] = model.faceColors1[f];
                    this.faceColors2[this.faceCount] = model.faceColors2[f];
                    this.faceColors3[this.faceCount] = model.faceColors3[f];
                    this.faceColors[this.faceCount] = model.faceColors[f];
                    if (hasRenderPriority) {
                        if (model.faceRenderPriorities) {
                            this.faceRenderPriorities[this.faceCount] =
                                model.faceRenderPriorities[f];
                        } else {
                            this.faceRenderPriorities[this.faceCount] = model.priority;
                        }
                    }

                    if (hasAlpha && model.faceAlphas) {
                        this.faceAlphas[this.faceCount] = model.faceAlphas[f];
                    }

                    if (hasTexture && this.faceTextures) {
                        if (model.faceTextures) {
                            this.faceTextures[this.faceCount] = model.faceTextures[f];
                        } else {
                            this.faceTextures[this.faceCount] = -1;
                        }
                    }

                    if (hasTextureCoord) {
                        if (model.textureCoords && model.textureCoords[f] !== -1) {
                            this.textureCoords[this.faceCount] =
                                this.texTriangleCount + model.textureCoords[f];
                        } else {
                            this.textureCoords[this.faceCount] = -1;
                        }
                    }

                    this.faceCount++;
                }

                for (let v = 0; v < model.texTriangleCount; v++) {
                    this.textureMappingP[this.texTriangleCount] =
                        this.verticesCount + model.textureMappingP[v];
                    this.textureMappingM[this.texTriangleCount] =
                        this.verticesCount + model.textureMappingM[v];
                    this.textureMappingN[this.texTriangleCount] =
                        this.verticesCount + model.textureMappingN[v];
                    this.texTriangleCount++;
                }

                for (let v = 0; v < model.verticesCount; v++) {
                    this.verticesX[this.verticesCount] = model.verticesX[v];
                    this.verticesY[this.verticesCount] = model.verticesY[v];
                    this.verticesZ[this.verticesCount] = model.verticesZ[v];
                    this.verticesCount++;
                }
            }
        }
        this.usedVertexCount = this.verticesCount;
    }

    calculateBoundsCylinder(): void {
        if (this.boundsType !== 1) {
            this.boundsType = 1;
            this.height = 0;
            this.bottomY = 0;
            this.xzRadius = 0;

            for (let i = 0; i < this.usedVertexCount; i++) {
                const vertX = this.verticesX[i];
                const vertY = this.verticesY[i];
                const vertZ = this.verticesZ[i];
                if (-vertY > this.height) {
                    this.height = -vertY;
                }

                if (this.contourVerticesY) {
                    const contourY = this.contourVerticesY[i];
                    if (-contourY > this.contourHeight) {
                        this.contourHeight = -contourY;
                    }
                }

                if (vertY > this.bottomY) {
                    this.bottomY = vertY;
                }

                const xzRadiusSq = vertX * vertX + vertZ * vertZ;
                if (xzRadiusSq > this.xzRadius) {
                    this.xzRadius = xzRadiusSq;
                }
            }

            if (!this.contourVerticesY) {
                this.contourHeight = this.height;
            }

            this.xzRadius = (Math.sqrt(this.xzRadius) + 0.99) | 0;
            this.radius =
                (Math.sqrt(this.xzRadius * this.xzRadius + this.height * this.height) + 0.99) | 0;
            this.diameter =
                (this.radius +
                    (Math.sqrt(this.xzRadius * this.xzRadius + this.bottomY * this.bottomY) +
                        0.99)) |
                0;
        }
    }

    calculateBounds(): void {
        if (this.boundsType !== 2) {
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

            this.boundsType = 2;
        }
    }

    invalidateBounds(): void {
        this.boundsType = 0;
        this.xMidOffset = -1;
    }

    contourGround(
        type: ContourGroundType,
        param: number,
        heightMap: Int32Array[],
        heightMapAbove: Int32Array[] | undefined,
        sceneX: number,
        sceneHeight: number,
        sceneZ: number,
        createNew: boolean = true,
    ): Model {
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
        let model: Model = this;
        if (createNew) {
            model = new Model();
            model.verticesCount = this.verticesCount;
            model.usedVertexCount = this.usedVertexCount;
            model.faceCount = this.faceCount;
            model.texTriangleCount = this.texTriangleCount;
            model.verticesX = this.verticesX;
            model.verticesZ = this.verticesZ;
            model.indices1 = this.indices1;
            model.indices2 = this.indices2;
            model.indices3 = this.indices3;
            model.faceColors1 = this.faceColors1;
            model.faceColors2 = this.faceColors2;
            model.faceColors3 = this.faceColors3;
            model.faceColors = this.faceColors;
            model.faceRenderPriorities = this.faceRenderPriorities;
            model.faceAlphas = this.faceAlphas;
            model.textureCoords = this.textureCoords;
            model.faceTextures = this.faceTextures;
            model.priority = this.priority;
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
            model.uvs = this.uvs;
            model.vertexLabels = this.vertexLabels;
            model.faceLabels = this.faceLabels;
            model.isClickable = this.isClickable;
            model.verticesY = this.verticesY;
        }
        if (type === ContourGroundType.AlignToSlope) {
            // Sample the terrain plane under the model, rotate around X/Z to match the slope, then
            // translate Y to the average height.
            const paramU16 = param & 0xffff;
            const sizeX = (paramU16 & 0xff) * 4;
            const sizeZ = ((paramU16 >> 8) & 0xff) * 4;

            if (createNew) {
                model.verticesX = this.verticesX.slice();
                model.verticesY = this.verticesY.slice();
                model.verticesZ = this.verticesZ.slice();
            }

            const halfSizeX = (sizeX / 2) | 0;
            const halfSizeZ = (sizeZ / 2) | 0;

            const h00 = Model.sampleHeightMap(heightMap, sceneX - halfSizeX, sceneZ - halfSizeZ);
            const h10 = Model.sampleHeightMap(heightMap, sceneX + halfSizeX, sceneZ - halfSizeZ);
            const h01 = Model.sampleHeightMap(heightMap, sceneX - halfSizeX, sceneZ + halfSizeZ);
            const h11 = Model.sampleHeightMap(heightMap, sceneX + halfSizeX, sceneZ + halfSizeZ);

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

            model.contourVerticesY = undefined;
            model.invalidateBounds();
            return model;
        }

        model.contourVerticesY = new Int32Array(model.verticesCount);

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
                } else {
                    model.contourVerticesY[i] = this.verticesY[i];
                }
            }
        } else if (type === ContourGroundType.WarpToTerrainFadeByVertexHeight) {
            for (let i = 0; i < model.usedVertexCount; i++) {
                const yRatio = ((this.verticesY[i] << 16) / this.minY) | 0;
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
                const yRatio = ((this.verticesY[i] << 16) / this.minY) | 0;
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
            if (heightMapAbove === undefined) {
                return this;
            }
            const deltaY = this.maxY - this.minY;
            for (let i = 0; i < model.usedVertexCount; i++) {
                const vx = this.verticesX[i] + sceneX;
                const vz = this.verticesZ[i] + sceneZ;
                const rx = vx & 0x7f;
                const rz = vz & 0x7f;
                const tx = vx >> 7;
                const tz = vz >> 7;
                const h0 =
                    (heightMapAbove[tx][tz] * (128 - rx) + heightMapAbove[tx + 1][tz] * rx) >> 7;
                const h1 =
                    (heightMapAbove[tx][tz + 1] * (128 - rx) +
                        heightMapAbove[tx + 1][tz + 1] * rx) >>
                    7;
                const height = (h0 * (128 - rz) + h1 * rz) >> 7;
                model.contourVerticesY[i] = this.verticesY[i] + height - sceneHeight + deltaY;
            }
        } else if (type === ContourGroundType.WarpBetweenPlanes) {
            if (heightMapAbove === undefined) {
                return this;
            }
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
                h0 = (heightMapAbove[tx][tz] * (128 - rx) + heightMapAbove[tx + 1][tz] * rx) >> 7;
                h1 =
                    (heightMapAbove[tx][tz + 1] * (128 - rx) +
                        heightMapAbove[tx + 1][tz + 1] * rx) >>
                    7;
                const heightAbove = (h0 * (128 - rz) + h1 * rz) >> 7;
                const deltaHeight = height - heightAbove;

                model.contourVerticesY[i] =
                    (((((this.verticesY[i] << 8) / deltaY) | 0) * deltaHeight) >> 8) -
                    (sceneHeight - height);
            }
        }

        model.invalidateBounds();
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

    rotate90(): void {
        for (let i = 0; i < this.verticesCount; i++) {
            const temp = this.verticesX[i];
            this.verticesX[i] = this.verticesZ[i];
            this.verticesZ[i] = -temp;
        }

        this.invalidateBounds();
    }

    rotate180(): void {
        for (let i = 0; i < this.verticesCount; i++) {
            this.verticesX[i] = -this.verticesX[i];
            this.verticesZ[i] = -this.verticesZ[i];
        }

        this.invalidateBounds();
    }

    rotate270(): void {
        for (let i = 0; i < this.verticesCount; i++) {
            const temp = this.verticesZ[i];
            this.verticesZ[i] = this.verticesX[i];
            this.verticesX[i] = -temp;
        }

        this.invalidateBounds();
    }

    rotate(angle: number): void {
        const sin = SINE[angle];
        const cos = COSINE[angle];

        for (let i = 0; i < this.verticesCount; i++) {
            const temp = (sin * this.verticesZ[i] + cos * this.verticesX[i]) >> 16;
            this.verticesZ[i] = (cos * this.verticesZ[i] - sin * this.verticesX[i]) >> 16;
            this.verticesX[i] = temp;
        }

        this.invalidateBounds();
    }

    translate(x: number, y: number, z: number): void {
        for (let i = 0; i < this.verticesCount; i++) {
            this.verticesX[i] += x;
            this.verticesY[i] += y;
            this.verticesZ[i] += z;
        }

        this.invalidateBounds();
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
        this.invalidateBounds();
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
        this.invalidateBounds();
    }

    scale(x: number, y: number, z: number): void {
        for (let i = 0; i < this.verticesCount; i++) {
            this.verticesX[i] = ((this.verticesX[i] * x) / 128) | 0;
            this.verticesY[i] = ((this.verticesY[i] * y) / 128) | 0;
            this.verticesZ[i] = ((this.verticesZ[i] * z) / 128) | 0;
        }

        this.invalidateBounds();
    }

    getXZRadius(): number {
        this.calculateBoundsCylinder();
        return this.xzRadius;
    }

    override tryGetXZRadius(): number {
        return this.getXZRadius();
    }

    animateOld(frame: SeqFrame | undefined) {
        if (this.vertexLabels && frame) {
            this.resetAnimateOrigin();

            const base = frame.base;

            for (let i = 0; i < frame.transformCount; i++) {
                const group = frame.transformGroups[i];
                this.transform(
                    base.types[group],
                    base.labels[group],
                    frame.transformX[i],
                    frame.transformY[i],
                    frame.transformZ[i],
                );
            }

            this.postAnimate();
        }
    }

    animate(frame: SeqFrame, nextFrame: SeqFrame | undefined, rotateNormals: boolean): void {
        if (this.vertexLabels) {
            this.resetAnimateOrigin();

            const base = frame.base;
            if (base !== nextFrame?.base) {
                nextFrame = undefined;
            }

            this.transformInterpolated(
                base,
                frame,
                nextFrame,
                undefined,
                true,
                rotateNormals,
                0xffff,
            );
            this.postAnimate();
        }
    }

    transformInterpolated(
        base: SeqBase,
        frame: SeqFrame,
        nextFrame: SeqFrame | undefined,
        animateLabels: boolean[] | undefined,
        condition: boolean,
        rotateNormals: boolean,
        mask: number,
    ): void {
        if (!nextFrame) {
            for (let i = 0; i < frame.transformCount; i++) {
                const group = frame.transformGroups[i];
                const type = base.types[group];
                if (
                    !animateLabels ||
                    animateLabels[group] === condition ||
                    type === SeqTransformType.ORIGIN
                ) {
                    const resetOriginGroup = frame.resetOriginGroups[i];
                    if (resetOriginGroup !== -1) {
                        this.transform(
                            SeqTransformType.ORIGIN,
                            base.labels[resetOriginGroup],
                            0,
                            0,
                            0,
                            rotateNormals,
                            base.masks[resetOriginGroup] & mask,
                        );
                    }

                    this.transform(
                        base.types[group],
                        base.labels[group],
                        frame.transformX[i],
                        frame.transformY[i],
                        frame.transformZ[i],
                        rotateNormals,
                        base.masks[group] & mask,
                    );
                }
            }
        }
    }

    transform(
        type: SeqTransformType,
        labels: number[],
        tx: number,
        ty: number,
        tz: number,
        rotateNormals: boolean = false,
        mask: number = 0xffff,
    ): void {
        if (mask !== 0xffff) {
            // console.error("animate mask", mask);
            // throw new Error("animate mask");
        } else {
            this.transform0(type, labels, tx, ty, tz, rotateNormals);
        }
    }

    transform0(
        type: SeqTransformType,
        labels: number[],
        tx: number,
        ty: number,
        tz: number,
        rotateNormals: boolean,
    ) {
        switch (type) {
            case SeqTransformType.ORIGIN:
                this.resetAnimateOrigin();

                let groupVertexCount = 0;

                for (const label of labels) {
                    if (label < this.vertexLabels.length) {
                        for (const v of this.vertexLabels[label]) {
                            this.animateOriginX += this.verticesX[v];
                            this.animateOriginY += this.verticesY[v];
                            this.animateOriginZ += this.verticesZ[v];
                            groupVertexCount++;
                        }
                    }
                }

                if (groupVertexCount > 0) {
                    this.animateOriginX = tx + ((this.animateOriginX / groupVertexCount) | 0);
                    this.animateOriginY = ty + ((this.animateOriginY / groupVertexCount) | 0);
                    this.animateOriginZ = tz + ((this.animateOriginZ / groupVertexCount) | 0);
                } else {
                    this.animateOriginX = tx;
                    this.animateOriginY = ty;
                    this.animateOriginZ = tz;
                }
                break;
            case SeqTransformType.TRANSLATE:
                for (const label of labels) {
                    if (label < this.vertexLabels.length) {
                        for (const v of this.vertexLabels[label]) {
                            this.verticesX[v] += tx;
                            this.verticesY[v] += ty;
                            this.verticesZ[v] += tz;
                        }
                    }
                }
                break;
            case SeqTransformType.ROTATE:
                for (const label of labels) {
                    if (label < this.vertexLabels.length) {
                        for (const v of this.vertexLabels[label]) {
                            this.verticesX[v] -= this.animateOriginX;
                            this.verticesY[v] -= this.animateOriginY;
                            this.verticesZ[v] -= this.animateOriginZ;

                            const angleX = (tx & 0xff) * 8;
                            const angleY = (ty & 0xff) * 8;
                            const angleZ = (tz & 0xff) * 8;

                            // const angleX = tx;
                            // const angleY = ty;
                            // const angleZ = tz;

                            // roll
                            if (angleZ !== 0) {
                                const sin = SINE[angleZ];
                                const cos = COSINE[angleZ];
                                const temp =
                                    (sin * this.verticesY[v] + cos * this.verticesX[v]) >> 16;
                                this.verticesY[v] =
                                    (cos * this.verticesY[v] - sin * this.verticesX[v]) >> 16;
                                this.verticesX[v] = temp;
                            }

                            // pitch
                            if (angleX !== 0) {
                                const sin = SINE[angleX];
                                const cos = COSINE[angleX];
                                const temp =
                                    (cos * this.verticesY[v] - sin * this.verticesZ[v]) >> 16;
                                this.verticesZ[v] =
                                    (sin * this.verticesY[v] + cos * this.verticesZ[v]) >> 16;
                                this.verticesY[v] = temp;
                            }

                            // yaw
                            if (angleY !== 0) {
                                const sin = SINE[angleY];
                                const cos = COSINE[angleY];
                                const temp =
                                    (sin * this.verticesZ[v] + cos * this.verticesX[v]) >> 16;
                                this.verticesZ[v] =
                                    (cos * this.verticesZ[v] - sin * this.verticesX[v]) >> 16;
                                this.verticesX[v] = temp;
                            }

                            this.verticesX[v] += this.animateOriginX;
                            this.verticesY[v] += this.animateOriginY;
                            this.verticesZ[v] += this.animateOriginZ;
                        }
                    }
                }
                break;
            case SeqTransformType.SCALE:
                for (const label of labels) {
                    if (label < this.vertexLabels.length) {
                        for (const v of this.vertexLabels[label]) {
                            this.verticesX[v] -= this.animateOriginX;
                            this.verticesY[v] -= this.animateOriginY;
                            this.verticesZ[v] -= this.animateOriginZ;

                            this.verticesX[v] = ((tx * this.verticesX[v]) / 128) | 0;
                            this.verticesY[v] = ((ty * this.verticesY[v]) / 128) | 0;
                            this.verticesZ[v] = ((tz * this.verticesZ[v]) / 128) | 0;

                            this.verticesX[v] += this.animateOriginX;
                            this.verticesY[v] += this.animateOriginY;
                            this.verticesZ[v] += this.animateOriginZ;
                        }
                    }
                }
                break;
            case SeqTransformType.ALPHA:
                if (this.faceLabels && this.faceAlphas) {
                    for (const label of labels) {
                        if (label < this.faceLabels.length) {
                            for (const f of this.faceLabels[label]) {
                                let newAlpha = (this.faceAlphas[f] & 0xff) + tx * 8;
                                if (newAlpha < 0) {
                                    newAlpha = 0;
                                } else if (newAlpha > 255) {
                                    newAlpha = 255;
                                }

                                this.faceAlphas[f] = newAlpha;
                            }
                        }
                    }
                }
                break;
            case SeqTransformType.LIGHT:
                if (!this.faceLabels) {
                    return;
                }

                for (const label of labels) {
                    if (label >= this.faceLabels.length) {
                        continue;
                    }
                    for (const f of this.faceLabels[label]) {
                        const color = this.faceColors[f];
                        let hue = (color >> 10) & 0x3f;
                        let saturation = (color >> 7) & 0x7;
                        let lightness = color & 0x7f;
                        hue = (hue + tx) & 0x3f;
                        saturation += ty;
                        if (saturation < 0) {
                            saturation = 0;
                        } else if (saturation > 7) {
                            saturation = 7;
                        }
                        lightness += tz;
                        if (lightness < 0) {
                            lightness = 0;
                        } else if (lightness > 127) {
                            lightness = 127;
                        }
                        this.faceColors[f] = (hue << 10) + (saturation << 7) + lightness;
                    }
                    this.changedLight = true;
                }
                break;
        }
    }

    animateSkeletal(skeletalSeq: SkeletalSeq, frame: number): void {
        const skeletalBase = skeletalSeq.skeletalBase;
        if (skeletalBase) {
            this.skeletalPools.reset();
            skeletalBase.updateAnimMatrices(skeletalSeq, frame, this.skeletalPools);
            this.transformSkeletal(skeletalBase, skeletalSeq.poseId, frame);
        }

        if (skeletalSeq.hasAlphaTransform) {
            this.transformSkeletalAlpha(skeletalSeq, frame);
        }

        this.invalidateBounds();
    }

    transformSkeletal(skeletalBase: SkeletalBase, poseId: number, frame: number): void {
        if (!this.animMayaGroups) {
            return;
        }
        for (let v = 0; v < this.verticesCount; v++) {
                const group = this.animMayaGroups[v];
            if (group && group.length !== 0) {
                const scalings = this.animMayaScales[v];

                this.skeletalTransformMatrix.fill(0);
                for (let i = 0; i < group.length; i++) {
                    const boneId = group[i];
                    const bone = skeletalBase.getBone(boneId);
                    if (bone) {
                        const scale = scalings[i] / 255;
                        vec3.set(this.skeletalScaleVector, scale, scale, scale);
                        mat4.fromScaling(this.skeletalScalingMatrix, this.skeletalScaleVector);

                        mat4.mul(
                            this.skeletalBoneMatrix,
                            this.skeletalScalingMatrix,
                            bone.getFinalMatrix(poseId),
                        );

                        mat4.add(
                            this.skeletalTransformMatrix,
                            this.skeletalTransformMatrix,
                            this.skeletalBoneMatrix,
                        );
                    }
                }

                this.transformVertex(v, this.skeletalTransformMatrix);
            }
        }
    }

    transformVertex(v: number, m: mat4): void {
        const vx = this.verticesX[v];
        const vy = -this.verticesY[v];
        const vz = -this.verticesZ[v];
        const scale = 1.0;
        // TODO: maybe use gl-matrix function instead
        this.verticesX[v] = Math.round(m[0] * vx + m[4] * vy + m[8] * vz + m[12] * scale);
        this.verticesY[v] = -Math.round(m[1] * vx + m[5] * vy + m[9] * vz + m[13] * scale);
        this.verticesZ[v] = -Math.round(m[2] * vx + m[6] * vy + m[10] * vz + m[14] * scale);
    }

    transformSkeletalAlpha(skeletalSeq: SkeletalSeq, frame: number): void {
        const base = skeletalSeq.base;

        for (let i = 0; i < base.count; i++) {
            const type = base.types[i];
            if (
                type === SeqTransformType.ALPHA &&
                skeletalSeq.curves &&
                skeletalSeq.curves[i] &&
                skeletalSeq.curves[i][0] &&
                this.faceLabels &&
                this.faceAlphas
            ) {
                const curve = skeletalSeq.curves[i][0];
                const labels = base.labels[i];
                for (const l of labels) {
                    if (l < this.faceLabels.length) {
                        for (const f of this.faceLabels[l]) {
                            let newAlpha =
                                (this.faceAlphas[f] & 0xff) + curve.getValue(frame) * 255;
                            if (newAlpha < 0) {
                                newAlpha = 0;
                            } else if (newAlpha > 255) {
                                newAlpha = 255;
                            }

                            this.faceAlphas[f] = newAlpha;
                        }
                    }
                }
            }
        }
    }

    postAnimate() {
        if (this.changedLight) {
            for (let i = 0; i < this.faceCount; i++) {
                const textureId = this.faceTextures ? this.faceTextures[i] : -1;
                if (textureId !== -1) {
                    continue;
                }
                const color = this.faceColors[i] & 0xffff;
                if (this.faceColors3[i] === -1) {
                    const shade17 = this.faceColors1[i] & ~0x1ffff;
                    this.faceColors1[i] = shade17 | ModelData.adjustLightness(color, shade17 >> 17);
                } else if (this.faceColors3[i] !== -2) {
                    let c = this.faceColors1[i] & ~0x1ffff;
                    this.faceColors1[i] = c | ModelData.adjustLightness(color, c >> 17);
                    c = this.faceColors2[i] & ~0x1ffff;
                    this.faceColors2[i] = c | ModelData.adjustLightness(color, c >> 17);
                    c = this.faceColors3[i] & ~0x1ffff;
                    this.faceColors3[i] = c | ModelData.adjustLightness(color, c >> 17);
                }
            }
            this.changedLight = false;
        }
        this.invalidateBounds();
    }
}

export function computeTextureCoords(model: Model): Float32Array | undefined {
    const faceTextures = model.faceTextures;

    if (!faceTextures) {
        return undefined;
    }

    const verticesX = model.verticesX;
    const verticesY = model.verticesY;
    const verticesZ = model.verticesZ;

    const indices0 = model.indices1;
    const indices1 = model.indices2;
    const indices2 = model.indices3;

    const textureMappingP = model.textureMappingP;
    const textureMappingM = model.textureMappingM;
    const textureMappingN = model.textureMappingN;

    const textureCoords = model.textureCoords;

    const faceCount = model.faceCount;
    const faceTextureUCoordinates: Float32Array = new Float32Array(faceCount * 6);

    for (let i = 0; i < faceCount; i++) {
        const index0 = indices0[i];
        const index1 = indices1[i];
        const index2 = indices2[i];

        const textureIdx = faceTextures[i];

        if (textureIdx !== -1) {
            let p: number;
            let m: number;
            let n: number;

            if (textureCoords && textureCoords[i] !== -1) {
                const textureCoordinate = textureCoords[i] & 255;
                p = textureMappingP[textureCoordinate];
                m = textureMappingM[textureCoordinate];
                n = textureMappingN[textureCoordinate];
            } else {
                p = index0;
                m = index1;
                n = index2;
            }

            const vx = verticesX[p];
            const vy = verticesY[p];
            const vz = verticesZ[p];

            const edgeMx = verticesX[m] - vx;
            const edgeMy = verticesY[m] - vy;
            const edgeMz = verticesZ[m] - vz;
            const edgeNx = verticesX[n] - vx;
            const edgeNy = verticesY[n] - vy;
            const edgeNz = verticesZ[n] - vz;
            const v0x = verticesX[index0] - vx;
            const v0y = verticesY[index0] - vy;
            const v0z = verticesZ[index0] - vz;
            const v1x = verticesX[index1] - vx;
            const v1y = verticesY[index1] - vy;
            const v1z = verticesZ[index1] - vz;
            const v2x = verticesX[index2] - vx;
            const v2y = verticesY[index2] - vy;
            const v2z = verticesZ[index2] - vz;

            const crossX = edgeMy * edgeNz - edgeMz * edgeNy;
            const crossY = edgeMz * edgeNx - edgeMx * edgeNz;
            const crossZ = edgeMx * edgeNy - edgeMy * edgeNx;
            const uBasisX = edgeNy * crossZ - edgeNz * crossY;
            const uBasisY = edgeNz * crossX - edgeNx * crossZ;
            const uBasisZ = edgeNx * crossY - edgeNy * crossX;
            const invUDenom = 1.0 / (uBasisX * edgeMx + uBasisY * edgeMy + uBasisZ * edgeMz);

            const u0 = (uBasisX * v0x + uBasisY * v0y + uBasisZ * v0z) * invUDenom;
            const u1 = (uBasisX * v1x + uBasisY * v1y + uBasisZ * v1z) * invUDenom;
            const u2 = (uBasisX * v2x + uBasisY * v2y + uBasisZ * v2z) * invUDenom;

            const vBasisX = edgeMy * crossZ - edgeMz * crossY;
            const vBasisY = edgeMz * crossX - edgeMx * crossZ;
            const vBasisZ = edgeMx * crossY - edgeMy * crossX;
            const invVDenom = 1.0 / (vBasisX * edgeNx + vBasisY * edgeNy + vBasisZ * edgeNz);

            const v0 = (vBasisX * v0x + vBasisY * v0y + vBasisZ * v0z) * invVDenom;
            const v1 = (vBasisX * v1x + vBasisY * v1y + vBasisZ * v1z) * invVDenom;
            const v2 = (vBasisX * v2x + vBasisY * v2y + vBasisZ * v2z) * invVDenom;

            const idx = i * 6;
            faceTextureUCoordinates[idx] = u0;
            faceTextureUCoordinates[idx + 1] = v0;
            faceTextureUCoordinates[idx + 2] = u1;
            faceTextureUCoordinates[idx + 3] = v1;
            faceTextureUCoordinates[idx + 4] = u2;
            faceTextureUCoordinates[idx + 5] = v2;
        }
    }

    return faceTextureUCoordinates;
}
