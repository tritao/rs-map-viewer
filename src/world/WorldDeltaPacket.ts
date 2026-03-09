import type {
    NpcEvent,
} from "../runtime/entities/NpcEvents";
import type { NpcUpdateDelta } from "../runtime/entities/NpcUpdateDelta";
import type { MapObjState } from "../shared/StaticMapPacket";

export const NPC_STATE_DELTA_SPAWN_STRIDE = 8;
export const NPC_STATE_DELTA_UPDATE_STRIDE = 14;
export const NPC_STATE_DELTA_DESPAWN_STRIDE = 3;
export const LOC_ANIMATION_RESET_STRIDE = 2;
export const LOC_ANIMATION_PAUSE_STATE_STRIDE = 3;
export const LOC_ANIMATION_SNAPSHOT_STRIDE = 6;
export const LOC_VISIBILITY_STATE_STRIDE = 3;

const UPDATE_FLAG_CLEAR_SERVER_PATH = 1 << 0;
const UPDATE_FLAG_HAS_SNAP_TILE = 1 << 1;
const UPDATE_FLAG_HAS_SNAP_WORLD = 1 << 2;
const UPDATE_FLAG_HAS_ORIENTATION = 1 << 3;
const UPDATE_FLAG_HAS_ROTATION = 1 << 4;
const UPDATE_FLAG_HAS_MOVEMENT_SEQ_ID = 1 << 5;
const UPDATE_FLAG_HAS_MOVEMENT_FRAME = 1 << 6;
const UPDATE_FLAG_HAS_MOVEMENT_FRAME_TICK = 1 << 7;
const UPDATE_FLAG_HAS_MOVEMENT_LOOP = 1 << 8;

type WorldDeltaPacketInput = Readonly<{
    frameCount: number;
    npc?: WorldNpcDelta;
    obj?: WorldObjDelta;
    loc?: WorldLocDelta;
}>;

export type WorldMapObjStateReplacement = Readonly<{
    kind: "replaceState";
    mapId: number;
    mapObjState?: MapObjState;
}>;

export type WorldMapObjRemoval = Readonly<{
    mapId: number;
    objIndex: number;
}>;

export type WorldMapObjAddition = Readonly<{
    mapId: number;
    objIndex: number;
}>;

export type WorldDynamicMapObjSpawn = Readonly<{
    mapId: number;
    runtimeObjId: number;
    objTypeId: number;
    count: number;
    x: number;
    y: number;
    plane: number;
}>;

export type WorldDynamicMapObjDespawn = Readonly<{
    mapId: number;
    runtimeObjId: number;
}>;

export type WorldDynamicMapObjUpdate = Readonly<{
    mapId: number;
    runtimeObjId: number;
    objTypeId: number;
    count: number;
    x: number;
    y: number;
    plane: number;
}>;

export type WorldObjStaticDelta = Readonly<{
    stateReplacements?: ReadonlyArray<WorldMapObjStateReplacement>;
    additions?: ReadonlyArray<WorldMapObjAddition>;
    removals?: ReadonlyArray<WorldMapObjRemoval>;
}>;

export type WorldObjDynamicDelta = Readonly<{
    dynamicSpawns?: ReadonlyArray<WorldDynamicMapObjSpawn>;
    dynamicDespawns?: ReadonlyArray<WorldDynamicMapObjDespawn>;
    dynamicUpdates?: ReadonlyArray<WorldDynamicMapObjUpdate>;
    clearDynamicMapIds?: ReadonlyArray<number>;
}>;

export type WorldObjDelta = Readonly<{
    static?: WorldObjStaticDelta;
    dynamic?: WorldObjDynamicDelta;
}>;

export type WorldLocAnimationReset = Readonly<{
    mapId: number;
    locIndex: number;
}>;

export type WorldLocAnimationPauseState = Readonly<{
    mapId: number;
    locIndex: number;
    paused: boolean;
}>;

