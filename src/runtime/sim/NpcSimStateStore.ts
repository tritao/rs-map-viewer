import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { type CollisionData, CollisionMap } from "../../rs/scene/CollisionMap";
import { applyNpcUpdateDeltas } from "./NpcSimMovement";
import type { NpcEvent, NpcSpawnEvent, NpcUpdateEvent } from "./NpcEvents";
import type { NpcTypeAnimationEntry } from "../contracts/NpcTypeAnimationTable";
import { LocAnimated } from "../entities/LocAnimated";
import type { LocAnimatedData } from "../entities/LocAnimatedData";
import { Npc } from "../entities/Npc";

export type NpcSimMapState = {
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    collisionMaps: CollisionMap[];
    seededNpcFlags: boolean;
    npcs: Npc[];
    npcIndexByInstanceId: Map<number, number>;
    npcIndexByOrderKey: Map<number, number>;
    lastSeqByInstanceId: Map<number, number>;
    npcTypeAnimationByNpcTypeId: Map<number, NpcTypeAnimationEntry>;
    locsAnimated: LocAnimated[];

    // Tick patch scratch buffers (per-map) to avoid per-frame allocations.
    locTickPatchesByVariant: Int32Array[]; // 8 variants
    locTickPatchCountsByVariant: Int32Array; // length 8
    npcTickPatchesByVariant: Int32Array[]; // 2 variants (base/alpha)
    npcTickPatchCountsByVariant: Int32Array; // length 2
    nextSyntheticOrderKey: number;
};

export type RegisterNpcSimMapInput = Readonly<{
    mapId: number;
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    collisionDatas: CollisionData[];
    locsAnimated: LocAnimatedData[];
    npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>;
}>;

export type NpcSimStateStoreDeps = Readonly<{
    npcTypeLoader: NpcTypeLoader;
    basTypeLoader: BasTypeLoader;
    seqTypeLoader: SeqTypeLoader;
    tickPatchEntryStride: number;
}>;

