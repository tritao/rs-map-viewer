import type { LocModelType } from "../../rs/config/loctype/LocModelType";

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

export type ClientActorInteractionSnapshot = Readonly<{
    interactId: number;
    npcInstanceId: number;
    npcTypeId: number;
}>;
