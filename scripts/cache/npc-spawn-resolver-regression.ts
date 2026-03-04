import assert from "assert";

import { NpcSpawnResolver } from "../../src/data/npc/NpcSpawnResolver";
import type { MapBytesProvider } from "../../src/rs/map/MapBytesProvider";
import type { NpcTypeLoader } from "../../src/rs/config/npctype/NpcTypeLoader";

type NpcType = Readonly<{ name: string; loginScreenProps: number }>;

function createNpcTypeLoader(typesById: ReadonlyMap<number, NpcType>): NpcTypeLoader {
    return {
        getCount: () => 2048,
        tryLoad: (id: number) => {
            const type = typesById.get(id | 0);
            if (!type) {
                return { ok: false } as const;
            }
            return { ok: true, value: type } as const;
        },
    } as unknown as NpcTypeLoader;
}

function createMapBytesProvider(bytes: Uint8Array | undefined): MapBytesProvider {
    return {
        getTerrainBytes: () => undefined,
        getLocBytes: () => undefined,
        getNpcSpawnBytes: () => bytes,
    };
}

async function main(): Promise<void> {
    const resolver = new NpcSpawnResolver();
    const logs: string[] = [];
    const telemetry = {
        now: () => 1000,
        log: (message: string) => logs.push(message),
    };

    const npcTypeLoader = createNpcTypeLoader(
        new Map([
            [1, { name: "Renderable", loginScreenProps: 0x1 }],
            [2, { name: "Hidden", loginScreenProps: 0x0 }],
            [3, { name: "CorrectName", loginScreenProps: 0x1 }],
            [4, { name: "FallbackNoName", loginScreenProps: 0x1 }],
        ]),
    );

    const borderSize = 6;
    const mapX = 50;
    const mapY = 50;
    const maxLevel = 3;
    const tileRenderFlagsLevel1: Uint8Array[] = [];

    // 1) Cache decode path filters loginScreenProps when backend doesn't.
    {
        const spawnsDecoded = [
            { id: 1, x: mapX * 64 + 1, y: mapY * 64 + 2, level: 0 },
            { id: 2, x: mapX * 64 + 3, y: mapY * 64 + 4, level: 0 },
        ];
        const spawns = await resolver.resolveSpawns(
            {
                mapBytesProvider: createMapBytesProvider(new Uint8Array([1])),
                cacheInfo: { game: 2, revision: 221, name: "test" } as any,
                npcSpawnDecodeBackend: {
                    name: "mock",
                    decodeNpcSpawnsFromBytes: async () => spawnsDecoded,
                },
                fallbackNpcSpawns: [],
                telemetry,
            },
            {
                loadNpcs: true,
                mapX,
                mapY,
                maxLevel,
                borderSize,
                tileRenderFlagsLevel1,
                npcTypeLoader,
            },
        );
        assert.deepStrictEqual(
            spawns.map((s) => s.id),
            [1],
            "expected loginScreenProps filter to drop id=2",
        );
        assert.ok(logs.some((l) => l.includes("npcDecodeBackend=mock")), "expected telemetry log");
    }

    // 2) When backend pre-filters loginScreenProps, resolver doesn't filter again.
    {
        const spawnsDecoded = [
            { id: 1, x: mapX * 64 + 1, y: mapY * 64 + 2, level: 0 },
            { id: 2, x: mapX * 64 + 3, y: mapY * 64 + 4, level: 0 },
        ];
        const spawns = await resolver.resolveSpawns(
            {
                mapBytesProvider: createMapBytesProvider(new Uint8Array([1])),
                cacheInfo: { game: 2, revision: 221, name: "test" } as any,
                npcSpawnDecodeBackend: {
                    name: "mock",
                    filtersLoginScreenProps: true,
                    decodeNpcSpawnsFromBytes: async () => spawnsDecoded,
                },
                fallbackNpcSpawns: [],
            },
            {
                loadNpcs: true,
                mapX,
                mapY,
                maxLevel,
                borderSize,
                tileRenderFlagsLevel1,
                npcTypeLoader,
            },
        );
        assert.deepStrictEqual(
            spawns.map((s) => s.id),
            [1, 2],
            "expected no additional filtering when backend filtersLoginScreenProps=true",
        );
    }

    // 3) Fallback path applies name matching when spawn.name is present.
    {
        const fallbackNpcSpawns = [
            { id: 3, name: "WrongName", x: mapX * 64 + 10, y: mapY * 64 + 10, level: 0 },
            { id: 4, x: mapX * 64 + 11, y: mapY * 64 + 11, level: 0 },
        ];
        const spawns = await resolver.resolveSpawns(
            {
                mapBytesProvider: createMapBytesProvider(undefined),
                cacheInfo: { game: 2, revision: 221, name: "test" } as any,
                fallbackNpcSpawns,
            },
            {
                loadNpcs: true,
                mapX,
                mapY,
                maxLevel,
                borderSize,
                tileRenderFlagsLevel1,
                npcTypeLoader,
            },
        );
        assert.deepStrictEqual(
            spawns.map((s) => s.id),
            [4],
            "expected name-mismatch spawn to be filtered out",
        );
    }

    // 4) Worker bootstrap behavior: fallback can be enabled when cache decode is empty.
    {
        const fallbackNpcSpawns = [
            { id: 1, x: mapX * 64 + 20, y: mapY * 64 + 20, level: 0 },
        ];
        const spawnsWithoutFallback = await resolver.resolveSpawns(
            {
                mapBytesProvider: createMapBytesProvider(new Uint8Array([1])),
                cacheInfo: { game: 2, revision: 221, name: "test" } as any,
                npcSpawnDecodeBackend: {
                    name: "mock",
                    decodeNpcSpawnsFromBytes: async () => [],
                },
                fallbackNpcSpawns,
            },
            {
                loadNpcs: true,
                mapX,
                mapY,
                maxLevel,
                borderSize,
                tileRenderFlagsLevel1,
                npcTypeLoader,
            },
        );
        assert.deepStrictEqual(spawnsWithoutFallback, [], "expected empty cache decode to win by default");

        const spawnsWithFallback = await resolver.resolveSpawns(
            {
                mapBytesProvider: createMapBytesProvider(new Uint8Array([1])),
                cacheInfo: { game: 2, revision: 221, name: "test" } as any,
                npcSpawnDecodeBackend: {
                    name: "mock",
                    decodeNpcSpawnsFromBytes: async () => [],
                },
                fallbackNpcSpawns,
            },
            {
                loadNpcs: true,
                mapX,
                mapY,
                maxLevel,
                borderSize,
                tileRenderFlagsLevel1,
                npcTypeLoader,
                fallbackOnEmptyCacheDecode: true,
            },
        );
        assert.deepStrictEqual(
            spawnsWithFallback.map((s) => s.id),
            [1],
            "expected fallback to activate when fallbackOnEmptyCacheDecode=true",
        );
    }

    console.log("npc-spawn-resolver-regression: ok");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

