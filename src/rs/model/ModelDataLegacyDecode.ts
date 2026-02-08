import { ModelData } from "./ModelData";
import { LegacyModelLoader, LegacyModelMetadata } from "./ModelLoader";

export function decodeLegacyModelDataInto(
    model: ModelData,
    loader: LegacyModelLoader,
    meta: LegacyModelMetadata,
): void {
    let hasRenderType = false;
    let isTextured = false;

    const buffers = loader.createDecodeBuffers();
    const point1 = buffers.point1;
    const point2 = buffers.point2;
    const point3 = buffers.point3;
    const point4 = buffers.point4;
    const point5 = buffers.point5;
    const face1 = buffers.face1;
    const face2 = buffers.face2;
    const face3 = buffers.face3;
    const face4 = buffers.face4;
    const face5 = buffers.face5;
    const vertex1 = buffers.vertex1;
    const vertex2 = buffers.vertex2;
    const axis = buffers.axis;

    model.verticesCount = meta.vertexCount;
    model.faceCount = meta.triangleCount;
    model.textureFaceCount = meta.texturedTriangleCount;
    model.verticesX = new Int32Array(model.verticesCount);
    model.verticesY = new Int32Array(model.verticesCount);
    model.verticesZ = new Int32Array(model.verticesCount);
    model.indices1 = new Int32Array(model.faceCount);
    model.indices2 = new Int32Array(model.faceCount);
    model.indices3 = new Int32Array(model.faceCount);
    if (model.textureFaceCount > 0) {
        model.textureRenderTypes = new Int8Array(model.textureFaceCount);
        model.textureMappingP = new Int16Array(model.textureFaceCount);
        model.textureMappingM = new Int16Array(model.textureFaceCount);
        model.textureMappingN = new Int16Array(model.textureFaceCount);
    }

    if (meta.vertexLabelsOffset >= 0) {
        model.vertexSkins = new Int32Array(model.verticesCount);
    }

    if (meta.faceInfosOffset >= 0) {
        model.faceRenderTypes = new Int8Array(model.faceCount);
        model.textureCoords = new Int8Array(model.faceCount);
        model.faceTextures = new Int16Array(model.faceCount);
    }

    if (meta.facePrioritiesOffset >= 0) {
        model.faceRenderPriorities = new Int8Array(model.faceCount);
    } else {
        model.priority = -meta.facePrioritiesOffset - 1;
    }

    if (meta.faceAlphasOffset >= 0) {
        model.faceAlphas = new Int8Array(model.faceCount);
    }

    if (meta.faceLabelsOffset >= 0) {
        model.faceSkins = new Int32Array(model.faceCount);
    }

    model.faceColors = new Uint16Array(model.faceCount);

    point1.offset = meta.vertexFlagsOffset;
    point2.offset = meta.vertexXOffset;
    point3.offset = meta.vertexYOffset;
    point4.offset = meta.vertexZOffset;
    if (model.vertexSkins) {
        point5.offset = meta.vertexLabelsOffset;
    }

    let lastVertX = 0;
    let lastVertY = 0;
    let lastVertZ = 0;

    for (let i = 0; i < model.verticesCount; i++) {
        const flag = point1.readUnsignedByte();
        let deltaVertX = 0;
        if ((flag & 0x1) !== 0) {
            deltaVertX = point2.readSmart2();
        }

        let deltaVertY = 0;
        if ((flag & 0x2) !== 0) {
            deltaVertY = point3.readSmart2();
        }

        let deltaVertZ = 0;
        if ((flag & 0x4) !== 0) {
            deltaVertZ = point4.readSmart2();
        }

        model.verticesX[i] = lastVertX + deltaVertX;
        model.verticesY[i] = lastVertY + deltaVertY;
        model.verticesZ[i] = lastVertZ + deltaVertZ;
        lastVertX = model.verticesX[i];
        lastVertY = model.verticesY[i];
        lastVertZ = model.verticesZ[i];
        if (model.vertexSkins) {
            model.vertexSkins[i] = point5.readUnsignedByte();
        }
    }

    face1.offset = meta.faceColorsOffset;
    if (model.faceRenderTypes && model.textureCoords && model.faceTextures) {
        face2.offset = meta.faceInfosOffset;
    }
    if (model.faceRenderPriorities) {
        face3.offset = meta.facePrioritiesOffset;
    }
    if (model.faceAlphas) {
        face4.offset = meta.faceAlphasOffset;
    }
    if (model.faceSkins) {
        face5.offset = meta.faceLabelsOffset;
    }

    for (let i = 0; i < model.faceCount; i++) {
        model.faceColors[i] = face1.readUnsignedShort();
        if (model.faceRenderTypes && model.textureCoords && model.faceTextures) {
            const flag = face2.readUnsignedByte();
            if ((flag & 0x1) === 1) {
                model.faceRenderTypes[i] = 1;
                hasRenderType = true;
            } else {
                model.faceRenderTypes[i] = 0;
            }

            if ((flag & 0x2) === 2) {
                model.textureCoords[i] = flag >> 2;
                model.faceTextures[i] = model.faceColors[i];
                model.faceColors[i] = 127;
                if (model.faceTextures[i] !== -1) {
                    isTextured = true;
                }
            } else {
                model.textureCoords[i] = -1;
                model.faceTextures[i] = -1;
            }
        }

        if (model.faceRenderPriorities) {
            model.faceRenderPriorities[i] = face3.readByte();
        }

        if (model.faceAlphas) {
            model.faceAlphas[i] = face4.readByte();
        }

        if (model.faceSkins) {
            model.faceSkins[i] = face5.readUnsignedByte();
        }
    }

    vertex1.offset = meta.faceVerticesOffset;
    vertex2.offset = meta.faceOrientationsOffset;

    let index1 = 0;
    let index2 = 0;
    let index3 = 0;
    let lastIndex = 0;

    model.usedVertexCount = -1;
    for (let i = 0; i < model.faceCount; i++) {
        const type = vertex2.readUnsignedByte();
        if (type === 1) {
            index1 = vertex1.readSmart2() + lastIndex;
            index2 = vertex1.readSmart2() + index1;
            index3 = vertex1.readSmart2() + index2;
            lastIndex = index3;
            model.indices1[i] = index1;
            model.indices2[i] = index2;
            model.indices3[i] = index3;
            if (index1 > model.usedVertexCount) {
                model.usedVertexCount = index1;
            }
            if (index2 > model.usedVertexCount) {
                model.usedVertexCount = index2;
            }
            if (index3 > model.usedVertexCount) {
                model.usedVertexCount = index3;
            }
        }

        if (type === 2) {
            index2 = index3;
            index3 = vertex1.readSmart2() + lastIndex;
            lastIndex = index3;
            model.indices1[i] = index1;
            model.indices2[i] = index2;
            model.indices3[i] = index3;
            if (index3 > model.usedVertexCount) {
                model.usedVertexCount = index3;
            }
        }

        if (type === 3) {
            index1 = index3;
            index3 = vertex1.readSmart2() + lastIndex;
            lastIndex = index3;
            model.indices1[i] = index1;
            model.indices2[i] = index2;
            model.indices3[i] = index3;
            if (index3 > model.usedVertexCount) {
                model.usedVertexCount = index3;
            }
        }

        if (type === 4) {
            const temp = index1;
            index1 = index2;
            index2 = temp;
            index3 = vertex1.readSmart2() + lastIndex;
            lastIndex = index3;
            model.indices1[i] = index1;
            model.indices2[i] = temp;
            model.indices3[i] = index3;
            if (index3 > model.usedVertexCount) {
                model.usedVertexCount = index3;
            }
        }
    }
    model.usedVertexCount++;

    axis.offset = meta.faceTextureAxisOffset * 6;

    for (let i = 0; i < model.textureFaceCount; i++) {
        model.textureRenderTypes[i] = 0;
        model.textureMappingP[i] = axis.readUnsignedShort();
        model.textureMappingM[i] = axis.readUnsignedShort();
        model.textureMappingN[i] = axis.readUnsignedShort();
    }

    if (model.textureCoords) {
        let hasValidTexFace = false;

        for (let i = 0; i < model.faceCount; i++) {
            const index = model.textureCoords[i] & 255;
            if (index !== 255) {
                if (
                    model.indices1[i] === (model.textureMappingP[index] & 0xffff) &&
                    model.indices2[i] === (model.textureMappingM[index] & 0xffff) &&
                    model.indices3[i] === (model.textureMappingN[index] & 0xffff)
                ) {
                    model.textureCoords[i] = -1;
                } else {
                    hasValidTexFace = true;
                }
            }
        }

        if (!hasValidTexFace) {
            model.textureCoords = undefined;
        }
    }

    if (!isTextured) {
        model.faceTextures = undefined;
    }

    if (!hasRenderType) {
        model.faceRenderTypes = undefined;
    }
}
