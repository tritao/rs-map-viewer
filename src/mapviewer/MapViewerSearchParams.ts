import { vec3 } from "gl-matrix";
import type { URLSearchParamsInit } from "react-router-dom";

import { type Camera, ProjectionType } from "../renderer/Camera";
import type { BackendKind } from "../util/BackendKind";
import { MapManager, type MapManagerFixedMapSquare } from "./MapManager";

export type DevFixedMapSquare = MapManagerFixedMapSquare;

export type MapViewerSearchRuntimeOptions = Readonly<{
    mapRenderBackend: BackendKind;
    mapRenderTelemetry: boolean;
}>;

export type SearchParamsListener = (params: URLSearchParamsInit) => void;

export class MapViewerSearchParamsState {
    private readonly listeners = new Set<SearchParamsListener>();
    private debounceTimer?: number;

    constructor(private readonly getSearchParams: () => URLSearchParamsInit) {}

    subscribe(listener: SearchParamsListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    update(): void {
        this.emit(200);
    }

    emit(debounceMs: number = 0): void {
        if (this.debounceTimer !== undefined) {
            window.clearTimeout(this.debounceTimer);
        }
        if ((debounceMs | 0) <= 0) {
            this.debounceTimer = undefined;
            this.notifyListeners();
            return;
        }
        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = undefined;
            this.notifyListeners();
        }, debounceMs);
    }

    dispose(): void {
        if (this.debounceTimer !== undefined) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        this.listeners.clear();
    }

    private notifyListeners(): void {
        const params = this.getSearchParams();
        for (const listener of this.listeners) {
            listener(params);
        }
    }
}

export type ParsedMapViewerSearchParams = Readonly<{
    position?: vec3;
    projectionType?: ProjectionType;
    orthoZoom?: number;
    pitch?: number;
    yaw?: number;
    devFixedMapSquare?: DevFixedMapSquare;
}>;

type BuildMapViewerSearchParamsInput = Readonly<{
    camera: Camera;
    loadedCacheName: string;
    latestCacheName: string;
    runtimeOptions: MapViewerSearchRuntimeOptions;
    defaultRuntimeOptions: MapViewerSearchRuntimeOptions;
    devFixedMapSquare?: DevFixedMapSquare;
}>;

function parseDevMapSquare(value: string | null): DevFixedMapSquare | undefined {
    if (!value) {
        return undefined;
    }
    const match = /^(\d+):(\d+)$/.exec(value.trim());
    if (!match) {
        return undefined;
    }
    const mapX = Number(match[1]);
    const mapY = Number(match[2]);
    if (
        !Number.isFinite(mapX) ||
        !Number.isFinite(mapY) ||
        mapX < 0 ||
        mapY < 0 ||
        mapX >= MapManager.MAX_MAP_X ||
        mapY >= MapManager.MAX_MAP_Y
    ) {
        return undefined;
    }
    return { mapX, mapY };
}

function parseBackendKindSearchParam(value: string | null): BackendKind {
    if (value === "wasm") {
        return "wasm";
    }
    return "ts";
}

export function buildMapViewerSearchParams(
    input: BuildMapViewerSearchParamsInput,
): URLSearchParamsInit {
    const cx = input.camera.getPosX().toFixed(2).toString();
    const cy = (-input.camera.getPosY()).toFixed(2);
    const cz = input.camera.getPosZ().toFixed(2).toString();
    const yaw = input.camera.yaw & 2047;
    const params: Record<string, string> = {
        cx,
        cy,
        cz,
        p: (input.camera.pitch | 0).toString(),
        y: yaw.toString(),
        v: "1",
    };

    if (input.camera.projectionType === ProjectionType.ORTHO) {
        params.pt = "o";
        params.z = input.camera.orthoZoom.toString();
    }
    if (input.loadedCacheName !== input.latestCacheName) {
        params.cache = input.loadedCacheName;
    }
    if (input.runtimeOptions.mapRenderBackend !== input.defaultRuntimeOptions.mapRenderBackend) {
        params.mrb = input.runtimeOptions.mapRenderBackend;
    }
    if (input.runtimeOptions.mapRenderTelemetry) {
        params.mrt = "1";
    }
    if (input.devFixedMapSquare) {
        params.devsq = `${input.devFixedMapSquare.mapX}:${input.devFixedMapSquare.mapY}`;
    }

    return params;
}

type ApplyMapViewerSearchParamsInput = Readonly<{
    searchParams: URLSearchParams;
    camera: Camera;
    setDevFixedMapSquare(square: DevFixedMapSquare | undefined): void;
}>;

export function parseMapViewerSearchParams(
    searchParams: URLSearchParams,
): ParsedMapViewerSearchParams {
    const cx = searchParams.get("cx");
    const cy = searchParams.get("cy");
    const cz = searchParams.get("cz");
    const pitch = searchParams.get("p");
    const yaw = searchParams.get("y");
    const version = searchParams.get("v");
    const zoom = searchParams.get("z");

    return {
        position:
            cx && cy && cz
                ? vec3.fromValues(parseFloat(cx), -parseFloat(cy), parseFloat(cz))
                : undefined,
        projectionType: searchParams.get("pt") === "o" ? ProjectionType.ORTHO : undefined,
        orthoZoom: zoom ? parseInt(zoom) : undefined,
        pitch: pitch ? (version ? parseInt(pitch) : -parseInt(pitch)) : undefined,
        yaw: yaw ? (version ? parseInt(yaw) : 2048 - parseInt(yaw)) : undefined,
        devFixedMapSquare: parseDevMapSquare(searchParams.get("devsq")),
    };
}

export function applyMapViewerSearchParams(input: ApplyMapViewerSearchParamsInput): void {
    const parsed = parseMapViewerSearchParams(input.searchParams);
    if (parsed.projectionType !== undefined) {
        input.camera.projectionType = parsed.projectionType;
    }
    if (parsed.orthoZoom !== undefined) {
        input.camera.orthoZoom = parsed.orthoZoom;
    }
    if (parsed.position) {
        input.camera.pos = parsed.position;
    }
    if (parsed.pitch !== undefined) {
        input.camera.pitch = parsed.pitch;
    }
    if (parsed.yaw !== undefined) {
        input.camera.yaw = parsed.yaw;
    }
    input.setDevFixedMapSquare(parsed.devFixedMapSquare);
}

export function parseMapViewerRuntimeOptions(
    searchParams: URLSearchParams,
): MapViewerSearchRuntimeOptions {
    return {
        mapRenderBackend: parseBackendKindSearchParam(searchParams.get("mrb")),
        mapRenderTelemetry: searchParams.get("mrt") === "1",
    };
}
