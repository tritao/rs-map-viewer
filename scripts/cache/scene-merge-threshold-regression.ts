import assert from "node:assert/strict";

import { decideSceneModelMergeStrategy } from "../../src/runtime/build/SceneBuffer";

function runRegression(): void {
    assert.deepEqual(
        decideSceneModelMergeStrategy(1, 500, 500, false),
        { mergeOpaque: true, mergeTransparent: true },
        "single instance always merged",
    );

    assert.deepEqual(
        decideSceneModelMergeStrategy(2, 49, 49, false),
        { mergeOpaque: true, mergeTransparent: true },
        "strict threshold is less than 100",
    );

    assert.deepEqual(
        decideSceneModelMergeStrategy(2, 50, 50, false),
        { mergeOpaque: false, mergeTransparent: false },
        "boundary 100 does not merge",
    );

    assert.deepEqual(
        decideSceneModelMergeStrategy(2, 50, 10, false),
        { mergeOpaque: false, mergeTransparent: true },
        "opaque/transparent decisions are independent",
    );

    assert.deepEqual(
        decideSceneModelMergeStrategy(20, 500, 500, true),
        { mergeOpaque: true, mergeTransparent: true },
        "minimize draw calls forces merge",
    );
}

async function main(): Promise<void> {
    runRegression();
    console.log("scene-merge-threshold-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
