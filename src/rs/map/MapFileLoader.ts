import { XteaMap } from "../../util/Caches";
import { errorToString } from "../../util/ErrorUtil";
import { Result, err, ok } from "../../util/Result";
import { CacheIndex } from "../cache/CacheIndex";
import { Bzip2 } from "../compression/Bzip2";
import { XteaKey } from "../crypto/Xtea";
import { ByteBuffer } from "../io/ByteBuffer";
import { MapFileIndex } from "./MapFileIndex";

export interface MapIndexBytesProvider {
    tryGetArchiveId(name: string): number | undefined;
    tryGetFile(archiveId: number, fileId: number): Uint8Array | undefined;
    tryGetFileKey(archiveId: number, fileId: number, key: XteaKey | null): Uint8Array | undefined;
}

/** Adapter for when you still have a `CacheIndex` at the boundary. */
export class CacheIndexMapBytesProvider implements MapIndexBytesProvider {
    constructor(readonly index: CacheIndex) {}

    tryGetArchiveId(name: string): number | undefined {
        return this.index.tryGetArchiveId(name);
    }

    tryGetFile(archiveId: number, fileId: number): Uint8Array | undefined {
        return this.index.tryGetFile(archiveId, fileId)?.data;
    }

    tryGetFileKey(archiveId: number, fileId: number, key: XteaKey | null): Uint8Array | undefined {
        return this.index.tryGetFileKey(archiveId, fileId, key)?.data;
    }
}

export type MapBytesError =
    | { kind: "missing_archive_id"; name: string; mapX: number; mapY: number }
    | { kind: "missing_archive_id_for_key"; name: string; mapX: number; mapY: number }
    | {
          kind: "missing_file";
          archiveId: number;
          fileId: number;
          mapX: number;
          mapY: number;
          name?: string;
      }
    | {
          kind: "decompress_failed";
          which: "terrain" | "loc";
          mapX: number;
          mapY: number;
          error: string;
      };

export function mapBytesErrorToString(e: MapBytesError): string {
    switch (e.kind) {
        case "missing_archive_id":
            return `Missing map archive id: ${e.name} (x=${e.mapX} y=${e.mapY})`;
        case "missing_archive_id_for_key":
            return `Missing archive id for xtea key: ${e.name} (x=${e.mapX} y=${e.mapY})`;
        case "missing_file":
            return (
                `Missing map file: archive=${e.archiveId} file=${e.fileId} (x=${e.mapX} y=${e.mapY})` +
                (e.name ? ` name=${e.name}` : "")
            );
        case "decompress_failed":
            return `Failed decompressing map ${e.which} bytes (x=${e.mapX} y=${e.mapY}): ${e.error}`;
    }
}

export class MapFileLoader {
    constructor(
        readonly mapSource: MapIndexBytesProvider,
        readonly mapFileIndex: MapFileIndex,
    ) {}

    tryLoadTerrainBytes(mapX: number, mapY: number): Result<Uint8Array, MapBytesError> {
        const archiveId = this.mapFileIndex.tryGetTerrainArchiveId(mapX, mapY);
        if (archiveId === undefined) {
            return err({ kind: "missing_archive_id", name: `m${mapX}_${mapY}`, mapX, mapY });
        }
        const bytes = this.mapSource.tryGetFile(archiveId, 0);
        if (!bytes) {
            return err({ kind: "missing_file", archiveId, fileId: 0, mapX, mapY });
        }
        return ok(bytes);
    }

    tryGetTerrainBytes(mapX: number, mapY: number): Uint8Array | undefined {
        const r = this.tryLoadTerrainBytes(mapX, mapY);
        return r.ok ? r.value : undefined;
    }

    tryLoadLocBytes(
        mapX: number,
        mapY: number,
        xteasMap: XteaMap,
    ): Result<Uint8Array, MapBytesError> {
        const archiveId = this.mapFileIndex.tryGetLocArchiveId(mapX, mapY);
        if (archiveId === undefined) {
            return err({ kind: "missing_archive_id", name: `l${mapX}_${mapY}`, mapX, mapY });
        }
        const key = xteasMap.get(archiveId);
        const bytes = this.mapSource.tryGetFileKey(archiveId, 0, key ? key : null);
        if (!bytes) {
            return err({ kind: "missing_file", archiveId, fileId: 0, mapX, mapY });
        }
        return ok(bytes);
    }

