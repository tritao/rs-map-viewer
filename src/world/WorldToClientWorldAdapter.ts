import type { MapObjRenderUpdate } from "../renderer/MapObjRenderPacket";
import type { RenderFramePacket } from "../renderer/RenderFramePacket";
import {
    NPC_INTERACTION_META_STRIDE,
    NPC_RANGES_BY_MAP_ID_STRIDE,
} from "../renderer/RenderFramePacket";
import type { StaticMapPacket } from "../shared/StaticMapPacket";
import type {
    ClientActorSnapshot,
    ClientWorldState,
} from "../client/world/ClientWorldState";
import type { WorldMutationInput } from "./WorldSession";
import {
    LOC_ANIMATION_SNAPSHOT_STRIDE,
    LOC_VISIBILITY_STATE_STRIDE,
    NPC_STATE_DELTA_DESPAWN_STRIDE,
    NPC_STATE_DELTA_SPAWN_STRIDE,
    NPC_STATE_DELTA_UPDATE_STRIDE,
    type WorldDeltaPacket,
} from "./WorldDeltaPacket";

type WorldToClientWorldAdapterDeps = Readonly<{
    clientWorldState: ClientWorldState;
}>;

export class WorldToClientWorldAdapter {
    constructor(private readonly deps: WorldToClientWorldAdapterDeps) {}

    reset(): void {
        this.deps.clientWorldState.reset();
    }

    registerLoadedMap(packet: StaticMapPacket): void {
        const mapId = packet.mapData.mapId | 0;
        this.deps.clientWorldState.replaceMapWorldObjects(
            mapId,
            packet.runtimeRegistration.locsAnimated,
        );
        this.deps.clientWorldState.replaceMapStaticGroundItems(
            mapId,
            packet.runtimeBootstrap.mapObjState?.staticState?.objTypeIds,
            true,
        );
    }

    unregisterMap(mapId: number): void {
        this.deps.clientWorldState.unregisterMap(mapId | 0);
    }

    applyMutation(input: WorldMutationInput): void {
        const visibilityChanges = input.loc?.state?.visibilityChanges;
        if (visibilityChanges) {
            for (let index = 0; index < visibilityChanges.length; index++) {
                const change = visibilityChanges[index];
                if (!change) {
                    continue;
                }
                this.deps.clientWorldState.setWorldObjectVisibility(
                    change.mapId | 0,
                    change.locIndex | 0,
                    !!change.visible,
                );
            }
        }

        const stateReplacements = input.obj?.static?.stateReplacements;
        if (stateReplacements) {
            for (let index = 0; index < stateReplacements.length; index++) {
                const update = stateReplacements[index];
                if (!update || update.kind !== "replaceState") {
                    continue;
                }
                const mapObjState = update.mapObjState;
                const staticObjTypeIds =
                    mapObjState && "staticState" in mapObjState
                        ? mapObjState.staticState?.objTypeIds
                        : undefined;
                this.deps.clientWorldState.replaceMapStaticGroundItems(
                    update.mapId | 0,
                    staticObjTypeIds,
                    true,
                );
            }
        }

        const additions = input.obj?.static?.additions;
        if (additions) {
            for (let index = 0; index < additions.length; index++) {
                const addition = additions[index];
                if (!addition) {
                    continue;
                }
                this.deps.clientWorldState.setStaticGroundItemVisibility(
                    addition.mapId | 0,
                    addition.objIndex | 0,
                    true,
                );
            }
        }

        const removals = input.obj?.static?.removals;
        if (removals) {
            for (let index = 0; index < removals.length; index++) {
                const removal = removals[index];
                if (!removal) {
                    continue;
                }
                this.deps.clientWorldState.setStaticGroundItemVisibility(
                    removal.mapId | 0,
                    removal.objIndex | 0,
                    false,
                );
            }
        }

        const dynamicUpdates = input.obj?.dynamic?.dynamicUpdates;
        if (dynamicUpdates) {
            for (let index = 0; index < dynamicUpdates.length; index++) {
                const update = dynamicUpdates[index];
                if (!update) {
                    continue;
                }
                this.deps.clientWorldState.upsertDynamicGroundItem({
                    mapId: update.mapId | 0,
                    runtimeObjId: update.runtimeObjId | 0,
                    objTypeId: update.objTypeId | 0,
                    count: update.count | 0,
                    x: update.x | 0,
                    y: update.y | 0,
                    plane: update.plane | 0,
                });
            }
        }

        const dynamicDespawns = input.obj?.dynamic?.dynamicDespawns;
        if (dynamicDespawns) {
            for (let index = 0; index < dynamicDespawns.length; index++) {
                const despawn = dynamicDespawns[index];
                if (!despawn) {
                    continue;
                }
                this.deps.clientWorldState.removeDynamicGroundItem(
                    despawn.mapId | 0,
                    despawn.runtimeObjId | 0,
                );
            }
        }

        const clearDynamicMaps = input.obj?.dynamic?.clearDynamicMaps;
        if (clearDynamicMaps) {
            for (let index = 0; index < clearDynamicMaps.length; index++) {
                const mapId = clearDynamicMaps[index];
                if (mapId === undefined) {
                    continue;
                }
                this.deps.clientWorldState.clearDynamicGroundItemsForMap(mapId | 0);
            }
        }
    }

