import type { TextureMaterial } from "../../../rs/texture/TextureMaterial";

export type TextureMaterialProvider = Readonly<{
    tryGetMaterial(id: number): TextureMaterial | undefined;
}>;

const TEXTURE_ID_LUT_WIDTH = 256;
const TEXTURE_ID_LUT_HEIGHT = 256;
const TEXTURE_ID_LUT_SIZE = TEXTURE_ID_LUT_WIDTH * TEXTURE_ID_LUT_HEIGHT;

export function buildTextureMaterialsTable(
    textureIds: ReadonlyArray<number>,
    provider: TextureMaterialProvider,
): Readonly<{ width: number; height: number; data: Int8Array }> {
    // `textureId` in shaders is 1-based: raw cache texture id + 1 (0 is reserved).
    const data = new Int8Array((TEXTURE_ID_LUT_SIZE * 4) | 0);

    for (let i = 0; i < textureIds.length; i++) {
        const id = textureIds[i] | 0;
        const material = provider.tryGetMaterial(id);
        if (!material) {
            // Keep slot empty; shader treats missing as default.
            continue;
        }

        const textureIdPlus1 = (id + 1) | 0;
        if (textureIdPlus1 <= 0 || textureIdPlus1 >= TEXTURE_ID_LUT_SIZE) {
            continue;
        }
        const index = (textureIdPlus1 * 4) | 0;
        data[index] = material.animU | 0;
        data[index + 1] = material.animV | 0;
        data[index + 2] = ((material.alphaCutOff * 255) | 0) as unknown as number;
        // data[index + 3] left as 0.
    }

    return { width: TEXTURE_ID_LUT_WIDTH, height: TEXTURE_ID_LUT_HEIGHT, data };
}