export type WorldLocAnimationSnapshot = Readonly<{
    mapId: number;
    locIndex: number;
    frame: number;
    cycleStart: number;
    paused: boolean;
    visible: boolean;
}>;

export type WorldLocVisibilityChange = Readonly<{
    mapId: number;
    locIndex: number;
    visible: boolean;
}>;

export type WorldLocAnimationDelta = Readonly<{
    animationResetPacked: Int32Array;
    animationPauseStatePacked?: Int32Array;
    animationSnapshotPacked?: Int32Array;
}>;

export type WorldLocStateDelta = Readonly<{
    visibilityPacked?: Int32Array;
}>;

export type WorldLocDelta = Readonly<{
    state?: WorldLocStateDelta;
    animation?: WorldLocAnimationDelta;
}>;

export type NpcWorldState = Readonly<{
    changeCount: number;
    spawnStatePacked: Int32Array;
    updateStatePacked: Int32Array;
    despawnStatePacked: Int32Array;
}>;

export type WorldNpcDelta = Readonly<{
    state?: NpcWorldState;
}>;

export type WorldDeltaPacketCounts = Readonly<{
    spawnCount: number;
    updateCount: number;
    despawnCount: number;
    changeCount: number;
}>;

const EMPTY_WORLD_DELTA_PACKET_COUNTS: WorldDeltaPacketCounts = {
    spawnCount: 0,
    updateCount: 0,
    despawnCount: 0,
    changeCount: 0,
};

function assertPackedStride(name: string, packed: Int32Array, stride: number): void {
    const len = packed.length | 0;
    const expectedStride = stride | 0;
    if (expectedStride <= 0 || len % expectedStride !== 0) {
        throw new Error(
            `[map-render][world-delta] invalid ${name} length: ` +
                `len=${len} stride=${expectedStride}`,
        );
    }
}

function getNpcWorldStateCounts(npcState: NpcWorldState): WorldDeltaPacketCounts {
    const spawnCount = Math.floor(
        (npcState.spawnStatePacked.length | 0) / NPC_STATE_DELTA_SPAWN_STRIDE,
    );
    const updateCount = Math.floor(
        (npcState.updateStatePacked.length | 0) / NPC_STATE_DELTA_UPDATE_STRIDE,
    );
    const despawnCount = Math.floor(
        (npcState.despawnStatePacked.length | 0) / NPC_STATE_DELTA_DESPAWN_STRIDE,
    );
    return {
        spawnCount: spawnCount | 0,
        updateCount: updateCount | 0,
        despawnCount: despawnCount | 0,
        changeCount: (spawnCount + updateCount + despawnCount) | 0,
    };
}

export type WorldDeltaPacket = Readonly<{
    frameCount: number;
    npc?: WorldNpcDelta;
    obj?: WorldObjDelta;
    loc?: WorldLocDelta;
}>;

function collectUniqueTransferables(
    ...lists: ReadonlyArray<ReadonlyArray<Transferable>>
): Transferable[] {
    const transferables: Transferable[] = [];
    const seen = new Set<Transferable>();
    for (let listIndex = 0; listIndex < lists.length; listIndex++) {
        const list = lists[listIndex]!;
        for (let index = 0; index < list.length; index++) {
            const transferable = list[index]!;
            if (seen.has(transferable)) {
                continue;
            }
            seen.add(transferable);
            transferables.push(transferable);
        }
    }
    return transferables;
}

function getNpcStateTransferables(npcState: NpcWorldState | undefined): Transferable[] {
    if (!npcState) {
        return [];
    }
    return [
        npcState.spawnStatePacked.buffer as Transferable,
        npcState.updateStatePacked.buffer as Transferable,
        npcState.despawnStatePacked.buffer as Transferable,
    ];
}

