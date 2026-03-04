import { summarizeI32, validateTickStateInput } from "./DrawRangePatchValidation";
import type { DrawRangeTickStateInput } from "./DrawRangeTickState";
import { mapRenderRuntimeBridge } from "./rs_map_runtime_bridge.mjs";

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
    updateTickStateNpcPathPacked?(
        runtimeHandle: number,
        stateKey: number,
        packed: Int32Array,
    ): boolean;
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

const bridge = mapRenderRuntimeBridge as DrawRangePatchBridge;
let runtimeReady = false;
let runtimeHandle: number | undefined;
let initPromise: Promise<boolean> | undefined;
let initToken = 0;
const registeredTickStateKeys = new Set<number>();

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

export function ensureDrawRangePatchBackendInit(): void {
    if (runtimeReady && runtimeHandle !== undefined) {
        return;
    }
    if (initPromise) {
        return;
    }
    const token = initToken;
    initPromise = initDrawRangePatchBackendInternal(token).finally(() => {
        if (!runtimeReady || runtimeHandle === undefined) {
            initPromise = undefined;
        }
    });
}

export function isDrawRangePatchBackendReady(): boolean {
    return runtimeReady && runtimeHandle !== undefined;
}

async function initDrawRangePatchBackendInternal(token: number): Promise<boolean> {
    // If a previous runtime exists, tear it down (best-effort) before creating a new one.
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

    const ok = await bridge.initRuntime();
    if (!ok) {
        runtimeReady = false;
        runtimeHandle = undefined;
        return false;
    }

    const handle = await bridge.createRuntimeWithConfig({
        cacheGame: 0,
        cacheRevision: 0,
        sceneLevels: 4,
        unitsTileHeightBasis: 8,
    });
    if (handle === undefined) {
        runtimeReady = false;
        runtimeHandle = undefined;
        return false;
    }

    // If we were reset while init was in-flight, clean up the created runtime and report failure.
    if (token !== initToken) {
        bridge.resetRuntime(handle);
        bridge.destroyRuntime(handle);
        runtimeReady = false;
        runtimeHandle = undefined;
        return false;
    }

    runtimeReady = true;
    runtimeHandle = handle;
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

    if (!runtimeReady || runtimeHandle === undefined || typeof bridge.setTickState !== "function") {
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
    if (runtimeHandle === undefined || typeof bridge.clearTickState !== "function") {
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

export function updateDrawRangeTickStateNpcPathPacked(
    stateKey: number,
    packed: Int32Array,
): boolean {
    if (
        !runtimeReady ||
        runtimeHandle === undefined ||
        typeof bridge.updateTickStateNpcPathPacked !== "function"
    ) {
        return false;
    }
    return bridge.updateTickStateNpcPathPacked(runtimeHandle, stateKey | 0, packed);
}

export function resetDrawRangePatchBackend(): void {
    // Invalidate any in-flight init.
    initToken = (initToken + 1) | 0;
    initPromise = undefined;

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
