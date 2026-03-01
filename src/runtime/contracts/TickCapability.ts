import type { DrawRangeTickStateInput } from "../../wasm/DrawRangeTickState";
import type { LocAnimated } from "../entities/LocAnimated";
import type { Npc } from "../entities/Npc";

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

export type TickCommonCapability = Readonly<{
    id: number;
    getNpcs(): ReadonlyArray<Npc>;
}>;

export type TsTickCapability = TickCommonCapability & Readonly<{
    // TS tick path hooks
    resetCppTickStateLifecycle(): void;
    syncLocAnimationFrameIds(): void;
    getLocsAnimated(): ReadonlyArray<LocAnimated>;
    getLocFrameId(locIndex: number): number;
    setLocFrameId(locIndex: number, frameId: number): void;
}>;

export type WasmTickCapability = TickCommonCapability & Readonly<{
    // wasm tick path hooks
    ensureCppTickStateInitializedFromObjects(): boolean;
    syncNpcMovementStateFromObjects(): void;
    syncNpcPathStateFromObjects(): void;
    getWasmTickStateInput(): DrawRangeTickStateInput;
    applyWasmTickResult(result: TickPatchBackendResult): void;
}>;

// Transitional compatibility alias for call sites that still require both capabilities.
export type TickCapability = TsTickCapability & WasmTickCapability;
