import type { TextureMaterial } from "../../../rs/texture/TextureMaterial";
import {
    TEXTURE_ID_LUT_HEIGHT,
    TEXTURE_ID_LUT_SIZE,
    TEXTURE_ID_LUT_WIDTH,
    textureIdToLutIndex,
} from "./TextureIdLut";

export type TextureMaterialProvider = Readonly<{
    tryGetMaterial(id: number): TextureMaterial | undefined;
}>;

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

        const textureIdPlus1 = textureIdToLutIndex(id);
        if (textureIdPlus1 === undefined) {
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
