# Cache fixtures

This folder contains small, deterministic binary fixtures used to validate a C++ port of the cache/I/O layer.

Regenerate (deterministically) from repo root:

-   `npm run generate-fixtures`

Notes:

-   Fixtures are designed to avoid depending on external cache downloads.
-   These fixtures are used for cross-language cache/I/O conformance checks.
