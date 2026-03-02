import assert from "node:assert/strict";

import { collectTerrainTileVertexRecords } from "../../src/runtime/build/SceneBuffer";

function runRegression(): void {
    const empty = collectTerrainTileVertexRecords({ tileModel: undefined } as any, 10, 20);
    assert.equal(empty.length, 0, "no tile model yields no terrain vertices");

    const tile = {
        tileModel: {
            faces: [
                {
                    vertices: [
                        {
                            x: 1,
                            y: 2,
                            z: 3,
                            hsl: 4,
                            u: 0.1,
                            v: 0.2,
                            textureId: 5,
                            textureId1: 6,
                            texBlend: 7,
                        },
                        {
                            x: 8,
                            y: 9,
                            z: 10,
                            hsl: 11,
                            u: 0.3,
                            v: 0.4,
                            textureId: -1,
                            textureId1: -1,
                            texBlend: 0,
                        },
                        {
                            x: 12,
                            y: 13,
                            z: 14,
                            hsl: 15,
                            u: 0.5,
                            v: 0.6,
                            textureId: 16,
                            textureId1: 17,
                            texBlend: 18,
                        },
                    ],
                },
            ],
        },
    };

    const out = collectTerrainTileVertexRecords(tile as any, 100, -50);
    assert.equal(out.length, 3, "single face emits three vertices");
    assert.deepEqual(out[0], {
        x: 101,
        y: 2,
        z: -47,
        hsl: 4,
        u: 0.1,
        v: 0.2,
        textureId: 5,
        textureId1: 6,
        texBlend: 7,
    });
    assert.deepEqual(out[2], {
        x: 112,
        y: 13,
        z: -36,
        hsl: 15,
        u: 0.5,
        v: 0.6,
        textureId: 16,
        textureId1: 17,
        texBlend: 18,
    });
}

async function main(): Promise<void> {
    runRegression();
    console.log("terrain-vertex-emitter-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