function getObjDeltaTransferables(objDelta: WorldObjDelta | undefined): Transferable[] {
    const stateReplacements = objDelta?.static?.stateReplacements;
    if (!stateReplacements || (stateReplacements.length | 0) <= 0) {
        return [];
    }
    const transferables: Transferable[] = [];
    for (let index = 0; index < stateReplacements.length; index++) {
        const mapObjState = stateReplacements[index]?.mapObjState;
        if (!mapObjState) {
            continue;
        }
        const states = [mapObjState.staticState];
        for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
            const state = states[stateIndex];
            if (!state) {
                continue;
            }
            transferables.push(
                state.vertices.buffer as Transferable,
                state.indices.buffer as Transferable,
                state.usedTextureIds.buffer as Transferable,
                state.objTypeIds.buffer as Transferable,
            );
            if ("runtimeObjIds" in state && state.runtimeObjIds instanceof Int32Array) {
                transferables.push(state.runtimeObjIds.buffer as Transferable);
            }
            for (const key of Object.keys(state.renderState.modelInfoTextures) as Array<
                keyof typeof state.renderState.modelInfoTextures
            >) {
                transferables.push(
                    state.renderState.modelInfoTextures[key].buffer as Transferable,
                    state.renderState.modelInfoIndices[key].buffer as Transferable,
                    state.renderState.drawRanges[key].buffer as Transferable,
                );
            }
        }
    }
    return transferables;
}

function getLocDeltaTransferables(locDelta: WorldLocDelta | undefined): Transferable[] {
    const animation = locDelta?.animation;
    const state = locDelta?.state;
    if (!animation && !state) {
        return [];
    }
    const transferables: Transferable[] = [];
    if (animation) {
        transferables.push(animation.animationResetPacked.buffer as Transferable);
    }
    if (animation?.animationPauseStatePacked) {
        transferables.push(animation.animationPauseStatePacked.buffer as Transferable);
    }
    if (animation?.animationSnapshotPacked) {
        transferables.push(animation.animationSnapshotPacked.buffer as Transferable);
    }
    if (state?.visibilityPacked) {
        transferables.push(state.visibilityPacked.buffer as Transferable);
    }
    return transferables;
}

export function getWorldDeltaPacketCounts(
    packet: WorldDeltaPacket,
): WorldDeltaPacketCounts {
    const npcState = packet.npc?.state;
    if (!npcState) {
        return EMPTY_WORLD_DELTA_PACKET_COUNTS;
    }
    return getNpcWorldStateCounts(npcState);
}

export function getWorldDeltaChangeCount(packet: WorldDeltaPacket): number {
    const objStaticDelta = packet.obj?.static;
    const objDynamicDelta = packet.obj?.dynamic;
    const locAnimationDelta = packet.loc?.animation;
    const locStateDelta = packet.loc?.state;
    return (
        (packet.npc?.state?.changeCount ?? 0) +
        (objStaticDelta?.stateReplacements?.length ?? 0) +
        (objStaticDelta?.additions?.length ?? 0) +
        (objStaticDelta?.removals?.length ?? 0) +
        (objDynamicDelta?.dynamicSpawns?.length ?? 0) +
        (objDynamicDelta?.dynamicDespawns?.length ?? 0) +
        (objDynamicDelta?.dynamicUpdates?.length ?? 0) +
        (objDynamicDelta?.clearDynamicMapIds?.length ?? 0) +
        Math.floor(((locStateDelta?.visibilityPacked?.length ?? 0) | 0) / 3) +
        Math.floor(((locAnimationDelta?.animationResetPacked.length ?? 0) | 0) / 2) +
        Math.floor(((locAnimationDelta?.animationPauseStatePacked?.length ?? 0) | 0) / 3) +
        Math.floor(
            ((locAnimationDelta?.animationSnapshotPacked?.length ?? 0) | 0) /
                LOC_ANIMATION_SNAPSHOT_STRIDE,
        )
    );
}

