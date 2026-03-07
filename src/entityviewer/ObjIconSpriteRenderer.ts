import { Rasterizer2D } from "../rs/graphics/Rasterizer2D";
import { Rasterizer3D } from "../rs/graphics/Rasterizer3D";
import { COSINE, SINE } from "../rs/MathConstants";
import { Model } from "../rs/model/Model";
import { SpritePixels } from "../rs/sprite/SpritePixels";

export type ObjIconSprite = Readonly<{
    width: number;
    height: number;
    pixels: Int32Array;
}>;

export type ObjIconRenderMode = "authentic" | "viewer";

type ProjectedFace = Readonly<{
    index: number;
    depth: number;
}>;

type ProjectionStats = Readonly<{
    visibleVertices: number;
    minScreenX: number;
    maxScreenX: number;
    minScreenY: number;
    maxScreenY: number;
    minProjectedZ: number;
    maxProjectedZ: number;
}>;

type ItemTransform = {
    e11: number;
    e12: number;
    e13: number;
    e21: number;
    e22: number;
    e23: number;
    e31: number;
    e32: number;
    e33: number;
    tx: number;
    ty: number;
    tz: number;
};

const BASE_ICON_WIDTH = 36;
const BASE_ICON_HEIGHT = 32;
const LEGACY_ICON_SIZE = 128;
const LEGACY_ICON_PADDING = 8;
const VIEWER_ICON_SCALE = 8;
const VIEWER_ICON_WIDTH = BASE_ICON_WIDTH * VIEWER_ICON_SCALE;
const VIEWER_ICON_HEIGHT = BASE_ICON_HEIGHT * VIEWER_ICON_SCALE;
const BASE_ITEM_VIEW_CENTER_X = 16;
const BASE_ITEM_VIEW_CENTER_Y = 16;
const BASE_ITEM_VIEW_ZOOM = 512;

export function renderObjIconSprite(
    model: Model,
    zoom2d: number,
    xan2d: number,
    yan2d: number,
    zan2d: number,
    offsetX2d: number,
    offsetY2d: number,
    mode: ObjIconRenderMode = "authentic",
): ObjIconSprite {
    const width = mode === "viewer" ? VIEWER_ICON_WIDTH : BASE_ICON_WIDTH;
    const height = mode === "viewer" ? VIEWER_ICON_HEIGHT : BASE_ICON_HEIGHT;
    const sprite = SpritePixels.fromDimensions(width, height);
    const rasterizer2d = new Rasterizer2D();
    const rasterizer3d = new Rasterizer3D();
    sprite.setRaster(rasterizer2d);
    rasterizer3d.setClip(rasterizer2d);
    rasterizer3d.rasterGouraudLowRes = false;

    model.calculateBounds();
    const transform = createItemIconTransform(
        model.minY,
        zoom2d,
        xan2d & 2047,
        yan2d & 2047,
        zan2d & 2047,
        offsetX2d,
        offsetY2d,
    );

    const screenX = new Int32Array(model.verticesCount);
    const screenY = new Int32Array(model.verticesCount);
    const depthZ = new Int32Array(model.verticesCount);
    const projectionStats = projectModel(
        width,
        height,
        model,
        transform,
        screenX,
        screenY,
        depthZ,
    );

    const faces = collectSortedFaces(model, depthZ);
    for (let i = 0; i < faces.length; i++) {
        drawFace(rasterizer3d, model, screenX, screenY, faces[i].index);
    }

    if (mode === "viewer") {
        sprite.outline(0x010101);
        sprite.shadow(0x202020);
    }

    let nonZeroPixels = 0;
    for (let i = 0; i < sprite.pixels.length; i++) {
        const rgb = sprite.pixels[i] & 0xffffff;
        if (rgb === 0) {
            sprite.pixels[i] = 0;
            continue;
        }
        sprite.pixels[i] = (sprite.pixels[i] & 0xffffff) | 0xff000000;
        if (sprite.pixels[i] !== 0) {
            nonZeroPixels++;
        }
    }
    if (nonZeroPixels === 0) {
        console.warn("[entity-viewer] blank icon sprite", {
            zoom2d,
            xan2d,
            yan2d,
            zan2d,
            offsetX2d,
            offsetY2d,
            width,
            height,
            projectionStats,
        });
    }

    return {
        width,
        height,
        pixels: sprite.pixels,
    };
}

