import type { LocModelType } from "../../rs/config/loctype/LocModelType";
import type { LocAnimatedData } from "../../runtime/LocAnimatedData";
import {
    resolveWorldInteractionTargets,
    type InteractionHit,
    type WorldInteractionTarget,
} from "../../runtime/InteractionTargets";

export type ClientEntityId = string;

export type ClientEntityKind = "worldObject" | "groundItem" | "actor";

export type ClientWorldObjectBackingRef = Readonly<{
    kind: "loc";
    mapId: number;
    locIndex: number;
    sourceMapId: number;
    placementIndex: number;
    locTypeId: number;
}>;

export type ClientGroundItemBackingRef =
    | Readonly<{
          kind: "obj-static";
          mapId: number;
          objIndex: number;
          objTypeId: number;
      }>
    | Readonly<{
          kind: "obj-dynamic";
          mapId: number;
          runtimeObjId: number;
          objTypeId: number;
      }>;

export type ClientActorBackingRef = Readonly<{
    kind: "npc";
    mapId: number;
    npcInstanceId: number;
    npcTypeId: number;
}>;

export type ClientWorldObjectEntity = Readonly<{
    id: ClientEntityId;
    kind: "worldObject";
    mapId: number;
    plane: number;
    tileX: number;
    tileY: number;
    visible: boolean;
    locTypeId: number;
    locModelType: LocModelType;
    rotation: number;
    seqId: number;
    rsBacking: ClientWorldObjectBackingRef;
}>;

export type ClientGroundItemEntity = Readonly<{
    id: ClientEntityId;
    kind: "groundItem";
    mapId: number;
    visible: boolean;
    objTypeId: number;
    count?: number;
    x?: number;
    y?: number;
    plane?: number;
    interactId?: number;
    rsBacking: ClientGroundItemBackingRef;
}>;

export type ClientActorEntity = Readonly<{
    id: ClientEntityId;
    kind: "actor";
    mapId: number;
    visible: boolean;
    npcTypeId: number;
    interactId?: number;
    rsBacking: ClientActorBackingRef;
}>;

export type ClientWorldEntity =
    | ClientWorldObjectEntity
    | ClientGroundItemEntity
    | ClientActorEntity;

export type ClientActorSnapshot = Readonly<{
    interactId: number;
    npcInstanceId: number;
    npcTypeId: number;
}>;

type MapWorldState = {
    entityIds: Set<ClientEntityId>;
    staticObjTypeIds?: Int32Array;
    worldObjectIdsByLocIndex: Map<number, ClientEntityId>;
    staticGroundItemIdsByObjIndex: Map<number, ClientEntityId>;
    dynamicGroundItemIdsByInteractId: Map<number, ClientEntityId>;
    dynamicGroundItemIdsByRuntimeObjId: Map<number, ClientEntityId>;
    actorIdsByInteractId: Map<number, ClientEntityId>;
    actorIdsByNpcInstanceId: Map<number, ClientEntityId>;
};

function getWorldObjectEntityId(mapId: number, locIndex: number): ClientEntityId {
    return `worldObject:${mapId | 0}:${locIndex | 0}`;
}

function getStaticGroundItemEntityId(mapId: number, objIndex: number): ClientEntityId {
    return `groundItem:static:${mapId | 0}:${objIndex | 0}`;
}

function getDynamicGroundItemEntityId(mapId: number, runtimeObjId: number): ClientEntityId {
    return `groundItem:dynamic:${mapId | 0}:${runtimeObjId | 0}`;
}

function getActorEntityId(mapId: number, npcInstanceId: number): ClientEntityId {
    return `actor:${mapId | 0}:${npcInstanceId | 0}`;
}

function createEmptyMapState(): MapWorldState {
    return {
        entityIds: new Set<ClientEntityId>(),
        worldObjectIdsByLocIndex: new Map<number, ClientEntityId>(),
        staticGroundItemIdsByObjIndex: new Map<number, ClientEntityId>(),
        dynamicGroundItemIdsByInteractId: new Map<number, ClientEntityId>(),
        dynamicGroundItemIdsByRuntimeObjId: new Map<number, ClientEntityId>(),
        actorIdsByInteractId: new Map<number, ClientEntityId>(),
        actorIdsByNpcInstanceId: new Map<number, ClientEntityId>(),
    };
}

