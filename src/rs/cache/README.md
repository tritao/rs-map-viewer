# Cache subsystem overview

This folder implements reading and decoding RuneScape caches (Legacy/Dat/Dat2) while keeping **I/O** separate from **format decoding**.

## Big picture

- A cache is a set of **indices** (configs/models/etc).
- Each index contains many **archives**.
- Each archive contains one or more **files**.

For Dat/Dat2 caches, archive bytes live in a sector-chained data file (`main_file_cache.dat` / `main_file_cache.dat2`) and are located via index files (`main_file_cache.idx*`, plus `main_file_cache.idx255` for Dat2).

## Main layers

### Platform / fetching (not core decoding)

- `platform/browser/BrowserCacheLoader.ts`: browser implementation of `platform/CacheLoader.ts` (HTTP + Cache API).
- `platform/CacheFilesFetcher.ts`: fetches a cache “bundle” into `CacheBundleTransfer` using a `CacheLoader` (knows about the hosting layout like `maps.json`, `maps/…`, part caching, etc).
- `platform/CacheFiles.ts`: a platform-layer transfer bundle (FFI/worker-friendly, no methods) plus cache filename constants.
- `platform/CacheStoreFromFiles.ts`: creates `CacheStore`/`CacheSystem` from `CacheBundleTransfer` (wraps buffers into runtime `ByteSource`s).

### Store (raw archive byte access)

The key goal is: decoders should not care *where* bytes come from (memory, file, mmap, http-range).

- `store/CacheStore.ts`: store abstraction used by indices/decoders.
  - `getIndexFileSize(indexId)`: supports Dat index construction without loading the whole `.idx` file.
  - `openArchiveReader(indexId, archiveId)`: returns a seekable `ByteSource` view over a single archive’s raw bytes.
- `store/SectorChainStore.ts`: `CacheStore` backed by seekable `ByteSource`s (a “native-shaped” implementation).
  - reads sector chains from `.dat(2)` using `.idx*` index entries.

### Indices and cache system

- `CacheSystem.ts`: constructs indices from a `CacheStore` (`fromStore` accepts any `CacheStore`).
- `CacheIndex.ts`:
  - `DatCacheIndex`: store-backed index implementation for Dat caches (archive count derived from `.idx` length).
  - `Dat2CacheIndex`: store-backed index implementation for Dat2 caches (uses `idx255` `ReferenceTable`).
  - `LegacyCacheIndex`: legacy single-file archives (no sector chain).
- `reference/*`: `ReferenceTable` and archive/file metadata (counts, ids, name hashes, whirlpools, etc).

### Format decoding (pure “bytes → structures”)

- `format/Container.ts`: decodes a cache container from a seekable `ByteSource`.
  - reads container header (compression + compressed size)
  - optionally XTEA-decrypts the container’s encrypted region
  - decompresses via `CompressionHandler`
  - returns the decompressed payload bytes
- `format/Archive.ts` / `format/ArchiveFile.ts`: decodes archive payload bytes into one or more files.
  - multi-file archives use a “chunk table” at the end of the payload to reconstruct each file’s byte stream
- `io/ByteReader.ts`: cursor-based reader abstraction (seek/tell + primitive reads) used by decoders that prefer sequential parsing without depending on `ByteBuffer`.
- `io/ByteSourceSlice.ts`: lightweight `ByteSource` view for (start, length) subranges.

## Dat2 archive decode path (typical)

1. `Dat2CacheIndex.getArchiveKey(archiveId, key)` calls `CacheStore.openArchiveReader(indexId, archiveId)` to obtain a seekable `ByteSource` for the archive.
2. `format/Container.decodeFromSource(source, key, compressionHandler)` reads only what it needs and returns the decompressed payload.
3. `format/Archive.decodeFromSource(archiveRef, payloadSource)` splits the payload into `ArchiveFile`s.
4. Higher-level loaders (models/config/etc) parse `ArchiveFile.data` with `ByteBuffer`.

## Extending for native / file-backed caches

For a native/C++ port, you typically mirror:

- `io/ByteSource` (seekable reads)
- `cache/store/CacheStore` + a store implementation (`SectorChainStore` is designed to map well to file/mmap-backed `ByteSource`)
- `cache/format/Container` + `cache/format/Archive`
- `compression/CompressionHandler` backed by native zlib/bzip2

The remaining code (type loaders, model loaders, etc) should not need to care whether bytes come from memory, disk, or network.
