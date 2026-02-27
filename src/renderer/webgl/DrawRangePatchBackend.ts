import { mapRenderRuntimeBridge } from "../../wasm/rs_map_render_backend_bridge.mjs";

type DrawRangePatchBridge = Readonly<{
    initRuntime(): Promise<boolean>;
    createRuntimeWithConfig(
        config: Readonly<{
            cacheGame: number;
            cacheRevision: number;
            sceneLevels: number;
            unitsTileHeightBasis: number;
        }>,
    ): Promise<number | undefined>;
    destroyRuntime(runtimeHandle: number): void;
    resetRuntime(runtimeHandle: number): void;
    setTickState(runtimeHandle: number, stateKey: number, input: DrawRangeTickStateInput): boolean;
    clearTickState(runtimeHandle: number, stateKey: number): void;
    tickAdvanceAndEmitBasePatchesForState(
        runtimeHandle: number,
        stateKey: number,
        cycleNowFixed: number,
        clientTickCount: number,
    ):
        | {
              locBasePatchCount: number;
              locAlphaPatchCount: number;
              locLodPatchCount: number;
              locLodAlphaPatchCount: number;
              locInteractPatchCount: number;
              locInteractAlphaPatchCount: number;
              locInteractLodPatchCount: number;
              locInteractLodAlphaPatchCount: number;
              npcBasePatchCount: number;
              npcAlphaPatchCount: number;
          }
        | undefined;
}>;

export type DrawRangeTickStateInput = Readonly<{
    locFrameIds: Int32Array;
    locCycleStartsFixed: Int32Array;
    locFrameSteps: Int32Array;
    locHasAnimMaya: Int32Array;
    locAnimMayaDurations: Int32Array;
    locFrameLengthOffsets: Int32Array;
    locFrameLengthCounts: Int32Array;
    locSeqIds?: Int32Array;
    locFrameLengthsPacked: Int32Array;
    locOutActiveFlags: Int32Array;
    locDrawRangeIndicesBase: Int32Array;
    locAnimFrameOffsetsBase: Int32Array;
    locAnimFrameCountsBase: Int32Array;
    locAnimFramesBasePacked: Int32Array;
    outLocPatchesPacked: Int32Array;
    locDrawRangeIndicesAlpha: Int32Array;
    locDrawRangeIndicesLod: Int32Array;
    locDrawRangeIndicesLodAlpha: Int32Array;
    locDrawRangeIndicesInteract: Int32Array;
    locDrawRangeIndicesInteractAlpha: Int32Array;
    locDrawRangeIndicesInteractLod: Int32Array;
    locDrawRangeIndicesInteractLodAlpha: Int32Array;
    locAnimFrameOffsetsAlpha: Int32Array;
    locAnimFrameCountsAlpha: Int32Array;
    locAnimFramesAlphaPacked: Int32Array;
    outLocAlphaPatchesPacked: Int32Array;
    outLocLodPatchesPacked: Int32Array;
    outLocLodAlphaPatchesPacked: Int32Array;
    outLocInteractPatchesPacked: Int32Array;
    outLocInteractAlphaPatchesPacked: Int32Array;
    outLocInteractLodPatchesPacked: Int32Array;
    outLocInteractLodAlphaPatchesPacked: Int32Array;

    npcX: Int32Array;
    npcY: Int32Array;
    npcOrientation: Int32Array;
    npcRotation: Int32Array;
    npcPathLength: Int32Array;
    npcMovementSeqId: Int32Array;
    npcPathXPacked: Int32Array;
    npcPathYPacked: Int32Array;
    npcPathMovementTypePacked: Int32Array;
    npcSize: Int32Array;
    npcIsClickable: Int32Array;
    npcRotationSpeed: Int32Array;
    npcIdleSeqId: Int32Array;
    npcWalkSeqId: Int32Array;
    npcHasWalkAnim: Int32Array;
    npcFrameIds: Int32Array;
    npcFrameTicks: Int32Array;
    npcMovementLoops: Int32Array;
    npcIdleSeqValid: Int32Array;
    npcIdleSeqHasAnimMaya: Int32Array;
    npcIdleSeqAnimMayaDurations: Int32Array;
    npcIdleSeqFrameSteps: Int32Array;
    npcIdleSeqLooping: Int32Array;
    npcIdleSeqMaxLoops: Int32Array;
    npcIdleSeqFrameIdCounts: Int32Array;
    npcIdleSeqFrameLengthOffsets: Int32Array;
    npcIdleSeqFrameLengthCounts: Int32Array;
    npcWalkSeqValid: Int32Array;
    npcWalkSeqHasAnimMaya: Int32Array;
    npcWalkSeqAnimMayaDurations: Int32Array;
    npcWalkSeqFrameSteps: Int32Array;
    npcWalkSeqLooping: Int32Array;
    npcWalkSeqMaxLoops: Int32Array;
    npcWalkSeqFrameIdCounts: Int32Array;
    npcWalkSeqFrameLengthOffsets: Int32Array;
    npcWalkSeqFrameLengthCounts: Int32Array;
    npcSeqFrameLengthsPacked: Int32Array;
    npcDrawRangeIndices: Int32Array;
    npcIdleAnimFrameOffsetsBase: Int32Array;
    npcIdleAnimFrameCountsBase: Int32Array;
    npcWalkAnimFrameOffsetsBase: Int32Array;
    npcWalkAnimFrameCountsBase: Int32Array;
    npcAnimFramesBasePacked: Int32Array;
    outNpcPatchesPacked: Int32Array;
    npcIdleAnimFrameOffsetsAlpha: Int32Array;
    npcIdleAnimFrameCountsAlpha: Int32Array;
    npcWalkAnimFrameOffsetsAlpha: Int32Array;
    npcWalkAnimFrameCountsAlpha: Int32Array;
    npcAnimFramesAlphaPacked: Int32Array;
    npcNullAlphaFrameOffset: number;
    outNpcAlphaPatchesPacked: Int32Array;
}>;

