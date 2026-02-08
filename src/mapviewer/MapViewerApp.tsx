import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { registerSerializer } from "threads";
import WebFont from "webfontloader";

import { OsrsLoadingBar } from "../components/rs/loading/OsrsLoadingBar";
import { fetchObjSpawns } from "../data/obj/ObjSpawn";
import { DownloadProgress } from "../rs/cache/platform/CacheLoader";
import { formatBytes } from "../util/BytesUtil";
import { fetchCacheList } from "../util/Caches";
import { isIos, isWallpaperEngine } from "../util/DeviceUtil";
import { errorToString } from "../util/ErrorUtil";
import { renderDataLoaderSerializer } from "../worker/RenderDataLoader";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { MapViewer } from "./MapViewer";
import { MapViewerContainer } from "./MapViewerContainer";

registerSerializer(renderDataLoaderSerializer);

WebFont.load({
    custom: {
        families: ["OSRS Bold", "OSRS Small"],
    },
});

const cachesPromise = fetchCacheList();

const workerPool = RenderDataWorkerPool.create(isWallpaperEngine ? 1 : 4);

function MapViewerApp() {
    const [searchParams, setSearchParams] = useSearchParams();

    const [errorMessage, setErrorMessage] = useState<string>();
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();
    const [mapViewer, setMapViewer] = useState<MapViewer>();

    useEffect(() => {
        const abortController = new AbortController();

        const load = async () => {
            const objSpawnsPromise = fetchObjSpawns();

            const cacheList = await cachesPromise;
            if (!cacheList) {
                setErrorMessage("Failed to load cache list");
                throw new Error("No caches found");
            }

            const cacheNameParam = searchParams.get("cache");
            let cacheInfo = cacheList.latest;
            if (cacheNameParam) {
                const foundCache = cacheList.caches.find((cache) => cache.name === cacheNameParam);
                if (foundCache) {
                    cacheInfo = foundCache;
                }
            }

            const [context, objSpawns] = await Promise.all([
                MapViewer.loadCacheContext(cacheInfo, abortController.signal, setDownloadProgress),
                objSpawnsPromise,
            ]);

            const mapImageCache = await caches.open("map-images");

            const mapViewerResult = MapViewer.tryCreate(
                workerPool,
                cacheList,
                objSpawns,
                mapImageCache,
                context,
            );
            if (!mapViewerResult.ok) {
                setErrorMessage(mapViewerResult.error);
                return;
            }
            const mapViewer = mapViewerResult.value;
            mapViewer.applySearchParams(searchParams);
            mapViewer.init();

            setDownloadProgress(undefined);
            setMapViewer(mapViewer);
        };

        if (isIos) {
            setErrorMessage("iOS is not supported.");
        } else {
            load().catch((e) => {
                console.error(e);
                setErrorMessage(errorToString(e));
            });
        }

        return () => {
            abortController.abort();
        };
    }, []);

    let content: JSX.Element | undefined;
    if (errorMessage) {
        content = <div className="center-container max-height content-text">{errorMessage}</div>;
    } else if (downloadProgress) {
        const formattedCacheSize = formatBytes(downloadProgress.total);
        const progress = ((downloadProgress.current / downloadProgress.total) * 100) | 0;
        content = (
            <div className="center-container max-height">
                <OsrsLoadingBar
                    text={`Downloading cache (${formattedCacheSize})`}
                    progress={progress}
                />
            </div>
        );
    } else if (mapViewer) {
        content = <MapViewerContainer mapViewer={mapViewer} />;
    }

    return <div className="App max-height">{content}</div>;
}

export default MapViewerApp;
