import JSZip from "jszip";
import { TransferDescriptor } from "threads";
import { registerSerializer } from "threads";
import { Transfer, expose } from "threads/worker";

import { JSCompressionHandler } from "../rs/compression/JSCompressionHandler";
import { VarStateProvider } from "../rs/config/vartype/VarProvider";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { MapBytesProvider, MapFileBytesProvider } from "../rs/map/MapBytesProvider";
import { MapImageRenderer } from "../rs/render/minimap/MapImageRenderer";
import { LocModelLoader } from "../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../rs/scene/model/ObjModelLoader";
import { Scene } from "../rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { IndexedSprite } from "../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../rs/sprite/SpriteLoader";
import { Hasher } from "../util/Hasher";
import { LoadedCache } from "../util/Caches";
import { NpcSpawn } from "../data/npc/NpcSpawn";
import { ObjSpawn } from "../data/obj/ObjSpawn";
import { MinimapData, loadMinimapBlob } from "./MinimapData";
import { RenderDataLoader, renderDataLoaderSerializer } from "./RenderDataLoader";
import { CacheType } from "../rs/cache/CacheType";
import { CacheSession, tryCreateCacheSession } from "../rs/runtime/createCacheSession";
import { tryGetDat2SpriteSource, tryGetDatMediaArchive } from "../rs/runtime/sessionSources";
import { buildSceneFromMapBytesProvider } from "../rs/scene/buildSceneFromMapBytesProvider";
import { errorToString } from "../util/ErrorUtil";
import { Loaders } from "../rs/loaders/Loaders";

registerSerializer(renderDataLoaderSerializer);

const compressionHandler = new JSCompressionHandler();
const hasherPromise = Hasher.init();

export type WorkerState = {
    session: CacheSession;
    loaders: Loaders;
    varProvider: VarStateProvider;
    mapBytesProvider: MapBytesProvider;
    locModelLoader: LocModelLoader;
    objModelLoader: ObjModelLoader;
    npcModelLoader: NpcModelLoader;

    sceneBuilder: SceneBuilder;

    mapImageRenderer: MapImageRenderer;
    mapImageCache: Cache;

    objSpawns: ObjSpawn[];
    npcSpawns: NpcSpawn[];
};

type WorkerStateInit =
    | { ok: true; state: WorkerState }
    | { ok: false; error: string };

let workerStatePromise: Promise<WorkerStateInit> | undefined;

async function requireWorkerState(): Promise<WorkerState> {
    const init = await workerStatePromise;
    if (!init) {
        throw new Error("Worker not initialized");
    }
    if (!init.ok) {
        throw new Error(init.error);
    }
    return init.state;
}

async function initWorker(
    cache: LoadedCache,
    objSpawns: ObjSpawn[],
    npcSpawns: NpcSpawn[],
): Promise<WorkerState> {
    await hasherPromise;

    const sessionResult = tryCreateCacheSession(cache, compressionHandler);
    if (!sessionResult.ok) {
        throw new Error(sessionResult.error);
    }
    const session = sessionResult.value;
    const loaders = session.loaders;
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
        skeletalSeqLoader,
        mapFileLoader,
        varBitTypeLoader,
        mapScenes,
        mapFunctions,
    } = loaders;

    const varProvider = new VarStateProvider(varBitTypeLoader, session.varManager.values);

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

    const sceneBuilder = new SceneBuilder(
        cache.info,
        underlayTypeLoader,
        overlayTypeLoader,
        locTypeLoader,
        textureLoader,
        locModelLoader,
    );

    const mapImageRenderer = new MapImageRenderer(
        textureLoader,
        locTypeLoader,
        mapScenes,
        mapFunctions,
    );

    const mapImageCache = await caches.open("map-images");

    return {
        session,
        loaders,
        varProvider,
        mapBytesProvider,
        locModelLoader,
        objModelLoader,
        npcModelLoader,

        sceneBuilder,

        mapImageRenderer,
        mapImageCache,

        objSpawns,
        npcSpawns,
    };
}

