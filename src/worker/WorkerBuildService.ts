import { TransferDescriptor } from "threads";
import { Transfer } from "threads/worker";

import { RunescapeContentSession } from "../adapters/runescape/RunescapeContentSession";
import { createRunescapeMapRenderAdapter } from "../adapters/runescape/RunescapeMapRenderAdapter";
import { createMapRenderBackend } from "../maprender/MapRenderBackend";
import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import type { MinimapData } from "../maprender/ts/MinimapData";
import { JSCompressionHandler } from "../rs/compression/JSCompressionHandler";
import { tryCreateCacheSession } from "../rs/loaders/CacheSession";
import { initErrorToString } from "../rs/loaders/InitError";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { LoadedCache } from "../util/Caches";
import { errorToString } from "../util/ErrorUtil";
import { Hasher } from "../util/Hasher";
import {
    type StaticMapWirePacket,
    collectStaticMapWirePacketTransferables,
    encodeStaticMapWirePacket,
} from "./StaticMapWirePacket";
import type { WorkerRuntimeOptions, WorkerSpawnBootstrap, WorkerState } from "./WorkerBuildTypes";

type WorkerStateInit = { ok: true; state: WorkerState } | { ok: false; error: string };

const compressionHandler = new JSCompressionHandler();
const hasherPromise = Hasher.init();

async function initWorker(
    cache: LoadedCache,
    spawnBootstrap: WorkerSpawnBootstrap,
    options?: WorkerRuntimeOptions,
): Promise<WorkerState> {
    await hasherPromise;

    const sessionResult = tryCreateCacheSession(cache, compressionHandler);
    if (!sessionResult.ok) {
        throw new Error(initErrorToString(sessionResult.error));
    }
    const contentSession = new RunescapeContentSession(sessionResult.value);
    const mapRenderAdapter = createRunescapeMapRenderAdapter(contentSession);
    const mapRenderBackendKind = options?.mapRenderBackend ?? "wasm";
    const mapRenderBackend = createMapRenderBackend(
        mapRenderBackendKind,
        {
            contentSession,
            buildAdapter: mapRenderAdapter,
            objSpawns: spawnBootstrap.objSpawns,
            fallbackNpcSpawns: spawnBootstrap.fallbackNpcSpawns,
        },
        {
            telemetry: options?.mapRenderTelemetry,
        },
    );

    const mapImageCache = await caches.open("map-images");

    return {
        fallbackNpcSpawns: spawnBootstrap.fallbackNpcSpawns,
        runtimeAdapter: mapRenderAdapter,
        mapRenderBackend,
        mapImageCache,
    };
}

async function initCachedMapImage(
    mapImageCache: Cache,
    mapImageUrls: Map<number, string>,
    key: Request,
): Promise<void> {
    const resp = await mapImageCache.match(key);
    if (!resp) {
        return;
    }
    const fileName = key.url.slice(key.url.lastIndexOf("/") + 1);
    const split = fileName.replace(".png", "").split("_");
    if (split.length !== 2) {
        return;
    }
    const mapX = parseInt(split[0]);
    const mapY = parseInt(split[1]);

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    mapImageUrls.set(getMapSquareId(mapX, mapY), url);
}

export class WorkerBuildService {
    private workerStatePromise: Promise<WorkerStateInit> | undefined;

    readonly maps = {
        loadStaticMapPacket: (input: SdMapLoaderInput) => this.loadStaticMapPacket(input),
        loadTexture: (id: number, size: number, flipH: boolean, brightness: number) =>
            this.loadTexture(id, size, flipH, brightness),
        loadMapImage: (mapX: number, mapY: number, level: number, drawMapFunctions: boolean) =>
            this.loadMapImage(mapX, mapY, level, drawMapFunctions),
        loadCachedMapImages: () => this.loadCachedMapImages(),
    };

    readonly assets = {
        exportSpritesToZip: () => this.exportSpritesToZip(),
        exportTexturesToZip: () => this.exportTexturesToZip(),
    };

    readonly state = {
        setVars: (values: Int32Array) => this.setVars(values),
    };

    async requireWorkerState(): Promise<WorkerState> {
        const init = await this.workerStatePromise;
        if (!init) {
            throw new Error("Worker not initialized");
        }
        if (!init.ok) {
            throw new Error(init.error);
        }
        return init.state;
    }

    async initCache(
        cache: LoadedCache,
        spawnBootstrap: WorkerSpawnBootstrap,
        options?: WorkerRuntimeOptions,
    ): Promise<void> {
        console.log("init worker", cache.info);
        this.workerStatePromise = initWorker(cache, spawnBootstrap, options)
            .then((state) => ({ ok: true, state }) as const)
            .catch((e) => ({ ok: false, error: errorToString(e) }) as const);
        await this.requireWorkerState();
    }

    async loadStaticMapPacket(
        input: SdMapLoaderInput,
    ): Promise<TransferDescriptor<StaticMapWirePacket | undefined>> {
        const workerState = await this.requireWorkerState();
        const { data, transferables, runtimeRegistration, runtimeBootstrap } =
            await workerState.mapRenderBackend.buildMapData(input);
        if (!data || !runtimeRegistration || !runtimeBootstrap) {
            return Transfer<StaticMapWirePacket | undefined>(undefined, []);
        }
        const packet = encodeStaticMapWirePacket(data, runtimeRegistration, runtimeBootstrap);
        const packetTransferables = collectStaticMapWirePacketTransferables(packet);
        const allTransferables =
            packetTransferables.length > 0 ? packetTransferables : transferables;
        return Transfer<StaticMapWirePacket | undefined>(packet, allTransferables);
    }

    async loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<TransferDescriptor<Int32Array>> {
        const workerState = await this.requireWorkerState();
        const pixels =
            workerState.runtimeAdapter.loadTextureArgb(id, size, flipH, brightness) ??
            new Int32Array(size * size);
        return Transfer(pixels, [pixels.buffer]);
    }

    async loadMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ): Promise<MinimapData | undefined> {
        const workerState = await this.requireWorkerState();
        return workerState.runtimeAdapter.loadMapImage({
            mapX,
            mapY,
            level,
            borderSize: 6,
            drawMapFunctions,
        });
    }

    async setVars(values: Int32Array): Promise<void> {
        const workerState = await this.requireWorkerState();
        workerState.runtimeAdapter.setVarValues(values);
    }

    async loadCachedMapImages(): Promise<Map<number, string>> {
        const workerState = await this.requireWorkerState();
        const keys = await workerState.mapImageCache.keys();
        const mapImageUrls = new Map<number, string>();
        const promises: Promise<void>[] = [];
        for (const key of keys) {
            if (
                key.headers.get("RS-Cache-Name") !== workerState.runtimeAdapter.getCacheInfo().name
            ) {
                continue;
            }
            promises.push(initCachedMapImage(workerState.mapImageCache, mapImageUrls, key));
        }
        await Promise.all(promises);
        return mapImageUrls;
    }

    async exportSpritesToZip(): Promise<Blob> {
        const workerState = await this.requireWorkerState();
        return workerState.runtimeAdapter.exportSpritesToZip();
    }

    async exportTexturesToZip(): Promise<Blob> {
        const workerState = await this.requireWorkerState();
        return workerState.runtimeAdapter.exportTexturesToZip();
    }
}
