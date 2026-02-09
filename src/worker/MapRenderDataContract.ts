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

export type MapRenderDataStaging = Readonly<{
    sceneTileHeights: Int32Array;
    levels: number;
    sizeX: number;
    sizeY: number;
    unitsTileHeightBasis: number;
    drawRangeCounts: Readonly<{
        base: number;
        alpha: number;
        lod: number;
        lodAlpha: number;
        interact: number;
        interactAlpha: number;
        interactLod: number;
        interactLodAlpha: number;
    }>;
    modelInfoLengths: Readonly<{
        base: number;
        alpha: number;
        lod: number;
        lodAlpha: number;
        interact: number;
        interactAlpha: number;
        interactLod: number;
        interactLodAlpha: number;
    }>;
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
    staging?: MapRenderDataStaging;
}>;

export type MapRenderDataPayloadResult = Readonly<{
    data: MapRenderDataPayload | undefined;
}>;

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

    if (data.staging) {
        const levels = data.staging.levels | 0;
        const sizeX = data.staging.sizeX | 0;
        const sizeY = data.staging.sizeY | 0;
        if (levels !== levelsFromFlags) {
            issues.push(`staging.levels mismatch expected=${levelsFromFlags} got=${levels}`);
        }
        if (sizeX !== sizeXFromFlags) {
            issues.push(`staging.sizeX mismatch expected=${sizeXFromFlags} got=${sizeX}`);
        }
        if (sizeY !== sizeYFromFlags) {
            issues.push(`staging.sizeY mismatch expected=${sizeYFromFlags} got=${sizeY}`);
        }

        const expectedSceneTileHeightsLength = levels * (sizeX + 1) * (sizeY + 1);
        if (data.staging.sceneTileHeights.length !== expectedSceneTileHeightsLength) {
            issues.push(
                `staging.sceneTileHeights length mismatch expected=${expectedSceneTileHeightsLength} got=${data.staging.sceneTileHeights.length}`,
            );
        }

        const drawRangeCounts = data.staging.drawRangeCounts;
        if (data.drawRanges.base.length !== drawRangeCounts.base) {
            issues.push(
                `drawRanges.base length mismatch expected=${drawRangeCounts.base} got=${data.drawRanges.base.length}`,
            );
        }
        if (data.drawRanges.alpha.length !== drawRangeCounts.alpha) {
            issues.push(
                `drawRanges.alpha length mismatch expected=${drawRangeCounts.alpha} got=${data.drawRanges.alpha.length}`,
            );
        }
        if (data.drawRanges.lod.length !== drawRangeCounts.lod) {
            issues.push(
                `drawRanges.lod length mismatch expected=${drawRangeCounts.lod} got=${data.drawRanges.lod.length}`,
            );
        }
        if (data.drawRanges.lodAlpha.length !== drawRangeCounts.lodAlpha) {
            issues.push(
                `drawRanges.lodAlpha length mismatch expected=${drawRangeCounts.lodAlpha} got=${data.drawRanges.lodAlpha.length}`,
            );
        }
        if (data.drawRanges.interact.length !== drawRangeCounts.interact) {
            issues.push(
                `drawRanges.interact length mismatch expected=${drawRangeCounts.interact} got=${data.drawRanges.interact.length}`,
            );
        }
        if (data.drawRanges.interactAlpha.length !== drawRangeCounts.interactAlpha) {
            issues.push(
                `drawRanges.interactAlpha length mismatch expected=${drawRangeCounts.interactAlpha} got=${data.drawRanges.interactAlpha.length}`,
            );
        }
        if (data.drawRanges.interactLod.length !== drawRangeCounts.interactLod) {
            issues.push(
                `drawRanges.interactLod length mismatch expected=${drawRangeCounts.interactLod} got=${data.drawRanges.interactLod.length}`,
            );
        }
        if (data.drawRanges.interactLodAlpha.length !== drawRangeCounts.interactLodAlpha) {
            issues.push(
                `drawRanges.interactLodAlpha length mismatch expected=${drawRangeCounts.interactLodAlpha} got=${data.drawRanges.interactLodAlpha.length}`,
            );
        }

        const modelInfoLengths = data.staging.modelInfoLengths;
        if (data.modelInfoTextures.base.length !== modelInfoLengths.base) {
            issues.push(
                `modelInfoTextures.base length mismatch expected=${modelInfoLengths.base} got=${data.modelInfoTextures.base.length}`,
            );
        }
        if (data.modelInfoTextures.alpha.length !== modelInfoLengths.alpha) {
            issues.push(
                `modelInfoTextures.alpha length mismatch expected=${modelInfoLengths.alpha} got=${data.modelInfoTextures.alpha.length}`,
            );
        }
        if (data.modelInfoTextures.lod.length !== modelInfoLengths.lod) {
            issues.push(
                `modelInfoTextures.lod length mismatch expected=${modelInfoLengths.lod} got=${data.modelInfoTextures.lod.length}`,
            );
        }
        if (data.modelInfoTextures.lodAlpha.length !== modelInfoLengths.lodAlpha) {
            issues.push(
                `modelInfoTextures.lodAlpha length mismatch expected=${modelInfoLengths.lodAlpha} got=${data.modelInfoTextures.lodAlpha.length}`,
            );
        }
        if (data.modelInfoTextures.interact.length !== modelInfoLengths.interact) {
            issues.push(
                `modelInfoTextures.interact length mismatch expected=${modelInfoLengths.interact} got=${data.modelInfoTextures.interact.length}`,
            );
        }
        if (data.modelInfoTextures.interactAlpha.length !== modelInfoLengths.interactAlpha) {
            issues.push(
                `modelInfoTextures.interactAlpha length mismatch expected=${modelInfoLengths.interactAlpha} got=${data.modelInfoTextures.interactAlpha.length}`,
            );
        }
        if (data.modelInfoTextures.interactLod.length !== modelInfoLengths.interactLod) {
            issues.push(
                `modelInfoTextures.interactLod length mismatch expected=${modelInfoLengths.interactLod} got=${data.modelInfoTextures.interactLod.length}`,
            );
        }
        if (data.modelInfoTextures.interactLodAlpha.length !== modelInfoLengths.interactLodAlpha) {
            issues.push(
                `modelInfoTextures.interactLodAlpha length mismatch expected=${modelInfoLengths.interactLodAlpha} got=${data.modelInfoTextures.interactLodAlpha.length}`,
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
