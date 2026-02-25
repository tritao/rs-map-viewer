# Map Render Command Stream v1

Canonical command-stream parity fields used by TS and C++ runtime comparison.

## Scalar fields

-   `totalCmdCount`
-   `cmdBucketIndicesHash`
-   `cmdOffsetsHash`
-   `cmdElementsHash`
-   `cmdInstanceCountsHash`
-   `cmdPackedInstancesHash`
-   `verticesHash`
-   `indicesHash`

## Bucket order

`[base, alpha, lod, lodAlpha, interact, interactAlpha, interactLod, interactLodAlpha]`

## Bucket counters

-   `bucketCmdCounts[0..7]` in the order above.

## Parity rule

A command stream is parity-equal only when all scalar fields and all bucket counters match.
