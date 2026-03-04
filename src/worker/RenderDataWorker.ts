import { TransferDescriptor } from "threads";
import { Transfer, expose } from "threads/worker";

import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import { framePacketTransferables } from "../runtime/contracts/FramePacket";
import type { NpcStateDeltaPacket } from "../runtime/contracts/NpcStateDeltaPacket";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import type { StaticMapPacket } from "../runtime/contracts/StaticMapPacket";
import type { LocAnimatedData } from "../runtime/entities/LocAnimatedData";
import type { LoadedCache } from "../util/Caches";
import { RenderDataWorkerBuild } from "./RenderDataWorkerBuild";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./RenderDataWorkerTypes";
import { WorkerFramePacketRuntime } from "./tick/WorkerFramePacketRuntime";

export type { WorkerRuntimeOptions, WorkerState } from "./RenderDataWorkerTypes";

const buildService = new RenderDataWorkerBuild();
const frameRuntime = new WorkerFramePacketRuntime(() => buildService.requireWorkerState());
let frameTickMapIdsVersion = 0;
let frameTickViewStateVersion = 0;
let lastAppliedDeltaFrameCount = -1;

const worker = {
    async initCache(
        cache: LoadedCache,
        spawnBootstrap: WorkerSpawnBootstrap,
        options?: WorkerRuntimeOptions,
    ): Promise<void> {
        frameRuntime.resetForCache();
        frameTickMapIdsVersion = 0;
        frameTickViewStateVersion = 0;
        lastAppliedDeltaFrameCount = -1;
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
    async loadMapImage(mapX: number, mapY: number, level: number, drawMapFunctions: boolean) {
        return buildService.loadMapImage(mapX, mapY, level, drawMapFunctions);
    },
    async registerMapNpcRenderState(
        mapId: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        await frameRuntime.registerMapNpcRenderState(
            mapId,
            borderSize,
            tileRenderFlagsLevel1,
            locsAnimated,
            npcTypeAnimationTable,
            mapSimToken,
        );
    },
    unregisterMapNpcRenderState(mapId: number, mapSimToken?: number): void {
        frameRuntime.unregisterMapNpcRenderState(mapId, mapSimToken);
    },
    setFrameTickMapIds(mapIds: Int32Array): void {
        frameRuntime.setTickMapIds(mapIds);
        frameTickMapIdsVersion = (frameTickMapIdsVersion + 1) | 0;
    },
    setFrameTickViewState(cameraMapX: number, cameraMapY: number, lodDistance: number): void {
        frameRuntime.setTickViewState(cameraMapX, cameraMapY, lodDistance);
        frameTickViewStateVersion = (frameTickViewStateVersion + 1) | 0;
    },
    setFrameTickHoveredMapIds(hoveredMapIdsPacked: Int32Array): void {
        frameRuntime.setTickHoveredMapIds(hoveredMapIdsPacked);
    },
    async applyNpcStateDeltaPacket(deltaPacket: NpcStateDeltaPacket): Promise<number> {
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
        const packet = await frameRuntime.buildFramePacketFromCurrentState(frameCount, cycleNow);
        return packet
            ? Transfer<FramePacket | undefined>(packet, framePacketTransferables(packet))
            : Transfer<FramePacket | undefined>(undefined, []);
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
