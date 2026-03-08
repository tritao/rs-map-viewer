import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { OsrsLoadingBar } from "../components/rs/loading/OsrsLoadingBar";
import type { CacheInfo } from "../rs/cache/CacheInfo";
import { formatBytes } from "../util/BytesUtil";
import { fetchCacheList, type CacheList } from "../util/Caches";
import { errorToString } from "../util/ErrorUtil";
import { isIos } from "../util/DeviceUtil";
import { MapViewer } from "../mapviewer/MapViewer";
import type { DownloadProgress } from "../rs/cache/platform/CacheLoader";
import { EntityViewerContainer } from "./EntityViewerContainer";
import {
    createEntityViewerServices,
    resolveEntityViewerData,
    type EntityViewerKind,
    type EntityViewerResolvedData,
    type EntityViewerObjMode,
    type EntityViewerRequest,
} from "./EntityViewerData";
import { EntityViewerRenderer } from "./EntityViewerRenderer";
import type { EntityViewerDebugMode } from "../renderer/webgl/WebGLEntityRenderer";

const cachesPromise = fetchCacheList();

function parseEntityViewerKind(value: string | null): EntityViewerKind {
    switch (value) {
        case "npc":
        case "loc":
        case "model":
            return value;
        default:
            return "obj";
    }
}

function parseRequest(searchParams: URLSearchParams): EntityViewerRequest {
    const id = Number.parseInt(searchParams.get("id") ?? "4151", 10);
    const count = Number.parseInt(searchParams.get("count") ?? "1", 10);
    const rotation = Number.parseInt(searchParams.get("rotation") ?? "0", 10);
    return {
        kind: parseEntityViewerKind(searchParams.get("kind")),
        id: Number.isFinite(id) ? Math.max(0, id | 0) : 4151,
        count: Number.isFinite(count) ? Math.max(1, count | 0) : 1,
        rotation: Number.isFinite(rotation) ? rotation & 3 : 0,
        objMode: parseObjMode(searchParams.get("objMode")),
        icon36x32: searchParams.get("icon36x32") === "1",
        iconOutline: searchParams.get("iconOutline") !== "0",
        iconShadow: searchParams.get("iconShadow") !== "0",
    };
}

function parseObjMode(value: string | null): EntityViewerObjMode {
    return value === "world" ? "world" : "icon";
}

function parseDebugMode(searchParams: URLSearchParams): EntityViewerDebugMode {
    switch (searchParams.get("debug")) {
        case "flat":
            return "flat";
        case "bypass":
            return "bypass";
        case "color":
            return "color";
        default:
            return "normal";
    }
}

function updateSearchParams(
    current: URLSearchParams,
    patch: Record<string, string | undefined>,
): URLSearchParams {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value.length <= 0) {
            next.delete(key);
        } else {
            next.set(key, value);
        }
    }
    return next;
}

