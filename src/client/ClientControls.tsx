import { vec3 } from "gl-matrix";
import { Leva, button, buttonGroup, folder, useControls } from "leva";
import { ButtonGroupOpts, Schema } from "leva/dist/declarations/src/types";
import { memo, useEffect, useState } from "react";

import { DownloadProgress } from "../rs/cache/CacheFiles";
import { isTouchDevice } from "../util/DeviceUtil";
import { lerp, slerp } from "../util/MathUtil";
import { loadCacheFiles } from "../util/Caches";
import { CameraView, ProjectionType } from "../renderer/Camera";
import { Client } from "./Client";
import { ClientRenderer } from "./ClientRenderer";
import { fetchNpcSpawns, getNpcSpawnsUrl } from "../data/npc/NpcSpawn";
import FileSaver from "file-saver";

interface ClientControlsProps {
    renderer: ClientRenderer;
    hideUi: boolean;
    setRenderer: (renderer: ClientRenderer) => void;
    setHideUi: (hideUi: boolean | ((hideUi: boolean) => boolean)) => void;
    setDownloadProgress: (progress: DownloadProgress | undefined) => void;
}

enum VarType {
    VARP = 0,
    VARBIT = 1,
}

export const ClientControls = memo(
    ({
        renderer: rendererMainLoop,
        hideUi: hidden,
        setRenderer,
        setHideUi,
        setDownloadProgress,
    }: ClientControlsProps): JSX.Element => {
        const Client = rendererMainLoop.client;

        const [projectionType, setProjectionType] = useState<ProjectionType>(
            Client.camera.projectionType,
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

        const controlsSchema: Schema = {
            Position: { value: positionControls, editable: false },
            Direction: { value: directionControls, editable: false },
        };

        const [animationDuration, setAnimationDuration] = useState(10);
        const [cameraPoints, setCameraPoints] = useState<CameraView[]>(() => []);

        const addPoint = () => {
            setCameraPoints((pts) => [
                ...pts,
                {
                    position: vec3.fromValues(
                        Client.camera.pos[0],
                        Client.camera.pos[1],
                        Client.camera.pos[2],
                    ),
                    pitch: Client.camera.pitch,
                    yaw: Client.camera.yaw,
                    fov: Client.camera.fov,
                    orthoZoom: Client.camera.orthoZoom,
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
        }, [Client]);

        useEffect(() => {
            setPointControls(
                folder(
                    cameraPoints.reduce((acc: Record<string, any>, v, i) => {
                        const point = v;
                        const buttons: ButtonGroupOpts = {
                            Teleport: () => Client.setCamera(point),
                            Delete: () => setCameraPoints((pts) => pts.filter((_, j) => j !== i)),
                        };
                        acc["Point " + i] = buttonGroup(buttons);
                        return acc;
                    }, {}),
                ),
            );
        }, [Client, cameraPoints]);

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
                    Client.setCamera(cameraPoints[cameraPoints.length - 1]);
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
                Client.setCamera(newView);

                animationId = requestAnimationFrame(animate);
            };

            // Start animating
            animationId = requestAnimationFrame(animate);

            return () => {
                cancelAnimationFrame(animationId);
            };
        }, [Client, cameraPoints, animationDuration, isCameraRunning]);

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
                                Client.camera.setProjectionType(v);
                                setProjectionType(v);
                            },
                            order: 0,
                        },
                        ...createCameraControls(Client),
                        Speed: {
                            value: Client.cameraSpeed,
                            min: 0.1,
                            max: 5,
                            step: 0.1,
                            onChange: (v: number) => {
                                Client.cameraSpeed = v;
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
                            value: Client.renderDistance,
                            min: 16,
                            max: 2000,
                            step: 16,
                            onChange: (v: number) => {
                                Client.renderDistance = v;
                            },
                        },
                        Unload: {
                            value: Client.unloadDistance,
                            min: 1,
                            max: 30,
                            step: 1,
                            onChange: (v: number) => {
                                Client.unloadDistance = v;
                            },
                        },
                        Lod: {
                            value: Client.lodDistance,
                            min: 0,
                            max: 30,
                            step: 1,
                            onChange: (v: number) => {
                                Client.lodDistance = v;
                            },
                        },
                    },
                    { collapsed: false },
                ),
                Cache: folder(
                    {
                        Version: {
                            value: Client.loadedCache.info.name,
                            options: Client.cacheList.caches.map((cache) => cache.name),
                            onChange: async (v: string) => {
                                const cacheInfo = Client.cacheList.caches.find(
                                    (cache) => cache.name === v,
                                );
                                if (v !== Client.loadedCache.info.name && cacheInfo) {
                                    const [loadedCache, npcSpawns] = await Promise.all([
                                        loadCacheFiles(cacheInfo, undefined, setDownloadProgress),
                                        fetchNpcSpawns(getNpcSpawnsUrl(cacheInfo)),
                                    ]);
                                    Client.npcSpawns = npcSpawns;
                                    Client.initCache(loadedCache);
                                    setDownloadProgress(undefined);
                                }
                            },
                        },
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
                        ...rendererMainLoop.renderer.getControls(),
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
                            const varManager = Client.cacheLoaders.varManager;
                            let updated = false;
                            if (varType === VarType.VARP) {
                                updated = varManager.setVarp(varId, varValue);
                            } else {
                                updated = varManager.setVarbit(varId, varValue);
                            }
                            if (updated) {
                                Client.updateVars();
                                Client.renderer.mapManager.clearMaps();
                            }
                        }),
                        Clear: button(() => {
                            Client.cacheLoaders.varManager.clear();
                            Client.updateVars();
                            Client.renderer.mapManager.clearMaps();
                        }),
                    },
                    { collapsed: true },
                ),
                Menu: folder(
                    {
                        Tooltips: {
                            value: Client.tooltips,
                            onChange: (v: boolean) => {
                                Client.tooltips = v;
                            },
                        },
                        "Debug Id": {
                            value: Client.debugId,
                            onChange: (v: boolean) => {
                                Client.debugId = v;
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
                                Client.workerPool
                                    .exportSprites()
                                    .then((zipBlob) => {
                                        FileSaver.saveAs(
                                            zipBlob,
                                            `sprites_${Client.loadedCache.info.name}.zip`,
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
                                Client.workerPool
                                    .exportTextures()
                                    .then((zipBlob) => {
                                        FileSaver.saveAs(
                                            zipBlob,
                                            `textures_${Client.loadedCache.info.name}.zip`,
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
                projectionType,
                varType,
                varId,
                varValue,
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

function createCameraControls(Client: Client): Schema {
    if (Client.camera.projectionType === ProjectionType.PERSPECTIVE) {
        return {
            FOV: {
                value: Client.camera.fov,
                min: 30,
                max: 140,
                step: 1,
                onChange: (v: number) => {
                    Client.camera.fov = v;
                },
            },
        };
    } else {
        return {
            "Ortho Zoom": {
                value: Client.camera.orthoZoom,
                min: 1,
                max: 60,
                step: 1,
                onChange: (v: number) => {
                    Client.camera.orthoZoom = v;
                },
            },
        };
    }
}
