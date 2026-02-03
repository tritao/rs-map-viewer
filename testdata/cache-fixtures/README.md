# Cache fixtures

This folder contains small, deterministic binary fixtures used to validate a C++ port of the cache/I/O layer.

Regenerate (deterministically) from repo root:

- `npm run generate-fixtures`

Notes:

- Fixtures are designed to avoid depending on external cache downloads.
- The C++ harness reads these files via `cpp-core` tests.