export default function EntityViewerApp(): JSX.Element {
    const [searchParams, setSearchParams] = useSearchParams();
    const [errorMessage, setErrorMessage] = useState<string>();
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();
    const [cacheList, setCacheList] = useState<CacheList>();
    const [cacheInfo, setCacheInfo] = useState<CacheInfo>();
    const [renderer, setRenderer] = useState<EntityViewerRenderer>();
    const [entityLabel, setEntityLabel] = useState<string>();
    const [resolvedEntity, setResolvedEntity] = useState<EntityViewerResolvedData>();
    const [cameraYaw, setCameraYaw] = useState<number>(1024);
    const [cameraPitch, setCameraPitch] = useState<number>(-180);
    const [cameraDistance, setCameraDistance] = useState<number>(8);
    const request = useMemo(() => parseRequest(searchParams), [searchParams]);
    const debugMode = useMemo(() => parseDebugMode(searchParams), [searchParams]);

    useEffect(() => {
        const abortController = new AbortController();
        const load = async () => {
            const cacheList = await cachesPromise;
            if (!cacheList) {
                throw new Error("No caches found");
            }
            setCacheList(cacheList);
            const cacheNameParam = searchParams.get("cache");
            const nextCacheInfo =
                cacheList.caches.find((cache) => cache.name === cacheNameParam) ?? cacheList.latest;
            const context = await MapViewer.loadCacheContext(
                nextCacheInfo,
                abortController.signal,
                setDownloadProgress,
            );
            const nextRenderer = new EntityViewerRenderer(context.session);
            setCacheInfo(nextCacheInfo);
            setRenderer(nextRenderer);
            setDownloadProgress(undefined);
            setErrorMessage(undefined);
        };

        if (isIos) {
            setErrorMessage("iOS is not supported.");
        } else {
            load().catch((error) => {
                console.error(error);
                setErrorMessage(errorToString(error));
            });
        }
        return () => {
            abortController.abort();
        };
    }, [searchParams.get("cache")]);

    useEffect(() => {
        if (!renderer) {
            return;
        }
        try {
            renderer.setDebugMode(debugMode);
            const services = createEntityViewerServices(renderer.session);
            const resolved = resolveEntityViewerData(services, request);
            renderer.setRenderData(resolved.renderData);
            setCameraYaw(renderer.getYaw());
            setCameraPitch(renderer.getPitch());
            setCameraDistance(renderer.getOrbitDistance());
            setEntityLabel(resolved.label);
            setResolvedEntity(resolved);
            setErrorMessage(undefined);
        } catch (error) {
            renderer.setRenderData(undefined);
            setEntityLabel(undefined);
            setResolvedEntity(undefined);
            setErrorMessage(errorToString(error));
        }
    }, [debugMode, renderer, request]);

    const content =
        errorMessage && !renderer ? (
            <div className="center-container max-height content-text">{errorMessage}</div>
        ) : downloadProgress ? (
            <div className="center-container max-height">
                <OsrsLoadingBar
                    text={`Downloading cache (${formatBytes(downloadProgress.total)})`}
                    progress={((downloadProgress.current / downloadProgress.total) * 100) | 0}
                />
            </div>
        ) : renderer && cacheInfo && cacheList ? (
            <EntityViewerContainer
                cacheList={cacheList}
                selectedCache={cacheInfo}
                renderer={renderer}
                request={request}
                label={entityLabel}
                errorMessage={renderer ? errorMessage : undefined}
                iconSprite={resolvedEntity?.iconSprite}
                cameraYaw={cameraYaw}
                cameraPitch={cameraPitch}
                cameraDistance={cameraDistance}
                onRequestChange={(nextRequest) =>
                    setSearchParams(
                        updateSearchParams(searchParams, {
                            kind: nextRequest.kind,
                            id: nextRequest.id.toString(),
                            count: nextRequest.count.toString(),
                            rotation: nextRequest.rotation.toString(),
                            objMode: nextRequest.kind === "obj" ? nextRequest.objMode : undefined,
                            icon36x32:
                                nextRequest.kind === "obj" && nextRequest.icon36x32
                                    ? "1"
                                    : undefined,
                            iconOutline:
                                nextRequest.kind === "obj" && !nextRequest.iconOutline
                                    ? "0"
                                    : undefined,
                            iconShadow:
                                nextRequest.kind === "obj" && !nextRequest.iconShadow
                                    ? "0"
                                    : undefined,
                        }),
                    )
                }
                onCacheChange={(cacheName) =>
                    setSearchParams(updateSearchParams(searchParams, { cache: cacheName }))
                }
                onCameraChange={(field, value) => {
                    switch (field) {
                        case "yaw":
                            renderer.setYaw(value);
                            setCameraYaw(value);
                            break;
                        case "pitch":
                            renderer.setPitch(value);
                            setCameraPitch(value);
                            break;
                        case "distance":
                            renderer.setOrbitDistance(value);
                            setCameraDistance(value);
                            break;
                    }
                }}
            />
        ) : undefined;

    return <div className="App max-height">{content}</div>;
}
