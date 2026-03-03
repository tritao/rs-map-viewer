export const TEXTURE_ID_LUT_WIDTH = 256;
export const TEXTURE_ID_LUT_HEIGHT = 256;
export const TEXTURE_ID_LUT_SIZE = TEXTURE_ID_LUT_WIDTH * TEXTURE_ID_LUT_HEIGHT;

export function textureIdToLutIndex(textureId: number): number | undefined {
    const textureIdPlus1 = ((textureId | 0) + 1) | 0;
    if (textureIdPlus1 <= 0 || textureIdPlus1 >= TEXTURE_ID_LUT_SIZE) {
        return undefined;
    }
    return textureIdPlus1;
}
