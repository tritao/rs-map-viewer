import { MenuTargetType, type ObjActionTargetInstance } from "../../rs/MenuEntry";
import type { ClientEntityId } from "../world/ClientWorldState";

export type WalkDestination = Readonly<{ x: number; z: number }>;

export type ClientCommand =
    | Readonly<{
          kind: "walkToPosition";
          destination: WalkDestination;
      }>
    | Readonly<{
          kind: "interactWithWorldObject";
          option: string;
          entityId?: ClientEntityId;
          locTypeId: number;
          locInstance?: Readonly<{
              mapId: number;
              locIndex: number;
          }>;
      }>
    | Readonly<{
          kind: "interactWithGroundItem";
          option: string;
          entityId?: ClientEntityId;
          objTypeId: number;
          objInstance: ObjActionTargetInstance;
      }>
    | Readonly<{
          kind: "interactWithActor";
          option: string;
          entityId?: ClientEntityId;
          npcTypeId: number;
          npcInstance: Readonly<{
              mapId: number;
              npcInstanceId: number;
          }>;
      }>
    | Readonly<{
          kind: "examineEntity";
          entityId?: ClientEntityId;
          targetType: MenuTargetType.LOC | MenuTargetType.OBJ | MenuTargetType.NPC;
          targetId: number;
      }>;