export function validateWorldDeltaPacket(
    packet: WorldDeltaPacket,
): WorldDeltaPacketCounts {
    const locAnimationDelta = packet.loc?.animation;
    const locStateDelta = packet.loc?.state;
    if (locStateDelta?.visibilityPacked) {
        assertPackedStride(
            "visibilityPacked",
            locStateDelta.visibilityPacked,
            LOC_VISIBILITY_STATE_STRIDE,
        );
    }
    if (locAnimationDelta) {
        assertPackedStride(
            "animationResetPacked",
            locAnimationDelta.animationResetPacked,
            LOC_ANIMATION_RESET_STRIDE,
        );
        if (locAnimationDelta.animationPauseStatePacked) {
            assertPackedStride(
                "animationPauseStatePacked",
                locAnimationDelta.animationPauseStatePacked,
                LOC_ANIMATION_PAUSE_STATE_STRIDE,
            );
        }
        if (locAnimationDelta.animationSnapshotPacked) {
            assertPackedStride(
                "animationSnapshotPacked",
                locAnimationDelta.animationSnapshotPacked,
                LOC_ANIMATION_SNAPSHOT_STRIDE,
            );
        }
    }
    const npcState = packet.npc?.state;
    if (!npcState) {
        return EMPTY_WORLD_DELTA_PACKET_COUNTS;
    }
    assertPackedStride(
        "spawnStatePacked",
        npcState.spawnStatePacked,
        NPC_STATE_DELTA_SPAWN_STRIDE,
    );
    assertPackedStride(
        "updateStatePacked",
        npcState.updateStatePacked,
        NPC_STATE_DELTA_UPDATE_STRIDE,
    );
    assertPackedStride(
        "despawnStatePacked",
        npcState.despawnStatePacked,
        NPC_STATE_DELTA_DESPAWN_STRIDE,
    );
    const counts = getWorldDeltaPacketCounts(packet);
    if ((npcState.changeCount | 0) !== (counts.changeCount | 0)) {
        throw new Error(
            `[map-render][world-delta] invalid npcState.changeCount: ` +
                `changeCount=${npcState.changeCount | 0} expected=${counts.changeCount | 0} ` +
                `spawns=${counts.spawnCount | 0} updates=${counts.updateCount | 0} ` +
                `despawns=${counts.despawnCount | 0}`,
        );
    }
    return counts;
}

export function buildWorldDeltaPacket(input: WorldDeltaPacketInput): WorldDeltaPacket {
    if (input.npc?.state) {
        assertPackedStride(
            "spawnStatePacked",
            input.npc.state.spawnStatePacked,
            NPC_STATE_DELTA_SPAWN_STRIDE,
        );
        assertPackedStride(
            "updateStatePacked",
            input.npc.state.updateStatePacked,
            NPC_STATE_DELTA_UPDATE_STRIDE,
        );
        assertPackedStride(
            "despawnStatePacked",
            input.npc.state.despawnStatePacked,
            NPC_STATE_DELTA_DESPAWN_STRIDE,
        );
    }
    if (input.loc?.animation) {
        assertPackedStride(
            "animationResetPacked",
            input.loc.animation.animationResetPacked,
            LOC_ANIMATION_RESET_STRIDE,
        );
        if (input.loc.animation.animationPauseStatePacked) {
            assertPackedStride(
                "animationPauseStatePacked",
                input.loc.animation.animationPauseStatePacked,
                LOC_ANIMATION_PAUSE_STATE_STRIDE,
            );
        }
        if (input.loc.animation.animationSnapshotPacked) {
            assertPackedStride(
                "animationSnapshotPacked",
                input.loc.animation.animationSnapshotPacked,
                LOC_ANIMATION_SNAPSHOT_STRIDE,
            );
        }
    }
    if (input.loc?.state?.visibilityPacked) {
        assertPackedStride(
            "visibilityPacked",
            input.loc.state.visibilityPacked,
            LOC_VISIBILITY_STATE_STRIDE,
        );
    }
    return {
        frameCount: input.frameCount | 0,
        npc: input.npc,
        obj: input.obj,
        loc: input.loc,
    };
}