    applyWorldDelta(packet: WorldDeltaPacket): void {
        const objStatic = packet.obj?.static;
        const objDynamic = packet.obj?.dynamic;
        const locState = packet.loc?.state;
        const locAnimation = packet.loc?.animation;
        const npcState = packet.npc?.state;

        const stateReplacements = objStatic?.stateReplacements;
        if (stateReplacements) {
            for (let index = 0; index < stateReplacements.length; index++) {
                const update = stateReplacements[index];
                if (!update || update.kind !== "replaceState") {
                    continue;
                }
                const mapObjState = update.mapObjState;
                const staticObjTypeIds =
                    mapObjState && "staticState" in mapObjState
                        ? mapObjState.staticState?.objTypeIds
                        : undefined;
                this.deps.clientWorldState.replaceMapStaticGroundItems(
                    update.mapId | 0,
                    staticObjTypeIds,
                    true,
                );
            }
        }

        const additions = objStatic?.additions;
        if (additions) {
            for (let index = 0; index < additions.length; index++) {
                const addition = additions[index];
                if (!addition) {
                    continue;
                }
                this.deps.clientWorldState.setStaticGroundItemVisibility(
                    addition.mapId | 0,
                    addition.objIndex | 0,
                    true,
                );
            }
        }

        const removals = objStatic?.removals;
        if (removals) {
            for (let index = 0; index < removals.length; index++) {
                const removal = removals[index];
                if (!removal) {
                    continue;
                }
                this.deps.clientWorldState.setStaticGroundItemVisibility(
                    removal.mapId | 0,
                    removal.objIndex | 0,
                    false,
                );
            }
        }

        const dynamicSpawns = objDynamic?.dynamicSpawns;
        if (dynamicSpawns) {
            for (let index = 0; index < dynamicSpawns.length; index++) {
                const spawn = dynamicSpawns[index];
                if (!spawn) {
                    continue;
                }
                this.deps.clientWorldState.upsertDynamicGroundItem({
                    mapId: spawn.mapId | 0,
                    runtimeObjId: spawn.runtimeObjId | 0,
                    objTypeId: spawn.objTypeId | 0,
                    count: spawn.count | 0,
                    x: spawn.x | 0,
                    y: spawn.y | 0,
                    plane: spawn.plane | 0,
                });
            }
        }

        const dynamicUpdates = objDynamic?.dynamicUpdates;
        if (dynamicUpdates) {
            for (let index = 0; index < dynamicUpdates.length; index++) {
                const update = dynamicUpdates[index];
                if (!update) {
                    continue;
                }
                this.deps.clientWorldState.upsertDynamicGroundItem({
                    mapId: update.mapId | 0,
                    runtimeObjId: update.runtimeObjId | 0,
                    objTypeId: update.objTypeId | 0,
                    count: update.count | 0,
                    x: update.x | 0,
                    y: update.y | 0,
                    plane: update.plane | 0,
                });
            }
        }

        const dynamicDespawns = objDynamic?.dynamicDespawns;
        if (dynamicDespawns) {
            for (let index = 0; index < dynamicDespawns.length; index++) {
                const despawn = dynamicDespawns[index];
                if (!despawn) {
                    continue;
                }
                this.deps.clientWorldState.removeDynamicGroundItem(
                    despawn.mapId | 0,
                    despawn.runtimeObjId | 0,
                );
            }
        }

        const clearDynamicMapIds = objDynamic?.clearDynamicMapIds;
        if (clearDynamicMapIds) {
            for (let index = 0; index < clearDynamicMapIds.length; index++) {
                const mapId = clearDynamicMapIds[index];
                if (mapId === undefined) {
                    continue;
                }
                this.deps.clientWorldState.clearDynamicGroundItemsForMap(mapId | 0);
            }
        }

        const visibilityPacked = locState?.visibilityPacked;
        if (visibilityPacked) {
            for (
                let off = 0;
                off + LOC_VISIBILITY_STATE_STRIDE <= visibilityPacked.length;
                off += LOC_VISIBILITY_STATE_STRIDE
            ) {
                this.deps.clientWorldState.setWorldObjectVisibility(
                    visibilityPacked[off] | 0,
                    visibilityPacked[off + 1] | 0,
                    visibilityPacked[off + 2] !== 0,
                );
            }
        }

        const animationSnapshotPacked = locAnimation?.animationSnapshotPacked;
        if (animationSnapshotPacked) {
            for (
                let off = 0;
                off + LOC_ANIMATION_SNAPSHOT_STRIDE <= animationSnapshotPacked.length;
                off += LOC_ANIMATION_SNAPSHOT_STRIDE
            ) {
                this.deps.clientWorldState.setWorldObjectVisibility(
                    animationSnapshotPacked[off] | 0,
                    animationSnapshotPacked[off + 1] | 0,
                    animationSnapshotPacked[off + 5] !== 0,
                );
            }
        }

        if (!npcState) {
            return;
        }

        const spawnPacked = npcState.spawnStatePacked;
        for (
            let off = 0;
            off + NPC_STATE_DELTA_SPAWN_STRIDE <= spawnPacked.length;
            off += NPC_STATE_DELTA_SPAWN_STRIDE
        ) {
            this.deps.clientWorldState.upsertActor({
                mapId: spawnPacked[off] | 0,
                npcInstanceId: spawnPacked[off + 1] | 0,
                npcTypeId: spawnPacked[off + 2] | 0,
            });
        }

        const updatePacked = npcState.updateStatePacked;
        for (
            let off = 0;
            off + NPC_STATE_DELTA_UPDATE_STRIDE <= updatePacked.length;
            off += NPC_STATE_DELTA_UPDATE_STRIDE
        ) {
            const mapId = updatePacked[off] | 0;
            const npcInstanceId = updatePacked[off + 1] | 0;
            const existingActor = this.deps.clientWorldState.getActorEntityByNpcInstanceId(
                mapId,
                npcInstanceId,
            );
            if (!existingActor) {
                continue;
            }
            this.deps.clientWorldState.upsertActor({
                mapId,
                npcInstanceId,
                npcTypeId: existingActor.npcTypeId | 0,
            });
        }

        const despawnPacked = npcState.despawnStatePacked;
        for (
            let off = 0;
            off + NPC_STATE_DELTA_DESPAWN_STRIDE <= despawnPacked.length;
            off += NPC_STATE_DELTA_DESPAWN_STRIDE
        ) {
            this.deps.clientWorldState.removeActor(
                despawnPacked[off] | 0,
                despawnPacked[off + 1] | 0,
            );
        }
    }

