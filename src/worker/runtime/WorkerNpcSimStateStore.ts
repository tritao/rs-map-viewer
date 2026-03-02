import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { type CollisionData, CollisionMap } from "../../rs/scene/CollisionMap";
import { applyNpcServerDeltas } from "../../runtime/sim/NpcSimMovement";
import type { ApplyNpcLifecycleEventsOptions } from "../../runtime/sim/NpcLifecycleApplyOptions";
import { LocAnimated } from "../../runtime/entities/LocAnimated";
import type { LocAnimatedData } from "../../runtime/entities/LocAnimatedData";
import { Npc } from "../../runtime/entities/Npc";
import type {
    NpcLifecycleEvent,
    NpcSpawnEvent,
    NpcUpdateEvent,
} from "../../runtime/sim/NpcLifecycleEvent";

export type WorkerNpcSimMapState = {
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    collisionMaps: CollisionMap[];
    seededNpcFlags: boolean;
    npcs: Npc[];
    npcIndexByOrderKey: Map<number, number>;
    locsAnimated: LocAnimated[];

    // Tick patch scratch buffers (per-map) to avoid per-frame allocations.
    locTickPatchesByVariant: Int32Array[]; // 8 variants
    locTickPatchCountsByVariant: Int32Array; // length 8
    npcTickPatchesByVariant: Int32Array[]; // 2 variants (base/alpha)
    npcTickPatchCountsByVariant: Int32Array; // length 2
    nextSyntheticOrderKey: number;
};

export type RegisterWorkerNpcSimMapInput = Readonly<{
    mapId: number;
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    collisionDatas: CollisionData[];
    locsAnimated: LocAnimatedData[];
}>;

export type WorkerNpcSimStateStoreDeps = Readonly<{
    npcTypeLoader: NpcTypeLoader;
    basTypeLoader: BasTypeLoader;
    seqTypeLoader: SeqTypeLoader;
    tickPatchEntryStride: number;
}>;

export class WorkerNpcSimStateStore {
    private readonly maps = new Map<number, WorkerNpcSimMapState>();

    private buildLocsAnimated(
        locsAnimatedIn: ReadonlyArray<LocAnimatedData>,
        seqTypeLoader: SeqTypeLoader,
    ): LocAnimated[] {
        const cycleNow = 0;
        const locs: LocAnimated[] = [];
        for (const loc of locsAnimatedIn) {
            const seqResult = seqTypeLoader.tryLoad(loc.seqId);
            if (!seqResult.ok) {
                continue;
            }
            const seqType = seqResult.value;
            locs.push(
                new LocAnimated(
                    loc.drawRangeIndex | 0,
                    loc.drawRangeAlphaIndex | 0,
                    loc.drawRangeLodIndex | 0,
                    loc.drawRangeLodAlphaIndex | 0,
                    loc.drawRangeInteractIndex | 0,
                    loc.drawRangeInteractAlphaIndex | 0,
                    loc.drawRangeInteractLodIndex | 0,
                    loc.drawRangeInteractLodAlphaIndex | 0,
                    loc.anim,
                    seqType,
                    cycleNow,
                    !!loc.randomStart,
                ),
            );
        }
        return locs;
    }

    private createLocTickPatchBuffers(locCount: number, tickPatchEntryStride: number): Int32Array[] {
        const out: Int32Array[] = [];
        for (let i = 0; i < 8; i++) {
            out.push(new Int32Array((locCount | 0) * (tickPatchEntryStride | 0)));
        }
        return out;
    }

    private createNpcTickPatchBuffers(npcCount: number, tickPatchEntryStride: number): Int32Array[] {
        return [
            new Int32Array((npcCount | 0) * (tickPatchEntryStride | 0)),
            new Int32Array((npcCount | 0) * (tickPatchEntryStride | 0)),
        ];
    }

    private createMapState(
        input: RegisterWorkerNpcSimMapInput,
        deps: WorkerNpcSimStateStoreDeps,
    ): WorkerNpcSimMapState {
        const locsAnimated = this.buildLocsAnimated(input.locsAnimated, deps.seqTypeLoader);
        return {
            borderSize: input.borderSize | 0,
            tileRenderFlagsLevel1: input.tileRenderFlagsLevel1,
            collisionMaps: input.collisionDatas.map(CollisionMap.fromData),
            seededNpcFlags: false,
            npcs: [],
            npcIndexByOrderKey: new Map<number, number>(),
            locsAnimated,
            locTickPatchesByVariant: this.createLocTickPatchBuffers(
                locsAnimated.length | 0,
                deps.tickPatchEntryStride,
            ),
            locTickPatchCountsByVariant: new Int32Array(8),
            npcTickPatchesByVariant: this.createNpcTickPatchBuffers(0, deps.tickPatchEntryStride),
            npcTickPatchCountsByVariant: new Int32Array(2),
            nextSyntheticOrderKey: -1,
        };
    }

    private rebuildNpcIndexMap(state: WorkerNpcSimMapState): void {
        state.npcIndexByOrderKey.clear();
        for (let i = 0; i < state.npcs.length; i++) {
            const orderKey = state.npcs[i]!.orderKey;
            if (orderKey !== undefined) {
                state.npcIndexByOrderKey.set(orderKey | 0, i | 0);
            }
        }
    }

