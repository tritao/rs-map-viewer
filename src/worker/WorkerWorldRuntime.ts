import type { StaticMapPacket } from "../shared/StaticMapPacket";
import type {
    WorldMapObjAddition,
    WorldDynamicMapObjUpdate,
    WorldLocAnimationPauseState,
    WorldLocAnimationReset,
    WorldMapObjRemoval,
    WorldMapObjStateReplacement,
} from "../world/WorldDeltaPacket";
import type { NpcEvent } from "../runtime/entities/NpcEvents";
import type {
    WorldRuntime,
    WorldInput,
    WorldMapActivationInput,
    WorldMapDeactivationInput,
} from "../world/WorldSession";

type WorldRenderRuntime = Readonly<{
    activateLoadedMap(packet: StaticMapPacket, mapSimToken: number): Promise<void>;
    deactivateLoadedMap(mapId: number, mapSimToken?: number): Promise<void>;
}>;

type WorldSimRuntime = Readonly<{
    activateLoadedMap(packet: StaticMapPacket, mapSimToken: number): Promise<void>;
    deactivateLoadedMap(mapId: number, mapSimToken?: number): Promise<void>;
    applyNpcLifecycleEvents(events: ReadonlyArray<NpcEvent>): Promise<number>;
    applyMapObjStateReplacements(
        stateReplacements: ReadonlyArray<WorldMapObjStateReplacement>,
    ): Promise<number>;
    applyMapObjAdditions(additions: ReadonlyArray<WorldMapObjAddition>): Promise<number>;
    applyMapObjRemovals(removals: ReadonlyArray<WorldMapObjRemoval>): Promise<number>;
    applyDynamicMapObjSpawns(
        spawns: ReadonlyArray<
            Readonly<{
                mapId: number;
                objTypeId: number;
                count: number;
                x: number;
                y: number;
                plane: number;
            }>
        >,
    ): Promise<number>;
    applyDynamicMapObjDespawns(
        despawns: ReadonlyArray<
            Readonly<{
                mapId: number;
                runtimeObjId: number;
            }>
        >,
    ): Promise<number>;
    applyDynamicMapObjUpdates(
        updates: ReadonlyArray<WorldDynamicMapObjUpdate>,
    ): Promise<number>;
    clearDynamicMapObjs(mapIds: ReadonlyArray<number>): Promise<number>;
    applyLocAnimationResets(resets: ReadonlyArray<WorldLocAnimationReset>): Promise<number>;
    applyLocAnimationPauseStates(
        pauseStates: ReadonlyArray<WorldLocAnimationPauseState>,
    ): Promise<number>;
}>;

type WorkerWorldRuntimeDeps = Readonly<{
    renderRuntime: WorldRenderRuntime;
    simRuntime: WorldSimRuntime;
}>;

export class WorkerWorldRuntime implements WorldRuntime {
    private activationVersion: number = 1;
    private readonly mapRuntimeTokenByMapId = new Map<number, number>();
    private nextMapRuntimeToken: number = 1;

    constructor(private readonly deps: WorkerWorldRuntimeDeps) {}

    reset(): void {
        this.activationVersion = (this.activationVersion + 1) | 0;
        this.mapRuntimeTokenByMapId.clear();
        this.nextMapRuntimeToken = 1;
    }

    captureActivationVersion(): number {
        return this.activationVersion | 0;
    }

    isActivationVersionCurrent(version: number): boolean {
        return (this.activationVersion | 0) === (version | 0);
    }

    async activateLoadedMap(input: WorldMapActivationInput): Promise<boolean> {
        const packet = input.staticMap;
        const mapId = packet.mapData.mapId | 0;
        const mapSimToken = await this.activateLoadedMapRuntime(packet);
        if (
            !this.isActivationVersionCurrent(input.activationVersion) ||
            !this.hasToken(mapId, mapSimToken)
        ) {
            this.deactivateLoadedMap({ mapId });
            return false;
        }
        return true;
    }

    deactivateLoadedMap(input: WorldMapDeactivationInput): void {
        this.deactivateLoadedMapRuntime(input.mapId | 0);
    }

    private hasToken(mapId: number, token: number): boolean {
        return (this.mapRuntimeTokenByMapId.get(mapId | 0) ?? 0) === (token | 0);
    }

