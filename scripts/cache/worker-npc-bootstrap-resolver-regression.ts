import assert from "node:assert/strict";

import { CacheInfo, GameType } from "../../src/rs/cache/CacheInfo";
import { DummyTypeLoader } from "../../src/rs/config/TypeLoader";
import { NpcType } from "../../src/rs/config/npctype/NpcType";
import type { MapBytesProvider } from "../../src/rs/map/MapBytesProvider";
import { NpcSpawnResolver } from "../../src/data/npc/NpcSpawnResolver";
import { resolveBootstrapData } from "../../src/runtime/sim/NpcBootstrap";

async function main(): Promise<void> {
    const resolver = new NpcSpawnResolver();
    let fetchCalls = 0;
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
        fetchCalls = (fetchCalls + 1) | 0;
        throw new Error("unexpected fetch call");
    }) as typeof fetch;

    try {
        const mapX = 50;
        const mapY = 50;
        const mapId = ((mapX << 8) | mapY) | 0;
        const mapBytesProvider: MapBytesProvider = {
            getTerrainBytes(): Uint8Array | undefined {
                return undefined;
            },
            getLocBytes(): Uint8Array | undefined {
                return undefined;
            },
            getNpcSpawnBytes(): Uint8Array | undefined {
                return undefined;
            },
        };
        const result = await resolveBootstrapData(
            resolver,
            {
                mapBytesProvider,
                cacheInfo: new CacheInfo("dummy", GameType.Runescape, "live", 667, "", 0),
                npcTypeLoader: new DummyTypeLoader(
                    new CacheInfo("dummy", GameType.Runescape, "live", 667, "", 0),
                    NpcType,
                ),
                fallbackNpcSpawns: [
                    { id: 1, x: mapX * 64 + 10, y: mapY * 64 + 10, level: 0 },
                    { id: 2, x: 99 * 64 + 10, y: 99 * 64 + 10, level: 0 },
                ],
            },
            {
                mapId,
                maxLevel: 0,
                borderSize: 6,
                tileRenderFlagsLevel1: [],
                npcOrderKeys: new Int32Array(0),
            },
        );

        assert.equal(fetchCalls, 0, "resolver should not fetch fallback data");
        assert.equal(result.source, "fallbackDataset");
        assert.equal(result.spawnEvents.length, 1);
        assert.equal(result.spawnEvents[0]!.mapId | 0, mapId | 0);
        assert.equal(result.spawnEvents[0]!.npcTypeId | 0, 1);
    } finally {
        globalThis.fetch = prevFetch;
    }

    console.log("worker-npc-bootstrap-resolver-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
