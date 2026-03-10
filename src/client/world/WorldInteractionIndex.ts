import type { RenderFramePacket } from "../../renderer/RenderFramePacket";
import {
    NPC_INTERACTION_META_STRIDE,
    NPC_RANGES_BY_MAP_ID_STRIDE,
} from "../../renderer/RenderFramePacket";
import type { LocAnimatedData } from "../../runtime/LocAnimatedData";
import {
    resolveWorldInteractionTargets,
    type InteractionHit,
    type WorldInteractionTarget,
} from "../../runtime/InteractionTargets";
import type { StaticMapPacket } from "../../runtime/MapRuntimePayload";
import type { WorldMutationInput } from "../../world/WorldSession";

type MapObjInteractionState = Readonly<{
    staticObjTypeIds?: Int32Array;
    dynamicObjTypeIds?: Int32Array;
    dynamicRuntimeObjIds?: Int32Array;
}>;

type NpcInteractionState = Readonly<{
    start: number;
    metaPacked: Int32Array;
}>;

type MapInteractionState = {
    animatedLocs?: ReadonlyArray<LocAnimatedData>;
    mapObjInteractionState?: MapObjInteractionState;
    npcInteractionState?: NpcInteractionState;
};

export class WorldInteractionIndex {
    private static readonly EMPTY_INT32 = new Int32Array(0);

    private readonly mapStateByMapId = new Map<number, MapInteractionState>();

    reset(): void {
        this.mapStateByMapId.clear();
    }

    registerLoadedMap(packet: StaticMapPacket): void {
        const mapId = packet.mapData.mapId | 0;
        const mapState = this.getOrCreateMapState(mapId);
        mapState.animatedLocs = packet.runtimeRegistration.locsAnimated;
        this.setMapObjInteractionState(mapId, {
            staticObjTypeIds: packet.runtimeBootstrap.mapObjState?.staticState?.objTypeIds,
            dynamicObjTypeIds: undefined,
            dynamicRuntimeObjIds: undefined,
        });
    }

    unregisterMap(mapId: number): void {
        this.mapStateByMapId.delete(mapId | 0);
    }

    applyMutation(input: WorldMutationInput): void {
        const stateReplacements = input.obj?.static?.stateReplacements;
        if (!stateReplacements) {
            return;
        }
        for (let index = 0; index < stateReplacements.length; index++) {
            const update = stateReplacements[index];
            if (!update || update.kind !== "replaceState") {
                continue;
            }
            const mapObjState = update.mapObjState;
            const current = this.getMapState(update.mapId | 0)?.mapObjInteractionState;
            this.setMapObjInteractionState(update.mapId | 0, {
                staticObjTypeIds:
                    mapObjState && "staticState" in mapObjState
                        ? mapObjState.staticState?.objTypeIds
                        : current?.staticObjTypeIds,
                dynamicObjTypeIds: current?.dynamicObjTypeIds,
                dynamicRuntimeObjIds: current?.dynamicRuntimeObjIds,
            });
        }
    }

    applyFramePacket(packet: RenderFramePacket | undefined): void {
        this.syncNpcInteractionState(packet);
        const objUpdates = packet?.runtimeRenderUpdates?.updates;
        if (!objUpdates) {
            return;
        }
        for (let index = 0; index < objUpdates.length; index++) {
            const update = objUpdates[index];
            if (!update) {
                continue;
            }
            this.applyMapObjInteractionStateUpdate(update.mapId | 0, update);
        }
    }

    getAnimatedLocs(mapId: number): ReadonlyArray<LocAnimatedData> {
        return this.getMapState(mapId | 0)?.animatedLocs ?? [];
    }

    getAnimatedLocTypeId(mapId: number, locIndex: number): number | undefined {
        return this.getMapState(mapId | 0)?.animatedLocs?.[locIndex | 0]?.locTypeId;
    }

    getStaticObjTypeIds(mapId: number): Int32Array | undefined {
        return this.getMapState(mapId | 0)?.mapObjInteractionState?.staticObjTypeIds;
    }