function buildWorldObjectEntity(
    mapId: number,
    locIndex: number,
    locData: LocAnimatedData,
): ClientWorldObjectEntity {
    const normalizedMapId = mapId | 0;
    const normalizedLocIndex = locIndex | 0;
    return {
        id: getWorldObjectEntityId(normalizedMapId, normalizedLocIndex),
        kind: "worldObject",
        mapId: normalizedMapId,
        plane: locData.level | 0,
        tileX: locData.tileX | 0,
        tileY: locData.tileY | 0,
        visible: true,
        locTypeId: locData.locTypeId | 0,
        locModelType: locData.locModelType,
        rotation: locData.rotation | 0,
        seqId: locData.seqId | 0,
        rsBacking: {
            kind: "loc",
            mapId: normalizedMapId,
            locIndex: normalizedLocIndex,
            sourceMapId: locData.sourceMapId | 0,
            placementIndex: locData.placementIndex | 0,
            locTypeId: locData.locTypeId | 0,
        },
    };
}

function buildStaticGroundItemEntity(
    mapId: number,
    objIndex: number,
    objTypeId: number,
): ClientGroundItemEntity {
    const normalizedMapId = mapId | 0;
    const normalizedObjIndex = objIndex | 0;
    const normalizedObjTypeId = objTypeId | 0;
    return {
        id: getStaticGroundItemEntityId(normalizedMapId, normalizedObjIndex),
        kind: "groundItem",
        mapId: normalizedMapId,
        visible: true,
        objTypeId: normalizedObjTypeId,
        interactId: normalizedObjIndex,
        rsBacking: {
            kind: "obj-static",
            mapId: normalizedMapId,
            objIndex: normalizedObjIndex,
            objTypeId: normalizedObjTypeId,
        },
    };
}

function buildDynamicGroundItemEntity(input: {
    mapId: number;
    runtimeObjId: number;
    objTypeId: number;
    interactId?: number;
    count?: number;
    x?: number;
    y?: number;
    plane?: number;
}): ClientGroundItemEntity {
    const normalizedMapId = input.mapId | 0;
    const normalizedRuntimeObjId = input.runtimeObjId | 0;
    const normalizedObjTypeId = input.objTypeId | 0;
    return {
        id: getDynamicGroundItemEntityId(normalizedMapId, normalizedRuntimeObjId),
        kind: "groundItem",
        mapId: normalizedMapId,
        visible: true,
        objTypeId: normalizedObjTypeId,
        interactId: input.interactId,
        count: input.count,
        x: input.x,
        y: input.y,
        plane: input.plane,
        rsBacking: {
            kind: "obj-dynamic",
            mapId: normalizedMapId,
            runtimeObjId: normalizedRuntimeObjId,
            objTypeId: normalizedObjTypeId,
        },
    };
}

function buildActorEntity(
    mapId: number,
    npcInstanceId: number,
    npcTypeId: number,
    interactId?: number,
): ClientActorEntity {
    const normalizedMapId = mapId | 0;
    const normalizedNpcInstanceId = npcInstanceId | 0;
    const normalizedNpcTypeId = npcTypeId | 0;
    return {
        id: getActorEntityId(normalizedMapId, normalizedNpcInstanceId),
        kind: "actor",
        mapId: normalizedMapId,
        visible: true,
        npcTypeId: normalizedNpcTypeId,
        interactId: interactId !== undefined ? interactId | 0 : undefined,
        rsBacking: {
            kind: "npc",
            mapId: normalizedMapId,
            npcInstanceId: normalizedNpcInstanceId,
            npcTypeId: normalizedNpcTypeId,
        },
    };
}

export class ClientWorldState {
    private readonly entitiesById = new Map<ClientEntityId, ClientWorldEntity>();
    private readonly mapStateByMapId = new Map<number, MapWorldState>();

    reset(): void {
        this.entitiesById.clear();
        this.mapStateByMapId.clear();
    }