export function renderLegacyObjIconSprite(
    model: Model,
    zoom2d: number,
    xan2d: number,
    yan2d: number,
    zan2d: number,
    offsetX2d: number,
    offsetY2d: number,
    width: number = LEGACY_ICON_SIZE,
    height: number = LEGACY_ICON_SIZE,
): ObjIconSprite {
    const sprite = SpritePixels.fromDimensions(width, height);
    const rasterizer2d = new Rasterizer2D();
    const rasterizer3d = new Rasterizer3D();
    sprite.setRaster(rasterizer2d);
    rasterizer3d.setClip(rasterizer2d);
    rasterizer3d.rasterGouraudLowRes = false;

    model.calculateBounds();
    const transform = createItemIconTransform(
        model.minY,
        zoom2d,
        xan2d & 2047,
        yan2d & 2047,
        zan2d & 2047,
        offsetX2d,
        offsetY2d,
    );
    const safeWidth = Math.max(1, width - LEGACY_ICON_PADDING * 2);
    const safeHeight = Math.max(1, height - LEGACY_ICON_PADDING * 2);
    const transformedBounds = collectTransformedBounds(model, transform);
    const extentX = Math.max(1, transformedBounds.maxX - transformedBounds.minX);
    const extentY = Math.max(1, transformedBounds.maxY - transformedBounds.minY);
    const zoomScale = Math.max(0.25, zoom2d / 2000);
    let scale = Math.max(0.01, Math.min(safeWidth / extentX, safeHeight / extentY) * zoomScale);

    const screenX = new Int32Array(model.verticesCount);
    const screenY = new Int32Array(model.verticesCount);
    const depthZ = new Int32Array(model.verticesCount);
    let projected = projectLegacyModel(model, transform, scale, screenX, screenY, depthZ);

    const projectedWidth = Math.max(1, projected.maxX - projected.minX);
    const projectedHeight = Math.max(1, projected.maxY - projected.minY);
    const fitScale = Math.min(safeWidth / projectedWidth, safeHeight / projectedHeight, 1);
    if (fitScale < 1) {
        scale = Math.max(0.01, scale * fitScale);
        projected = projectLegacyModel(model, transform, scale, screenX, screenY, depthZ);
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

function createItemIconTransform(
    modelMinY: number,
    zoom2d: number,
    xan2d: number,
    yan2d: number,
    zan2d: number,
    offsetX2d: number,
    offsetY2d: number,
): ItemTransform {
    const zoom = zoom2d << 2;
    const transform = makeRotationZ((-zan2d) & 2047);
    rotateAxisY(transform, yan2d);
    translate(
        transform,
        offsetX2d << 2,
        ((SINE[xan2d] * zoom) >> 16) + (offsetY2d << 2) - (modelMinY >> 1),
        ((COSINE[xan2d] * zoom) >> 16) + (offsetY2d << 2),
    );
    rotateAxisX(transform, xan2d);
    return transform;
}

function projectModel(
    width: number,
    height: number,
    model: Model,
    transform: ItemTransform,
    screenX: Int32Array,
    screenY: Int32Array,
    depthZ: Int32Array,
): ProjectionStats {
    const viewScale = Math.max(
        1,
        Math.min(width / BASE_ICON_WIDTH, height / BASE_ICON_HEIGHT),
    );
    const itemViewCenterX = Math.round(BASE_ITEM_VIEW_CENTER_X * viewScale);
    const itemViewCenterY = Math.round(BASE_ITEM_VIEW_CENTER_Y * viewScale);
    const itemViewZoom = Math.round(BASE_ITEM_VIEW_ZOOM * viewScale);
    let visibleVertices = 0;
    let minScreenX = Number.POSITIVE_INFINITY;
    let maxScreenX = Number.NEGATIVE_INFINITY;
    let minScreenY = Number.POSITIVE_INFINITY;
    let maxScreenY = Number.NEGATIVE_INFINITY;
    let minProjectedZ = Number.POSITIVE_INFINITY;
    let maxProjectedZ = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < model.verticesCount; i++) {
        const x = model.verticesX[i] | 0;
        const y = model.verticesY[i] | 0;
        const z = model.verticesZ[i] | 0;
        const projectedX =
            transform.tx + transform.e11 * x + transform.e12 * y + transform.e13 * z;
        const projectedY =
            transform.ty + transform.e21 * x + transform.e22 * y + transform.e23 * z;
        const projectedZ =
            transform.tz + transform.e31 * x + transform.e32 * y + transform.e33 * z;
        const depth = projectedZ | 0;
        depthZ[i] = depth;
        if (projectedZ < minProjectedZ) minProjectedZ = projectedZ;
        if (projectedZ > maxProjectedZ) maxProjectedZ = projectedZ;
        if (projectedZ <= 0) {
            screenX[i] = -9999;
            screenY[i] = -9999;
            continue;
        }
        const sx = itemViewCenterX + ((projectedX * itemViewZoom) / projectedZ) | 0;
        const sy = itemViewCenterY + ((projectedY * itemViewZoom) / projectedZ) | 0;
        screenX[i] = sx;
        screenY[i] = sy;
        visibleVertices++;
        if (sx < minScreenX) minScreenX = sx;
        if (sx > maxScreenX) maxScreenX = sx;
        if (sy < minScreenY) minScreenY = sy;
        if (sy > maxScreenY) maxScreenY = sy;
    }
    return {
        visibleVertices,
        minScreenX,
        maxScreenX,
        minScreenY,
        maxScreenY,
        minProjectedZ,
        maxProjectedZ,
    };
}

type LegacyProjectedBounds = Readonly<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}>;

