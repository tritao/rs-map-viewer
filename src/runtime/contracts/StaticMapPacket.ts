import { type SdMapData, sdMapDataTransferables } from "../../maprender/MapRenderPayload";
import { getMapSquareId } from "../../rs/map/MapFileIndex";

export type StaticMapPacket = Readonly<{
    mapId: number;
    mapData: SdMapData;
}>;

export function buildStaticMapPacket(mapData: SdMapData): StaticMapPacket {
    return {
        mapId: getMapSquareId(mapData.mapX, mapData.mapY),
        mapData,
    };
}

export function staticMapPacketTransferables(packet: StaticMapPacket): Transferable[] {
    return sdMapDataTransferables(packet.mapData);
}
