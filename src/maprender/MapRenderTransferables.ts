import { MAP_RENDER_DRAW_BUCKET_KEYS, type SdMapData } from "./MapRenderPayload";

function pushTransferableUnique(
    out: Transferable[],
    seen: Set<Transferable>,
    transferable: Transferable | undefined,
): void {
    if (!transferable || seen.has(transferable)) {
        return;
    }
    seen.add(transferable);
    out.push(transferable);
}

export function collectSdMapDataTransferables(data: SdMapData): Transferable[] {
    const transferables: Transferable[] = [];
    const seen = new Set<Transferable>();
    for (const tileFlags of data.tileRenderFlags.flat()) {
        pushTransferableUnique(transferables, seen, tileFlags.buffer as Transferable);
    }
    for (const pixels of data.loadedTextures.values()) {
        pushTransferableUnique(transferables, seen, pixels.buffer as Transferable);
    }
    pushTransferableUnique(transferables, seen, data.vertices.buffer as Transferable);
    pushTransferableUnique(transferables, seen, data.indices.buffer as Transferable);
    pushTransferableUnique(transferables, seen, data.heightMapTextureData.buffer as Transferable);
    pushTransferableUnique(transferables, seen, data.usedTextureIds.buffer as Transferable);
    for (const key of MAP_RENDER_DRAW_BUCKET_KEYS) {
        pushTransferableUnique(
            transferables,
            seen,
            data.modelInfoTextures[key].buffer as Transferable,
        );
        pushTransferableUnique(transferables, seen, data.drawRanges[key].buffer as Transferable);
    }
    if (
        data.npcVertices instanceof Uint8Array &&
        data.npcIndices instanceof Int32Array &&
        data.npcDrawRangesBase instanceof Int32Array
    ) {
        pushTransferableUnique(transferables, seen, data.npcVertices.buffer as Transferable);
        pushTransferableUnique(transferables, seen, data.npcIndices.buffer as Transferable);
        pushTransferableUnique(transferables, seen, data.npcDrawRangesBase.buffer as Transferable);
        if (data.npcDrawRangesAlpha) {
            pushTransferableUnique(
                transferables,
                seen,
                data.npcDrawRangesAlpha.buffer as Transferable,
            );
        }
    }
    return transferables;
}
