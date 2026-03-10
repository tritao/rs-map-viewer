import type {
    MapObjStateDrawRanges,
    MapObjStateModelInfoIndices,
    MapObjStateModelInfoTextures,
    ObjRenderData,
} from "./MapRenderData";

export type MapObjRenderState = Readonly<{
    modelInfoTextures: MapObjStateModelInfoTextures;
    modelInfoIndices: MapObjStateModelInfoIndices;
    drawRanges: MapObjStateDrawRanges;
}>;

export type StaticMapObjState = Readonly<{
    vertices: Uint8Array;
    indices: Int32Array;
    renderState: MapObjRenderState;
    usedTextureIds: Int32Array;
    objTypeIds: Int32Array;
}>;

export type MapObjState = Readonly<{
    staticState?: StaticMapObjState;
}>;

export function staticMapObjStateFromRenderData(
    objRenderData: ObjRenderData | undefined,
): StaticMapObjState | undefined {
    if (!objRenderData) {
        return undefined;
    }
    return {
        vertices: objRenderData.vertices,
        indices: objRenderData.indices,
        renderState: {
            modelInfoTextures: objRenderData.modelInfoTextures,
            modelInfoIndices: objRenderData.modelInfoIndices,
            drawRanges: objRenderData.drawRanges,
        },
        usedTextureIds: objRenderData.usedTextureIds,
        objTypeIds: objRenderData.objTypeIds,
    };
}

export function mapObjStateFromRenderData(
    objRenderData: ObjRenderData | undefined,
): MapObjState | undefined {
    const staticState = staticMapObjStateFromRenderData(objRenderData);
    return staticState ? { staticState } : undefined;
}

export function staticMapObjStateToRenderData(
    mapObjState: StaticMapObjState | undefined,
): ObjRenderData | undefined {
    if (!mapObjState) {
        return undefined;
    }
    return {
        vertices: mapObjState.vertices,
        indices: mapObjState.indices,
        modelInfoTextures: mapObjState.renderState.modelInfoTextures,
        modelInfoIndices: mapObjState.renderState.modelInfoIndices,
        drawRanges: mapObjState.renderState.drawRanges,
        usedTextureIds: mapObjState.usedTextureIds,
        objTypeIds: mapObjState.objTypeIds,
    };
}

export function mapObjStateToRenderData(
    mapObjState: MapObjState | undefined,
): ObjRenderData | undefined {
    return staticMapObjStateToRenderData(mapObjState?.staticState);
}
