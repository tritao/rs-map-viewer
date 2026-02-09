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

export type StagingDrawCommandInstance = Readonly<{
    sceneX: number;
    sceneZ: number;
    heightOffset: number;
    level: number;
    contourGround: number;
    priority: number;
    interactType: number;
    interactId: number;
}>;

export type StagingDrawCommand = Readonly<{
    offset: number;
    elements: number;
    instances: ReadonlyArray<StagingDrawCommandInstance>;
}>;

export type StagingDrawCommandBuckets = Readonly<{
    base: ReadonlyArray<StagingDrawCommand>;
    alpha: ReadonlyArray<StagingDrawCommand>;
    lod: ReadonlyArray<StagingDrawCommand>;
    lodAlpha: ReadonlyArray<StagingDrawCommand>;
    interact: ReadonlyArray<StagingDrawCommand>;
    interactAlpha: ReadonlyArray<StagingDrawCommand>;
    interactLod: ReadonlyArray<StagingDrawCommand>;
    interactLodAlpha: ReadonlyArray<StagingDrawCommand>;
}>;

export type MapRenderDataStaging = Readonly<{
    sceneTileHeights: Int32Array;
    levels: number;
    sizeX: number;
    sizeY: number;
    unitsTileHeightBasis: number;
    drawCommands?: StagingDrawCommandBuckets;
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

function modelInfoLengthFromStagingDrawCommands(
    commands: ReadonlyArray<StagingDrawCommand>,
): number {
    let totalInstances = 0;
    for (let i = 0; i < commands.length; i++) {
        totalInstances += commands[i].instances.length | 0;
    }
    return modelInfoLengthFromCount(commands.length, totalInstances);
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
        const stagingDrawCommands = data.staging?.drawCommands?.[key];
        const drawRanges = data.drawRanges[key];
        const modelInfoTexture = data.modelInfoTextures[key];
        if (stagingDrawCommands) {
            const expectedDrawRangeCount = stagingDrawCommands.length;
            if (drawRanges.length !== expectedDrawRangeCount && drawRanges.length !== 0) {
                issues.push(
                    `drawRanges.${key} length mismatch expected=${expectedDrawRangeCount} got=${drawRanges.length}`,
                );
            }
            const expectedModelInfoLength = modelInfoLengthFromStagingDrawCommands(stagingDrawCommands);
            if (
                modelInfoTexture.length !== expectedModelInfoLength &&
                modelInfoTexture.length !== 0
            ) {
                issues.push(
                    `modelInfoTextures.${key} length mismatch expected=${expectedModelInfoLength} got=${modelInfoTexture.length}`,
                );
            }
            continue;
        }
        const expectedModelInfoLength = modelInfoLengthFromDrawRanges(drawRanges);
        if (modelInfoTexture.length !== expectedModelInfoLength) {
            issues.push(
                `modelInfoTextures.${key} length mismatch expected=${expectedModelInfoLength} got=${modelInfoTexture.length}`,
            );
        }
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
        // drawCommands-aware draw/model-info validation is handled above.
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
