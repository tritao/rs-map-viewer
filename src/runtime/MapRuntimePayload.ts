import {
    type WorldRuntimeBootstrap,
    type WorldRuntimeRegistration,
    buildWorldRuntimeBootstrap,
    buildWorldRuntimePayloads,
    buildWorldRuntimeRegistration,
} from "../core/runtime/WorldRuntimePayload";
import type { MapObjState } from "../maprender/MapObjState";
import type { SdMapData } from "../maprender/MapRenderData";
import type { LocAnimatedData } from "./LocAnimatedData";
import type { NpcTypeAnimationEntry } from "./NpcTypeAnimationTable";

export type {
    WorldRuntimeBootstrap,
    WorldRuntimeRegistration,
} from "../core/runtime/WorldRuntimePayload";

export type MapRuntimeRegistration = WorldRuntimeRegistration &
    Readonly<{
        tileRenderFlagsLevel1: Uint8Array[];
        locsAnimated: ReadonlyArray<LocAnimatedData>;
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>;
    }>;

export type MapRuntimeBootstrap = WorldRuntimeBootstrap &
    Readonly<{
        npcOrderKeys: Int32Array;
        mapObjState?: MapObjState;
    }>;

export function buildMapRuntimeRegistration(input: {
    borderSize: number;
    tileRenderFlags: Uint8Array[][];
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
}): MapRuntimeRegistration {
    const runtimeRegistration = buildWorldRuntimeRegistration({
        borderSize: input.borderSize,
        collisionMaskPrimary: input.tileRenderFlags[1] ?? [],
        animatedInstances: input.locsAnimated,
        actorAnimationTable: input.npcTypeAnimationTable,
    });
    return {
        ...runtimeRegistration,
        tileRenderFlagsLevel1: runtimeRegistration.collisionMaskPrimary,
        locsAnimated: runtimeRegistration.animatedInstances,
        npcTypeAnimationTable: runtimeRegistration.actorAnimationTable,
    };
}

export function buildMapRuntimeBootstrap(input: {
    npcOrderKeys?: Int32Array;
    mapObjState?: MapObjState;
}): MapRuntimeBootstrap {
    const runtimeBootstrap = buildWorldRuntimeBootstrap({
        actorOrderKeys: input.npcOrderKeys,
        dynamicState: input.mapObjState,
    });
    return {
        ...runtimeBootstrap,
        npcOrderKeys: runtimeBootstrap.actorOrderKeys,
        mapObjState: runtimeBootstrap.dynamicState,
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
    const worldRuntimePayloads = buildWorldRuntimePayloads({
        borderSize: input.borderSize,
        collisionMaskPrimary: input.tileRenderFlags[1] ?? [],
        animatedInstances: input.locsAnimated,
        actorAnimationTable: input.npcTypeAnimationTable,
        actorOrderKeys: input.npcOrderKeys,
        dynamicState: input.mapObjState,
    });
    return {
        runtimeRegistration: {
            ...worldRuntimePayloads.runtimeRegistration,
            tileRenderFlagsLevel1: worldRuntimePayloads.runtimeRegistration.collisionMaskPrimary,
            locsAnimated: worldRuntimePayloads.runtimeRegistration.animatedInstances,
            npcTypeAnimationTable: worldRuntimePayloads.runtimeRegistration.actorAnimationTable,
        },
        runtimeBootstrap: {
            ...worldRuntimePayloads.runtimeBootstrap,
            npcOrderKeys: worldRuntimePayloads.runtimeBootstrap.actorOrderKeys,
            mapObjState: worldRuntimePayloads.runtimeBootstrap.dynamicState,
        },
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
