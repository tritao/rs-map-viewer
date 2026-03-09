import {
    type StaticMapPacket,
} from "../shared/StaticMapPacket";
import type { SceneLocPlacementOverride } from "../rs/scene/buildSceneFromMapBytesProvider";
import type { LocModelType } from "../rs/config/loctype/LocModelType";
import type { NpcEvent } from "../runtime/entities/NpcEvents";
import {
    type WorldMapObjAddition,
    type WorldDynamicMapObjUpdate,
    type WorldLocVisibilityChange,
    type WorldLocAnimationPauseState,
    type WorldLocAnimationReset,
    type WorldMapObjRemoval,
    type WorldMapObjStateReplacement,
} from "./WorldDeltaPacket";

export type WorldNpcInput = Readonly<{
    events?: ReadonlyArray<NpcEvent>;
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

export type WorldLocStateInput = Readonly<{
    visibilityChanges?: ReadonlyArray<WorldLocVisibilityChange>;
    replacements?: ReadonlyArray<WorldLocReplacement>;
    replacementClears?: ReadonlyArray<WorldLocReplacementClear>;
}>;

export type WorldLocInput = Readonly<{
    state?: WorldLocStateInput;
    animation?: WorldLocAnimationInput;
}>;

export type WorldLocReplacement = Readonly<{
    sourceMapId: number;
    placementIndex: number;
    locTypeId: number;
    locModelType: LocModelType;
    rotation: number;
}>;

export type WorldLocReplacementClear = Readonly<{
    sourceMapId: number;
    placementIndex: number;
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
    private readonly locPlacementOverridesByMapId = new Map<
        number,
        Map<number, SceneLocPlacementOverride>
    >();

    constructor(private readonly deps: WorldSessionDeps) {}

    reset(): void {
        this.locPlacementOverridesByMapId.clear();
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
        let applied = this.applyLocPlacementOverrides(input);
        const runtimeInput = this.getRuntimeWorldInput(input);
        if (runtimeInput) {
            applied = (applied + (await this.deps.worldRuntime.applyWorldInput(runtimeInput))) | 0;
        }
        return applied | 0;
    }

    getLocPlacementOverrides(mapId: number): ReadonlyArray<SceneLocPlacementOverride> {
        const overrides = this.locPlacementOverridesByMapId.get(mapId | 0);
        if (!overrides || (overrides.size | 0) <= 0) {
            return [];
        }
        return Array.from(overrides.values());
    }

    private applyLocPlacementOverrides(input: WorldInput): number {
        let applied = 0;
        const replacements = input.loc?.state?.replacements;
        if (replacements && (replacements.length | 0) > 0) {
            for (let index = 0; index < replacements.length; index++) {
                const replacement = replacements[index];
                if (!replacement) {
                    continue;
                }
                const sourceMapId = replacement.sourceMapId | 0;
                let byPlacementIndex = this.locPlacementOverridesByMapId.get(sourceMapId);
                if (!byPlacementIndex) {
                    byPlacementIndex = new Map<number, SceneLocPlacementOverride>();
                    this.locPlacementOverridesByMapId.set(sourceMapId, byPlacementIndex);
                }
                byPlacementIndex.set(replacement.placementIndex | 0, {
                    sourceMapId,
                    placementIndex: replacement.placementIndex | 0,
                    locTypeId: replacement.locTypeId | 0,
                    locModelType: replacement.locModelType,
                    rotation: replacement.rotation | 0,
                });
                applied = (applied + 1) | 0;
            }
        }

        const replacementClears = input.loc?.state?.replacementClears;
        if (replacementClears && (replacementClears.length | 0) > 0) {
            for (let index = 0; index < replacementClears.length; index++) {
                const replacementClear = replacementClears[index];
                if (!replacementClear) {
                    continue;
                }
                const sourceMapId = replacementClear.sourceMapId | 0;
                const byPlacementIndex = this.locPlacementOverridesByMapId.get(sourceMapId);
                if (!byPlacementIndex) {
                    continue;
                }
                if (byPlacementIndex.delete(replacementClear.placementIndex | 0)) {
                    applied = (applied + 1) | 0;
                }
                if ((byPlacementIndex.size | 0) <= 0) {
                    this.locPlacementOverridesByMapId.delete(sourceMapId);
                }
            }
        }
        return applied | 0;
    }

    private getRuntimeWorldInput(input: WorldInput): WorldInput | undefined {
        const locState = input.loc?.state;
        const locStateWithoutReplacements =
            locState &&
            (locState.visibilityChanges !== undefined
                ? {
                      visibilityChanges: locState.visibilityChanges,
                  }
                : undefined);
        const runtimeLocInput =
            locStateWithoutReplacements || input.loc?.animation
                ? {
                      state: locStateWithoutReplacements,
                      animation: input.loc?.animation,
                  }
                : undefined;
        if (!input.npc && !input.obj && !runtimeLocInput) {
            return undefined;
        }
        return {
            npc: input.npc,
            obj: input.obj,
            loc: runtimeLocInput,
        };
    }
}