function updateFlagsFromDelta(delta: NpcUpdateDelta): number {
    let flags = 0;
    if (delta.clearServerPath) {
        flags |= UPDATE_FLAG_CLEAR_SERVER_PATH;
    }
    if (delta.snapTileX !== undefined && delta.snapTileY !== undefined) {
        flags |= UPDATE_FLAG_HAS_SNAP_TILE;
    }
    if (delta.snapWorldX !== undefined && delta.snapWorldY !== undefined) {
        flags |= UPDATE_FLAG_HAS_SNAP_WORLD;
    }
    if (delta.orientation !== undefined) {
        flags |= UPDATE_FLAG_HAS_ORIENTATION;
    }
    if (delta.rotation !== undefined) {
        flags |= UPDATE_FLAG_HAS_ROTATION;
    }
    if (delta.movementSeqId !== undefined) {
        flags |= UPDATE_FLAG_HAS_MOVEMENT_SEQ_ID;
    }
    if (delta.movementFrame !== undefined) {
        flags |= UPDATE_FLAG_HAS_MOVEMENT_FRAME;
    }
    if (delta.movementFrameTick !== undefined) {
        flags |= UPDATE_FLAG_HAS_MOVEMENT_FRAME_TICK;
    }
    if (delta.movementLoop !== undefined) {
        flags |= UPDATE_FLAG_HAS_MOVEMENT_LOOP;
    }
    return flags | 0;
}

export function buildWorldDeltaPacketFromNpcLifecycleEvents(
    input: Readonly<{
        frameCount: number;
        lifecycleEvents: ReadonlyArray<NpcEvent>;
    }>,
): WorldDeltaPacket {
    const events = input.lifecycleEvents;
    let spawnCount = 0;
    let updateCount = 0;
    let despawnCount = 0;
    for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        if (event.kind === "spawn") {
            spawnCount = (spawnCount + 1) | 0;
        } else if (event.kind === "update") {
            updateCount = (updateCount + 1) | 0;
        } else {
            despawnCount = (despawnCount + 1) | 0;
        }
    }

    const spawnStatePacked = new Int32Array((spawnCount | 0) * NPC_STATE_DELTA_SPAWN_STRIDE);
    const updateStatePacked = new Int32Array((updateCount | 0) * NPC_STATE_DELTA_UPDATE_STRIDE);
    const despawnStatePacked = new Int32Array((despawnCount | 0) * NPC_STATE_DELTA_DESPAWN_STRIDE);

    let spawnOff = 0;
    let updateOff = 0;
    let despawnOff = 0;
    for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        if (event.kind === "spawn") {
            spawnStatePacked[spawnOff++] = event.mapId | 0;
            spawnStatePacked[spawnOff++] = event.npcInstanceId | 0;
            spawnStatePacked[spawnOff++] = event.npcTypeId | 0;
            spawnStatePacked[spawnOff++] = event.tileX | 0;
            spawnStatePacked[spawnOff++] = event.tileY | 0;
            spawnStatePacked[spawnOff++] = event.level | 0;
            spawnStatePacked[spawnOff++] = event.orderKey === undefined ? 0 : 1;
            spawnStatePacked[spawnOff++] = (event.orderKey ?? 0) | 0;
            continue;
        }
        if (event.kind === "update") {
            const flags = updateFlagsFromDelta(event.delta);
            updateStatePacked[updateOff++] = event.mapId | 0;
            updateStatePacked[updateOff++] = event.npcInstanceId | 0;
            updateStatePacked[updateOff++] = event.seq | 0;
            updateStatePacked[updateOff++] = flags | 0;
            updateStatePacked[updateOff++] = event.delta.snapTileX ?? 0;
            updateStatePacked[updateOff++] = event.delta.snapTileY ?? 0;
            updateStatePacked[updateOff++] = event.delta.snapWorldX ?? 0;
            updateStatePacked[updateOff++] = event.delta.snapWorldY ?? 0;
            updateStatePacked[updateOff++] = event.delta.orientation ?? 0;
            updateStatePacked[updateOff++] = event.delta.rotation ?? 0;
            updateStatePacked[updateOff++] = event.delta.movementSeqId ?? 0;
            updateStatePacked[updateOff++] = event.delta.movementFrame ?? 0;
            updateStatePacked[updateOff++] = event.delta.movementFrameTick ?? 0;
            updateStatePacked[updateOff++] = event.delta.movementLoop ?? 0;
            continue;
        }
        despawnStatePacked[despawnOff++] = event.mapId | 0;
        despawnStatePacked[despawnOff++] = event.npcInstanceId | 0;
        despawnStatePacked[despawnOff++] = event.seq | 0;
    }

    return buildWorldDeltaPacket({
        frameCount: input.frameCount | 0,
        npc: {
            state: {
                changeCount: (spawnCount + updateCount + despawnCount) | 0,
                spawnStatePacked,
                updateStatePacked,
                despawnStatePacked,
            },
        },
    });
}

