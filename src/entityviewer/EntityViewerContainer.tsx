import { ChangeEvent, memo, type PointerEventHandler, useEffect, useRef, type WheelEventHandler } from "react";

import { RendererCanvas } from "../components/renderer/RendererCanvas";
import type { CacheInfo } from "../rs/cache/CacheInfo";
import type { CacheList } from "../util/Caches";
import type { EntityViewerKind, EntityViewerObjMode, EntityViewerRequest } from "./EntityViewerData";
import { EntityViewerRenderer } from "./EntityViewerRenderer";
import type { ObjIconSprite } from "./ObjIconSpriteRenderer";

const ICON_DISPLAY_SCALE = 8;
const AUTHENTIC_ICON_WIDTH = 36;

type EntityViewerContainerProps = Readonly<{
    cacheList: CacheList;
    selectedCache: CacheInfo;
    renderer: EntityViewerRenderer;
    request: EntityViewerRequest;
    label?: string;
    errorMessage?: string;
    iconSprite?: ObjIconSprite;
    cameraYaw: number;
    cameraPitch: number;
    cameraDistance: number;
    onRequestChange: (request: EntityViewerRequest) => void;
    onCacheChange: (cacheName: string) => void;
    onCameraChange: (field: "yaw" | "pitch" | "distance", value: number) => void;
}>;

function SpriteCanvas({ sprite }: Readonly<{ sprite: ObjIconSprite }>): JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pixelWidth = Math.max(1, sprite.width | 0);
    const pixelHeight = Math.max(1, sprite.height | 0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }
        const imageData = ctx.createImageData(pixelWidth, pixelHeight);
        const out = imageData.data;
        for (let i = 0; i < sprite.pixels.length; i++) {
            const rgb = sprite.pixels[i] | 0;
            const off = i * 4;
            out[off] = (rgb >> 16) & 0xff;
            out[off + 1] = (rgb >> 8) & 0xff;
            out[off + 2] = rgb & 0xff;
            out[off + 3] = rgb === 0 ? 0 : 0xff;
        }
        ctx.putImageData(imageData, 0, 0);
    }, [pixelHeight, pixelWidth, sprite]);

    const displayScale = pixelWidth <= AUTHENTIC_ICON_WIDTH ? ICON_DISPLAY_SCALE : 1;

    return (
        <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#6f6f74",
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    width: `${pixelWidth * displayScale}px`,
                    height: `${pixelHeight * displayScale}px`,
                    imageRendering: "pixelated",
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "transparent",
                }}
            />
        </div>
    );
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function parseNonNegativeNumber(value: string, fallback: number): number {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}

