import { ModuleThread, Thread, spawn } from "threads";

import type { NpcEvent } from "../runtime/entities/NpcEvents";
import { encodeNpcLifecyclePacketFromLifecycleEvents } from "./NpcLifecyclePacket";
import type {
    WorldDeltaPacket,
    WorldMapObjAddition,
    WorldLocAnimationPauseState,
    WorldLocAnimationReset,
    WorldMapObjRemoval,
    WorldMapObjStateReplacement,
} from "../world/WorldDeltaPacket";
import {
    getValidatedStaticMapNpcOrderKeys,
    type StaticMapPacket,
} from "../shared/StaticMapPacket";
import { LoadedCache } from "../util/Caches";
import type {
    MapRuntimeBootstrapInput,
    SimMapRuntimeRegistrationInput,
    WorldInputUpdate,
} from "./WorkerRuntimeTypes";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap } from "./WorkerBuildTypes";
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
        activateLoadedMap: (packet: StaticMapPacket, mapSimToken: number) =>
            this.activateLoadedMap(packet, mapSimToken),
        deactivateLoadedMap: (mapId: number, mapSimToken?: number) =>
            this.deactivateLoadedMap(mapId, mapSimToken),
        registerMapRuntime: (input: SimMapRuntimeRegistrationInput) => this.registerMapRuntime(input),
        bootstrapMapRuntime: (input: MapRuntimeBootstrapInput) => this.bootstrapMapRuntime(input),
        unregisterMapRuntime: (mapId: number, mapSimToken?: number) =>
            this.unregisterMapRuntime(mapId, mapSimToken),
        applyNpcLifecycleEvents: (events: ReadonlyArray<NpcEvent>) =>
            this.applyNpcLifecycleEvents(events),
        applyMapObjStateReplacements: (stateReplacements: ReadonlyArray<WorldMapObjStateReplacement>) =>
            this.applyMapObjStateReplacements(stateReplacements),
        applyMapObjAdditions: (additions: ReadonlyArray<WorldMapObjAddition>) =>
            this.applyMapObjAdditions(additions),
        applyMapObjRemovals: (removals: ReadonlyArray<WorldMapObjRemoval>) =>
            this.applyMapObjRemovals(removals),
        applyDynamicMapObjSpawns: (
            spawns: ReadonlyArray<
                Readonly<{
                    mapId: number;
                    objTypeId: number;
                    count: number;
                    x: number;
                    y: number;
                    plane: number;
                }>
            >,
        ) => this.applyDynamicMapObjSpawns(spawns),
        applyDynamicMapObjDespawns: (
            despawns: ReadonlyArray<
                Readonly<{
                    mapId: number;
                    runtimeObjId: number;
                }>
            >,
        ) => this.applyDynamicMapObjDespawns(despawns),
        clearDynamicMapObjs: (mapIds: ReadonlyArray<number>) => this.clearDynamicMapObjs(mapIds),
        applyLocAnimationResets: (resets: ReadonlyArray<WorldLocAnimationReset>) =>
            this.applyLocAnimationResets(resets),
        applyLocAnimationPauseStates: (
            pauseStates: ReadonlyArray<WorldLocAnimationPauseState>,
        ) => this.applyLocAnimationPauseStates(pauseStates),
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

    private activateLoadedMap(packet: StaticMapPacket, mapSimToken: number): Promise<void> {
        const npcTypeAnimationTable = packet.runtimeRegistration.npcTypeAnimationTable;
        return this.registerMapRuntime({
            mapId: packet.mapData.mapId | 0,
            borderSize: packet.runtimeRegistration.borderSize,
            locsAnimated: packet.runtimeRegistration.locsAnimated,
            npcTypeAnimationTable,
            mapSimToken,
        }).then(() =>
            this.bootstrapMapRuntime({
                mapId: packet.mapData.mapId | 0,
                maxLevel: packet.mapData.maxLevel | 0,
                npcOrderKeys: getValidatedStaticMapNpcOrderKeys(packet),
                mapObjState: packet.runtimeBootstrap.mapObjState,
                mapSimToken,
            }),
        );
    }

    private deactivateLoadedMap(mapId: number, mapSimToken?: number): Promise<void> {
        return this.unregisterMapRuntime(mapId, mapSimToken);
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

    private applyMapObjStateReplacements(
        stateReplacements: ReadonlyArray<WorldMapObjStateReplacement>,
    ): Promise<number> {
        return this.withWorker((w) => w.applyMapObjStateReplacements(stateReplacements));
    }

    private applyMapObjAdditions(additions: ReadonlyArray<WorldMapObjAddition>): Promise<number> {
        return this.withWorker((w) => w.applyMapObjAdditions(additions));
    }

    private applyMapObjRemovals(removals: ReadonlyArray<WorldMapObjRemoval>): Promise<number> {
        return this.withWorker((w) => w.applyMapObjRemovals(removals));
    }

    private applyDynamicMapObjSpawns(
        spawns: ReadonlyArray<
            Readonly<{
                mapId: number;
                objTypeId: number;
                count: number;
                x: number;
                y: number;
                plane: number;
            }>
        >,
    ): Promise<number> {
        return this.withWorker((w) => w.applyDynamicMapObjSpawns(spawns));
    }

    private applyDynamicMapObjDespawns(
        despawns: ReadonlyArray<
            Readonly<{
                mapId: number;
                runtimeObjId: number;
            }>
        >,
    ): Promise<number> {
        return this.withWorker((w) => w.applyDynamicMapObjDespawns(despawns));
    }

    private clearDynamicMapObjs(mapIds: ReadonlyArray<number>): Promise<number> {
        return this.withWorker((w) => w.clearDynamicMapObjs(mapIds));
    }

    private applyLocAnimationResets(
        resets: ReadonlyArray<WorldLocAnimationReset>,
    ): Promise<number> {
        return this.withWorker((w) => w.applyLocAnimationResets(resets));
    }

    private applyLocAnimationPauseStates(
        pauseStates: ReadonlyArray<WorldLocAnimationPauseState>,
    ): Promise<number> {
        return this.withWorker((w) => w.applyLocAnimationPauseStates(pauseStates));
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
