import { TransferDescriptor } from "threads";
import { Transfer, expose } from "threads/worker";

import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import { framePacketTransferables } from "../runtime/contracts/FramePacket";
import type { NpcStateDeltaPacket } from "../runtime/contracts/NpcStateDeltaPacket";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import type { StaticMapWirePacket } from "../runtime/contracts/StaticMapWireCodec";
import type { LocAnimatedData } from "../runtime/entities/LocAnimatedData";
import type { LoadedCache } from "../util/Caches";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./RenderDataWorkerTypes";

export type { WorkerRuntimeOptions, WorkerState } from "./RenderDataWorkerTypes";

type RenderDataWorkerServices = Readonly<{
    buildService: import("./RenderDataWorkerBuild").RenderDataWorkerBuild;
    frameRuntime: import("./tick/WorkerFramePacketRuntime").WorkerFramePacketRuntime;
}>;

let workerServicesPromise: Promise<RenderDataWorkerServices> | undefined;
let frameTickMapIdsVersion = 0;
let frameTickViewStateVersion = 0;
let lastAppliedDeltaFrameCount = -1;

async function getWorkerServices(): Promise<RenderDataWorkerServices> {
    const existing = workerServicesPromise;
    if (existing) {
        return await existing;
    }
    const created = (async () => {
        const [{ RenderDataWorkerBuild }, { WorkerFramePacketRuntime }] = await Promise.all([
            import("./RenderDataWorkerBuild"),
            import("./tick/WorkerFramePacketRuntime"),
        ]);
        const buildService = new RenderDataWorkerBuild();
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
        frameTickMapIdsVersion = 0;
        frameTickViewStateVersion = 0;
        lastAppliedDeltaFrameCount = -1;
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
    async registerMapRuntime(
        mapId: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        await frameRuntime.registerMapRuntime(
            mapId,
            borderSize,
            tileRenderFlagsLevel1,
            locsAnimated,
            npcTypeAnimationTable,
            mapSimToken,
        );
    },
    async unregisterMapRuntime(mapId: number, mapSimToken?: number): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        frameRuntime.unregisterMapRuntime(mapId, mapSimToken);
    },
    async setFrameTickMapIds(mapIds: Int32Array): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        frameRuntime.setTickMapIds(mapIds);
        frameTickMapIdsVersion = (frameTickMapIdsVersion + 1) | 0;
    },
    async setFrameTickViewState(
        cameraMapX: number,
        cameraMapY: number,
        lodDistance: number,
    ): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        frameRuntime.setTickViewState(cameraMapX, cameraMapY, lodDistance);
        frameTickViewStateVersion = (frameTickViewStateVersion + 1) | 0;
    },
    async setFrameTickHoveredMapIds(hoveredMapIdsPacked: Int32Array): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        frameRuntime.setTickHoveredMapIds(hoveredMapIdsPacked);
    },
    async applyNpcStateDeltaPacket(deltaPacket: NpcStateDeltaPacket): Promise<number> {
        const { frameRuntime } = await getWorkerServices();
        if (
            (deltaPacket.tickMapIdsVersion | 0) !== (frameTickMapIdsVersion | 0) ||
            (deltaPacket.tickViewStateVersion | 0) !== (frameTickViewStateVersion | 0)
        ) {
            return 0;
        }
        const deltaFrameCount = deltaPacket.frameCount | 0;
        if (deltaFrameCount < (lastAppliedDeltaFrameCount | 0)) {
            return 0;
        }
        if ((deltaPacket.eventCount | 0) <= 0) {
            return 0;
        }
        const applied = await frameRuntime.applyNpcStateDeltaPacket(deltaPacket);
        if ((applied | 0) > 0) {
            lastAppliedDeltaFrameCount = deltaFrameCount;
        }
        return applied | 0;
    },
    async buildFramePacketFromRenderState(
        frameCount: number,
        cycleNow: number,
    ): Promise<TransferDescriptor<FramePacket | undefined>> {
        const { frameRuntime } = await getWorkerServices();
        const packet = await frameRuntime.buildFramePacketFromCurrentState(frameCount, cycleNow);
        return packet
            ? Transfer<FramePacket | undefined>(packet, framePacketTransferables(packet))
            : Transfer<FramePacket | undefined>(undefined, []);
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
