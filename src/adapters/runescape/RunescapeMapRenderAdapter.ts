import JSZip from "jszip";

import type { ContentBuildAdapter } from "../../core/build/ContentBuildAdapter";
import type {
    MapRenderBuildAdapter,
    MapRenderLocAnimatedGroupsInput,
    MapRenderLocSceneModelBuildInput,
    MapRenderMinimapBlobInput,
    MapRenderNpcGeometryInput,
    MapRenderObjRenderInput,
    MapRenderResolveNpcSpawnsInput,
    MapRenderSceneBuildInput,
    MapRenderSceneLocsInput,
} from "../../core/build/MapRenderBuildAdapter";
import type {
    WorldRuntimeAnimationDeps,
    WorldRuntimeContentAdapter,
    WorldRuntimeMapImageInput,
    WorldRuntimeMapObjRenderInput,
    WorldRuntimeNpcBootstrapInput,
    WorldRuntimeSceneBuildByMapIdInput,
} from "../../core/runtime/WorldRuntimeContentAdapter";
import type { NpcSpawn } from "../../data/npc/NpcSpawn";
import type { NpcSpawnResolver } from "../../data/npc/NpcSpawnResolver";
import type { ObjRenderData } from "../../maprender/MapRenderData";
import {
    appendLocEntitiesToSceneModels,
    buildLocAnimationFrames,
    buildLocAnimatedGroups as finalizeLocAnimatedGroups,
} from "../../maprender/build/LocRenderDataBuilder";
import { buildNpcGeometry } from "../../maprender/build/NpcGeometryBuilder";
import { buildObjRenderData } from "../../maprender/build/ObjRenderDataBuilder";
import { getSceneLocs } from "../../maprender/build/SceneLocs";
import { type MinimapData, loadMinimapBlob } from "../../maprender/ts/MinimapData";
import { createSceneBuildCacheProvider } from "../../maprender/wasm/WasmCacheUploader";
import { CacheType } from "../../rs/cache/CacheType";
import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarManagerProvider } from "../../rs/config/vartype/VarProvider";
import { EnumeratingArchiveBytesProvider } from "../../rs/io/BytesProvider";
import type { CacheSession } from "../../rs/loaders/CacheSession";
import type { ModelLoader } from "../../rs/model/ModelLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import { MapImageRenderer } from "../../rs/render/minimap/MapImageRenderer";
import { Scene } from "../../rs/scene/Scene";
import { LocLoadType, SceneBuilder } from "../../rs/scene/SceneBuilder";
import { buildSceneFromMapBytesProvider } from "../../rs/scene/buildSceneFromMapBytesProvider";
import { LocModelLoader } from "../../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../../rs/scene/model/ObjModelLoader";
import { IndexedSprite } from "../../rs/sprite/IndexedSprite";
import { SpriteLoader } from "../../rs/sprite/SpriteLoader";
import type { TextureLoader } from "../../rs/texture/TextureLoader";
import { type ResolvedBootstrapData, resolveBootstrapData } from "../../runtime/sim/NpcBootstrap";
import type { NpcSimStateStoreDeps } from "../../runtime/sim/NpcSimStateStore";
import type { RunescapeContentSession } from "./RunescapeContentSession";

function decodeMapSquareFromId(mapId: number): Readonly<{ mapX: number; mapY: number }> {
    return {
        mapX: (mapId >> 8) & 0xff,
        mapY: mapId & 0xff,
    };
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
    let targetZip = zip;
    if (sprites.length > 1) {
        targetZip = zip.folder(id.toString())!;
    }
    for (let i = 0; i < sprites.length; i++) {
        const sprite = sprites[i];
        if (!sprite) {
            continue;
        }
        sprite.normalize();

        const canvas = sprite.getCanvas();
        const dataUrl = await offscreenCanvasToPng(canvas);

        let fileName = `${id}.png`;
        if (sprites.length > 1) {
            fileName = `${i}.png`;
        }

        const pngData = atob(dataUrl.split(",")[1] ?? "");
        targetZip.file(fileName, pngData, { binary: true });
    }
}

async function appendDat2SpritesToZip(session: CacheSession, zip: JSZip): Promise<void> {
    const spriteSource = session.tryGetDat2SpriteSource();
    if (!spriteSource) {
        return;
    }

    const promises: Promise<void>[] = [];
    for (const id of spriteSource.getIds()) {
        const sprites = SpriteLoader.loadIntoIndexedSpritesFromSource(spriteSource, id);
        if (!sprites) {
            continue;
        }
        promises.push(addSpritesToZip(zip, id, sprites));
    }

    await Promise.all(promises);
}