    private setMapLocContext(
        state: WorkerNpcSimMapState,
        input: RegisterWorkerNpcSimMapInput,
        deps: WorkerNpcSimStateStoreDeps,
    ): void {
        state.borderSize = input.borderSize | 0;
        state.tileRenderFlagsLevel1 = input.tileRenderFlagsLevel1;
        state.collisionMaps = input.collisionDatas.map(CollisionMap.fromData);
        state.locsAnimated = this.buildLocsAnimated(input.locsAnimated, deps.seqTypeLoader);
        state.locTickPatchesByVariant = this.createLocTickPatchBuffers(
            state.locsAnimated.length | 0,
            deps.tickPatchEntryStride,
        );
        state.locTickPatchCountsByVariant = new Int32Array(8);
        state.seededNpcFlags = false;
    }

    private allocateSyntheticOrderKey(state: WorkerNpcSimMapState): number {
        const key = state.nextSyntheticOrderKey | 0;
        state.nextSyntheticOrderKey = (state.nextSyntheticOrderKey - 1) | 0;
        return key;
    }

    private createNpcFromSpawnEvent(
        event: NpcSpawnEvent,
        state: WorkerNpcSimMapState,
        deps: WorkerNpcSimStateStoreDeps,
    ): Npc | undefined {
        const npcTypeResult = deps.npcTypeLoader.tryLoad(event.npcTypeId | 0);
        if (!npcTypeResult.ok) {
            return undefined;
        }
        const npcType = npcTypeResult.value;
        const idleSeqId = npcType.getIdleSeqId(deps.basTypeLoader);
        const walkSeqId = npcType.getWalkSeqId(deps.basTypeLoader);
        const orderKey = event.orderKey ?? this.allocateSyntheticOrderKey(state);
        return new Npc(
            event.tileX | 0,
            event.tileY | 0,
            event.level | 0,
            event.idleAnim,
            event.walkAnim,
            npcType,
            idleSeqId | 0,
            walkSeqId | 0,
            orderKey,
        );
    }

    private removeNpcByEventTarget(
        state: WorkerNpcSimMapState,
        npcOrderKey: number | undefined,
        npcIndex: number | undefined,
    ): void {
        if (npcOrderKey !== undefined) {
            const index = state.npcIndexByOrderKey.get(npcOrderKey | 0);
            if (index !== undefined) {
                state.npcs.splice(index | 0, 1);
            }
            return;
        }
        if (npcIndex === undefined) {
            return;
        }
        const index = npcIndex | 0;
        if (index >= 0 && index < (state.npcs.length | 0)) {
            state.npcs.splice(index, 1);
        }
    }

    private applyLifecycleEventsToState(
        mapId: number,
        state: WorkerNpcSimMapState,
        events: ReadonlyArray<NpcLifecycleEvent>,
        deps: WorkerNpcSimStateStoreDeps,
        options?: ApplyNpcLifecycleEventsOptions,
    ): number {
        const replaceNpcSnapshot = options?.replaceSnapshot === true;
        const npcCountBefore = state.npcs.length | 0;
        if (replaceNpcSnapshot) {
            state.npcs.length = 0;
            state.npcIndexByOrderKey.clear();
            state.seededNpcFlags = false;
        }

        const deltaEvents: NpcUpdateEvent[] = [];
        for (let i = 0; i < events.length; i++) {
            const event = events[i]!;
            if ((event.mapId | 0) !== (mapId | 0)) {
                continue;
            }
            if (event.kind === "spawn") {
                const npc = this.createNpcFromSpawnEvent(event, state, deps);
                if (!npc) {
                    continue;
                }
                const orderKey = npc.orderKey;
                if (orderKey !== undefined) {
                    const existingIndex = state.npcIndexByOrderKey.get(orderKey | 0);
                    if (existingIndex !== undefined) {
                        state.npcs[existingIndex | 0] = npc;
                    } else {
                        state.npcs.push(npc);
                    }
                } else {
                    state.npcs.push(npc);
                }
                state.seededNpcFlags = false;
                continue;
            }
            if (event.kind === "despawn") {
                this.removeNpcByEventTarget(state, event.npcOrderKey, event.npcIndex);
                state.seededNpcFlags = false;
                continue;
            }
            deltaEvents.push(event);
        }

        this.rebuildNpcIndexMap(state);
        const deltas = deltaEvents.map((entry) => entry.delta);
        const applied = applyNpcServerDeltas(state.npcs, deltas, state.npcIndexByOrderKey);
        const npcCount = state.npcs.length | 0;
        if (replaceNpcSnapshot || npcCount !== npcCountBefore) {
            state.npcTickPatchesByVariant = this.createNpcTickPatchBuffers(
                npcCount,
                deps.tickPatchEntryStride,
            );
            state.npcTickPatchCountsByVariant = new Int32Array(2);
        }
        return applied | 0;
    }

    resetForCache(): void {
        this.maps.clear();
    }

    resetForLoaderReset(): void {
        this.maps.clear();
    }

    unregisterMap(mapId: number): void {
        this.maps.delete(mapId | 0);
    }

    getMap(mapId: number): WorkerNpcSimMapState | undefined {
        return this.maps.get(mapId | 0);
    }

    applyMapNpcLifecycleEvents(
        mapId: number,
        events: ReadonlyArray<NpcLifecycleEvent>,
        deps: WorkerNpcSimStateStoreDeps,
        options?: ApplyNpcLifecycleEventsOptions,
    ): number {
        const state = this.maps.get(mapId | 0);
        if (!state) {
            return 0;
        }
        return this.applyLifecycleEventsToState(mapId | 0, state, events, deps, options);
    }

    registerMap(
        input: RegisterWorkerNpcSimMapInput,
        deps: WorkerNpcSimStateStoreDeps,
    ): void {
        const mapId = input.mapId | 0;
        const state = this.maps.get(mapId) ?? this.createMapState(input, deps);
        this.setMapLocContext(state, input, deps);
        this.maps.set(mapId, state);
    }
}