    applyFramePacket(packet: RenderFramePacket | undefined): void {
        this.syncVisibleActorInteractions(packet);
        this.applyRuntimeGroundItemInteractionUpdates(packet?.runtimeRenderUpdates?.updates);
    }

    private applyRuntimeGroundItemInteractionUpdates(
        updates: ReadonlyArray<MapObjRenderUpdate> | undefined,
    ): void {
        if (!updates) {
            return;
        }
        for (let index = 0; index < updates.length; index++) {
            const update = updates[index];
            if (!update) {
                continue;
            }
            if (update.clearDynamicObjRenderData) {
                this.deps.clientWorldState.clearDynamicGroundItemInteractionsForMap(
                    update.mapId | 0,
                );
            }

            if (update.removeDynamicRuntimeObjIdsPacked) {
                for (
                    let removeIndex = 0;
                    removeIndex < update.removeDynamicRuntimeObjIdsPacked.length;
                    removeIndex++
                ) {
                    this.deps.clientWorldState.clearDynamicGroundItemInteractId(
                        update.mapId | 0,
                        update.removeDynamicRuntimeObjIdsPacked[removeIndex] | 0,
                    );
                }
            }

            const appendDynamicObjRenders = update.appendDynamicObjRenders;
            if (!appendDynamicObjRenders) {
                continue;
            }
            for (let appendIndex = 0; appendIndex < appendDynamicObjRenders.length; appendIndex++) {
                const append = appendDynamicObjRenders[appendIndex];
                if (!append) {
                    continue;
                }
                const interactId = append.interactId | 0;
                const objTypeId = append.objRenderData.objTypeIds[interactId] | 0;
                this.deps.clientWorldState.setDynamicGroundItemInteractId({
                    mapId: update.mapId | 0,
                    runtimeObjId: append.runtimeObjId | 0,
                    objTypeId,
                    interactId,
                });
            }
        }
    }

