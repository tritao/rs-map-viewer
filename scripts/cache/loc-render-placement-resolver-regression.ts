import assert from "node:assert/strict";

import { LocModelType } from "../../src/rs/config/loctype/LocModelType";
import { LocEntity } from "../../src/rs/scene/entity/LocEntity";
import { resolveLocRenderPlacement } from "../../src/runtime/build";
import type { SceneLocEntity } from "../../src/runtime/build";

function buildHeightMap(
    sizeX: number,
    sizeY: number,
    valueAt: (x: number, y: number) => number,
): Int32Array[] {
    const map: Int32Array[] = [];
    for (let x = 0; x <= sizeX; x++) {
        const col = new Int32Array(sizeY + 1);
        for (let y = 0; y <= sizeY; y++) {
            col[y] = valueAt(x, y);
        }
        map.push(col);
    }
    return map;
}

function makeSceneLocEntity(entity: LocEntity): SceneLocEntity {
    return {
        entity,
        sceneLoc: {
            tag: 0 as any,
            flags: 0,
            x: 0,
            y: 0,
            height: 0,
        },
        lowDetail: false,
        sceneX: 0,
        sceneZ: 0,
        heightOffset: 0,
        level: entity.level,
        contourGround: 0,
        priority: 1,
        interactType: 1,
        interactId: entity.id,
    };
}

function runRegression(): void {
    const heightMap = buildHeightMap(4, 4, (x, y) => x * 100 + y * 10);
    const scene = {
        levels: 1,
        tileHeights: [heightMap],
        tiles: [Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => undefined))],
        isInside() {
            return false;
        },
    } as any;

    const resolvedLocType = {
        id: 42,
        sizeX: 2,
        sizeY: 1,
        contourGroundType: 2,
        contourGroundParam: 7,
        transforms: undefined,
        isInteractive: 0,
        clipType: 0,
        obstructsGround: false,
    };

    const transformedLocType = {
        id: 77,
        sizeX: 1,
        sizeY: 1,
        contourGroundType: 1,
        contourGroundParam: 9,
        transforms: undefined,
        isInteractive: 0,
        clipType: 0,
        obstructsGround: false,
    };

    const transformingLocType = {
        ...resolvedLocType,
        transforms: [1],
        transform() {
            return transformedLocType;
        },
    };

    const locTypeLoader = {
        tryLoad(id: number) {
            if (id === 42) {
                return { ok: true as const, value: resolvedLocType };
            }
            if (id === 90) {
                return { ok: true as const, value: transformingLocType };
            }
            return { ok: false as const };
        },
    };

    const varProvider = {
        getVarbit() {
            return 0;
        },
        getVarp() {
            return 0;
        },
    };

    const directEntity = new LocEntity(42, LocModelType.WALL, 1, 0, 1, 1, -1, false);
    const direct = resolveLocRenderPlacement(
        scene,
        makeSceneLocEntity(directEntity),
        locTypeLoader as any,
        varProvider as any,
        true,
    );
    assert.ok(direct, "direct loc should resolve");
    assert.equal(direct!.locType.id, 42);
    assert.equal(direct!.rotation, 1);
    assert.equal(direct!.type, LocModelType.WALL);
    assert.equal(direct!.lowDetail, false);
    // rotation=1 swaps size => sizeX=1 sizeY=2, center samples: (2,2),(1,2),(1,2),(2,2) => 170
    assert.equal(direct!.centerHeight, 170);
    assert.equal(direct!.contourGroundInfo.entityX, (1 << 7) + (1 << 6));
    assert.equal(direct!.contourGroundInfo.entityZ, (1 << 7) + (2 << 6));
    assert.equal(direct!.contourGroundInfo.param, 7);

    const transformedEntity = new LocEntity(90, LocModelType.WALL, 0, 0, 2, 2, -1, false);
    const transformed = resolveLocRenderPlacement(
        scene,
        makeSceneLocEntity(transformedEntity),
        locTypeLoader as any,
        varProvider as any,
        false,
    );
    assert.ok(transformed, "transforming loc should resolve");
    assert.equal(transformed!.locType.id, 77);
    assert.equal(transformed!.contourGroundInfo.param, 9);
}

async function main(): Promise<void> {
    runRegression();
    console.log("loc-render-placement-resolver-regression: ok");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
