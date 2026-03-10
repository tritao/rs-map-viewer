import type { ClientCommand } from "./ClientCommand";
import type { ClientCommandService } from "./ClientCommandService";

export type ClientPlayerIntent =
    | Readonly<{
          kind: "interactWithWorldObject";
          command: Extract<ClientCommand, { kind: "interactWithWorldObject" }>;
      }>
    | Readonly<{
          kind: "interactWithGroundItem";
          command: Extract<ClientCommand, { kind: "interactWithGroundItem" }>;
      }>
    | Readonly<{
          kind: "interactWithActor";
          command: Extract<ClientCommand, { kind: "interactWithActor" }>;
      }>
    | Readonly<{
          kind: "examineEntity";
          command: Extract<ClientCommand, { kind: "examineEntity" }>;
      }>;

export class ClientIntentState {
    private lastHandledSequence: number = 0;
    private latestPlayerIntent?: ClientPlayerIntent;
    private pendingPlayerIntent?: ClientPlayerIntent;

    reset(): void {
        this.lastHandledSequence = 0;
        this.latestPlayerIntent = undefined;
        this.pendingPlayerIntent = undefined;
    }

    update(commands: ClientCommandService): void {
        const latestEntry = commands.getLatestCommandEntry();
        if (!latestEntry || (latestEntry.sequence | 0) === (this.lastHandledSequence | 0)) {
            return;
        }
        this.lastHandledSequence = latestEntry.sequence | 0;

        const intent = this.toPlayerIntent(latestEntry.command);
        if (!intent) {
            return;
        }
        this.latestPlayerIntent = intent;
        this.pendingPlayerIntent = intent;
    }

    getLatestPlayerIntent(): ClientPlayerIntent | undefined {
        return this.latestPlayerIntent;
    }

    getPendingPlayerIntent(): ClientPlayerIntent | undefined {
        return this.pendingPlayerIntent;
    }

    clearPendingPlayerIntent(): void {
        this.pendingPlayerIntent = undefined;
    }

    private toPlayerIntent(command: ClientCommand): ClientPlayerIntent | undefined {
        switch (command.kind) {
            case "interactWithWorldObject":
                return {
                    kind: command.kind,
                    command,
                };
            case "interactWithGroundItem":
                return {
                    kind: command.kind,
                    command,
                };
            case "interactWithActor":
                return {
                    kind: command.kind,
                    command,
                };
            case "examineEntity":
                return {
                    kind: command.kind,
                    command,
                };
            case "walkToPosition":
                return undefined;
        }
    }
}
