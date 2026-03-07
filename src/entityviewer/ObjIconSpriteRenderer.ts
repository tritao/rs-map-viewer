import { Rasterizer2D } from "../rs/graphics/Rasterizer2D";
import { Rasterizer3D } from "../rs/graphics/Rasterizer3D";
import { Model } from "../rs/model/Model";
import { SpritePixels } from "../rs/sprite/SpritePixels";

export type ObjIconSprite = Readonly<{
    width: number;
    height: number;
    pixels: Int32Array;
}>;

type ProjectedFace = Readonly<{
    index: number;
    depth: number;
}>;

const DEFAULT_ICON_SIZE = 128;
const ICON_PADDING = 8;

export function renderObjIconSprite(
    model: Model,
    zoom2d: number,
    width: number = DEFAULT_ICON_SIZE,
    height: number = DEFAULT_ICON_SIZE,
): ObjIconSprite {
    const sprite = SpritePixels.fromDimensions(width, height);
    const rasterizer2d = new Rasterizer2D();
    const rasterizer3d = new Rasterizer3D();
    sprite.setRaster(rasterizer2d);
    rasterizer3d.setClip(rasterizer2d);
    rasterizer3d.rasterGouraudLowRes = false;

    model.calculateBounds();
    const safeWidth = Math.max(1, width - ICON_PADDING * 2);
    const safeHeight = Math.max(1, height - ICON_PADDING * 2);
    const extentX = Math.max(1, model.maxX - model.minX);
    const extentY = Math.max(1, model.maxY - model.minY);
    const zoomScale = Math.max(0.25, zoom2d / 2000);
    let scale = Math.max(0.01, Math.min(safeWidth / extentX, safeHeight / extentY) * zoomScale);

    const screenX = new Int32Array(model.verticesCount);
    const screenY = new Int32Array(model.verticesCount);
    const depthZ = new Int32Array(model.verticesCount);
    let projected = projectModel(model, scale, screenX, screenY, depthZ);

    const projectedWidth = Math.max(1, projected.maxX - projected.minX);
    const projectedHeight = Math.max(1, projected.maxY - projected.minY);
    const fitScale = Math.min(safeWidth / projectedWidth, safeHeight / projectedHeight, 1);
    if (fitScale < 1) {
        scale = Math.max(0.01, scale * fitScale);
        projected = projectModel(model, scale, screenX, screenY, depthZ);
    }

    const offsetX =
        Math.round((width - (projected.maxX - projected.minX)) / 2 - projected.minX);
    const offsetY =
        Math.round((height - (projected.maxY - projected.minY)) / 2 - projected.minY);
    for (let i = 0; i < model.verticesCount; i++) {
        screenX[i] += offsetX;
        screenY[i] += offsetY;
    }

    const faces = collectSortedFaces(model, depthZ);
    for (let i = 0; i < faces.length; i++) {
        drawFace(rasterizer3d, model, screenX, screenY, faces[i].index);
    }

    sprite.outline(0x010101);
    sprite.shadow(0x202020);

    return {
        width,
        height,
        pixels: sprite.pixels,
    };
}

type ProjectedBounds = Readonly<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}>;

function projectModel(
    model: Model,
    scale: number,
    screenX: Int32Array,
    screenY: Int32Array,
    depthZ: Int32Array,
): ProjectedBounds {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < model.verticesCount; i++) {
        const sx = Math.round(model.verticesX[i] * scale);
        const sy = Math.round(-model.verticesY[i] * scale);
        screenX[i] = sx;
        screenY[i] = sy;
        depthZ[i] = model.verticesZ[i] | 0;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
    }
    return {
        minX,
        maxX,
        minY,
        maxY,
    };
}

function collectSortedFaces(model: Model, depthZ: Int32Array): ProjectedFace[] {
    const out: ProjectedFace[] = [];
    for (let i = 0; i < model.faceCount; i++) {
        const c = model.faceColors3[i] | 0;
        if (c === -2) {
            continue;
        }
        const a = model.indices1[i] | 0;
        const b = model.indices2[i] | 0;
        const cIdx = model.indices3[i] | 0;
        out.push({
            index: i,
            depth: ((depthZ[a] + depthZ[b] + depthZ[cIdx]) / 3) | 0,
        });
    }
    out.sort((left, right) => left.depth - right.depth);
    return out;
}

function drawFace(
    rasterizer3d: Rasterizer3D,
    model: Model,
    screenX: Int32Array,
    screenY: Int32Array,
    faceIndex: number,
): void {
    const a = model.indices1[faceIndex] | 0;
    const b = model.indices2[faceIndex] | 0;
    const c = model.indices3[faceIndex] | 0;

    const x0 = screenX[a] | 0;
    const y0 = screenY[a] | 0;
    const x1 = screenX[b] | 0;
    const y1 = screenY[b] | 0;
    const x2 = screenX[c] | 0;
    const y2 = screenY[c] | 0;

    const area2 = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area2 === 0) {
        return;
    }

    let hslA = (model.faceColors1[faceIndex] | 0) & 0xffff;
    let hslB = (model.faceColors2[faceIndex] | 0) & 0xffff;
    let hslC = model.faceColors3[faceIndex] | 0;
    if (hslC === -1) {
        hslC = hslB = hslA;
    } else {
        hslC &= 0xffff;
    }

    if (model.faceAlphas) {
        rasterizer3d.rasterAlpha = model.faceAlphas[faceIndex] & 0xff;
    } else {
        rasterizer3d.rasterAlpha = 0;
    }

    rasterizer3d.rasterGouraud(y0, y1, y2, x0, x1, x2, hslA, hslB, hslC);
}