    replaceMapWorldObjects(mapId: number, animatedLocs: ReadonlyArray<LocAnimatedData>): void {
        const normalizedMapId = mapId | 0;
        this.clearWorldObjectEntitiesForMap(normalizedMapId);
        for (let locIndex = 0; locIndex < (animatedLocs.length | 0); locIndex++) {
            const locData = animatedLocs[locIndex];
            if (!locData) {
                continue;
            }
            this.setWorldObjectEntity(
                normalizedMapId,
                locIndex,
                buildWorldObjectEntity(normalizedMapId, locIndex, locData),
            );
        }
    }

    unregisterMap(mapId: number): void {
        const normalizedMapId = mapId | 0;
        const mapState = this.mapStateByMapId.get(normalizedMapId);
        if (!mapState) {
            return;
        }
        for (const entityId of mapState.entityIds) {
            this.entitiesById.delete(entityId);
        }
        this.mapStateByMapId.delete(normalizedMapId);
    }

    replaceMapStaticGroundItems(
        mapId: number,
        staticObjTypeIds: Int32Array | undefined,
        visible: boolean,
    ): void {
        this.setStaticObjTypeIds(mapId | 0, staticObjTypeIds, visible);
    }

    setWorldObjectVisibility(mapId: number, locIndex: number, visible: boolean): void {
        const entity = this.getWorldObjectEntity(mapId | 0, locIndex | 0);
        if (!entity) {
            return;
        }
        this.entitiesById.set(entity.id, {
            ...entity,
            visible,
        });
    }

    setStaticGroundItemVisibility(mapId: number, objIndex: number, visible: boolean): void {
        const normalizedMapId = mapId | 0;
        const normalizedObjIndex = objIndex | 0;
        const mapState = this.getOrCreateMapState(normalizedMapId);
        const entityId = mapState.staticGroundItemIdsByObjIndex.get(normalizedObjIndex);
        if (!entityId) {
            const objTypeId = mapState.staticObjTypeIds?.[normalizedObjIndex];
            if (objTypeId === undefined || (objTypeId | 0) < 0 || !visible) {
                return;
            }
            const entity = buildStaticGroundItemEntity(
                normalizedMapId,
                normalizedObjIndex,
                objTypeId | 0,
            );
            this.entitiesById.set(entity.id, entity);
            mapState.entityIds.add(entity.id);
            mapState.staticGroundItemIdsByObjIndex.set(normalizedObjIndex, entity.id);
            return;
        }
        const entity = this.entitiesById.get(entityId);
        if (!entity || entity.kind !== "groundItem") {
            return;
        }
        this.entitiesById.set(entityId, {
            ...entity,
            visible,
        });
    }

    upsertDynamicGroundItem(input: {
        mapId: number;
        runtimeObjId: number;
        objTypeId: number;
        interactId?: number;
        count?: number;
        x?: number;
        y?: number;
        plane?: number;
    }): void {
        this.setDynamicGroundItem(input);
    }

    setDynamicGroundItemInteractId(input: {
        mapId: number;
        runtimeObjId: number;
        interactId: number;
        objTypeId?: number;
    }): void {
        this.setDynamicGroundItem({
            mapId: input.mapId | 0,
            runtimeObjId: input.runtimeObjId | 0,
            objTypeId:
                input.objTypeId !== undefined ? input.objTypeId | 0 : undefined,
            interactId: input.interactId | 0,
        });
    }

    removeDynamicGroundItem(mapId: number, runtimeObjId: number): void {
        this.removeDynamicGroundItemByRuntimeObjId(mapId | 0, runtimeObjId | 0);
    }

    clearDynamicGroundItemInteractId(mapId: number, runtimeObjId: number): void {
        const mapState = this.mapStateByMapId.get(mapId | 0);
        if (!mapState) {
            return;
        }
        const entityId = mapState.dynamicGroundItemIdsByRuntimeObjId.get(runtimeObjId | 0);
        if (!entityId) {
            return;
        }
        const entity = this.entitiesById.get(entityId);
        if (!entity || entity.kind !== "groundItem" || entity.interactId === undefined) {
            return;
        }
        mapState.dynamicGroundItemIdsByInteractId.delete(entity.interactId | 0);
        this.entitiesById.set(entityId, {
            ...entity,
            interactId: undefined,
        });
    }