    getMapObjTargetInfo(
        mapId: number,
        interactId: number,
    ):
        | Readonly<
              | {
                    kind: "static";
                    objTypeId: number;
                    objIndex: number;
                }
              | {
                    kind: "dynamic";
                    objTypeId: number;
                    runtimeObjId: number;
                }
          >
        | undefined {
        const mapObjInteractionState = this.getMapState(mapId | 0)?.mapObjInteractionState;
        const staticObjTypeId = mapObjInteractionState?.staticObjTypeIds?.[interactId | 0];
        if (staticObjTypeId !== undefined && (staticObjTypeId | 0) >= 0) {
            return {
                kind: "static",
                objTypeId: staticObjTypeId | 0,
                objIndex: interactId | 0,
            };
        }
        const dynamicObjTypeId = mapObjInteractionState?.dynamicObjTypeIds?.[interactId | 0];
        const runtimeObjId = mapObjInteractionState?.dynamicRuntimeObjIds?.[interactId | 0];
        if (
            dynamicObjTypeId !== undefined &&
            runtimeObjId !== undefined &&
            (dynamicObjTypeId | 0) >= 0 &&
            (runtimeObjId | 0) >= 0
        ) {
            return {
                kind: "dynamic",
                objTypeId: dynamicObjTypeId | 0,
                runtimeObjId: runtimeObjId | 0,
            };
        }
        return undefined;
    }

    getNpcTargetInfo(
        mapId: number,
        interactId: number,
    ): Readonly<{ npcInstanceId: number; npcTypeId: number }> | undefined {
        const npcInteractionState = this.getMapState(mapId | 0)?.npcInteractionState;
        if (!npcInteractionState) {
            return undefined;
        }
        const localIndex = ((interactId | 0) - (npcInteractionState.start | 0)) | 0;
        const metaOff = (localIndex | 0) * NPC_INTERACTION_META_STRIDE;
        if (
            (localIndex | 0) < 0 ||
            (metaOff + NPC_INTERACTION_META_STRIDE) >
                (npcInteractionState.metaPacked.length | 0)
        ) {
            return undefined;
        }
        return {
            npcInstanceId: npcInteractionState.metaPacked[metaOff] | 0,
            npcTypeId: npcInteractionState.metaPacked[metaOff + 1] | 0,
        };
    }

    resolveInteractionTargets(hits: ReadonlyArray<InteractionHit>): WorldInteractionTarget[] {
        return resolveWorldInteractionTargets({
            hits,
            getAnimatedLocTypeId: this.getAnimatedLocTypeId.bind(this),
            getMapObjTargetInfo: this.getMapObjTargetInfo.bind(this),
            getNpcTargetInfo: this.getNpcTargetInfo.bind(this),
        });
    }

    private setMapObjInteractionState(
        mapId: number,
        state: MapObjInteractionState | undefined,
    ): void {
        const normalizedMapId = mapId | 0;
        const mapState = this.getMapState(normalizedMapId);
        if (!state || (!state.staticObjTypeIds && !state.dynamicObjTypeIds)) {
            if (!mapState) {
                return;
            }
            mapState.mapObjInteractionState = undefined;
            this.deleteMapStateIfEmpty(normalizedMapId, mapState);
            return;
        }
        this.getOrCreateMapState(normalizedMapId).mapObjInteractionState = state;
    }

    private ensureInt32Length(values: Int32Array | undefined, minLength: number): Int32Array {
        if ((minLength | 0) <= 0) {
            return values ?? WorldInteractionIndex.EMPTY_INT32;
        }
        if (values instanceof Int32Array && (values.length | 0) >= (minLength | 0)) {
            return values;
        }
        const next = new Int32Array(minLength | 0);
        next.fill(-1);
        if (values instanceof Int32Array) {
            next.set(values.subarray(0, Math.min(values.length | 0, minLength | 0)));
        }
        return next;
    }

