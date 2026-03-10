import type { RenderFrameCoordinator } from "../../renderer/RenderFrameCoordinator";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { DownloadProgress, ProgressListener } from "../../rs/cache/platform/CacheLoader";
import type { CacheSession } from "../../rs/loaders/CacheSession";
import type { BackendKind } from "../../util/BackendKind";
import type { LoadedCache, LoadedCacheContext } from "../../util/Caches";
import { isAbortError } from "../../util/ErrorUtil";
import { RenderDataWorkerPool } from "../../worker/RenderDataWorkerPool";
import { SimWorkerPool } from "../../worker/SimWorkerPool";
import type { WorldMutationInput, WorldSession } from "../../world/WorldSession";
import type {
    ClientActorCommandTarget,
    ClientGroundItemCommandTarget,
    ClientWorldObjectCommandTarget,
    WalkDestination,
} from "../actions/ClientCommand";
import type { ClientCommandService } from "../actions/ClientCommandService";
import type { ClientIntentState, ClientPlayerIntent } from "../actions/ClientIntentState";
import type { ClientWorldState } from "../world/ClientWorldState";
import type { WorldRenderInteractionIndex } from "../../world/WorldRenderInteractionIndex";
import type { WorldToClientWorldAdapter } from "../../world/WorldToClientWorldAdapter";

export type ClientRuntimeOptions = Readonly<{
    mapRenderBackend: BackendKind;
    mapRenderTelemetry: boolean;
}>;

export type CacheSwitchStatus =
    | { state: "idle" }
    | { state: "switching"; cacheName: string; progress?: DownloadProgress }
    | { state: "error"; cacheName: string; message: string };

type CacheSwitchStatusListener = (status: CacheSwitchStatus) => void;

type RuntimeState = Readonly<{
    cacheContext: LoadedCacheContext;
    runtimeOptions: ClientRuntimeOptions;
}>;

type RuntimeTransitionRequest = Readonly<{
    cacheContext: LoadedCacheContext;
    runtimeOptions: ClientRuntimeOptions;
    waitForWorkers: boolean;
}>;

type ActiveCacheSwitch = Readonly<{
    cacheName: string;
    nonce: number;
    signal: AbortSignal;
}>;

class CacheSwitchLifecycle {
    private readonly listeners = new Set<CacheSwitchStatusListener>();
    private status: CacheSwitchStatus = { state: "idle" };
    private nonce: number = 0;
    private activeAbortController?: AbortController;
    private disposed: boolean = false;

    subscribe(listener: CacheSwitchStatusListener): () => void {
        if (this.disposed) {
            listener({ state: "idle" });
            return () => {};
        }
        this.listeners.add(listener);
        listener(this.status);
        return () => this.listeners.delete(listener);
    }

    getStatus(): CacheSwitchStatus {
        return this.status;
    }

    begin(cacheName: string): ActiveCacheSwitch {
        this.abortActive();
        const abortController = new AbortController();
        this.activeAbortController = abortController;
        const activeSwitch: ActiveCacheSwitch = {
            cacheName,
            nonce: (++this.nonce) | 0,
            signal: abortController.signal,
        };
        this.publish({ state: "switching", cacheName });
        return activeSwitch;
    }

    isActive(activeSwitch: ActiveCacheSwitch): boolean {
        return (
            !this.disposed &&
            (activeSwitch.nonce | 0) === (this.nonce | 0) &&
            this.activeAbortController?.signal === activeSwitch.signal
        );
    }

    reportProgress(activeSwitch: ActiveCacheSwitch, progress: DownloadProgress): void {
        if (!this.isActive(activeSwitch)) {
            return;
        }
        this.publish({
            state: "switching",
            cacheName: activeSwitch.cacheName,
            progress,
        });
    }

    finish(activeSwitch: ActiveCacheSwitch): void {
        if (!this.isActive(activeSwitch)) {
            return;
        }
        this.clearActive();
        this.publish({ state: "idle" });
    }

