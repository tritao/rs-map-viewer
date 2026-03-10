import type {
    ClientActorCommandTarget,
    ClientCommand,
    ClientGroundItemCommandTarget,
    ClientWorldObjectCommandTarget,
    WalkDestination,
} from "./ClientCommand";

export class ClientCommandService {
    private latestCommand?: ClientCommand;
    private latestCommandSequence: number = 0;

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
        target: ClientWorldObjectCommandTarget,
    ): void {
        this.setLatestCommand({
            kind: "interactWithWorldObject",
            option,
            target,
        });
    }

    interactWithGroundItem(option: string, target: ClientGroundItemCommandTarget): void {
        this.setLatestCommand({
            kind: "interactWithGroundItem",
            option,
            target,
        });
    }

    interactWithActor(option: string, target: ClientActorCommandTarget): void {
        this.setLatestCommand({
            kind: "interactWithActor",
            option,
            target,
        });
    }

    examineWorldObject(target: ClientWorldObjectCommandTarget): void {
        this.setLatestCommand({
            kind: "examineEntity",
            target: {
                entityId: target.entityId,
                targetKind: "worldObject",
                targetId: target.locTypeId | 0,
                backing: target.backing,
            },
        });
    }

    examineGroundItem(target: ClientGroundItemCommandTarget): void {
        this.setLatestCommand({
            kind: "examineEntity",
            target: {
                entityId: target.entityId,
                targetKind: "groundItem",
                targetId: target.objTypeId | 0,
                backing: target.backing,
            },
        });
    }

    examineActor(target: ClientActorCommandTarget): void {
        this.setLatestCommand({
            kind: "examineEntity",
            target: {
                entityId: target.entityId,
                targetKind: "actor",
                targetId: target.npcTypeId | 0,
                backing: target.backing,
            },
        });
    }

    private setLatestCommand(command: ClientCommand): void {
        this.latestCommand = command;
        this.latestCommandSequence = ((this.latestCommandSequence | 0) + 1) | 0;
    }
}
