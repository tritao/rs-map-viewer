import type { NpcTypeAnimationEntry } from "../runtime/NpcTypeAnimationTable";
import type { LocAnimatedData } from "../runtime/LocAnimatedData";
import type { MapObjState } from "../shared/StaticMapPacket";

export type WorkerViewState = Readonly<{
    cameraMapX: number;
    cameraMapY: number;
    lodDistance: number;
}>;

export type WorldNpcSnapshotRequests = Readonly<{
    state?: Int32Array;
}>;

export type WorldObjSnapshotRequests = Readonly<{
    dynamic?: Int32Array;
}>;

export type WorldLocSnapshotRequests = Readonly<{
    animation?: Int32Array;
}>;

export type WorldSnapshotRequests = Readonly<{
    npc?: WorldNpcSnapshotRequests;
    obj?: WorldObjSnapshotRequests;
    loc?: WorldLocSnapshotRequests;
}>;

export type WorldInputUpdate = Readonly<{
    mapIds?: Int32Array;
    snapshotRequests?: WorldSnapshotRequests;
}>;

export type RenderFrameInputUpdate = Readonly<{
    mapIds?: Int32Array;
    viewState?: WorkerViewState;
    hoveredMapIdsPacked?: Int32Array;
}>;

export type WorkerInputStateVersion = number;

export type ApplyWorldDeltaResult = Readonly<{
    applied: number;
    snapshotRequests?: WorldSnapshotRequests;
}>;

export type SimMapRuntimeRegistrationInput = Readonly<{
    mapId: number;
    borderSize: number;
    locsAnimated: ReadonlyArray<LocAnimatedData>;
    npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>;
    mapSimToken?: number;
}>;

export type RenderMapRuntimeRegistrationInput = SimMapRuntimeRegistrationInput &
    Readonly<{
        tileRenderFlagsLevel1: Uint8Array[];
    }>;

export type MapRuntimeBootstrapInput = Readonly<{
    mapId: number;
    maxLevel: number;
    npcOrderKeys: Int32Array;
    mapObjState?: MapObjState;
    mapSimToken?: number;
}>;
