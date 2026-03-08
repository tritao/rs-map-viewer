export const INTERACT_BUFFER_COUNT = 2;
export const INTERACTION_RADIUS = 5;

export type InteractionInput = Readonly<{
    pointerLocked: boolean;
    mouseX: number;
    mouseY: number;
}>;