export function buildWorldDeltaPacketFromNpcEvents(
    input: Readonly<{
        frameCount: number;
        events: ReadonlyArray<NpcEvent>;
    }>,
): WorldDeltaPacket {
    return buildWorldDeltaPacketFromNpcLifecycleEvents({
        frameCount: input.frameCount,
        lifecycleEvents: input.events,
    });
}

export function buildWorldDeltaPacketFromObjStateReplacements(
    input: Readonly<{
        frameCount?: number;
        stateReplacements: ReadonlyArray<WorldMapObjStateReplacement>;
    }>,
): WorldDeltaPacket {
    return buildWorldDeltaPacket({
        frameCount: input.frameCount ?? 0,
        obj: {
            static: {
                stateReplacements: input.stateReplacements,
            },
        },
    });
}

export function buildWorldDeltaPacketFromLocAnimationResets(
    input: Readonly<{
        frameCount: number;
        animationResets: ReadonlyArray<WorldLocAnimationReset>;
    }>,
): WorldDeltaPacket {
    const animationResetPacked = new Int32Array(
        (input.animationResets.length | 0) * LOC_ANIMATION_RESET_STRIDE,
    );
    let write = 0;
    for (let index = 0; index < input.animationResets.length; index++) {
        const reset = input.animationResets[index]!;
        animationResetPacked[write++] = reset.mapId | 0;
        animationResetPacked[write++] = reset.locIndex | 0;
    }
    return buildWorldDeltaPacket({
        frameCount: input.frameCount | 0,
        loc: {
            animation: {
                animationResetPacked,
            },
        },
    });
}

export function buildWorldDeltaPacketFromLocAnimationPauseStates(
    input: Readonly<{
        frameCount: number;
        animationPauseStates: ReadonlyArray<WorldLocAnimationPauseState>;
    }>,
): WorldDeltaPacket {
    const animationPauseStatePacked = new Int32Array(
        (input.animationPauseStates.length | 0) * LOC_ANIMATION_PAUSE_STATE_STRIDE,
    );
    let write = 0;
    for (let index = 0; index < input.animationPauseStates.length; index++) {
        const pauseState = input.animationPauseStates[index]!;
        animationPauseStatePacked[write++] = pauseState.mapId | 0;
        animationPauseStatePacked[write++] = pauseState.locIndex | 0;
        animationPauseStatePacked[write++] = pauseState.paused ? 1 : 0;
    }
    return buildWorldDeltaPacket({
        frameCount: input.frameCount | 0,
        loc: {
            animation: {
                animationResetPacked: new Int32Array(0),
                animationPauseStatePacked,
            },
        },
    });
}

