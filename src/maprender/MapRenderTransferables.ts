import { MAP_RENDER_DRAW_BUCKET_KEYS } from "./MapRenderPayload";
import type { SdMapData } from "./MapRenderPayload";

export function sdMapDataTransferables(data: SdMapData): Transferable[] {
    const loadedTextureBuffers = Array.from(data.loadedTextures.values()).map(
        (pixels) => pixels.buffer as Transferable,
    );
    const transferables: Transferable[] = [
        ...data.tileRenderFlags.flat().map((buf) => buf.buffer as Transferable),
        ...loadedTextureBuffers,
        data.vertices.buffer as Transferable,
        data.indices.buffer as Transferable,
        data.heightMapTextureData.buffer as Transferable,
        data.usedTextureIds.buffer as Transferable,
    ];
    for (const key of MAP_RENDER_DRAW_BUCKET_KEYS) {
        transferables.push(
            data.modelInfoTextures[key].buffer as Transferable,
            data.drawRanges[key].buffer as Transferable,
        );
    }
    if (
        data.npcVertices instanceof Uint8Array &&
        data.npcIndices instanceof Int32Array &&
        data.npcDrawRangesBase instanceof Int32Array
    ) {
        transferables.push(
            data.npcVertices.buffer as Transferable,
            data.npcIndices.buffer as Transferable,
            data.npcDrawRangesBase.buffer as Transferable,
        );
        if (data.npcDrawRangesAlpha) {
            transferables.push(data.npcDrawRangesAlpha.buffer as Transferable);
        }
        if (data.npcOrderKeys) {
            transferables.push(data.npcOrderKeys.buffer as Transferable);
        }
    }
    return transferables;
}

