import { ModuleThread, Thread, spawn } from "threads";

import type { NpcStateDeltaPacket } from "../runtime/contracts/NpcStateDeltaPacket";
import type { NpcTypeAnimationEntry } from "../runtime/contracts/NpcTypeAnimationTable";
import type { LocAnimatedData } from "../runtime/contracts/LocAnimatedData";
import { LoadedCache } from "../util/Caches";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./RenderDataWorkerTypes";
import type { SimWorker } from "./SimWorker";
import { ensureWorkerSpawnBootstrap } from "./SpawnBootstrapLoader";

type SimWorkerThread = ModuleThread<SimWorker>;

function spawnWorker(): Promise<SimWorkerThread> {
    const worker = new Worker(new URL("./SimWorker", import.meta.url), { type: "module" });
    return spawn<SimWorker>(worker);
}

export class SimWorkerPool {
    static create(): SimWorkerPool {
        return new SimWorkerPool();
    }

    private initPromise: Promise<void> | undefined;
    private workerPromise: Promise<SimWorkerThread> | undefined;

    private ensureSpawnBootstrap(cache: LoadedCache): Promise<WorkerSpawnBootstrap> {
        return ensureWorkerSpawnBootstrap(cache);
    }

    private getWorker(): Promise<SimWorkerThread> {
        if (!this.workerPromise) {
            this.workerPromise = spawnWorker();
        }
        return this.workerPromise;
    }

    private runInit(cache: LoadedCache, options?: WorkerRuntimeOptions): Promise<void> {
        return (async () => {
            const spawnBootstrap = await this.ensureSpawnBootstrap(cache);
            const worker = await this.getWorker();
            await worker.initCache(cache, spawnBootstrap, options);
        })();
    }

    private async awaitInitCache(): Promise<void> {
        const initPromise = this.initPromise;
        if (!initPromise) {
            throw new Error("SimWorkerPool not initialized (call initCache first)");
        }
        await initPromise;
    }

    private async withWorker<T>(task: (w: SimWorkerThread) => Promise<T>): Promise<T> {
        await this.awaitInitCache();
        const worker = await this.getWorker();
        return task(worker);
    }

    initCache(cache: LoadedCache, options?: WorkerRuntimeOptions): void {
        this.initPromise = this.runInit(cache, options);
        this.initPromise.catch((e) => {
            console.error("Failed to initialize sim worker", e);
        });
    }

    async initCacheAndWait(cache: LoadedCache, options?: WorkerRuntimeOptions): Promise<void> {
        this.initPromise = this.runInit(cache, options);
        await this.initPromise;
    }

    registerMapRuntime(
        mapId: number,
        borderSize: number,
        locsAnimated: ReadonlyArray<LocAnimatedData>,
        npcTypeAnimationTable: ReadonlyArray<NpcTypeAnimationEntry>,
        mapSimToken?: number,
    ): Promise<void> {
        return this.withWorker((w) =>
            w.registerMapRuntime(
                mapId,
                borderSize,
                locsAnimated,
                npcTypeAnimationTable,
                mapSimToken,
            ),
        );
    }

    bootstrapMapRuntime(
        mapId: number,
        maxLevel: number,
        npcOrderKeys: Int32Array,
        mapSimToken?: number,
    ): Promise<void> {
        return this.withWorker((w) => w.bootstrapMapRuntime(mapId, maxLevel, npcOrderKeys, mapSimToken));
    }

    unregisterMapRuntime(mapId: number, mapSimToken?: number): Promise<void> {
        return this.withWorker((w) => w.unregisterMapRuntime(mapId, mapSimToken));
    }

    applyNpcLifecyclePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        return this.withWorker((w) => w.applyNpcLifecyclePacketBytes(packet));
    }

    setTickMapIds(mapIds: Int32Array): Promise<void> {
        return this.withWorker((w) => w.setTickMapIds(mapIds));
    }

    setTickViewState(cameraMapX: number, cameraMapY: number, lodDistance: number): Promise<void> {
        return this.withWorker((w) => w.setTickViewState(cameraMapX, cameraMapY, lodDistance));
    }

    setTickHoveredMapIds(hoveredMapIdsPacked: Int32Array): Promise<void> {
        return this.withWorker((w) => w.setTickHoveredMapIds(hoveredMapIdsPacked));
    }

    tickSim(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
        hoveredMapIdsPacked?: Int32Array,
    ): Promise<NpcStateDeltaPacket | undefined> {
        return this.withWorker((w) =>
            w.tickSim(frameCount, ticksElapsed, clientTicksElapsed, cycleNow, hoveredMapIdsPacked),
        );
    }

    setVars(vars: Int32Array): Promise<void> {
        return this.withWorker((w) => w.setVars(vars));
    }

    async terminate(): Promise<void> {
        const worker = this.workerPromise ? await this.workerPromise : undefined;
        if (worker) {
            await Thread.terminate(worker);
        }
    }
}
