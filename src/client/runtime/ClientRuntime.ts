import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type {
    DownloadProgress,
    ProgressListener,
} from "../../rs/cache/platform/CacheLoader";
import type { CacheSession } from "../../rs/loaders/CacheSession";
import type { BackendKind } from "../../util/BackendKind";
import type { LoadedCache } from "../../util/Caches";
import type { RenderFrameCoordinator } from "../../renderer/RenderFrameCoordinator";
import { RenderDataWorkerPool } from "../../worker/RenderDataWorkerPool";
import { SimWorkerPool } from "../../worker/SimWorkerPool";
import type { WorldToClientWorldAdapter } from "../../world/WorldToClientWorldAdapter";
import type {
    WorldMutationInput,
    WorldSession,
} from "../../world/WorldSession";
import type { ClientCommandService } from "../actions/ClientCommandService";
import type { ClientCommandRuntime } from "./ClientCommandRuntime";
import type { ClientWorldState } from "../world/ClientWorldState";
import type { WorldInteractionIndex } from "../world/WorldInteractionIndex";

export type ClientRuntimeCacheContext = Readonly<{
    loadedCache: LoadedCache;
    session: CacheSession;
}>;

export type ClientRuntimeOptions = Readonly<{
    mapRenderBackend: BackendKind;
    mapRenderTelemetry: boolean;
}>;

export type CacheSwitchStatus =
    | { state: "idle" }
    | { state: "switching"; cacheName: string; progress?: DownloadProgress }
    | { state: "error"; cacheName: string; message: string };

type CacheSwitchStatusListener = (status: CacheSwitchStatus) => void;

