import { CacheInfo, getLatestCache } from "../../src/rs/cache/CacheInfo";
import { JSCompressionHandler } from "../../src/rs/compression/JSCompressionHandler";
import { VarManagerProvider } from "../../src/rs/config/vartype/VarProvider";
import { tryCreateCacheSession } from "../../src/rs/loaders/CacheSession";
import { MapFileBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { MergeNormalsScratch } from "../../src/rs/model/ModelData";
import { Scene } from "../../src/rs/scene/Scene";
import {
    createSceneBuildContext,
    decodeLocsStage,
    decodeTerrainStage,
    fillEmptyTerrainStage,
} from "../../src/rs/scene/SceneBuildStages";
import { LocLoadType, SceneBuilder } from "../../src/rs/scene/SceneBuilder";
import { lightSceneModelData } from "../../src/rs/scene/SceneLighting";
import { LocModelLoader } from "../../src/rs/scene/model/LocModelLoader";
import { ModelHashBuffer } from "../../src/runtime/build/ModelHashBuffer";
import { SceneBuffer } from "../../src/runtime/build/SceneBuffer";
import {
    DRAW_BUCKET_KEYS,
    collectRuntimeDrawCommandBuckets,
} from "../../src/runtime/build/SceneCommandBuilder";
import { emitSceneModelsToSceneBuffer } from "../../src/runtime/build/SceneCommandPlan";
import { getSceneLocs } from "../../src/runtime/build/SceneLocs";
import { loadCache, loadCacheInfos } from "./load-util";

type Square = Readonly<{ mapX: number; mapY: number }>;

type Args = Readonly<{
    cacheName?: string;
    squares: ReadonlyArray<Square>;
}>;

type SceneRenderDigest = Readonly<{
    verticesLength: number;
    verticesHash: number;
    indicesLength: number;
    indicesHash: number;
    commandCount: number;
    commandCountsByBucket: Int32Array;
    commandHash: number;
}>;

const BORDER_SIZE = 6;
const MAP_SIZE = Scene.MAP_SQUARE_SIZE + BORDER_SIZE * 2;
const MAX_LEVEL = 3;
const DEFAULT_SQUARES: ReadonlyArray<Square> = [
    { mapX: 16, mapY: 50 },
    { mapX: 16, mapY: 51 },
    { mapX: 16, mapY: 52 },
    { mapX: 17, mapY: 50 },
    { mapX: 17, mapY: 51 },
    { mapX: 17, mapY: 52 },
    { mapX: 18, mapY: 51 },
    { mapX: 18, mapY: 52 },
    { mapX: 18, mapY: 53 },
    { mapX: 19, mapY: 52 },
    { mapX: 19, mapY: 53 },
    { mapX: 20, mapY: 53 },
];

function parseArgs(argv: string[]): Args {
    let cacheName: string | undefined;
    let squares: Square[] = [...DEFAULT_SQUARES];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--cache") {
            cacheName = argv[++i];
        } else if (arg === "--squares") {
            const raw = argv[++i] ?? "";
            const parsed: Square[] = [];
            const tokens = raw
                .split(/[;,]/)
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
            for (let t = 0; t < tokens.length; t++) {
                const parts = tokens[t].split(":");
                if (parts.length !== 2) {
                    throw new Error("Invalid --squares format; expected mapX:mapY[,mapX:mapY]");
                }
                const mapX = Number(parts[0]);
                const mapY = Number(parts[1]);
                if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) {
                    throw new Error("Invalid --squares value");
                }
                parsed.push({ mapX: mapX | 0, mapY: mapY | 0 });
            }
            squares = parsed;
        }
    }
    if (squares.length === 0) {
        throw new Error("No squares provided");
    }
    return { cacheName, squares };
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

function fnv1a32UpdateInt(hash: number, value: number): number {
    let h = hash >>> 0;
    const v = value >>> 0;
    h ^= v & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 16777619);
    return h >>> 0;
}

function fnv1a32UpdateByte(hash: number, value: number): number {
    const h = ((hash >>> 0) ^ (value & 0xff)) >>> 0;
    return Math.imul(h, 16777619) >>> 0;
}

function hashI32Array(data: ArrayLike<number>): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < data.length; i++) {
        h = fnv1a32UpdateInt(h, data[i] | 0);
    }
    return h >>> 0;
}

function hashByteArray(data: Uint8Array): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < data.length; i++) {
        h = fnv1a32UpdateByte(h, data[i] | 0);
    }
    return h >>> 0;
}

