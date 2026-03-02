import { ModuleThread, Pool, spawn } from "threads";
import { QueuedTask } from "threads/dist/master/pool";
import { WorkerDescriptor } from "threads/dist/master/pool-types";
import { ObservablePromise } from "threads/dist/observable-promise";

import { NpcSpawn } from "../data/npc/NpcSpawn";
import { ObjSpawn } from "../data/obj/ObjSpawn";
import { LoadedCache } from "../util/Caches";
import { MinimapData } from "./MinimapData";
import { RenderDataLoader } from "./RenderDataLoader";
import { RenderDataWorker, WorkerRuntimeOptions } from "./RenderDataWorker";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import type { CollisionData } from "../rs/scene/CollisionMap";
import type { LocAnimatedData } from "../runtime/entities/LocAnimatedData";
import type { NpcSpawnEvent } from "../runtime/sim/NpcSpawnEvent";

type RenderDataWorkerThread = ModuleThread<RenderDataWorker>;

function spawnWorker(): Promise<RenderDataWorkerThread> {
    const worker = new Worker(new URL("./RenderDataWorker", import.meta.url), { type: "module" });
    return spawn<RenderDataWorker>(worker);
}

export class RenderDataWorkerPool {
    static create(size: number): RenderDataWorkerPool {
        const pool = Pool(() => spawnWorker(), size);
        const workers = pool["workers"] as WorkerDescriptor<RenderDataWorkerThread>[];
        return new RenderDataWorkerPool(pool, workers, size);
    }

    constructor(
        readonly pool: Pool<RenderDataWorkerThread>,
        readonly workers: WorkerDescriptor<RenderDataWorkerThread>[],
        readonly size: number,
    ) {}

    initCache(
        cache: LoadedCache,
        objSpawns: ObjSpawn[],
        npcSpawns: NpcSpawn[],
        options?: WorkerRuntimeOptions,
    ): void {
        for (const worker of this.workers) {
            worker.init.then((w) => w.initCache(cache, objSpawns, npcSpawns, options));
        }
    }

    initCacheAndWait(
        cache: LoadedCache,
        objSpawns: ObjSpawn[],
        npcSpawns: NpcSpawn[],
        options?: WorkerRuntimeOptions,
    ): Promise<void> {
        return this.runAll((w) => w.initCache(cache, objSpawns, npcSpawns, options));
    }

    async runAll(task: (w: RenderDataWorkerThread) => any): Promise<void> {
        await Promise.all(this.workers.map((desc) => desc.init.then(task)));
    }

    initLoader(loader: RenderDataLoader<any, any>): Promise<void> {
        return this.runAll((w) => w.initDataLoader(loader));
    }

    resetLoader(loader: RenderDataLoader<any, any>): Promise<void> {
        return this.runAll((w) => w.resetDataLoader(loader));
    }

    queueLoad<I, D, Loader extends RenderDataLoader<I, D>>(
        loader: Loader,
        input: I,
    ): QueuedTask<RenderDataWorkerThread, D> {
        return this.pool.queue((w) => w.load(loader, input) as ObservablePromise<D>);
    }

    queueLoadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): QueuedTask<RenderDataWorkerThread, Int32Array> {
        return this.pool.queue(
            (w) => w.loadTexture(id, size, flipH, brightness) as ObservablePromise<Int32Array>,
        );
    }

    queueMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ): QueuedTask<RenderDataWorkerThread, MinimapData | undefined> {
        return this.pool.queue((w) => w.loadMapImage(mapX, mapY, level, drawMapFunctions));
    }

    setVars(vars: Int32Array): Promise<void> {
        return this.runAll((w) => w.setVars(vars));
    }

    loadCachedMapImages(): QueuedTask<RenderDataWorkerThread, Map<number, string>> {
        return this.pool.queue((w) => w.loadCachedMapImages());
    }

    exportSprites(): QueuedTask<RenderDataWorkerThread, Blob> {
        return this.pool.queue((w) => w.exportSpritesToZip());
    }

    exportTextures(): QueuedTask<RenderDataWorkerThread, Blob> {
        return this.pool.queue((w) => w.exportTexturesToZip());
    }

    // Dedicated worker for per-frame sim/tick packets. Keeping it sticky avoids state divergence.
    private getTickWorker(): Promise<RenderDataWorkerThread> {
        const desc = this.workers[0];
        if (!desc) {
            throw new Error("RenderDataWorkerPool has no workers");
        }
        return desc.init;
    }

    registerMapNpcSimState(
        mapId: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        collisionDatas: CollisionData[],
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcEvents: ReadonlyArray<NpcSpawnEvent>,
        mapSimToken?: number,
    ): Promise<void> {
        return this.getTickWorker().then((w) =>
            w.registerMapNpcSimState(
                mapId,
                borderSize,
                tileRenderFlagsLevel1,
                collisionDatas,
                locsAnimated as any,
                npcEvents as any,
                mapSimToken,
            ),
        );
    }

    unregisterMapNpcSimState(mapId: number, mapSimToken?: number): Promise<void> {
        return this.getTickWorker().then((w) => w.unregisterMapNpcSimState(mapId, mapSimToken));
    }

    applyNpcUpdatePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        return this.getTickWorker().then((w) => w.applyNpcUpdatePacketBytes(packet));
    }

    tickFrame(
        frameCount: number,
        mapIds: Int32Array,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
        cameraMapX: number,
        cameraMapY: number,
        lodDistance: number,
        hoveredMapIdsPacked: Int32Array,
    ): Promise<FramePacket | undefined> {
        return this.getTickWorker().then((w) =>
            w.tickFrame(
                frameCount,
                mapIds,
                ticksElapsed,
                clientTicksElapsed,
                cycleNow,
                cameraMapX,
                cameraMapY,
                lodDistance,
                hoveredMapIdsPacked,
            ) as any,
        );
    }

    terminate(): Promise<void> {
        return this.pool.terminate();
    }
}
