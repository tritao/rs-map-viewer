import { CollisionData } from "../rs/scene/CollisionMap";
import { DrawRange } from "../renderer/DrawRange";
import { SdMapData } from "../renderer/loader/SdMapData";
import {
    SdRenderableDrawRanges,
    SdRenderableModelInfoTextures,
} from "../renderer/loader/SdRenderableData";
import { LocAnimatedData } from "../renderer/loc/LocAnimatedData";
import { NpcData } from "../renderer/npc/NpcData";
import type { RenderDataResult } from "./RenderDataLoader";

export type MapRenderScenePackInput = Readonly<{
    sceneTileHeights: Int32Array;
    levels: number;
    sizeX: number;
    sizeY: number;
    unitsTileHeightBasis: number;
    bucketCmdCounts: Int32Array;
    bucketModelInfoLengths: Int32Array;
    cmdOffsets: Int32Array;
    cmdElements: Int32Array;
    cmdInstanceCounts: Int32Array;
    packedInstances: Int32Array;
}>;

export type MapRenderDataPayload = Readonly<{
    mapX: number;
    mapY: number;
    cacheName: string;
    maxLevel: number;
    loadObjs: boolean;
    loadNpcs: boolean;
    loadLocs: boolean;
    smoothTerrain: boolean;
    borderSize: number;
    tileRenderFlags: Uint8Array[][];
    collisionDatas: CollisionData[];
    minimapBlob: Blob;
    vertices: Uint8Array;
    indices: Int32Array;
    modelInfoTextures: SdRenderableModelInfoTextures;
    heightMapTextureData: Int16Array;
    drawRanges: SdRenderableDrawRanges;
    locsAnimated: LocAnimatedData[];
    npcs: NpcData[];
    usedTextureIds: Int32Array;
    loadedTextures: ReadonlyArray<readonly [number, Int32Array]>;
}>;

export type MapRenderDataPayloadResult = Readonly<{
    data: MapRenderDataPayload | undefined;
    scenePackInput?: MapRenderScenePackInput;
}>;

const DRAW_BUCKET_KEYS = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
] as const;

function modelInfoLengthFromCount(cmdCount: number, totalInstances: number): number {
    const dataLength = Math.ceil((cmdCount * 4 + totalInstances) / 16) * 16;
    return Math.max(dataLength, 16) * 4;
}

function modelInfoLengthFromDrawRanges(drawRanges: readonly DrawRange[]): number {
    let totalInstances = 0;
    for (let i = 0; i < drawRanges.length; i++) {
        totalInstances += drawRanges[i][2] | 0;
    }
    return modelInfoLengthFromCount(drawRanges.length, totalInstances);
}

export function validateMapRenderPayload(data: MapRenderDataPayload): string[] {
    const issues: string[] = [];

    const levelsFromFlags = data.tileRenderFlags.length | 0;
    const sizeXFromFlags = data.tileRenderFlags[0]?.length ?? 0;
    const sizeYFromFlags = data.tileRenderFlags[0]?.[0]?.length ?? 0;
    const expectedHeightMapLengthFromFlags = levelsFromFlags * sizeXFromFlags * sizeYFromFlags;
    if (data.heightMapTextureData.length !== expectedHeightMapLengthFromFlags) {
        issues.push(
            `heightMapTextureData length mismatch expected=${expectedHeightMapLengthFromFlags} got=${data.heightMapTextureData.length}`,
        );
    }

    for (const key of DRAW_BUCKET_KEYS) {
        const drawRanges = data.drawRanges[key];
        const modelInfoTexture = data.modelInfoTextures[key];
        const expectedModelInfoLength = modelInfoLengthFromDrawRanges(drawRanges);
        if (modelInfoTexture.length !== expectedModelInfoLength) {
            issues.push(
                `modelInfoTextures.${key} length mismatch expected=${expectedModelInfoLength} got=${modelInfoTexture.length}`,
            );
        }
    }

    return issues;
}

