import type { TextureMaterial } from "../../../rs/texture/TextureMaterial";

export type TextureMaterialProvider = Readonly<{
    tryGetMaterial(id: number): TextureMaterial | undefined;
}>;

export function buildTextureMaterialsTable(
    textureIds: ReadonlyArray<number>,
    provider: TextureMaterialProvider,
): Readonly<{ width: number; height: number; data: Int8Array }> {
    const textureCount = (textureIds.length | 0) + 1; // slot 0 is reserved ("missing"/default)
    const data = new Int8Array((textureCount * 4) | 0);

    for (let i = 0; i < textureIds.length; i++) {
        const id = textureIds[i] | 0;
        const material = provider.tryGetMaterial(id);
        if (!material) {
            // Keep slot empty; shader treats missing as default.
            continue;
        }

        const index = ((i + 1) * 4) | 0;
        data[index] = material.animU | 0;
        data[index + 1] = material.animV | 0;
        data[index + 2] = ((material.alphaCutOff * 255) | 0) as unknown as number;
        // data[index + 3] left as 0.
    }

    return { width: textureCount, height: 1, data };
}
