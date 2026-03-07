import { TransferDescriptor } from "threads";
import { Transfer, expose } from "threads/worker";

import type { NpcStateDeltaPacket } from "../runtime/contracts/NpcStateDeltaPacket";
import { npcStateDeltaPacketTransferables } from "../runtime/contracts/NpcStateDeltaPacket";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import type { LocAnimatedData } from "../runtime/entities/LocAnimatedData";
import type { LoadedCache } from "../util/Caches";
import { RenderDataWorkerBuild } from "./RenderDataWorkerBuild";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./RenderDataWorkerTypes";
import { WorkerTickRuntime } from "./tick/WorkerTickRuntime";

const buildService = new RenderDataWorkerBuild();
const tickRuntime = new WorkerTickRuntime(() => buildService.requireWorkerState());

const worker = {
    async initCache(
        cache: LoadedCache,
        spawnBootstrap: WorkerSpawnBootstrap,
        options?: WorkerRuntimeOptions,
    ): Promise<void> {
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
        await tickRuntime.bootstrapMapRuntime(mapId, maxLevel, npcOrderKeys, mapSimToken);
    },
    unregisterMapRuntime(mapId: number, mapSimToken?: number): void {
        tickRuntime.unregisterMapRuntime(mapId, mapSimToken);
    },
    async applyNpcLifecyclePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        return tickRuntime.applyNpcLifecyclePacketBytes(packet);
    },
    setTickMapIds(mapIds: Int32Array): void {
        tickRuntime.setTickMapIds(mapIds);
    },
    setTickViewState(cameraMapX: number, cameraMapY: number, lodDistance: number): void {
        tickRuntime.setTickViewState(cameraMapX, cameraMapY, lodDistance);
    },
    setTickHoveredMapIds(hoveredMapIdsPacked: Int32Array): void {
        tickRuntime.setTickHoveredMapIds(hoveredMapIdsPacked);
    },
    async tickSim(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
        hoveredMapIdsPacked?: Int32Array,
    ): Promise<TransferDescriptor<NpcStateDeltaPacket | undefined>> {
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
        await buildService.setVars(values);
    },
};

export type SimWorker = typeof worker;

expose(worker);
