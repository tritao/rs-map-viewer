import { OverlayFloorTypeLoader } from "../config/floortype/FloorTypeLoader";
import { TextureLoader } from "../texture/TextureLoader";
import { HSL_RGB_MAP, adjustOverlayLight, adjustUnderlayLight, packHsl } from "../util/ColorUtil";
import type { TileRotation, TileShapeId } from "./Scene";
import { SceneTileModel } from "./SceneTileModel";

export type ComputeSceneTileModelParams = {
    x: number;
    y: number;
    heightSw: number;
    heightSe: number;
    heightNe: number;
    heightNw: number;
    lightSw: number;
    lightSe: number;
    lightNe: number;
    lightNw: number;
    underlayId: number; // -1 means none
    overlayId: number; // -1 means none
    tileShape: number;
    tileRotation: number;
    smoothUnderlays: boolean;
    blendedColors: Int32Array[];
    overlayTypeLoader: OverlayFloorTypeLoader;
    textureLoader: TextureLoader;
};

type UnderlayOnlyTileModelParams = {
    x: number;
    y: number;
    heightSw: number;
    heightSe: number;
    heightNe: number;
    heightNw: number;
    lightSw: number;
    lightSe: number;
    lightNe: number;
    lightNw: number;
    underlayHslSw: number;
    underlayHslSe: number;
    underlayHslNe: number;
    underlayHslNw: number;
    underlayRgb: number;
};

function createUnderlayOnlyTileModel(
    params: UnderlayOnlyTileModelParams,
): SceneTileModel {
    return new SceneTileModel(
        0 as TileShapeId,
        0 as TileRotation,
        -1,
        params.x,
        params.y,
        params.heightSw,
        params.heightSe,
        params.heightNe,
        params.heightNw,
        params.lightSw,
        params.lightSe,
        params.lightNe,
        params.lightNw,
        params.underlayHslSw,
        params.underlayHslSe,
        params.underlayHslNe,
        params.underlayHslNw,
        0,
        0,
        params.underlayRgb,
        0,
    );
}

export function computeSceneTileModelForTile(params: ComputeSceneTileModelParams): SceneTileModel | undefined {
    if (params.underlayId === -1 && params.overlayId === -1) {
        return undefined;
    }

    let underlayHslSw = -1;
    let underlayHslSe = -1;
    let underlayHslNe = -1;
    let underlayHslNw = -1;
    if (params.underlayId !== -1) {
        underlayHslSw = params.blendedColors[params.x][params.y];
        underlayHslSe = params.blendedColors[params.x + 1][params.y];
        underlayHslNe = params.blendedColors[params.x + 1][params.y + 1];
        underlayHslNw = params.blendedColors[params.x][params.y + 1];

        if (underlayHslSe === -1 || !params.smoothUnderlays) {
            underlayHslSe = underlayHslSw;
        }
        if (underlayHslNe === -1 || !params.smoothUnderlays) {
            underlayHslNe = underlayHslSw;
        }
        if (underlayHslNw === -1 || !params.smoothUnderlays) {
            underlayHslNw = underlayHslSw;
        }
    }

    let underlayRgb = 0;
    if (underlayHslSw !== -1) {
        underlayRgb = HSL_RGB_MAP[adjustUnderlayLight(underlayHslSw, 96)];
    }

    if (params.overlayId === -1) {
        return createUnderlayOnlyTileModel({
            x: params.x,
            y: params.y,
            heightSw: params.heightSw,
            heightSe: params.heightSe,
            heightNe: params.heightNe,
            heightNw: params.heightNw,
            lightSw: params.lightSw,
            lightSe: params.lightSe,
            lightNe: params.lightNe,
            lightNw: params.lightNw,
            underlayHslSw,
            underlayHslSe,
            underlayHslNe,
            underlayHslNw,
            underlayRgb,
        });
    }

    const overlayResult = params.overlayTypeLoader.tryLoad(params.overlayId);
    if (!overlayResult.ok) {
        return createUnderlayOnlyTileModel({
            x: params.x,
            y: params.y,
            heightSw: params.heightSw,
            heightSe: params.heightSe,
            heightNe: params.heightNe,
            heightNw: params.heightNw,
            lightSw: params.lightSw,
            lightSe: params.lightSe,
            lightNe: params.lightNe,
            lightNw: params.lightNw,
            underlayHslSw,
            underlayHslSe,
            underlayHslNe,
            underlayHslNw,
            underlayRgb,
        });
    }

    const overlay = overlayResult.value;
    const shape = (params.tileShape + 1) as TileShapeId;
    const rotation = params.tileRotation as TileRotation;

    let overlayHsl: number;
    let overlayMinimapHsl: number;
    if (overlay.textureId !== -1 && params.textureLoader.isSd(overlay.textureId)) {
        overlayMinimapHsl = params.textureLoader.getAverageHsl(overlay.textureId);
        overlayHsl = -1;
    } else if (overlay.primaryRgb === 0xff00ff) {
        overlayHsl = overlayMinimapHsl = -2;
    } else {
        overlayHsl = overlayMinimapHsl = packHsl(overlay.hue, overlay.saturation, overlay.lightness);
    }

    if (overlay.secondaryRgb !== -1) {
        overlayMinimapHsl = packHsl(
            overlay.secondaryHue,
            overlay.secondarySaturation,
            overlay.secondaryLightness,
        );
    }

    let overlayRgb = 0;
    if (overlayMinimapHsl !== -2) {
        overlayRgb = HSL_RGB_MAP[adjustOverlayLight(overlayMinimapHsl, 96)];
    }

    return new SceneTileModel(
        shape,
        rotation,
        overlay.textureId,
        params.x,
        params.y,
        params.heightSw,
        params.heightSe,
        params.heightNe,
        params.heightNw,
        params.lightSw,
        params.lightSe,
        params.lightNe,
        params.lightNw,
        underlayHslSw,
        underlayHslSe,
        underlayHslNe,
        underlayHslNw,
        overlayHsl,
        overlayMinimapHsl,
        underlayRgb,
        overlayRgb,
    );
}