function digestCommandBuckets(
    buckets: ReturnType<typeof collectRuntimeDrawCommandBuckets>,
): Readonly<{ count: number; countsByBucket: Int32Array; hash: number }> {
    const countsByBucket = new Int32Array(DRAW_BUCKET_KEYS.length);
    let count = 0;
    let h = 2166136261 >>> 0;

    for (let bucketIndex = 0; bucketIndex < DRAW_BUCKET_KEYS.length; bucketIndex++) {
        const bucket = DRAW_BUCKET_KEYS[bucketIndex];
        const commands = buckets[bucket];
        countsByBucket[bucketIndex] = commands.length | 0;
        count += commands.length | 0;
        h = fnv1a32UpdateInt(h, bucketIndex | 0);
        h = fnv1a32UpdateInt(h, commands.length | 0);
        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            h = fnv1a32UpdateInt(h, command.offset | 0);
            h = fnv1a32UpdateInt(h, command.elements | 0);
            const instances = command.instances;
            h = fnv1a32UpdateInt(h, instances.length | 0);
            for (let j = 0; j < instances.length; j++) {
                const instance = instances[j];
                h = fnv1a32UpdateInt(h, instance.sceneX | 0);
                h = fnv1a32UpdateInt(h, instance.sceneZ | 0);
                h = fnv1a32UpdateInt(h, instance.heightOffset | 0);
                h = fnv1a32UpdateInt(h, instance.level | 0);
                h = fnv1a32UpdateInt(h, instance.contourGround | 0);
                h = fnv1a32UpdateInt(h, instance.priority | 0);
                h = fnv1a32UpdateInt(h, instance.interactType | 0);
                h = fnv1a32UpdateInt(h, instance.interactId | 0);
            }
        }
    }
    return { count: count | 0, countsByBucket, hash: h >>> 0 };
}

function buildSceneWithoutLighting(
    sceneBuilder: SceneBuilder,
    mapBytesProvider: MapFileBytesProvider,
    mapX: number,
    mapY: number,
): Scene {
    const baseX = mapX * Scene.MAP_SQUARE_SIZE - BORDER_SIZE;
    const baseY = mapY * Scene.MAP_SQUARE_SIZE - BORDER_SIZE;
    const context = createSceneBuildContext(
        baseX,
        baseY,
        MAP_SIZE,
        MAP_SIZE,
        false,
        LocLoadType.MODELS,
    );
    const scene = new Scene(Scene.MAX_LEVELS, context.sizeX, context.sizeY);
    const emptyTerrainIds = decodeTerrainStage(sceneBuilder, mapBytesProvider, scene, context);
    fillEmptyTerrainStage(sceneBuilder, scene, context, emptyTerrainIds);
    decodeLocsStage(sceneBuilder, mapBytesProvider, scene, context);
    sceneBuilder.addTileModels(scene, context.smoothUnderlays);
    scene.setTileMinLevels();
    return scene;
}

function digestSceneRenderOutput(
    scene: Scene,
    locTypeLoader: {
        tryLoad(id: number): unknown;
    },
    textureLoader: {
        getPixelsArgb?(id: number): unknown;
    } & object,
): SceneRenderDigest {
    const sceneBuf = new SceneBuffer(textureLoader as any, 100000);
    sceneBuf.addTerrain(scene, BORDER_SIZE, MAX_LEVEL);

    const sceneLocs = getSceneLocs(locTypeLoader as any, scene, BORDER_SIZE, MAX_LEVEL);
    emitSceneModelsToSceneBuffer(
        new ModelHashBuffer(5000),
        textureLoader as any,
        sceneBuf,
        sceneLocs.locs,
        false,
    );

    const vertices = sceneBuf.vertexBuf.byteArray();
    const indices = Int32Array.from(sceneBuf.indices);
    const commandDigest = digestCommandBuckets(collectRuntimeDrawCommandBuckets(sceneBuf));

    return {
        verticesLength: vertices.length | 0,
        verticesHash: hashByteArray(vertices) | 0,
        indicesLength: indices.length | 0,
        indicesHash: hashI32Array(indices) | 0,
        commandCount: commandDigest.count | 0,
        commandCountsByBucket: commandDigest.countsByBucket,
        commandHash: commandDigest.hash | 0,
    };
}

