import { TransferDescriptor } from "threads";
import { Transfer, expose } from "threads/worker";

import type { WorldDeltaPacket } from "../runtime/packets/WorldDeltaPacket";
import { worldDeltaPacketTransferables } from "../runtime/packets/WorldDeltaPacket";
import type { LoadedCache } from "../util/Caches";
import type {
    MapRuntimeBootstrapInput,
    SimMapRuntimeRegistrationInput,
    WorkerRuntimeOptions,
    WorkerSpawnBootstrap,
    WorldInputUpdate,
} from "./WorkerContext";

type SimWorkerServices = Readonly<{
    buildService: import("./WorkerBuildService").WorkerBuildService;
    tickRuntime: import("./WorkerTickRuntime").WorkerTickRuntime;
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
    const created = (async () => {
        const [{ WorkerBuildService }, { WorkerTickRuntime }] = await Promise.all([
            import("./WorkerBuildService"),
            import("./WorkerTickRuntime"),
        ]);
        const buildService = new WorkerBuildService();
        const tickRuntime = new WorkerTickRuntime(() => buildService.requireWorkerState());
        return {
            buildService,
            tickRuntime,
        };
    })();
    workerServicesPromise = created;
    return await created;
}

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
    async syncWorldState(update: WorldInputUpdate): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        tickRuntime.applyWorldInputUpdate({
            mapIds:
                update.mapIds !== undefined
                    ? normalizeWorkerInt32Array(update.mapIds)
                    : undefined,
            viewState:
                update.viewState !== undefined
                    ? {
                          cameraMapX: update.viewState.cameraMapX | 0,
                          cameraMapY: update.viewState.cameraMapY | 0,
                          lodDistance: Math.max(0, update.viewState.lodDistance | 0),
                      }
                    : undefined,
        });
    },
    async stepWorld(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
    ): Promise<TransferDescriptor<WorldDeltaPacket | undefined>> {
        const { tickRuntime } = await getWorkerServices();
        const packet = await tickRuntime.stepWorld(frameCount, ticksElapsed, clientTicksElapsed, cycleNow);
        return packet
            ? Transfer<WorldDeltaPacket | undefined>(
                  packet,
                  worldDeltaPacketTransferables(packet),
              )
            : Transfer<WorldDeltaPacket | undefined>(undefined, []);
    },
    async setVars(values: Int32Array): Promise<void> {
        const { buildService } = await getWorkerServices();
        await buildService.setVars(values);
    },
};

export type SimWorker = typeof worker;

expose(worker);