    clearDynamicGroundItemsForMap(mapId: number): void {
        this.clearDynamicGroundItems(mapId | 0);
    }

    clearDynamicGroundItemInteractionsForMap(mapId: number): void {
        const mapState = this.mapStateByMapId.get(mapId | 0);
        if (!mapState) {
            return;
        }
        for (const entityId of mapState.dynamicGroundItemIdsByRuntimeObjId.values()) {
            const entity = this.entitiesById.get(entityId);
            if (!entity || entity.kind !== "groundItem" || entity.interactId === undefined) {
                continue;
            }
            this.entitiesById.set(entityId, {
                ...entity,
                interactId: undefined,
            });
        }
        mapState.dynamicGroundItemIdsByInteractId.clear();
    }

    replaceActorsForMap(mapId: number, actors: ReadonlyArray<ClientActorSnapshot>): void {
        this.replaceVisibleActorInteractions(mapId | 0, actors);
    }

    upsertActor(input: {
        mapId: number;
        npcInstanceId: number;
        npcTypeId: number;
        interactId?: number;
    }): void {
        const normalizedMapId = input.mapId | 0;
        const normalizedNpcInstanceId = input.npcInstanceId | 0;
        const existing = this.getActorEntityByNpcInstanceId(
            normalizedMapId,
            normalizedNpcInstanceId,
        );
        const nextEntity = buildActorEntity(
            normalizedMapId,
            normalizedNpcInstanceId,
            input.npcTypeId !== undefined
                ? input.npcTypeId | 0
                : (existing?.npcTypeId ?? 0) | 0,
            input.interactId ?? existing?.interactId,
        );
        const mapState = this.getOrCreateMapState(normalizedMapId);
        this.entitiesById.set(nextEntity.id, nextEntity);
        mapState.entityIds.add(nextEntity.id);
        mapState.actorIdsByNpcInstanceId.set(normalizedNpcInstanceId, nextEntity.id);
        if (existing?.interactId !== undefined && existing.interactId !== nextEntity.interactId) {
            mapState.actorIdsByInteractId.delete(existing.interactId | 0);
        }
        if (nextEntity.interactId !== undefined) {
            mapState.actorIdsByInteractId.set(nextEntity.interactId | 0, nextEntity.id);
        }
    }

    removeActor(mapId: number, npcInstanceId: number): void {
        const normalizedMapId = mapId | 0;
        const normalizedNpcInstanceId = npcInstanceId | 0;
        const mapState = this.mapStateByMapId.get(normalizedMapId);
        if (!mapState) {
            return;
        }
        const entityId = mapState.actorIdsByNpcInstanceId.get(normalizedNpcInstanceId);
        if (!entityId) {
            return;
        }
        const entity = this.entitiesById.get(entityId);
        mapState.actorIdsByNpcInstanceId.delete(normalizedNpcInstanceId);
        if (entity?.kind === "actor" && entity.interactId !== undefined) {
            mapState.actorIdsByInteractId.delete(entity.interactId | 0);
        }
        mapState.entityIds.delete(entityId);
        this.entitiesById.delete(entityId);
    }

    replaceVisibleActorInteractions(mapId: number, actors: ReadonlyArray<ClientActorSnapshot>): void {
        const normalizedMapId = mapId | 0;
        this.clearActorInteractionIds(normalizedMapId);
        for (let index = 0; index < (actors.length | 0); index++) {
            const actor = actors[index];
            if (!actor) {
                continue;
            }
            this.upsertActor({
                mapId: normalizedMapId,
                npcInstanceId: actor.npcInstanceId | 0,
                npcTypeId: actor.npcTypeId | 0,
                interactId: actor.interactId | 0,
            });
        }
    }

    clearVisibleActorInteractions(mapId: number): void {
        this.clearActorInteractionIds(mapId | 0);
    }

    getEntity(entityId: ClientEntityId): ClientWorldEntity | undefined {
        return this.entitiesById.get(entityId);
    }

