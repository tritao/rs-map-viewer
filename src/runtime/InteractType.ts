export enum InteractType {
    NONE = 0,
    LOC = 1, // object
    OBJ = 2, // item
    NPC = 3,
}

export const LOC_ANIMATED_INSTANCE_INTERACT_FLAG = 1 << 16;

export function encodeAnimatedLocInteractId(locIndex: number): number {
    return LOC_ANIMATED_INSTANCE_INTERACT_FLAG | (((locIndex | 0) + 1) & 0xffff);
}

export function isAnimatedLocInteractId(interactId: number): boolean {
    return (
        ((interactId | 0) & LOC_ANIMATED_INSTANCE_INTERACT_FLAG) !== 0 &&
        (((interactId | 0) & 0xffff) !== 0)
    );
}

export function decodeAnimatedLocInteractIndex(interactId: number): number | undefined {
    if (!isAnimatedLocInteractId(interactId)) {
        return undefined;
    }
    return (((interactId | 0) & 0xffff) - 1) | 0;
}