export const EntityViewerContainer = memo(function EntityViewerContainer({
    cacheList,
    selectedCache,
    renderer,
    request,
    label,
    errorMessage,
    iconSprite,
    cameraYaw,
    cameraPitch,
    cameraDistance,
    onRequestChange,
    onCacheChange,
    onCameraChange,
}: EntityViewerContainerProps): JSX.Element {
    const dragStateRef = useRef<
        | {
              pointerId: number;
              startX: number;
              startY: number;
              startYaw: number;
              startPitch: number;
          }
        | undefined
    >(undefined);

    const updateRequest = (patch: Partial<EntityViewerRequest>) =>
        onRequestChange({
            ...request,
            ...patch,
        });

    const onKindChange = (event: ChangeEvent<HTMLSelectElement>) =>
        updateRequest({ kind: event.target.value as EntityViewerKind });

    const onIdChange = (event: ChangeEvent<HTMLInputElement>) =>
        updateRequest({ id: parseNonNegativeNumber(event.target.value, request.id) | 0 });

    const onCountChange = (event: ChangeEvent<HTMLInputElement>) =>
        updateRequest({
            count: Math.max(1, (parseNonNegativeNumber(event.target.value, request.count) | 0)),
        });

    const onRotationChange = (event: ChangeEvent<HTMLInputElement>) =>
        updateRequest({
            rotation: (parseNonNegativeNumber(event.target.value, request.rotation) | 0) & 3,
        });

    const onObjModeChange = (event: ChangeEvent<HTMLSelectElement>) =>
        updateRequest({ objMode: event.target.value as EntityViewerObjMode });

    const showWorldCameraControls = !iconSprite;

    const onWorldPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
        dragStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startYaw: cameraYaw,
            startPitch: cameraPitch,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onWorldPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) {
            return;
        }
        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;
        const nextYaw = (dragState.startYaw + Math.round(deltaX * 4)) & 2047;
        const nextPitch = clamp(dragState.startPitch + Math.round(deltaY * 2), -512, 512);
        onCameraChange("yaw", nextYaw);
        onCameraChange("pitch", nextPitch);
    };

    const onWorldPointerUp: PointerEventHandler<HTMLDivElement> = (event) => {
        if (dragStateRef.current?.pointerId === event.pointerId) {
            dragStateRef.current = undefined;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const onWorldWheel: WheelEventHandler<HTMLDivElement> = (event) => {
        event.preventDefault();
        const delta = event.deltaY > 0 ? 1 : -1;
        const nextDistance = clamp(cameraDistance + delta, 2, 64);
        onCameraChange("distance", nextDistance);
    };

    return (
        <div className="App max-height" style={{ display: "flex", flexDirection: "column" }}>
            <div
                style={{
                    display: "flex",
                    gap: "12px",
                    padding: "12px",
                    alignItems: "center",
                    flexWrap: "wrap",
                    color: "white",
                    background: "#1d1d1d",
                }}
            >
                <label>
                    Cache{" "}
                    <select
                        value={selectedCache.name}
                        onChange={(event) => onCacheChange(event.target.value)}
                    >
                        {cacheList.caches.map((cache) => (
                            <option key={cache.name} value={cache.name}>
                                {cache.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Kind{" "}
                    <select value={request.kind} onChange={onKindChange}>
                        <option value="obj">Object</option>
                        <option value="npc">NPC</option>
                        <option value="loc">Loc</option>
                        <option value="model">Model</option>
                    </select>
                </label>
                <label>
                    Id <input type="number" min={0} value={request.id} onChange={onIdChange} />
                </label>
                {request.kind === "obj" ? (
                    <>
                        <label>
                            Count{" "}
                            <input
                                type="number"
                                min={1}
                                value={request.count}
                                onChange={onCountChange}
                            />
                        </label>
                        <label>
                            Mode{" "}
                            <select value={request.objMode} onChange={onObjModeChange}>
                                <option value="icon">Icon</option>
                                <option value="world">World</option>
                            </select>
                        </label>
                        {request.objMode !== "world" ? (
                            <>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={request.icon36x32}
                                        onChange={(event) =>
                                            updateRequest({
                                                icon36x32: event.target.checked,
                                            })
                                        }
                                    />{" "}
                                    36x32
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={request.iconOutline}
                                        onChange={(event) =>
                                            updateRequest({
                                                iconOutline: event.target.checked,
                                            })
                                        }
                                    />{" "}
                                    Outline
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={request.iconShadow}
                                        onChange={(event) =>
                                            updateRequest({
                                                iconShadow: event.target.checked,
                                            })
                                        }
                                    />{" "}
                                    Shadow
                                </label>
                            </>
                        ) : undefined}
                    </>
                ) : undefined}
                {request.kind === "loc" ? (
                    <label>
                        Rotation{" "}
                        <input
                            type="number"
                            min={0}
                            max={3}
                            value={request.rotation}
                            onChange={onRotationChange}
                        />
                    </label>
                ) : undefined}
                {showWorldCameraControls ? (
                    <>
                        <label>
                            Yaw{" "}
                            <input
                                type="range"
                                min={0}
                                max={2047}
                                value={cameraYaw}
                                onChange={(event) =>
                                    onCameraChange(
                                        "yaw",
                                        parseNonNegativeNumber(event.target.value, cameraYaw) | 0,
                                    )
                                }
                            />
                        </label>
                        <label>
                            Pitch{" "}
                            <input
                                type="range"
                                min={-512}
                                max={512}
                                value={cameraPitch}
                                onChange={(event) =>
                                    onCameraChange(
                                        "pitch",
                                        Number.parseInt(event.target.value, 10) || 0,
                                    )
                                }
                            />
                        </label>
                        <label>
                            Distance{" "}
                            <input
                                type="range"
                                min={2}
                                max={64}
                                step={0.25}
                                value={cameraDistance}
                                onChange={(event) =>
                                    onCameraChange(
                                        "distance",
                                        parseNonNegativeNumber(
                                            event.target.value,
                                            cameraDistance,
                                        ),
                                    )
                                }
                            />
                        </label>
                    </>
                ) : undefined}
                <span>{label ?? "No entity loaded"}</span>
                {errorMessage ? <span style={{ color: "#ff9c9c" }}>{errorMessage}</span> : undefined}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
                {iconSprite ? (
                    <SpriteCanvas sprite={iconSprite} />
                ) : (
                    <div
                        style={{ width: "100%", height: "100%", cursor: "grab" }}
                        onPointerDown={onWorldPointerDown}
                        onPointerMove={onWorldPointerMove}
                        onPointerUp={onWorldPointerUp}
                        onPointerCancel={onWorldPointerUp}
                        onWheel={onWorldWheel}
                    >
                        <RendererCanvas renderer={renderer} />
                    </div>
                )}
            </div>
        </div>
    );
});