const bridge = mapRenderRuntimeBridge as unknown as DrawRangePatchBridge;
let runtimeReady = false;
let runtimeHandle: number | undefined;
const registeredTickStateKeys = new Set<number>();

function summarizeI32(
    name: string,
    a: Int32Array | undefined,
): Readonly<{ name: string; len: number; prefix: number[] }> {
    if (!(a instanceof Int32Array)) {
        return { name, len: -1, prefix: [] };
    }
    const prefixLen = Math.min(a.length, 8);
    const prefix: number[] = [];
    for (let i = 0; i < prefixLen; i++) prefix.push(a[i] | 0);
    return { name, len: a.length | 0, prefix };
}

function validateEqLen(issues: string[], name: string, a: Int32Array, expected: number): void {
    if (!(a instanceof Int32Array)) {
        issues.push(`${name} must be Int32Array`);
        return;
    }
    if ((a.length | 0) !== (expected | 0)) {
        issues.push(`${name} length mismatch expected=${expected | 0} got=${a.length | 0}`);
    }
}

function validatePackedSlices(
    issues: string[],
    packedName: string,
    packed: Int32Array,
    offsetsName: string,
    offsets: Int32Array,
    countsName: string,
    counts: Int32Array,
    stride: number,
): void {
    if (!(packed instanceof Int32Array)) {
        issues.push(`${packedName} must be Int32Array`);
        return;
    }
    if (!(offsets instanceof Int32Array) || !(counts instanceof Int32Array)) {
        issues.push(`${offsetsName}/${countsName} must be Int32Array`);
        return;
    }
    if (offsets.length !== counts.length) {
        issues.push(
            `${offsetsName}/${countsName} length mismatch offsets=${offsets.length} counts=${counts.length}`,
        );
        return;
    }
    const packedLen = packed.length | 0;
    for (let i = 0; i < offsets.length; i++) {
        const off = offsets[i] | 0;
        const cnt = counts[i] | 0;
        if (cnt < 0) {
            issues.push(`${countsName}[${i}] negative cnt=${cnt}`);
            break;
        }
        if (cnt === 0) {
            if (off !== -1) {
                issues.push(`${offsetsName}[${i}] expected -1 when count=0 (got=${off})`);
                break;
            }
            continue;
        }
        if (off < 0) {
            issues.push(`${offsetsName}[${i}] negative off=${off} cnt=${cnt}`);
            break;
        }
        if (stride > 1 && off % stride !== 0) {
            issues.push(`${offsetsName}[${i}] not stride-aligned off=${off} stride=${stride}`);
            break;
        }
        const end = off + cnt * stride;
        if (end < off || end > packedLen) {
            issues.push(
                `${packedName} slice OOB at i=${i} off=${off} cnt=${cnt} stride=${stride} packedLen=${packedLen}`,
            );
            break;
        }
    }
}