    getEntitiesForMap(mapId: number): ReadonlyArray<ClientWorldEntity> {
        const mapState = this.mapStateByMapId.get(mapId | 0);
        if (!mapState || (mapState.entityIds.size | 0) <= 0) {
            return [];
        }
        const entities: ClientWorldEntity[] = [];
        for (const entityId of mapState.entityIds) {
            const entity = this.entitiesById.get(entityId);
            if (entity) {
                entities.push(entity);
            }
        }
        return entities;
    }

    getMapIds(): ReadonlyArray<number> {
        return Array.from(this.mapStateByMapId.keys());
    }

    getWorldObjectEntitiesForMap(mapId: number): ReadonlyArray<ClientWorldObjectEntity> {
        return this.getEntitiesForMap(mapId).filter(
            (entity): entity is ClientWorldObjectEntity => entity.kind === "worldObject",
        );
    }

    getStaticGroundItemEntitiesForMap(mapId: number): ReadonlyArray<ClientGroundItemEntity> {
        return this.getEntitiesForMap(mapId).filter(
            (entity): entity is ClientGroundItemEntity =>
                entity.kind === "groundItem" && entity.rsBacking.kind === "obj-static",
        );
    }

    getStaticGroundItemEntity(mapId: number, objIndex: number): ClientGroundItemEntity | undefined {
        const entityId = this.mapStateByMapId
            .get(mapId | 0)
            ?.staticGroundItemIdsByObjIndex.get(objIndex | 0);
        if (!entityId) {
            return undefined;
        }
        const entity = this.entitiesById.get(entityId);
        return entity?.kind === "groundItem" ? entity : undefined;
    }

    getDynamicGroundItemEntityByRuntimeObjId(
        mapId: number,
        runtimeObjId: number,
    ): ClientGroundItemEntity | undefined {
        const entityId = this.mapStateByMapId
            .get(mapId | 0)
            ?.dynamicGroundItemIdsByRuntimeObjId.get(runtimeObjId | 0);
        if (!entityId) {
            return undefined;
        }
        const entity = this.entitiesById.get(entityId);
        return entity?.kind === "groundItem" ? entity : undefined;
    }

    getGroundItemEntity(mapId: number, interactId: number): ClientGroundItemEntity | undefined {
        const normalizedMapId = mapId | 0;
        const normalizedInteractId = interactId | 0;
        const mapState = this.mapStateByMapId.get(normalizedMapId);
        if (!mapState) {
            return undefined;
        }

        const staticEntityId = mapState.staticGroundItemIdsByObjIndex.get(normalizedInteractId);
        if (staticEntityId) {
            const entity = this.entitiesById.get(staticEntityId);
            if (entity?.kind === "groundItem") {
                return entity;
            }
        }

        const dynamicEntityId = mapState.dynamicGroundItemIdsByInteractId.get(normalizedInteractId);
        if (!dynamicEntityId) {
            return undefined;
        }
        const entity = this.entitiesById.get(dynamicEntityId);
        return entity?.kind === "groundItem" ? entity : undefined;
    }

    getWorldObjectEntity(mapId: number, locIndex: number): ClientWorldObjectEntity | undefined {
        const entityId = this.mapStateByMapId
            .get(mapId | 0)
            ?.worldObjectIdsByLocIndex.get(locIndex | 0);
        if (!entityId) {
            return undefined;
        }
        const entity = this.entitiesById.get(entityId);
        return entity?.kind === "worldObject" ? entity : undefined;
    }

    getActorEntityByInteractId(mapId: number, interactId: number): ClientActorEntity | undefined {
        const entityId = this.mapStateByMapId.get(mapId | 0)?.actorIdsByInteractId.get(interactId | 0);
        if (!entityId) {
            return undefined;
        }
        const entity = this.entitiesById.get(entityId);
        return entity?.kind === "actor" ? entity : undefined;
    }

    getActorEntityByNpcInstanceId(
        mapId: number,
        npcInstanceId: number,
    ): ClientActorEntity | undefined {
        const entityId = this.mapStateByMapId
            .get(mapId | 0)
            ?.actorIdsByNpcInstanceId.get(npcInstanceId | 0);
        if (!entityId) {
            return undefined;
        }
        const entity = this.entitiesById.get(entityId);
        return entity?.kind === "actor" ? entity : undefined;
    }

