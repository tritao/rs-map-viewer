import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import WebFont from "webfontloader";

import { OsrsLoadingBar } from "../components/rs/loading/OsrsLoadingBar";
import { DownloadProgress } from "../rs/cache/platform/CacheLoader";
import { formatBytes } from "../util/BytesUtil";
import { fetchCacheList, loadCacheContext } from "../util/Caches";
import { isIos, isWallpaperEngine } from "../util/DeviceUtil";
import { errorToString, isAbortError, throwIfAborted } from "../util/ErrorUtil";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { SimWorkerPool } from "../worker/SimWorkerPool";
import type { WorkerRuntimeOptions } from "../worker/WorkerBuildTypes";
import { MapViewer } from "./MapViewer";
import { MapViewerContainer } from "./MapViewerContainer";
import { parseMapViewerRuntimeOptions } from "./MapViewerSearchParams";

WebFont.load({
    custom: {
        families: ["OSRS Bold", "OSRS Small"],
    },
});

const cachesPromise = fetchCacheList();

const workerPool = RenderDataWorkerPool.create(isWallpaperEngine ? 1 : 4);
const simWorkerPool = SimWorkerPool.create();

function parseWorkerRuntimeOptions(searchParams: URLSearchParams): WorkerRuntimeOptions {
    return parseMapViewerRuntimeOptions(searchParams);
}

function MapViewerApp() {
    const [searchParams] = useSearchParams();
    const [initialSearchParams] = useState(() => new URLSearchParams(searchParams));

    const [errorMessage, setErrorMessage] = useState<string>();
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();
    const [mapViewer, setMapViewer] = useState<MapViewer>();

    useEffect(() => {
        const abortController = new AbortController();
        const { signal } = abortController;

        const load = async () => {
            const cacheList = await cachesPromise;
            throwIfAborted(signal);
            if (!cacheList) {
                setErrorMessage("Failed to load cache list");
                return;
            }

            const cacheNameParam = initialSearchParams.get("cache");
            let cacheInfo = cacheList.latest;
            if (cacheNameParam) {
                const foundCache = cacheList.caches.find((cache) => cache.name === cacheNameParam);
                if (foundCache) {
                    cacheInfo = foundCache;
                }
            }

            const context = await loadCacheContext(
                cacheInfo,
                signal,
                setDownloadProgress,
            );
            throwIfAborted(signal);
            const runtimeOptions = parseWorkerRuntimeOptions(initialSearchParams);

            const mapImageCache = await caches.open("map-images");
            throwIfAborted(signal);

            const mapViewerResult = MapViewer.tryCreate(
                workerPool,
                simWorkerPool,
                cacheList,
                mapImageCache,
                context,
                runtimeOptions,
                initialSearchParams,
            );
            if (!mapViewerResult.ok) {
                setErrorMessage(mapViewerResult.error);
                return;
            }
            const mapViewer = mapViewerResult.value;
            mapViewer.init();
            throwIfAborted(signal);

            setDownloadProgress(undefined);
            setMapViewer(mapViewer);
        };

        if (isIos) {
            setErrorMessage("iOS is not supported.");
        } else {
            load().catch((e) => {
                if (signal.aborted || isAbortError(e)) {
                    return;
                }
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
