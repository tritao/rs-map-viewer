import {
    INVALID_HSL_COLOR,
    adjustOverlayLight,
    adjustUnderlayLight,
    mixHsl,
    packHsl,
} from "../util/ColorUtil";
import type { TileRotation, TileShapeId } from "./Scene";

const TILE_SIZE = 128;
const HALF_TILE_SIZE = TILE_SIZE / 2;
const QUARTER_TILE_SIZE = TILE_SIZE / 4;
const THREE_QTR_TILE_SIZE = (TILE_SIZE * 3) / 4;

const tileShapeVertexIndices = [
    [1, 3, 5, 7],
    [1, 3, 5, 7],
    [1, 3, 5, 7],
    [1, 3, 5, 7, 6],
    [1, 3, 5, 7, 6],
    [1, 3, 5, 7, 6],
    [1, 3, 5, 7, 6],
    [1, 3, 5, 7, 2, 6],
    [1, 3, 5, 7, 2, 8],
    [1, 3, 5, 7, 2, 8],
    [1, 3, 5, 7, 11, 12],
    [1, 3, 5, 7, 11, 12],
    [1, 3, 5, 7, 13, 14],
];

const tileShapeFaces = [
    [0, 1, 2, 3, 0, 0, 1, 3],
    [1, 1, 2, 3, 1, 0, 1, 3],
    [0, 1, 2, 3, 1, 0, 1, 3],
    [0, 0, 1, 2, 0, 0, 2, 4, 1, 0, 4, 3],
    [0, 0, 1, 4, 0, 0, 4, 3, 1, 1, 2, 4],
    [0, 0, 4, 3, 1, 0, 1, 2, 1, 0, 2, 4],
    [0, 1, 2, 4, 1, 0, 1, 4, 1, 0, 4, 3],
    [0, 4, 1, 2, 0, 4, 2, 5, 1, 0, 4, 5, 1, 0, 5, 3],
    [0, 4, 1, 2, 0, 4, 2, 3, 0, 4, 3, 5, 1, 0, 4, 5],
    [0, 0, 4, 5, 1, 4, 1, 2, 1, 4, 2, 3, 1, 4, 3, 5],
    [0, 0, 1, 5, 0, 1, 4, 5, 0, 1, 2, 4, 1, 0, 5, 3, 1, 5, 4, 3, 1, 4, 2, 3],
    [1, 0, 1, 5, 1, 1, 4, 5, 1, 1, 2, 4, 0, 0, 5, 3, 0, 5, 4, 3, 0, 4, 2, 3],
    [1, 0, 5, 4, 1, 0, 1, 5, 0, 0, 4, 3, 0, 4, 5, 3, 0, 5, 2, 3, 0, 1, 2, 5],
];

type SceneTileFace = {
    vertices: [SceneTileVertex, SceneTileVertex, SceneTileVertex];
};

type SceneTileVertex = {
    x: number;
    y: number;
    z: number;
    hsl: number;
    u: number;
    v: number;
    textureId: number;
};

export type OverlayCornerSet = {
    // Corner order: SW, SE, NE, NW
    baseHsl: Int32Array;
    minimapHsl: Int32Array;
    textureId: Int32Array;
    textureSize: Int32Array;
};

export type OverlayEdgeSet = {
    // Edge order: S, E, N, W
    baseHsl: Int32Array;
    minimapHsl: Int32Array;
    textureId: Int32Array;
    textureSize: Int32Array;
};

const DEFAULT_OVERLAY_CORNERS: OverlayCornerSet = {
    baseHsl: new Int32Array([-1, -1, -1, -1]),
    minimapHsl: new Int32Array([-1, -1, -1, -1]),
    textureId: new Int32Array([-1, -1, -1, -1]),
    textureSize: new Int32Array([TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE]),
};

const DEFAULT_OVERLAY_EDGES: OverlayEdgeSet = {
    baseHsl: new Int32Array([-1, -1, -1, -1]),
    minimapHsl: new Int32Array([-1, -1, -1, -1]),
    textureId: new Int32Array([-1, -1, -1, -1]),
    textureSize: new Int32Array([TILE_SIZE, TILE_SIZE, TILE_SIZE, TILE_SIZE]),
};

export class SceneTileModel {
    underlayHslSw: number;
    underlayHslSe: number;
    underlayHslNe: number;
    underlayHslNw: number;

    overlayHslSw: number;
    overlayHslSe: number;
    overlayHslNe: number;
    overlayHslNw: number;