    fail(activeSwitch: ActiveCacheSwitch, error: unknown): void {
        if (!this.isActive(activeSwitch)) {
            return;
        }
        this.clearActive();
        if (isAbortError(error)) {
            this.publish({ state: "idle" });
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.publish({
            state: "error",
            cacheName: activeSwitch.cacheName,
            message,
        });
    }

    dispose(): void {
        this.disposed = true;
        this.abortActive();
        this.listeners.clear();
        this.status = { state: "idle" };
    }

    private abortActive(): void {
        this.activeAbortController?.abort();
        this.clearActive();
    }

    private clearActive(): void {
        this.activeAbortController = undefined;
    }

    private publish(status: CacheSwitchStatus): void {
        if (this.disposed) {
            return;
        }
        this.status = status;
        for (const listener of this.listeners) {
            listener(status);
        }
    }
}

type ClientRuntimeDeps = Readonly<{
    clientCommands: ClientCommandService;
    clientIntentState: ClientIntentState;
    clientWorldState: ClientWorldState;
    worldToClientWorldAdapter: WorldToClientWorldAdapter;
    worldRenderInteractionIndex: WorldRenderInteractionIndex;
    worldSession: WorldSession;
    renderFrameCoordinator: RenderFrameCoordinator;
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;
    cacheContext: LoadedCacheContext;
    runtimeOptions: ClientRuntimeOptions;
    loadCacheContext(
        cacheInfo: CacheInfo,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<LoadedCacheContext>;
    hasLoadedMap(mapId: number): boolean;
    reloadLoadedMap(mapId: number): Promise<boolean>;
    onClientReset(): Promise<void>;
}>;

export class ClientRuntime {
    readonly clientWorldState: ClientWorldState;
    private readonly clientCommands: ClientCommandService;
    private readonly clientIntentState: ClientIntentState;
    private readonly worldToClientWorldAdapter: WorldToClientWorldAdapter;
    private readonly worldRenderInteractionIndex: WorldRenderInteractionIndex;
    private readonly worldSession: WorldSession;
    private readonly renderFrameCoordinator: RenderFrameCoordinator;

    private cacheContext: LoadedCacheContext;
    private runtimeOptions: ClientRuntimeOptions;
    private activeRuntimeState?: RuntimeState;
    private readonly cacheSwitchLifecycle = new CacheSwitchLifecycle();

    constructor(private readonly deps: ClientRuntimeDeps) {
        this.cacheContext = deps.cacheContext;
        this.runtimeOptions = deps.runtimeOptions;
        this.clientCommands = deps.clientCommands;
        this.clientIntentState = deps.clientIntentState;
        this.clientWorldState = deps.clientWorldState;
        this.worldToClientWorldAdapter = deps.worldToClientWorldAdapter;
        this.worldRenderInteractionIndex = deps.worldRenderInteractionIndex;
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
        return this.cacheSwitchLifecycle.subscribe(listener);
    }

    getCacheSwitchStatus(): CacheSwitchStatus {
        return this.cacheSwitchLifecycle.getStatus();
    }

    async switchCache(cacheInfo: CacheInfo): Promise<void> {
        if (cacheInfo.name === this.loadedCache.info.name) {
            return;
        }

        const activeSwitch = this.cacheSwitchLifecycle.begin(cacheInfo.name);

        try {
            const nextContext = await this.deps.loadCacheContext(
                cacheInfo,
                activeSwitch.signal,
                (progress) => this.cacheSwitchLifecycle.reportProgress(activeSwitch, progress),
            );
            if (!this.cacheSwitchLifecycle.isActive(activeSwitch)) {
                return;
            }

            await this.transitionRuntime({
                cacheContext: nextContext,
                runtimeOptions: this.runtimeOptions,
                waitForWorkers: true,
            });
            this.cacheSwitchLifecycle.finish(activeSwitch);
        } catch (error: unknown) {
            this.cacheSwitchLifecycle.fail(activeSwitch, error);
        }
    }

    async setRuntimeOptions(options: ClientRuntimeOptions): Promise<void> {
        await this.transitionRuntime({
            cacheContext: this.cacheContext,
            runtimeOptions: options,
            waitForWorkers: true,
        });
    }

    dispose(): void {
        this.activeRuntimeState = undefined;
        this.cacheSwitchLifecycle.dispose();
    }

    updateVars(): void {
        this.deps.renderWorkerPool.setVars(this.session.varManager.values);
        this.deps.simWorkerPool.setVars(this.session.varManager.values);
    }

    updateClientIntents(): void {
        this.clientIntentState.update(this.clientCommands);
    }

    getLatestPlayerIntent(): ClientPlayerIntent | undefined {
        return this.clientIntentState.getLatestPlayerIntent();
    }

    getPendingPlayerIntent(): ClientPlayerIntent | undefined {
        return this.clientIntentState.getPendingPlayerIntent();
    }

    clearPendingPlayerIntent(): void {
        this.clientIntentState.clearPendingPlayerIntent();
    }

    walkToPosition(destination: WalkDestination): void {
        this.clientCommands.walkToPosition(destination);
    }

    interactWithWorldObject(option: string, target: ClientWorldObjectCommandTarget): void {
        this.clientCommands.interactWithWorldObject(option, target);
    }

    interactWithGroundItem(option: string, target: ClientGroundItemCommandTarget): void {
        this.clientCommands.interactWithGroundItem(option, target);
    }

    interactWithActor(option: string, target: ClientActorCommandTarget): void {
        this.clientCommands.interactWithActor(option, target);
    }

    examineWorldObject(target: ClientWorldObjectCommandTarget): void {
        this.clientCommands.examineWorldObject(target);
    }

    examineGroundItem(target: ClientGroundItemCommandTarget): void {
        this.clientCommands.examineGroundItem(target);
    }

    examineActor(target: ClientActorCommandTarget): void {
        this.clientCommands.examineActor(target);
    }

    async applyWorldMutation(input: WorldMutationInput): Promise<number> {
        const result = await this.worldSession.applyMutation(input);
        const applied = result.applied | 0;
        if ((applied | 0) <= 0) {
            return 0;
        }
        this.applyMutationToClientState(input);
        await this.reloadLoadedMapsForMutation(result.reloadMapIds);
        this.invalidateRenderFrameForMutation(input);
        return applied | 0;
    }

    activateLoadedMap(input: Parameters<WorldSession["activateLoadedMap"]>[0]): Promise<boolean> {
        return this.worldSession.activateLoadedMap(input);
    }

    captureActivationVersion(): number {
        return this.worldSession.captureActivationVersion();
    }

    invalidateLatestFramePacket(): void {
        this.renderFrameCoordinator.invalidateLatestPacket();
    }

    private getEffectiveCacheContext(): LoadedCacheContext {
        return this.activeRuntimeState?.cacheContext ?? this.cacheContext;
    }

    private getEffectiveRuntimeOptions(): ClientRuntimeOptions {
        return this.activeRuntimeState?.runtimeOptions ?? this.runtimeOptions;
    }

    private async transitionRuntime(input: RuntimeTransitionRequest): Promise<void> {
        const previousRuntime = this.captureCommittedRuntimeState();
        const nextRuntime: RuntimeState = {
            cacheContext: input.cacheContext,
            runtimeOptions: input.runtimeOptions,
        };
        try {
            await this.prepareRuntimeTransition(nextRuntime, input.waitForWorkers);
            this.commitRuntimeTransition(nextRuntime);
        } catch (error: unknown) {
            await this.rollbackRuntimeTransition(previousRuntime, error);
            throw error;
        } finally {
            this.activeRuntimeState = undefined;
        }
    }

    private captureCommittedRuntimeState(): RuntimeState {
        return {
            cacheContext: this.cacheContext,
            runtimeOptions: this.runtimeOptions,
        };
    }

    private async prepareRuntimeTransition(
        nextRuntime: RuntimeState,
        waitForWorkers: boolean,
    ): Promise<void> {
        this.activeRuntimeState = nextRuntime;
        await this.reinitializeRuntime(nextRuntime, waitForWorkers);
    }

    private commitRuntimeTransition(nextRuntime: RuntimeState): void {
        this.cacheContext = nextRuntime.cacheContext;
        this.runtimeOptions = nextRuntime.runtimeOptions;
    }

    private async rollbackRuntimeTransition(
        previousRuntime: RuntimeState,
        transitionError: unknown,
    ): Promise<void> {
        try {
            await this.prepareRuntimeTransition(previousRuntime, true);
        } catch (rollbackError: unknown) {
            const transitionMessage =
                transitionError instanceof Error ? transitionError.message : String(transitionError);
            const rollbackMessage =
                rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
            throw new Error(
                `Client runtime transition failed and rollback failed: ` +
                    `${transitionMessage}; rollback: ${rollbackMessage}`,
            );
        }
    }

    private async reinitializeRuntime(
        runtimeState: RuntimeState,
        waitForWorkers: boolean,
    ): Promise<void> {
        if (waitForWorkers) {
            await Promise.all([
                this.deps.renderWorkerPool.initCacheAndWait(
                    runtimeState.cacheContext.loadedCache,
                    runtimeState.runtimeOptions,
                ),
                this.deps.simWorkerPool.initCacheAndWait(
                    runtimeState.cacheContext.loadedCache,
                    runtimeState.runtimeOptions,
                ),
            ]);
        } else {
            this.deps.renderWorkerPool.initCache(
                runtimeState.cacheContext.loadedCache,
                runtimeState.runtimeOptions,
            );
            this.deps.simWorkerPool.initCache(
                runtimeState.cacheContext.loadedCache,
                runtimeState.runtimeOptions,
            );
        }

        await this.deps.onClientReset();
    }

    private applyMutationToClientState(input: WorldMutationInput): void {
        this.worldToClientWorldAdapter.applyMutation(input);
        this.worldRenderInteractionIndex.applyMutation(input);
    }

    private async reloadLoadedMapsForMutation(
        reloadMapIds: ReadonlyArray<number> | undefined,
    ): Promise<void> {
        if (!reloadMapIds || (reloadMapIds.length | 0) <= 0) {
            return;
        }
        for (let index = 0; index < reloadMapIds.length; index++) {
            const mapId = reloadMapIds[index];
            if (mapId === undefined || !this.deps.hasLoadedMap(mapId | 0)) {
                continue;
            }
            await this.deps.reloadLoadedMap(mapId | 0);
        }
    }

    private invalidateRenderFrameForMutation(input: WorldMutationInput): void {
        if (!this.shouldInvalidateRenderFrameForMutation(input)) {
            return;
        }
        this.renderFrameCoordinator.invalidateLatestPacket();
    }

    private shouldInvalidateRenderFrameForMutation(input: WorldMutationInput): boolean {
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
}
