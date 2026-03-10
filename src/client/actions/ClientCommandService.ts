import { MenuTargetType, type ObjActionTargetInstance } from "../../rs/MenuEntry";
import type {
    ClientEntityId,
    ClientGroundItemEntity,
    ClientWorldEntity,
    ClientWorldState,
} from "../world/ClientWorldState";
import type { WalkDestination } from "../../mapviewer/MapViewerNavigation";

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

type ClientCommandServiceDeps = Readonly<{
    clientWorldState: ClientWorldState;
}>;

export class ClientCommandService {
    private latestCommand?: ClientCommand;
    private latestCommandSequence: number = 0;

    constructor(private readonly deps: ClientCommandServiceDeps) {}

    reset(): void {
        this.latestCommand = undefined;
        this.latestCommandSequence = 0;
    }

    getLatestCommand(): ClientCommand | undefined {
        return this.latestCommand;
    }

    getLatestCommandEntry():
        | Readonly<{
              sequence: number;
              command: ClientCommand;
          }>
        | undefined {
        if (!this.latestCommand) {
            return undefined;
        }
        return {
            sequence: this.latestCommandSequence | 0,
            command: this.latestCommand,
        };
    }

    walkToPosition(destination: WalkDestination): void {
        this.setLatestCommand({
            kind: "walkToPosition",
            destination,
        });
    }

    interactWithWorldObject(
        option: string,
        target: Readonly<{
            locTypeId: number;
            locInstance?: Readonly<{
                mapId: number;
                locIndex: number;
            }>;
        }>,
    ): void {
        this.setLatestCommand({
            kind: "interactWithWorldObject",
            option,
            entityId:
                target.locInstance
                    ? this.deps.clientWorldState.getWorldObjectEntity(
                          target.locInstance.mapId | 0,
                          target.locInstance.locIndex | 0,
                      )?.id
                    : undefined,
            locTypeId: target.locTypeId | 0,
            locInstance: target.locInstance,
        });
    }

    interactWithGroundItem(
        option: string,
        target: Readonly<{
            objTypeId: number;
            objInstance: ObjActionTargetInstance;
        }>,
    ): void {
        this.setLatestCommand({
            kind: "interactWithGroundItem",
            option,
            entityId: this.resolveGroundItemEntity(target.objInstance)?.id,
            objTypeId: target.objTypeId | 0,
            objInstance: target.objInstance,
        });
    }

    interactWithActor(
        option: string,
        target: Readonly<{
            npcTypeId: number;
            npcInstance: Readonly<{
                mapId: number;
                npcInstanceId: number;
            }>;
        }>,
    ): void {
        this.setLatestCommand({
            kind: "interactWithActor",
            option,
            entityId: this.deps.clientWorldState.getActorEntityByNpcInstanceId(
                target.npcInstance.mapId | 0,
                target.npcInstance.npcInstanceId | 0,
            )?.id,
            npcTypeId: target.npcTypeId | 0,
            npcInstance: target.npcInstance,
        });
    }

    examineWorldObject(target: Readonly<{ locTypeId: number; mapId?: number; locIndex?: number }>): void {
        this.examineResolvedTarget(
            MenuTargetType.LOC,
            target.locTypeId | 0,
            target.mapId !== undefined && target.locIndex !== undefined
                ? this.deps.clientWorldState.getWorldObjectEntity(target.mapId | 0, target.locIndex | 0)
                : undefined,
        );
    }

    examineGroundItem(target: Readonly<{ objTypeId: number; objInstance: ObjActionTargetInstance }>): void {
        this.examineResolvedTarget(
            MenuTargetType.OBJ,
            target.objTypeId | 0,
            this.resolveGroundItemEntity(target.objInstance),
        );
    }

    examineActor(target: Readonly<{
        npcTypeId: number;
        npcInstance: Readonly<{ mapId: number; npcInstanceId: number }>;
    }>): void {
        this.examineResolvedTarget(
            MenuTargetType.NPC,
            target.npcTypeId | 0,
            this.deps.clientWorldState.getActorEntityByNpcInstanceId(
                target.npcInstance.mapId | 0,
                target.npcInstance.npcInstanceId | 0,
            ),
        );
    }

    private examineResolvedTarget(
        targetType: MenuTargetType.LOC | MenuTargetType.OBJ | MenuTargetType.NPC,
        targetId: number,
        entity: ClientWorldEntity | undefined,
    ): void {
        this.setLatestCommand({
            kind: "examineEntity",
            entityId: entity?.id,
            targetType,
            targetId: targetId | 0,
        });
    }

    private resolveGroundItemEntity(
        target: ObjActionTargetInstance,
    ): ClientGroundItemEntity | undefined {
        if (target.kind === "dynamic") {
            return this.deps.clientWorldState.getDynamicGroundItemEntityByRuntimeObjId(
                target.mapId | 0,
                target.runtimeObjId | 0,
            );
        }
        return this.deps.clientWorldState.getStaticGroundItemEntity(
            target.mapId | 0,
            target.objIndex | 0,
        );
    }

    private setLatestCommand(command: ClientCommand): void {
        this.latestCommand = command;
        this.latestCommandSequence = ((this.latestCommandSequence | 0) + 1) | 0;
    }
}
