import type { NpcSpawn } from "../../src/data/npc/NpcSpawn";
import type { ObjSpawn } from "../../src/data/obj/ObjSpawn";
import path from "path";
import { pathToFileURL } from "url";
import { SdMapLoaderInput } from "../../src/renderer/loader/SdMapLoaderInput";
import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { MapImageRenderer } from "../../src/rs/render/minimap/MapImageRenderer";
import { tryCreateCacheSession } from "../../src/rs/runtime/createCacheSession";
import { SceneBuilder } from "../../src/rs/scene/SceneBuilder";
import { LocModelLoader } from "../../src/rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../../src/rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../../src/rs/scene/model/ObjModelLoader";
import { createMapRenderDataBackend } from "../../src/worker/MapRenderDataBackend";
import { createSceneBuildBackend } from "../../src/worker/SceneBuildBackend";
import { loadCache, loadCacheInfos } from "./load-util";

type Args = Readonly<{
    cacheName?: string;
    limit: number;
    sampleRate: number;
}>;

type Square = Readonly<{
    mapX: number;
    mapY: number;
}>;

function parseArgs(argv: string[]): Args {
    let cacheName: string | undefined;
    let limit = 8;
    let sampleRate = 1;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") {
            cacheName = argv[++i];
        } else if (arg === "--limit") {
            limit = Number(argv[++i]);
        } else if (arg === "--sample-rate") {
            sampleRate = Number(argv[++i]);
        }
    }
    if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error("Invalid --limit");
    }
    if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
        throw new Error("Invalid --sample-rate");
    }
    return {
        cacheName,
        limit: limit | 0,
        sampleRate,
    };
}

function pickCache(caches: CacheInfo[], cacheName?: string): CacheInfo {
    const latest = getLatestCache(caches);
    if (!latest) {
        throw new Error("No caches found");
    }
    if (!cacheName) {
        return latest;
    }
    return caches.find((c) => c.name === cacheName) ?? latest;
}

function pickSquares(
    mapFileIndex: {
        tryGetTerrainArchiveId(x: number, y: number): number | undefined;
        tryGetLocArchiveId(x: number, y: number): number | undefined;
    },
    limit: number,
): Square[] {
    const squares: Square[] = [];
    outer: for (let mapX = 0; mapX <= 255; mapX++) {
        for (let mapY = 0; mapY <= 255; mapY++) {
            if (mapFileIndex.tryGetTerrainArchiveId(mapX, mapY) === undefined) {
                continue;
            }
            if (mapFileIndex.tryGetLocArchiveId(mapX, mapY) === undefined) {
                continue;
            }
            squares.push({ mapX, mapY });
            if (squares.length >= limit) {
                break outer;
            }
        }
    }
    return squares;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const cacheInfos = loadCacheInfos();
    const cacheInfo = pickCache(cacheInfos, args.cacheName);
    const loadedCache = loadCache(cacheInfo);

    const sessionResult = tryCreateCacheSession(loadedCache as any, new JSCompressionHandler());
    if (!sessionResult.ok) {
        throw new Error(`Failed to create session for ${cacheInfo.name}`);
    }
    const session = sessionResult.value;
    const loaders = session.loaders;

    const varProvider = new VarManagerProvider(session.varManager);
    const mapBytesProvider = new MapFileBytesProvider(loaders.mapFileLoader, loadedCache.xteas as any);
    const locModelLoader = new LocModelLoader(
        loaders.locTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
        loaders.seqTypeLoader,
        loaders.seqFrameLoader,
        session.getSkeletalSeqLoader(),
    );
    const objModelLoader = new ObjModelLoader(
        loaders.objTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
    );
    const npcModelLoader = new NpcModelLoader(
        loaders.npcTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
        loaders.seqTypeLoader,
        loaders.seqFrameLoader,
        session.getSkeletalSeqLoader(),
        varProvider,
    );
    const sceneBuilder = new SceneBuilder(cacheInfo, {
        underlayTypeLoader: loaders.underlayTypeLoader,
        overlayTypeLoader: loaders.overlayTypeLoader,
        locTypeLoader: loaders.locTypeLoader,
        textureLoader: loaders.textureLoader,
        locModelLoader,
        varProvider,
    });
    const sceneBuildBackend = createSceneBuildBackend("ts", {
        sceneBuilder,
        mapBytesProvider,
    });
    const mapImageRenderer = new MapImageRenderer(
        loaders.textureLoader,
        loaders.locTypeLoader,
        loaders.mapScenes,
        loaders.mapFunctions,
    );

    const mapRenderBackend = createMapRenderDataBackend(
        "cpp-wasm",
        {
            session,
            mapBytesProvider,
            locModelLoader,
            objModelLoader,
            npcModelLoader,
            sceneBuildBackend,
            mapImageRenderer,
            varProvider,
            objSpawns: [] as ObjSpawn[],
            npcSpawns: [] as NpcSpawn[],
        },
        {
            telemetry: true,
            cppWasmModuleUrl: pathToFileURL(
                path.resolve(process.cwd(), "public/wasm/rs_map_render_backend_bridge.mjs"),
            ).href,
            cppWasmRolloutMode: "shadow",
            cppWasmShadowSampleRate: args.sampleRate,
        },
    );

    const squares = pickSquares(loaders.mapFileLoader.mapFileIndex, args.limit);
    if (squares.length === 0) {
        throw new Error("No map squares found for shadow run");
    }

    for (const square of squares) {
        const input: SdMapLoaderInput = {
            mapX: square.mapX,
            mapY: square.mapY,
            maxLevel: 3,
            loadObjs: true,
            loadNpcs: true,
            loadLocs: true,
            smoothTerrain: false,
            minimizeDrawCalls: false,
            loadedTextureIds: new Set<number>(),
        };
        const result = await mapRenderBackend.buildMapData(input);
        if (!result.data) {
            throw new Error(`No map render data for ${square.mapX},${square.mapY}`);
        }
    }

    console.log(
        `map-render-backend-shadow: cache=${cacheInfo.name} squares=${squares.length} sampleRate=${args.sampleRate}`,
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
