import Denque from "denque";
import { vec4 } from "gl-matrix";
import { folder } from "leva";
import { Schema } from "leva/dist/declarations/src/types";
import { CollisionMap } from "../rs/scene/CollisionMap";
import { Scene } from "../rs/scene/Scene";
import { LoadedCache } from "../util/Caches";
import { MapData } from "./loader/MapData";
import { LocAnimated } from "./loc/LocAnimated";
import { MapSquareInfo } from "./MapManager";
import { Npc } from "./npc/Npc";
import { FrameStats, Renderer } from "./Renderer";
import { RendererStats } from "./webgl/RendererStats";

interface ColorRgb {
    r: number;
    g: number;
    b: number;
}

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

export interface RendererMapSquare {
    readonly id: number;

    readonly mapX: number;
    readonly mapY: number;
    readonly borderSize: number;

    readonly collisionMaps: CollisionMap[];

    // Animated locs
    readonly locsAnimated: LocAnimated[];

    // Npcs
    readonly npcs: Npc[];

    canRender(frameCount: number): boolean;
    delete(): void;
}

export abstract class MapRenderer<T extends RendererMapSquare, U extends MapData> implements Renderer {
    stats = new FrameStats();
    rendererStats = new RendererStats();

    cache: LoadedCache;

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

    renderDistance: number;
    unloadDistance: number;
    lodDistance: number;

    visibleMapCount: number = 0;
    visibleMaps: MapSquareInfo[] = []

    npcRenderCount: number = 0;

    constructor(cache: LoadedCache, renderDistance: number,
        unloadDistance: number, lodDistance: number) {
        this.cache = cache;
        this.renderDistance = renderDistance;
        this.unloadDistance = unloadDistance;
        this.lodDistance = lodDistance;
    }

    abstract getViewportDimensions(): {width: number, height: number};

    abstract init(canvas: HTMLCanvasElement): Promise<void>;

    abstract initCache(): void;

    abstract cleanUp(): void;

    abstract render(time: number, deltaTime: number, resized: boolean): void;

    abstract onResize(width: number, height: number): void;

    abstract onFrameEnd(): void;

    // Maps
    getMap(mapId: number): RendererMapSquare|undefined {
        return this.loadedMaps.get(mapId)
    }

    addMap(mapData: U): void {
        this.mapsToLoad.push(mapData);
    }

    removeMap(mapInfo: MapSquareInfo) {
        let map = this.loadedMaps.get(mapInfo.mapId);
        if (map) {
            map.delete();
            this.loadedMaps.delete(mapInfo.mapId);
        }
    }

    clearMaps(): void {
        this.mapsToLoad.clear();
    }

    // Maps data
    abstract loadMapData(mapX: number, mapY: number): Promise<U | undefined>;

    isValidMapData(mapData: U): boolean {
        return (
            mapData.cacheName === this.cache.info.name &&
            mapData.maxLevel === this.maxLevel &&
            mapData.loadObjs === this.loadObjs &&
            mapData.loadNpcs === this.loadNpcs &&
            mapData.smoothTerrain === this.smoothTerrain
        );
    }

    abstract addNpcRenderData(map: RendererMapSquare): void;

    // Textures
    abstract updateTextureFiltering(): void;

    getControls(): Schema {
        return {
            "Max Level": {
                value: this.maxLevel,
                min: 0,
                max: 3,
                step: 1,
                onChange: (v: number) => {
                    this.setMaxLevel(v);
                },
            },
            Sky: {
                r: this.skyColor[0] * 255,
                g: this.skyColor[1] * 255,
                b: this.skyColor[2] * 255,
                onChange: (v: ColorRgb) => {
                    this.setSkyColor(v.r, v.g, v.b);
                },
            },
            "Fog Depth": {
                value: this.fogDepth,
                min: 0,
                max: 256,
                step: 8,
                onChange: (v: number) => {
                    this.fogDepth = v;
                },
            },
            Brightness: {
                value: 1,
                min: 0,
                max: 4,
                step: 1,
                onChange: (v: number) => {
                    this.brightness = 1.0 - v * 0.1;
                },
            },
            "Color Banding": {
                value: 50,
                min: 0,
                max: 100,
                step: 1,
                onChange: (v: number) => {
                    this.colorBanding = 255 - v * 2;
                },
            },
            "Texture Filtering": {
                value: this.textureFilterMode,
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
                    if (v === this.textureFilterMode) {
                        return;
                    }
                    this.textureFilterMode = v;
                    this.updateTextureFiltering();
                },
            },
            "Smooth Terrain": {
                value: this.smoothTerrain,
                onChange: (v: boolean) => {
                    this.setSmoothTerrain(v);
                },
            },
            "Cull Back-faces": {
                value: this.cullBackFace,
                onChange: (v: boolean) => {
                    this.cullBackFace = v;
                },
            },
            "Anti-Aliasing": folder(
                {
                    MSAA: {
                        value: this.msaaEnabled,
                        onChange: (v: boolean) => {
                            this.setMsaa(v);
                        },
                    },
                    FXAA: {
                        value: this.fxaaEnabled,
                        onChange: (v: boolean) => {
                            this.setFxaa(v);
                        },
                    },
                },
                { collapsed: true },
            ),
            Entity: folder(
                {
                    Items: {
                        value: this.loadObjs,
                        onChange: (v: boolean) => {
                            this.setLoadObjs(v);
                        },
                    },
                    Npcs: {
                        value: this.loadNpcs,
                        onChange: (v: boolean) => {
                            this.setLoadNpcs(v);
                        },
                    },
                },
                { collapsed: true },
            ),
        };
    }


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
}