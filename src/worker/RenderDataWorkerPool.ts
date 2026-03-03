import { ModuleThread, Pool, spawn } from "threads";

import { fetchObjSpawns } from "../data/obj/ObjSpawn";
import { LoadedCache } from "../util/Caches";
import { MinimapData } from "../maprender/ts/MinimapData";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./RenderDataWorkerTypes";
import type { RenderDataWorker } from "./RenderDataWorker";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import type { LocAnimatedData } from "../runtime/entities/LocAnimatedData";
import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import type { StaticMapPacket } from "../runtime/contracts/StaticMapPacket";

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

    private queue<T>(task: (w: RenderDataWorkerThread) => PromiseLike<T>): Promise<T> {
        // `threads` pool returns a thenable task object; callers use it as a Promise.
        return Promise.resolve(
            this.pool.queue(async (w) => {
                await this.awaitInitCache();
                return await task(w);
            }),
        );
    }

    queueStaticMapPacket(input: SdMapLoaderInput): Promise<StaticMapPacket | undefined> {
        return this.queue((w) => w.loadStaticMapPacket(input));
    }

    queueLoadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<Int32Array> {
        return this.queue((w) => w.loadTexture(id, size, flipH, brightness));
    }

    queueMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ): Promise<MinimapData | undefined> {
        return this.queue((w) => w.loadMapImage(mapX, mapY, level, drawMapFunctions));
    }

    setVars(vars: Int32Array): Promise<void> {
        return this.awaitInitCache().then(() => this.runAll((w) => w.setVars(vars)));
    }

    loadCachedMapImages(): Promise<Map<number, string>> {
        return this.queue((w) => w.loadCachedMapImages());
    }

    exportSprites(): Promise<Blob> {
        return this.queue((w) => w.exportSpritesToZip());
    }

    exportTextures(): Promise<Blob> {
        return this.queue((w) => w.exportTexturesToZip());
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
        borderSize: number,
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        return this.withTickWorker((w) =>
            w.registerMapNpcSimState(
                mapId,
                borderSize,
                locsAnimated,
                npcTypeAnimationTable,
                mapSimToken,
            ),
        );
    }

    bootstrapMapNpcLifecycle(
        mapId: number,
        maxLevel: number,
        npcOrderKeys: Int32Array,
        mapSimToken?: number,
    ): Promise<void> {
        return this.withTickWorker((w) =>
            w.bootstrapMapNpcLifecycle(
                mapId,
                maxLevel,
                npcOrderKeys,
                mapSimToken,
            ),
        );
    }

    unregisterMapNpcSimState(mapId: number, mapSimToken?: number): Promise<void> {
        return this.withTickWorker((w) => w.unregisterMapNpcSimState(mapId, mapSimToken));
    }

    applyNpcLifecyclePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        return this.withTickWorker((w) => w.applyNpcLifecyclePacketBytes(packet));
    }

    setTickMapIds(mapIds: Int32Array): Promise<void> {
        return this.withTickWorker((w) => w.setTickMapIds(mapIds));
    }

    setTickViewState(cameraMapX: number, cameraMapY: number, lodDistance: number): Promise<void> {
        return this.withTickWorker((w) =>
            w.setTickViewState(cameraMapX, cameraMapY, lodDistance),
        );
    }

    setTickHoveredMapIds(hoveredMapIdsPacked: Int32Array): Promise<void> {
        return this.withTickWorker((w) => w.setTickHoveredMapIds(hoveredMapIdsPacked));
    }

    tickFrame(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
        hoveredMapIdsPacked?: Int32Array,
    ): Promise<FramePacket | undefined> {
        return this.withTickWorker((w) =>
            w.tickFrame(
                frameCount,
                ticksElapsed,
                clientTicksElapsed,
                cycleNow,
                hoveredMapIdsPacked,
            ),
        );
    }

    terminate(): Promise<void> {
        return this.pool.terminate();
    }
}
