import { ModuleThread, Pool, Thread, spawn } from "threads";

import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import { MinimapData } from "../maprender/ts/MinimapData";
import type { RenderFramePacket } from "../renderer/RenderFramePacket";
import type { WorldDeltaPacket } from "../runtime/packets/WorldDeltaPacket";
import {
    decodeStaticMapWirePacket,
    type DecodedStaticMapPacket,
} from "../runtime/packets/StaticMapPacket";
import { LoadedCache } from "../util/Caches";
import type { RenderDataWorker } from "./RenderDataWorker";
import type {
    RenderFrameInputUpdate,
    RenderMapRuntimeRegistrationInput,
    WorkerInputStateVersion,
    WorkerRuntimeOptions,
    WorkerSpawnBootstrap,
} from "./WorkerContext";
import { ensureWorkerSpawnBootstrap } from "./WorkerSpawnBootstrap";

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
        return new RenderDataWorkerPool(pool, workers, size, spawnWorker());
    }

    constructor(
        readonly pool: Pool<RenderDataWorkerThread>,
        readonly workers: WorkerDescriptorLike[],
        readonly size: number,
        readonly frameWorkerPromise: Promise<RenderDataWorkerThread>,
    ) {}

    readonly build = {
        loadStaticMapPacket: (input: SdMapLoaderInput) => this.loadStaticMapPacket(input),
        loadTexture: (id: number, size: number, flipH: boolean, brightness: number) =>
            this.loadTexture(id, size, flipH, brightness),
        loadMapImage: (
            mapX: number,
            mapY: number,
            level: number,
            drawMapFunctions: boolean,
        ) => this.loadMapImage(mapX, mapY, level, drawMapFunctions),
        loadCachedMapImages: () => this.loadCachedMapImages(),
        exportSprites: () => this.exportSprites(),
        exportTextures: () => this.exportTextures(),
    };

    readonly frame = {
        registerMapRuntime: (input: RenderMapRuntimeRegistrationInput) =>
            this.registerRenderMapRuntime(input),
        unregisterMapRuntime: (mapId: number, mapSimToken?: number) =>
            this.unregisterRenderMapRuntime(mapId, mapSimToken),
        syncState: (update: RenderFrameInputUpdate) => this.syncRenderFrameState(update),
        applyWorldDelta: (deltaPacket: WorldDeltaPacket) => this.applyWorldDeltaPacket(deltaPacket),
        buildPacket: (frameCount: number, cycleNow: number) =>
            this.buildRenderFramePacket(frameCount, cycleNow),
    };

    private initPromise: Promise<void> | undefined;

    private ensureSpawnBootstrap(cache: LoadedCache): Promise<WorkerSpawnBootstrap> {
        return ensureWorkerSpawnBootstrap(cache);
    }

    private runInit(cache: LoadedCache, options?: WorkerRuntimeOptions): Promise<void> {
        return (async () => {
            const spawnBootstrap = await this.ensureSpawnBootstrap(cache);
            await Promise.all([
                this.runAll((w) => w.initCache(cache, spawnBootstrap, options)),
                this.frameWorkerPromise.then((w) => w.initCache(cache, spawnBootstrap, options)),
            ]);
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

    private queueBuildTask<T>(task: (w: RenderDataWorkerThread) => PromiseLike<T>): Promise<T> {
        // `threads` pool returns a thenable task object; callers use it as a Promise.
        return Promise.resolve(
            this.pool.queue(async (w) => {
                await this.awaitInitCache();
                return await task(w);
            }),
        );
    }

    private loadStaticMapPacket(input: SdMapLoaderInput): Promise<DecodedStaticMapPacket | undefined> {
        return this.queueBuildTask((w) => w.loadStaticMapPacket(input)).then((packet) =>
            packet ? decodeStaticMapWirePacket(packet) : undefined,
        );
    }

    private loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<Int32Array> {
        return this.queueBuildTask((w) => w.loadTexture(id, size, flipH, brightness));
    }

    private loadMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ): Promise<MinimapData | undefined> {
        return this.queueBuildTask((w) => w.loadMapImage(mapX, mapY, level, drawMapFunctions));
    }

    setVars(vars: Int32Array): Promise<void> {
        return this.awaitInitCache().then(async () => {
            await Promise.all([
                this.runAll((w) => w.setVars(vars)),
                this.withRenderFrameWorker((w) => w.setVars(vars)),
            ]);
        });
    }

    private loadCachedMapImages(): Promise<Map<number, string>> {
        return this.queueBuildTask((w) => w.loadCachedMapImages());
    }

    private exportSprites(): Promise<Blob> {
        return this.queueBuildTask((w) => w.exportSpritesToZip());
    }

    private exportTextures(): Promise<Blob> {
        return this.queueBuildTask((w) => w.exportTexturesToZip());
    }

    private getRenderFrameWorker(): Promise<RenderDataWorkerThread> {
        return this.frameWorkerPromise;
    }

    private async withRenderFrameWorker<T>(
        task: (w: RenderDataWorkerThread) => Promise<T>,
    ): Promise<T> {
        await this.awaitInitCache();
        const worker = await this.getRenderFrameWorker();
        return task(worker);
    }

    private registerRenderMapRuntime(input: RenderMapRuntimeRegistrationInput): Promise<void> {
        return this.withRenderFrameWorker((w) => w.registerRenderMapRuntime(input));
    }

    private unregisterRenderMapRuntime(mapId: number, mapSimToken?: number): Promise<void> {
        return this.withRenderFrameWorker((w) => w.unregisterRenderMapRuntime(mapId, mapSimToken));
    }

    private syncRenderFrameState(update: RenderFrameInputUpdate): Promise<WorkerInputStateVersion> {
        return this.withRenderFrameWorker((w) => w.syncRenderFrameState(update));
    }

    private applyWorldDeltaPacket(deltaPacket: WorldDeltaPacket): Promise<number> {
        return this.withRenderFrameWorker((w) => w.applyWorldDeltaPacket(deltaPacket));
    }

    private buildRenderFramePacket(
        frameCount: number,
        cycleNow: number,
    ): Promise<RenderFramePacket | undefined> {
        return this.withRenderFrameWorker((w) => w.buildRenderFramePacket(frameCount, cycleNow));
    }

    async terminate(): Promise<void> {
        await this.pool.terminate();
        const frameWorker = await this.frameWorkerPromise;
        await Thread.terminate(frameWorker);
    }
}