    overlayMinimapHslSw: number;
    overlayMinimapHslSe: number;
    overlayMinimapHslNe: number;
    overlayMinimapHslNw: number;

    vertexX: Int32Array;
    vertexY: Int32Array;
    vertexZ: Int32Array;

    facesA: Int32Array;
    facesB: Int32Array;
    facesC: Int32Array;

    faceColorsA: Int32Array;
    faceColorsB: Int32Array;
    faceColorsC: Int32Array;

    minimapFaceColorsA: Int32Array;
    minimapFaceColorsB: Int32Array;
    minimapFaceColorsC: Int32Array;

    faceTextures?: Int32Array;

    faces: SceneTileFace[] = [];
    // This can be less than faces.length due to hidden faces
    normalFaceCount: number;

    constructor(
        readonly shape: TileShapeId,
        readonly rotation: TileRotation,
        readonly underlayTextureId: number,
        readonly underlayTextureSize: number,
        overlayPrimaryCorners: OverlayCornerSet | undefined,
        overlayPrimaryEdges: OverlayEdgeSet | undefined,
        x: number,
        y: number,
        heightSw: number,
        heightSe: number,
        heightNe: number,
        heightNw: number,
        readonly lightSw: number,
        readonly lightSe: number,
        readonly lightNe: number,
        readonly lightNw: number,
        readonly blendUnderlayHslSw: number,
        readonly blendUnderlayHslSe: number,
        readonly blendUnderlayHslNe: number,
        readonly blendUnderlayHslNw: number,
        readonly underlayRgb: number,
        readonly overlayRgb: number,
    ) {
        const underlayHslSw = (this.underlayHslSw = adjustUnderlayLight(
            blendUnderlayHslSw,
            lightSw,
        ));
        const underlayHslSe = (this.underlayHslSe = adjustUnderlayLight(
            blendUnderlayHslSe,
            lightSe,
        ));
        const underlayHslNe = (this.underlayHslNe = adjustUnderlayLight(
            blendUnderlayHslNe,
            lightNe,
        ));
        const underlayHslNw = (this.underlayHslNw = adjustUnderlayLight(
            blendUnderlayHslNw,
            lightNw,
        ));

        const underlayMinimapHslSw = adjustUnderlayLight(blendUnderlayHslSw, lightSw);
        const underlayMinimapHslSe = adjustUnderlayLight(blendUnderlayHslSw, lightSe);
        const underlayMinimapHslNe = adjustUnderlayLight(blendUnderlayHslSw, lightNe);
        const underlayMinimapHslNw = adjustUnderlayLight(blendUnderlayHslSw, lightNw);

        const primaryCorners: OverlayCornerSet = overlayPrimaryCorners ?? DEFAULT_OVERLAY_CORNERS;
        const primaryEdges: OverlayEdgeSet = overlayPrimaryEdges ?? DEFAULT_OVERLAY_EDGES;

        const overlayHslSw = (this.overlayHslSw = adjustOverlayLight(primaryCorners.baseHsl[0], lightSw));
        const overlayHslSe = (this.overlayHslSe = adjustOverlayLight(primaryCorners.baseHsl[1], lightSe));
        const overlayHslNe = (this.overlayHslNe = adjustOverlayLight(primaryCorners.baseHsl[2], lightNe));
        const overlayHslNw = (this.overlayHslNw = adjustOverlayLight(primaryCorners.baseHsl[3], lightNw));

        const overlayMinimapHslSw = (this.overlayMinimapHslSw = adjustOverlayLight(
            primaryCorners.minimapHsl[0],
            lightSw,
        ));
        const overlayMinimapHslSe = (this.overlayMinimapHslSe = adjustOverlayLight(
            primaryCorners.minimapHsl[1],
            lightSe,
        ));
        const overlayMinimapHslNe = (this.overlayMinimapHslNe = adjustOverlayLight(
            primaryCorners.minimapHsl[2],
            lightNe,
        ));
        const overlayMinimapHslNw = (this.overlayMinimapHslNw = adjustOverlayLight(
            primaryCorners.minimapHsl[3],
            lightNw,
        ));

        const overlayHslS = adjustOverlayLight(
            primaryEdges.baseHsl[0],
            (lightSw + lightSe) >> 1,
        );
        const overlayHslE = adjustOverlayLight(
            primaryEdges.baseHsl[1],
            (lightSe + lightNe) >> 1,
        );
        const overlayHslN = adjustOverlayLight(
            primaryEdges.baseHsl[2],
            (lightNe + lightNw) >> 1,
        );
        const overlayHslW = adjustOverlayLight(
            primaryEdges.baseHsl[3],
            (lightNw + lightSw) >> 1,
        );

        const overlayMinimapHslS = adjustOverlayLight(primaryEdges.minimapHsl[0], (lightSw + lightSe) >> 1);
        const overlayMinimapHslE = adjustOverlayLight(primaryEdges.minimapHsl[1], (lightSe + lightNe) >> 1);
        const overlayMinimapHslN = adjustOverlayLight(primaryEdges.minimapHsl[2], (lightNe + lightNw) >> 1);
        const overlayMinimapHslW = adjustOverlayLight(primaryEdges.minimapHsl[3], (lightNw + lightSw) >> 1);

        this.underlayRgb = underlayRgb;
        this.overlayRgb = overlayRgb;

        const vertexIndices = tileShapeVertexIndices[shape];
        const vertexCount = vertexIndices.length;
        this.vertexX = new Int32Array(vertexCount);
        this.vertexY = new Int32Array(vertexCount);
        this.vertexZ = new Int32Array(vertexCount);
        const underlayHsls = new Array<number>(vertexCount);
        const underlayMinimapHsls = new Array<number>(vertexCount);
        const overlayHsls = new Array<number>(vertexCount);
        const overlayMinimapHsls = new Array<number>(vertexCount);
        const tileX = x * TILE_SIZE;
        const tileY = y * TILE_SIZE;

        const chosenCornerIndex = new Int8Array(vertexCount);
        const chosenCornerWeight = new Float32Array(vertexCount);

        for (let i = 0; i < vertexCount; i++) {
            let vertexIndex = vertexIndices[i];
            if ((vertexIndex & 1) === 0 && vertexIndex <= 8) {
                vertexIndex = ((vertexIndex - rotation - rotation - 1) & 7) + 1;
            }

            if (vertexIndex > 8 && vertexIndex <= 12) {
                vertexIndex = ((vertexIndex - 9 - rotation) & 3) + 9;
            }

            if (vertexIndex > 12 && vertexIndex <= 16) {
                vertexIndex = ((vertexIndex - 13 - rotation) & 3) + 13;
            }

            let vertX = 0;
            let vertZ = 0;
            let vertY = 0;
            let vertUnderlayHsl = 0;
            let vertUnderlayMinimapHsl = 0;
            let vertOverlayHsl = 0;
            let vertOverlayMinimapHsl = 0;

            if (vertexIndex === 1) {
                vertX = tileX;
                vertZ = tileY;
                vertY = heightSw;
                vertUnderlayHsl = underlayHslSw;
                vertUnderlayMinimapHsl = underlayMinimapHslSw;
                vertOverlayHsl = overlayHslSw;
                vertOverlayMinimapHsl = overlayMinimapHslSw;
            } else if (vertexIndex === 2) {
                vertX = tileX + HALF_TILE_SIZE;
                vertZ = tileY;
                vertY = (heightSe + heightSw) >> 1;
                vertUnderlayHsl = mixHsl(underlayHslSe, underlayHslSw);
                vertUnderlayMinimapHsl = (underlayMinimapHslSe + underlayMinimapHslSw) >> 1;
                vertOverlayHsl = overlayPrimaryEdges ? overlayHslS : (overlayHslSe + overlayHslSw) >> 1;
                vertOverlayMinimapHsl = overlayPrimaryEdges
                    ? overlayMinimapHslS
                    : (overlayMinimapHslSe + overlayMinimapHslSw) >> 1;
            } else if (vertexIndex === 3) {
                vertX = tileX + TILE_SIZE;
                vertZ = tileY;
                vertY = heightSe;
                vertUnderlayHsl = underlayHslSe;
                vertUnderlayMinimapHsl = underlayMinimapHslSe;
                vertOverlayHsl = overlayHslSe;
                vertOverlayMinimapHsl = overlayMinimapHslSe;
            } else if (vertexIndex === 4) {
                vertX = tileX + TILE_SIZE;
                vertZ = tileY + HALF_TILE_SIZE;
                vertY = (heightNe + heightSe) >> 1;
                vertUnderlayHsl = mixHsl(underlayHslSe, underlayHslNe);
                vertUnderlayMinimapHsl = (underlayMinimapHslSe + underlayMinimapHslNe) >> 1;
                vertOverlayHsl = overlayPrimaryEdges ? overlayHslE : (overlayHslSe + overlayHslNe) >> 1;
                vertOverlayMinimapHsl = overlayPrimaryEdges
                    ? overlayMinimapHslE
                    : (overlayMinimapHslSe + overlayMinimapHslNe) >> 1;
            } else if (vertexIndex === 5) {
                vertX = tileX + TILE_SIZE;
                vertZ = tileY + TILE_SIZE;
                vertY = heightNe;
                vertUnderlayHsl = underlayHslNe;
                vertUnderlayMinimapHsl = underlayMinimapHslNe;
                vertOverlayHsl = overlayHslNe;
                vertOverlayMinimapHsl = overlayMinimapHslNe;
            } else if (vertexIndex === 6) {
                vertX = tileX + HALF_TILE_SIZE;
                vertZ = tileY + TILE_SIZE;
                vertY = (heightNe + heightNw) >> 1;
                vertUnderlayHsl = mixHsl(underlayHslNw, underlayHslNe);
                vertUnderlayMinimapHsl = (underlayMinimapHslNw + underlayMinimapHslNe) >> 1;
                vertOverlayHsl = overlayPrimaryEdges ? overlayHslN : (overlayHslNw + overlayHslNe) >> 1;
                vertOverlayMinimapHsl = overlayPrimaryEdges
                    ? overlayMinimapHslN
                    : (overlayMinimapHslNw + overlayMinimapHslNe) >> 1;
            } else if (vertexIndex === 7) {
                vertX = tileX;
                vertZ = tileY + TILE_SIZE;
                vertY = heightNw;
                vertUnderlayHsl = underlayHslNw;
                vertUnderlayMinimapHsl = underlayMinimapHslNw;
                vertOverlayHsl = overlayHslNw;
                vertOverlayMinimapHsl = overlayMinimapHslNw;
            } else if (vertexIndex === 8) {
                vertX = tileX;
                vertZ = tileY + HALF_TILE_SIZE;
                vertY = (heightNw + heightSw) >> 1;
                vertUnderlayHsl = mixHsl(underlayHslNw, underlayHslSw);
                vertUnderlayMinimapHsl = (underlayMinimapHslNw + underlayMinimapHslSw) >> 1;
                vertOverlayHsl = overlayPrimaryEdges ? overlayHslW : (overlayHslNw + overlayHslSw) >> 1;
                vertOverlayMinimapHsl = overlayPrimaryEdges
                    ? overlayMinimapHslW
                    : (overlayMinimapHslNw + overlayMinimapHslSw) >> 1;
            } else if (vertexIndex === 9) {
                vertX = tileX + HALF_TILE_SIZE;
                vertZ = tileY + QUARTER_TILE_SIZE;
                vertY = (heightSe + heightSw) >> 1;
                vertUnderlayHsl = mixHsl(underlayHslSe, underlayHslSw);
                vertUnderlayMinimapHsl = (underlayMinimapHslSe + underlayMinimapHslSw) >> 1;
                vertOverlayHsl = (overlayHslSe + overlayHslSw) >> 1;
                vertOverlayMinimapHsl = (overlayMinimapHslSe + overlayMinimapHslSw) >> 1;
            } else if (vertexIndex === 10) {
                vertX = tileX + THREE_QTR_TILE_SIZE;
                vertZ = tileY + HALF_TILE_SIZE;
                vertY = (heightNe + heightSe) >> 1;
                vertUnderlayHsl = mixHsl(underlayHslSe, underlayHslNe);
                vertUnderlayMinimapHsl = (underlayMinimapHslSe + underlayMinimapHslNe) >> 1;
                vertOverlayHsl = (overlayHslSe + overlayHslNe) >> 1;
                vertOverlayMinimapHsl = (overlayMinimapHslSe + overlayMinimapHslNe) >> 1;
            } else if (vertexIndex === 11) {
                vertX = tileX + HALF_TILE_SIZE;
                vertZ = tileY + THREE_QTR_TILE_SIZE;
                vertY = (heightNe + heightNw) >> 1;
                vertUnderlayHsl = mixHsl(underlayHslNw, underlayHslNe);
                vertUnderlayMinimapHsl = (underlayMinimapHslNw + underlayMinimapHslNe) >> 1;
                vertOverlayHsl = (overlayHslNw + overlayHslNe) >> 1;
                vertOverlayMinimapHsl = (overlayMinimapHslNw + overlayMinimapHslNe) >> 1;
            } else if (vertexIndex === 12) {
                vertX = tileX + QUARTER_TILE_SIZE;
                vertZ = tileY + HALF_TILE_SIZE;
                vertY = (heightNw + heightSw) >> 1;
                vertUnderlayHsl = mixHsl(underlayHslNw, underlayHslSw);
                vertUnderlayMinimapHsl = (underlayMinimapHslNw + underlayMinimapHslSw) >> 1;
                vertOverlayHsl = (overlayHslNw + overlayHslSw) >> 1;
                vertOverlayMinimapHsl = (overlayMinimapHslNw + overlayMinimapHslSw) >> 1;
            } else if (vertexIndex === 13) {
                vertX = tileX + QUARTER_TILE_SIZE;
                vertZ = tileY + QUARTER_TILE_SIZE;
                vertY = heightSw;
                vertUnderlayHsl = underlayHslSw;
                vertUnderlayMinimapHsl = underlayMinimapHslSw;
                vertOverlayHsl = overlayHslSw;
                vertOverlayMinimapHsl = overlayMinimapHslSw;
            } else if (vertexIndex === 14) {
                vertX = tileX + THREE_QTR_TILE_SIZE;
                vertZ = tileY + QUARTER_TILE_SIZE;
                vertY = heightSe;
                vertUnderlayHsl = underlayHslSe;
                vertUnderlayMinimapHsl = underlayMinimapHslSe;
                vertOverlayHsl = overlayHslSe;
                vertOverlayMinimapHsl = overlayMinimapHslSe;
            } else if (vertexIndex === 15) {
                vertX = tileX + THREE_QTR_TILE_SIZE;
                vertZ = tileY + THREE_QTR_TILE_SIZE;
                vertY = heightNe;
                vertUnderlayHsl = underlayHslNe;
                vertUnderlayMinimapHsl = underlayMinimapHslNe;
                vertOverlayHsl = overlayHslNe;
                vertOverlayMinimapHsl = overlayMinimapHslNe;
            } else {
                vertX = tileX + QUARTER_TILE_SIZE;
                vertZ = tileY + THREE_QTR_TILE_SIZE;
                vertY = heightNw;
                vertUnderlayHsl = underlayHslNw;
                vertUnderlayMinimapHsl = underlayMinimapHslNw;
                vertOverlayHsl = overlayHslNw;
                vertOverlayMinimapHsl = overlayMinimapHslNw;
            }

            this.vertexX[i] = vertX;
            this.vertexY[i] = vertY;
            this.vertexZ[i] = vertZ;
            underlayHsls[i] = vertUnderlayHsl;
            underlayMinimapHsls[i] = vertUnderlayMinimapHsl;
            overlayHsls[i] = vertOverlayHsl;
            overlayMinimapHsls[i] = vertOverlayMinimapHsl;
        }

        for (let i = 0; i < vertexCount; i++) {
            const localU = (this.vertexX[i] - tileX) / TILE_SIZE;
            const localV = (this.vertexZ[i] - tileY) / TILE_SIZE;

            const wSw = (1.0 - localU) * (1.0 - localV);
            const wSe = localU * (1.0 - localV);
            const wNe = localU * localV;
            const wNw = (1.0 - localU) * localV;

            let corner = 0;
            let best = wSw;
            if (wSe > best) {
                best = wSe;
                corner = 1;
            }
            if (wNe > best) {
                best = wNe;
                corner = 2;
            }
            if (wNw > best) {
                best = wNw;
                corner = 3;
            }

            chosenCornerIndex[i] = corner;
            chosenCornerWeight[i] = best;
        }

        const tileFaces = tileShapeFaces[shape];
        const faceCount = tileFaces.length / 4;
        this.normalFaceCount = faceCount;

        this.facesA = new Int32Array(faceCount);
        this.facesB = new Int32Array(faceCount);
        this.facesC = new Int32Array(faceCount);

        this.faceColorsA = new Int32Array(faceCount);
        this.faceColorsB = new Int32Array(faceCount);
        this.faceColorsC = new Int32Array(faceCount);

        this.minimapFaceColorsA = new Int32Array(faceCount);
        this.minimapFaceColorsB = new Int32Array(faceCount);
        this.minimapFaceColorsC = new Int32Array(faceCount);

        const hasPrimaryTexture =
            primaryCorners.textureId[0] !== -1 ||
            primaryCorners.textureId[1] !== -1 ||
            primaryCorners.textureId[2] !== -1 ||
            primaryCorners.textureId[3] !== -1;

        if (underlayTextureId !== -1 || hasPrimaryTexture) {
            this.faceTextures = new Int32Array(faceCount);
        }

        let tileFaceIndex = 0;

        for (let i = 0; i < faceCount; i++) {
            const isOverlay = tileFaces[tileFaceIndex++] === 1;
            let a = tileFaces[tileFaceIndex++];
            let b = tileFaces[tileFaceIndex++];
            let c = tileFaces[tileFaceIndex++];

            if (a < 4) {
                a = (a - rotation) & 3;
            }

            if (b < 4) {
                b = (b - rotation) & 3;
            }

            if (c < 4) {
                c = (c - rotation) & 3;
            }

            this.facesA[i] = a;
            this.facesB[i] = b;
            this.facesC[i] = c;
            let hslA = 0;
            let hslB = 0;
            let hslC = 0;
            let minimapHslA = 0;
            let minimapHslB = 0;
            let minimapHslC = 0;

            if (isOverlay) {
                hslA = overlayHsls[a];
                hslB = overlayHsls[b];
                hslC = overlayHsls[c];
                minimapHslA = overlayMinimapHsls[a];
                minimapHslB = overlayMinimapHsls[b];
                minimapHslC = overlayMinimapHsls[c];
            } else {
                hslA = underlayHsls[a];
                hslB = underlayHsls[b];
                hslC = underlayHsls[c];
                minimapHslA = underlayMinimapHsls[a];
                minimapHslB = underlayMinimapHsls[b];
                minimapHslC = underlayMinimapHsls[c];
            }

            let faceTextureId = -1;
            let faceTextureSize = TILE_SIZE;
            if (isOverlay) {
                const cornerSet = primaryCorners;
                const cornerWeights = [0.0, 0.0, 0.0, 0.0];

                const corners = [a, b, c];
                for (const vert of corners) {
                    const corner = chosenCornerIndex[vert];
                    cornerWeights[corner] += chosenCornerWeight[vert];
                }

                let bestCorner = 0;
                let bestWeight = cornerWeights[0];
                for (let ci = 1; ci < 4; ci++) {
                    if (cornerWeights[ci] > bestWeight) {
                        bestWeight = cornerWeights[ci];
                        bestCorner = ci;
                    }
                }

                faceTextureId = cornerSet.textureId[bestCorner];
                if (faceTextureId !== -1) {
                    faceTextureSize = Math.max(1, cornerSet.textureSize[bestCorner] | 0);
                }
            } else {
                faceTextureId = underlayTextureId;
                if (faceTextureId !== -1) {
                    faceTextureSize = Math.max(1, underlayTextureSize | 0);
                }
            }

            if (this.faceTextures) {
                this.faceTextures[i] = faceTextureId;
            }

            this.faceColorsA[i] = hslA;
            this.faceColorsB[i] = hslB;
            this.faceColorsC[i] = hslC;

            this.minimapFaceColorsA[i] = minimapHslA;
            this.minimapFaceColorsB[i] = minimapHslB;
            this.minimapFaceColorsC[i] = minimapHslC;

            if (hslA === INVALID_HSL_COLOR && faceTextureId === -1) {
                continue;
            }

            const u0 = (this.vertexX[a] - tileX) / faceTextureSize;
            const v0 = (this.vertexZ[a] - tileY) / faceTextureSize;

            const u1 = (this.vertexX[b] - tileX) / faceTextureSize;
            const v1 = (this.vertexZ[b] - tileY) / faceTextureSize;

            const u2 = (this.vertexX[c] - tileX) / faceTextureSize;
            const v2 = (this.vertexZ[c] - tileY) / faceTextureSize;

            this.faces.push({
                vertices: [
                    {
                        x: this.vertexX[a],
                        y: this.vertexY[a],
                        z: this.vertexZ[a],
                        hsl: hslA,
                        u: u0,
                        v: v0,
                        textureId: faceTextureId,
                    },
                    {
                        x: this.vertexX[b],
                        y: this.vertexY[b],
                        z: this.vertexZ[b],
                        hsl: hslB,
                        u: u1,
                        v: v1,
                        textureId: faceTextureId,
                    },
                    {
                        x: this.vertexX[c],
                        y: this.vertexY[c],
                        z: this.vertexZ[c],
                        hsl: hslC,
                        u: u2,
                        v: v2,
                        textureId: faceTextureId,
                    },
                ],
            });
        }
    }
}
