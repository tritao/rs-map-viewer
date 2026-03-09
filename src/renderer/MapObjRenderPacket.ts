import {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type ObjRenderData,
} from "../shared/StaticMapPacket";

export type MapObjRenderUpdate = Readonly<{
    mapId: number;
    replaceStaticObjRenderData: boolean;
    staticObjRenderData?: ObjRenderData;
    hiddenStaticObjIndicesPacked?: Int32Array;
    appendDynamicObjRenders?: ReadonlyArray<{
        runtimeObjId: number;
        interactId: number;
        objRenderData: ObjRenderData;
    }>;
    removeDynamicRuntimeObjIdsPacked?: Int32Array;
    clearDynamicObjRenderData: boolean;
}>;

export type MapObjRenderPacket = Readonly<{
    updates: ReadonlyArray<MapObjRenderUpdate>;
}>;

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

export function buildMapObjRenderPacket(
    updates: ReadonlyArray<MapObjRenderUpdate>,
): MapObjRenderPacket {
    return {
        updates,
    };
}

export function mapObjRenderPacketTransferables(packet: MapObjRenderPacket): Transferable[] {
    const out: Transferable[] = [];
    const seen = new Set<Transferable>();
    for (let updateIndex = 0; updateIndex < packet.updates.length; updateIndex++) {
        const update = packet.updates[updateIndex];
        if (!update) {
            continue;
        }
        if (update.hiddenStaticObjIndicesPacked) {
            pushTransferableUnique(
                out,
                seen,
                update.hiddenStaticObjIndicesPacked.buffer as Transferable,
            );
        }
        if (update.removeDynamicRuntimeObjIdsPacked) {
            pushTransferableUnique(
                out,
                seen,
                update.removeDynamicRuntimeObjIdsPacked.buffer as Transferable,
            );
        }
        const renderStates = [update.staticObjRenderData];
        for (let renderStateIndex = 0; renderStateIndex < renderStates.length; renderStateIndex++) {
            const objRenderData = renderStates[renderStateIndex];
            if (!objRenderData) {
                continue;
            }
            pushTransferableUnique(out, seen, objRenderData.vertices.buffer as Transferable);
            pushTransferableUnique(out, seen, objRenderData.indices.buffer as Transferable);
            pushTransferableUnique(out, seen, objRenderData.usedTextureIds.buffer as Transferable);
            pushTransferableUnique(out, seen, objRenderData.objTypeIds.buffer as Transferable);
            for (let bucketIndex = 0; bucketIndex < MAP_RENDER_DRAW_BUCKET_KEYS.length; bucketIndex++) {
                const key = MAP_RENDER_DRAW_BUCKET_KEYS[bucketIndex]!;
                pushTransferableUnique(
                    out,
                    seen,
                    objRenderData.modelInfoTextures[key].buffer as Transferable,
                );
                pushTransferableUnique(
                    out,
                    seen,
                    objRenderData.modelInfoIndices[key].buffer as Transferable,
                );
                pushTransferableUnique(
                    out,
                    seen,
                    objRenderData.drawRanges[key].buffer as Transferable,
                );
            }
        }
        const appendDynamicObjRenders = update.appendDynamicObjRenders;
        if (!appendDynamicObjRenders) {
            continue;
        }
        for (let appendIndex = 0; appendIndex < appendDynamicObjRenders.length; appendIndex++) {
            const append = appendDynamicObjRenders[appendIndex];
            if (!append) {
                continue;
            }
            const objRenderData = append.objRenderData;
            pushTransferableUnique(out, seen, objRenderData.vertices.buffer as Transferable);
            pushTransferableUnique(out, seen, objRenderData.indices.buffer as Transferable);
            pushTransferableUnique(out, seen, objRenderData.usedTextureIds.buffer as Transferable);
            pushTransferableUnique(out, seen, objRenderData.objTypeIds.buffer as Transferable);
            for (let bucketIndex = 0; bucketIndex < MAP_RENDER_DRAW_BUCKET_KEYS.length; bucketIndex++) {
                const key = MAP_RENDER_DRAW_BUCKET_KEYS[bucketIndex]!;
                pushTransferableUnique(
                    out,
                    seen,
                    objRenderData.modelInfoTextures[key].buffer as Transferable,
                );
                pushTransferableUnique(
                    out,
                    seen,
                    objRenderData.modelInfoIndices[key].buffer as Transferable,
                );
                pushTransferableUnique(
                    out,
                    seen,
                    objRenderData.drawRanges[key].buffer as Transferable,
                );
            }
        }
    }
    return out;
}
