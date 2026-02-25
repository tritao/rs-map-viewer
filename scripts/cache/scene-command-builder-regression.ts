import assert from "node:assert/strict";

import {
    buildRuntimeCommandStreamInput,
    buildRuntimeCommandStreamInputFromBuckets,
    buildRuntimeCommandStreamFromBuckets,
    collectRuntimeDrawCommandBuckets,
} from "../../src/renderer/buffer/SceneCommandBuilder";

function assertI32ArrayEquals(actual: Int32Array, expected: number[], label: string): void {
    assert.equal(actual.length, expected.length, `${label} length mismatch`);
    for (let i = 0; i < expected.length; i++) {
        assert.equal(actual[i], expected[i], `${label}[${i}] mismatch`);
    }
}

function runRegression(): void {
    const source = {
        drawCommands: [
            {
                offset: 12,
                elements: 6,
                instances: [
                    {
                        sceneX: 3200,
                        sceneZ: 3201,
                        heightOffset: -16,
                        level: 0,
                        contourGround: 0,
                        priority: 1,
                        interactType: 0,
                        interactId: 100,
                    },
                    {
                        sceneX: 3202,
                        sceneZ: 3203,
                        heightOffset: -24,
                        level: 1,
                        contourGround: 1,
                        priority: 2,
                        interactType: 3,
                        interactId: 101,
                    },
                ],
            },
        ],
        drawCommandsAlpha: [
            {
                offset: 24,
                elements: 3,
                instances: [
                    {
                        sceneX: 3210,
                        sceneZ: 3211,
                        heightOffset: 0,
                        level: 2,
                        contourGround: 2,
                        priority: 4,
                        interactType: 1,
                        interactId: 102,
                    },
                ],
            },
        ],
        drawCommandsLod: [],
        drawCommandsLodAlpha: [],
        drawCommandsInteract: [],
        drawCommandsInteractAlpha: [],
        drawCommandsInteractLod: [],
        drawCommandsInteractLodAlpha: [],
    };

    const buckets = collectRuntimeDrawCommandBuckets(source);
    const commandStream = buildRuntimeCommandStreamFromBuckets(buckets);
    assert.equal(commandStream.length, 2, "commandStream length");
    assert.equal(commandStream[0].bucketIndex, 0, "base bucket index");
    assert.equal(commandStream[1].bucketIndex, 1, "alpha bucket index");

    const sceneTileHeights = Int32Array.from([0, 1, 2, 3]);
    const runtimeAFromBuckets = buildRuntimeCommandStreamInputFromBuckets(
        sceneTileHeights,
        {
            levels: 1,
            sizeX: 1,
            sizeY: 1,
            unitsTileHeightBasis: 8,
        },
        buckets,
    );
    const runtimeAFromStream = buildRuntimeCommandStreamInput(
        sceneTileHeights,
        {
            levels: 1,
            sizeX: 1,
            sizeY: 1,
            unitsTileHeightBasis: 8,
        },
        commandStream,
    );

    assertI32ArrayEquals(runtimeAFromBuckets.cmdBucketIndices, [0, 1], "cmdBucketIndices");
    assertI32ArrayEquals(runtimeAFromBuckets.cmdOffsets, [12, 24], "cmdOffsets");
    assertI32ArrayEquals(runtimeAFromBuckets.cmdElements, [6, 3], "cmdElements");
    assertI32ArrayEquals(runtimeAFromBuckets.cmdInstanceCounts, [2, 1], "cmdInstanceCounts");
    assertI32ArrayEquals(
        runtimeAFromBuckets.cmdPackedInstances,
        [
            3200, 3201, -16, 0, 0, 1, 0, 100, 3202, 3203, -24, 1, 1, 2, 3, 101, 3210, 3211, 0, 2, 2,
            4, 1, 102,
        ],
        "cmdPackedInstances",
    );
    assertI32ArrayEquals(
        runtimeAFromStream.cmdBucketIndices,
        Array.from(runtimeAFromBuckets.cmdBucketIndices),
        "cmdBucketIndices stream",
    );
    assertI32ArrayEquals(
        runtimeAFromStream.cmdOffsets,
        Array.from(runtimeAFromBuckets.cmdOffsets),
        "cmdOffsets stream",
    );
    assertI32ArrayEquals(
        runtimeAFromStream.cmdElements,
        Array.from(runtimeAFromBuckets.cmdElements),
        "cmdElements stream",
    );
    assertI32ArrayEquals(
        runtimeAFromStream.cmdInstanceCounts,
        Array.from(runtimeAFromBuckets.cmdInstanceCounts),
        "cmdInstanceCounts stream",
    );
    assertI32ArrayEquals(
        runtimeAFromStream.cmdPackedInstances,
        Array.from(runtimeAFromBuckets.cmdPackedInstances),
        "cmdPackedInstances stream",
    );

    source.drawCommands[0].instances[0].sceneX = 9999;
    assert.equal(
        runtimeAFromBuckets.cmdPackedInstances[0],
        3200,
        "runtime output must be detached from source",
    );

    const bucketsB = collectRuntimeDrawCommandBuckets(source);
    const runtimeBFromBuckets = buildRuntimeCommandStreamInputFromBuckets(
        sceneTileHeights,
        {
            levels: 1,
            sizeX: 1,
            sizeY: 1,
            unitsTileHeightBasis: 8,
        },
        bucketsB,
    );
    assertI32ArrayEquals(
        runtimeBFromBuckets.cmdPackedInstances,
        [
            9999, 3201, -16, 0, 0, 1, 0, 100, 3202, 3203, -24, 1, 1, 2, 3, 101, 3210, 3211, 0, 2, 2,
            4, 1, 102,
        ],
        "runtime deterministic re-pack",
    );
}

async function main(): Promise<void> {
    runRegression();
    console.log("scene-command-builder-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