function projectLegacyModel(
    model: Model,
    transform: ItemTransform,
    scale: number,
    screenX: Int32Array,
    screenY: Int32Array,
    depthZ: Int32Array,
): LegacyProjectedBounds {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < model.verticesCount; i++) {
        const x = model.verticesX[i] | 0;
        const y = model.verticesY[i] | 0;
        const z = model.verticesZ[i] | 0;
        const projectedX =
            transform.tx + transform.e11 * x + transform.e12 * y + transform.e13 * z;
        const projectedY =
            transform.ty + transform.e21 * x + transform.e22 * y + transform.e23 * z;
        const projectedZ =
            transform.tz + transform.e31 * x + transform.e32 * y + transform.e33 * z;
        const sx = Math.round(projectedX * scale);
        const sy = Math.round(projectedY * scale);
        screenX[i] = sx;
        screenY[i] = sy;
        depthZ[i] = projectedZ | 0;
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

type TransformedBounds = Readonly<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}>;

function collectTransformedBounds(model: Model, transform: ItemTransform): TransformedBounds {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < model.verticesCount; i++) {
        const x = model.verticesX[i] | 0;
        const y = model.verticesY[i] | 0;
        const z = model.verticesZ[i] | 0;
        const projectedX =
            transform.tx + transform.e11 * x + transform.e12 * y + transform.e13 * z;
        const projectedY =
            transform.ty + transform.e21 * x + transform.e22 * y + transform.e23 * z;
        if (projectedX < minX) minX = projectedX;
        if (projectedX > maxX) maxX = projectedX;
        if (projectedY < minY) minY = projectedY;
        if (projectedY > maxY) maxY = projectedY;
    }
    return {
        minX,
        maxX,
        minY,
        maxY,
    };
}

function makeRotationZ(angle: number): ItemTransform {
    const cos = COSINE[angle] / 65536.0;
    const sin = SINE[angle] / 65536.0;
    return {
        e11: cos,
        e12: -sin,
        e13: 0,
        e21: sin,
        e22: cos,
        e23: 0,
        e31: 0,
        e32: 0,
        e33: 1,
        tx: 0,
        ty: 0,
        tz: 0,
    };
}

function rotateAxisY(transform: ItemTransform, angle: number): void {
    const cos = COSINE[angle] / 65536.0;
    const sin = SINE[angle] / 65536.0;
    const e11 = transform.e11;
    const e12 = transform.e12;
    const e13 = transform.e13;
    const tx = transform.tx;
    transform.e11 = e11 * cos + sin * transform.e31;
    transform.e31 = cos * transform.e31 - e11 * sin;
    transform.e12 = sin * transform.e32 + e12 * cos;
    transform.e32 = transform.e32 * cos - e12 * sin;
    transform.e13 = cos * e13 + sin * transform.e33;
    transform.e33 = cos * transform.e33 - e13 * sin;
    transform.tx = tx * cos + sin * transform.tz;
    transform.tz = cos * transform.tz - tx * sin;
}

function translate(transform: ItemTransform, x: number, y: number, z: number): void {
    transform.tx += x;
    transform.ty += y;
    transform.tz += z;
}

function rotateAxisX(transform: ItemTransform, angle: number): void {
    const cos = COSINE[angle] / 65536.0;
    const sin = SINE[angle] / 65536.0;
    const e21 = transform.e21;
    const e22 = transform.e22;
    const e23 = transform.e23;
    const ty = transform.ty;
    transform.e21 = e21 * cos - transform.e31 * sin;
    transform.e31 = sin * e21 + cos * transform.e31;
    transform.e22 = cos * e22 - transform.e32 * sin;
    transform.e32 = transform.e32 * cos + e22 * sin;
    transform.e23 = cos * e23 - transform.e33 * sin;
    transform.e33 = cos * transform.e33 + sin * e23;
    transform.ty = cos * ty - transform.tz * sin;
    transform.tz = cos * transform.tz + sin * ty;
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
