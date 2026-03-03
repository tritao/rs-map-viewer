import { TextureLoader } from "../../rs/texture/TextureLoader";

// Packed texture indices are stored in vertex data; keep within 11-bit range (0..2046).
export const SD_TEXTURE_PACK_LIMIT = 2047;

export type SdTexturePacking = Readonly<{
    textureIds: ReadonlyArray<number>;
    textureIdIndexMap: ReadonlyMap<number, number>;
}>;

export function createSdTexturePacking(
    textureLoader: TextureLoader,
    limit: number = SD_TEXTURE_PACK_LIMIT,
): SdTexturePacking {
    let textureIds = textureLoader.getTextureIds().filter((id) => textureLoader.isSd(id));
    textureIds = textureIds.slice(0, limit);

    const textureIdIndexMap = new Map<number, number>();
    for (let i = 0; i < textureIds.length; i++) {
        textureIdIndexMap.set(textureIds[i] | 0, i);
    }

    return { textureIds, textureIdIndexMap };
}
