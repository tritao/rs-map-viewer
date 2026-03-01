import { LocModelType } from "../../rs/config/loctype/LocModelType";
import { LocType } from "../../rs/config/loctype/LocType";
import { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import { VarProvider } from "../../rs/config/vartype/VarProvider";
import { Scene } from "../../rs/scene/Scene";
import { ContourGroundInfo } from "../../rs/scene/model/LocModelLoader";
import { SceneLocEntity } from "../build/SceneLocEntity";
import { isLowDetail } from "./SceneLocs";

export type ResolvedLocRenderPlacement = Readonly<{
    locType: LocType;
    type: LocModelType;
    rotation: number;
    level: number;
    tileX: number;
    tileY: number;
    centerHeight: number;
    contourGroundInfo: ContourGroundInfo;
    lowDetail: boolean;
}>;

function resolveLocType(
    id: number,
    idIsResolved: boolean,
    locTypeLoader: LocTypeLoader,
    varProvider: VarProvider,
): LocType | undefined {
    if (idIsResolved) {
        const locResult = locTypeLoader.tryLoad(id);
        return locResult.ok ? locResult.value : undefined;
    }

    const locResult = locTypeLoader.tryLoad(id);
    if (!locResult.ok) {
        return undefined;
    }
    const locType = locResult.value;
    if (!locType.transforms) {
        return locType;
    }

    const transformed = locType.transform(varProvider, locTypeLoader);
    return transformed ?? undefined;
}

function resolveLocFootprint(
    locType: LocType,
    rotation: number,
): Readonly<{ sizeX: number; sizeY: number }> {
    if (rotation === 1 || rotation === 3) {
        return {
            sizeX: locType.sizeY,
            sizeY: locType.sizeX,
        };
    }
    return {
        sizeX: locType.sizeX,
        sizeY: locType.sizeY,
    };
}

function computeCenterHeight(
    heightMap: Int32Array[],
    tileX: number,
    tileY: number,
    sizeX: number,
    sizeY: number,
): number {
    const startX = (sizeX >> 1) + tileX;
    const endX = ((sizeX + 1) >> 1) + tileX;
    const startY = (sizeY >> 1) + tileY;
    const endY = ((sizeY + 1) >> 1) + tileY;

    return (
        (heightMap[endX][endY] +
            heightMap[startX][endY] +
            heightMap[startX][startY] +
            heightMap[endX][startY]) >>
        2
    );
}

function buildContourGroundInfo(
    locType: LocType,
    scene: Scene,
    level: number,
    tileX: number,
    tileY: number,
    sizeX: number,
    sizeY: number,
    centerHeight: number,
): ContourGroundInfo {
    const heightMap = scene.tileHeights[level];
    let heightMapAbove: Int32Array[] | undefined;
    if (level < scene.levels - 1) {
        heightMapAbove = scene.tileHeights[level + 1];
    }
    return {
        type: locType.contourGroundType,
        param: locType.contourGroundParam,
        heightMap,
        heightMapAbove,
        entityX: (tileX << 7) + (sizeX << 6),
        entityY: centerHeight,
        entityZ: (tileY << 7) + (sizeY << 6),
    };
}

export function resolveLocRenderPlacement(
    scene: Scene,
    sceneLocEntity: SceneLocEntity,
    locTypeLoader: LocTypeLoader,
    varProvider: VarProvider,
    idIsResolved: boolean,
): ResolvedLocRenderPlacement | undefined {
    const entity = sceneLocEntity.entity;
    const locType = resolveLocType(entity.id, idIsResolved, locTypeLoader, varProvider);
    if (!locType) {
        return undefined;
    }

    const footprint = resolveLocFootprint(locType, entity.rotation);
    const level = entity.level;
    const tileX = entity.tileX;
    const tileY = entity.tileY;

    const heightMap = scene.tileHeights[level];
    const centerHeight = computeCenterHeight(
        heightMap,
        tileX,
        tileY,
        footprint.sizeX,
        footprint.sizeY,
    );

    return {
        locType,
        type: entity.type,
        rotation: entity.rotation,
        level,
        tileX,
        tileY,
        centerHeight,
        contourGroundInfo: buildContourGroundInfo(
            locType,
            scene,
            level,
            tileX,
            tileY,
            footprint.sizeX,
            footprint.sizeY,
            centerHeight,
        ),
        lowDetail: isLowDetail(scene, level, tileX, tileY, locType, entity.type),
    };
}

export function createLocAnimatedGroupKey(
    rotation: number,
    type: LocModelType,
    locTypeId: number,
): number {
    return rotation + (type << 3) + (locTypeId << 10);
}
