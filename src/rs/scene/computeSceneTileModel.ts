import { FloorTypeLoader, OverlayFloorTypeLoader } from "../config/floortype/FloorTypeLoader";
import { TextureLoader } from "../texture/TextureLoader";
import { HSL_RGB_MAP, adjustOverlayLight, adjustUnderlayLight, packHsl } from "../util/ColorUtil";
import type { TileRotation, TileShapeId } from "./Scene";
import { OverlayCornerSet, OverlayEdgeSet, SceneTileModel } from "./SceneTileModel";

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
    underlayTypeLoader: FloorTypeLoader;
    overlayTypeLoader: OverlayFloorTypeLoader;
    textureLoader: TextureLoader;
    overlayPrimaryCorners?: OverlayCornerSet;
    overlayPrimaryEdges?: OverlayEdgeSet;
};

export type TerrainTileMaterialDecisionParams = {
    underlayId: number;
    overlayId: number;
    underlayTypeLoader: FloorTypeLoader;
    overlayTypeLoader: OverlayFloorTypeLoader;
    textureLoader: TextureLoader;
    overlayPrimaryCorners?: OverlayCornerSet;
};

export type TerrainTileMaterialDecision = {
    underlayTextureId: number;
    underlayTextureSize: number;
    overlayRgb: number;
    hasOverlay: boolean;
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
    underlayTextureId: number;
    underlayTextureSize: number;
};

function createUnderlayOnlyTileModel(params: UnderlayOnlyTileModelParams): SceneTileModel {
    return new SceneTileModel(
        0 as TileShapeId,
        0 as TileRotation,
        params.underlayTextureId,
        params.underlayTextureSize,
        undefined,
        undefined,
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
        params.underlayRgb,
        0,
    );
}

function tryGetFloorTextureInfo(
    type: unknown,
): { textureId: number; textureSize: number } | undefined {
    if (!type || typeof type !== "object") {
        return undefined;
    }
    const maybe = type as { textureId?: unknown; textureSize?: unknown };
    if (typeof maybe.textureId !== "number" || typeof maybe.textureSize !== "number") {
        return undefined;
    }
    return { textureId: maybe.textureId, textureSize: maybe.textureSize };
}

function resolveUnderlayTextureDecision(
    underlayId: number,
    underlayTypeLoader: FloorTypeLoader,
    textureLoader: TextureLoader,
): { underlayTextureId: number; underlayTextureSize: number } {
    let underlayTextureId = -1;
    let underlayTextureSize = 128;
    if (underlayId !== -1) {
        const underlayResult = underlayTypeLoader.tryLoad(underlayId);
        if (underlayResult.ok) {
            const info = tryGetFloorTextureInfo(underlayResult.value);
            if (info && info.textureId !== -1 && textureLoader.isSd(info.textureId)) {
                underlayTextureId = info.textureId;
                underlayTextureSize = info.textureSize || 128;
            }
        }
    }
    return {
        underlayTextureId,
        underlayTextureSize,
    };
}

function computeOverlayRgb(
    overlay: {
        textureId: number;
        primaryRgb: number;
        hue: number;
        saturation: number;
        lightness: number;
        secondaryRgb: number;
        secondaryHue: number;
        secondarySaturation: number;
        secondaryLightness: number;
    },
    textureLoader: TextureLoader,
    overlayPrimaryCorners?: OverlayCornerSet,
): number {
    if (overlayPrimaryCorners) {
        const hsls = overlayPrimaryCorners.minimapHsl;
        let sum = 0;
        let count = 0;
        for (let i = 0; i < 4; i++) {
            const hsl = hsls[i];
            if (hsl !== -2) {
                sum += hsl;
                count++;
            }
        }
        if (count > 0) {
            return HSL_RGB_MAP[adjustOverlayLight(Math.trunc(sum / count), 96)];
        }
        return 0;
    }

    let overlayMinimapHsl: number;
    if (overlay.textureId !== -1 && textureLoader.isSd(overlay.textureId)) {
        overlayMinimapHsl = textureLoader.getAverageHsl(overlay.textureId);
    } else if (overlay.primaryRgb === 0xff00ff) {
        overlayMinimapHsl = -2;
    } else {
        overlayMinimapHsl = packHsl(overlay.hue, overlay.saturation, overlay.lightness);
    }
    if (overlay.secondaryRgb !== -1) {
        overlayMinimapHsl = packHsl(
            overlay.secondaryHue,
            overlay.secondarySaturation,
            overlay.secondaryLightness,
        );
    }
    if (overlayMinimapHsl !== -2) {
        return HSL_RGB_MAP[adjustOverlayLight(overlayMinimapHsl, 96)];
    }
    return 0;
}

export function computeTerrainTileMaterialDecision(
    params: TerrainTileMaterialDecisionParams,
): TerrainTileMaterialDecision {
    const underlayTexture = resolveUnderlayTextureDecision(
        params.underlayId,
        params.underlayTypeLoader,
        params.textureLoader,
    );

    if (params.overlayId === -1) {
        return {
            underlayTextureId: underlayTexture.underlayTextureId,
            underlayTextureSize: underlayTexture.underlayTextureSize,
            overlayRgb: 0,
            hasOverlay: false,
        };
    }

    const overlayResult = params.overlayTypeLoader.tryLoad(params.overlayId);
    if (!overlayResult.ok) {
        return {
            underlayTextureId: underlayTexture.underlayTextureId,
            underlayTextureSize: underlayTexture.underlayTextureSize,
            overlayRgb: 0,
            hasOverlay: false,
        };
    }

    return {
        underlayTextureId: underlayTexture.underlayTextureId,
        underlayTextureSize: underlayTexture.underlayTextureSize,
        overlayRgb: computeOverlayRgb(
            overlayResult.value,
            params.textureLoader,
            params.overlayPrimaryCorners,
        ),
        hasOverlay: true,
    };
}

export function computeSceneTileModelForTile(
    params: ComputeSceneTileModelParams,
): SceneTileModel | undefined {
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

    const materialDecision = computeTerrainTileMaterialDecision({
        underlayId: params.underlayId,
        overlayId: params.overlayId,
        underlayTypeLoader: params.underlayTypeLoader,
        overlayTypeLoader: params.overlayTypeLoader,
        textureLoader: params.textureLoader,
        overlayPrimaryCorners: params.overlayPrimaryCorners,
    });

    if (!materialDecision.hasOverlay) {
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
            underlayTextureId: materialDecision.underlayTextureId,
            underlayTextureSize: materialDecision.underlayTextureSize,
        });
    }

    const shape = (params.tileShape + 1) as TileShapeId;
    const rotation = params.tileRotation as TileRotation;

    return new SceneTileModel(
        shape,
        rotation,
        materialDecision.underlayTextureId,
        materialDecision.underlayTextureSize,
        params.overlayPrimaryCorners,
        params.overlayPrimaryEdges,
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
        underlayRgb,
        materialDecision.overlayRgb,
    );
}
