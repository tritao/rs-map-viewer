import { TransferDescriptor } from "threads";
import { Transfer, expose } from "threads/worker";

import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import type { RenderFramePacket } from "../renderer/RenderFramePacket";
import { renderFramePacketTransferables } from "../renderer/RenderFramePacket";
import type { WorldDeltaPacket } from "../runtime/packets/WorldDeltaPacket";
import type { StaticMapWirePacket } from "../runtime/packets/StaticMapPacket";
import type { LoadedCache } from "../util/Caches";
import type {
    RenderFrameInputUpdate,
    RenderMapRuntimeRegistrationInput,
    WorkerInputStateVersion,
    WorkerRuntimeOptions,
    WorkerSpawnBootstrap,
} from "./WorkerContext";

export type { WorkerRuntimeOptions, WorkerState } from "./WorkerContext";

type RenderDataWorkerServices = Readonly<{
    buildService: import("./WorkerBuildService").WorkerBuildService;
    frameRuntime: import("./WorkerFramePacketRuntime").WorkerFramePacketRuntime;
}>;

let workerServicesPromise: Promise<RenderDataWorkerServices> | undefined;
let lastAppliedWorldDeltaFrameCount = -1;
const EMPTY_INT32 = new Int32Array(0);

function normalizeWorkerInt32Array(values: Int32Array): Int32Array {
    return values instanceof Int32Array && (values.length | 0) > 0 ? values : EMPTY_INT32;
}

async function getWorkerServices(): Promise<RenderDataWorkerServices> {
    const existing = workerServicesPromise;
    if (existing) {
        return await existing;
    }
    const created = (async () => {
        const [{ WorkerBuildService }, { WorkerFramePacketRuntime }] = await Promise.all([
            import("./WorkerBuildService"),
            import("./WorkerFramePacketRuntime"),
        ]);
        const buildService = new WorkerBuildService();
        const frameRuntime = new WorkerFramePacketRuntime(() => buildService.requireWorkerState());
        return {
            buildService,
            frameRuntime,
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
        const { buildService, frameRuntime } = await getWorkerServices();
        frameRuntime.resetForCache();
        lastAppliedWorldDeltaFrameCount = -1;
        await buildService.initCache(cache, spawnBootstrap, options);
    },
    async loadStaticMapPacket(
        input: SdMapLoaderInput,
    ): Promise<TransferDescriptor<StaticMapWirePacket | undefined>> {
        const { buildService } = await getWorkerServices();
        return buildService.loadStaticMapPacket(input);
    },
    async loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<TransferDescriptor<Int32Array>> {
        const { buildService } = await getWorkerServices();
        return buildService.loadTexture(id, size, flipH, brightness);
    },
    async loadMapImage(mapX: number, mapY: number, level: number, drawMapFunctions: boolean) {
        const { buildService } = await getWorkerServices();
        return buildService.loadMapImage(mapX, mapY, level, drawMapFunctions);
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
        const hasNpcEvents = ((deltaPacket.npcDelta?.eventCount ?? 0) | 0) > 0;
        if (
            hasNpcEvents &&
            !frameRuntime.hasCompatibleInputStateVersion(deltaPacket.inputStateVersion | 0)
        ) {
            return 0;
        }
        const deltaFrameCount = deltaPacket.frameCount | 0;
        if (hasNpcEvents && deltaFrameCount < (lastAppliedWorldDeltaFrameCount | 0)) {
            return 0;
        }
        const applied = await frameRuntime.applyWorldDeltaPacket(deltaPacket);
        if (hasNpcEvents && (applied | 0) > 0) {
            lastAppliedWorldDeltaFrameCount = deltaFrameCount;
        }
        return applied | 0;
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
        await buildService.setVars(values);
    },
    async loadCachedMapImages(): Promise<Map<number, string>> {
        const { buildService } = await getWorkerServices();
        return buildService.loadCachedMapImages();
    },
    async exportSpritesToZip(): Promise<Blob> {
        const { buildService } = await getWorkerServices();
        return buildService.exportSpritesToZip();
    },
    async exportTexturesToZip(): Promise<Blob> {
        const { buildService } = await getWorkerServices();
        return buildService.exportTexturesToZip();
    },
};

export type RenderDataWorker = typeof worker;

expose(worker);