    private syncVisibleActorInteractions(packet: RenderFramePacket | undefined): void {
        const knownMapIds = this.deps.clientWorldState.getMapIds();
        if (!packet) {
            for (let index = 0; index < knownMapIds.length; index++) {
                this.deps.clientWorldState.clearVisibleActorInteractions(knownMapIds[index] | 0);
            }
            return;
        }

        const ranges = packet.npcRangesByMapIdPacked;
        const meta = packet.npcInteractionMetaPacked;
        const seenMapIds = new Set<number>();
        for (let off = 0; off < (ranges.length | 0); off += NPC_RANGES_BY_MAP_ID_STRIDE) {
            const mapId = ranges[off] | 0;
            seenMapIds.add(mapId);
            const start = ranges[off + 1] | 0;
            const count = ranges[off + 2] | 0;
            if ((count | 0) <= 0) {
                this.deps.clientWorldState.clearVisibleActorInteractions(mapId);
                continue;
            }

            const actors: ClientActorSnapshot[] = [];
            for (let localIndex = 0; localIndex < count; localIndex++) {
                const interactId = (start + localIndex) | 0;
                const metaOff = interactId * NPC_INTERACTION_META_STRIDE;
                if ((metaOff + NPC_INTERACTION_META_STRIDE) > (meta.length | 0)) {
                    continue;
                }
                actors.push({
                    interactId,
                    npcInstanceId: meta[metaOff] | 0,
                    npcTypeId: meta[metaOff + 1] | 0,
                });
            }
            this.deps.clientWorldState.replaceVisibleActorInteractions(mapId, actors);
        }

        for (let index = 0; index < knownMapIds.length; index++) {
            const mapId = knownMapIds[index] | 0;
            if (!seenMapIds.has(mapId)) {
                this.deps.clientWorldState.clearVisibleActorInteractions(mapId);
            }
        }
    }
}
