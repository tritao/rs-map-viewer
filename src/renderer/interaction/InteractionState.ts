export const INTERACT_BUFFER_COUNT = 2;
export const INTERACTION_RADIUS = 5;

export type InteractionInput = Readonly<{
    pointerLocked: boolean;
    mouseX: number;
    mouseY: number;
}>;

export interface InteractionControllerRenderer {
    setInteractionInput(input: InteractionInput): void;
}

export class InteractionState {
    readonly hoveredMapIds: Set<number> = new Set();
    readonly closestInteractIndices: Map<number, number[]> = new Map();

    reset(): void {
        this.hoveredMapIds.clear();
        this.closestInteractIndices.clear();
    }
}
