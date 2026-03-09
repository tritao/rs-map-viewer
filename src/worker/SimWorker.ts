import { TransferDescriptor } from "threads";
import { Transfer, expose } from "threads/worker";

import type {
    WorldDeltaPacket,
    WorldLocAnimationPauseState,
    WorldLocAnimationReset,
    WorldMapObjRemoval,
    WorldMapObjUpdate,
} from "../world/WorldDeltaPacket";
import { worldDeltaPacketTransferables } from "../world/WorldDeltaPacket";
import type { LoadedCache } from "../util/Caches";
import type {
    MapRuntimeBootstrapInput,
    SimMapRuntimeRegistrationInput,
    WorldInputUpdate,
} from "./WorkerRuntimeTypes";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./WorkerBuildTypes";
import { WorkerBuildService } from "./WorkerBuildService";
import { WorkerTickRuntime } from "./WorkerTickRuntime";

type SimWorkerServices = Readonly<{
    buildService: WorkerBuildService;
    tickRuntime: WorkerTickRuntime;
}>;

let workerServicesPromise: Promise<SimWorkerServices> | undefined;
const EMPTY_INT32 = new Int32Array(0);

function normalizeWorkerInt32Array(values: Int32Array): Int32Array {
    return values instanceof Int32Array && (values.length | 0) > 0 ? values : EMPTY_INT32;
}

async function getWorkerServices(): Promise<SimWorkerServices> {
    const existing = workerServicesPromise;
    if (existing) {
        return await existing;
    }
    const created = Promise.resolve().then(() => {
        const buildService = new WorkerBuildService();
        const tickRuntime = new WorkerTickRuntime(() => buildService.requireWorkerState());
        return {
            buildService,
            tickRuntime,
        };
    });
    workerServicesPromise = created.catch((error) => {
        workerServicesPromise = undefined;
        throw error;
    });
    return await workerServicesPromise;
}

const worldApi = {
    async registerMapRuntime(input: SimMapRuntimeRegistrationInput): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        await tickRuntime.registerMapRuntime(input);
    },
    async bootstrapMapRuntime(input: MapRuntimeBootstrapInput): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        await tickRuntime.bootstrapMapRuntime(input);
    },
    async unregisterMapRuntime(mapId: number, mapSimToken?: number): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        tickRuntime.unregisterMapRuntime(mapId, mapSimToken);
    },
    async applyNpcLifecyclePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        const { tickRuntime } = await getWorkerServices();
        return tickRuntime.applyNpcLifecyclePacketBytes(packet);
    },
    async applyMapObjStateUpdates(updates: ReadonlyArray<WorldMapObjUpdate>): Promise<number> {
        const { tickRuntime } = await getWorkerServices();
        return tickRuntime.applyMapObjStateUpdates(updates);
    },
    async applyMapObjRemovals(removals: ReadonlyArray<WorldMapObjRemoval>): Promise<number> {
        const { tickRuntime } = await getWorkerServices();
        return tickRuntime.applyMapObjRemovals(removals);
    },
    async applyLocAnimationResets(
        resets: ReadonlyArray<WorldLocAnimationReset>,
    ): Promise<number> {
        const { tickRuntime } = await getWorkerServices();
        return tickRuntime.applyLocAnimationResets(resets);
    },
    async applyLocAnimationPauseStates(
        pauseStates: ReadonlyArray<WorldLocAnimationPauseState>,
    ): Promise<number> {
        const { tickRuntime } = await getWorkerServices();
        return tickRuntime.applyLocAnimationPauseStates(pauseStates);
    },
    async syncState(update: WorldInputUpdate): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        tickRuntime.applyWorldInputUpdate({
            mapIds:
                update.mapIds !== undefined ? normalizeWorkerInt32Array(update.mapIds) : undefined,
            npcSnapshotMapIds:
                update.npcSnapshotMapIds !== undefined
                    ? normalizeWorkerInt32Array(update.npcSnapshotMapIds)
                    : undefined,
        });
    },
    async step(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
    ): Promise<TransferDescriptor<WorldDeltaPacket | undefined>> {
        const { tickRuntime } = await getWorkerServices();
        const packet = await tickRuntime.stepWorld(frameCount, ticksElapsed, clientTicksElapsed, cycleNow);
        return packet
            ? Transfer<WorldDeltaPacket | undefined>(packet, worldDeltaPacketTransferables(packet))
            : Transfer<WorldDeltaPacket | undefined>(undefined, []);
    },
};

const worker = {
    async initCache(
        cache: LoadedCache,
        spawnBootstrap: WorkerSpawnBootstrap,
        options?: WorkerRuntimeOptions,
    ): Promise<void> {
        const { buildService, tickRuntime } = await getWorkerServices();
        tickRuntime.resetForCache();
        await buildService.initCache(cache, spawnBootstrap, options);
    },
    async registerMapRuntime(input: SimMapRuntimeRegistrationInput): Promise<void> {
        await worldApi.registerMapRuntime(input);
    },
    async bootstrapMapRuntime(input: MapRuntimeBootstrapInput): Promise<void> {
        await worldApi.bootstrapMapRuntime(input);
    },
    async unregisterMapRuntime(mapId: number, mapSimToken?: number): Promise<void> {
        await worldApi.unregisterMapRuntime(mapId, mapSimToken);
    },
    async applyNpcLifecyclePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        return worldApi.applyNpcLifecyclePacketBytes(packet);
    },
    async applyMapObjStateUpdates(updates: ReadonlyArray<WorldMapObjUpdate>): Promise<number> {
        return worldApi.applyMapObjStateUpdates(updates);
    },
    async applyMapObjRemovals(removals: ReadonlyArray<WorldMapObjRemoval>): Promise<number> {
        return worldApi.applyMapObjRemovals(removals);
    },
    async applyLocAnimationResets(
        resets: ReadonlyArray<WorldLocAnimationReset>,
    ): Promise<number> {
        return worldApi.applyLocAnimationResets(resets);
    },
    async applyLocAnimationPauseStates(
        pauseStates: ReadonlyArray<WorldLocAnimationPauseState>,
    ): Promise<number> {
        return worldApi.applyLocAnimationPauseStates(pauseStates);
    },
    async syncWorldState(update: WorldInputUpdate): Promise<void> {
        await worldApi.syncState(update);
    },
    async stepWorld(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
    ): Promise<TransferDescriptor<WorldDeltaPacket | undefined>> {
        return worldApi.step(frameCount, ticksElapsed, clientTicksElapsed, cycleNow);
    },
    async setVars(values: Int32Array): Promise<void> {
        const { buildService } = await getWorkerServices();
        await buildService.state.setVars(values);
    },
};

export type SimWorker = typeof worker;

expose(worker);
