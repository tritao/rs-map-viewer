import assert from "node:assert/strict";

import { WorkerMapSimLifecycle } from "../../src/worker/tick/WorkerTickRuntime";

function testTokenGuards(): void {
    const lifecycle = new WorkerMapSimLifecycle();
    const mapId = 13106;

    assert.equal(lifecycle.tryAcceptMapSimToken(mapId, 1), true);
    assert.equal(lifecycle.tryAcceptMapSimToken(mapId, 0), false, "stale token should be rejected");
    assert.equal(lifecycle.tryAcceptMapSimToken(mapId, 2), true);
    assert.equal(lifecycle.tryAcceptMapSimToken(mapId, 2), true, "duplicate token should be idempotent");
}

function testMissingStateWarningDedupe(): void {
    const lifecycle = new WorkerMapSimLifecycle();
    const mapId = 13106;

    assert.equal(lifecycle.consumeMissingTickStateWarning(mapId), true);
    assert.equal(lifecycle.consumeMissingTickStateWarning(mapId), false);
    lifecycle.clearMissingTickStateWarning(mapId);
    assert.equal(lifecycle.consumeMissingTickStateWarning(mapId), true);
}

function testRapidLifecycleRaceStress(iterations: number): void {
    const lifecycle = new WorkerMapSimLifecycle();
    const mapIds = [13106, 13107, 13362, 13363];
    let nextToken = 1;

    for (let i = 0; i < iterations; i++) {
        const mapId = mapIds[i % mapIds.length]!;

        const registerToken = nextToken | 0;
        nextToken = (nextToken + 1) | 0;
        assert.equal(lifecycle.tryAcceptMapSimToken(mapId, registerToken), true);
        assert.equal(lifecycle.tryAcceptMapSimToken(mapId, (registerToken - 1) | 0), false);
        assert.equal(lifecycle.tryAcceptMapSimToken(mapId, registerToken), true);

        assert.equal(lifecycle.consumeMissingTickStateWarning(mapId), true);
        assert.equal(lifecycle.consumeMissingTickStateWarning(mapId), false);
        lifecycle.clearMissingTickStateWarning(mapId);
        assert.equal(lifecycle.consumeMissingTickStateWarning(mapId), true);
        lifecycle.clearMissingTickStateWarning(mapId);

        const unregisterToken = nextToken | 0;
        nextToken = (nextToken + 1) | 0;
        assert.equal(lifecycle.tryAcceptMapSimToken(mapId, unregisterToken), true);
        assert.equal(lifecycle.tryAcceptMapSimToken(mapId, registerToken), false);

        if ((i % 97) === 0) {
            lifecycle.reset();
        }
    }
}

function parseIterations(argv: string[]): number {
    let iterations = 20_000;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--iterations") {
            const parsed = Number(argv[++i]);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                throw new Error("Invalid --iterations");
            }
            iterations = parsed | 0;
        }
    }
    return iterations;
}

async function main(): Promise<void> {
    const iterations = parseIterations(process.argv.slice(2));
    testTokenGuards();
    testMissingStateWarningDedupe();
    testRapidLifecycleRaceStress(iterations);
    console.log(`worker-map-sim-lifecycle-regression: ok (iterations=${iterations})`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
