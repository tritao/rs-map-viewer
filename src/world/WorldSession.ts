import {
    type StaticMapPacket,
} from "../shared/StaticMapPacket";
import type { NpcEvent } from "../runtime/entities/NpcEvents";
import {
    type WorldMapObjAddition,
    type WorldDynamicMapObjUpdate,
    type WorldLocAnimationPauseState,
    type WorldLocAnimationReset,
    type WorldMapObjRemoval,
    type WorldMapObjStateReplacement,
} from "./WorldDeltaPacket";

export type WorldNpcLifecycleInput = Readonly<{
    lifecycleEvents: ReadonlyArray<NpcEvent>;
}>;

export type WorldNpcInput = Readonly<{
    lifecycle?: WorldNpcLifecycleInput;
}>;

export type WorldObjStaticInput = Readonly<{
    stateReplacements?: ReadonlyArray<WorldMapObjStateReplacement>;
    additions?: ReadonlyArray<WorldMapObjAddition>;
    removals?: ReadonlyArray<WorldMapObjRemoval>;
}>;

export type WorldObjDynamicInput = Readonly<{
    dynamicSpawns?: ReadonlyArray<
        Readonly<{
            mapId: number;
            objTypeId: number;
            count: number;
            x: number;
            y: number;
            plane: number;
        }>
    >;
    dynamicDespawns?: ReadonlyArray<
        Readonly<{
            mapId: number;
            runtimeObjId: number;
        }>
    >;
    dynamicUpdates?: ReadonlyArray<WorldDynamicMapObjUpdate>;
    clearDynamicMaps?: ReadonlyArray<number>;
}>;

export type WorldObjInput = Readonly<{
    static?: WorldObjStaticInput;
    dynamic?: WorldObjDynamicInput;
}>;

export type WorldLocAnimationInput = Readonly<{
    animationResets?: ReadonlyArray<WorldLocAnimationReset>;
    animationPauseStates?: ReadonlyArray<WorldLocAnimationPauseState>;
}>;

export type WorldLocInput = Readonly<{
    animation?: WorldLocAnimationInput;
}>;

export type WorldInput = Readonly<{
    npc?: WorldNpcInput;
    obj?: WorldObjInput;
    loc?: WorldLocInput;
}>;

export type WorldMapActivationInput = Readonly<{
    staticMap: StaticMapPacket;
    activationVersion: number;
}>;

export type WorldMapDeactivationInput = Readonly<{
    mapId: number;
}>;

export type WorldRuntime = Readonly<{
    reset(): void;
    captureActivationVersion(): number;
    isActivationVersionCurrent(version: number): boolean;
    activateLoadedMap(input: WorldMapActivationInput): Promise<boolean>;
    deactivateLoadedMap(input: WorldMapDeactivationInput): void;
    applyWorldInput(input: WorldInput): Promise<number>;
}>;

type WorldSessionDeps = Readonly<{
    worldRuntime: WorldRuntime;
}>;

export class WorldSession {
    constructor(private readonly deps: WorldSessionDeps) {}

    reset(): void {
        this.deps.worldRuntime.reset();
    }

    captureActivationVersion(): number {
        return this.deps.worldRuntime.captureActivationVersion();
    }

    isActivationVersionCurrent(version: number): boolean {
        return this.deps.worldRuntime.isActivationVersionCurrent(version);
    }

    async activateLoadedMap(input: WorldMapActivationInput): Promise<boolean> {
        return await this.deps.worldRuntime.activateLoadedMap(input);
    }

    deactivateLoadedMap(input: WorldMapDeactivationInput): void {
        this.deps.worldRuntime.deactivateLoadedMap(input);
    }

    async applyWorldInput(input: WorldInput): Promise<number> {
        return await this.deps.worldRuntime.applyWorldInput(input);
    }
}