export class NpcSimStateStore {
    private readonly maps = new Map<number, NpcSimMapState>();

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
        input: RegisterNpcSimMapInput,
        deps: NpcSimStateStoreDeps,
    ): NpcSimMapState {
        const locsAnimated = this.buildLocsAnimated(input.locsAnimated, deps.seqTypeLoader);
        return {
            borderSize: input.borderSize | 0,
            tileRenderFlagsLevel1: input.tileRenderFlagsLevel1,
            collisionMaps: input.collisionDatas.map(CollisionMap.fromData),
            seededNpcFlags: false,
            npcs: [],
            npcIndexByInstanceId: new Map<number, number>(),
            npcIndexByOrderKey: new Map<number, number>(),
            lastSeqByInstanceId: new Map<number, number>(),
            npcTypeAnimationByNpcTypeId: this.buildNpcTypeAnimationByNpcTypeId(
                input.npcTypeAnimationTable,
            ),
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

    private rebuildNpcIndexMap(state: NpcSimMapState): void {
        state.npcIndexByInstanceId.clear();
        state.npcIndexByOrderKey.clear();
        for (let i = 0; i < state.npcs.length; i++) {
            const instanceId = state.npcs[i]!.instanceId;
            if (instanceId !== undefined) {
                state.npcIndexByInstanceId.set(instanceId | 0, i | 0);
            }
            const orderKey = state.npcs[i]!.orderKey;
            if (orderKey !== undefined) {
                state.npcIndexByOrderKey.set(orderKey | 0, i | 0);
            }
        }
    }

    private setMapLocContext(
        state: NpcSimMapState,
        input: RegisterNpcSimMapInput,
        deps: NpcSimStateStoreDeps,
    ): void {
        state.borderSize = input.borderSize | 0;
        state.tileRenderFlagsLevel1 = input.tileRenderFlagsLevel1;
        state.collisionMaps = input.collisionDatas.map(CollisionMap.fromData);
        state.locsAnimated = this.buildLocsAnimated(input.locsAnimated, deps.seqTypeLoader);
        state.npcTypeAnimationByNpcTypeId = this.buildNpcTypeAnimationByNpcTypeId(
            input.npcTypeAnimationTable,
        );
        state.locTickPatchesByVariant = this.createLocTickPatchBuffers(
            state.locsAnimated.length | 0,
            deps.tickPatchEntryStride,
        );
        state.locTickPatchCountsByVariant = new Int32Array(8);
        state.seededNpcFlags = false;
    }

    private buildNpcTypeAnimationByNpcTypeId(
        entries: ReadonlyArray<NpcTypeAnimationEntry>,
    ): Map<number, NpcTypeAnimationEntry> {
        const out = new Map<number, NpcTypeAnimationEntry>();
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]!;
            const npcTypeId = entry.npcTypeId | 0;
            const existing = out.get(npcTypeId);
            if (!existing) {
                out.set(npcTypeId, entry);
                continue;
            }
            if (!existing.idleAnim && entry.idleAnim) {
                out.set(npcTypeId, {
                    npcTypeId,
                    idleAnim: entry.idleAnim,
                    walkAnim: existing.walkAnim ?? entry.walkAnim,
                });
                continue;
            }
            if (!existing.walkAnim && entry.walkAnim) {
                out.set(npcTypeId, {
                    npcTypeId,
                    idleAnim: existing.idleAnim,
                    walkAnim: entry.walkAnim,
                });
            }
        }
        return out;
    }

    private allocateSyntheticOrderKey(state: NpcSimMapState): number {
        const key = state.nextSyntheticOrderKey | 0;
        state.nextSyntheticOrderKey = (state.nextSyntheticOrderKey - 1) | 0;
        return key;
    }

    private createNpcFromSpawnEvent(
        event: NpcSpawnEvent,
        state: NpcSimMapState,
        deps: NpcSimStateStoreDeps,
    ): Npc | undefined {
        const npcTypeId = event.npcTypeId | 0;
        const npcTypeResult = deps.npcTypeLoader.tryLoad(npcTypeId);
        if (!npcTypeResult.ok) {
            return undefined;
        }
        const npcType = npcTypeResult.value;
        const idleSeqId = npcType.getIdleSeqId(deps.basTypeLoader);
        const walkSeqId = npcType.getWalkSeqId(deps.basTypeLoader);
        const anim = state.npcTypeAnimationByNpcTypeId.get(npcTypeId);
        const instanceId = event.npcInstanceId | 0;
        const orderKey = event.orderKey ?? this.allocateSyntheticOrderKey(state);
        return new Npc(
            event.tileX | 0,
            event.tileY | 0,
            event.level | 0,
            anim?.idleAnim,
            anim?.walkAnim,
            npcType,
            idleSeqId | 0,
            walkSeqId | 0,
            instanceId,
            orderKey,
        );
    }

    private removeNpcByEventTarget(
        state: NpcSimMapState,
        npcInstanceId: number,
    ): void {
        const index = state.npcIndexByInstanceId.get(npcInstanceId | 0);
        if (index !== undefined) {
            state.npcs.splice(index | 0, 1);
        }
    }

    private shouldApplySeq(
        state: NpcSimMapState,
        npcInstanceId: number,
        seq: number,
    ): boolean {
        const instanceId = npcInstanceId | 0;
        const nextSeq = seq | 0;
        const prevSeq = state.lastSeqByInstanceId.get(instanceId);
        if (prevSeq !== undefined && nextSeq <= (prevSeq | 0)) {
            return false;
        }
        state.lastSeqByInstanceId.set(instanceId, nextSeq);
        return true;
    }

    private applyLifecycleEventsToState(
        mapId: number,
        state: NpcSimMapState,
        events: ReadonlyArray<NpcEvent>,
        deps: NpcSimStateStoreDeps,
        replaceSnapshot: boolean,
    ): number {
        const npcCountBefore = state.npcs.length | 0;
        if (replaceSnapshot) {
            state.npcs.length = 0;
            state.npcIndexByInstanceId.clear();
            state.npcIndexByOrderKey.clear();
            state.lastSeqByInstanceId.clear();
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
                state.lastSeqByInstanceId.delete(event.npcInstanceId | 0);
                const instanceId = npc.instanceId;
                if (instanceId !== undefined) {
                    const existingIndex = state.npcIndexByInstanceId.get(instanceId | 0);
                    if (existingIndex !== undefined) {
                        state.npcs[existingIndex | 0] = npc;
                        state.seededNpcFlags = false;
                        continue;
                    }
                }
                const orderKey = npc.orderKey;
                if (orderKey !== undefined) {
                    const existingOrderIndex = state.npcIndexByOrderKey.get(orderKey | 0);
                    if (existingOrderIndex !== undefined) {
                        state.npcs[existingOrderIndex | 0] = npc;
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
                if (!this.shouldApplySeq(state, event.npcInstanceId, event.seq)) {
                    continue;
                }
                this.removeNpcByEventTarget(state, event.npcInstanceId);
                state.seededNpcFlags = false;
                continue;
            }
            if (this.shouldApplySeq(state, event.npcInstanceId, event.seq)) {
                deltaEvents.push(event);
            } else {
                continue;
            }
        }

        this.rebuildNpcIndexMap(state);
        const deltas = deltaEvents.map((entry) => ({
            npcInstanceId: entry.npcInstanceId | 0,
            delta: entry.delta,
        }));
        const applied = applyNpcUpdateDeltas(
            state.npcs,
            deltas,
            state.npcIndexByInstanceId,
        );
        const npcCount = state.npcs.length | 0;
        if (replaceSnapshot || npcCount !== npcCountBefore) {
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

    getMap(mapId: number): NpcSimMapState | undefined {
        return this.maps.get(mapId | 0);
    }

    applyMapNpcLifecycleEvents(
        mapId: number,
        events: ReadonlyArray<NpcEvent>,
        deps: NpcSimStateStoreDeps,
        replaceSnapshot: boolean = false,
    ): number {
        const state = this.maps.get(mapId | 0);
        if (!state) {
            return 0;
        }
        return this.applyLifecycleEventsToState(mapId | 0, state, events, deps, replaceSnapshot);
    }

    registerMap(
        input: RegisterNpcSimMapInput,
        deps: NpcSimStateStoreDeps,
    ): void {
        const mapId = input.mapId | 0;
        const state = this.maps.get(mapId) ?? this.createMapState(input, deps);
        this.setMapLocContext(state, input, deps);
        this.maps.set(mapId, state);
    }
}
