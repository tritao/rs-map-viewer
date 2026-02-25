import assert from "node:assert/strict";

import { InteractType } from "../../src/renderer/InteractType";
import {
    ContourGroundType,
    SceneBuffer,
    getInteractCommandBucketKeys,
    getMergedCommandBucketKeys,
} from "../../src/renderer/buffer/SceneBuffer";

function makeCommand(offset: number, elements: number, level: number) {
    return {
        offset,
        elements,
        instances: [
            {
                sceneX: 3200 + level,
                sceneZ: 3300 + level,
                heightOffset: -16,
                level,
                contourGround: ContourGroundType.NONE,
                priority: 0,
                interactType: InteractType.NONE,
                interactId: 0xffff,
            },
        ],
    };
}

function runRegression(): void {
    assert.deepEqual(getMergedCommandBucketKeys(false, true), ["base", "lod"]);
    assert.deepEqual(getMergedCommandBucketKeys(true, false), ["alpha"]);
    assert.deepEqual(getInteractCommandBucketKeys(false, true), ["interact", "interactLod"]);
    assert.deepEqual(getInteractCommandBucketKeys(true, false), ["interactAlpha"]);

    const sceneBuf = new SceneBuffer({} as any, new Map<number, number>(), 0);
    const opaque = makeCommand(12, 6, 0);
    const alpha = makeCommand(24, 3, 1);

    sceneBuf.emitMergedCommand(opaque, false, true);
    sceneBuf.emitInteractCommand(opaque, false, true);
    sceneBuf.emitMergedCommand(alpha, true, false);
    sceneBuf.emitInteractCommand(alpha, true, false);

    assert.equal(sceneBuf.drawCommands.length, 1);
    assert.equal(sceneBuf.drawCommandsLod.length, 1);
    assert.equal(sceneBuf.drawCommandsInteract.length, 1);
    assert.equal(sceneBuf.drawCommandsInteractLod.length, 1);
    assert.equal(sceneBuf.drawCommandsAlpha.length, 1);
    assert.equal(sceneBuf.drawCommandsInteractAlpha.length, 1);
    assert.equal(sceneBuf.drawCommandsLodAlpha.length, 0);
    assert.equal(sceneBuf.drawCommandsInteractLodAlpha.length, 0);

    const stream = sceneBuf.getCommandStream();
    assert.equal(stream.length, 6);
    assert.deepEqual(
        stream.map((entry) => entry.bucketIndex),
        [0, 1, 2, 4, 5, 6],
    );
}

async function main(): Promise<void> {
    runRegression();
    console.log("scene-command-emitter-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
