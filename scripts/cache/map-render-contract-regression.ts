import assert from "node:assert/strict";

import type {
    MapRenderDataPayload,
    MapRenderScenePackInput,
} from "../../src/worker/MapRenderDataContract";
import { validateMapRenderPayload } from "../../src/worker/MapRenderDataContract";
import { __mapRenderBridgeInternals } from "../../public/wasm/rs_map_render_backend_bridge.mjs";

type DrawBucketKey =
    | "base"
    | "alpha"
    | "lod"
    | "lodAlpha"
    | "interact"
    | "interactAlpha"
    | "interactLod"
    | "interactLodAlpha";

const DRAW_BUCKET_KEYS: readonly DrawBucketKey[] = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
];

const EMPTY_MODEL_INFO_LENGTH = 64;

type BridgeInternals = {
    modelInfoLengthFromCounts(cmdCount: number, totalInstances: number): number;
    validateScenePackInput(
        scenePackInput: MapRenderScenePackInput,
        payload?: MapRenderDataPayload,
    ): string | undefined;
};

const bridgeInternals = __mapRenderBridgeInternals as BridgeInternals;

function createDrawRanges(
    base: ReadonlyArray<readonly [number, number, number]> = [],
): MapRenderDataPayload["drawRanges"] {
    return {
        base: base.map((r) => [r[0], r[1], r[2]]),
        alpha: [],
        lod: [],
        lodAlpha: [],
        interact: [],
        interactAlpha: [],
        interactLod: [],
        interactLodAlpha: [],
    };
}

function createModelInfoTextures(
    lengthByKey: Partial<Record<DrawBucketKey, number>> = {},
): MapRenderDataPayload["modelInfoTextures"] {
    return {
        base: new Uint16Array(lengthByKey.base ?? EMPTY_MODEL_INFO_LENGTH),
        alpha: new Uint16Array(lengthByKey.alpha ?? EMPTY_MODEL_INFO_LENGTH),
        lod: new Uint16Array(lengthByKey.lod ?? EMPTY_MODEL_INFO_LENGTH),
        lodAlpha: new Uint16Array(lengthByKey.lodAlpha ?? EMPTY_MODEL_INFO_LENGTH),
        interact: new Uint16Array(lengthByKey.interact ?? EMPTY_MODEL_INFO_LENGTH),
        interactAlpha: new Uint16Array(lengthByKey.interactAlpha ?? EMPTY_MODEL_INFO_LENGTH),
        interactLod: new Uint16Array(lengthByKey.interactLod ?? EMPTY_MODEL_INFO_LENGTH),
        interactLodAlpha: new Uint16Array(lengthByKey.interactLodAlpha ?? EMPTY_MODEL_INFO_LENGTH),
    };
}

function createPayload(overrides: Partial<MapRenderDataPayload> = {}): MapRenderDataPayload {
    const base: MapRenderDataPayload = {
        mapX: 50,
        mapY: 50,
        cacheName: "regression-cache",
        maxLevel: 0,
        loadObjs: true,
        loadNpcs: true,
        loadLocs: true,
        smoothTerrain: false,
        borderSize: 0,
        tileRenderFlags: [[new Uint8Array([0])]],
        collisionDatas: [],
        minimapBlob: new Blob(),
        vertices: new Uint8Array(0),
        indices: new Int32Array(0),
        modelInfoTextures: createModelInfoTextures(),
        heightMapTextureData: new Int16Array(1),
        drawRanges: createDrawRanges(),
        locsAnimated: [],
        npcs: [],
        usedTextureIds: new Int32Array(0),
        loadedTextures: [],
    };
    return {
        ...base,
        ...overrides,
    };
}

function createScenePackInput(
    overrides: Partial<MapRenderScenePackInput> = {},
): MapRenderScenePackInput {
    const bucketCmdCounts = new Int32Array(DRAW_BUCKET_KEYS.length);
    bucketCmdCounts[0] = 1;

    const bucketModelInfoLengths = new Int32Array(DRAW_BUCKET_KEYS.length);
    bucketModelInfoLengths.fill(EMPTY_MODEL_INFO_LENGTH);
    bucketModelInfoLengths[0] = bridgeInternals.modelInfoLengthFromCounts(1, 1);

    const base: MapRenderScenePackInput = {
        sceneTileHeights: new Int32Array(4),
        levels: 1,
        sizeX: 1,
        sizeY: 1,
        unitsTileHeightBasis: 8,
        bucketCmdCounts,
        bucketModelInfoLengths,
        cmdOffsets: new Int32Array([0]),
        cmdElements: new Int32Array([6]),
        cmdInstanceCounts: new Int32Array([1]),
        packedInstances: new Int32Array([3200, 3201, -16, 0, 0, 0, 0, 65535]),
    };
    return {
        ...base,
        ...overrides,
    };
}

