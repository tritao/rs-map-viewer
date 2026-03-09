import FileSaver from "file-saver";
import { vec3 } from "gl-matrix";
import { Leva, button, buttonGroup, folder, useControls } from "leva";
import { ButtonGroupOpts, Schema } from "leva/dist/declarations/src/types";
import { memo, useEffect, useRef, useState } from "react";

import { MapRenderer, TextureFilterMode } from "../renderer/MapRenderer";
import type { BackendKind } from "../util/BackendKind";
import { isTouchDevice } from "../util/DeviceUtil";
import { lerp, slerp } from "../util/MathUtil";
import { CameraView, ProjectionType } from "../renderer/Camera";
import { MapViewer } from "./MapViewer";
import { MapViewerRenderer } from "./MapViewerRenderer";

interface MapViewerControlsProps {
    renderer: MapViewerRenderer;
    hideUi: boolean;
    setHideUi: (hideUi: boolean | ((hideUi: boolean) => boolean)) => void;
}

type ColorRgb = { r: number; g: number; b: number };
type RendererDebugControls = {
    debugTextureMode?: number;
    logTextureDebugStats?: () => void;
};

function createRendererControls(renderer: MapRenderer<any, any>): Schema {
    const base: Schema = {
        "Max Level": {
            value: renderer.maxLevel,
            min: 0,
            max: 3,
            step: 1,
            onChange: (v: number) => {
                renderer.setMaxLevel(v);
            },
        },
        Sky: {
            r: renderer.skyColor[0] * 255,
            g: renderer.skyColor[1] * 255,
            b: renderer.skyColor[2] * 255,
            onChange: (v: ColorRgb) => {
                renderer.setSkyColor(v.r, v.g, v.b);
            },
        },
        "Fog Depth": {
            value: renderer.fogDepth,
            min: 0,
            max: 256,
            step: 8,
            onChange: (v: number) => {
                renderer.fogDepth = v;
            },
        },
        Brightness: {
            value: 1,
            min: 0,
            max: 4,
            step: 1,
            onChange: (v: number) => {
                renderer.brightness = 1.0 - v * 0.1;
            },
        },
        "Color Banding": {
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange: (v: number) => {
                renderer.colorBanding = 255 - v * 2;
            },
        },
        "Texture Filtering": {
            value: renderer.textureFilterMode,
            options: {
                Disabled: TextureFilterMode.DISABLED,
                Bilinear: TextureFilterMode.BILINEAR,
                Trilinear: TextureFilterMode.TRILINEAR,
                "Anisotropic 2x": TextureFilterMode.ANISOTROPIC_2X,
                "Anisotropic 4x": TextureFilterMode.ANISOTROPIC_4X,
                "Anisotropic 8x": TextureFilterMode.ANISOTROPIC_8X,
                "Anisotropic 16x": TextureFilterMode.ANISOTROPIC_16X,
            },
            onChange: (v: TextureFilterMode) => {
                if (v === renderer.textureFilterMode) {
                    return;
                }
                renderer.textureFilterMode = v;
                renderer.updateTextureFiltering();
            },
        },
        "Smooth Terrain": {
            value: renderer.smoothTerrain,
            onChange: (v: boolean) => {
                renderer.setSmoothTerrain(v);
            },
        },
        "Cull Back-faces": {
            value: renderer.cullBackFace,
            onChange: (v: boolean) => {
                renderer.cullBackFace = v;
            },
        },
        "Anti-Aliasing": folder(
            {
                MSAA: {
                    value: renderer.msaaEnabled,
                    onChange: (v: boolean) => {
                        renderer.setMsaa(v);
                    },
                },
                FXAA: {
                    value: renderer.fxaaEnabled,
                    onChange: (v: boolean) => {
                        renderer.setFxaa(v);
                    },
                },
            },
            { collapsed: true },
        ),
        Entity: folder(
            {
                Items: {
                    value: renderer.loadObjs,
                    onChange: (v: boolean) => {
                        renderer.setLoadObjs(v);
                    },
                },
                Npcs: {
                    value: renderer.loadNpcs,
                    onChange: (v: boolean) => {
                        renderer.setLoadNpcs(v);
                    },
                },
                Locs: {
                    value: renderer.loadLocs,
                    onChange: (v: boolean) => {
                        renderer.setLoadLocs(v);
                    },
                },
            },
            { collapsed: true },
        ),
    };

    // Optional debug controls for WebGL renderer without importing WebGL classes here.
    const debugControls = renderer as unknown as RendererDebugControls;
    if (
        typeof debugControls.logTextureDebugStats === "function" ||
        typeof debugControls.debugTextureMode === "number"
    ) {
        base.Debug = folder(
            {
                "Texture Debug": {
                    value:
                        typeof debugControls.debugTextureMode === "number"
                            ? debugControls.debugTextureMode
                            : 0,
                    options: {
                        Off: 0,
                        "Missing Magenta": 1,
                        "Raw Texture": 2,
                    },
                    onChange: (v: number) => {
                        debugControls.debugTextureMode = v;
                    },
                },
                ...(typeof debugControls.logTextureDebugStats === "function"
                    ? { "Log Texture Stats": button(() => debugControls.logTextureDebugStats?.()) }
                    : {}),
            },
            { collapsed: true },
        );
    }

    return base;
}

