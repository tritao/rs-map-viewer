import type { MapRenderCommandStreamRuntimeInput } from "../../worker/MapRenderDataContract";
import type {
    SdRenderableDrawRanges,
    SdRenderableModelInfoTextures,
} from "../../renderer/loader/SdRenderableData";
import {
    DRAW_BUCKET_KEYS,
    type DrawBucketKey,
    type DrawCommand,
    type SceneCommandStreamEntry,
    buildSceneCommandStreamFromBuckets,
    createModelInfoTextureData,
} from "./SceneBuffer";

export { DRAW_BUCKET_KEYS };
export type { DrawBucketKey };

export type RuntimeDrawCommandBuckets = Readonly<Record<DrawBucketKey, ReadonlyArray<DrawCommand>>>;

export type SceneDrawCommandsSource = Readonly<{
    drawCommands: ReadonlyArray<DrawCommand>;
    drawCommandsAlpha: ReadonlyArray<DrawCommand>;
    drawCommandsLod: ReadonlyArray<DrawCommand>;
    drawCommandsLodAlpha: ReadonlyArray<DrawCommand>;
    drawCommandsInteract: ReadonlyArray<DrawCommand>;
    drawCommandsInteractAlpha: ReadonlyArray<DrawCommand>;
    drawCommandsInteractLod: ReadonlyArray<DrawCommand>;
    drawCommandsInteractLodAlpha: ReadonlyArray<DrawCommand>;
}>;

export function collectRuntimeDrawCommandBuckets(
    source: SceneDrawCommandsSource,
): RuntimeDrawCommandBuckets {
    return {
        base: source.drawCommands,
        alpha: source.drawCommandsAlpha,
        lod: source.drawCommandsLod,
        lodAlpha: source.drawCommandsLodAlpha,
        interact: source.drawCommandsInteract,
        interactAlpha: source.drawCommandsInteractAlpha,
        interactLod: source.drawCommandsInteractLod,
        interactLodAlpha: source.drawCommandsInteractLodAlpha,
    };
}

export type RuntimeInputDimensions = Readonly<{
    levels: number;
    sizeX: number;
    sizeY: number;
    unitsTileHeightBasis: number;
}>;

export function buildRuntimeCommandStreamFromBuckets(
    drawCommands: RuntimeDrawCommandBuckets,
): SceneCommandStreamEntry[] {
    return buildSceneCommandStreamFromBuckets(drawCommands);
}

export function buildRuntimeCommandStreamInputFromBuckets(
    sceneTileHeights: Int32Array,
    dimensions: RuntimeInputDimensions,
    drawCommands: RuntimeDrawCommandBuckets,
): MapRenderCommandStreamRuntimeInput {
    let totalCmdCount = 0;
    let totalInstances = 0;
    for (let bucketIndex = 0; bucketIndex < DRAW_BUCKET_KEYS.length; bucketIndex++) {
        const key = DRAW_BUCKET_KEYS[bucketIndex];
        const commands = drawCommands[key];
        totalCmdCount += commands.length | 0;
        for (let i = 0; i < commands.length; i++) {
            totalInstances += commands[i].instances.length | 0;
        }
    }

    const cmdBucketIndices = new Int32Array(totalCmdCount);
    const cmdOffsets = new Int32Array(totalCmdCount);
    const cmdElements = new Int32Array(totalCmdCount);
    const cmdInstanceCounts = new Int32Array(totalCmdCount);
    const cmdPackedInstances = new Int32Array(totalInstances * 8);

    let cmdCursor = 0;
    let instanceCursor = 0;
    for (let bucketIndex = 0; bucketIndex < DRAW_BUCKET_KEYS.length; bucketIndex++) {
        const key = DRAW_BUCKET_KEYS[bucketIndex];
        const commands = drawCommands[key];
        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            cmdBucketIndices[cmdCursor] = bucketIndex;
            cmdOffsets[cmdCursor] = command.offset | 0;
            cmdElements[cmdCursor] = command.elements | 0;
            const instanceCount = command.instances.length | 0;
            cmdInstanceCounts[cmdCursor] = instanceCount;
            cmdCursor++;

            for (let j = 0; j < instanceCount; j++) {
                const instance = command.instances[j];
                cmdPackedInstances[instanceCursor++] = instance.sceneX | 0;
                cmdPackedInstances[instanceCursor++] = instance.sceneZ | 0;
                cmdPackedInstances[instanceCursor++] = instance.heightOffset | 0;
                cmdPackedInstances[instanceCursor++] = instance.level | 0;
                cmdPackedInstances[instanceCursor++] = instance.contourGround | 0;
                cmdPackedInstances[instanceCursor++] = instance.priority | 0;
                cmdPackedInstances[instanceCursor++] = instance.interactType | 0;
                cmdPackedInstances[instanceCursor++] = instance.interactId | 0;
            }
        }
    }

    return {
        sceneTileHeights,
        levels: dimensions.levels | 0,
        sizeX: dimensions.sizeX | 0,
        sizeY: dimensions.sizeY | 0,
        unitsTileHeightBasis: dimensions.unitsTileHeightBasis | 0,
        cmdBucketIndices,
        cmdOffsets,
        cmdElements,
        cmdInstanceCounts,
        cmdPackedInstances,
    };
}

