import { useCallback, useEffect, useRef, useState } from "react";
import { Joystick } from "react-joystick-component";
import { useSearchParams } from "react-router-dom";

import { RendererCanvas } from "../components/renderer/RendererCanvas";
import { OsrsLoadingBar } from "../components/rs/loading/OsrsLoadingBar";
import { OsrsMenu, OsrsMenuProps } from "../components/rs/menu/OsrsMenu";
import { MinimapContainer } from "../components/rs/minimap/MinimapContainer";
import { WorldMapModal } from "../components/rs/worldmap/WorldMapModal";
import { RS_TO_DEGREES } from "../rs/MathConstants";
import { DownloadProgress } from "../rs/cache/CacheFiles";
import { formatBytes } from "../util/BytesUtil";
import { isTouchDevice } from "../util/DeviceUtil";
import { Client } from "./Client";
import "./ClientContainer.css";
import { ClientControls } from "./ClientControls";
import { ClientRenderer } from "./ClientRenderer";

interface ClientContainerProps {
    client: Client;
}

export function ClientContainer({ client: Client }: ClientContainerProps): JSX.Element {
    const [searchParams, setSearchParams] = useSearchParams();

    const [renderer, setRenderer] = useState<ClientRenderer>(Client.renderer);

    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>();

    const [hideUi, setHideUi] = useState(false);
    const [fps, setFps] = useState(0);
    const [cameraYaw, setCameraYaw] = useState(Client.camera.getYaw());
    const [isWorldMapOpen, setWorldMapOpen] = useState<boolean>(false);

    const [menuProps, setMenuProps] = useState<OsrsMenuProps | undefined>(undefined);

    const requestRef = useRef<number | undefined>();

    const animate = (time: DOMHighResTimeStamp) => {
        // Wait for 200ms before updating search params
        if (
            Client.needsSearchParamUpdate &&
            performance.now() - Client.lastTimeSearchParamsUpdated > 200
        ) {
            setSearchParams(Client.getSearchParams(), { replace: true });
            Client.needsSearchParamUpdate = false;
            console.log("Updated search params");
        }

        if (!hideUi) {
            setFps(Math.round(renderer.renderer.stats.frameTimeFps));
            setCameraYaw(Client.camera.getYaw());
        }

        if (Client.menuEntries.length > 0 && Client.menuX !== -1 && Client.menuY !== -1) {
            setMenuProps({
                x: Client.menuX,
                y: Client.menuY,
                tooltip: !Client.menuOpen,
                entries: Client.menuEntries,
                debugId: Client.debugId,
            });
        } else {
            setMenuProps(undefined);
        }

        requestRef.current = requestAnimationFrame(animate);
    };

    useEffect(() => {
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current!);
    }, [searchParams, hideUi]);

    const resetCameraYaw = useCallback(() => {
        Client.camera.setYaw(0);
    }, [Client]);

    const openWorldMap = useCallback(() => {
        setWorldMapOpen(true);
    }, []);

    const closeWorldMap = useCallback(() => {
        setWorldMapOpen(false);
        renderer.canvas.focus();
    }, [renderer]);

    const onMapClicked = useCallback(
        (x: number, y: number) => {
            Client.camera.pos[0] = x;
            Client.camera.pos[2] = y;
            Client.camera.updated = true;
            closeWorldMap();
        },
        [Client, closeWorldMap],
    );

    const getMapPosition = useCallback(() => {
        const x = Client.camera.getPosX();
        const y = Client.camera.getPosZ();

        return {
            x,
            y,
        };
    }, [Client]);

    const loadMapImageUrl = useCallback(
        (mapX: number, mapY: number) => {
            return Client.getMapImageUrl(mapX, mapY, false);
        },
        [Client],
    );

    const loadMinimapImageUrl = useCallback(
        (mapX: number, mapY: number) => {
            return Client.getMapImageUrl(mapX, mapY, true);
        },
        [Client],
    );

    let loadingBarOverlay: JSX.Element | undefined = undefined;
    if (downloadProgress) {
        const formattedCacheSize = formatBytes(downloadProgress.total);
        const progress = ((downloadProgress.current / downloadProgress.total) * 100) | 0;
        loadingBarOverlay = (
            <div className="overlay-container max-height">
                <OsrsLoadingBar
                    text={`Downloading cache (${formattedCacheSize})`}
                    progress={progress}
                />
            </div>
        );
    }

    return (
        <div className="max-height">
            {loadingBarOverlay}

            {menuProps && <OsrsMenu {...menuProps} />}

            <ClientControls
                renderer={renderer}
                hideUi={hideUi}
                setRenderer={setRenderer}
                setHideUi={setHideUi}
                setDownloadProgress={setDownloadProgress}
            />

            {!hideUi && (
                <span>
                    <div className="hud left-top">
                        <MinimapContainer
                            yawDegrees={(2047 - cameraYaw) * RS_TO_DEGREES}
                            onCompassClick={resetCameraYaw}
                            onWorldMapClick={openWorldMap}
                            getPosition={getMapPosition}
                            loadMapImageUrl={loadMinimapImageUrl}
                        />

                        <div className="fps-counter content-text">{fps}</div>
                        <div className="fps-counter content-text">{Client.debugText}</div>
                    </div>
                    <WorldMapModal
                        isOpen={isWorldMapOpen}
                        onRequestClose={closeWorldMap}
                        onDoubleClick={onMapClicked}
                        getPosition={getMapPosition}
                        loadMapImageUrl={loadMapImageUrl}
                    />
                </span>
            )}

            {!hideUi && isTouchDevice && (
                <div className="joystick-container left">
                    <Joystick
                        size={75}
                        baseColor="#181C20"
                        stickColor="#007BFF"
                        stickSize={40}
                        move={Client.inputManager.onPositionJoystickMove}
                        stop={Client.inputManager.onPositionJoystickStop}
                    ></Joystick>
                </div>
            )}
            {!hideUi && isTouchDevice && (
                <div className="joystick-container right">
                    <Joystick
                        size={75}
                        baseColor="#181C20"
                        stickColor="#007BFF"
                        stickSize={40}
                        move={Client.inputManager.onCameraJoystickMove}
                        stop={Client.inputManager.onCameraJoystickStop}
                    ></Joystick>
                </div>
            )}

            <RendererCanvas renderer={renderer} />
        </div>
    );
}
