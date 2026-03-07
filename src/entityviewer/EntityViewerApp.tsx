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
    type EntityViewerObjMode,
    type EntityViewerRequest,
} from "./EntityViewerData";
import { EntityViewerRenderer } from "./EntityViewerRenderer";
import type { EntityViewerDebugMode } from "../renderer/webgl/WebGLEntityRenderer";

const cachesPromise = fetchCacheList();

function decodeFirstVertexDebug(vertices: Uint8Array): Record<string, number> | undefined {
    if (vertices.byteLength < 16) {
        return undefined;
    }
    const u32 = new Uint32Array(vertices.buffer, vertices.byteOffset, 4);
    const v0 = u32[0] >>> 0;
    const v1 = u32[1] >>> 0;
    const v2 = u32[2] >>> 0;
    const v3 = u32[3] >>> 0;
    return {
        rawHsl: (v1 >>> 15) & 0xffff,
        isTextured: (v1 >>> 31) & 0x1,
        tex0: (((((v1 >>> 15) & 0xffff) >>> 7) & 0x1ff) | (((v3 >>> 19) & 0x7f) << 9)) >>> 0,
        tex1: ((v3 & 0x3ff) | (((v3 >>> 26) & 0x3f) << 10)) >>> 0,
        alpha: (v2 >>> 9) & 0xff,
    };
}

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
            const debugData = {
                request,
                debugMode,
                label: resolved.label,
                vertices: resolved.renderData.vertices.length,
                indices: resolved.renderData.indices.length,
                drawRangesBase: resolved.renderData.drawRanges.base.length / 3,
                drawRangesAlpha: resolved.renderData.drawRanges.alpha.length / 3,
                baseRange: Array.from(resolved.renderData.drawRanges.base.slice(0, 3)),
                alphaRange: Array.from(resolved.renderData.drawRanges.alpha.slice(0, 3)),
                fitRadius: resolved.renderData.fitRadius,
                firstVertex: decodeFirstVertexDebug(resolved.renderData.vertices),
                sourceDebug: resolved.debug,
            };
            console.log("[entity-viewer] resolved render data", debugData);
            renderer.setRenderData(resolved.renderData);
            setEntityLabel(resolved.label);
            setErrorMessage(undefined);
        } catch (error) {
            renderer.setRenderData(undefined);
            setEntityLabel(undefined);
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
                onRequestChange={(nextRequest) =>
                    setSearchParams(
                        updateSearchParams(searchParams, {
                            kind: nextRequest.kind,
                            id: nextRequest.id.toString(),
                            count: nextRequest.count.toString(),
                            rotation: nextRequest.rotation.toString(),
                            objMode: nextRequest.kind === "obj" ? nextRequest.objMode : undefined,
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
                            break;
                        case "pitch":
                            renderer.setPitch(value);
                            break;
                        case "distance":
                            renderer.setOrbitDistance(value);
                            break;
                    }
                }}
            />
        ) : undefined;

    return <div className="App max-height">{content}</div>;
}
