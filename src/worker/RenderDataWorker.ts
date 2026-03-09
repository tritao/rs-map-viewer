import { TransferDescriptor } from "threads";
import { Transfer, expose } from "threads/worker";

import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import type { RenderFramePacket } from "../renderer/RenderFramePacket";
import { renderFramePacketTransferables } from "../renderer/RenderFramePacket";
import type { WorldDeltaPacket } from "../world/WorldDeltaPacket";
import type { StaticMapWirePacket } from "../shared/StaticMapPacket";
import type { LoadedCache } from "../util/Caches";
import type {
    RenderFrameInputUpdate,
    RenderMapRuntimeRegistrationInput,
    WorkerInputStateVersion,
} from "./WorkerRuntimeTypes";
import type {
    WorkerRuntimeOptions,
    WorkerSpawnBootstrap,
} from "./WorkerBuildTypes";
import { WorkerBuildService } from "./WorkerBuildService";
import { WorkerFramePacketRuntime } from "./WorkerFramePacketRuntime";

export type { WorkerRuntimeOptions, WorkerState } from "./WorkerBuildTypes";

type RenderDataWorkerServices = Readonly<{
    buildService: WorkerBuildService;
    frameRuntime: WorkerFramePacketRuntime;
}>;

let workerServicesPromise: Promise<RenderDataWorkerServices> | undefined;
const EMPTY_INT32 = new Int32Array(0);

function normalizeWorkerInt32Array(values: Int32Array): Int32Array {
    return values instanceof Int32Array && (values.length | 0) > 0 ? values : EMPTY_INT32;
}

async function getWorkerServices(): Promise<RenderDataWorkerServices> {
    const existing = workerServicesPromise;
    if (existing) {
        return await existing;
    }
    const created = Promise.resolve().then(() => {
        const buildService = new WorkerBuildService();
        const frameRuntime = new WorkerFramePacketRuntime(() => buildService.requireWorkerState());
        return {
            buildService,
            frameRuntime,
        };
    });
    workerServicesPromise = created.catch((error) => {
        workerServicesPromise = undefined;
        throw error;
    });
    return await workerServicesPromise;
}

const worker = {
    async initCache(
        cache: LoadedCache,
        spawnBootstrap: WorkerSpawnBootstrap,
        options?: WorkerRuntimeOptions,
    ): Promise<void> {
        const { buildService, frameRuntime } = await getWorkerServices();
        frameRuntime.resetForCache();
        await buildService.initCache(cache, spawnBootstrap, options);
    },
    async loadStaticMapPacket(
        input: SdMapLoaderInput,
    ): Promise<TransferDescriptor<StaticMapWirePacket | undefined>> {
        const { buildService } = await getWorkerServices();
        return buildService.maps.loadStaticMapPacket(input);
    },
    async loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<TransferDescriptor<Int32Array>> {
        const { buildService } = await getWorkerServices();
        return buildService.maps.loadTexture(id, size, flipH, brightness);
    },
    async loadMapImage(mapX: number, mapY: number, level: number, drawMapFunctions: boolean) {
        const { buildService } = await getWorkerServices();
        return buildService.maps.loadMapImage(mapX, mapY, level, drawMapFunctions);
    },
    async registerRenderMapRuntime(input: RenderMapRuntimeRegistrationInput): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        await frameRuntime.registerRenderMapRuntime(input);
    },
    async unregisterRenderMapRuntime(mapId: number, mapSimToken?: number): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        frameRuntime.unregisterRenderMapRuntime(mapId, mapSimToken);
    },
    async syncRenderFrameState(update: RenderFrameInputUpdate): Promise<WorkerInputStateVersion> {
        const { frameRuntime } = await getWorkerServices();
        return frameRuntime.applyRenderFrameInputUpdate({
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
            hoveredMapIdsPacked:
                update.hoveredMapIdsPacked !== undefined
                    ? normalizeWorkerInt32Array(update.hoveredMapIdsPacked)
                    : undefined,
        });
    },
    async applyWorldDeltaPacket(deltaPacket: WorldDeltaPacket): Promise<number> {
        const { frameRuntime } = await getWorkerServices();
        return await frameRuntime.applyWorldDeltaPacket(deltaPacket);
    },
    async buildRenderFramePacket(
        frameCount: number,
        cycleNow: number,
    ): Promise<TransferDescriptor<RenderFramePacket | undefined>> {
        const { frameRuntime } = await getWorkerServices();
        const packet = await frameRuntime.buildRenderFramePacket(frameCount, cycleNow);
        return packet
            ? Transfer<RenderFramePacket | undefined>(packet, renderFramePacketTransferables(packet))
            : Transfer<RenderFramePacket | undefined>(undefined, []);
    },
    async setVars(values: Int32Array): Promise<void> {
        const { buildService } = await getWorkerServices();
        await buildService.state.setVars(values);
    },
    async loadCachedMapImages(): Promise<Map<number, string>> {
        const { buildService } = await getWorkerServices();
        return buildService.maps.loadCachedMapImages();
    },
    async exportSpritesToZip(): Promise<Blob> {
        const { buildService } = await getWorkerServices();
        return buildService.assets.exportSpritesToZip();
    },
    async exportTexturesToZip(): Promise<Blob> {
        const { buildService } = await getWorkerServices();
        return buildService.assets.exportTexturesToZip();
    },
};

export type RenderDataWorker = typeof worker;

expose(worker);
