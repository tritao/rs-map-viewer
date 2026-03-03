import JSZip from "jszip";
import { TransferDescriptor } from "threads";
import { Transfer } from "threads/worker";

import { CacheType } from "../rs/cache/CacheType";
import { JSCompressionHandler } from "../rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../rs/config/vartype/VarProvider";
import { EnumeratingArchiveBytesProvider } from "../rs/io/BytesProvider";
import { CacheSession, tryCreateCacheSession } from "../rs/loaders/CacheSession";
import { initErrorToString } from "../rs/loaders/InitError";
import { MapBytesProvider, MapFileBytesProvider } from "../rs/map/MapBytesProvider";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { MapImageRenderer } from "../rs/render/minimap/MapImageRenderer";
import { Scene } from "../rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../rs/scene/buildSceneFromMapBytesProvider";
import { LocModelLoader } from "../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../rs/scene/model/ObjModelLoader";
import { IndexedSprite } from "../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../rs/sprite/SpriteLoader";
import { LoadedCache } from "../util/Caches";
import { errorToString } from "../util/ErrorUtil";
import { Hasher } from "../util/Hasher";
import { createMapRenderBackend } from "../maprender/MapRenderBackend";
import { MinimapData, loadMinimapBlob } from "../maprender/ts/MinimapData";
import type { SdMapLoaderInput } from "../maprender/MapRenderPayload";
import {
    buildStaticMapPacket,
    staticMapPacketTransferables,
    type StaticMapPacket,
} from "../runtime/contracts/StaticMapPacket";
import type {
    WorkerRuntimeOptions,
    WorkerSpawnBootstrap,
    WorkerState,
} from "./RenderDataWorkerTypes";

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
    const session = sessionResult.value;
    const {
        underlayTypeLoader,
        overlayTypeLoader,
        locTypeLoader,
        objTypeLoader,
        npcTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        mapFileLoader,
        mapScenes,
        mapFunctions,
    } = session.loaders;
    const skeletalSeqLoader = session.getSkeletalSeqLoader();

    const varProvider = new VarManagerProvider(session.varManager);
    const mapBytesProvider = new MapFileBytesProvider(mapFileLoader, cache.xteas);
    const locModelLoader = new LocModelLoader(
        locTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
    );
    const objModelLoader = new ObjModelLoader(objTypeLoader, modelLoader, textureLoader);
    const npcModelLoader = new NpcModelLoader(
        npcTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
        skeletalSeqLoader,
        varProvider,
    );
    const sceneBuilder = new SceneBuilder(cache.info, {
        underlayTypeLoader,
        overlayTypeLoader,
        locTypeLoader,
        textureLoader,
        locModelLoader,
        varProvider,
    });
    const mapRenderBackendKind = options?.mapRenderBackend ?? "cpp-wasm";
    const mapImageRenderer = new MapImageRenderer(
        textureLoader,
        locTypeLoader,
        mapScenes,
        mapFunctions,
    );
    const mapRenderBackend = createMapRenderBackend(
        mapRenderBackendKind,
        {
            session,
            sceneBuilder,
            mapBytesProvider,
            locModelLoader,
            objModelLoader,
            npcModelLoader,
            mapImageRenderer,
            varProvider,
            objSpawns: spawnBootstrap.objSpawns,
        },
        {
            telemetry: options?.mapRenderTelemetry,
        },
    );

    const mapImageCache = await caches.open("map-images");

    return {
        session,
        varProvider,
        mapBytesProvider,
        locModelLoader,
        objModelLoader,
        npcModelLoader,
        sceneBuilder,
        mapRenderBackend,
        mapImageRenderer,
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

async function offscreenCanvasToPng(canvas: OffscreenCanvas): Promise<string> {
    const blob = await canvas.convertToBlob({ type: "image/png" });

    const reader = new FileReader();
    const dataUrlPromise = new Promise<string>((resolve) => {
        reader.onload = () => {
            resolve(reader.result as string);
        };
    });

    reader.readAsDataURL(blob);

    return await dataUrlPromise;
}

async function addSpritesToZip(zip: JSZip, id: number, sprites: IndexedSprite[]) {
    if (sprites.length > 1) {
        zip = zip.folder(id.toString())!;
    }
    for (let i = 0; i < sprites.length; i++) {
        const sprite = sprites[i];
        sprite.normalize();

        const canvas = sprite.getCanvas();
        const dataUrl = await offscreenCanvasToPng(canvas);

        let fileName = id + ".png";
        if (sprites.length > 1) {
            fileName = i + ".png";
        }

        const pngData = atob(dataUrl.split(",")[1]);
        zip.file(fileName, pngData, { binary: true });
    }
}

async function exportSpritesToZip(session: CacheSession, zip: JSZip): Promise<void> {
    const spriteSource = session.tryGetDat2SpriteSource();
    if (!spriteSource) {
        return;
    }

    const promises: Promise<any>[] = [];
    for (const id of spriteSource.getIds()) {
        const sprites = SpriteLoader.loadIntoIndexedSpritesFromSource(spriteSource, id);
        if (!sprites) {
            continue;
        }
        promises.push(addSpritesToZip(zip, id, sprites));
    }

    await Promise.all(promises);
}

async function exportDatSpritesToZip(session: CacheSession, zip: JSZip): Promise<void> {
    const mediaArchive = session.tryGetDatMediaArchive();
    if (!mediaArchive) {
        return;
    }

    const indexDatId = mediaArchive.tryGetFileId("index.dat");
    if (indexDatId === undefined) {
        return;
    }

    const promises: Promise<any>[] = [];
    const mediaSource = new EnumeratingArchiveBytesProvider(mediaArchive);
    for (const fileId of mediaSource.getIds()) {
        if (fileId === indexDatId) {
            continue;
        }

        const sprites: IndexedSprite[] = [];
        for (let i = 0; i < 256; i++) {
            const sprite = SpriteLoader.tryLoadIndexedSpriteDatId(mediaArchive, fileId, i);
            if (!sprite) {
                break;
            }
            sprites.push(sprite);
        }
        promises.push(addSpritesToZip(zip, fileId, sprites));
    }

    await Promise.all(promises);
}

export class RenderDataWorkerBuild {
    private workerStatePromise: Promise<WorkerStateInit> | undefined;

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
    ): Promise<TransferDescriptor<StaticMapPacket | undefined>> {
        const workerState = await this.requireWorkerState();
        const { data, transferables } = await workerState.mapRenderBackend.buildMapData(input);
        if (!data) {
            return Transfer<StaticMapPacket | undefined>(undefined, []);
        }
        const packet = buildStaticMapPacket(data);
        const packetTransferables = staticMapPacketTransferables(packet);
        const allTransferables = packetTransferables.length > 0 ? packetTransferables : transferables;
        return Transfer<StaticMapPacket | undefined>(packet, allTransferables);
    }

    async loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<TransferDescriptor<Int32Array>> {
        const workerState = await this.requireWorkerState();
        const pixels =
            workerState.session.getTextureLoader().tryGetPixelsArgb(id, size, flipH, brightness) ??
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
        const borderSize = 6;

        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;

        const scene = buildSceneFromMapBytesProvider(
            workerState.sceneBuilder,
            workerState.mapBytesProvider,
            baseX,
            baseY,
            mapSize,
            mapSize,
            false,
            LocLoadType.NO_MODELS,
        );

        const minimapBlob = await loadMinimapBlob(
            workerState.mapImageRenderer,
            scene,
            level,
            borderSize,
            drawMapFunctions,
        );

        return {
            mapX,
            mapY,
            level,
            cacheInfo: workerState.session.cache.info,
            minimapBlob,
        };
    }

    async setVars(values: Int32Array): Promise<void> {
        const workerState = await this.requireWorkerState();
        workerState.varProvider.set(values);
    }

    async loadCachedMapImages(): Promise<Map<number, string>> {
        const workerState = await this.requireWorkerState();
        const keys = await workerState.mapImageCache.keys();
        const mapImageUrls = new Map<number, string>();
        const promises: Promise<void>[] = [];
        for (const key of keys) {
            if (key.headers.get("RS-Cache-Name") !== workerState.session.cache.info.name) {
                continue;
            }
            promises.push(initCachedMapImage(workerState.mapImageCache, mapImageUrls, key));
        }
        await Promise.all(promises);
        return mapImageUrls;
    }

    async exportSpritesToZip(): Promise<Blob> {
        const workerState = await this.requireWorkerState();
        const zip = new JSZip();
        const cacheType = workerState.session.cache.type;
        if (cacheType === CacheType.Dat2) {
            await exportSpritesToZip(workerState.session, zip);
        } else if (cacheType === CacheType.Dat) {
            await exportDatSpritesToZip(workerState.session, zip);
        }
        return zip.generateAsync({ type: "blob" });
    }

    async exportTexturesToZip(): Promise<Blob> {
        const workerState = await this.requireWorkerState();
        const zip = new JSZip();
        const textureLoader = workerState.session.getTextureLoader();
        const textureSize = 128;

        const textureIds = textureLoader.getTextureIds();
        for (let i = 0; i < textureIds.length; i++) {
            const id = textureIds[i];
            const pixels = textureLoader.tryGetPixelsArgb(id, textureSize, true, 1.0);
            if (!pixels) {
                console.error("Failed to export texture", id);
                continue;
            }

            const canvas = new OffscreenCanvas(textureSize, textureSize);
            const ctx = canvas.getContext("2d");
            if (ctx) {
                const imageData = ctx.createImageData(textureSize, textureSize);
                const rgbaPixels = imageData.data;
                for (let j = 0; j < pixels.length; j++) {
                    rgbaPixels[j * 4 + 0] = (pixels[j] >> 16) & 0xff;
                    rgbaPixels[j * 4 + 1] = (pixels[j] >> 8) & 0xff;
                    rgbaPixels[j * 4 + 2] = pixels[j] & 0xff;
                    rgbaPixels[j * 4 + 3] = (pixels[j] >> 24) & 0xff;
                }

                ctx.putImageData(imageData, 0, 0);
                const dataUrl = await offscreenCanvasToPng(canvas);
                const pngData = atob(dataUrl.split(",")[1]);
                zip.file(id + ".png", pngData, { binary: true });
            }
        }

        return zip.generateAsync({ type: "blob" });
    }
}
