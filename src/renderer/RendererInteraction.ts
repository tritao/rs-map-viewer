import type { InteractionInput } from "../runtime/contracts/Interaction";

export interface InteractionControllerRenderer {
    setInteractionInput(input: InteractionInput): void;
}

export interface InteractionSnapshotRenderer {
    getHoveredMapIdsPacked(): Int32Array;
}