function validatePatchBuffers(
    issues: string[],
    name: string,
    packed: Int32Array,
    expectedCount: number,
): void {
    if (!(packed instanceof Int32Array)) {
        issues.push(`${name} must be Int32Array`);
        return;
    }
    const expectedLen = (expectedCount | 0) * 4;
    if ((packed.length | 0) !== expectedLen) {
        issues.push(`${name} length mismatch expected=${expectedLen} got=${packed.length | 0}`);
    }
}

function validateTickStateInput(input: DrawRangeTickStateInput): string[] {
    const issues: string[] = [];

    const locCount = input.locFrameIds instanceof Int32Array ? input.locFrameIds.length | 0 : -1;
    const npcCount = input.npcX instanceof Int32Array ? input.npcX.length | 0 : -1;

    if (locCount < 0) {
        issues.push(`locFrameIds must be Int32Array`);
    } else {
        validateEqLen(issues, "locCycleStartsFixed", input.locCycleStartsFixed, locCount);
        validateEqLen(issues, "locFrameSteps", input.locFrameSteps, locCount);
        validateEqLen(issues, "locHasAnimMaya", input.locHasAnimMaya, locCount);
        validateEqLen(issues, "locAnimMayaDurations", input.locAnimMayaDurations, locCount);
        validateEqLen(issues, "locFrameLengthOffsets", input.locFrameLengthOffsets, locCount);
        validateEqLen(issues, "locFrameLengthCounts", input.locFrameLengthCounts, locCount);
        if (input.locSeqIds !== undefined) {
            validateEqLen(issues, "locSeqIds", input.locSeqIds, locCount);
        }
        validateEqLen(issues, "locOutActiveFlags", input.locOutActiveFlags, locCount);

        validateEqLen(issues, "locDrawRangeIndicesBase", input.locDrawRangeIndicesBase, locCount);
        validateEqLen(issues, "locDrawRangeIndicesAlpha", input.locDrawRangeIndicesAlpha, locCount);
        validateEqLen(issues, "locDrawRangeIndicesLod", input.locDrawRangeIndicesLod, locCount);
        validateEqLen(
            issues,
            "locDrawRangeIndicesLodAlpha",
            input.locDrawRangeIndicesLodAlpha,
            locCount,
        );
        validateEqLen(
            issues,
            "locDrawRangeIndicesInteract",
            input.locDrawRangeIndicesInteract,
            locCount,
        );
        validateEqLen(
            issues,
            "locDrawRangeIndicesInteractAlpha",
            input.locDrawRangeIndicesInteractAlpha,
            locCount,
        );
        validateEqLen(
            issues,
            "locDrawRangeIndicesInteractLod",
            input.locDrawRangeIndicesInteractLod,
            locCount,
        );
        validateEqLen(
            issues,
            "locDrawRangeIndicesInteractLodAlpha",
            input.locDrawRangeIndicesInteractLodAlpha,
            locCount,
        );

        validateEqLen(issues, "locAnimFrameOffsetsBase", input.locAnimFrameOffsetsBase, locCount);
        validateEqLen(issues, "locAnimFrameCountsBase", input.locAnimFrameCountsBase, locCount);
        validateEqLen(issues, "locAnimFrameOffsetsAlpha", input.locAnimFrameOffsetsAlpha, locCount);
        validateEqLen(issues, "locAnimFrameCountsAlpha", input.locAnimFrameCountsAlpha, locCount);

        validatePatchBuffers(issues, "outLocPatchesPacked", input.outLocPatchesPacked, locCount);
        validatePatchBuffers(
            issues,
            "outLocAlphaPatchesPacked",
            input.outLocAlphaPatchesPacked,
            locCount,
        );
        validatePatchBuffers(
            issues,
            "outLocLodPatchesPacked",
            input.outLocLodPatchesPacked,
            locCount,
        );
        validatePatchBuffers(
            issues,
            "outLocLodAlphaPatchesPacked",
            input.outLocLodAlphaPatchesPacked,
            locCount,
        );
        validatePatchBuffers(
            issues,
            "outLocInteractPatchesPacked",
            input.outLocInteractPatchesPacked,
            locCount,
        );
        validatePatchBuffers(
            issues,
            "outLocInteractAlphaPatchesPacked",
            input.outLocInteractAlphaPatchesPacked,
            locCount,
        );
        validatePatchBuffers(
            issues,
            "outLocInteractLodPatchesPacked",
            input.outLocInteractLodPatchesPacked,
            locCount,
        );
        validatePatchBuffers(
            issues,
            "outLocInteractLodAlphaPatchesPacked",
            input.outLocInteractLodAlphaPatchesPacked,
            locCount,
        );

        validatePackedSlices(
            issues,
            "locAnimFramesBasePacked",
            input.locAnimFramesBasePacked,
            "locAnimFrameOffsetsBase",
            input.locAnimFrameOffsetsBase,
            "locAnimFrameCountsBase",
            input.locAnimFrameCountsBase,
            3,
        );
        validatePackedSlices(
            issues,
            "locAnimFramesAlphaPacked",
            input.locAnimFramesAlphaPacked,
            "locAnimFrameOffsetsAlpha",
            input.locAnimFrameOffsetsAlpha,
            "locAnimFrameCountsAlpha",
            input.locAnimFrameCountsAlpha,
            3,
        );
        validatePackedSlices(
            issues,
            "locFrameLengthsPacked",
            input.locFrameLengthsPacked,
            "locFrameLengthOffsets",
            input.locFrameLengthOffsets,
            "locFrameLengthCounts",
            input.locFrameLengthCounts,
            1,
        );
    }

    if (npcCount < 0) {
        issues.push(`npcX must be Int32Array`);
    } else {
        validateEqLen(issues, "npcY", input.npcY, npcCount);
        validateEqLen(issues, "npcOrientation", input.npcOrientation, npcCount);
        validateEqLen(issues, "npcRotation", input.npcRotation, npcCount);
        validateEqLen(issues, "npcPathLength", input.npcPathLength, npcCount);
        validateEqLen(issues, "npcMovementSeqId", input.npcMovementSeqId, npcCount);
        validateEqLen(issues, "npcSize", input.npcSize, npcCount);
        validateEqLen(issues, "npcIsClickable", input.npcIsClickable, npcCount);
        validateEqLen(issues, "npcRotationSpeed", input.npcRotationSpeed, npcCount);
        validateEqLen(issues, "npcIdleSeqId", input.npcIdleSeqId, npcCount);
        validateEqLen(issues, "npcWalkSeqId", input.npcWalkSeqId, npcCount);
        validateEqLen(issues, "npcHasWalkAnim", input.npcHasWalkAnim, npcCount);

        if (input.npcPathXPacked.length !== npcCount * 10) {
            issues.push(
                `npcPathXPacked length mismatch expected=${npcCount * 10} got=${
                    input.npcPathXPacked.length
                }`,
            );
        }
        if (input.npcPathYPacked.length !== npcCount * 10) {
            issues.push(
                `npcPathYPacked length mismatch expected=${npcCount * 10} got=${
                    input.npcPathYPacked.length
                }`,
            );
        }
        if (input.npcPathMovementTypePacked.length !== npcCount * 10) {
            issues.push(
                `npcPathMovementTypePacked length mismatch expected=${npcCount * 10} got=${
                    input.npcPathMovementTypePacked.length
                }`,
            );
        }

        validateEqLen(issues, "npcFrameIds", input.npcFrameIds, npcCount);
        validateEqLen(issues, "npcFrameTicks", input.npcFrameTicks, npcCount);
        validateEqLen(issues, "npcMovementLoops", input.npcMovementLoops, npcCount);

        validateEqLen(issues, "npcIdleSeqValid", input.npcIdleSeqValid, npcCount);
        validateEqLen(issues, "npcIdleSeqHasAnimMaya", input.npcIdleSeqHasAnimMaya, npcCount);
        validateEqLen(
            issues,
            "npcIdleSeqAnimMayaDurations",
            input.npcIdleSeqAnimMayaDurations,
            npcCount,
        );
        validateEqLen(issues, "npcIdleSeqFrameSteps", input.npcIdleSeqFrameSteps, npcCount);
        validateEqLen(issues, "npcIdleSeqLooping", input.npcIdleSeqLooping, npcCount);
        validateEqLen(issues, "npcIdleSeqMaxLoops", input.npcIdleSeqMaxLoops, npcCount);
        validateEqLen(issues, "npcIdleSeqFrameIdCounts", input.npcIdleSeqFrameIdCounts, npcCount);
        validateEqLen(
            issues,
            "npcIdleSeqFrameLengthOffsets",
            input.npcIdleSeqFrameLengthOffsets,
            npcCount,
        );
        validateEqLen(
            issues,
            "npcIdleSeqFrameLengthCounts",
            input.npcIdleSeqFrameLengthCounts,
            npcCount,
        );

        validateEqLen(issues, "npcWalkSeqValid", input.npcWalkSeqValid, npcCount);
        validateEqLen(issues, "npcWalkSeqHasAnimMaya", input.npcWalkSeqHasAnimMaya, npcCount);
        validateEqLen(
            issues,
            "npcWalkSeqAnimMayaDurations",
            input.npcWalkSeqAnimMayaDurations,
            npcCount,
        );
        validateEqLen(issues, "npcWalkSeqFrameSteps", input.npcWalkSeqFrameSteps, npcCount);
        validateEqLen(issues, "npcWalkSeqLooping", input.npcWalkSeqLooping, npcCount);
        validateEqLen(issues, "npcWalkSeqMaxLoops", input.npcWalkSeqMaxLoops, npcCount);
        validateEqLen(issues, "npcWalkSeqFrameIdCounts", input.npcWalkSeqFrameIdCounts, npcCount);
        validateEqLen(
            issues,
            "npcWalkSeqFrameLengthOffsets",
            input.npcWalkSeqFrameLengthOffsets,
            npcCount,
        );
        validateEqLen(
            issues,
            "npcWalkSeqFrameLengthCounts",
            input.npcWalkSeqFrameLengthCounts,
            npcCount,
        );

        validateEqLen(issues, "npcDrawRangeIndices", input.npcDrawRangeIndices, npcCount);

        validateEqLen(
            issues,
            "npcIdleAnimFrameOffsetsBase",
            input.npcIdleAnimFrameOffsetsBase,
            npcCount,
        );
        validateEqLen(
            issues,
            "npcIdleAnimFrameCountsBase",
            input.npcIdleAnimFrameCountsBase,
            npcCount,
        );
        validateEqLen(
            issues,
            "npcWalkAnimFrameOffsetsBase",
            input.npcWalkAnimFrameOffsetsBase,
            npcCount,
        );
        validateEqLen(
            issues,
            "npcWalkAnimFrameCountsBase",
            input.npcWalkAnimFrameCountsBase,
            npcCount,
        );
        validateEqLen(
            issues,
            "npcIdleAnimFrameOffsetsAlpha",
            input.npcIdleAnimFrameOffsetsAlpha,
            npcCount,
        );
        validateEqLen(
            issues,
            "npcIdleAnimFrameCountsAlpha",
            input.npcIdleAnimFrameCountsAlpha,
            npcCount,
        );
        validateEqLen(
            issues,
            "npcWalkAnimFrameOffsetsAlpha",
            input.npcWalkAnimFrameOffsetsAlpha,
            npcCount,
        );
        validateEqLen(
            issues,
            "npcWalkAnimFrameCountsAlpha",
            input.npcWalkAnimFrameCountsAlpha,
            npcCount,
        );

        validatePatchBuffers(issues, "outNpcPatchesPacked", input.outNpcPatchesPacked, npcCount);
        validatePatchBuffers(
            issues,
            "outNpcAlphaPatchesPacked",
            input.outNpcAlphaPatchesPacked,
            npcCount,
        );

        validatePackedSlices(
            issues,
            "npcAnimFramesBasePacked",
            input.npcAnimFramesBasePacked,
            "npcIdleAnimFrameOffsetsBase",
            input.npcIdleAnimFrameOffsetsBase,
            "npcIdleAnimFrameCountsBase",
            input.npcIdleAnimFrameCountsBase,
            3,
        );
        validatePackedSlices(
            issues,
            "npcAnimFramesBasePacked",
            input.npcAnimFramesBasePacked,
            "npcWalkAnimFrameOffsetsBase",
            input.npcWalkAnimFrameOffsetsBase,
            "npcWalkAnimFrameCountsBase",
            input.npcWalkAnimFrameCountsBase,
            3,
        );
        validatePackedSlices(
            issues,
            "npcAnimFramesAlphaPacked",
            input.npcAnimFramesAlphaPacked,
            "npcIdleAnimFrameOffsetsAlpha",
            input.npcIdleAnimFrameOffsetsAlpha,
            "npcIdleAnimFrameCountsAlpha",
            input.npcIdleAnimFrameCountsAlpha,
            3,
        );
        validatePackedSlices(
            issues,
            "npcAnimFramesAlphaPacked",
            input.npcAnimFramesAlphaPacked,
            "npcWalkAnimFrameOffsetsAlpha",
            input.npcWalkAnimFrameOffsetsAlpha,
            "npcWalkAnimFrameCountsAlpha",
            input.npcWalkAnimFrameCountsAlpha,
            3,
        );
        validatePackedSlices(
            issues,
            "npcSeqFrameLengthsPacked",
            input.npcSeqFrameLengthsPacked,
            "npcIdleSeqFrameLengthOffsets",
            input.npcIdleSeqFrameLengthOffsets,
            "npcIdleSeqFrameLengthCounts",
            input.npcIdleSeqFrameLengthCounts,
            1,
        );
        validatePackedSlices(
            issues,
            "npcSeqFrameLengthsPacked",
            input.npcSeqFrameLengthsPacked,
            "npcWalkSeqFrameLengthOffsets",
            input.npcWalkSeqFrameLengthOffsets,
            "npcWalkSeqFrameLengthCounts",
            input.npcWalkSeqFrameLengthCounts,
            1,
        );

        if (!Number.isFinite(input.npcNullAlphaFrameOffset)) {
            issues.push(`npcNullAlphaFrameOffset must be finite`);
        } else if ((input.npcNullAlphaFrameOffset | 0) < 0) {
            issues.push(`npcNullAlphaFrameOffset must be >= 0`);
        } else if (
            (input.npcNullAlphaFrameOffset | 0) + 3 >
            (input.npcAnimFramesAlphaPacked.length | 0)
        ) {
            issues.push(
                `npcNullAlphaFrameOffset OOB offset=${
                    input.npcNullAlphaFrameOffset | 0
                } packedLen=${input.npcAnimFramesAlphaPacked.length | 0}`,
            );
        }
    }

    return issues;
}