    resolveInteractionTargets(hits: ReadonlyArray<InteractionHit>): WorldInteractionTarget[] {
        return resolveWorldInteractionTargets({
            hits,
            getAnimatedLocTypeId: (mapId, locIndex) =>
                this.getWorldObjectEntity(mapId | 0, locIndex | 0)?.locTypeId,
            getMapObjTargetInfo: (mapId, interactId) => {
                const entity = this.getGroundItemEntity(mapId | 0, interactId | 0);
                if (!entity || !entity.visible) {
                    return undefined;
                }
                if (entity.rsBacking.kind === "obj-static") {
                    return {
                        kind: "static" as const,
                        objTypeId: entity.objTypeId | 0,
                        objIndex: entity.rsBacking.objIndex | 0,
                    };
                }
                return {
                    kind: "dynamic" as const,
                    objTypeId: entity.objTypeId | 0,
                    runtimeObjId: entity.rsBacking.runtimeObjId | 0,
                };
            },
            getNpcTargetInfo: (mapId, interactId) => {
                const entity = this.getActorEntityByInteractId(mapId | 0, interactId | 0);
                if (!entity || !entity.visible) {
                    return undefined;
                }
                return {
                    npcInstanceId: entity.rsBacking.npcInstanceId | 0,
                    npcTypeId: entity.npcTypeId | 0,
                };
            },
        });
    }

    private getOrCreateMapState(mapId: number): MapWorldState {
        const normalizedMapId = mapId | 0;
        let mapState = this.mapStateByMapId.get(normalizedMapId);
        if (!mapState) {
            mapState = createEmptyMapState();
            this.mapStateByMapId.set(normalizedMapId, mapState);
        }
        return mapState;
    }

    private clearWorldObjectEntitiesForMap(mapId: number): void {
        const mapState = this.getOrCreateMapState(mapId | 0);
        for (const entityId of mapState.worldObjectIdsByLocIndex.values()) {
            mapState.entityIds.delete(entityId);
            this.entitiesById.delete(entityId);
        }
        mapState.worldObjectIdsByLocIndex.clear();
    }

    private setWorldObjectEntity(
        mapId: number,
        locIndex: number,
        entity: ClientWorldObjectEntity,
    ): void {
        const mapState = this.getOrCreateMapState(mapId);
        this.entitiesById.set(entity.id, entity);
        mapState.entityIds.add(entity.id);
        mapState.worldObjectIdsByLocIndex.set(locIndex | 0, entity.id);
    }

    private setStaticObjTypeIds(
        mapId: number,
        staticObjTypeIds: Int32Array | undefined,
        visible: boolean,
    ): void {
        const mapState = this.getOrCreateMapState(mapId);
        mapState.staticObjTypeIds = staticObjTypeIds;
        this.rebuildStaticGroundItemEntities(mapId, visible);
    }

    private rebuildStaticGroundItemEntities(mapId: number, visible: boolean): void {
        const normalizedMapId = mapId | 0;
        const mapState = this.getOrCreateMapState(normalizedMapId);

        for (const entityId of mapState.staticGroundItemIdsByObjIndex.values()) {
            mapState.entityIds.delete(entityId);
            this.entitiesById.delete(entityId);
        }
        mapState.staticGroundItemIdsByObjIndex.clear();

        const staticObjTypeIds = mapState.staticObjTypeIds;
        if (!(staticObjTypeIds instanceof Int32Array) || (staticObjTypeIds.length | 0) <= 0) {
            return;
        }

        for (let objIndex = 0; objIndex < staticObjTypeIds.length; objIndex++) {
            const objTypeId = staticObjTypeIds[objIndex] | 0;
            if ((objTypeId | 0) < 0) {
                continue;
            }
            const entity = {
                ...buildStaticGroundItemEntity(normalizedMapId, objIndex, objTypeId),
                visible,
            };
            this.entitiesById.set(entity.id, entity);
            mapState.entityIds.add(entity.id);
            mapState.staticGroundItemIdsByObjIndex.set(objIndex | 0, entity.id);
        }
    }

