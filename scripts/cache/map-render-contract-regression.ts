import assert from "node:assert/strict";

import type {
    MapRenderCommandStreamRuntimeInput,
    MapRenderDataPayload,
    MapRenderRuntimePacket,
} from "../../src/worker/MapRenderDataContract";
import {
    payloadToScaffold,
    runtimePacketToPayload,
    validateMapRenderPayload,
} from "../../src/worker/MapRenderDataContract";
import { validateCommandStreamRuntimeInput } from "../../src/worker/MapRenderRuntimeInputValidation";

type DrawBucketKey =
    | "base"
    | "alpha"
    | "lod"
    | "lodAlpha"
    | "interact"
    | "interactAlpha"
    | "interactLod"
    | "interactLodAlpha";

const EMPTY_MODEL_INFO_LENGTH = 64;

function createDrawRanges(
    base: ReadonlyArray<readonly [number, number, number]> = [],
): MapRenderDataPayload["drawRanges"] {
    const packedBase = new Int32Array(base.length * 3);
    for (let i = 0; i < base.length; i++) {
        const off = i * 3;
        packedBase[off + 0] = base[i][0] | 0;
        packedBase[off + 1] = base[i][1] | 0;
        packedBase[off + 2] = base[i][2] | 0;
    }
    return {
        base: packedBase,
        alpha: new Int32Array(0),
        lod: new Int32Array(0),
        lodAlpha: new Int32Array(0),
        interact: new Int32Array(0),
        interactAlpha: new Int32Array(0),
        interactLod: new Int32Array(0),
        interactLodAlpha: new Int32Array(0),
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
        vertices: new Uint8Array(16),
        indices: new Int32Array(64),
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

function createRuntimeCommandStreamInput(
    overrides: Partial<MapRenderCommandStreamRuntimeInput> = {},
): MapRenderCommandStreamRuntimeInput {
    const base: MapRenderCommandStreamRuntimeInput = {
        sceneTileHeights: new Int32Array(4),
        levels: 1,
        sizeX: 1,
        sizeY: 1,
        unitsTileHeightBasis: 8,
        cmdBucketIndices: Int32Array.from([0]),
        cmdOffsets: Int32Array.from([0]),
        cmdElements: Int32Array.from([6]),
        cmdInstanceCounts: Int32Array.from([1]),
        cmdPackedInstances: Int32Array.from([3200, 3201, -16, 0, 0, 0, 0, 65535]),
    };
    return {
        ...base,
        ...overrides,
    };
}

function assertIncludes(haystack: string, needle: string): void {
    assert.ok(haystack.includes(needle), `expected "${haystack}" to include "${needle}"`);
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

function runRuntimePacketPayloadChecks(): void {
    const scaffoldPayload = createPayload({
        vertices: new Uint8Array([11, 22, 33, 44]),
        indices: new Int32Array([7, 8, 9]),
    });
    const scaffold = payloadToScaffold(scaffoldPayload);

    const packetBase: MapRenderRuntimePacket = {
        packetVersion: 1,
        bucketCmdCounts: new Int32Array(8),
        bucketModelInfoLengths: new Int32Array(8),
        drawRangesPacked: new Int32Array(0),
        modelInfoTextureBuckets: [
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
            new Uint16Array(0),
        ],
        heightMapTextureData: new Int16Array(1),
        vertices: new Uint8Array(0),
        indices: new Int32Array(0),
        levels: 1,
        sizeX: 1,
        sizeY: 1,
        unitsTileHeightBasis: 8,
        totalModelInfoLength: 0,
    };

    const payloadFallback = runtimePacketToPayload(packetBase, scaffold);
    assert.ok(payloadFallback, "expected runtime packet payload fallback");
    assert.equal(
        payloadFallback?.vertices,
        scaffold.vertices,
        "expected scaffold vertices fallback",
    );
    assert.equal(payloadFallback?.indices, scaffold.indices, "expected scaffold indices fallback");

    const strictPayloadFallback = runtimePacketToPayload(packetBase, scaffold, {
        requirePacketGeometry: true,
    });
    assert.equal(
        strictPayloadFallback,
        undefined,
        "expected strict runtime packet conversion to reject missing geometry",
    );

    const packetWithGeometry: MapRenderRuntimePacket = {
        ...packetBase,
        vertices: new Uint8Array([1, 2, 3, 4]),
        indices: new Int32Array([0, 1, 2]),
    };
    const payloadWithGeometry = runtimePacketToPayload(packetWithGeometry, scaffold);
    assert.ok(payloadWithGeometry, "expected runtime packet payload with geometry");
    assert.notEqual(
        payloadWithGeometry?.vertices,
        scaffold.vertices,
        "expected packet vertices copy to replace scaffold",
    );
    assert.notEqual(
        payloadWithGeometry?.indices,
        scaffold.indices,
        "expected packet indices copy to replace scaffold",
    );
    assert.deepEqual(
        Array.from(payloadWithGeometry?.vertices ?? []),
        [1, 2, 3, 4],
        "expected packet vertices data",
    );
    assert.deepEqual(
        Array.from(payloadWithGeometry?.indices ?? []),
        [0, 1, 2],
        "expected packet indices data",
    );
}

function runBridgeValidationChecks(): void {
    const payload = createPayload();
    const runtimeCommandStreamInput = createRuntimeCommandStreamInput();

    assert.equal(
        validateCommandStreamRuntimeInput(runtimeCommandStreamInput, payload),
        undefined,
        "expected valid runtime command stream input",
    );

    const badCommandStreamBuckets = createRuntimeCommandStreamInput({
        cmdBucketIndices: Int32Array.from([8]),
    });
    const badCommandStreamBucketsError = validateCommandStreamRuntimeInput(
        badCommandStreamBuckets,
        payload,
    );
    assert.ok(badCommandStreamBucketsError, "expected command stream bucket mismatch");
    assertIncludes(badCommandStreamBucketsError, "cmdBucketIndices[0] out of range");

    const badCommandStreamPackedLength = createRuntimeCommandStreamInput({
        cmdPackedInstances: new Int32Array(0),
    });
    const badCommandStreamPackedLengthError = validateCommandStreamRuntimeInput(
        badCommandStreamPackedLength,
        payload,
    );
    assert.ok(badCommandStreamPackedLengthError, "expected command stream packed length mismatch");
    assertIncludes(badCommandStreamPackedLengthError, "cmdPackedInstances length mismatch");
}

async function main(): Promise<void> {
    runContractValidationChecks();
    runRuntimePacketPayloadChecks();
    runBridgeValidationChecks();
    console.log("map-render-contract-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
