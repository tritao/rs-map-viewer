import { TransferDescriptor } from "threads";
import { expose } from "threads/worker";

import type { LoadedCache } from "../util/Caches";
import { RenderDataWorkerBuild } from "./RenderDataWorkerBuild";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./RenderDataWorkerTypes";
import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import type { StaticMapPacket } from "../runtime/contracts/StaticMapPacket";
export type { WorkerRuntimeOptions, WorkerState } from "./RenderDataWorkerTypes";

const buildService = new RenderDataWorkerBuild();

const worker = {
    async initCache(
        cache: LoadedCache,
        spawnBootstrap: WorkerSpawnBootstrap,
        options?: WorkerRuntimeOptions,
    ): Promise<void> {
        await buildService.initCache(cache, spawnBootstrap, options);
    },
    async loadStaticMapPacket(
        input: SdMapLoaderInput,
    ): Promise<TransferDescriptor<StaticMapPacket | undefined>> {
        return buildService.loadStaticMapPacket(input);
    },
    async loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<TransferDescriptor<Int32Array>> {
        return buildService.loadTexture(id, size, flipH, brightness);
    },
    async loadMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ) {
        return buildService.loadMapImage(mapX, mapY, level, drawMapFunctions);
    },
    async setVars(values: Int32Array): Promise<void> {
        await buildService.setVars(values);
    },
    async loadCachedMapImages(): Promise<Map<number, string>> {
        return buildService.loadCachedMapImages();
    },
    async exportSpritesToZip(): Promise<Blob> {
        return buildService.exportSpritesToZip();
    },
    async exportTexturesToZip(): Promise<Blob> {
        return buildService.exportTexturesToZip();
    },
};

export type RenderDataWorker = typeof worker;

expose(worker);
