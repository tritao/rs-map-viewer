import { DockviewApi, DockviewGroupPanelApi, DockviewPanelApi, DockviewReact, DockviewReadyEvent, IDockviewPanelProps } from "dockview";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { RendererCanvas } from "../components/renderer/RendererCanvas";
import { MapEditor } from "./MapEditor";
import { MapEditorRenderer } from "./MapEditorRenderer";
import { MapEditorPanel } from "./MapEditorPanel";
import "./MapEditorContainer.css";

export interface MapEditorContainerProps {
    mapEditor: MapEditor;
}

export function MapEditorContainer({ mapEditor }: MapEditorContainerProps): JSX.Element {
    const [searchParams, setSearchParams] = useSearchParams();

    const [renderer, setRenderer] = useState<MapEditorRenderer>(mapEditor.renderer);

    const [fps, setFps] = useState<string>();
    const [debugText, setDebugText] = useState<string>();

    const requestRef = useRef<number | undefined>();

    const animate = (time: DOMHighResTimeStamp) => {
        // Wait for 200ms before updating search params
        if (
            mapEditor.needsSearchParamUpdate &&
            performance.now() - mapEditor.lastTimeSearchParamsUpdated > 200
        ) {
            setSearchParams(mapEditor.getSearchParams(), { replace: true });
            mapEditor.needsSearchParamUpdate = false;
            console.log("Updated search params");
        }

        setFps(Math.round(renderer.renderer.stats.frameTimeFps).toString());
        setDebugText(mapEditor.debugText);

        requestRef.current = requestAnimationFrame(animate);
    };

    useEffect(() => {
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current!);
    }, [searchParams]);

    let onReady = (event: DockviewReadyEvent) => {
        const api: DockviewApi = event.api;
        let terrainEditorPanel = api.addPanel({
            id: 'terrain_editor',
            component: 'terrain_editor',
        });
        let mapViewerPanel = api.addPanel({
            id: 'map_viewer',
            component: 'map_viewer',
        });
        api.addPanel({
            id: 'map_editor_panel',
            component: 'map_editor_panel',
            position: {
                direction: 'below',
                referencePanel: 'terrain_editor',
            },
        });
    };

    const dockComponents = {
        terrain_editor: (props: IDockviewPanelProps) => {
            return <RendererCanvas renderer={mapEditor.renderer} />
        },
        map_viewer: (props: IDockviewPanelProps) => {
            return <div>{"map viewer"}</div>
        },
        map_editor_panel: (props: IDockviewPanelProps) => {
            return <MapEditorPanel mapEditor={mapEditor} />
        },
    };

    return (
        <div className="map-editor-container">
            <div className="hud left-top">
                <div className="fps-counter content-text">{fps}</div>
                <div className="fps-counter content-text">{debugText}</div>
            </div>

            <DockviewReact className={'dockview-theme-abyss'} debug={true} onReady={onReady} components={dockComponents} />
        </div>
    );
}
