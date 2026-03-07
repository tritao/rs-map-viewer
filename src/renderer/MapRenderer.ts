import Denque from "denque";
import { vec4 } from "gl-matrix";

import { MapData, ObjRenderData } from "../maprender/MapRenderPayload";
import { Scene } from "../rs/scene/Scene";
import type { FramePacket } from "../runtime/contracts/FramePacket";
import type {
    InteractionControllerRenderer,
    InteractionSnapshotRenderer,
} from "../runtime/contracts/Interaction";
import { LoadedCache } from "../util/Caches";
import { FrameStats, Renderer, RendererStats } from "./Renderer";

type MapRemovalInfo = Readonly<{
    mapId: number;
}>;

export enum TextureFilterMode {
    DISABLED,
    BILINEAR,
    TRILINEAR,
    ANISOTROPIC_2X,
    ANISOTROPIC_4X,
    ANISOTROPIC_8X,
    ANISOTROPIC_16X,
}

export function getMaxAnisotropy(mode: TextureFilterMode): number {
    switch (mode) {
        case TextureFilterMode.ANISOTROPIC_2X:
            return 2;
        case TextureFilterMode.ANISOTROPIC_4X:
            return 4;
        case TextureFilterMode.ANISOTROPIC_8X:
            return 8;
        case TextureFilterMode.ANISOTROPIC_16X:
            return 16;
        default:
            return 1;
    }
}

export interface MapSquareRenderable {
    readonly id: number;

    readonly mapX: number;
    readonly mapY: number;
    readonly borderSize: number;

    getTileRenderFlag(level: number, tileX: number, tileY: number): number;

    canRender(frameCount: number): boolean;
    delete(): void;
}

export abstract class MapRenderer<T extends MapSquareRenderable, U extends MapData>
    implements Renderer
{
    stats = new FrameStats();
    rendererStats = new RendererStats();

    hasMultiDraw: boolean = false;

    // Textures
    textureFilterMode: TextureFilterMode = TextureFilterMode.ANISOTROPIC_16X;
    loadedTextureIds: Set<number> = new Set();

    // Framebuffers
    needsFramebufferUpdate: boolean = false;

    // Maps
    mapsToLoad: Denque<U> = new Denque();
    loadedMaps: Map<number, T> = new Map();

    // Settings
    maxLevel: number = Scene.MAX_LEVELS - 1;

    skyColor: vec4 = vec4.fromValues(0, 0, 0, 1);
    fogDepth: number = 16;

    brightness: number = 1.0;
    colorBanding: number = 255;

    smoothTerrain: boolean = false;

    cullBackFace: boolean = true;

    msaaEnabled: boolean = false;
    fxaaEnabled: boolean = false;

    loadObjs: boolean = true;
    loadNpcs: boolean = true;
    loadLocs: boolean = true;

    renderDistance: number;
    unloadDistance: number;
    lodDistance: number;

    constructor(
        readonly cache: LoadedCache,
        renderDistance: number,
        unloadDistance: number,
        lodDistance: number,
    ) {
        this.renderDistance = renderDistance;
        this.unloadDistance = unloadDistance;
        this.lodDistance = lodDistance;
    }

    abstract getViewportDimensions(): { width: number; height: number };

    abstract init(canvas: HTMLCanvasElement): Promise<void>;

    abstract initCache(): void;

    abstract cleanUp(): Promise<void>;

    abstract render(time: number, deltaTime: number, resized: boolean): void;

    abstract onResize(width: number, height: number): void;

    abstract onFrameEnd(): void;

    // Maps
    getMap(mapId: number): MapSquareRenderable | undefined {
        return this.loadedMaps.get(mapId);
    }

    // Optional capability: renderer instance can accept interaction input events.
    getInteractionControllerRenderer(): InteractionControllerRenderer | undefined {
        return undefined;
    }

    // Optional capability: renderer can expose interaction snapshot data for worker-side planning.
    getInteractionSnapshotRenderer(): InteractionSnapshotRenderer | undefined {
        return undefined;
    }

    // Optional capability: renderer instance can consume per-frame worker packets (npc gpu data +
    // tick patch streams). Default is a no-op so non-packet renderers don't need to implement it.
    applyFramePacket(_packet: FramePacket | undefined): void {}

    // Optional capability: renderer instance can replace runtime-owned object render data for a map.
    replaceMapObjRenderData(_mapId: number, _objRenderData: ObjRenderData | undefined): void {}

    addMap(mapData: U): void {
        this.mapsToLoad.push(mapData);
    }

    removeMap(mapInfo: MapRemovalInfo) {
        let map = this.loadedMaps.get(mapInfo.mapId);
        if (map) {
            map.delete();
            this.loadedMaps.delete(mapInfo.mapId);
        }
    }

    clearMaps(): void {
        this.mapsToLoad.clear();
    }

    isValidMapData(mapData: U): boolean {
        return (
            mapData.cacheName === this.cache.info.name &&
            mapData.maxLevel === this.maxLevel &&
            mapData.loadObjs === this.loadObjs &&
            mapData.loadNpcs === this.loadNpcs &&
            mapData.loadLocs === this.loadLocs &&
            mapData.smoothTerrain === this.smoothTerrain
        );
    }

    // Textures
    abstract updateTextureFiltering(): void;

    setMaxLevel(maxLevel: number): void {
        const updated = this.maxLevel !== maxLevel;
        this.maxLevel = maxLevel;
        if (updated) {
            this.clearMaps();
        }
    }

    setSkyColor(r: number, g: number, b: number) {
        this.skyColor[0] = r / 255;
        this.skyColor[1] = g / 255;
        this.skyColor[2] = b / 255;
    }

    setSmoothTerrain(enabled: boolean): void {
        const updated = this.smoothTerrain !== enabled;
        this.smoothTerrain = enabled;
        if (updated) {
            this.clearMaps();
        }
    }

    setMsaa(enabled: boolean): void {
        const updated = this.msaaEnabled !== enabled;
        this.msaaEnabled = enabled;
        if (updated) {
            this.needsFramebufferUpdate = true;
        }
    }

    setFxaa(enabled: boolean): void {
        this.fxaaEnabled = enabled;
    }

    setLoadObjs(enabled: boolean): void {
        const updated = this.loadObjs !== enabled;
        this.loadObjs = enabled;
        if (updated) {
            this.clearMaps();
        }
    }

    setLoadNpcs(enabled: boolean): void {
        const updated = this.loadNpcs !== enabled;
        this.loadNpcs = enabled;
        if (updated) {
            this.clearMaps();
        }
    }

    setLoadLocs(enabled: boolean): void {
        const updated = this.loadLocs !== enabled;
        this.loadLocs = enabled;
        if (updated) {
            this.clearMaps();
        }
    }
}
