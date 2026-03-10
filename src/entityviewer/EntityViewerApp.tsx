import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { OsrsLoadingBar } from "../components/rs/loading/OsrsLoadingBar";
import type { CacheInfo } from "../rs/cache/CacheInfo";
import type { DownloadProgress } from "../rs/cache/platform/CacheLoader";
import { formatBytes } from "../util/BytesUtil";
import { type CacheList, fetchCacheList, loadCacheContext } from "../util/Caches";
import { isIos } from "../util/DeviceUtil";
import { errorToString, isAbortError, throwIfAborted } from "../util/ErrorUtil";
import { EntityViewerContainer } from "./EntityViewerContainer";
import {
    type EntityViewerKind,
    type EntityViewerRequest,
    type EntityViewerResolvedData,
    createEntityViewerServices,
    resolveEntityViewerData,
} from "./EntityViewerData";
import { EntityViewerRenderer } from "./EntityViewerRenderer";
import {
    DEFAULT_ENTITY_VIEWER_IDS_BY_KIND,
    getEntityViewerRenderTargetKey,
    parseEntityViewerRequest,
    updateEntityViewerCacheSearchParams,
    updateEntityViewerRequestSearchParams,
} from "./EntityViewerSearchParams";

const cachesPromise = fetchCacheList();

type EntityViewerBootstrapState = Readonly<{
    cacheList?: CacheList;
    cacheInfo?: CacheInfo;
    renderer?: EntityViewerRenderer;
    downloadProgress?: DownloadProgress;
    errorMessage?: string;
}>;

function useEntityViewerBootstrap(cacheName: string | null): EntityViewerBootstrapState {
    const [cacheList, setCacheList] = useState<CacheList>();
    const [cacheInfo, setCacheInfo] = useState<CacheInfo>();
    const [renderer, setRenderer] = useState<EntityViewerRenderer>();
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();
    const [errorMessage, setErrorMessage] = useState<string>();

    useEffect(() => {
        const abortController = new AbortController();
        const { signal } = abortController;

        const load = async () => {
            const nextCacheList = await cachesPromise;
            throwIfAborted(signal);
            if (!nextCacheList) {
                throw new Error("No caches found");
            }
            setCacheList(nextCacheList);
            const nextCacheInfo =
                nextCacheList.caches.find((cache) => cache.name === cacheName) ??
                nextCacheList.latest;
            const context = await loadCacheContext(nextCacheInfo, signal, setDownloadProgress);
            throwIfAborted(signal);
            const nextRenderer = new EntityViewerRenderer(context.session);
            throwIfAborted(signal);
            setCacheInfo(nextCacheInfo);
            setRenderer(nextRenderer);
            setDownloadProgress(undefined);
            setErrorMessage(undefined);
        };

        if (isIos) {
            setErrorMessage("iOS is not supported.");
        } else {
            load().catch((error) => {
                if (signal.aborted || isAbortError(error)) {
                    return;
                }
                console.error(error);
                setErrorMessage(errorToString(error));
            });
        }
        return () => {
            abortController.abort();
        };
    }, [cacheName]);

    return {
        cacheList,
        cacheInfo,
        renderer,
        downloadProgress,
        errorMessage,
    };
}

function useNpcAnimationFrame(
    input: Readonly<{
        renderer?: EntityViewerRenderer;
        request: EntityViewerRequest;
        playing: boolean;
    }>,
): number {
    const [npcFrame, setNpcFrame] = useState<number>(0);
    const npcAnimationKey = useMemo(
        () =>
            input.request.kind === "npc"
                ? `npc:${input.request.id}:${input.request.npcSeqId}`
                : input.request.kind,
        [input.request.id, input.request.kind, input.request.npcSeqId],
    );
    const npcFrameRef = useRef<number>(0);

    useEffect(() => {
        npcFrameRef.current = npcFrame;
    }, [npcFrame]);

    useEffect(() => {
        npcFrameRef.current = 0;
        setNpcFrame(0);
    }, [npcAnimationKey]);

    useEffect(() => {
        if (
            input.request.kind !== "npc" ||
            !input.playing ||
            input.request.npcSeqId < 0 ||
            !input.renderer
        ) {
            return;
        }
        const renderer = input.renderer;

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

            const seqResult = renderer.session.loaders.seqTypeLoader.tryLoad(input.request.npcSeqId);
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
    }, [input.playing, input.renderer, input.request.kind, input.request.npcSeqId]);

    return npcFrame;
}

export default function EntityViewerApp(): JSX.Element {
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedCacheName = searchParams.get("cache");
    const { cacheList, cacheInfo, renderer, downloadProgress, errorMessage: bootstrapError } =
        useEntityViewerBootstrap(selectedCacheName);
    const [resolveErrorMessage, setResolveErrorMessage] = useState<string>();
    const [entityLabel, setEntityLabel] = useState<string>();
    const [resolvedEntity, setResolvedEntity] = useState<EntityViewerResolvedData>();
    const [cameraYaw, setCameraYaw] = useState<number>(1024);
    const [cameraPitch, setCameraPitch] = useState<number>(-180);
    const [cameraDistance, setCameraDistance] = useState<number>(8);
    const [npcPlaying, setNpcPlaying] = useState<boolean>(true);
    const [lastIdsByKind, setLastIdsByKind] =
        useState<Record<EntityViewerKind, number>>(DEFAULT_ENTITY_VIEWER_IDS_BY_KIND);
    const request = useMemo(() => parseEntityViewerRequest(searchParams), [searchParams]);
    const npcFrame = useNpcAnimationFrame({
        renderer,
        request,
        playing: npcPlaying,
    });
    const resolvedRequest = useMemo(
        () => (request.kind === "npc" ? { ...request, npcFrame } : request),
        [npcFrame, request],
    );
    const renderTargetKey = useMemo(
        () => getEntityViewerRenderTargetKey(resolvedRequest),
        [resolvedRequest],
    );
    const errorMessage = bootstrapError ?? resolveErrorMessage;

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
            setResolveErrorMessage(undefined);
        } catch (error) {
            renderer.setRenderData(undefined);
            setEntityLabel(undefined);
            setResolvedEntity(undefined);
            setResolveErrorMessage(errorToString(error));
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
                    setSearchParams(
                        updateEntityViewerRequestSearchParams({
                            currentSearchParams: searchParams,
                            currentRequest: request,
                            nextRequest,
                            lastIdsByKind,
                        }),
                    );
                }}
                onCacheChange={(cacheName) =>
                    setSearchParams(updateEntityViewerCacheSearchParams(searchParams, cacheName))
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