function clearCache(workerState: WorkerState): void {
    workerState.locModelLoader.clearCache();
    workerState.objModelLoader.clearCache();
    workerState.npcModelLoader.clearCache();
    workerState.loaders.seqFrameLoader.clearCache();
    workerState.loaders.skeletalSeqLoader?.clearCache();
}

const worker = {
    initCache(cache: LoadedCache, objSpawns: ObjSpawn[], npcSpawns: NpcSpawn[]) {
        console.log("init worker", cache.info);
        workerStatePromise = initWorker(cache, objSpawns, npcSpawns)
            .then((state) => ({ ok: true, state } as const))
            .catch((e) => ({ ok: false, error: errorToString(e) } as const));
    },
    initDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.init();
    },
    resetDataLoader<I, D>(dataLoader: RenderDataLoader<I, D>) {
        dataLoader.reset();
    },
    async load<I, D>(
        dataLoader: RenderDataLoader<I, D>,
        input: I,
    ): Promise<TransferDescriptor<D> | undefined> {
        const workerState = await requireWorkerState();

        const { data, transferables } = await dataLoader.load(workerState, input);

        clearCache(workerState);

        if (!data) {
            return undefined;
        }
        return Transfer<D>(data, transferables);
    },
    async loadTexture(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Promise<TransferDescriptor<Int32Array>> {
        const workerState = await requireWorkerState();

        const pixels = workerState.loaders.textureLoader.getPixelsArgb(id, size, flipH, brightness);

        return Transfer(pixels, [pixels.buffer]);
    },
    async loadMapImage(
        mapX: number,
        mapY: number,
        level: number,
        drawMapFunctions: boolean,
    ): Promise<MinimapData | undefined> {
        const workerState = await requireWorkerState();

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
    },
    async setVars(values: Int32Array): Promise<void> {
        const workerState = await requireWorkerState();
        workerState.varProvider.set(values);
    },
    async loadCachedMapImages(): Promise<Map<number, string>> {
        const workerState = await requireWorkerState();
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
    },
    async exportSpritesToZip(): Promise<Blob> {
        const workerState = await requireWorkerState();

        const zip = new JSZip();

        const cacheType = workerState.session.cache.type;

        if (cacheType === CacheType.Dat2) {
            await exportSpritesToZip(workerState.session, zip);
        } else if (cacheType === CacheType.Dat) {
            await exportDatSpritesToZip(workerState.session, zip);
        }

        return zip.generateAsync({ type: "blob" });
    },
    async exportTexturesToZip(): Promise<Blob> {
        const workerState = await requireWorkerState();

        const zip = new JSZip();

        const textureLoader = workerState.session.loaders.textureLoader;

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
                    rgbaPixels[j * 4 + 0] = (pixels[j] >> 16) & 0xff; // R
                    rgbaPixels[j * 4 + 1] = (pixels[j] >> 8) & 0xff; // G
                    rgbaPixels[j * 4 + 2] = pixels[j] & 0xff; // B
                    rgbaPixels[j * 4 + 3] = (pixels[j] >> 24) & 0xff; // A
                }

                ctx.putImageData(imageData, 0, 0);

                const dataUrl = await offscreenCanvasToPng(canvas);

                const pngData = atob(dataUrl.split(",")[1]);
                zip.file(id + ".png", pngData, { binary: true });
            }
        }

        return zip.generateAsync({ type: "blob" });
    },
};

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
    const spriteSource = tryGetDat2SpriteSource(session);
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
    const mediaArchive = tryGetDatMediaArchive(session);
    if (!mediaArchive) {
        return;
    }

    const indexDatId = mediaArchive.getFileId("index.dat");

    const promises: Promise<any>[] = [];

    for (const fileId of mediaArchive.fileIds) {
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

export type RenderDataWorker = typeof worker;

expose(worker);
