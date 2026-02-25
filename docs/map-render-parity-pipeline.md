# Map Render Parity Pipeline

This pipeline is the baseline workflow for fixing TS vs C++ map-render divergence.

## Stages

1. `input`

-   Confirms cache-v2 map input digest parity.
-   Ensures the runtime receives the same square/terrain/loc bytes as TS.

2. `commandStream`

-   Compares TS runtime command-stream digest against C++ cached command-stream digest.
-   This isolates command generation divergence before packet conversion.

3. `packet`

-   Compares final runtime packet overlays (`heightMap`, `drawRanges`, `modelInfo`).
-   This is the renderer-facing parity gate.

## Commands

1. Full suite (fixed default square list):

```bash
npm run -s rs:map-render-parity-full
```

2. Focused staged parity for selected squares:

```bash
npm run -s rs:map-render-runtime-cache-v2-parity -- --squares 50:50,50:51 --stages
```

## Debug order

1. Fix `input` mismatches first.
2. Fix `commandStream` mismatches second.
3. Fix `packet` mismatches last.

Do not optimize batching/instancing while any stage is failing.
