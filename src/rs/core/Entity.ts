export abstract class Entity {
    height: number = 1000;

    canMergeNormals(): boolean {
        return false;
    }

    tryGetXZRadius(): number | null {
        return null;
    }

    mergeNormals(
        entity: Entity,
        offsetX: number,
        offsetY: number,
        offsetZ: number,
        hideOccluded: boolean,
        scratch?: unknown,
    ): void {}

    // light(textureLoader: TextureLoader, lightX: number, lightY: number, lightZ: number): Entity {
    //     return this;
    // }
}
