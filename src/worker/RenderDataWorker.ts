import { TransferDescriptor } from "threads";
import { registerSerializer } from "threads";
import { Transfer, expose } from "threads/worker";

import type { NpcSpawn } from "../data/npc/NpcSpawn";
import type { ObjSpawn } from "../data/obj/ObjSpawn";
import type { LocAnimatedData } from "../runtime/entities/LocAnimatedData";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import { framePacketTransferables } from "../runtime/contracts/FramePacket";
import type { CollisionData } from "../rs/scene/CollisionMap";
import type { LoadedCache } from "../util/Caches";
import { RenderDataLoader, renderDataLoaderSerializer } from "./RenderDataLoader";
import type { NpcSpawnEvent } from "../runtime/sim/NpcEvents";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import { RenderDataWorkerBuild } from "./RenderDataWorkerBuild";
import { WorkerTickRuntime } from "./runtime/WorkerTickRuntime";
import type { WorkerRuntimeOptions } from "./RenderDataWorkerTypes";
export type { WorkerRuntimeOptions, WorkerState } from "./RenderDataWorkerTypes";

registerSerializer(renderDataLoaderSerializer);

const buildService = new RenderDataWorkerBuild();
const tickRuntime = new WorkerTickRuntime(() => buildService.requireWorkerState());

const worker = {
    async initCache(
        cache: LoadedCache,
        objSpawns: ObjSpawn[],
        npcSpawns: NpcSpawn[],
        options?: WorkerRuntimeOptions,
    ): Promise<void> {
        tickRuntime.setRuntimeOptions(options);
        tickRuntime.resetForCache();
        await buildService.initCache(cache, objSpawns, npcSpawns, options);
    },
    initDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        buildService.initDataLoader(dataLoader);
    },
    async resetDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        tickRuntime.resetForLoaderReset();
        await buildService.resetDataLoader(dataLoader);
    },
    async load<I, D>(
        dataLoader: RenderDataLoader<I, D>,
        input: I,
    ): Promise<TransferDescriptor<D> | undefined> {
        return buildService.load(dataLoader, input);
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
    async registerMapNpcSimState(
        mapId: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        collisionDatas: CollisionData[],
        locsAnimated: LocAnimatedData[],
        npcEventsIn: NpcSpawnEvent[],
        npcTypeAnimationTableIn: NpcTypeAnimationEntry[],
        mapSimToken?: number,
    ): Promise<void> {
        await tickRuntime.registerMapNpcSimState(
            mapId,
            borderSize,
            tileRenderFlagsLevel1,
            collisionDatas,
            locsAnimated,
            npcEventsIn,
            npcTypeAnimationTableIn,
            mapSimToken,
        );
    },
    unregisterMapNpcSimState(mapId: number, mapSimToken?: number): void {
        tickRuntime.unregisterMapNpcSimState(mapId, mapSimToken);
    },
    async applyNpcUpdatePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        return tickRuntime.applyNpcUpdatePacketBytes(packet);
    },
    async tickFrame(
        frameCount: number,
        mapIds: Int32Array,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
        cameraMapX: number,
        cameraMapY: number,
        lodDistance: number,
        hoveredMapIdsPacked: Int32Array,
    ): Promise<TransferDescriptor<FramePacket | undefined>> {
        const packet = await tickRuntime.tickFrame(
            frameCount,
            mapIds,
            ticksElapsed,
            clientTicksElapsed,
            cycleNow,
            cameraMapX,
            cameraMapY,
            lodDistance,
            hoveredMapIdsPacked,
        );
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
