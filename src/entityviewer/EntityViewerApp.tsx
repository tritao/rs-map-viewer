import { useEffect, useMemo, useRef, useState } from "react";
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

const cachesPromise = fetchCacheList();
const DEFAULT_IDS_BY_KIND: Record<EntityViewerKind, number> = {
    obj: 4151,
    npc: 1,
    loc: 10,
    model: 0,
};

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
    const kind = parseEntityViewerKind(searchParams.get("kind"));
    const id = Number.parseInt(searchParams.get("id") ?? "4151", 10);
    const count = Number.parseInt(searchParams.get("count") ?? "1", 10);
    const rotation = Number.parseInt(searchParams.get("rotation") ?? "0", 10);
    const npcSeqId = Number.parseInt(searchParams.get("npcSeqId") ?? "-1", 10);
    return {
        kind,
        id: Number.isFinite(id) ? Math.max(0, id | 0) : DEFAULT_IDS_BY_KIND[kind],
        count: Number.isFinite(count) ? Math.max(1, count | 0) : 1,
        rotation: Number.isFinite(rotation) ? rotation & 3 : 0,
        objMode: parseObjMode(searchParams.get("objMode")),
        icon36x32: searchParams.get("icon36x32") === "1",
        iconOutline: searchParams.get("iconOutline") !== "0",
        iconShadow: searchParams.get("iconShadow") !== "0",
        npcSeqId: Number.isFinite(npcSeqId) ? npcSeqId | 0 : -1,
        npcFrame: 0,
    };
}

function parseObjMode(value: string | null): EntityViewerObjMode {
    return value === "world" ? "world" : "icon";
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

function getRenderTargetKey(request: EntityViewerRequest): string {
    switch (request.kind) {
        case "obj":
            return `obj:${request.id}:${request.count}:${request.objMode}`;
        case "npc":
            return `npc:${request.id}`;
        case "loc":
            return `loc:${request.id}`;
        case "model":
            return `model:${request.id}`;
    }
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
    const [npcPlaying, setNpcPlaying] = useState<boolean>(true);
    const [npcFrame, setNpcFrame] = useState<number>(0);
    const [lastIdsByKind, setLastIdsByKind] = useState<Record<EntityViewerKind, number>>(
        DEFAULT_IDS_BY_KIND,
    );
    const request = useMemo(() => parseRequest(searchParams), [searchParams]);
    const resolvedRequest = useMemo(
        () => (request.kind === "npc" ? { ...request, npcFrame } : request),
        [npcFrame, request],
    );
    const renderTargetKey = useMemo(() => getRenderTargetKey(resolvedRequest), [resolvedRequest]);
    const npcAnimationKey = useMemo(
        () =>
            request.kind === "npc"
                ? `npc:${request.id}:${request.npcSeqId}`
                : request.kind,
        [request.id, request.kind, request.npcSeqId],
    );
    const previousNpcAnimationKeyRef = useRef<string>();
    const npcFrameRef = useRef<number>(0);

    useEffect(() => {
        setLastIdsByKind((current) => {
            const currentId = current[request.kind];
            if (currentId === request.id) {
                return current;
            }
            return {
                ...current,
                [request.kind]: request.id,
            };
        });
    }, [request.id, request.kind]);

    useEffect(() => {
        if (previousNpcAnimationKeyRef.current !== npcAnimationKey) {
            previousNpcAnimationKeyRef.current = npcAnimationKey;
            setNpcFrame(0);
        }
    }, [npcAnimationKey]);

    useEffect(() => {
        npcFrameRef.current = npcFrame;
    }, [npcFrame]);

    useEffect(() => {
        if (request.kind !== "npc" || !npcPlaying || request.npcSeqId < 0 || !renderer) {
            return;
        }

        let cancelled = false;
        let frameHandle = 0;
        let accumulatedMs = 0;
        let lastTimestamp = performance.now();

        const step = (timestamp: number) => {
            if (cancelled) {
                return;
            }
            const deltaMs = Math.max(0, timestamp - lastTimestamp);
            lastTimestamp = timestamp;
            accumulatedMs += deltaMs;

            const seqResult = renderer.session.loaders.seqTypeLoader.tryLoad(request.npcSeqId);
            if (seqResult.ok && seqResult.value.frameIds.length > 0) {
                const seqType = seqResult.value;
                let currentFrame = Math.max(
                    0,
                    Math.min(npcFrameRef.current | 0, seqType.frameIds.length - 1),
                );
                let frameDurationMs =
                    Math.max(
                        1,
                        seqType.getFrameLength(
                            renderer.session.loaders.seqFrameLoader,
                            currentFrame,
                        ),
                    ) * 20;

                while (accumulatedMs >= frameDurationMs) {
                    accumulatedMs -= frameDurationMs;
                    currentFrame = (currentFrame + 1) % seqType.frameIds.length;
                    frameDurationMs =
                        Math.max(
                            1,
                            seqType.getFrameLength(
                                renderer.session.loaders.seqFrameLoader,
                                currentFrame,
                            ),
                        ) * 20;
                }

                if (currentFrame !== (npcFrameRef.current | 0)) {
                    npcFrameRef.current = currentFrame;
                    setNpcFrame(currentFrame);
                }
            }

            frameHandle = requestAnimationFrame(step);
        };

        frameHandle = requestAnimationFrame(step);
        return () => {
            cancelled = true;
            cancelAnimationFrame(frameHandle);
        };
    }, [
        npcPlaying,
        renderer,
        request.kind,
        request.npcSeqId,
    ]);

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
            const services = createEntityViewerServices(renderer.session);
            const resolved = resolveEntityViewerData(services, resolvedRequest);
            const shouldResetCamera = renderer.renderTargetKey !== renderTargetKey;
            renderer.setRenderData(resolved.renderData, {
                resetCamera: shouldResetCamera,
            });
            renderer.renderTargetKey = renderTargetKey;
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
    }, [renderTargetKey, renderer, resolvedRequest]);

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
                npcAnimationOptions={resolvedEntity?.npcAnimationOptions}
                npcPlaying={npcPlaying}
                cameraYaw={cameraYaw}
                cameraPitch={cameraPitch}
                cameraDistance={cameraDistance}
                onRequestChange={(nextRequest) => {
                    const effectiveId =
                        nextRequest.kind === request.kind
                            ? nextRequest.id
                            : (lastIdsByKind[nextRequest.kind] ?? DEFAULT_IDS_BY_KIND[nextRequest.kind]);
                    const resetNpcAnimation =
                        nextRequest.kind === "npc" &&
                        (request.kind !== "npc" || effectiveId !== request.id);
                    setSearchParams(
                        updateSearchParams(searchParams, {
                            kind: nextRequest.kind,
                            id: effectiveId.toString(),
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
                            npcSeqId:
                                nextRequest.kind === "npc" &&
                                !resetNpcAnimation &&
                                nextRequest.npcSeqId >= 0
                                    ? nextRequest.npcSeqId.toString()
                                    : undefined,
                        }),
                    );
                }}
                onCacheChange={(cacheName) =>
                    setSearchParams(updateSearchParams(searchParams, { cache: cacheName }))
                }
                onNpcPlayingChange={setNpcPlaying}
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