    private setDynamicGroundItem(input: {
        mapId: number;
        runtimeObjId: number;
        objTypeId?: number;
        interactId?: number;
        count?: number;
        x?: number;
        y?: number;
        plane?: number;
    }): void {
        const normalizedMapId = input.mapId | 0;
        const normalizedRuntimeObjId = input.runtimeObjId | 0;
        const existing = this.findDynamicGroundItemByRuntimeObjId(normalizedRuntimeObjId);
        const nextEntity = buildDynamicGroundItemEntity({
            mapId: normalizedMapId,
            runtimeObjId: normalizedRuntimeObjId,
            objTypeId:
                input.objTypeId !== undefined
                    ? input.objTypeId | 0
                    : (existing?.objTypeId ?? 0) | 0,
            interactId: input.interactId ?? existing?.interactId,
            count: input.count ?? existing?.count,
            x: input.x ?? existing?.x,
            y: input.y ?? existing?.y,
            plane: input.plane ?? existing?.plane,
        });

        if (existing && (existing.mapId | 0) !== normalizedMapId) {
            this.removeDynamicGroundItemByRuntimeObjId(existing.mapId | 0, normalizedRuntimeObjId);
        }

        const mapState = this.getOrCreateMapState(normalizedMapId);
        this.entitiesById.set(nextEntity.id, nextEntity);
        mapState.entityIds.add(nextEntity.id);
        mapState.dynamicGroundItemIdsByRuntimeObjId.set(normalizedRuntimeObjId, nextEntity.id);
        if (existing?.interactId !== undefined && existing.interactId !== nextEntity.interactId) {
            mapState.dynamicGroundItemIdsByInteractId.delete(existing.interactId | 0);
        }
        if (nextEntity.interactId !== undefined) {
            mapState.dynamicGroundItemIdsByInteractId.set(nextEntity.interactId | 0, nextEntity.id);
        }
    }

    private findDynamicGroundItemByRuntimeObjId(runtimeObjId: number): ClientGroundItemEntity | undefined {
        const normalizedRuntimeObjId = runtimeObjId | 0;
        for (const mapState of this.mapStateByMapId.values()) {
            const entityId = mapState.dynamicGroundItemIdsByRuntimeObjId.get(normalizedRuntimeObjId);
            if (!entityId) {
                continue;
            }
            const entity = this.entitiesById.get(entityId);
            if (entity?.kind === "groundItem" && entity.rsBacking.kind === "obj-dynamic") {
                return entity;
            }
        }
        return undefined;
    }

    private removeDynamicGroundItemByRuntimeObjId(mapId: number, runtimeObjId: number): void {
        const mapState = this.mapStateByMapId.get(mapId | 0);
        if (!mapState) {
            return;
        }
        const entityId = mapState.dynamicGroundItemIdsByRuntimeObjId.get(runtimeObjId | 0);
        if (!entityId) {
            return;
        }
        const entity = this.entitiesById.get(entityId);
        mapState.dynamicGroundItemIdsByRuntimeObjId.delete(runtimeObjId | 0);
        if (entity?.kind === "groundItem" && entity.interactId !== undefined) {
            mapState.dynamicGroundItemIdsByInteractId.delete(entity.interactId | 0);
        }
        mapState.entityIds.delete(entityId);
        this.entitiesById.delete(entityId);
    }

    private clearDynamicGroundItems(mapId: number): void {
        const mapState = this.mapStateByMapId.get(mapId | 0);
        if (!mapState) {
            return;
        }
        for (const entityId of mapState.dynamicGroundItemIdsByRuntimeObjId.values()) {
            mapState.entityIds.delete(entityId);
            this.entitiesById.delete(entityId);
        }
        mapState.dynamicGroundItemIdsByRuntimeObjId.clear();
        mapState.dynamicGroundItemIdsByInteractId.clear();
    }

    private clearActorInteractionIds(mapId: number): void {
        const mapState = this.mapStateByMapId.get(mapId | 0);
        if (!mapState) {
            return;
        }
        for (const entityId of mapState.actorIdsByInteractId.values()) {
            const entity = this.entitiesById.get(entityId);
            if (!entity || entity.kind !== "actor" || entity.interactId === undefined) {
                continue;
            }
            this.entitiesById.set(entityId, {
                ...entity,
                interactId: undefined,
            });
        }
        mapState.actorIdsByInteractId.clear();
    }

}
