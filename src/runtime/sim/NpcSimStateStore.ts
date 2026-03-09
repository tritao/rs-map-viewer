import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { type CollisionData, CollisionMap } from "../../rs/scene/CollisionMap";
import {
    LOC_ANIMATION_PAUSE_STATE_STRIDE,
    LOC_ANIMATION_RESET_STRIDE,
    LOC_ANIMATION_SNAPSHOT_STRIDE,
    NPC_STATE_DELTA_DESPAWN_STRIDE,
    NPC_STATE_DELTA_SPAWN_STRIDE,
    NPC_STATE_DELTA_UPDATE_STRIDE,
    type WorldDeltaPacket,
    decodeNpcWorldStateUpdate,
    validateWorldDeltaPacket,
} from "../../world/WorldDeltaPacket";
import type { NpcTypeAnimationEntry } from "../NpcTypeAnimationTable";
import { LocAnimated } from "./LocAnimated";
import type { LocAnimatedData } from "../LocAnimatedData";
import { Npc } from "../entities/Npc";
import type { NpcEvent, NpcSpawnEvent, NpcUpdateEvent } from "../entities/NpcEvents";
import type { NpcUpdateDelta } from "../entities/NpcUpdateDelta";
import { applyNpcUpdateDelta, applyNpcUpdateDeltas } from "./NpcSimMovement";

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
    locsAnimated: ReadonlyArray<LocAnimatedData>;
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
    private readonly pendingNpcSnapshotMapIds = new Set<number>();
    private readonly pendingLocSnapshotMapIds = new Set<number>();

    private createCollisionMaps(collisionDatas: ReadonlyArray<CollisionData>): CollisionMap[] {
        return collisionDatas.map(CollisionMap.fromData);
    }

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

    private createLocTickPatchBuffers(
        locCount: number,
        tickPatchEntryStride: number,
    ): Int32Array[] {
        const out: Int32Array[] = [];
        for (let i = 0; i < 8; i++) {
            out.push(new Int32Array((locCount | 0) * (tickPatchEntryStride | 0)));
        }
        return out;
    }

    private createNpcTickPatchBuffers(
        npcCount: number,
        tickPatchEntryStride: number,
    ): Int32Array[] {
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
            collisionMaps: this.createCollisionMaps(input.collisionDatas),
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
        state.collisionMaps = this.createCollisionMaps(input.collisionDatas);
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

    private createNpcFromSpawnData(
        npcInstanceId: number,
        npcTypeId: number,
        tileX: number,
        tileY: number,
        level: number,
        orderKey: number | undefined,
        state: NpcSimMapState,
        deps: NpcSimStateStoreDeps,
    ): Npc | undefined {
        const typeId = npcTypeId | 0;
        const npcTypeResult = deps.npcTypeLoader.tryLoad(typeId);
        if (!npcTypeResult.ok) {
            return undefined;
        }
        const npcType = npcTypeResult.value;
        const idleSeqId = npcType.getIdleSeqId(deps.basTypeLoader);
        const walkSeqId = npcType.getWalkSeqId(deps.basTypeLoader);
        const anim = state.npcTypeAnimationByNpcTypeId.get(typeId);
        const instanceId = npcInstanceId | 0;
        const order = orderKey ?? this.allocateSyntheticOrderKey(state);
        return new Npc(
            tileX | 0,
            tileY | 0,
            level | 0,
            anim?.idleAnim,
            anim?.walkAnim,
            npcType,
            idleSeqId | 0,
            walkSeqId | 0,
            instanceId,
            order,
        );
    }

    private createNpcFromSpawnEvent(
        event: NpcSpawnEvent,
        state: NpcSimMapState,
        deps: NpcSimStateStoreDeps,
    ): Npc | undefined {
        return this.createNpcFromSpawnData(
            event.npcInstanceId | 0,
            event.npcTypeId | 0,
            event.tileX | 0,
            event.tileY | 0,
            event.level | 0,
            event.orderKey,
            state,
            deps,
        );
    }

    private removeNpcByEventTarget(state: NpcSimMapState, npcInstanceId: number): void {
        const index = state.npcIndexByInstanceId.get(npcInstanceId | 0);
        if (index !== undefined) {
            state.npcs.splice(index | 0, 1);
        }
    }

    private shouldApplySeq(state: NpcSimMapState, npcInstanceId: number, seq: number): boolean {
        const instanceId = npcInstanceId | 0;
        const nextSeq = seq | 0;
        const prevSeq = state.lastSeqByInstanceId.get(instanceId);
        if (prevSeq !== undefined && nextSeq <= (prevSeq | 0)) {
            return false;
        }
        state.lastSeqByInstanceId.set(instanceId, nextSeq);
        return true;
    }

    private upsertSpawnedNpc(state: NpcSimMapState, npc: Npc, npcInstanceId: number): void {
        state.lastSeqByInstanceId.delete(npcInstanceId | 0);
        const instanceId = npc.instanceId;
        if (instanceId !== undefined) {
            const existingIndex = state.npcIndexByInstanceId.get(instanceId | 0);
            if (existingIndex !== undefined) {
                state.npcs[existingIndex | 0] = npc;
                state.seededNpcFlags = false;
                return;
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
    }

    private refreshNpcTickPatchScratch(
        state: NpcSimMapState,
        npcCountBefore: number,
        deps: NpcSimStateStoreDeps,
    ): void {
        const npcCount = state.npcs.length | 0;
        if (npcCount === (npcCountBefore | 0)) {
            return;
        }
        state.npcTickPatchesByVariant = this.createNpcTickPatchBuffers(
            npcCount,
            deps.tickPatchEntryStride,
        );
        state.npcTickPatchCountsByVariant = new Int32Array(2);
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
                this.upsertSpawnedNpc(state, npc, event.npcInstanceId | 0);
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
        const applied = applyNpcUpdateDeltas(state.npcs, deltas, state.npcIndexByInstanceId);
        if (replaceSnapshot) {
            state.npcTickPatchesByVariant = this.createNpcTickPatchBuffers(
                state.npcs.length | 0,
                deps.tickPatchEntryStride,
            );
            state.npcTickPatchCountsByVariant = new Int32Array(2);
        } else {
            this.refreshNpcTickPatchScratch(state, npcCountBefore, deps);
        }
        return applied | 0;
    }

    applyWorldDeltaPacket(packet: WorldDeltaPacket, deps: NpcSimStateStoreDeps): number {
        const counts = validateWorldDeltaPacket(packet);
        if ((counts.changeCount | 0) <= 0) {
            return 0;
        }
        const npcState = packet.npc?.state;
        if (!npcState) {
            return 0;
        }

        const mapNpcCountsBefore = new Map<number, number>();
        const changedMaps = new Set<number>();
        const trackMapNpcCountBefore = (mapId: number, state: NpcSimMapState): void => {
            const id = mapId | 0;
            if (!mapNpcCountsBefore.has(id)) {
                mapNpcCountsBefore.set(id, state.npcs.length | 0);
            }
        };

        const mapsWithSpawnState = new Set<number>();
        const spawnStatePacked = npcState.spawnStatePacked;
        let applied = 0;
        for (let i = 0; i < (counts.spawnCount | 0); i++) {
            const off = (i | 0) * NPC_STATE_DELTA_SPAWN_STRIDE;
            const mapId = spawnStatePacked[off + 0] | 0;
            const state = this.maps.get(mapId);
            if (!state) {
                continue;
            }
            const npcTypeId = spawnStatePacked[off + 2] | 0;
            const typeResult = deps.npcTypeLoader.tryLoad(npcTypeId);
            if (!typeResult.ok) {
                continue;
            }
            const hasOrderKey = (spawnStatePacked[off + 6] | 0) !== 0;
            const npc = this.createNpcFromSpawnData(
                spawnStatePacked[off + 1] | 0,
                npcTypeId,
                spawnStatePacked[off + 3] | 0,
                spawnStatePacked[off + 4] | 0,
                spawnStatePacked[off + 5] | 0,
                hasOrderKey ? spawnStatePacked[off + 7] | 0 : undefined,
                state,
                deps,
            );
            if (!npc) {
                continue;
            }
            trackMapNpcCountBefore(mapId, state);
            this.upsertSpawnedNpc(state, npc, spawnStatePacked[off + 1] | 0);
            changedMaps.add(mapId);
            mapsWithSpawnState.add(mapId);
            applied = (applied + 1) | 0;
        }

        const despawnStatePacked = npcState.despawnStatePacked;
        for (let i = 0; i < (counts.despawnCount | 0); i++) {
            const off = (i | 0) * NPC_STATE_DELTA_DESPAWN_STRIDE;
            const mapId = despawnStatePacked[off + 0] | 0;
            const state = this.maps.get(mapId);
            if (!state) {
                continue;
            }
            const npcInstanceId = despawnStatePacked[off + 1] | 0;
            const seq = despawnStatePacked[off + 2] | 0;
            if (!this.shouldApplySeq(state, npcInstanceId, seq)) {
                continue;
            }
            trackMapNpcCountBefore(mapId, state);
            this.removeNpcByEventTarget(state, npcInstanceId);
            state.seededNpcFlags = false;
            changedMaps.add(mapId);
            applied = (applied + 1) | 0;
        }

        for (const mapId of changedMaps) {
            const state = this.maps.get(mapId | 0);
            if (!state) {
                continue;
            }
            this.rebuildNpcIndexMap(state);
            const npcCountBefore = mapNpcCountsBefore.get(mapId | 0);
            if (npcCountBefore !== undefined) {
                this.refreshNpcTickPatchScratch(state, npcCountBefore | 0, deps);
            }
        }

        const updateStatePacked = npcState.updateStatePacked;
        for (let i = 0; i < (counts.updateCount | 0); i++) {
            const off = (i | 0) * NPC_STATE_DELTA_UPDATE_STRIDE;
            const mapId = updateStatePacked[off + 0] | 0;
            const state = this.maps.get(mapId);
            if (!state) {
                continue;
            }
            if ((state.npcs.length | 0) <= 0 && !mapsWithSpawnState.has(mapId)) {
                this.pendingNpcSnapshotMapIds.add(mapId);
                continue;
            }
            const npcInstanceId = updateStatePacked[off + 1] | 0;
            const seq = updateStatePacked[off + 2] | 0;
            if (!this.shouldApplySeq(state, npcInstanceId, seq)) {
                continue;
            }
            const npcIndex = state.npcIndexByInstanceId.get(npcInstanceId);
            if (npcIndex === undefined) {
                continue;
            }
            const npc = state.npcs[npcIndex | 0];
            if (!npc) {
                continue;
            }
            const flags = updateStatePacked[off + 3] | 0;
            const delta: NpcUpdateDelta = decodeNpcWorldStateUpdate(
                flags,
                updateStatePacked,
                off,
            );
            applyNpcUpdateDelta(npc, delta);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    consumePendingNpcSnapshotMapIdsPacked(): Int32Array | undefined {
        if ((this.pendingNpcSnapshotMapIds.size | 0) <= 0) {
            return undefined;
        }
        const packed = new Int32Array(this.pendingNpcSnapshotMapIds.size | 0);
        let write = 0;
        for (const mapId of this.pendingNpcSnapshotMapIds.values()) {
            packed[write++] = mapId | 0;
        }
        this.pendingNpcSnapshotMapIds.clear();
        return packed;
    }

    consumePendingLocSnapshotMapIdsPacked(): Int32Array | undefined {
        if ((this.pendingLocSnapshotMapIds.size | 0) <= 0) {
            return undefined;
        }
        const packed = new Int32Array(this.pendingLocSnapshotMapIds.size | 0);
        let write = 0;
        for (const mapId of this.pendingLocSnapshotMapIds.values()) {
            packed[write++] = mapId | 0;
        }
        this.pendingLocSnapshotMapIds.clear();
        return packed;
    }

    applyLocAnimationResets(packet: WorldDeltaPacket, cycleNow: number): number {
        const animationResetPacked = packet.loc?.animation?.animationResetPacked;
        if (!(animationResetPacked instanceof Int32Array) || (animationResetPacked.length | 0) <= 0) {
            return 0;
        }
        let applied = 0;
        let missingMaps = 0;
        let missingLocs = 0;
        const safeCycleNow = cycleNow | 0;
        for (
            let offset = 0;
            offset + LOC_ANIMATION_RESET_STRIDE <= (animationResetPacked.length | 0);
            offset += LOC_ANIMATION_RESET_STRIDE
        ) {
            const mapId = animationResetPacked[offset + 0] | 0;
            const locIndex = animationResetPacked[offset + 1] | 0;
            const state = this.maps.get(mapId);
            if (!state) {
                missingMaps = (missingMaps + 1) | 0;
                this.pendingLocSnapshotMapIds.add(mapId);
                continue;
            }
            const loc = state.locsAnimated[locIndex];
            if (!loc) {
                missingLocs = (missingLocs + 1) | 0;
                this.pendingLocSnapshotMapIds.add(mapId);
                continue;
            }
            loc.restart(safeCycleNow);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    applyLocAnimationPauseStates(packet: WorldDeltaPacket): number {
        const animationPauseStatePacked = packet.loc?.animation?.animationPauseStatePacked;
        if (
            !(animationPauseStatePacked instanceof Int32Array) ||
            (animationPauseStatePacked.length | 0) <= 0
        ) {
            return 0;
        }
        let applied = 0;
        for (
            let offset = 0;
            offset + LOC_ANIMATION_PAUSE_STATE_STRIDE <= (animationPauseStatePacked.length | 0);
            offset += LOC_ANIMATION_PAUSE_STATE_STRIDE
        ) {
            const mapId = animationPauseStatePacked[offset + 0] | 0;
            const locIndex = animationPauseStatePacked[offset + 1] | 0;
            const paused = (animationPauseStatePacked[offset + 2] | 0) !== 0;
            const state = this.maps.get(mapId);
            const loc = state?.locsAnimated[locIndex];
            if (!loc) {
                this.pendingLocSnapshotMapIds.add(mapId);
                continue;
            }
            loc.setPaused(paused);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    applyLocAnimationSnapshots(packet: WorldDeltaPacket): number {
        const animationSnapshotPacked = packet.loc?.animation?.animationSnapshotPacked;
        if (
            !(animationSnapshotPacked instanceof Int32Array) ||
            (animationSnapshotPacked.length | 0) <= 0
        ) {
            return 0;
        }
        let applied = 0;
        for (
            let offset = 0;
            offset + LOC_ANIMATION_SNAPSHOT_STRIDE <= (animationSnapshotPacked.length | 0);
            offset += LOC_ANIMATION_SNAPSHOT_STRIDE
        ) {
            const mapId = animationSnapshotPacked[offset + 0] | 0;
            const locIndex = animationSnapshotPacked[offset + 1] | 0;
            const frame = animationSnapshotPacked[offset + 2] | 0;
            const cycleStart = animationSnapshotPacked[offset + 3] | 0;
            const paused = (animationSnapshotPacked[offset + 4] | 0) !== 0;
            const state = this.maps.get(mapId);
            const loc = state?.locsAnimated[locIndex];
            if (!loc) {
                this.pendingLocSnapshotMapIds.add(mapId);
                continue;
            }
            loc.setSnapshot(frame, cycleStart, paused);
            applied = (applied + 1) | 0;
        }
        return applied | 0;
    }

    resetForCache(): void {
        this.maps.clear();
        this.pendingNpcSnapshotMapIds.clear();
        this.pendingLocSnapshotMapIds.clear();
    }

    resetForLoaderReset(): void {
        this.maps.clear();
        this.pendingNpcSnapshotMapIds.clear();
        this.pendingLocSnapshotMapIds.clear();
    }

    unregisterMap(mapId: number): void {
        this.maps.delete(mapId | 0);
        this.pendingNpcSnapshotMapIds.delete(mapId | 0);
        this.pendingLocSnapshotMapIds.delete(mapId | 0);
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

    registerMap(input: RegisterNpcSimMapInput, deps: NpcSimStateStoreDeps): void {
        const mapId = input.mapId | 0;
        const state = this.maps.get(mapId) ?? this.createMapState(input, deps);
        this.setMapLocContext(state, input, deps);
        this.maps.set(mapId, state);
    }
}
