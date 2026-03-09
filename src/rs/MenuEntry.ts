export enum MenuTargetType {
    NONE,
    PLAYER,
    NPC,
    LOC,
    OBJ,
}

export type ObjActionTargetInstance =
    | Readonly<{
          kind: "static";
          mapId: number;
          objIndex: number;
      }>
    | Readonly<{
          kind: "dynamic";
          mapId: number;
          runtimeObjId: number;
      }>;

export type MenuActionTarget =
    | Readonly<{
          kind: MenuTargetType.LOC;
          locTypeId: number;
          locInstance?: Readonly<{
              mapId: number;
              locIndex: number;
          }>;
      }>
    | Readonly<{
          kind: MenuTargetType.OBJ;
          objTypeId: number;
          objInstance: ObjActionTargetInstance;
      }>
    | Readonly<{
          kind: MenuTargetType.NPC;
          npcTypeId: number;
          npcInstance: Readonly<{
              mapId: number;
              npcInstanceId: number;
          }>;
      }>;

export interface MenuEntry {
    option: string;
    targetId: number;
    targetType: MenuTargetType;
    targetName: string;
    targetLevel: number;
    actionTarget?: MenuActionTarget;
}
