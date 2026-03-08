export type DrawRange = [number, number, number];

export function newDrawRange(offset: number, elements: number, instances: number = 1): DrawRange {
    return [offset, elements, instances];
}
