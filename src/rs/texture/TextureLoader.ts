import { TextureMaterial } from "./TextureMaterial";

export interface TextureLoader {
    getTextureIds(): number[];

    getTextureIndex(id: number): number;

    isSmall(id: number): boolean;

    isSd(id: number): boolean;

    isTransparent(id: number): boolean;

    // TODO: move to TextureMaterial
    getAverageHsl(id: number): number;

    // TODO: remove
    getAnimationUv(id: number): [number, number];
    // getMoveU(id: number): number;
    // getMoveV(id: number): number;

    getMaterial(id: number): TextureMaterial;
    tryGetMaterial(id: number): TextureMaterial | undefined;

    getPixelsRgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array;
    getPixelsArgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array;

    tryGetPixelsRgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array | undefined;
    tryGetPixelsArgb(id: number, size: number, flipH: boolean, brightness: number): Int32Array | undefined;
}