    private applyMapObjInteractionStateUpdate(
        mapId: number,
        update: NonNullable<RenderFramePacket["runtimeRenderUpdates"]>["updates"][number],
    ): void {
        const current = this.getMapState(mapId | 0)?.mapObjInteractionState;
        let staticObjTypeIds = update.replaceStaticObjRenderData
            ? update.staticObjRenderData?.objTypeIds
            : current?.staticObjTypeIds;
        let dynamicObjTypeIds = current?.dynamicObjTypeIds;
        let dynamicRuntimeObjIds = current?.dynamicRuntimeObjIds;

        if (update.clearDynamicObjRenderData) {
            dynamicObjTypeIds = undefined;
            dynamicRuntimeObjIds = undefined;
        }
        if (update.removeDynamicRuntimeObjIdsPacked && dynamicRuntimeObjIds && dynamicObjTypeIds) {
            const nextDynamicObjTypeIds = dynamicObjTypeIds.slice();
            const nextDynamicRuntimeObjIds = dynamicRuntimeObjIds.slice();
            for (
                let removeIndex = 0;
                removeIndex < update.removeDynamicRuntimeObjIdsPacked.length;
                removeIndex++
            ) {
                const runtimeObjId = update.removeDynamicRuntimeObjIdsPacked[removeIndex] | 0;
                for (let index = 0; index < nextDynamicRuntimeObjIds.length; index++) {
                    if ((nextDynamicRuntimeObjIds[index] | 0) !== (runtimeObjId | 0)) {
                        continue;
                    }
                    nextDynamicRuntimeObjIds[index] = -1;
                    nextDynamicObjTypeIds[index] = -1;
                }
            }
            dynamicObjTypeIds = nextDynamicObjTypeIds;
            dynamicRuntimeObjIds = nextDynamicRuntimeObjIds;
        }
        if (update.appendDynamicObjRenders && (update.appendDynamicObjRenders.length | 0) > 0) {
            let nextDynamicObjTypeIds = dynamicObjTypeIds;
            let nextDynamicRuntimeObjIds = dynamicRuntimeObjIds;
            for (
                let appendIndex = 0;
                appendIndex < update.appendDynamicObjRenders.length;
                appendIndex++
            ) {
                const append: (typeof update.appendDynamicObjRenders)[number] =
                    update.appendDynamicObjRenders[appendIndex];
                if (!append) {
                    continue;
                }
                const interactId = append.interactId | 0;
                nextDynamicObjTypeIds = this.ensureInt32Length(
                    nextDynamicObjTypeIds,
                    (interactId + 1) | 0,
                );
                nextDynamicRuntimeObjIds = this.ensureInt32Length(
                    nextDynamicRuntimeObjIds,
                    (interactId + 1) | 0,
                );
                nextDynamicObjTypeIds[interactId] = append.objRenderData.objTypeIds[interactId] | 0;
                nextDynamicRuntimeObjIds[interactId] = append.runtimeObjId | 0;
            }
            dynamicObjTypeIds = nextDynamicObjTypeIds;
            dynamicRuntimeObjIds = nextDynamicRuntimeObjIds;
        }
        this.setMapObjInteractionState(mapId | 0, {
            staticObjTypeIds,
            dynamicObjTypeIds,
            dynamicRuntimeObjIds,
        });
    }

    private syncNpcInteractionState(packet: RenderFramePacket | undefined): void {
        this.clearNpcInteractionState();
        if (!packet) {
            return;
        }
        const ranges = packet.npcRangesByMapIdPacked;
        const meta = packet.npcInteractionMetaPacked;
        for (let off = 0; off < (ranges.length | 0); off += NPC_RANGES_BY_MAP_ID_STRIDE) {
            const mapId = ranges[off] | 0;
            const start = ranges[off + 1] | 0;
            const count = ranges[off + 2] | 0;
            if ((count | 0) <= 0) {
                continue;
            }
            const metaStart = (start | 0) * NPC_INTERACTION_META_STRIDE;
            const metaEnd = ((start + count) | 0) * NPC_INTERACTION_META_STRIDE;
            if ((metaStart | 0) < 0 || (metaEnd | 0) > (meta.length | 0)) {
                continue;
            }
            this.getOrCreateMapState(mapId).npcInteractionState = {
                start,
                metaPacked: meta.slice(metaStart, metaEnd),
            };
        }
    }

    private getMapState(mapId: number): MapInteractionState | undefined {
        return this.mapStateByMapId.get(mapId | 0);
    }

    private getOrCreateMapState(mapId: number): MapInteractionState {
        const normalizedMapId = mapId | 0;
        let mapState = this.mapStateByMapId.get(normalizedMapId);
        if (!mapState) {
            mapState = {};
            this.mapStateByMapId.set(normalizedMapId, mapState);
        }
        return mapState;
    }

    private clearNpcInteractionState(): void {
        for (const [mapId, mapState] of this.mapStateByMapId) {
            mapState.npcInteractionState = undefined;
            this.deleteMapStateIfEmpty(mapId, mapState);
        }
    }

    private deleteMapStateIfEmpty(mapId: number, mapState: MapInteractionState): void {
        if (
            mapState.animatedLocs !== undefined ||
            mapState.mapObjInteractionState !== undefined ||
            mapState.npcInteractionState !== undefined
        ) {
            return;
        }
        this.mapStateByMapId.delete(mapId | 0);
    }
}
