import { ModuleThread, Thread, spawn } from "threads";

import type { NpcEvent } from "../runtime/entities/NpcEvents";
import { encodeNpcLifecyclePacketFromLifecycleEvents } from "../runtime/packets/NpcLifecyclePacket";
import type { WorldDeltaPacket, WorldMapObjUpdate } from "../runtime/packets/WorldDeltaPacket";
import { LoadedCache } from "../util/Caches";
import type {
    MapRuntimeBootstrapInput,
    SimMapRuntimeRegistrationInput,
    WorkerRuntimeOptions,
    WorkerSpawnBootstrap,
    WorldInputUpdate,
} from "./WorkerContext";
import type { SimWorker } from "./SimWorker";
import { ensureWorkerSpawnBootstrap } from "./WorkerSpawnBootstrap";

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

    readonly world = {
        registerMapRuntime: (input: SimMapRuntimeRegistrationInput) => this.registerMapRuntime(input),
        bootstrapMapRuntime: (input: MapRuntimeBootstrapInput) => this.bootstrapMapRuntime(input),
        unregisterMapRuntime: (mapId: number, mapSimToken?: number) =>
            this.unregisterMapRuntime(mapId, mapSimToken),
        applyNpcLifecycleEvents: (events: ReadonlyArray<NpcEvent>) =>
            this.applyNpcLifecycleEvents(events),
        applyMapObjStateUpdates: (updates: ReadonlyArray<WorldMapObjUpdate>) =>
            this.applyMapObjStateUpdates(updates),
        syncState: (update: WorldInputUpdate) => this.syncWorldState(update),
        step: (
            frameCount: number,
            ticksElapsed: number,
            clientTicksElapsed: number,
            cycleNow: number,
        ) => this.stepWorld(frameCount, ticksElapsed, clientTicksElapsed, cycleNow),
    };

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

    private registerMapRuntime(input: SimMapRuntimeRegistrationInput): Promise<void> {
        return this.withWorker((w) => w.registerMapRuntime(input));
    }

    private bootstrapMapRuntime(input: MapRuntimeBootstrapInput): Promise<void> {
        return this.withWorker((w) => w.bootstrapMapRuntime(input));
    }

    private unregisterMapRuntime(mapId: number, mapSimToken?: number): Promise<void> {
        return this.withWorker((w) => w.unregisterMapRuntime(mapId, mapSimToken));
    }

    private applyNpcLifecyclePacketBytes(packet: ArrayBuffer | Uint8Array): Promise<number> {
        return this.withWorker((w) => w.applyNpcLifecyclePacketBytes(packet));
    }

    private applyNpcLifecycleEvents(events: ReadonlyArray<NpcEvent>): Promise<number> {
        if ((events.length | 0) <= 0) {
            return Promise.resolve(0);
        }
        return this.applyNpcLifecyclePacketBytes(
            encodeNpcLifecyclePacketFromLifecycleEvents(events),
        );
    }

    private applyMapObjStateUpdates(updates: ReadonlyArray<WorldMapObjUpdate>): Promise<number> {
        return this.withWorker((w) => w.applyMapObjStateUpdates(updates));
    }

    private syncWorldState(update: WorldInputUpdate): Promise<void> {
        return this.withWorker((w) => w.syncWorldState(update));
    }

    private stepWorld(
        frameCount: number,
        ticksElapsed: number,
        clientTicksElapsed: number,
        cycleNow: number,
    ): Promise<WorldDeltaPacket | undefined> {
        return this.withWorker((w) => w.stepWorld(frameCount, ticksElapsed, clientTicksElapsed, cycleNow));
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
