import type {
    ClientActorBackingRef,
    ClientEntityId,
    ClientGroundItemBackingRef,
    ClientWorldObjectBackingRef,
} from "../world/ClientWorldState";

export type WalkDestination = Readonly<{ x: number; z: number }>;

export type ClientWorldObjectCommandTarget = Readonly<{
    entityId?: ClientEntityId;
    locTypeId: number;
    backing?: ClientWorldObjectBackingRef;
}>;

export type ClientGroundItemCommandTarget = Readonly<{
    entityId?: ClientEntityId;
    objTypeId: number;
    backing: ClientGroundItemBackingRef;
}>;

export type ClientActorCommandTarget = Readonly<{
    entityId?: ClientEntityId;
    npcTypeId: number;
    backing: ClientActorBackingRef;
}>;

export type ClientExamineTarget = Readonly<{
    entityId?: ClientEntityId;
    targetKind: "worldObject" | "groundItem" | "actor";
    targetId: number;
    backing?:
        | ClientWorldObjectBackingRef
        | ClientGroundItemBackingRef
        | ClientActorBackingRef;
}>;

export type ClientCommand =
    | Readonly<{
          kind: "walkToPosition";
          destination: WalkDestination;
      }>
    | Readonly<{
          kind: "interactWithWorldObject";
          option: string;
          target: ClientWorldObjectCommandTarget;
      }>
    | Readonly<{
          kind: "interactWithGroundItem";
          option: string;
          target: ClientGroundItemCommandTarget;
      }>
    | Readonly<{
          kind: "interactWithActor";
          option: string;
          target: ClientActorCommandTarget;
      }>
    | Readonly<{
          kind: "examineEntity";
          target: ClientExamineTarget;
      }>;