function digestsEqual(a: SceneRenderDigest, b: SceneRenderDigest): boolean {
    if (
        (a.verticesLength | 0) !== (b.verticesLength | 0) ||
        (a.verticesHash | 0) !== (b.verticesHash | 0) ||
        (a.indicesLength | 0) !== (b.indicesLength | 0) ||
        (a.indicesHash | 0) !== (b.indicesHash | 0) ||
        (a.commandCount | 0) !== (b.commandCount | 0) ||
        (a.commandHash | 0) !== (b.commandHash | 0)
    ) {
        return false;
    }
    for (let i = 0; i < a.commandCountsByBucket.length; i++) {
        if ((a.commandCountsByBucket[i] | 0) !== (b.commandCountsByBucket[i] | 0)) {
            return false;
        }
    }
    return true;
}

function formatDigest(d: SceneRenderDigest): string {
    return JSON.stringify({
        verticesLength: d.verticesLength | 0,
        verticesHash: (d.verticesHash | 0) >>> 0,
        indicesLength: d.indicesLength | 0,
        indicesHash: (d.indicesHash | 0) >>> 0,
        commandCount: d.commandCount | 0,
        commandHash: (d.commandHash | 0) >>> 0,
        commandCountsByBucket: Array.from(d.commandCountsByBucket).map((v) => v | 0),
    });
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const cacheInfo = pickCache(loadCacheInfos(), args.cacheName);
    const loadedCache = loadCache(cacheInfo);
    const sessionResult = tryCreateCacheSession(loadedCache as any, new JSCompressionHandler());
    if (!sessionResult.ok || !sessionResult.value) {
        throw new Error("Failed to create cache session");
    }
    const session = sessionResult.value;
    const loaders = session.loaders;
    const varProvider = new VarManagerProvider(session.varManager);
    const mapBytesProvider = new MapFileBytesProvider(
        loaders.mapFileLoader,
        loadedCache.xteas as any,
    );
    const locModelLoader = new LocModelLoader(
        loaders.locTypeLoader,
        loaders.modelLoader,
        loaders.textureLoader,
        loaders.seqTypeLoader,
        loaders.seqFrameLoader,
        session.getSkeletalSeqLoader(),
    );
    const sceneBuilder = new SceneBuilder(cacheInfo, {
        underlayTypeLoader: loaders.underlayTypeLoader,
        overlayTypeLoader: loaders.overlayTypeLoader,
        locTypeLoader: loaders.locTypeLoader,
        textureLoader: loaders.textureLoader,
        locModelLoader,
        varProvider,
    });

    let mismatches = 0;
    for (const square of args.squares) {
        const preSceneA = buildSceneWithoutLighting(
            sceneBuilder,
            mapBytesProvider,
            square.mapX,
            square.mapY,
        );
        const preSceneB = buildSceneWithoutLighting(
            sceneBuilder,
            mapBytesProvider,
            square.mapX,
            square.mapY,
        );
        const preA = digestSceneRenderOutput(
            preSceneA,
            loaders.locTypeLoader,
            loaders.textureLoader,
        );
        const preB = digestSceneRenderOutput(
            preSceneB,
            loaders.locTypeLoader,
            loaders.textureLoader,
        );
        if (!digestsEqual(preA, preB)) {
            mismatches++;
            console.error(
                `scene-light-delegation-regression pre-light mismatch at ${square.mapX},${square.mapY}`,
            );
            console.error(`  sceneA=${formatDigest(preA)}`);
            console.error(`  sceneB=${formatDigest(preB)}`);
            continue;
        }

        const postSceneA = buildSceneWithoutLighting(
            sceneBuilder,
            mapBytesProvider,
            square.mapX,
            square.mapY,
        );
        const postSceneB = buildSceneWithoutLighting(
            sceneBuilder,
            mapBytesProvider,
            square.mapX,
            square.mapY,
        );
        postSceneA.light(loaders.textureLoader, -50, -10, -50);
        lightSceneModelData(
            postSceneB,
            new MergeNormalsScratch(),
            loaders.textureLoader,
            -50,
            -10,
            -50,
        );
        const postA = digestSceneRenderOutput(
            postSceneA,
            loaders.locTypeLoader,
            loaders.textureLoader,
        );
        const postB = digestSceneRenderOutput(
            postSceneB,
            loaders.locTypeLoader,
            loaders.textureLoader,
        );
        if (!digestsEqual(postA, postB)) {
            mismatches++;
            console.error(
                `scene-light-delegation-regression post-light mismatch at ${square.mapX},${square.mapY}`,
            );
            console.error(`  scene.light=${formatDigest(postA)}`);
            console.error(`  lightSceneModelData=${formatDigest(postB)}`);
        }
    }

    console.log(
        `scene-light-delegation-regression: cache=${cacheInfo.name} squares=${args.squares.length} mismatches=${mismatches}`,
    );
    if (mismatches > 0) {
        process.exit(1);
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
