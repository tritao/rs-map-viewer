import type { ObjRenderData } from "../maprender/MapRenderPayload";
import {
    buildMapObjRenderPacket,
    type MapObjRenderPacket,
    type MapObjRenderUpdate,
} from "./contracts/MapObjRenderPacket";

export function createMapObjBootstrapPacket(
    mapId: number,
    objRenderData: ObjRenderData | undefined,
): MapObjRenderPacket {
    return buildMapObjRenderPacket([
        {
            mapId: mapId | 0,
            objRenderData,
        },
    ]);
}

export function createMapObjClearPacket(mapId: number): MapObjRenderPacket {
    return buildMapObjRenderPacket([
        {
            mapId: mapId | 0,
            objRenderData: undefined,
        },
    ]);
}

export function createMapObjReplacePacket(
    updates: ReadonlyArray<MapObjRenderUpdate>,
): MapObjRenderPacket {
    return buildMapObjRenderPacket(updates);
}