function logTickStateFailure(
    message: string,
    stateKey: number,
    input: DrawRangeTickStateInput,
    issues: string[] | undefined,
): void {
    const summary = {
        stateKey: stateKey | 0,
        runtimeReady,
        runtimeHandle: runtimeHandle ?? -1,
        locCount: input.locFrameIds instanceof Int32Array ? input.locFrameIds.length | 0 : -1,
        npcCount: input.npcX instanceof Int32Array ? input.npcX.length | 0 : -1,
        locFrameIds: summarizeI32("locFrameIds", input.locFrameIds),
        locFrameSteps: summarizeI32("locFrameSteps", input.locFrameSteps),
        locDrawRangeIndicesBase: summarizeI32(
            "locDrawRangeIndicesBase",
            input.locDrawRangeIndicesBase,
        ),
        locDrawRangeIndicesAlpha: summarizeI32(
            "locDrawRangeIndicesAlpha",
            input.locDrawRangeIndicesAlpha,
        ),
        locDrawRangeIndicesLod: summarizeI32(
            "locDrawRangeIndicesLod",
            input.locDrawRangeIndicesLod,
        ),
        locDrawRangeIndicesInteract: summarizeI32(
            "locDrawRangeIndicesInteract",
            input.locDrawRangeIndicesInteract,
        ),
        npcX: summarizeI32("npcX", input.npcX),
        npcFrameIds: summarizeI32("npcFrameIds", input.npcFrameIds),
        npcDrawRangeIndices: summarizeI32("npcDrawRangeIndices", input.npcDrawRangeIndices),
    };
    console.warn("[map-render-backend][tick-state] " + message, {
        ...summary,
        issues: issues && issues.length > 0 ? issues.slice(0, 12) : undefined,
    });
}