type ClientRuntimeDeps = Readonly<{
    clientCommands: ClientCommandService;
    clientCommandRuntime: ClientCommandRuntime;
    clientWorldState: ClientWorldState;
    worldToClientWorldAdapter: WorldToClientWorldAdapter;
    worldInteractionIndex: WorldInteractionIndex;
    worldSession: WorldSession;
    renderFrameCoordinator: RenderFrameCoordinator;
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
    cacheContext: ClientRuntimeCacheContext;
    runtimeOptions: ClientRuntimeOptions;
    loadCacheContext(
        cacheInfo: CacheInfo,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<ClientRuntimeCacheContext>;
    hasLoadedMap(mapId: number): boolean;
    reloadLoadedMap(mapId: number): Promise<boolean>;
    onClientReset(): Promise<void>;
}>;

export class ClientRuntime {
    readonly clientCommands: ClientCommandService;
    readonly clientCommandRuntime: ClientCommandRuntime;
    readonly clientWorldState: ClientWorldState;
    readonly worldToClientWorldAdapter: WorldToClientWorldAdapter;
    readonly worldInteractionIndex: WorldInteractionIndex;
    readonly worldSession: WorldSession;
    readonly renderFrameCoordinator: RenderFrameCoordinator;

    private cacheContext: ClientRuntimeCacheContext;
    private runtimeOptions: ClientRuntimeOptions;
    private stagedCacheContext?: ClientRuntimeCacheContext;
    private stagedRuntimeOptions?: ClientRuntimeOptions;
    private readonly cacheSwitchListeners = new Set<CacheSwitchStatusListener>();
    private cacheSwitchStatus: CacheSwitchStatus = { state: "idle" };
    private cacheSwitchNonce: number = 0;
    private cacheSwitchAbortController?: AbortController;

    constructor(private readonly deps: ClientRuntimeDeps) {
        this.cacheContext = deps.cacheContext;
        this.runtimeOptions = deps.runtimeOptions;
        this.clientCommands = deps.clientCommands;
        this.clientCommandRuntime = deps.clientCommandRuntime;
        this.clientWorldState = deps.clientWorldState;
        this.worldToClientWorldAdapter = deps.worldToClientWorldAdapter;
        this.worldInteractionIndex = deps.worldInteractionIndex;
        this.worldSession = deps.worldSession;
        this.renderFrameCoordinator = deps.renderFrameCoordinator;
    }

    get loadedCache(): LoadedCache {
        return this.getEffectiveCacheContext().loadedCache;
    }

    get session(): CacheSession {
        return this.getEffectiveCacheContext().session;
    }

    getRuntimeOptions(): ClientRuntimeOptions {
        return this.getEffectiveRuntimeOptions();
    }

    initWorkers(): void {
        this.deps.renderWorkerPool.initCache(this.loadedCache, this.runtimeOptions);
        this.deps.simWorkerPool.initCache(this.loadedCache, this.runtimeOptions);
    }

    subscribeCacheSwitchStatus(listener: (status: CacheSwitchStatus) => void): () => void {
        this.cacheSwitchListeners.add(listener);
        listener(this.cacheSwitchStatus);
        return () => this.cacheSwitchListeners.delete(listener);
    }

    getCacheSwitchStatus(): CacheSwitchStatus {
        return this.cacheSwitchStatus;
    }

    async switchCache(cacheInfo: CacheInfo): Promise<void> {
        if (cacheInfo.name === this.loadedCache.info.name) {
            return;
        }

        this.cacheSwitchAbortController?.abort();
        this.cacheSwitchAbortController = new AbortController();
        const activeAbortController = this.cacheSwitchAbortController;
        const nonce = (++this.cacheSwitchNonce) | 0;

        this.setCacheSwitchStatus({ state: "switching", cacheName: cacheInfo.name });

        try {
            const nextContext = await this.deps.loadCacheContext(
                cacheInfo,
                activeAbortController.signal,
                (progress) => {
                    this.setCacheSwitchStatus({
                        state: "switching",
                        cacheName: cacheInfo.name,
                        progress,
                    });
                },
            );
            if ((nonce | 0) !== (this.cacheSwitchNonce | 0)) {
                this.setCacheSwitchStatus({ state: "idle" });
                return;
            }

            await this.transitionRuntime({
                nextCacheContext: nextContext,
                nextRuntimeOptions: this.runtimeOptions,
                waitForWorkers: true,
            });
            this.setCacheSwitchStatus({ state: "idle" });
        } catch (error: unknown) {
            if ((nonce | 0) !== (this.cacheSwitchNonce | 0)) {
                this.setCacheSwitchStatus({ state: "idle" });
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            this.setCacheSwitchStatus({ state: "error", cacheName: cacheInfo.name, message });
        }
    }

    async setRuntimeOptions(options: ClientRuntimeOptions): Promise<void> {
        await this.transitionRuntime({
            nextCacheContext: this.cacheContext,
            nextRuntimeOptions: options,
            waitForWorkers: true,
        });
    }

    updateVars(): void {
        this.deps.renderWorkerPool.setVars(this.session.varManager.values);
        this.deps.simWorkerPool.setVars(this.session.varManager.values);
    }

    async applyWorldMutation(input: WorldMutationInput): Promise<number> {
        const result = await this.worldSession.applyMutation(input);
        const applied = result.applied | 0;
        if ((applied | 0) > 0) {
            this.worldToClientWorldAdapter.applyMutation(input);
            this.worldInteractionIndex.applyMutation(input);
        }
        const reloadMapIds = result.reloadMapIds;
        if ((applied | 0) > 0 && reloadMapIds && (reloadMapIds.length | 0) > 0) {
            for (let index = 0; index < reloadMapIds.length; index++) {
                const mapId = reloadMapIds[index];
                if (mapId === undefined || !this.deps.hasLoadedMap(mapId | 0)) {
                    continue;
                }
                await this.deps.reloadLoadedMap(mapId | 0);
            }
        }
        if ((applied | 0) > 0 && this.isRenderAffectingMutation(input)) {
            this.renderFrameCoordinator.invalidateLatestPacket();
        }
        return applied | 0;
    }

    private getEffectiveCacheContext(): ClientRuntimeCacheContext {
        return this.stagedCacheContext ?? this.cacheContext;
    }

    private getEffectiveRuntimeOptions(): ClientRuntimeOptions {
        return this.stagedRuntimeOptions ?? this.runtimeOptions;
    }

    private async transitionRuntime(input: Readonly<{
        nextCacheContext: ClientRuntimeCacheContext;
        nextRuntimeOptions: ClientRuntimeOptions;
        waitForWorkers: boolean;
    }>): Promise<void> {
        const previousCacheContext = this.cacheContext;
        const previousRuntimeOptions = this.runtimeOptions;
        try {
            await this.applyStagedRuntime(input);
            this.cacheContext = input.nextCacheContext;
            this.runtimeOptions = input.nextRuntimeOptions;
        } catch (error: unknown) {
            try {
                await this.applyStagedRuntime({
                    nextCacheContext: previousCacheContext,
                    nextRuntimeOptions: previousRuntimeOptions,
                    waitForWorkers: true,
                });
            } catch (rollbackError: unknown) {
                const transitionMessage =
                    error instanceof Error ? error.message : String(error);
                const rollbackMessage =
                    rollbackError instanceof Error
                        ? rollbackError.message
                        : String(rollbackError);
                throw new Error(
                    `Client runtime transition failed and rollback failed: ` +
                        `${transitionMessage}; rollback: ${rollbackMessage}`,
                );
            }
            throw error;
        } finally {
            this.stagedCacheContext = undefined;
            this.stagedRuntimeOptions = undefined;
        }
    }

    private async applyStagedRuntime(input: Readonly<{
        nextCacheContext: ClientRuntimeCacheContext;
        nextRuntimeOptions: ClientRuntimeOptions;
        waitForWorkers: boolean;
    }>): Promise<void> {
        this.stagedCacheContext = input.nextCacheContext;
        this.stagedRuntimeOptions = input.nextRuntimeOptions;
        await this.reinitialize(input.waitForWorkers);
    }

    private async reinitialize(waitForWorkers: boolean): Promise<void> {
        const effectiveCache = this.getEffectiveCacheContext();
        const effectiveRuntimeOptions = this.getEffectiveRuntimeOptions();
        if (waitForWorkers) {
            await Promise.all([
                this.deps.renderWorkerPool.initCacheAndWait(
                    effectiveCache.loadedCache,
                    effectiveRuntimeOptions,
                ),
                this.deps.simWorkerPool.initCacheAndWait(
                    effectiveCache.loadedCache,
                    effectiveRuntimeOptions,
                ),
            ]);
        } else {
            this.deps.renderWorkerPool.initCache(
                effectiveCache.loadedCache,
                effectiveRuntimeOptions,
            );
            this.deps.simWorkerPool.initCache(
                effectiveCache.loadedCache,
                effectiveRuntimeOptions,
            );
        }

        await this.deps.onClientReset();
    }

    private isRenderAffectingMutation(input: WorldMutationInput): boolean {
        const objStaticInput = input.obj?.static;
        const objDynamicInput = input.obj?.dynamic;
        const locAnimationInput = input.loc?.animation;
        const locStateInput = input.loc?.state;
        return (
            (!!objStaticInput?.stateReplacements &&
                (objStaticInput.stateReplacements.length | 0) > 0) ||
            (!!objStaticInput?.additions && (objStaticInput.additions.length | 0) > 0) ||
            (!!objStaticInput?.removals && (objStaticInput.removals.length | 0) > 0) ||
            (!!objDynamicInput?.dynamicSpawns && (objDynamicInput.dynamicSpawns.length | 0) > 0) ||
            (!!objDynamicInput?.dynamicDespawns &&
                (objDynamicInput.dynamicDespawns.length | 0) > 0) ||
            (!!objDynamicInput?.dynamicUpdates &&
                (objDynamicInput.dynamicUpdates.length | 0) > 0) ||
            (!!objDynamicInput?.clearDynamicMaps &&
                (objDynamicInput.clearDynamicMaps.length | 0) > 0) ||
            (!!locStateInput?.visibilityChanges &&
                (locStateInput.visibilityChanges.length | 0) > 0) ||
            (!!locStateInput?.replacements && (locStateInput.replacements.length | 0) > 0) ||
            (!!locStateInput?.replacementClears &&
                (locStateInput.replacementClears.length | 0) > 0) ||
            (!!locAnimationInput?.animationResets &&
                (locAnimationInput.animationResets.length | 0) > 0) ||
            (!!locAnimationInput?.animationPauseStates &&
                (locAnimationInput.animationPauseStates.length | 0) > 0)
        );
    }

    private setCacheSwitchStatus(status: CacheSwitchStatus): void {
        this.cacheSwitchStatus = status;
        for (const listener of this.cacheSwitchListeners) {
            listener(status);
        }
    }
}
