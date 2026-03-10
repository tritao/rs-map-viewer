import { getMapSquareId } from "../rs/map/MapFileIndex";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { MapManager } from "./MapManager";

const CACHED_MAP_IMAGE_PREFIX = "/map-images/";

type MapViewerMapImagesDeps = Readonly<{
    renderWorkerPool: RenderDataWorkerPool;
    mapImageCache: Cache;
    getLoadedCacheName(): string;
    getMapManager(): MapManager;
}>;

export class MapViewerMapImages {
    private readonly mapImageUrls = new Map<number, string>();
    private readonly minimapImageUrls = new Map<number, string>();
    private readonly loadingMapImageIds = new Set<number>();

    constructor(private readonly deps: MapViewerMapImagesDeps) {}

    static getCachedMapImageUrl(mapX: number, mapY: number): string {
        return CACHED_MAP_IMAGE_PREFIX + `${mapX}_${mapY}.png`;
    }

    loadCachedUrls(): void {
        this.deps.renderWorkerPool.build.loadCachedMapImages().then((mapImageUrls) => {
            mapImageUrls.forEach((value, key) => this.mapImageUrls.set(key, value));
        });
    }

    async queueLoadMapImage(mapX: number, mapY: number): Promise<void> {
        const mapManager = this.deps.getMapManager();
        const mapId = getMapSquareId(mapX, mapY);
        if (
            this.loadingMapImageIds.size > this.deps.renderWorkerPool.size * 4 ||
            this.mapImageUrls.has(mapId) ||
            this.loadingMapImageIds.has(mapId) ||
            mapManager.invalidMapIds.has(mapId) ||
            mapManager.loadingMapIds.has(mapId)
        ) {
            return;
        }
        this.loadingMapImageIds.add(mapId);

        const minimapData = await this.deps.renderWorkerPool.build.loadMapImage(
            mapX,
            mapY,
            0,
            true,
        );
        if (minimapData) {
            const url = URL.createObjectURL(minimapData.minimapBlob);
            this.setMapImageUrl(mapX, mapY, url, false);
        } else {
            mapManager.invalidMapIds.add(mapId);
        }

        this.loadingMapImageIds.delete(mapId);
    }

    warmLoadedMapMinimap(mapX: number, mapY: number, minimapBlob: Blob): void {
        if (minimapBlob.size > 0) {
            this.setMapImageUrl(mapX, mapY, URL.createObjectURL(minimapBlob), true, false);
            return;
        }

        void this.deps.renderWorkerPool.build
            .loadMapImage(mapX, mapY, 0, false)
            .then((minimapData) => {
                if (!minimapData || minimapData.minimapBlob.size <= 0) {
                    return;
                }
                this.setMapImageUrl(
                    mapX,
                    mapY,
                    URL.createObjectURL(minimapData.minimapBlob),
                    true,
                    false,
                );
            })
            .catch(() => {
                // Ignore minimap warmup failures; map render path is still valid.
            });
    }

    getMapImageUrl(mapX: number, mapY: number, minimap: boolean): string | undefined {
        if (mapX < 0 || mapY < 0 || mapX >= MapManager.MAX_MAP_X || mapY >= MapManager.MAX_MAP_Y) {
            return undefined;
        }
        const urls = minimap ? this.minimapImageUrls : this.mapImageUrls;
        if (minimap) {
            this.deps.getMapManager().loadMap(mapX, mapY);
        } else {
            void this.queueLoadMapImage(mapX, mapY);
        }
        return urls.get(getMapSquareId(mapX, mapY));
    }

    setMapImageUrl(
        mapX: number,
        mapY: number,
        url: string,
        minimap: boolean,
        cache: boolean = true,
    ): void {
        const mapId = getMapSquareId(mapX, mapY);
        const urls = minimap ? this.minimapImageUrls : this.mapImageUrls;
        const old = urls.get(mapId);
        if (old) {
            URL.revokeObjectURL(old);
        }
        if (cache) {
            fetch(url).then((resp) => {
                if (resp.ok) {
                    const request = new Request(
                        MapViewerMapImages.getCachedMapImageUrl(mapX, mapY),
                        {
                            headers: {
                                "RS-Cache-Name": this.deps.getLoadedCacheName(),
                            },
                        },
                    );
                    this.deps.mapImageCache.put(request, resp);
                }
            });
        }
        urls.set(mapId, url);
    }

    clear(): void {
        for (const url of this.mapImageUrls.values()) {
            URL.revokeObjectURL(url);
        }
        for (const url of this.minimapImageUrls.values()) {
            URL.revokeObjectURL(url);
        }
        this.mapImageUrls.clear();
        this.minimapImageUrls.clear();
        this.loadingMapImageIds.clear();
    }
}