    private async activateLoadedMapRuntime(packet: StaticMapPacket): Promise<number> {
        const mapSimToken = this.reserveToken(packet.mapData.mapId | 0);
        const mapId = packet.mapData.mapId | 0;
        await this.deps.renderRuntime.activateLoadedMap(packet, mapSimToken);
        try {
            await this.deps.simRuntime.activateLoadedMap(packet, mapSimToken);
        } catch (error: unknown) {
            void this.deps.renderRuntime.deactivateLoadedMap(mapId, mapSimToken);
            void this.deps.simRuntime.deactivateLoadedMap(mapId, mapSimToken);
            throw error;
        }
        return mapSimToken | 0;
    }

    private deactivateLoadedMapRuntime(mapId: number): void {
        const mapSimToken = this.invalidateToken(mapId | 0);
        void this.deps.simRuntime.deactivateLoadedMap(mapId, mapSimToken);
        void this.deps.renderRuntime.deactivateLoadedMap(mapId, mapSimToken);
    }

    async applyWorldInput(input: WorldInput): Promise<number> {
        let applied = 0;
        applied = (applied + (await this.applyNpcInput(input))) | 0;
        applied = (applied + (await this.applyObjInput(input))) | 0;
        applied = (applied + (await this.applyLocInput(input))) | 0;
        return applied | 0;
    }

    private async applyNpcInput(input: WorldInput): Promise<number> {
        const npcLifecycleEvents = input.npc?.lifecycle?.lifecycleEvents;
        if (!npcLifecycleEvents || (npcLifecycleEvents.length | 0) <= 0) {
            return 0;
        }
        return await this.deps.simRuntime.applyNpcLifecycleEvents(npcLifecycleEvents);
    }

    private async applyObjInput(input: WorldInput): Promise<number> {
        let applied = 0;
        const objStateReplacements = input.obj?.static?.stateReplacements;
        if (objStateReplacements && (objStateReplacements.length | 0) > 0) {
            applied =
                (applied +
                    (await this.deps.simRuntime.applyMapObjStateReplacements(
                        objStateReplacements,
                    ))) |
                0;
        }
        const objAdditions = input.obj?.static?.additions;
        if (objAdditions && (objAdditions.length | 0) > 0) {
            applied =
                (applied + (await this.deps.simRuntime.applyMapObjAdditions(objAdditions))) | 0;
        }
        const objRemovals = input.obj?.static?.removals;
        if (objRemovals && (objRemovals.length | 0) > 0) {
            applied = (applied + (await this.deps.simRuntime.applyMapObjRemovals(objRemovals))) | 0;
        }
        const dynamicSpawns = input.obj?.dynamic?.dynamicSpawns;
        if (dynamicSpawns && (dynamicSpawns.length | 0) > 0) {
            applied =
                (applied + (await this.deps.simRuntime.applyDynamicMapObjSpawns(dynamicSpawns))) |
                0;
        }
        const dynamicDespawns = input.obj?.dynamic?.dynamicDespawns;
        if (dynamicDespawns && (dynamicDespawns.length | 0) > 0) {
            applied =
                (applied +
                    (await this.deps.simRuntime.applyDynamicMapObjDespawns(dynamicDespawns))) |
                0;
        }
        const dynamicUpdates = input.obj?.dynamic?.dynamicUpdates;
        if (dynamicUpdates && (dynamicUpdates.length | 0) > 0) {
            applied =
                (applied + (await this.deps.simRuntime.applyDynamicMapObjUpdates(dynamicUpdates))) |
                0;
        }
        const clearDynamicMaps = input.obj?.dynamic?.clearDynamicMaps;
        if (clearDynamicMaps && (clearDynamicMaps.length | 0) > 0) {
            applied =
                (applied + (await this.deps.simRuntime.clearDynamicMapObjs(clearDynamicMaps))) | 0;
        }
        return applied | 0;
    }

    private async applyLocInput(input: WorldInput): Promise<number> {
        let applied = 0;
        const animationResets = input.loc?.animation?.animationResets;
        if (animationResets && (animationResets.length | 0) > 0) {
            applied =
                (applied +
                    (await this.deps.simRuntime.applyLocAnimationResets(animationResets))) |
                0;
        }
        const animationPauseStates = input.loc?.animation?.animationPauseStates;
        if (animationPauseStates && (animationPauseStates.length | 0) > 0) {
            applied =
                (applied +
                    (await this.deps.simRuntime.applyLocAnimationPauseStates(
                        animationPauseStates,
                    ))) |
                0;
        }
        return applied | 0;
    }

    private reserveToken(mapId: number): number {
        const token = this.nextMapRuntimeToken | 0;
        this.nextMapRuntimeToken = (token + 1) | 0;
        this.mapRuntimeTokenByMapId.set(mapId | 0, token);
        return token | 0;
    }

    private invalidateToken(mapId: number): number {
        return this.reserveToken(mapId | 0);
    }
}
