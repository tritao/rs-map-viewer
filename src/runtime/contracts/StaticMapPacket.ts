import {
    type MapRuntimeBootstrap,
    type MapRuntimeRegistration,
    type SdMapData,
} from "../../maprender/MapRenderPayload";
import { getMapSquareId } from "../../rs/map/MapFileIndex";

export type StaticMapPacket = Readonly<{
    mapId: number;
    mapData: SdMapData;
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
}>;

export function buildStaticMapPacket(
    mapData: SdMapData,
    runtimeRegistration: MapRuntimeRegistration,
    runtimeBootstrap: MapRuntimeBootstrap,
): StaticMapPacket {
    return {
        mapId: getMapSquareId(mapData.mapX, mapData.mapY),
        mapData,
        runtimeRegistration,
        runtimeBootstrap,
    };
}

export function getStaticMapRuntimeRegistration(
    packet: StaticMapPacket,
): MapRuntimeRegistration {
    return packet.runtimeRegistration;
}

export function getStaticMapRuntimeBootstrap(packet: StaticMapPacket): MapRuntimeBootstrap {
    return packet.runtimeBootstrap;
}
