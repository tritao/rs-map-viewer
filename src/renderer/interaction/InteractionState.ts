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

export class InteractionState {
    readonly hoveredMapIds: Set<number> = new Set();
    readonly closestInteractIndices: Map<number, number[]> = new Map();

    reset(): void {
        this.hoveredMapIds.clear();
        this.closestInteractIndices.clear();
    }
}

export function packHoveredMapIds(hoveredMapIds: ReadonlySet<number>): Int32Array {
    const out = new Int32Array(hoveredMapIds.size | 0);
    let index = 0;
    for (const mapId of hoveredMapIds) {
        out[index++] = mapId | 0;
    }
    return out;
}

export function applyInteractionReadbackToState(
    state: InteractionState,
    interactBuffer: Float32Array,
    readWidth: number,
    readHeight: number,
    offsetX: number,
    offsetY: number,
    interactRadius: number,
): void {
    state.hoveredMapIds.clear();
    state.closestInteractIndices.clear();

    for (let y = 0; y < readHeight; y++) {
        for (let x = 0; x < readWidth; x++) {
            const index = (y * readWidth + x) * 4;

            const mapId = interactBuffer[index + 1];
            if (mapId !== 0) {
                state.hoveredMapIds.add(mapId);
            }

            const interactType = interactBuffer[index + 2];
            if (interactType !== 0) {
                const dist = Math.max(
                    Math.abs(x + offsetX - interactRadius),
                    Math.abs(y + offsetY - interactRadius),
                );

                const indices = state.closestInteractIndices.get(dist);
                if (indices) {
                    indices.push(index);
                } else {
                    state.closestInteractIndices.set(dist, [index]);
                }
            }
        }
    }
}
