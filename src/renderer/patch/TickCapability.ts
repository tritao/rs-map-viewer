import type { DrawRangeTickStateInput } from "../../wasm/DrawRangeTickState";
import type { LocAnimated } from "../loc/LocAnimated";
import type { Npc } from "../npc/Npc";

export type TickControllerRenderer = Readonly<{
    isDrawRangePatchWasmReady(): boolean;
}>;

export type TickPatchBackendResult = Readonly<{
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
}>;

export type TickCapability = Readonly<{
    id: number;

    // TS tick path hooks
    resetCppTickStateLifecycle(): void;
    syncLocAnimationFrameIds(): void;
    getLocsAnimated(): ReadonlyArray<LocAnimated>;
    getLocFrameId(locIndex: number): number;
    setLocFrameId(locIndex: number, frameId: number): void;

    getNpcs(): ReadonlyArray<Npc>;

    // wasm tick path hooks
    ensureCppTickStateInitializedFromObjects(): boolean;
    syncNpcMovementStateFromObjects(): void;
    syncNpcPathStateFromObjects(): void;
    getWasmTickStateInput(): DrawRangeTickStateInput;
    applyWasmTickResult(result: TickPatchBackendResult): void;
}>;
