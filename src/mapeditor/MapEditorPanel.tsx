import { useCallback, useState } from "react";

import { FloorType } from "../rs/config/floortype/FloorType";
import { MapEditor } from "./MapEditor";
import "./MapEditorPanel.css";

import { ReactComponent as TileShape0 } from './tile-shapes/0.svg';
import { ReactComponent as TileShape1 } from './tile-shapes/1.svg';
import { ReactComponent as TileShape2 } from './tile-shapes/2.svg';
import { ReactComponent as TileShape3 } from './tile-shapes/3.svg';
import { ReactComponent as TileShape4 } from './tile-shapes/4.svg';
import { ReactComponent as TileShape5 } from './tile-shapes/5.svg';
import { ReactComponent as TileShape6 } from './tile-shapes/6.svg';
import { ReactComponent as TileShape7 } from './tile-shapes/7.svg';
import { ReactComponent as TileShape8 } from './tile-shapes/8.svg';
import { ReactComponent as TileShape9 } from './tile-shapes/9.svg';
import { ReactComponent as TileShape10 } from './tile-shapes/10.svg';
import { ReactComponent as TileShape11 } from './tile-shapes/11.svg';
import { ReactComponent as TileShape12 } from './tile-shapes/12.svg';

export interface MapEditorPanelProps {
    mapEditor: MapEditor;
}

export function MapEditorPanel({ mapEditor }: MapEditorPanelProps): JSX.Element {
    const [selectedShapeId, setSelectedShapeId] = useState<number>(
        mapEditor.selectedShapeId,
    );

    const shapes = [TileShape0, TileShape1, TileShape2, TileShape3, TileShape4, TileShape5, TileShape6,
        TileShape7, TileShape8, TileShape9, TileShape10, TileShape11, TileShape12]

    const shapesPreview = shapes.map((Shape, index) => {
        const setShape = () => {
            mapEditor.selectedShapeId = index;
            setSelectedShapeId(index);
        };
        const isSelected = index === selectedShapeId;
        return (
            <Shape
                key={index} className={`shape-preview ${isSelected ? "selected" : ""}`} onClick={setShape}
            >
                {index == 0 ? "None" : ""}
            </Shape>
        );
    });

    const [selectedUnderlayId, setSelectedUnderlayId] = useState<number>(
        mapEditor.selectedUnderlayId,
    );

    const underlayTypeLoader = mapEditor.cacheLoaders.loaderFactory.getUnderlayTypeLoader();

    const underlays: FloorType[] = [];
    for (let i = 0; i < underlayTypeLoader.getCount(); i++) {
        underlays.push(underlayTypeLoader.load(i));
    }

    const underlayPreviews = underlays.map((underlay) => {
        const rgb = underlay.getRgb();
        const r = rgb >> 16;
        const g = (rgb >> 8) & 0xff;
        const b = rgb & 0xff;

        const color = `rgb(${r}, ${g}, ${b})`;

        const setUnderlay = () => {
            mapEditor.selectedUnderlayId = underlay.id;
            setSelectedUnderlayId(underlay.id);
        };

        const isSelected = underlay.id === selectedUnderlayId;

        return (
            <div
                key={underlay.id}
                className={`underlay-preview ${isSelected ? "selected" : ""}`}
                style={{ backgroundColor: color }}
                onClick={setUnderlay}
            >
                {underlay.id}
            </div>
        );
    });

    const isNoUnderlaySelected = selectedUnderlayId === -1;

    const setNoUnderlay = useCallback(() => {
        mapEditor.selectedUnderlayId = -1;
        setSelectedUnderlayId(-1);
    }, [mapEditor]);

    return (
        <div className="map-editor-panel content-text">
            <div style={{ padding: "5px" }}>Shapes</div>

            <div className="shapes-container">
                {shapesPreview}
            </div>

            <div style={{ padding: "5px" }}>Underlays</div>

            <div className="underlays-container">
                <div
                    className={`underlay-preview ${isNoUnderlaySelected ? "selected" : ""}`}
                    style={{ backgroundColor: "black" }}
                    onClick={setNoUnderlay}
                >
                    None
                </div>
                {underlayPreviews}
            </div>
        </div>
    );
}
