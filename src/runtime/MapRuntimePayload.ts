import type { MapObjState } from "../maprender/MapObjState";
import type { SdMapData } from "../maprender/MapRenderData";
import type { LocAnimatedData } from "./LocAnimatedData";
import type { NpcTypeAnimationEntry } from "./NpcTypeAnimationTable";

export type MapRuntimeRegistration = Readonly<{
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>;
}>;

export type MapRuntimeBootstrap = Readonly<{
    npcOrderKeys: Int32Array;
    mapObjState?: MapObjState;
}>;

export function buildMapRuntimeRegistration(input: {
    borderSize: number;
    tileRenderFlags: Uint8Array[][];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
}): MapRuntimeRegistration {
    return {
        borderSize: input.borderSize | 0,
        tileRenderFlagsLevel1: input.tileRenderFlags[1] ?? [],
        locsAnimated: input.locsAnimated,
        npcTypeAnimationTable: input.npcTypeAnimationTable ?? [],
    };
}

export function buildMapRuntimeBootstrap(input: {
    npcOrderKeys?: Int32Array;
    mapObjState?: MapObjState;
}): MapRuntimeBootstrap {
    return {
        npcOrderKeys: input.npcOrderKeys ?? new Int32Array(0),
        mapObjState: input.mapObjState,
    };
}

export function buildMapRuntimePayloads(input: {
    borderSize: number;
    tileRenderFlags: Uint8Array[][];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
    npcOrderKeys?: Int32Array;
    mapObjState?: MapObjState;
}): Readonly<{
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
}> {
    return {
        runtimeRegistration: buildMapRuntimeRegistration({
            borderSize: input.borderSize,
            tileRenderFlags: input.tileRenderFlags,
            locsAnimated: input.locsAnimated,
            npcTypeAnimationTable: input.npcTypeAnimationTable,
        }),
        runtimeBootstrap: buildMapRuntimeBootstrap({
            npcOrderKeys: input.npcOrderKeys,
            mapObjState: input.mapObjState,
        }),
    };
}

export type StaticMapPacket = Readonly<{
    mapData: SdMapData;
    runtimeRegistration: MapRuntimeRegistration;
    runtimeBootstrap: MapRuntimeBootstrap;
}>;

const NPC_DRAW_RANGE_STRIDE = 3;

export function getStaticMapNpcSlotCount(packet: StaticMapPacket): number {
    const mapData = packet.mapData;
    const npcDrawRangeInts = mapData.npcDrawRangesBase?.length ?? 0;
    if (npcDrawRangeInts % NPC_DRAW_RANGE_STRIDE !== 0) {
        throw new Error(
            `[map-render][npc] invalid npcDrawRangesBase length for map ${mapData.mapX},${mapData.mapY}: ` +
                `len=${npcDrawRangeInts} stride=${NPC_DRAW_RANGE_STRIDE}`,
        );
    }
    return (npcDrawRangeInts / NPC_DRAW_RANGE_STRIDE) | 0;
}

export function getValidatedStaticMapNpcOrderKeys(packet: StaticMapPacket): Int32Array {
    const npcOrderKeys = packet.runtimeBootstrap.npcOrderKeys;
    const npcSlotCount = getStaticMapNpcSlotCount(packet);
    if ((npcOrderKeys.length | 0) !== (npcSlotCount | 0)) {
        throw new Error(
            `[map-render][npc] npc slot metadata mismatch for mapId=${packet.mapData.mapId | 0}: ` +
                `orderKeys=${npcOrderKeys.length | 0} slots=${npcSlotCount | 0}`,
        );
    }
    return npcOrderKeys;
}
