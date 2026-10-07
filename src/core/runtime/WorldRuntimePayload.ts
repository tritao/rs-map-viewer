import type { MapObjState } from "../../maprender/MapObjState";
import type { LocAnimatedData } from "../../runtime/LocAnimatedData";
import type { NpcTypeAnimationEntry } from "../../runtime/NpcTypeAnimationTable";

export type WorldRuntimeRegistration = Readonly<{
    borderSize: number;
    collisionMaskPrimary: Uint8Array[];
    animatedInstances: ReadonlyArray<LocAnimatedData>;
    actorAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>;
}>;

export type WorldRuntimeBootstrap = Readonly<{
    actorOrderKeys: Int32Array;
    dynamicState?: MapObjState;
}>;

export function buildWorldRuntimeRegistration(input: {
    borderSize: number;
    collisionMaskPrimary: Uint8Array[];
    animatedInstances: ReadonlyArray<LocAnimatedData>;
    actorAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
}): WorldRuntimeRegistration {
    return {
        borderSize: input.borderSize | 0,
        collisionMaskPrimary: input.collisionMaskPrimary,
        animatedInstances: input.animatedInstances,
        actorAnimationTable: input.actorAnimationTable ?? [],
    };
}

export function buildWorldRuntimeBootstrap(input: {
    actorOrderKeys?: Int32Array;
    dynamicState?: MapObjState;
}): WorldRuntimeBootstrap {
    return {
        actorOrderKeys: input.actorOrderKeys ?? new Int32Array(0),
        dynamicState: input.dynamicState,
    };
}

export function buildWorldRuntimePayloads(input: {
    borderSize: number;
    collisionMaskPrimary: Uint8Array[];
    animatedInstances: ReadonlyArray<LocAnimatedData>;
    actorAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
    actorOrderKeys?: Int32Array;
    dynamicState?: MapObjState;
}): Readonly<{
    runtimeRegistration: WorldRuntimeRegistration;
    runtimeBootstrap: WorldRuntimeBootstrap;
}> {
    return {
        runtimeRegistration: buildWorldRuntimeRegistration({
            borderSize: input.borderSize,
            collisionMaskPrimary: input.collisionMaskPrimary,
            animatedInstances: input.animatedInstances,
            actorAnimationTable: input.actorAnimationTable,
        }),
        runtimeBootstrap: buildWorldRuntimeBootstrap({
            actorOrderKeys: input.actorOrderKeys,
            dynamicState: input.dynamicState,
        }),
    };
}
