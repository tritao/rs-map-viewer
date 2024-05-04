import { DockviewApi, DockviewReact, DockviewReadyEvent, IDockviewPanelProps } from "dockview";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { RendererCanvas } from "../components/renderer/RendererCanvas";
import { CachePicker } from "./CachePicker";
import { CacheViewer } from "./CacheViewer";
import "./CacheViewerContainer.css";

export interface CacheViewerContainerProps {
    cacheViewer: CacheViewer;
}

export function CacheViewerContainer({ cacheViewer }: CacheViewerContainerProps): JSX.Element {
    const [searchParams, setSearchParams] = useSearchParams();

    const [fps, setFps] = useState<string>();
    const [debugText, setDebugText] = useState<string>();

    const requestRef = useRef<number | undefined>();

    const animate = (time: DOMHighResTimeStamp) => {
        // Wait for 200ms before updating search params
        if (
            cacheViewer.needsSearchParamUpdate &&
            performance.now() - cacheViewer.lastTimeSearchParamsUpdated > 200
        ) {
            setSearchParams(cacheViewer.getSearchParams(), { replace: true });
            cacheViewer.needsSearchParamUpdate = false;
            console.log("Updated search params");
        }

        setFps(Math.round(cacheViewer.renderer.stats.frameTimeFps).toString());
        setDebugText(cacheViewer.debugText);

        requestRef.current = requestAnimationFrame(animate);
    };

    useEffect(() => {
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current!);
    }, [searchParams]);

    let onReady = (event: DockviewReadyEvent) => {
        const api: DockviewApi = event.api;
        let cacheViewerPanel = api.addPanel({
            id: 'viewer',
            component: 'viewer',
        });
        api.addPanel({
            id: 'picker',
            component: 'picker',
            position: {
                direction: 'right',
                referencePanel: 'viewer',
            },
        });
    };

    const dockComponents = {
        viewer: (props: IDockviewPanelProps) => {
            return <RendererCanvas renderer={cacheViewer.renderer} />
        },
        picker: (props: IDockviewPanelProps) => {
            return <CachePicker cacheViewer={cacheViewer}></CachePicker>;
        },
    };

    return (
        <div className="cache-viewer-container">
            <div className="hud left-top">
                <div className="fps-counter content-text">{fps}</div>
                <div className="fps-counter content-text">{debugText}</div>
            </div>

            <DockviewReact className={'dockview-theme-abyss'} debug={true}
                onReady={onReady} components={dockComponents} />
        </div>
    );
}
