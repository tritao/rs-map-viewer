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

export interface InteractionSnapshotRenderer {
    getHoveredMapIdsPacked(): Int32Array;
}