export function buildRuntimeCommandStreamInput(
    sceneTileHeights: Int32Array,
    dimensions: RuntimeInputDimensions,
    commandStream: ReadonlyArray<SceneCommandStreamEntry>,
): MapRenderCommandStreamRuntimeInput {
    const totalCmdCount = commandStream.length | 0;
    const cmdBucketIndices = new Int32Array(totalCmdCount);
    const cmdOffsets = new Int32Array(totalCmdCount);
    const cmdElements = new Int32Array(totalCmdCount);
    const cmdInstanceCounts = new Int32Array(totalCmdCount);

    let totalInstances = 0;
    for (let i = 0; i < totalCmdCount; i++) {
        const command = commandStream[i];
        cmdBucketIndices[i] = command.bucketIndex | 0;
        cmdOffsets[i] = command.offset | 0;
        cmdElements[i] = command.elements | 0;
        const instanceCount = command.instances.length | 0;
        cmdInstanceCounts[i] = instanceCount;
        totalInstances += instanceCount;
    }

    const cmdPackedInstances = new Int32Array(totalInstances * 8);
    let instanceCursor = 0;
    for (let i = 0; i < totalCmdCount; i++) {
        const command = commandStream[i];
        const instanceCount = command.instances.length | 0;
        for (let j = 0; j < instanceCount; j++) {
            const instance = command.instances[j];
            cmdPackedInstances[instanceCursor++] = instance.sceneX | 0;
            cmdPackedInstances[instanceCursor++] = instance.sceneZ | 0;
            cmdPackedInstances[instanceCursor++] = instance.heightOffset | 0;
            cmdPackedInstances[instanceCursor++] = instance.level | 0;
            cmdPackedInstances[instanceCursor++] = instance.contourGround | 0;
            cmdPackedInstances[instanceCursor++] = instance.priority | 0;
            cmdPackedInstances[instanceCursor++] = instance.interactType | 0;
            cmdPackedInstances[instanceCursor++] = instance.interactId | 0;
        }
    }

    return {
        sceneTileHeights,
        levels: dimensions.levels | 0,
        sizeX: dimensions.sizeX | 0,
        sizeY: dimensions.sizeY | 0,
        unitsTileHeightBasis: dimensions.unitsTileHeightBasis | 0,
        cmdBucketIndices,
        cmdOffsets,
        cmdElements,
        cmdInstanceCounts,
        cmdPackedInstances,
    };
}

function packDrawCommandRanges(commands: readonly DrawCommand[]): Int32Array {
    const out = new Int32Array(commands.length * 3);
    let o = 0;
    for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        out[o++] = cmd.offset | 0;
        out[o++] = cmd.elements | 0;
        out[o++] = cmd.instances.length | 0;
    }
    return out;
}

export function buildDrawRangesFromBuckets(
    drawCommands: RuntimeDrawCommandBuckets,
): SdRenderableDrawRanges {
    return {
        base: packDrawCommandRanges(drawCommands.base),
        alpha: packDrawCommandRanges(drawCommands.alpha),
        lod: packDrawCommandRanges(drawCommands.lod),
        lodAlpha: packDrawCommandRanges(drawCommands.lodAlpha),
        interact: packDrawCommandRanges(drawCommands.interact),
        interactAlpha: packDrawCommandRanges(drawCommands.interactAlpha),
        interactLod: packDrawCommandRanges(drawCommands.interactLod),
        interactLodAlpha: packDrawCommandRanges(drawCommands.interactLodAlpha),
    };
}

export function buildModelInfoTexturesFromBuckets(
    drawCommands: RuntimeDrawCommandBuckets,
): SdRenderableModelInfoTextures {
    return {
        base: createModelInfoTextureData(drawCommands.base),
        alpha: createModelInfoTextureData(drawCommands.alpha),
        lod: createModelInfoTextureData(drawCommands.lod),
        lodAlpha: createModelInfoTextureData(drawCommands.lodAlpha),
        interact: createModelInfoTextureData(drawCommands.interact),
        interactAlpha: createModelInfoTextureData(drawCommands.interactAlpha),
        interactLod: createModelInfoTextureData(drawCommands.interactLod),
        interactLodAlpha: createModelInfoTextureData(drawCommands.interactLodAlpha),
    };
}