function drawRangesToMutable(drawRanges: readonly DrawRange[]): DrawRange[] {
    return drawRanges.map((r) => [r[0], r[1], r[2]]);
}

function toMutableDrawRanges(drawRanges: SdRenderableDrawRanges): SdRenderableDrawRanges {
    return {
        base: drawRangesToMutable(drawRanges.base),
        alpha: drawRangesToMutable(drawRanges.alpha),
        lod: drawRangesToMutable(drawRanges.lod),
        lodAlpha: drawRangesToMutable(drawRanges.lodAlpha),
        interact: drawRangesToMutable(drawRanges.interact),
        interactAlpha: drawRangesToMutable(drawRanges.interactAlpha),
        interactLod: drawRangesToMutable(drawRanges.interactLod),
        interactLodAlpha: drawRangesToMutable(drawRanges.interactLodAlpha),
    };
}

export function sdMapDataToPayload(data: SdMapData): MapRenderDataPayload {
    return {
        mapX: data.mapX,
        mapY: data.mapY,
        cacheName: data.cacheName,
        maxLevel: data.maxLevel,
        loadObjs: data.loadObjs,
        loadNpcs: data.loadNpcs,
        loadLocs: data.loadLocs,
        smoothTerrain: data.smoothTerrain,
        borderSize: data.borderSize,
        tileRenderFlags: data.tileRenderFlags,
        collisionDatas: data.collisionDatas,
        minimapBlob: data.minimapBlob,
        vertices: data.vertices,
        indices: data.indices,
        modelInfoTextures: data.modelInfoTextures,
        heightMapTextureData: data.heightMapTextureData,
        drawRanges: data.drawRanges,
        locsAnimated: data.locsAnimated,
        npcs: data.npcs,
        usedTextureIds: data.usedTextureIds,
        loadedTextures: Array.from(data.loadedTextures.entries()),
    };
}

export function payloadToSdMapData(data: MapRenderDataPayload): SdMapData {
    return new SdMapData(
        data.mapX,
        data.mapY,
        data.cacheName,
        data.maxLevel,
        data.loadObjs,
        data.loadNpcs,
        data.loadLocs,
        data.smoothTerrain,
        data.borderSize,
        data.tileRenderFlags,
        data.collisionDatas,
        data.minimapBlob,
        data.vertices,
        data.indices,
        data.modelInfoTextures,
        data.heightMapTextureData,
        toMutableDrawRanges(data.drawRanges),
        data.locsAnimated,
        data.npcs,
        data.usedTextureIds,
        new Map<number, Int32Array>(data.loadedTextures),
    );
}

export function payloadTransferables(data: MapRenderDataPayload): Transferable[] {
    return [
        ...data.tileRenderFlags.flat().map((buf) => buf.buffer as Transferable),
        ...data.collisionDatas.map((collision) => collision.flags.buffer as Transferable),
        ...data.loadedTextures.map(([, pixels]) => pixels.buffer as Transferable),
        data.vertices.buffer as Transferable,
        data.indices.buffer as Transferable,
        data.heightMapTextureData.buffer as Transferable,
        data.usedTextureIds.buffer as Transferable,
        data.modelInfoTextures.base.buffer as Transferable,
        data.modelInfoTextures.alpha.buffer as Transferable,
        data.modelInfoTextures.lod.buffer as Transferable,
        data.modelInfoTextures.lodAlpha.buffer as Transferable,
        data.modelInfoTextures.interact.buffer as Transferable,
        data.modelInfoTextures.interactAlpha.buffer as Transferable,
        data.modelInfoTextures.interactLod.buffer as Transferable,
        data.modelInfoTextures.interactLodAlpha.buffer as Transferable,
    ];
}

export function payloadResultToRenderDataResult(
    result: MapRenderDataPayloadResult,
): RenderDataResult<SdMapData | undefined> {
    if (!result.data) {
        return {
            data: undefined,
            transferables: [],
        };
    }
    return {
        data: payloadToSdMapData(result.data),
        transferables: payloadTransferables(result.data),
    };
}