export async function initDrawRangePatchBackend(): Promise<boolean> {
    if (runtimeHandle !== undefined) {
        for (const stateKey of registeredTickStateKeys) {
            bridge.clearTickState(runtimeHandle, stateKey);
        }
        registeredTickStateKeys.clear();
        bridge.resetRuntime(runtimeHandle);
        bridge.destroyRuntime(runtimeHandle);
        runtimeHandle = undefined;
        runtimeReady = false;
    }
    runtimeReady = await bridge.initRuntime();
    if (!runtimeReady) {
        runtimeHandle = undefined;
        return false;
    }
    runtimeHandle = await bridge.createRuntimeWithConfig({
        cacheGame: 0,
        cacheRevision: 0,
        sceneLevels: 4,
        unitsTileHeightBasis: 8,
    });
    if (runtimeHandle === undefined) {
        runtimeReady = false;
        return false;
    }
    return true;
}

export function registerDrawRangeTickState(
    stateKey: number,
    input: DrawRangeTickStateInput,
): boolean {
    const issues = validateTickStateInput(input);
    if (issues.length > 0) {
        logTickStateFailure("invalid tick-state input", stateKey, input, issues);
        return false;
    }

    if (
        !runtimeReady ||
        runtimeHandle === undefined ||
        typeof bridge.setTickState !== "function"
    ) {
        logTickStateFailure("backend not ready", stateKey, input, undefined);
        return false;
    }
    const registered = bridge.setTickState(runtimeHandle, stateKey | 0, input);
    if (!registered) {
        logTickStateFailure("setTickState returned false", stateKey, input, undefined);
        return false;
    }
    registeredTickStateKeys.add(stateKey | 0);
    return true;
}

