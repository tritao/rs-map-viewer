import { ModuleThread, Pool, spawn } from "threads";

import { fetchObjSpawns } from "../data/obj/ObjSpawn";
import { LoadedCache } from "../util/Caches";
import { MinimapData } from "../maprender/MinimapData";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./RenderDataWorkerTypes";
import type { RenderDataWorker } from "./RenderDataWorker";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import type { CollisionData } from "../rs/scene/CollisionMap";
import type { LocAnimatedData } from "../runtime/entities/LocAnimatedData";
import type { SdMapData } from "../maprender/payload/SdMapData";
import type { SdMapLoaderInput } from "../maprender/payload/SdMapLoaderInput";

type RenderDataWorkerThread = ModuleThread<RenderDataWorker>;
type WorkerDescriptorLike = Readonly<{ init: Promise<RenderDataWorkerThread> }>;

function spawnWorker(): Promise<RenderDataWorkerThread> {
    const worker = new Worker(new URL("./RenderDataWorker", import.meta.url), { type: "module" });
    return spawn<RenderDataWorker>(worker);
}

export class RenderDataWorkerPool {
    static create(size: number): RenderDataWorkerPool {
        const pool = Pool(() => spawnWorker(), size);
        const workers = pool["workers"] as WorkerDescriptorLike[];
        return new RenderDataWorkerPool(pool, workers, size);
    }

    constructor(
        readonly pool: Pool<RenderDataWorkerThread>,
        readonly workers: WorkerDescriptorLike[],
        readonly size: number,
    ) {}

    private readonly spawnBootstrapByCacheKey = new Map<string, Promise<WorkerSpawnBootstrap>>();
    private initPromise: Promise<void> | undefined;

    private getSpawnBootstrapCacheKey(cache: LoadedCache): string {
        const info = cache.info;
        return `${info.game}:${info.revision}:${info.name}`;
    }

    private ensureSpawnBootstrap(cache: LoadedCache): Promise<WorkerSpawnBootstrap> {
        const key = this.getSpawnBootstrapCacheKey(cache);
        const cached = this.spawnBootstrapByCacheKey.get(key);
        if (cached) {
            return cached;
        }
        const promise = fetchObjSpawns().then((objSpawns) => ({
            objSpawns,
        }));
        this.spawnBootstrapByCacheKey.set(key, promise);
        return promise;
    }

    private runInit(cache: LoadedCache, options?: WorkerRuntimeOptions): Promise<void> {
        return (async () => {
            const spawnBootstrap = await this.ensureSpawnBootstrap(cache);
            await this.runAll((w) => w.initCache(cache, spawnBootstrap, options));
        })();
    }

    private async awaitInitCache(): Promise<void> {
        const initPromise = this.initPromise;
        if (!initPromise) {
            throw new Error("RenderDataWorkerPool not initialized (call initCache first)");
        }
        await initPromise;
    }

    initCache(cache: LoadedCache, options?: WorkerRuntimeOptions): void {
        this.initPromise = this.runInit(cache, options);
        this.initPromise.catch((e) => {
            console.error("Failed to initialize render data worker", e);
        });
    }

    async initCacheAndWait(cache: LoadedCache, options?: WorkerRuntimeOptions): Promise<void> {
        this.initPromise = this.runInit(cache, options);
        await this.initPromise;
    }

    async runAll(task: (w: RenderDataWorkerThread) => any): Promise<void> {
        await Promise.all(this.workers.map((desc) => desc.init.then(task)));
    }

    private queue<T>(task: (w: RenderDataWorkerThread) => Promise<T>): Promise<T> {
        // `threads` pool returns a thenable task object; callers use it as a Promise.
        return this.pool.queue(async (w) => {
            await this.awaitInitCache();
            return task(w);
        }) as any;
    }

    queueSdMapData(input: SdMapLoaderInput): Promise<SdMapData | undefined> {
        return this.queue((w) => w.loadSdMapData(input) as any);
    }

    queueLoadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<Int32Array> {
        return this.queue((w) => w.loadTexture(id, size, flipH, brightness) as any);
    }

    queueMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ): Promise<MinimapData | undefined> {
        return this.queue((w) => w.loadMapImage(mapX, mapY, level, drawMapFunctions) as any);
    }

    setVars(vars: Int32Array): Promise<void> {
        return this.awaitInitCache().then(() => this.runAll((w) => w.setVars(vars)));
    }

    loadCachedMapImages(): Promise<Map<number, string>> {
        return this.queue((w) => w.loadCachedMapImages() as any);
    }

    exportSprites(): Promise<Blob> {
        return this.queue((w) => w.exportSpritesToZip() as any);
    }

    exportTextures(): Promise<Blob> {
        return this.queue((w) => w.exportTexturesToZip() as any);
    }

    // Dedicated worker for per-frame sim/tick packets. Keeping it sticky avoids state divergence.
    private getTickWorker(): Promise<RenderDataWorkerThread> {
        const desc = this.workers[0];
        if (!desc) {
            throw new Error("RenderDataWorkerPool has no workers");
        }
        return desc.init;
    }

    private async withTickWorker<T>(task: (w: RenderDataWorkerThread) => Promise<T>): Promise<T> {
        await this.awaitInitCache();
        const worker = await this.getTickWorker();
        return task(worker);
    }

    registerMapNpcSimState(
        mapId: number,
        maxLevel: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        collisionDatas: CollisionData[],
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcOrderKeys: Int32Array,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        return this.withTickWorker((w) =>
            w.registerMapNpcSimState(
                mapId,
                maxLevel,
                borderSize,
                tileRenderFlagsLevel1,
                collisionDatas,
                locsAnimated as any,
                npcOrderKeys,
                npcTypeAnimationTable,
                mapSimToken,
            ),
        );
    }

    unregisterMapNpcSimState(mapId: number, mapSimToken?: number): Promise<void> {
        return this.withTickWorker((w) => Promise.resolve(w.unregisterMapNpcSimState(mapId, mapSimToken)));
    }

    applyNpcLifecyclePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        return this.withTickWorker((w) => w.applyNpcLifecyclePacketBytes(packet));
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
        return this.withTickWorker((w) =>
            (w.tickFrame(
                frameCount,
                mapIds,
                ticksElapsed,
                clientTicksElapsed,
                cycleNow,
                cameraMapX,
                cameraMapY,
                lodDistance,
                hoveredMapIdsPacked,
            ) as any),
        );
    }

    terminate(): Promise<void> {
        return this.pool.terminate();
    }
}