enum VarType {
    VARP = 0,
    VARBIT = 1,
}

export const MapViewerControls = memo(
    ({
        renderer: rendererMainLoop,
        hideUi: hidden,
        setHideUi,
    }: MapViewerControlsProps): JSX.Element => {
        const mapViewer = rendererMainLoop.mapViewer;

        const [projectionType, setProjectionType] = useState<ProjectionType>(
            mapViewer.camera.projectionType,
        );

        const [isExportingSprites, setExportingSprites] = useState(false);
        const [isExportingTextures, setExportingTextures] = useState(false);

        const positionControls = isTouchDevice
            ? "Left joystick, Drag up and down."
            : "WASD,\nR or E (up),\nF or C (down),\nUse SHIFT to go faster, or TAB to go slower.";
        const directionControls = isTouchDevice
            ? "Right joystick."
            : "Arrow Keys or Click and Drag. Double click for pointerlock.";

        const [varType, setVarType] = useState<VarType>(VarType.VARBIT);
        const [varId, setVarId] = useState(0);
        const [varValue, setVarValue] = useState(0);
        const [spawnItemId, setSpawnItemId] = useState(995);
        const [spawnItemCount, setSpawnItemCount] = useState(1);
        const initialRuntimeOptions = mapViewer.getWorkerRuntimeOptions();
        const [mapRenderBackend, setMapRenderBackend] = useState<BackendKind>(
            initialRuntimeOptions.mapRenderBackend,
        );
        const [mapRenderTelemetry, setMapRenderTelemetry] = useState<boolean>(
            initialRuntimeOptions.mapRenderTelemetry,
        );
        // Leva may keep button callbacks stable; avoid stale React state closures by reading the latest
        // pending values from a ref.
        const runtimeOptionsRef = useRef<{
            mapRenderBackend: BackendKind;
            mapRenderTelemetry: boolean;
        }>({
            mapRenderBackend: initialRuntimeOptions.mapRenderBackend,
            mapRenderTelemetry: initialRuntimeOptions.mapRenderTelemetry,
        });

        const controlsSchema: Schema = {
            Position: { value: positionControls, editable: false },
            Direction: { value: directionControls, editable: false },
        };

        const [devOnly5050, setDevOnly5050] = useState<boolean>(() => {
            const sq = mapViewer.getDevFixedMapSquare();
            return !!sq && sq.mapX === 50 && sq.mapY === 50;
        });

        const [animationDuration, setAnimationDuration] = useState(10);
        const [cameraPoints, setCameraPoints] = useState<CameraView[]>(() => []);

        const addPoint = () => {
            setCameraPoints((pts) => [
                ...pts,
                {
                    position: vec3.fromValues(
                        mapViewer.camera.pos[0],
                        mapViewer.camera.pos[1],
                        mapViewer.camera.pos[2],
                    ),
                    pitch: mapViewer.camera.pitch,
                    yaw: mapViewer.camera.yaw,
                    fov: mapViewer.camera.fov,
                    orthoZoom: mapViewer.camera.orthoZoom,
                },
            ]);
        };

        const removeLastPoint = () => {
            setCameraPoints((pts) => pts.slice(0, pts.length - 1));
        };

        useEffect(() => {
            function handleKeyDown(e: KeyboardEvent) {
                if (e.repeat) {
                    return;
                }

                switch (e.key) {
                    case "F1":
                        setHideUi((v) => !v);
                        break;
                    case "F2":
                        setCameraRunning((v) => !v);
                        break;
                    case "F3":
                        addPoint();
                        break;
                    case "F4":
                        removeLastPoint();
                        break;
                }
            }

            document.addEventListener("keydown", handleKeyDown);

            return () => {
                document.removeEventListener("keydown", handleKeyDown);
            };
        }, [mapViewer]);

        useEffect(() => {
            setPointControls(
                folder(
                    cameraPoints.reduce((acc: Record<string, any>, v, i) => {
                        const point = v;
                        const buttons: ButtonGroupOpts = {
                            Teleport: () => mapViewer.setCamera(point),
                            Delete: () => setCameraPoints((pts) => pts.filter((_, j) => j !== i)),
                        };
                        acc["Point " + i] = buttonGroup(buttons);
                        return acc;
                    }, {}),
                ),
            );
        }, [mapViewer, cameraPoints]);

        const [pointsControls, setPointControls] = useState(folder({}));
        const [isCameraRunning, setCameraRunning] = useState(false);

        useEffect(() => {
            if (!isCameraRunning) {
                return;
            }

            const segmentCount = cameraPoints.length - 1;
            // Need at least 2 points to start
            if (segmentCount <= 0) {
                setCameraRunning(false);
                return;
            }

            let animationId = -1;

            let start: number;
            const animate = (time: DOMHighResTimeStamp) => {
                if (!start) {
                    start = time;
                }

                const elapsed = time - start;
                const overallProgress = elapsed / (animationDuration * 1000);

                const startIndex = Math.floor(overallProgress * segmentCount);
                const endIndex = startIndex + 1;
                const from = cameraPoints[startIndex];
                const to = cameraPoints[endIndex];
                const localProgress = (overallProgress * segmentCount) % 1;

                const isComplete = elapsed > animationDuration * 1000;
                if (isComplete) {
                    setCameraRunning(false);
                    mapViewer.setCamera(cameraPoints[cameraPoints.length - 1]);
                    return;
                }
                const newView: CameraView = {
                    position: vec3.fromValues(
                        lerp(from.position[0], to.position[0], localProgress),
                        lerp(from.position[1], to.position[1], localProgress),
                        lerp(from.position[2], to.position[2], localProgress),
                    ),
                    pitch: lerp(from.pitch, to.pitch, localProgress),
                    yaw: slerp(from.yaw, to.yaw, localProgress, 2048),
                    fov: lerp(from.fov, to.fov, localProgress),
                    orthoZoom: lerp(from.orthoZoom, to.orthoZoom, localProgress),
                };
                mapViewer.setCamera(newView);

                animationId = requestAnimationFrame(animate);
            };

            // Start animating
            animationId = requestAnimationFrame(animate);

            return () => {
                cancelAnimationFrame(animationId);
            };
        }, [mapViewer, cameraPoints, animationDuration, isCameraRunning]);

        const recordSchema: Schema = {
            "Add point (F3)": button(() => addPoint()),
            "Delete last point (F4)": button(() => removeLastPoint()),
            Length: {
                value: animationDuration,
                onChange: (v: number) => {
                    setAnimationDuration(v);
                },
            },
            Points: pointsControls,
        };

        if (isCameraRunning) {
            const buttonName = "Stop (F2)";
            recordSchema[buttonName] = button(() => setCameraRunning(false));
            recordSchema[buttonName].order = -1;
        } else {
            const buttonName = "Start (F2)";
            recordSchema[buttonName] = button(() => setCameraRunning(true));
            recordSchema[buttonName].order = -1;
        }

        useControls(
            {
                Links: folder(
                    {
                        GitHub: button(() => {
                            window.open("https://github.com/dennisdev/rs-map-viewer", "_blank");
                        }),
                    },
                    { collapsed: true },
                ),
                Camera: folder(
                    {
                        Projection: {
                            value: projectionType,
                            options: {
                                Perspective: ProjectionType.PERSPECTIVE,
                                Ortho: ProjectionType.ORTHO,
                            },
                            onChange: (v: ProjectionType) => {
                                mapViewer.camera.setProjectionType(v);
                                setProjectionType(v);
                            },
                            order: 0,
                        },
                        ...createCameraControls(mapViewer),
                        Speed: {
                            value: mapViewer.cameraSpeed,
                            min: 0.1,
                            max: 5,
                            step: 0.1,
                            onChange: (v: number) => {
                                mapViewer.cameraSpeed = v;
                            },
                            order: 10,
                        },
                        Controls: folder(controlsSchema, { collapsed: true, order: 999 }),
                    },
                    { collapsed: false },
                ),
                Distance: folder(
                    {
                        Render: {
                            value: mapViewer.renderDistance,
                            min: 16,
                            max: 2000,
                            step: 16,
                            onChange: (v: number) => {
                                mapViewer.renderDistance = v;
                            },
                        },
                        Unload: {
                            value: mapViewer.unloadDistance,
                            min: 1,
                            max: 30,
                            step: 1,
                            onChange: (v: number) => {
                                mapViewer.unloadDistance = v;
                            },
                        },
                        Lod: {
                            value: mapViewer.lodDistance,
                            min: 0,
                            max: 30,
                            step: 1,
                            onChange: (v: number) => {
                                mapViewer.lodDistance = v;
                            },
                        },
                    },
                    { collapsed: false },
                ),
                Cache: folder(
                    {
                        Version: {
                            value: mapViewer.loadedCache.info.name,
                            options: mapViewer.cacheList.caches.map((cache) => cache.name),
                            onChange: async (v: string) => {
                                const cacheInfo = mapViewer.cacheList.caches.find(
                                    (cache) => cache.name === v,
                                );
                                if (v !== mapViewer.loadedCache.info.name && cacheInfo) {
                                    await mapViewer.switchCache(cacheInfo);
                                }
                            },
                        },
                    },
                    { collapsed: true },
                ),
                Runtime: folder(
                    {
                        "Dev: Only 50:50": {
                            value: devOnly5050,
                            onChange: (v: boolean) => {
                                setDevOnly5050(v);
                                mapViewer.setDevFixedMapSquare(
                                    v ? { mapX: 50, mapY: 50 } : undefined,
                                );
                            },
                        },
                        "Map Backend": {
                            value: mapRenderBackend,
                            options: {
                                TS: "ts",
                                "C++ WASM": "cpp-wasm",
                            },
                            onChange: (v: BackendKind) => {
                                runtimeOptionsRef.current.mapRenderBackend = v;
                                setMapRenderBackend(v);
                            },
                        },
                        "Map Telemetry": {
                            value: mapRenderTelemetry,
                            onChange: (v: boolean) => {
                                runtimeOptionsRef.current.mapRenderTelemetry = v;
                                setMapRenderTelemetry(v);
                            },
                        },
                        Apply: button(async () => {
                            const opts = runtimeOptionsRef.current;
                            await mapViewer.setWorkerRuntimeOptions({
                                mapRenderBackend: opts.mapRenderBackend,
                                mapRenderTelemetry: opts.mapRenderTelemetry,
                            });
                        }),
                        "Reset Visible Loc Animations": button(async () => {
                            await mapViewer.resetVisibleLocAnimations();
                        }),
                        "Restore Visible Ground Items": button(async () => {
                            await mapViewer.restoreVisibleGroundItems();
                        }),
                        "Spawn Item Id": {
                            value: spawnItemId,
                            step: 1,
                            onChange: setSpawnItemId,
                        },
                        "Spawn Item Count": {
                            value: spawnItemCount,
                            min: 1,
                            step: 1,
                            onChange: setSpawnItemCount,
                        },
                        "Spawn Ground Item At Camera": button(async () => {
                            await mapViewer.spawnGroundItemAtCamera(
                                spawnItemId | 0,
                                spawnItemCount | 0,
                            );
                        }),
                        "Clear Visible Dynamic Ground Items": button(async () => {
                            await mapViewer.clearVisibleDynamicGroundItems();
                        }),
                    },
                    { collapsed: true },
                ),
                Render: folder(
                    {
                        "Fps Limit": {
                            value: rendererMainLoop.fpsLimit,
                            min: 1,
                            max: 999,
                            onChange: (v: number) => {
                                rendererMainLoop.fpsLimit = v;
                            },
                        },
                        ...createRendererControls(rendererMainLoop.renderer),
                    },
                    { collapsed: true },
                ),
                Vars: folder(
                    {
                        Type: {
                            value: varType,
                            options: {
                                Varplayer: VarType.VARP,
                                Varbit: VarType.VARBIT,
                            },
                            onChange: setVarType,
                        },
                        Id: {
                            value: varId,
                            step: 1,
                            onChange: setVarId,
                        },
                        Value: {
                            value: varValue,
                            step: 1,
                            onChange: setVarValue,
                        },
                        Set: button(() => {
                            const varManager = mapViewer.session.varManager;
                            let updated = false;
                            if (varType === VarType.VARP) {
                                updated = varManager.setVarp(varId, varValue);
                            } else {
                                updated = varManager.setVarbit(varId, varValue);
                            }
                            if (updated) {
                                mapViewer.updateVars();
                                mapViewer.renderer.mapManager.clearMaps();
                            }
                        }),
                        Clear: button(() => {
                            mapViewer.session.varManager.clear();
                            mapViewer.updateVars();
                            mapViewer.renderer.mapManager.clearMaps();
                        }),
                    },
                    { collapsed: true },
                ),
                Menu: folder(
                    {
                        Tooltips: {
                            value: mapViewer.tooltips,
                            onChange: (v: boolean) => {
                                mapViewer.tooltips = v;
                            },
                        },
                        "Debug Id": {
                            value: mapViewer.debugId,
                            onChange: (v: boolean) => {
                                mapViewer.debugId = v;
                            },
                        },
                    },
                    { collapsed: true },
                ),
                Record: folder(recordSchema, { collapsed: true }),
                Export: folder(
                    {
                        "Export Sprites": button(
                            () => {
                                if (isExportingSprites) {
                                    return;
                                }
                                setExportingSprites(true);
                                mapViewer.workerPool
                                    .build.exportSprites()
                                    .then((zipBlob) => {
                                        FileSaver.saveAs(
                                            zipBlob,
                                            `sprites_${mapViewer.loadedCache.info.name}.zip`,
                                        );
                                    })
                                    .finally(() => {
                                        setExportingSprites(false);
                                    });
                            },
                            { disabled: isExportingSprites },
                        ),
                        "Export Textures": button(
                            () => {
                                if (isExportingTextures) {
                                    return;
                                }
                                setExportingTextures(true);
                                mapViewer.workerPool
                                    .build.exportTextures()
                                    .then((zipBlob) => {
                                        FileSaver.saveAs(
                                            zipBlob,
                                            `textures_${mapViewer.loadedCache.info.name}.zip`,
                                        );
                                    })
                                    .finally(() => {
                                        setExportingTextures(false);
                                    });
                            },
                            { disabled: isExportingTextures },
                        ),
                    },
                    { collapsed: true },
                ),
            },
            [
                rendererMainLoop,
                // Cache switches replace the underlying WebGL renderer instance; include cache/renderer identity
                // so Leva rebinds controls (buttons, dropdown values, debug toggles) to the new renderer.
                mapViewer.loadedCache.info.name,
                rendererMainLoop.renderer.expectedCacheName,
                projectionType,
                varType,
                varId,
                varValue,
                mapRenderBackend,
                mapRenderTelemetry,
                devOnly5050,
                pointsControls,
                isCameraRunning,
                isExportingSprites,
                isExportingTextures,
            ],
        );

        return (
            <Leva
                titleBar={{ filter: false }}
                collapsed={true}
                hideCopyButton={true}
                hidden={hidden}
            />
        );
    },
);

function createCameraControls(mapViewer: MapViewer): Schema {
    if (mapViewer.camera.projectionType === ProjectionType.PERSPECTIVE) {
        return {
            FOV: {
                value: mapViewer.camera.fov,
                min: 30,
                max: 140,
                step: 1,
                onChange: (v: number) => {
                    mapViewer.camera.fov = v;
                },
            },
        };
    } else {
        return {
            "Ortho Zoom": {
                value: mapViewer.camera.orthoZoom,
                min: 1,
                max: 60,
                step: 1,
                onChange: (v: number) => {
                    mapViewer.camera.orthoZoom = v;
                },
            },
        };
    }
}
