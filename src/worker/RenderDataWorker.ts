import { TransferDescriptor } from "threads";
import { Transfer, expose } from "threads/worker";

import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import type { MapObjRenderPacket } from "../renderer/MapObjRenderPacket";
import type { RenderFramePacket } from "../renderer/RenderFramePacket";
import { renderFramePacketTransferables } from "../renderer/RenderFramePacket";
import type { NpcStateDeltaPacket } from "../runtime/packets/NpcStateDeltaPacket";
import type { NpcTypeAnimationEntry } from "../runtime/NpcTypeAnimationTable";
import type { StaticMapWirePacket } from "../runtime/packets/StaticMapPacket";
import type { LocAnimatedData } from "../runtime/LocAnimatedData";
import type { LoadedCache } from "../util/Caches";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./WorkerContext";

export type { WorkerRuntimeOptions, WorkerState } from "./WorkerContext";

type RenderDataWorkerServices = Readonly<{
    buildService: import("./WorkerBuildService").WorkerBuildService;
    frameRuntime: import("./WorkerFramePacketRuntime").WorkerFramePacketRuntime;
}>;

let workerServicesPromise: Promise<RenderDataWorkerServices> | undefined;
let frameMapIdsVersion = 0;
let frameViewStateVersion = 0;
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
        frameMapIdsVersion = 0;
        frameViewStateVersion = 0;
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
    async setFrameMapIds(mapIds: Int32Array): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        frameRuntime.setVisibleMapIds(normalizeWorkerInt32Array(mapIds));
        frameMapIdsVersion = (frameMapIdsVersion + 1) | 0;
    },
    async setFrameViewState(
        cameraMapX: number,
        cameraMapY: number,
        lodDistance: number,
    ): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        frameRuntime.setViewState(cameraMapX, cameraMapY, lodDistance);
        frameViewStateVersion = (frameViewStateVersion + 1) | 0;
    },
    async setFrameHoveredMapIds(hoveredMapIdsPacked: Int32Array): Promise<void> {
        const { frameRuntime } = await getWorkerServices();
        frameRuntime.setHoveredMapIds(normalizeWorkerInt32Array(hoveredMapIdsPacked));
    },
    async applyNpcWorldStateDeltaPacket(deltaPacket: NpcStateDeltaPacket): Promise<number> {
        const { frameRuntime } = await getWorkerServices();
        if (
            (deltaPacket.mapIdsVersion | 0) !== (frameMapIdsVersion | 0) ||
            (deltaPacket.viewStateVersion | 0) !== (frameViewStateVersion | 0)
        ) {
            return 0;
        }
        const deltaFrameCount = deltaPacket.frameCount | 0;
        if (deltaFrameCount < (lastAppliedWorldDeltaFrameCount | 0)) {
            return 0;
        }
        if ((deltaPacket.eventCount | 0) <= 0) {
            return 0;
        }
        const applied = await frameRuntime.applyNpcWorldStateDeltaPacket(deltaPacket);
        if ((applied | 0) > 0) {
            lastAppliedWorldDeltaFrameCount = deltaFrameCount;
        }
        return applied | 0;
    },
    async applyMapObjRenderPacket(packet: MapObjRenderPacket | undefined): Promise<number> {
        const { frameRuntime } = await getWorkerServices();
        return frameRuntime.applyMapObjRenderPacket(packet);
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