export function buildWorldDeltaPacketFromLocAnimationSnapshots(
    input: Readonly<{
        frameCount: number;
        animationSnapshots: ReadonlyArray<WorldLocAnimationSnapshot>;
    }>,
): WorldDeltaPacket {
    const animationSnapshotPacked = new Int32Array(
        (input.animationSnapshots.length | 0) * LOC_ANIMATION_SNAPSHOT_STRIDE,
    );
    let write = 0;
    for (let index = 0; index < input.animationSnapshots.length; index++) {
        const snapshot = input.animationSnapshots[index]!;
        animationSnapshotPacked[write++] = snapshot.mapId | 0;
        animationSnapshotPacked[write++] = snapshot.locIndex | 0;
        animationSnapshotPacked[write++] = snapshot.frame | 0;
        animationSnapshotPacked[write++] = snapshot.cycleStart | 0;
        animationSnapshotPacked[write++] = snapshot.paused ? 1 : 0;
        animationSnapshotPacked[write++] = snapshot.visible ? 1 : 0;
    }
    return buildWorldDeltaPacket({
        frameCount: input.frameCount | 0,
        loc: {
            animation: {
                animationResetPacked: new Int32Array(0),
                animationSnapshotPacked,
            },
        },
    });
}

export function buildWorldDeltaPacketFromLocVisibilityChanges(
    input: Readonly<{
        frameCount: number;
        visibilityChanges: ReadonlyArray<WorldLocVisibilityChange>;
    }>,
): WorldDeltaPacket {
    const visibilityPacked = new Int32Array(
        (input.visibilityChanges.length | 0) * LOC_VISIBILITY_STATE_STRIDE,
    );
    let write = 0;
    for (let index = 0; index < input.visibilityChanges.length; index++) {
        const change = input.visibilityChanges[index]!;
        visibilityPacked[write++] = change.mapId | 0;
        visibilityPacked[write++] = change.locIndex | 0;
        visibilityPacked[write++] = change.visible ? 1 : 0;
    }
    return buildWorldDeltaPacket({
        frameCount: input.frameCount | 0,
        loc: {
            state: {
                visibilityPacked,
            },
        },
    });
}

export function decodeNpcWorldStateUpdate(
    flags: number,
    packed: Int32Array,
    off: number,
): NpcUpdateDelta {
    const delta: {
        clearServerPath?: boolean;
        snapTileX?: number;
        snapTileY?: number;
        snapWorldX?: number;
        snapWorldY?: number;
        orientation?: number;
        rotation?: number;
        movementSeqId?: number;
        movementFrame?: number;
        movementFrameTick?: number;
        movementLoop?: number;
    } = {};
    if ((flags & UPDATE_FLAG_CLEAR_SERVER_PATH) !== 0) {
        delta.clearServerPath = true;
    }
    if ((flags & UPDATE_FLAG_HAS_SNAP_TILE) !== 0) {
        delta.snapTileX = packed[off + 4] | 0;
        delta.snapTileY = packed[off + 5] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_SNAP_WORLD) !== 0) {
        delta.snapWorldX = packed[off + 6] | 0;
        delta.snapWorldY = packed[off + 7] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_ORIENTATION) !== 0) {
        delta.orientation = packed[off + 8] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_ROTATION) !== 0) {
        delta.rotation = packed[off + 9] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_MOVEMENT_SEQ_ID) !== 0) {
        delta.movementSeqId = packed[off + 10] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_MOVEMENT_FRAME) !== 0) {
        delta.movementFrame = packed[off + 11] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_MOVEMENT_FRAME_TICK) !== 0) {
        delta.movementFrameTick = packed[off + 12] | 0;
    }
    if ((flags & UPDATE_FLAG_HAS_MOVEMENT_LOOP) !== 0) {
        delta.movementLoop = packed[off + 13] | 0;
    }
    return delta;
}

export function worldDeltaPacketTransferables(packet: WorldDeltaPacket): Transferable[] {
    return collectUniqueTransferables(
        getNpcStateTransferables(packet.npc?.state),
        getObjDeltaTransferables(packet.obj),
        getLocDeltaTransferables(packet.loc),
    );
}
