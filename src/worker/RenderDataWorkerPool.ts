import { ModuleThread, Pool, Thread, spawn } from "threads";

import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import { MinimapData } from "../maprender/ts/MinimapData";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import type { MapObjRenderPacket } from "../runtime/contracts/MapObjRenderPacket";
import type { NpcStateDeltaPacket } from "../runtime/contracts/NpcStateDeltaPacket";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import {
    decodeStaticMapWirePacket,
    type DecodedStaticMapPacket,
} from "../runtime/contracts/StaticMapPacket";
import type { LocAnimatedData } from "../runtime/contracts/LocAnimatedData";
import { LoadedCache } from "../util/Caches";
import type { RenderDataWorker } from "./RenderDataWorker";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./RenderDataWorkerTypes";
import { ensureWorkerSpawnBootstrap } from "./SpawnBootstrapLoader";

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

    private queue<T>(task: (w: RenderDataWorkerThread) => PromiseLike<T>): Promise<T> {
        // `threads` pool returns a thenable task object; callers use it as a Promise.
        return Promise.resolve(
            this.pool.queue(async (w) => {
                await this.awaitInitCache();
                return await task(w);
            }),
        );
    }

    queueStaticMapPacket(input: SdMapLoaderInput): Promise<DecodedStaticMapPacket | undefined> {
        return this.queue((w) => w.loadStaticMapPacket(input)).then((packet) =>
            packet ? decodeStaticMapWirePacket(packet) : undefined,
        );
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
        return this.awaitInitCache().then(async () => {
            await Promise.all([
                this.runAll((w) => w.setVars(vars)),
                this.withFrameWorker((w) => w.setVars(vars)),
            ]);
        });
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

    // Dedicated render-frame worker for NPC render state + frame packet build.
    private getFrameWorker(): Promise<RenderDataWorkerThread> {
        return this.frameWorkerPromise;
    }

    private async withFrameWorker<T>(task: (w: RenderDataWorkerThread) => Promise<T>): Promise<T> {
        await this.awaitInitCache();
        const worker = await this.getFrameWorker();
        return task(worker);
    }

    registerMapRuntime(
        mapId: number,
        borderSize: number,
        tileRenderFlagsLevel1: Uint8Array[],
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        return this.withFrameWorker((w) =>
            w.registerMapRuntime(
                mapId,
                borderSize,
                tileRenderFlagsLevel1,
                locsAnimated,
                npcTypeAnimationTable,
                mapSimToken,
            ),
        );
    }

    unregisterMapRuntime(mapId: number, mapSimToken?: number): Promise<void> {
        return this.withFrameWorker((w) => w.unregisterMapRuntime(mapId, mapSimToken));
    }

    setFrameTickMapIds(mapIds: Int32Array): Promise<void> {
        return this.withFrameWorker((w) => w.setFrameTickMapIds(mapIds));
    }

    setFrameTickViewState(
        cameraMapX: number,
        cameraMapY: number,
        lodDistance: number,
    ): Promise<void> {
        return this.withFrameWorker((w) =>
            w.setFrameTickViewState(cameraMapX, cameraMapY, lodDistance),
        );
    }

    setFrameTickHoveredMapIds(hoveredMapIdsPacked: Int32Array): Promise<void> {
        return this.withFrameWorker((w) => w.setFrameTickHoveredMapIds(hoveredMapIdsPacked));
    }

    applyNpcStateDeltaPacket(deltaPacket: NpcStateDeltaPacket): Promise<number> {
        return this.withFrameWorker((w) => w.applyNpcStateDeltaPacket(deltaPacket));
    }

    applyMapObjRenderPacket(packet: MapObjRenderPacket | undefined): Promise<number> {
        return this.withFrameWorker((w) => w.applyMapObjRenderPacket(packet));
    }

    buildFramePacketFromRenderState(
        frameCount: number,
        cycleNow: number,
    ): Promise<FramePacket | undefined> {
        return this.withFrameWorker((w) => w.buildFramePacketFromRenderState(frameCount, cycleNow));
    }

    async terminate(): Promise<void> {
        await this.pool.terminate();
        const frameWorker = await this.frameWorkerPromise;
        await Thread.terminate(frameWorker);
    }
}