async function appendDatSpritesToZip(session: CacheSession, zip: JSZip): Promise<void> {
    const mediaArchive = session.tryGetDatMediaArchive();
    if (!mediaArchive) {
        return;
    }

    const indexDatId = mediaArchive.tryGetFileId("index.dat");
    if (indexDatId === undefined) {
        return;
    }

    const promises: Promise<void>[] = [];
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

export class RunescapeMapRenderAdapter
    implements ContentBuildAdapter, MapRenderBuildAdapter, WorldRuntimeContentAdapter
{
    readonly format = "runescape-cache" as const;
    private readonly varProvider: VarManagerProvider;
    private readonly locModelLoader: LocModelLoader;
    private readonly objModelLoader: ObjModelLoader;
    private readonly npcModelLoader: NpcModelLoader;
    private readonly sceneBuilder: SceneBuilder;
    private readonly mapImageRenderer: MapImageRenderer;

    constructor(readonly contentSession: RunescapeContentSession) {
        const session = contentSession.getCacheSession();
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
            mapScenes,
            mapFunctions,
        } = session.loaders;
        const skeletalSeqLoader = session.getSkeletalSeqLoader();

        this.varProvider = new VarManagerProvider(session.varManager);
        this.locModelLoader = new LocModelLoader(
            locTypeLoader,
            modelLoader,
            textureLoader,
            seqTypeLoader,
            seqFrameLoader,
            skeletalSeqLoader,
        );
        this.objModelLoader = new ObjModelLoader(objTypeLoader, modelLoader, textureLoader);
        this.npcModelLoader = new NpcModelLoader(
            npcTypeLoader,
            modelLoader,
            textureLoader,
            seqTypeLoader,
            seqFrameLoader,
            skeletalSeqLoader,
            this.varProvider,
        );
        this.sceneBuilder = new SceneBuilder(session.cache.info, {
            underlayTypeLoader,
            overlayTypeLoader,
            locTypeLoader,
            textureLoader,
            locModelLoader: this.locModelLoader,
            varProvider: this.varProvider,
        });
        this.mapImageRenderer = new MapImageRenderer(
            textureLoader,
            locTypeLoader,
            mapScenes,
            mapFunctions,
        );
    }

    getNpcAnimationDeps(): WorldRuntimeAnimationDeps {
        const { seqTypeLoader, seqFrameLoader } = this.contentSession.getCacheSession().loaders;
        return {
            seqTypeLoader: seqTypeLoader as SeqTypeLoader,
            seqFrameLoader,
        };
    }

    createNpcSimStateStoreDeps(tickPatchEntryStride: number): NpcSimStateStoreDeps {
        const session = this.contentSession.getCacheSession();
        return {
            npcTypeLoader: session.loaders.npcTypeLoader as NpcTypeLoader,
            basTypeLoader: session.loaders.basTypeLoader as BasTypeLoader,
            seqTypeLoader: session.loaders.seqTypeLoader as SeqTypeLoader,
            tickPatchEntryStride: tickPatchEntryStride | 0,
        };
    }

    getCacheInfo() {
        return this.contentSession.getCacheSession().cache.info;
    }

    loadTextureArgb(
        id: number,
        size: number,
        flipH: boolean,
        brightness: number,
    ): Int32Array | undefined {
        return this.contentSession
            .getCacheSession()
            .getTextureLoader()
            .tryGetPixelsArgb(id, size, flipH, brightness);
    }

    setVarValues(values: Int32Array): void {
        this.varProvider.set(values);
    }

    buildScene(input: MapRenderSceneBuildInput): Scene {
        const borderSize = input.borderSize | 0;
        const baseX = (input.mapX | 0) * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = (input.mapY | 0) * Scene.MAP_SQUARE_SIZE - borderSize;
        const mapSize = Scene.MAP_SQUARE_SIZE + borderSize * 2;
        return buildSceneFromMapBytesProvider(
            this.sceneBuilder,
            this.contentSession.getRunescapeWorldChunkSource(),
            baseX,
            baseY,
            mapSize,
            mapSize,
            input.smoothTerrain === true,
            input.locLoadType ?? LocLoadType.NO_MODELS,
            input.locPlacementOverrides,
        );
    }

    getSceneLocs(input: MapRenderSceneLocsInput) {
        return getSceneLocs(
            this.contentSession.getCacheSession().loaders.locTypeLoader,
            input.scene,
            input.borderSize | 0,
            input.maxLevel | 0,
        );
    }

    addSceneLocEntities(input: MapRenderLocSceneModelBuildInput) {
        return appendLocEntitiesToSceneModels(
            this.locModelLoader,
            this.contentSession.getCacheSession().loaders.locTypeLoader,
            this.varProvider,
            input.scene,
            input.sceneModels,
            input.locEntities,
        );
    }

    buildLocAnimatedGroups(input: MapRenderLocAnimatedGroupsInput) {
        const seqTypeLoader = this.contentSession.getCacheSession().loaders
            .seqTypeLoader as SeqTypeLoader;
        return finalizeLocAnimatedGroups(input.buildGroups, (group) =>
            buildLocAnimationFrames(
                this.locModelLoader,
                seqTypeLoader,
                input.sceneBuf,
                group.locType,
                group.type,
                group.rotation,
                group.seqId,
            ),
        );
    }

    buildNpcGeometry(input: MapRenderNpcGeometryInput) {
        const session = this.contentSession.getCacheSession();
        return buildNpcGeometry({
            loadNpcs: input.loadNpcs,
            includeNpcAnimationFrames: input.includeNpcAnimationFrames,
            npcSpawns: input.npcSpawns,
            textureLoader: session.loaders.textureLoader,
            npcModelLoader: this.npcModelLoader,
            npcTypeLoader: session.loaders.npcTypeLoader,
            seqTypeLoader: session.loaders.seqTypeLoader,
            basTypeLoader: session.loaders.basTypeLoader,
        });
    }

    buildObjRenderData(input: MapRenderObjRenderInput): ObjRenderData | undefined {
        return buildObjRenderData({
            loadObjs: input.loadObjs,
            objTypeLoader: this.contentSession.getCacheSession().loaders.objTypeLoader,
            objModelLoader: this.objModelLoader,
            scene: input.scene,
            textureLoader: this.contentSession.getCacheSession().loaders.textureLoader,
            baseX: input.baseX,
            baseY: input.baseY,
            borderSize: input.borderSize,
            objSpawns: input.objSpawns,
            interactIds: input.interactIds,
            minimizeDrawCalls: input.minimizeDrawCalls,
        });
    }

    async loadMinimapBlob(input: MapRenderMinimapBlobInput): Promise<Blob> {
        return loadMinimapBlob(
            this.mapImageRenderer,
            input.scene,
            input.level | 0,
            input.borderSize | 0,
            input.drawMapFunctions === true,
        );
    }

    createSceneCacheProvider() {
        const session = this.contentSession.getCacheSession();
        return createSceneBuildCacheProvider({
            mapBytesProvider: this.contentSession.getRunescapeWorldChunkSource(),
            locTypeLoader: session.loaders.locTypeLoader,
            objTypeLoader: session.loaders.objTypeLoader,
            modelLoader: session.loaders.modelLoader as ModelLoader,
            seqTypeLoader: session.loaders.seqTypeLoader,
            seqFrameLoader: session.loaders.seqFrameLoader as SeqFrameLoader,
            skeletalSeqLoader: session.loaders.skeletalSeqLoader as SkeletalSeqLoader | undefined,
            npcTypeLoader: session.loaders.npcTypeLoader,
            basTypeLoader: session.loaders.basTypeLoader,
            underlayTypeLoader: session.loaders.underlayTypeLoader,
            overlayTypeLoader: session.loaders.overlayTypeLoader,
            varbitLoader: session.loaders.varBitTypeLoader,
            textureLoader: session.getTextureLoader() as TextureLoader,
        });
    }

    async resolveNpcSpawns(input: MapRenderResolveNpcSpawnsInput): Promise<readonly NpcSpawn[]> {
        const session = this.contentSession.getCacheSession();
        return input.npcSpawnResolver.resolveSpawns(
            {
                mapBytesProvider: this.contentSession.getRunescapeWorldChunkSource(),
                cacheInfo: session.cache.info,
                npcSpawnDecodeBackend: input.npcSpawnDecodeBackend,
                fallbackNpcSpawns: input.fallbackNpcSpawns,
                telemetry: input.telemetry,
            },
            {
                loadNpcs: input.loadNpcs,
                mapX: input.mapX,
                mapY: input.mapY,
                maxLevel: input.maxLevel,
                borderSize: input.borderSize,
                tileRenderFlagsLevel1: input.tileRenderFlagsLevel1,
                npcTypeLoader: session.loaders.npcTypeLoader,
                fallbackOnEmptyCacheDecode: input.fallbackOnEmptyCacheDecode,
            },
        );
    }

    buildSceneForMapId(input: WorldRuntimeSceneBuildByMapIdInput): Scene {
        const { mapX, mapY } = decodeMapSquareFromId(input.mapId | 0);
        return this.buildScene({
            mapX,
            mapY,
            borderSize: input.borderSize | 0,
            smoothTerrain: input.smoothTerrain,
            locLoadType: input.locLoadType,
            locPlacementOverrides: input.locPlacementOverrides,
        });
    }

    async loadMapImage(input: WorldRuntimeMapImageInput): Promise<MinimapData> {
        const scene = this.buildScene({
            mapX: input.mapX | 0,
            mapY: input.mapY | 0,
            borderSize: input.borderSize | 0,
            locLoadType: LocLoadType.NO_MODELS,
        });
        const minimapBlob = await this.loadMinimapBlob({
            scene,
            level: input.level | 0,
            borderSize: input.borderSize | 0,
            drawMapFunctions: input.drawMapFunctions === true,
        });
        return {
            mapX: input.mapX | 0,
            mapY: input.mapY | 0,
            level: input.level | 0,
            cacheInfo: this.getCacheInfo(),
            minimapBlob,
        };
    }

    async resolveNpcBootstrapData(
        npcSpawnResolver: NpcSpawnResolver,
        input: WorldRuntimeNpcBootstrapInput,
    ): Promise<ResolvedBootstrapData> {
        const session = this.contentSession.getCacheSession();
        return resolveBootstrapData(
            npcSpawnResolver,
            {
                mapBytesProvider: this.contentSession.getRunescapeWorldChunkSource(),
                cacheInfo: session.cache.info,
                npcTypeLoader: session.loaders.npcTypeLoader as NpcTypeLoader,
                fallbackNpcSpawns: input.fallbackNpcSpawns,
            },
            {
                mapId: input.mapId | 0,
                maxLevel: input.maxLevel | 0,
                borderSize: input.borderSize | 0,
                tileRenderFlagsLevel1: input.tileRenderFlagsLevel1,
                npcOrderKeys: input.npcOrderKeys,
            },
        );
    }

    buildMapObjRenderData(input: WorldRuntimeMapObjRenderInput): ObjRenderData | undefined {
        if ((input.objSpawns.length | 0) <= 0) {
            return undefined;
        }
        const { mapX, mapY } = decodeMapSquareFromId(input.mapId | 0);
        const borderSize = input.borderSize | 0;
        const baseX = mapX * Scene.MAP_SQUARE_SIZE - borderSize;
        const baseY = mapY * Scene.MAP_SQUARE_SIZE - borderSize;
        const scene = this.buildSceneForMapId({
            mapId: input.mapId | 0,
            borderSize,
            locLoadType: LocLoadType.NO_MODELS,
        });
        return this.buildObjRenderData({
            loadObjs: true,
            scene,
            baseX,
            baseY,
            borderSize,
            objSpawns: input.objSpawns,
            interactIds: input.interactIds,
            minimizeDrawCalls: input.minimizeDrawCalls,
        });
    }

    async exportSpritesToZip(): Promise<Blob> {
        const session = this.contentSession.getCacheSession();
        const zip = new JSZip();
        const cacheType = session.cache.type;
        if (cacheType === CacheType.Dat2) {
            await appendDat2SpritesToZip(session, zip);
        } else if (cacheType === CacheType.Dat) {
            await appendDatSpritesToZip(session, zip);
        }
        return zip.generateAsync({ type: "blob" });
    }

    async exportTexturesToZip(): Promise<Blob> {
        const textureLoader = this.contentSession.getCacheSession().getTextureLoader();
        const textureSize = 128;
        const zip = new JSZip();

        const textureIds = textureLoader.getTextureIds();
        for (let i = 0; i < textureIds.length; i++) {
            const id = textureIds[i];
            if (id === undefined) {
                continue;
            }
            const pixels = textureLoader.tryGetPixelsArgb(id, textureSize, true, 1.0);
            if (!pixels) {
                console.error("Failed to export texture", id);
                continue;
            }

            const canvas = new OffscreenCanvas(textureSize, textureSize);
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                continue;
            }
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
            const pngData = atob(dataUrl.split(",")[1] ?? "");
            zip.file(`${id}.png`, pngData, { binary: true });
        }

        return zip.generateAsync({ type: "blob" });
    }
}

export function createRunescapeMapRenderAdapter(
    contentSession: RunescapeContentSession,
): RunescapeMapRenderAdapter {
    return new RunescapeMapRenderAdapter(contentSession);
}

export function requireRunescapeMapRenderAdapter(
    buildAdapter: ContentBuildAdapter,
): RunescapeMapRenderAdapter {
    if (buildAdapter instanceof RunescapeMapRenderAdapter) {
        return buildAdapter;
    }
    throw new Error("Expected RunescapeMapRenderAdapter");
}
