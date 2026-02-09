import assert from "node:assert/strict";

import type {
    MapRenderDataPayload,
    MapRenderDataStaging,
    StagingDrawCommand,
    StagingDrawCommandBuckets,
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

type BridgeInternals = {
    modelInfoLengthFromDrawCommands(drawCommands: ReadonlyArray<StagingDrawCommand>): number;
    validateStagingAgainstPayload(payload: MapRenderDataPayload): string | undefined;
    validateStagingDrawCommands(staging: MapRenderDataStaging): string | undefined;
};

const bridgeInternals = __mapRenderBridgeInternals as BridgeInternals;

function createDrawCommands(): StagingDrawCommandBuckets {
    return {
        base: [
            {
                offset: 0,
                elements: 6,
                instances: [
                    {
                        sceneX: 3200,
                        sceneZ: 3201,
                        heightOffset: -16,
                        level: 0,
                        contourGround: 0,
                        priority: 0,
                        interactType: 0,
                        interactId: 65535,
                    },
                ],
            },
        ],
        alpha: [],
        lod: [],
        lodAlpha: [],
        interact: [],
        interactAlpha: [],
        interactLod: [],
        interactLodAlpha: [],
    };
}

function createDrawRanges(sizeByKey: Partial<Record<DrawBucketKey, number>> = {}) {
    return {
        base: new Array(sizeByKey.base ?? 0).fill([0, 0, 0]),
        alpha: new Array(sizeByKey.alpha ?? 0).fill([0, 0, 0]),
        lod: new Array(sizeByKey.lod ?? 0).fill([0, 0, 0]),
        lodAlpha: new Array(sizeByKey.lodAlpha ?? 0).fill([0, 0, 0]),
        interact: new Array(sizeByKey.interact ?? 0).fill([0, 0, 0]),
        interactAlpha: new Array(sizeByKey.interactAlpha ?? 0).fill([0, 0, 0]),
        interactLod: new Array(sizeByKey.interactLod ?? 0).fill([0, 0, 0]),
        interactLodAlpha: new Array(sizeByKey.interactLodAlpha ?? 0).fill([0, 0, 0]),
    } as MapRenderDataPayload["drawRanges"];
}

function createModelInfoTextures(lengthByKey: Partial<Record<DrawBucketKey, number>> = {}) {
    return {
        base: new Uint16Array(lengthByKey.base ?? 0),
        alpha: new Uint16Array(lengthByKey.alpha ?? 0),
        lod: new Uint16Array(lengthByKey.lod ?? 0),
        lodAlpha: new Uint16Array(lengthByKey.lodAlpha ?? 0),
        interact: new Uint16Array(lengthByKey.interact ?? 0),
        interactAlpha: new Uint16Array(lengthByKey.interactAlpha ?? 0),
        interactLod: new Uint16Array(lengthByKey.interactLod ?? 0),
        interactLodAlpha: new Uint16Array(lengthByKey.interactLodAlpha ?? 0),
    } as MapRenderDataPayload["modelInfoTextures"];
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

function assertIncludes(haystack: string, needle: string): void {
    assert.ok(
        haystack.includes(needle),
        `expected "${haystack}" to include "${needle}"`,
    );
}

function runContractValidationChecks(): void {
    const drawCommands = createDrawCommands();
    const stagedPayload = createPayload({
        staging: {
            sceneTileHeights: new Int32Array(4),
            levels: 1,
            sizeX: 1,
            sizeY: 1,
            unitsTileHeightBasis: 8,
            drawCommands,
        },
        drawRanges: createDrawRanges(),
        modelInfoTextures: createModelInfoTextures(),
    });
    assert.deepEqual(
        validateMapRenderPayload(stagedPayload),
        [],
        "staged payload with placeholder draw/model buffers should validate",
    );

    const wrongDrawRangeCountPayload = createPayload({
        staging: stagedPayload.staging,
        drawRanges: createDrawRanges({ base: 2 }),
        modelInfoTextures: createModelInfoTextures(),
    });
    const drawRangeIssues = validateMapRenderPayload(wrongDrawRangeCountPayload);
    assert.ok(drawRangeIssues.length > 0, "expected draw range mismatch issue");
    assertIncludes(drawRangeIssues[0], "drawRanges.base length mismatch");

    const wrongModelInfoLengthPayload = createPayload({
        staging: stagedPayload.staging,
        drawRanges: createDrawRanges(),
        modelInfoTextures: createModelInfoTextures({ base: 5 }),
    });
    const modelInfoIssues = validateMapRenderPayload(wrongModelInfoLengthPayload);
    assert.ok(modelInfoIssues.length > 0, "expected model info mismatch issue");
    assertIncludes(modelInfoIssues[0], "modelInfoTextures.base length mismatch");

    const nonStagingPayload = createPayload({
        drawRanges: createDrawRanges({ base: 1 }),
        modelInfoTextures: createModelInfoTextures({ base: 5 }),
    });
    const nonStagingIssues = validateMapRenderPayload(nonStagingPayload);
    assert.ok(nonStagingIssues.length > 0, "expected non-staging model info mismatch");
    assertIncludes(nonStagingIssues[0], "modelInfoTextures.base length mismatch");
}

function runBridgeValidationChecks(): void {
    const drawCommands = createDrawCommands();
    const payload = createPayload({
        staging: {
            sceneTileHeights: new Int32Array(4),
            levels: 1,
            sizeX: 1,
            sizeY: 1,
            unitsTileHeightBasis: 8,
            drawCommands,
        },
        drawRanges: createDrawRanges(),
        modelInfoTextures: createModelInfoTextures(),
    });
    assert.equal(
        bridgeInternals.validateStagingAgainstPayload(payload),
        undefined,
        "expected valid staging payload",
    );
    assert.equal(
        bridgeInternals.validateStagingDrawCommands(payload.staging!),
        undefined,
        "expected valid draw command buckets",
    );
    assert.equal(
        bridgeInternals.modelInfoLengthFromDrawCommands(drawCommands.base),
        64,
        "expected model info length rounding parity",
    );

    const brokenBucketPayload = createPayload({
        staging: {
            ...payload.staging!,
            drawCommands: {
                ...drawCommands,
                base: undefined as unknown as ReadonlyArray<StagingDrawCommand>,
            },
        },
    });
    const brokenBucketError = bridgeInternals.validateStagingAgainstPayload(brokenBucketPayload);
    assert.ok(brokenBucketError, "expected broken bucket validation error");
    assertIncludes(brokenBucketError, "drawCommands.base must be an array");

    const brokenInstancePayload = createPayload({
        staging: {
            ...payload.staging!,
            drawCommands: {
                ...drawCommands,
                base: [
                    {
                        ...drawCommands.base[0],
                        instances: [
                            {
                                ...drawCommands.base[0].instances[0],
                                sceneX: Number.NaN,
                            },
                        ],
                    },
                ],
            },
        },
    });
    const brokenInstanceError = bridgeInternals.validateStagingAgainstPayload(brokenInstancePayload);
    assert.ok(brokenInstanceError, "expected broken instance validation error");
    assertIncludes(brokenInstanceError, "contains non-numeric fields");

    const drawRangeMismatchPayload = createPayload({
        staging: payload.staging,
        drawRanges: createDrawRanges({ base: 2 }),
        modelInfoTextures: createModelInfoTextures(),
    });
    const drawRangeMismatchError = bridgeInternals.validateStagingAgainstPayload(
        drawRangeMismatchPayload,
    );
    assert.ok(drawRangeMismatchError, "expected draw range mismatch validation error");
    assertIncludes(drawRangeMismatchError, "drawRanges.base length mismatch");

    const modelInfoMismatchPayload = createPayload({
        staging: payload.staging,
        drawRanges: createDrawRanges(),
        modelInfoTextures: createModelInfoTextures({ base: 5 }),
    });
    const modelInfoMismatchError = bridgeInternals.validateStagingAgainstPayload(
        modelInfoMismatchPayload,
    );
    assert.ok(modelInfoMismatchError, "expected model info mismatch validation error");
    assertIncludes(modelInfoMismatchError, "modelInfoTextures.base length mismatch");
}

function checkDrawBucketCoverage(): void {
    const drawCommands = createDrawCommands();
    for (const key of DRAW_BUCKET_KEYS) {
        assert.ok(Array.isArray(drawCommands[key]), `missing draw command bucket "${key}"`);
    }
}

async function main(): Promise<void> {
    checkDrawBucketCoverage();
    runContractValidationChecks();
    runBridgeValidationChecks();
    console.log("map-render-contract-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