    tryGetLocBytes(mapX: number, mapY: number, xteasMap: XteaMap): Uint8Array | undefined {
        const r = this.tryLoadLocBytes(mapX, mapY, xteasMap);
        return r.ok ? r.value : undefined;
    }

    tryLoadNpcSpawnBytes(
        mapX: number,
        mapY: number,
        xteasMap: XteaMap,
    ): Result<Uint8Array, MapBytesError> {
        const locArchiveId = this.mapFileIndex.tryGetLocArchiveId(mapX, mapY);
        const archiveId = this.mapSource.tryGetArchiveId(`n${mapX}_${mapY}`);
        if (archiveId === undefined) {
            return err({ kind: "missing_archive_id", name: `n${mapX}_${mapY}`, mapX, mapY });
        }
        if (locArchiveId === undefined) {
            return err({
                kind: "missing_archive_id_for_key",
                name: `l${mapX}_${mapY}`,
                mapX,
                mapY,
            });
        }
        const key = xteasMap.get(locArchiveId);
        const bytes = this.mapSource.tryGetFileKey(archiveId, 0, key ? key : null);
        if (!bytes) {
            return err({ kind: "missing_file", archiveId, fileId: 0, mapX, mapY });
        }
        return ok(bytes);
    }

    tryGetNpcSpawnBytes(mapX: number, mapY: number, xteasMap: XteaMap): Uint8Array | undefined {
        const r = this.tryLoadNpcSpawnBytes(mapX, mapY, xteasMap);
        return r.ok ? r.value : undefined;
    }
}

export class LegacyMapFileLoader extends MapFileLoader {
    private readonly terrainDecompressErrors: Set<number> = new Set();
    private readonly locDecompressErrors: Set<number> = new Set();

    decompress(data: Uint8Array): Uint8Array {
        const buffer = new ByteBuffer(data);
        const actualSize = buffer.readInt();
        const compressed = buffer.readUnsignedBytes(buffer.remaining);
        const decompressed = Bzip2.decompress(compressed, actualSize);
        return decompressed;
    }

    constructor(
        mapSource: MapIndexBytesProvider,
        mapFileIndex: MapFileIndex,
        readonly errorSink: ((error: MapBytesError) => void) | undefined = (e) =>
            console.error(mapBytesErrorToString(e)),
    ) {
        super(mapSource, mapFileIndex);
    }

    private reportTerrainOnce(mapX: number, mapY: number, error: unknown): void {
        const mapId = (mapX << 8) + mapY;
        if (this.terrainDecompressErrors.has(mapId)) return;
        this.terrainDecompressErrors.add(mapId);
        this.errorSink?.({
            kind: "decompress_failed",
            which: "terrain",
            mapX,
            mapY,
            error: errorToString(error),
        });
    }

    private reportLocOnce(mapX: number, mapY: number, error: unknown): void {
        const mapId = (mapX << 8) + mapY;
        if (this.locDecompressErrors.has(mapId)) return;
        this.locDecompressErrors.add(mapId);
        this.errorSink?.({
            kind: "decompress_failed",
            which: "loc",
            mapX,
            mapY,
            error: errorToString(error),
        });
    }

    override tryLoadTerrainBytes(mapX: number, mapY: number): Result<Uint8Array, MapBytesError> {
        const base = super.tryLoadTerrainBytes(mapX, mapY);
        if (!base.ok) return base;
        try {
            return ok(this.decompress(base.value));
        } catch (e) {
            this.reportTerrainOnce(mapX, mapY, e);
            return err({
                kind: "decompress_failed",
                which: "terrain",
                mapX,
                mapY,
                error: errorToString(e),
            });
        }
    }

    override tryLoadLocBytes(
        mapX: number,
        mapY: number,
        xteasMap: XteaMap,
    ): Result<Uint8Array, MapBytesError> {
        const base = super.tryLoadLocBytes(mapX, mapY, xteasMap);
        if (!base.ok) return base;
        try {
            return ok(this.decompress(base.value));
        } catch (e) {
            this.reportLocOnce(mapX, mapY, e);
            return err({
                kind: "decompress_failed",
                which: "loc",
                mapX,
                mapY,
                error: errorToString(e),
            });
        }
    }
}