export function unregisterDrawRangeTickState(stateKey: number): void {
    if (
        runtimeHandle === undefined ||
        typeof bridge.clearTickState !== "function"
    ) {
        registeredTickStateKeys.delete(stateKey | 0);
        return;
    }
    bridge.clearTickState(runtimeHandle, stateKey | 0);
    registeredTickStateKeys.delete(stateKey | 0);
}

export function tickAdvanceAndEmitBasePatchesForState(
    stateKey: number,
    cycleNowFixed: number,
    clientTickCount: number,
):
    | {
          locBasePatchCount: number;
          locAlphaPatchCount: number;
          locLodPatchCount: number;
          locLodAlphaPatchCount: number;
          locInteractPatchCount: number;
          locInteractAlphaPatchCount: number;
          locInteractLodPatchCount: number;
          locInteractLodAlphaPatchCount: number;
          npcBasePatchCount: number;
          npcAlphaPatchCount: number;
      }
    | undefined {
    if (
        !runtimeReady ||
        runtimeHandle === undefined ||
        typeof bridge.tickAdvanceAndEmitBasePatchesForState !== "function"
    ) {
        return undefined;
    }
    return bridge.tickAdvanceAndEmitBasePatchesForState(
        runtimeHandle,
        stateKey | 0,
        cycleNowFixed | 0,
        clientTickCount | 0,
    );
}

export function resetDrawRangePatchBackend(): void {
    if (runtimeHandle === undefined) {
        runtimeReady = false;
        runtimeHandle = undefined;
        registeredTickStateKeys.clear();
        return;
    }
    for (const stateKey of registeredTickStateKeys) {
        bridge.clearTickState(runtimeHandle, stateKey);
    }
    registeredTickStateKeys.clear();
    bridge.resetRuntime(runtimeHandle);
    bridge.destroyRuntime(runtimeHandle);
    runtimeReady = false;
    runtimeHandle = undefined;
}
