import { TextureLoader } from "../texture/TextureLoader";
import { ModelData } from "./ModelData";

const uvTemp = new Float32Array(2);

export function computeTextureCoords(
    textureLoader: TextureLoader,
    model: ModelData,
): Float32Array | undefined {
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

    const faceCount = model.faceCount;
    const uvs = new Float32Array(faceCount * 6);

    const textureScales = calculateTextureScales(model);

    for (let i = 0; i < faceCount; i++) {
        let texCoord: number;
        if (model.textureCoords) {
            texCoord = model.textureCoords[i];
        } else {
            texCoord = -1;
        }
        let textureId = faceTextures[i];
        if (textureId !== -1 && !textureLoader.isSd(textureId)) {
            textureId = -1;
        }

        let u0 = 0;
        let v0 = 0;
        let u1 = 0;
        let v1 = 0;
        let u2 = 0;
        let v2 = 0;

        if (textureId !== -1) {
            let type = 0;
            if (texCoord !== -1) {
                texCoord &= 0xff;
                type = model.textureRenderTypes[texCoord];
            }

            const index0 = indices0[i];
            const index1 = indices1[i];
            const index2 = indices2[i];
            if (type === 0) {
                let p = index0;
                let m = index1;
                let n = index2;
                if (texCoord !== -1) {
                    p = textureMappingP[texCoord];
                    m = textureMappingM[texCoord];
                    n = textureMappingN[texCoord];
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

                u0 = (uBasisX * v0x + uBasisY * v0y + uBasisZ * v0z) * invUDenom;
                u1 = (uBasisX * v1x + uBasisY * v1y + uBasisZ * v1z) * invUDenom;
                u2 = (uBasisX * v2x + uBasisY * v2y + uBasisZ * v2z) * invUDenom;

                const vBasisX = edgeMy * crossZ - edgeMz * crossY;
                const vBasisY = edgeMz * crossX - edgeMx * crossZ;
                const vBasisZ = edgeMx * crossY - edgeMy * crossX;
                const invVDenom = 1.0 / (vBasisX * edgeNx + vBasisY * edgeNy + vBasisZ * edgeNz);

                v0 = (vBasisX * v0x + vBasisY * v0y + vBasisZ * v0z) * invVDenom;
                v1 = (vBasisX * v1x + vBasisY * v1y + vBasisZ * v1z) * invVDenom;
                v2 = (vBasisX * v2x + vBasisY * v2y + vBasisZ * v2z) * invVDenom;

                if (u1 - u0 > 0.99 && u1 - u0 < 1.1) {
                    u1 = 1.0;
                }
                if (u2 - u1 > 0.99 && u2 - u1 < 1.1) {
                    u2 = 1.0;
                }
                if (u0 - u2 > 0.99 && u0 - u2 < 1.1) {
                    u0 = 1.0;
                }
                if (u0 - u1 > 0.99 && u0 - u1 < 1.1) {
                    u0 = 1.0;
                }
                if (u1 - u2 > 0.99 && u1 - u2 < 1.1) {
                    u1 = 1.0;
                }
                if (u2 - u0 > 0.99 && u2 - u0 < 1.1) {
                    u2 = 1.0;
                }
            } else if (
                textureScales.centerXs &&
                textureScales.centerYs &&
                textureScales.centerZs &&
                textureScales.fs
            ) {
                const centerX = textureScales.centerXs[texCoord];
                const centerY = textureScales.centerYs[texCoord];
                const centerZ = textureScales.centerZs[texCoord];
                const scales = textureScales.fs[texCoord];
                const direction = model.textureDirection[texCoord];
                const speed = model.textureSpeed[texCoord] / 256.0;
                if (type === 1) {
                    const scaleZ = model.textureScaleZ[texCoord] / 1024.0;
                    computeCylindricalUv(
                        model.verticesX[index0],
                        model.verticesY[index0],
                        model.verticesZ[index0],
                        centerX,
                        centerY,
                        centerZ,
                        scales,
                        scaleZ,
                        direction,
                        speed,
                        uvTemp,
                    );
                    u0 = uvTemp[0];
                    v0 = uvTemp[1];
                    computeCylindricalUv(
                        model.verticesX[index1],
                        model.verticesY[index1],
                        model.verticesZ[index1],
                        centerX,
                        centerY,
                        centerZ,
                        scales,
                        scaleZ,
                        direction,
                        speed,
                        uvTemp,
                    );
                    u1 = uvTemp[0];
                    v1 = uvTemp[1];
                    computeCylindricalUv(
                        model.verticesX[index2],
                        model.verticesY[index2],
                        model.verticesZ[index2],
                        centerX,
                        centerY,
                        centerZ,
                        scales,
                        scaleZ,
                        direction,
                        speed,
                        uvTemp,
                    );
                    u2 = uvTemp[0];
                    v2 = uvTemp[1];
                    const scaleZHalf = scaleZ / 2.0;
                    if ((direction & 0x1) === 0) {
                        if (u1 - u0 > scaleZHalf) {
                            u1 -= scaleZ;
                            // i_769_ = 1;
                        } else if (u0 - u1 > scaleZHalf) {
                            u1 += scaleZ;
                            // i_769_ = 2;
                        }
                        if (u2 - u0 > scaleZHalf) {
                            u2 -= scaleZ;
                            // i_770_ = 1;
                        } else if (u0 - u2 > scaleZHalf) {
                            u2 += scaleZ;
                            // i_770_ = 2;
                        }
                    } else {
                        if (v1 - v0 > scaleZHalf) {
                            v1 -= scaleZ;
                            // i_769_ = 1;
                        } else if (v0 - v1 > scaleZHalf) {
                            v1 += scaleZ;
                            // i_769_ = 2;
                        }
                        if (v2 - v0 > scaleZHalf) {
                            v2 -= scaleZ;
                            // i_770_ = 1;
                        } else if (v0 - v2 > scaleZHalf) {
                            v2 += scaleZ;
                            // i_770_ = 2;
                        }
                    }
                } else if (type === 2) {
                    const uOffset = model.textureTransU[texCoord] / 256.0;
                    const vOffset = model.textureTransV[texCoord] / 256.0;

                    const dx1 = model.verticesX[index1] - model.verticesX[index0];
                    const dy1 = model.verticesY[index1] - model.verticesY[index0];
                    const dz1 = model.verticesZ[index1] - model.verticesZ[index0];
                    const dx2 = model.verticesX[index2] - model.verticesX[index0];
                    const dy2 = model.verticesY[index2] - model.verticesY[index0];
                    const dz2 = model.verticesZ[index2] - model.verticesZ[index0];
                    const vx = dy1 * dz2 - dy2 * dz1;
                    const vy = dz1 * dx2 - dz2 * dx1;
                    const vz = dx1 * dy2 - dx2 * dy1;
                    const scaleX = 64.0 / model.textureScaleX[texCoord];
                    const scaleY = 64.0 / model.textureScaleY[texCoord];
                    const scaleZ = 64.0 / model.textureScaleZ[texCoord];
                    const scaledNormalX =
                        (vx * scales[0] + vy * scales[1] + vz * scales[2]) / scaleX;
                    const scaledNormalY =
                        (vx * scales[3] + vy * scales[4] + vz * scales[5]) / scaleY;
                    const scaledNormalZ =
                        (vx * scales[6] + vy * scales[7] + vz * scales[8]) / scaleZ;

                    const cubeFace = getDominantAxisFace(
                        scaledNormalX,
                        scaledNormalY,
                        scaledNormalZ,
                    );

                    computeBoxProjectedUv(
                        model.verticesX[index0],
                        model.verticesY[index0],
                        model.verticesZ[index0],
                        centerX,
                        centerY,
                        centerZ,
                        cubeFace,
                        scales,
                        direction,
                        speed,
                        uOffset,
                        vOffset,
                        uvTemp,
                    );
                    u0 = uvTemp[0];
                    v0 = uvTemp[1];
                    computeBoxProjectedUv(
                        model.verticesX[index1],
                        model.verticesY[index1],
                        model.verticesZ[index1],
                        centerX,
                        centerY,
                        centerZ,
                        cubeFace,
                        scales,
                        direction,
                        speed,
                        uOffset,
                        vOffset,
                        uvTemp,
                    );
                    u1 = uvTemp[0];
                    v1 = uvTemp[1];
                    computeBoxProjectedUv(
                        model.verticesX[index2],
                        model.verticesY[index2],
                        model.verticesZ[index2],
                        centerX,
                        centerY,
                        centerZ,
                        cubeFace,
                        scales,
                        direction,
                        speed,
                        uOffset,
                        vOffset,
                        uvTemp,
                    );
                    u2 = uvTemp[0];
                    v2 = uvTemp[1];
                } else if (type === 3) {
                    computeSphericalUv(
                        model.verticesX[index0],
                        model.verticesY[index0],
                        model.verticesZ[index0],
                        centerX,
                        centerY,
                        centerZ,
                        scales,
                        direction,
                        speed,
                        uvTemp,
                    );
                    u0 = uvTemp[0];
                    v0 = uvTemp[1];
                    computeSphericalUv(
                        model.verticesX[index1],
                        model.verticesY[index1],
                        model.verticesZ[index1],
                        centerX,
                        centerY,
                        centerZ,
                        scales,
                        direction,
                        speed,
                        uvTemp,
                    );
                    u1 = uvTemp[0];
                    v1 = uvTemp[1];
                    computeSphericalUv(
                        model.verticesX[index2],
                        model.verticesY[index2],
                        model.verticesZ[index2],
                        centerX,
                        centerY,
                        centerZ,
                        scales,
                        direction,
                        speed,
                        uvTemp,
                    );
                    u2 = uvTemp[0];
                    v2 = uvTemp[1];

                    if ((direction & 0x1) === 0) {
                        if (u1 - u0 > 0.5) {
                            u1--;
                            // i_769_ = 1;
                        } else if (u0 - u1 > 0) {
                            u1++;
                            // i_769_ = 2;
                        }
                        if (u2 - u0 > 0.5) {
                            u2--;
                            // i_770_ = 1;
                        } else if (u0 - u2 > 0.5) {
                            u2++;
                            // i_770_ = 2;
                        }
                    } else {
                        if (v1 - v0 > 0.5) {
                            v1--;
                            // i_769_ = 1;
                        } else if (v0 - v1 > 0.5) {
                            v1++;
                            // i_769_ = 2;
                        }
                        if (v2 - v0 > 0.5) {
                            v2--;
                            // i_770_ = 1;
                        } else if (v0 - v2 > 0.5) {
                            v2++;
                            // i_770_ = 2;
                        }
                    }
                }
            }

            // if (texCoord === -1) {
            //     u0 = 0.0;
            //     v0 = 1.0;
            //     u1 = 1.0;
            //     v1 = 1.0;
            //     u2 = 0.0;
            //     v2 = 0.0;
            // } else {
            //     texCoord &= 0xff;
            //     const type = model.textureRenderTypes[texCoord];
            // }
        }

        const uvIndex = i * 6;
        uvs[uvIndex] = u0;
        uvs[uvIndex + 1] = v0;
        uvs[uvIndex + 2] = u1;
        uvs[uvIndex + 3] = v1;
        uvs[uvIndex + 4] = u2;
        uvs[uvIndex + 5] = v2;
    }

    return uvs;
}

function computeCylindricalUv(
    vx: number,
    vy: number,
    vz: number,
    centerX: number,
    centerY: number,
    centerZ: number,
    scales: Float32Array,
    scaleZ: number,
    direction: number,
    speed: number,
    out: Float32Array,
): void {
    vx -= centerX;
    vy -= centerY;
    vz -= centerZ;
    const localX = vx * scales[0] + vy * scales[1] + vz * scales[2];
    const localY = vx * scales[3] + vy * scales[4] + vz * scales[5];
    const localZ = vx * scales[6] + vy * scales[7] + vz * scales[8];
    let u = Math.atan2(localX, localZ) / 6.2831855 + 0.5;
    if (scaleZ !== 1.0) {
        u *= scaleZ;
    }
    let v = localY + 0.5 + speed;
    if (direction === 1) {
        const uPrev = u;
        u = -v;
        v = uPrev;
    } else if (direction === 2) {
        u = -u;
        v = -v;
    } else if (direction === 3) {
        const uPrev = u;
        u = v;
        v = -uPrev;
    }
    out[0] = u;
    out[1] = v;
}

function getDominantAxisFace(x: number, y: number, z: number): number {
    const absX = x < 0.0 ? -x : x;
    const absY = y < 0.0 ? -y : y;
    const absZ = z < 0.0 ? -z : z;
    if (absY > absX && absY > absZ) {
        if (y > 0.0) {
            return 0;
        }
        return 1;
    }
    if (absZ > absX && absZ > absY) {
        if (z > 0.0) {
            return 2;
        }
        return 3;
    }
    if (x > 0.0) {
        return 4;
    }
    return 5;
}

function computeBoxProjectedUv(
    vx: number,
    vy: number,
    vz: number,
    centerX: number,
    centerY: number,
    centerZ: number,
    cubeFace: number,
    scales: Float32Array,
    direction: number,
    speed: number,
    uOffset: number,
    vOffset: number,
    out: Float32Array,
): void {
    vx -= centerX;
    vy -= centerY;
    vz -= centerZ;
    const localX = vx * scales[0] + vy * scales[1] + vz * scales[2];
    const localY = vx * scales[3] + vy * scales[4] + vz * scales[5];
    const localZ = vx * scales[6] + vy * scales[7] + vz * scales[8];
    let u: number;
    let v: number;
    if (cubeFace === 0) {
        u = localX + speed + 0.5;
        v = -localZ + vOffset + 0.5;
    } else if (cubeFace === 1) {
        u = localX + speed + 0.5;
        v = localZ + vOffset + 0.5;
    } else if (cubeFace === 2) {
        u = -localX + speed + 0.5;
        v = -localY + uOffset + 0.5;
    } else if (cubeFace === 3) {
        u = localX + speed + 0.5;
        v = -localY + uOffset + 0.5;
    } else if (cubeFace === 4) {
        u = localZ + vOffset + 0.5;
        v = -localY + uOffset + 0.5;
    } else {
        u = -localZ + vOffset + 0.5;
        v = -localY + uOffset + 0.5;
    }
    if (direction === 1) {
        const uPrev = u;
        u = -v;
        v = uPrev;
    } else if (direction === 2) {
        u = -u;
        v = -v;
    } else if (direction === 3) {
        const uPrev = u;
        u = v;
        v = -uPrev;
    }
    out[0] = u;
    out[1] = v;
}

function computeSphericalUv(
    vx: number,
    vy: number,
    vz: number,
    centerX: number,
    centerY: number,
    centerZ: number,
    scales: Float32Array,
    direction: number,
    speed: number,
    out: Float32Array,
): void {
    vx -= centerX;
    vy -= centerY;
    vz -= centerZ;
    const localX = vx * scales[0] + vy * scales[1] + vz * scales[2];
    const localY = vx * scales[3] + vy * scales[4] + vz * scales[5];
    const localZ = vx * scales[6] + vy * scales[7] + vz * scales[8];
    const localLen = Math.sqrt(localX * localX + localY * localY + localZ * localZ);
    let u = Math.atan2(localX, localZ) / 6.2831855 + 0.5;
    let v = Math.asin(localY / localLen) / 3.1415927 + 0.5 + speed;
    if (direction === 1) {
        const uPrev = u;
        u = -v;
        v = uPrev;
    } else if (direction === 2) {
        u = -u;
        v = -v;
    } else if (direction === 3) {
        const uPrev = u;
        u = v;
        v = -uPrev;
    }
    out[0] = u;
    out[1] = v;
}

class TextureScales {
    constructor(
        readonly centerXs: Int32Array | undefined,
        readonly centerYs: Int32Array | undefined,
        readonly centerZs: Int32Array | undefined,
        // 3x3 rotation matrix maybe
        readonly fs: Float32Array[] | undefined,
    ) {}
}

export function calculateTextureScales(model: ModelData): TextureScales {
    let centerXs: Int32Array | undefined;
    let centerYs: Int32Array | undefined;
    let centerZs: Int32Array | undefined;
    let fs: Float32Array[] | undefined;
    if (model.textureCoords) {
        const textureFaceCount = model.textureFaceCount;
        const minX = new Int32Array(textureFaceCount);
        const maxX = new Int32Array(textureFaceCount);
        const minY = new Int32Array(textureFaceCount);
        const maxY = new Int32Array(textureFaceCount);
        const minZ = new Int32Array(textureFaceCount);
        const maxZ = new Int32Array(textureFaceCount);
        for (let i = 0; i < textureFaceCount; i++) {
            minX[i] = 2147483647;
            maxX[i] = -2147483647;
            minY[i] = 2147483647;
            maxY[i] = -2147483647;
            minZ[i] = 2147483647;
            maxZ[i] = -2147483647;
        }
        fs = new Array(textureFaceCount);
        for (let i = 0; i < model.faceCount; i++) {
            if (model.textureCoords[i] === -1) {
                continue;
            }
            const texCoord = model.textureCoords[i] & 0xff;
            for (let v = 0; v < 3; v++) {
                let vertexIndex: number;
                if (v === 0) {
                    vertexIndex = model.indices1[i];
                } else if (v === 1) {
                    vertexIndex = model.indices2[i];
                } else {
                    vertexIndex = model.indices3[i];
                }
                const vx = model.verticesX[vertexIndex];
                const vy = model.verticesY[vertexIndex];
                const vz = model.verticesZ[vertexIndex];

                if (minX[texCoord] > vx) {
                    minX[texCoord] = vx;
                }
                if (vx > maxX[texCoord]) {
                    maxX[texCoord] = vx;
                }
                if (minY[texCoord] > vy) {
                    minY[texCoord] = vy;
                }
                if (maxY[texCoord] < vy) {
                    maxY[texCoord] = vy;
                }
                if (minZ[texCoord] > vz) {
                    minZ[texCoord] = vz;
                }
                if (maxZ[texCoord] < vz) {
                    maxZ[texCoord] = vz;
                }
            }
        }
        centerXs = new Int32Array(textureFaceCount);
        centerYs = new Int32Array(textureFaceCount);
        centerZs = new Int32Array(textureFaceCount);
        for (let i = 0; i < textureFaceCount; i++) {
            const type = model.textureRenderTypes[i];
            if (type > 0) {
                centerXs[i] = (minX[i] + maxX[i]) / 2;
                centerYs[i] = (minY[i] + maxY[i]) / 2;
                centerZs[i] = (minZ[i] + maxZ[i]) / 2;
                let scaleX: number;
                let scaleY: number;
                let scaleZ: number;
                if (type === 1) {
                    const scaleX0 = model.textureScaleX[i];
                    scaleY = 64.0 / model.textureScaleY[i];
                    if (scaleX0 === 0) {
                        scaleZ = 1.0;
                        scaleX = 1.0;
                    } else if (scaleX0 <= 0) {
                        scaleZ = 1.0;
                        scaleX = -scaleX0 / 1024.0;
                    } else {
                        scaleX = 1.0;
                        scaleZ = scaleX0 / 1024.0;
                    }
                } else if (type === 2) {
                    scaleX = 64.0 / model.textureScaleX[i];
                    scaleY = 64.0 / model.textureScaleY[i];
                    scaleZ = 64.0 / model.textureScaleZ[i];
                } else {
                    scaleX = model.textureScaleX[i] / 1024.0;
                    scaleY = model.textureScaleY[i] / 1024.0;
                    scaleZ = model.textureScaleZ[i] / 1024.0;
                }
                fs[i] = buildTextureTransformMatrix(
                    model.textureMappingP[i],
                    model.textureMappingM[i],
                    model.textureMappingN[i],
                    model.textureRotation[i] & 0xff,
                    scaleX,
                    scaleY,
                    scaleZ,
                );
            }
        }
    }
    return new TextureScales(centerXs, centerYs, centerZs, fs);
}

function buildTextureTransformMatrix(
    p: number,
    m: number,
    n: number,
    rotation: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
): Float32Array {
    const fs = new Float32Array(9);
    let axisX = 1.0;
    let axisZ = 0.0;
    let cosAngle = m / 32767.0;
    let sinAngle = -Math.sqrt(1.0 - cosAngle * cosAngle);
    let oneMinusCosAngle = 1.0 - cosAngle;
    const axisLenXZ = Math.sqrt(p * p + n * n);
    if (axisLenXZ !== 0.0) {
        axisX = -n / axisLenXZ;
        axisZ = p / axisLenXZ;
    }
    fs[0] = cosAngle + axisX * axisX * oneMinusCosAngle;
    fs[1] = axisZ * sinAngle;
    fs[2] = axisZ * axisX * oneMinusCosAngle;
    fs[3] = -axisZ * sinAngle;
    fs[4] = cosAngle;
    fs[5] = axisX * sinAngle;
    fs[6] = axisX * axisZ * oneMinusCosAngle;
    fs[7] = -axisX * sinAngle;
    fs[8] = cosAngle + axisZ * axisZ * oneMinusCosAngle;
    const fs_558_ = new Float32Array(9);
    cosAngle = Math.cos(rotation * 0.024543693); //pi/128 = 0.024543693
    sinAngle = Math.sin(rotation * 0.024543693); //pi/128 = 0.024543693
    fs_558_[0] = cosAngle;
    fs_558_[1] = 0.0;
    fs_558_[2] = sinAngle;
    fs_558_[3] = 0.0;
    fs_558_[4] = 1.0;
    fs_558_[5] = 0.0;
    fs_558_[6] = -sinAngle;
    fs_558_[7] = 0.0;
    fs_558_[8] = cosAngle;
    const fs_559_ = new Float32Array(9);
    fs_559_[0] = fs_558_[0] * fs[0] + fs_558_[1] * fs[3] + fs_558_[2] * fs[6];
    fs_559_[1] = fs_558_[0] * fs[1] + fs_558_[1] * fs[4] + fs_558_[2] * fs[7];
    fs_559_[2] = fs_558_[0] * fs[2] + fs_558_[1] * fs[5] + fs_558_[2] * fs[8];
    fs_559_[3] = fs_558_[3] * fs[0] + fs_558_[4] * fs[3] + fs_558_[5] * fs[6];
    fs_559_[4] = fs_558_[3] * fs[1] + fs_558_[4] * fs[4] + fs_558_[5] * fs[7];
    fs_559_[5] = fs_558_[3] * fs[2] + fs_558_[4] * fs[5] + fs_558_[5] * fs[8];
    fs_559_[6] = fs_558_[6] * fs[0] + fs_558_[7] * fs[3] + fs_558_[8] * fs[6];
    fs_559_[7] = fs_558_[6] * fs[1] + fs_558_[7] * fs[4] + fs_558_[8] * fs[7];
    fs_559_[8] = fs_558_[6] * fs[2] + fs_558_[7] * fs[5] + fs_558_[8] * fs[8];
    fs_559_[0] *= scaleX;
    fs_559_[1] *= scaleX;
    fs_559_[2] *= scaleX;
    fs_559_[3] *= scaleY;
    fs_559_[4] *= scaleY;
    fs_559_[5] *= scaleY;
    fs_559_[6] *= scaleZ;
    fs_559_[7] *= scaleZ;
    fs_559_[8] *= scaleZ;
    return fs_559_;
}
