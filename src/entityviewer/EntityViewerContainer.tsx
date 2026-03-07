import { ChangeEvent, memo, useEffect, useRef } from "react";

import { RendererCanvas } from "../components/renderer/RendererCanvas";
import type { CacheInfo } from "../rs/cache/CacheInfo";
import type { CacheList } from "../util/Caches";
import type { EntityViewerKind, EntityViewerObjMode, EntityViewerRequest } from "./EntityViewerData";
import { EntityViewerRenderer } from "./EntityViewerRenderer";
import type { ObjIconSprite } from "./ObjIconSpriteRenderer";

type EntityViewerContainerProps = Readonly<{
    cacheList: CacheList;
    selectedCache: CacheInfo;
    renderer: EntityViewerRenderer;
    request: EntityViewerRequest;
    label?: string;
    errorMessage?: string;
    iconSprite?: ObjIconSprite;
    onRequestChange: (request: EntityViewerRequest) => void;
    onCacheChange: (cacheName: string) => void;
    onCameraChange: (field: "yaw" | "pitch" | "distance", value: number) => void;
}>;

function SpriteCanvas({ sprite }: Readonly<{ sprite: ObjIconSprite }>): JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        canvas.width = sprite.width;
        canvas.height = sprite.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }
        const imageData = ctx.createImageData(sprite.width, sprite.height);
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
    }, [sprite]);

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
                    width: `${sprite.width * 4}px`,
                    height: `${sprite.height * 4}px`,
                    imageRendering: "pixelated",
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "transparent",
                }}
            />
        </div>
    );
}

function parsePositiveInt(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed | 0;
}

export const EntityViewerContainer = memo(function EntityViewerContainer({
    cacheList,
    selectedCache,
    renderer,
    request,
    label,
    errorMessage,
    iconSprite,
    onRequestChange,
    onCacheChange,
    onCameraChange,
}: EntityViewerContainerProps): JSX.Element {
    const updateRequest = (patch: Partial<EntityViewerRequest>) =>
        onRequestChange({
            ...request,
            ...patch,
        });

    const onKindChange = (event: ChangeEvent<HTMLSelectElement>) =>
        updateRequest({ kind: event.target.value as EntityViewerKind });

    const onIdChange = (event: ChangeEvent<HTMLInputElement>) =>
        updateRequest({ id: parsePositiveInt(event.target.value, request.id) });

    const onCountChange = (event: ChangeEvent<HTMLInputElement>) =>
        updateRequest({ count: Math.max(1, parsePositiveInt(event.target.value, request.count)) });

    const onRotationChange = (event: ChangeEvent<HTMLInputElement>) =>
        updateRequest({ rotation: parsePositiveInt(event.target.value, request.rotation) & 3 });

    const onObjModeChange = (event: ChangeEvent<HTMLSelectElement>) =>
        updateRequest({ objMode: event.target.value as EntityViewerObjMode });

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
                <label>
                    Yaw{" "}
                    <input
                        type="range"
                        min={0}
                        max={2047}
                        defaultValue={1024}
                        onChange={(event) =>
                            onCameraChange("yaw", parsePositiveInt(event.target.value, 1024))
                        }
                    />
                </label>
                <label>
                    Pitch{" "}
                    <input
                        type="range"
                        min={-512}
                        max={512}
                        defaultValue={-180}
                        onChange={(event) =>
                            onCameraChange("pitch", Number.parseInt(event.target.value, 10) || 0)
                        }
                    />
                </label>
                <label>
                    Distance{" "}
                    <input
                        type="range"
                        min={128}
                        max={4096}
                        step={16}
                        defaultValue={768}
                        onChange={(event) =>
                            onCameraChange(
                                "distance",
                                parsePositiveInt(event.target.value, 768),
                            )
                        }
                    />
                </label>
                <span>{label ?? "No entity loaded"}</span>
                {errorMessage ? <span style={{ color: "#ff9c9c" }}>{errorMessage}</span> : undefined}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
                {iconSprite ? <SpriteCanvas sprite={iconSprite} /> : <RendererCanvas renderer={renderer} />}
            </div>
        </div>
    );
});