function assertIncludes(haystack: string, needle: string): void {
    assert.ok(
        haystack.includes(needle),
        `expected "${haystack}" to include "${needle}"`,
    );
}

function runContractValidationChecks(): void {
    const validPayload = createPayload();
    assert.deepEqual(validateMapRenderPayload(validPayload), [], "expected valid payload");

    const wrongModelInfoPayload = createPayload({
        drawRanges: createDrawRanges([[0, 0, 33]]),
        modelInfoTextures: createModelInfoTextures({ base: EMPTY_MODEL_INFO_LENGTH }),
    });
    const modelInfoIssues = validateMapRenderPayload(wrongModelInfoPayload);
    assert.ok(modelInfoIssues.length > 0, "expected model info mismatch issue");
    assertIncludes(modelInfoIssues[0], "modelInfoTextures.base length mismatch");

    const wrongHeightMapPayload = createPayload({
        heightMapTextureData: new Int16Array(0),
    });
    const heightMapIssues = validateMapRenderPayload(wrongHeightMapPayload);
    assert.ok(heightMapIssues.length > 0, "expected height map mismatch issue");
    assertIncludes(heightMapIssues[0], "heightMapTextureData length mismatch");
}

function runBridgeValidationChecks(): void {
    const payload = createPayload();
    const scenePackInput = createScenePackInput();

    assert.equal(
        bridgeInternals.validateScenePackInput(scenePackInput, payload),
        undefined,
        "expected valid scene-pack input",
    );
    assert.equal(
        bridgeInternals.modelInfoLengthFromCounts(1, 1),
        64,
        "expected model info length rounding parity",
    );

    const brokenBucketCounts = createScenePackInput({
        bucketCmdCounts: new Int32Array(DRAW_BUCKET_KEYS.length - 1),
    });
    const brokenBucketCountsError = bridgeInternals.validateScenePackInput(
        brokenBucketCounts,
        payload,
    );
    assert.ok(brokenBucketCountsError, "expected invalid bucket count error");
    assertIncludes(
        brokenBucketCountsError,
        "scenePackInput.bucketCmdCounts length mismatch",
    );

    const brokenModelInfo = createScenePackInput({
        bucketModelInfoLengths: new Int32Array([
            65,
            EMPTY_MODEL_INFO_LENGTH,
            EMPTY_MODEL_INFO_LENGTH,
            EMPTY_MODEL_INFO_LENGTH,
            EMPTY_MODEL_INFO_LENGTH,
            EMPTY_MODEL_INFO_LENGTH,
            EMPTY_MODEL_INFO_LENGTH,
            EMPTY_MODEL_INFO_LENGTH,
        ]),
    });
    const brokenModelInfoError = bridgeInternals.validateScenePackInput(brokenModelInfo, payload);
    assert.ok(brokenModelInfoError, "expected invalid model-info length error");
    assertIncludes(
        brokenModelInfoError,
        "scenePackInput.bucketModelInfoLengths[0] mismatch",
    );

    const brokenPackedInstances = createScenePackInput({
        packedInstances: new Int32Array([3200, 3201, -16, 0]),
    });
    const brokenPackedInstancesError = bridgeInternals.validateScenePackInput(
        brokenPackedInstances,
        payload,
    );
    assert.ok(brokenPackedInstancesError, "expected invalid packed instance length error");
    assertIncludes(
        brokenPackedInstancesError,
        "scenePackInput.packedInstances length mismatch",
    );

    const payloadSizeMismatch = createScenePackInput({
        sizeX: 2,
        sceneTileHeights: new Int32Array(6),
    });
    const payloadSizeMismatchError = bridgeInternals.validateScenePackInput(
        payloadSizeMismatch,
        payload,
    );
    assert.ok(payloadSizeMismatchError, "expected payload/scene-pack size mismatch");
    assertIncludes(payloadSizeMismatchError, "scenePackInput.sizeX mismatch");
}

async function main(): Promise<void> {
    runContractValidationChecks();
    runBridgeValidationChecks();
    console.log("map-render-contract-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
