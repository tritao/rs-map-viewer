import { TransferDescriptor } from "threads";
import { Transfer, expose } from "threads/worker";

import type { NpcStateDeltaPacket } from "../runtime/packets/NpcStateDeltaPacket";
import { npcStateDeltaPacketTransferables } from "../runtime/packets/NpcStateDeltaPacket";
import type { NpcTypeAnimationEntry } from "../runtime/NpcTypeAnimationTable";
import type { LocAnimatedData } from "../runtime/LocAnimatedData";
import type { LoadedCache } from "../util/Caches";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./RenderDataWorkerTypes";

type SimWorkerServices = Readonly<{
    buildService: import("./RenderDataWorkerBuild").RenderDataWorkerBuild;
    tickRuntime: import("./tick/WorkerTickRuntime").WorkerTickRuntime;
}>;

let workerServicesPromise: Promise<SimWorkerServices> | undefined;

async function getWorkerServices(): Promise<SimWorkerServices> {
    const existing = workerServicesPromise;
    if (existing) {
        return await existing;
    }
    const created = (async () => {
        const [{ RenderDataWorkerBuild }, { WorkerTickRuntime }] = await Promise.all([
            import("./RenderDataWorkerBuild"),
            import("./tick/WorkerTickRuntime"),
        ]);
        const buildService = new RenderDataWorkerBuild();
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
    async registerMapRuntime(
        mapId: number,
        borderSize: number,
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        await tickRuntime.registerMapRuntime(
            mapId,
            borderSize,
            locsAnimated,
            npcTypeAnimationTable,
            mapSimToken,
        );
    },
    async bootstrapMapRuntime(
        mapId: number,
        maxLevel: number,
        npcOrderKeys: Int32Array,
        mapSimToken?: number,
    ): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        await tickRuntime.bootstrapMapRuntime(mapId, maxLevel, npcOrderKeys, mapSimToken);
    },
    async unregisterMapRuntime(mapId: number, mapSimToken?: number): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        tickRuntime.unregisterMapRuntime(mapId, mapSimToken);
    },
    async applyNpcLifecyclePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        const { tickRuntime } = await getWorkerServices();
        return tickRuntime.applyNpcLifecyclePacketBytes(packet);
    },
    async setTickMapIds(mapIds: Int32Array): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        tickRuntime.setTickMapIds(mapIds);
    },
    async setTickViewState(
        cameraMapX: number,
        cameraMapY: number,
        lodDistance: number,
    ): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        tickRuntime.setTickViewState(cameraMapX, cameraMapY, lodDistance);
    },
    async setTickHoveredMapIds(hoveredMapIdsPacked: Int32Array): Promise<void> {
        const { tickRuntime } = await getWorkerServices();
        tickRuntime.setTickHoveredMapIds(hoveredMapIdsPacked);
    },
    async tickSim(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
        hoveredMapIdsPacked?: Int32Array,
    ): Promise<TransferDescriptor<NpcStateDeltaPacket | undefined>> {
        const { tickRuntime } = await getWorkerServices();
        const packet = await tickRuntime.tickSim(
            frameCount,
            ticksElapsed,
            clientTicksElapsed,
            cycleNow,
            hoveredMapIdsPacked,
        );
        return packet
            ? Transfer<NpcStateDeltaPacket | undefined>(
                  packet,
                  npcStateDeltaPacketTransferables(packet),
              )
            : Transfer<NpcStateDeltaPacket | undefined>(undefined, []);
    },
    async setVars(values: Int32Array): Promise<void> {
        const { buildService } = await getWorkerServices();
        await buildService.setVars(values);
    },
};

export type SimWorker = typeof worker;

expose(worker);
