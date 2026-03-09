import { RendererMainLoop } from "../components/renderer/RendererMainLoop";
import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";
import type { MenuActionTarget, ObjActionTargetInstance } from "../rs/MenuEntry";
import {
    type MapData,
    type SdMapLoaderInput,
} from "../maprender/MapRenderPayload";
import type { LocType } from "../rs/config/loctype/LocType";
import type { NpcType } from "../rs/config/npctype/NpcType";
import type { ObjType } from "../rs/config/objtype/ObjType";
import { InteractType } from "../runtime/InteractType";
import { MapRenderer, MapSquareRenderable } from "../renderer/MapRenderer";
import { createRendererTexturePolicy } from "../rs/cache/CacheInfo";
import type { CacheSession } from "../rs/loaders/CacheSession";
import { WebGLMapRenderer } from "../renderer/webgl/WebGLMapRenderer";
import { MenuTargetType } from "../rs/MenuEntry";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { SceneBuilder } from "../rs/scene/SceneBuilder";
import { INTERACTION_RADIUS } from "../renderer/InteractionState";
import type { StaticMapPacket } from "../shared/StaticMapPacket";
import {
    collectInteractionHits,
    resolveWorldInteractionTargets,
    type InteractionHit,
    type WorldInteractionTarget,
} from "../runtime/InteractionTargets";
import {
    type RenderFrameSeamSample,
    type RenderFrameCoordinator,
} from "../renderer/RenderFrameCoordinator";
import {
    resolveRenderFrameNpcInteractionTarget,
    type RenderFramePacket,
} from "../renderer/RenderFramePacket";
import { isTouchDevice } from "../util/DeviceUtil";
import { InputManager } from "../util/InputManager";
import { clamp } from "../util/MathUtil";
import {
    type WorldInput,
    type WorldLocReplacement,
    type WorldLocReplacementClear,
    type WorldSession,
} from "../world/WorldSession";
import { Camera } from "../renderer/Camera";
import { RenderDataWorkerPool } from "../worker/RenderDataWorkerPool";
import { SimWorkerPool } from "../worker/SimWorkerPool";
import { MapManager, MapSquareInfo } from "./MapManager";
import { MapViewer } from "./MapViewer";
import { RenderTickCoordinator } from "./RenderTickCoordinator";
import type {
    WorldLocAnimationReset,
    WorldLocVisibilityChange,
} from "../world/WorldDeltaPacket";
import type { LocAnimatedData } from "../runtime/LocAnimatedData";

type MenuInteractionTarget =
    | Readonly<{
          kind: InteractType.LOC;
          hit: InteractionHit & { kind: InteractType.LOC };
          locType: LocType;
          locInstance?: Readonly<{
              mapId: number;
              locIndex: number;
          }>;
      }>
    | Readonly<{
          kind: InteractType.OBJ;
          hit: InteractionHit & { kind: InteractType.OBJ };
          objType: ObjType;
          objInstance: ObjActionTargetInstance;
      }>
    | Readonly<{
          kind: InteractType.NPC;
          hit: InteractionHit & { kind: InteractType.NPC };
          npcType: NpcType;
          npcInstance: Readonly<{
              mapId: number;
              npcInstanceId: number;
          }>;
      }>;

function resolveMenuInteractionTargets(input: Readonly<{
    session: CacheSession;
    targets: ReadonlyArray<WorldInteractionTarget>;
    includeUnnamed: boolean;
}>): MenuInteractionTarget[] {
    const resolvedTargets: MenuInteractionTarget[] = [];

    for (const target of input.targets) {
        if (target.kind === InteractType.LOC) {
            const locResult = input.session.tryLoadLocType(target.locTypeId);
            if (!locResult.ok) {
                continue;
            }
            const locType = locResult.value;
            if (locType.name === "null" && !input.includeUnnamed) {
                continue;
            }
            resolvedTargets.push({
                kind: InteractType.LOC,
                hit: target.hit,
                locType,
                locInstance: target.locInstance,
            });
            continue;
        }

        if (target.kind === InteractType.OBJ) {
            const objResult = input.session.tryLoadObjType(target.objTypeId);
            if (!objResult.ok) {
                continue;
            }
            const objType = objResult.value;
            if (objType.name === "null" && !input.includeUnnamed) {
                continue;
            }
            resolvedTargets.push({
                kind: InteractType.OBJ,
                hit: target.hit,
                objType,
                objInstance: target.objInstance,
            });
            continue;
        }

        const npcResult = input.session.tryLoadNpcType(target.npcTypeId);
        if (!npcResult.ok) {
            continue;
        }
        let npcType = npcResult.value;
        if (npcType.transforms) {
            const transformed = npcType.transform(
                input.session.varManager,
                input.session.getNpcTypeLoader(),
            );
            if (!transformed) {
                continue;
            }
            npcType = transformed;
        }
        if (npcType.name === "null" && !input.includeUnnamed) {
            continue;
        }
        resolvedTargets.push({
            kind: InteractType.NPC,
            hit: target.hit,
            npcType,
            npcInstance: target.npcInstance,
        });
    }

    return resolvedTargets;
}

function getMenuActionTarget(target: MenuInteractionTarget): MenuActionTarget {
    if (target.kind === InteractType.LOC) {
        return {
            kind: MenuTargetType.LOC,
            locTypeId: target.locType.id | 0,
            locInstance: target.locInstance,
        };
    }
    if (target.kind === InteractType.OBJ) {
        return {
            kind: MenuTargetType.OBJ,
            objTypeId: target.objType.id | 0,
            objInstance: target.objInstance,
        };
    }
    return {
        kind: MenuTargetType.NPC,
        npcTypeId: target.npcType.id | 0,
        npcInstance: target.npcInstance,
    };
}

type MapViewerStaticMapRuntimeDeps = Readonly<{
    worldSession: WorldSession;
    renderFrameCoordinator: RenderFrameCoordinator;
    loadStaticMapPacket(mapX: number, mapY: number): Promise<StaticMapPacket | undefined>;
    isValidMapPacket(packet: StaticMapPacket): boolean;
    detachLoadedMapRuntime(mapId: number): void;
    finalizeLoadedMap(packet: StaticMapPacket): Promise<void>;
}>;

class MapViewerStaticMapRuntime {
    constructor(private readonly deps: MapViewerStaticMapRuntimeDeps) {}

    async applyPacket(
        packet: StaticMapPacket,
        input: Readonly<{
            activationVersion: number;
            replaceMapId?: number;
            invalidateLatestPacket?: boolean;
        }>,
    ): Promise<boolean> {
        const replaceMapId = input.replaceMapId;
        if (replaceMapId !== undefined) {
            this.deps.detachLoadedMapRuntime(replaceMapId);
        }
        try {
            const ok = await this.deps.worldSession.activateLoadedMap({
                staticMap: packet,
                activationVersion: input.activationVersion,
            });
            if (!ok) {
                return false;
            }
        } catch (error: unknown) {
            const { mapX, mapY } = packet.mapData;
            const action = replaceMapId !== undefined ? "reload" : "register";
            console.warn(
                `[map-render] failed to ${action} worker sim state for ${mapX},${mapY}`,
                error,
            );
            return false;
        }

        await this.deps.finalizeLoadedMap(packet);
        if (input.invalidateLatestPacket === true) {
            this.deps.renderFrameCoordinator.invalidateLatestPacket();
        }
        return true;
    }

    async reloadMap(mapId: number): Promise<boolean> {
        const normalizedMapId = mapId | 0;
        const mapX = (normalizedMapId >> 8) & 0xff;
        const mapY = normalizedMapId & 0xff;
        const staticMapPacket = await this.deps.loadStaticMapPacket(mapX, mapY);
        if (!staticMapPacket || !this.deps.isValidMapPacket(staticMapPacket)) {
            return false;
        }
        return await this.applyPacket(staticMapPacket, {
            activationVersion: this.deps.worldSession.captureActivationVersion(),
            replaceMapId: normalizedMapId,
            invalidateLatestPacket: true,
        });
    }
}

export class MapViewerRenderer extends RendererMainLoop {
    private static readonly EMPTY_INT32 = new Int32Array(0);

    inputManager: InputManager;
    renderWorkerPool: RenderDataWorkerPool;
    simWorkerPool: SimWorkerPool;

    camera: Camera;

    mapManager: MapManager;
    mapManagerTime: number = 0;

    renderer: MapRenderer<MapSquareRenderable, MapData>;
    private readonly renderTickCoordinator = new RenderTickCoordinator();
    private readonly renderFrameCoordinator: RenderFrameCoordinator;
    private readonly worldSession: WorldSession;
    private readonly staticMapRuntime: MapViewerStaticMapRuntime;
    private visibleMapIdsScratch: Int32Array = MapViewerRenderer.EMPTY_INT32;
    private readonly animatedLocsByMapId: Map<number, ReadonlyArray<LocAnimatedData>> = new Map();
    private readonly objInteractionStateByMapId = new Map<
        number,
        Readonly<{
            staticObjTypeIds?: Int32Array;
            dynamicObjTypeIds?: Int32Array;
            dynamicRuntimeObjIds?: Int32Array;
        }>
    >();
    private seamSampleCount: number = 0;
    private seamWorldMsTotal: number = 0;
    private seamApplyWorldMsTotal: number = 0;
    private seamRenderMsTotal: number = 0;
    private seamTotalMsTotal: number = 0;
    private seamWorldChangeCountTotal: number = 0;
    private latestRenderFramePacket: RenderFramePacket | undefined;

    private isInitialized: boolean = false;

    private createRenderer(): MapRenderer<MapSquareRenderable, MapData> {
        const texturePolicy = createRendererTexturePolicy(this.mapViewer.session.cache.info);
        return new WebGLMapRenderer(
            {
                cacheName: this.mapViewer.session.cache.info.name,
                textureLoader: this.mapViewer.session.loaders.textureLoader,
                isNewTextureAnim: texturePolicy.isNewTextureAnim,
                maxTexturePreloadCount: texturePolicy.maxTexturePreloadCount,
            },
            this.mapViewer.renderDistance,
            this.mapViewer.unloadDistance,
            this.mapViewer.lodDistance,
            this.camera,
            this.checkInteractions.bind(this),
        );
    }

    private createMapManager(): MapManager {
        return new MapManager(
            this.renderWorkerPool.size * 2,
            this.queueLoadMap.bind(this),
            this.removeLoadedMap.bind(this),
        );
    }

    private getVisibleMapIdsPacked(): Int32Array {
        const count = this.mapManager.visibleMapCount | 0;
        if ((count | 0) <= 0) {
            return MapViewerRenderer.EMPTY_INT32;
        }
        if ((this.visibleMapIdsScratch.length | 0) !== (count | 0)) {
            this.visibleMapIdsScratch = new Int32Array(count);
        }
        for (let i = 0; i < count; i++) {
            this.visibleMapIdsScratch[i] = this.mapManager.visibleMaps[i]!.mapId | 0;
        }
        return this.visibleMapIdsScratch;
    }

    getVisibleMapIdsPackedForFrameCoordinator(): Int32Array {
        return this.getVisibleMapIdsPacked();
    }

    constructor(
        public mapViewer: MapViewer,
        worldSession: WorldSession,
        renderFrameCoordinator: RenderFrameCoordinator,
    ) {
        super();
        this.inputManager = mapViewer.inputManager;
        this.renderWorkerPool = mapViewer.renderWorkerPool;
        this.simWorkerPool = mapViewer.simWorkerPool;
        this.camera = mapViewer.camera;
        this.renderer = this.createRenderer();
        this.renderFrameCoordinator = renderFrameCoordinator;
        this.worldSession = worldSession;
        this.mapManager = this.createMapManager();
        this.staticMapRuntime = new MapViewerStaticMapRuntime({
            worldSession: this.worldSession,
            renderFrameCoordinator: this.renderFrameCoordinator,
            loadStaticMapPacket: this.loadStaticMapPacket.bind(this),
            isValidMapPacket: (packet) => this.renderer.isValidMapData(packet.mapData),
            detachLoadedMapRuntime: this.detachLoadedMapRuntime.bind(this),
            finalizeLoadedMap: this.finalizeLoadedMap.bind(this),
        });
    }

    private async loadStaticMapPacket(
        mapX: number,
        mapY: number,
    ): Promise<StaticMapPacket | undefined> {
        const r = this.renderer;
        const mapId = getMapSquareId(mapX, mapY);
        const input: SdMapLoaderInput = {
            mapX,
            mapY,
            maxLevel: r.maxLevel,
            loadObjs: r.loadObjs,
            loadNpcs: r.loadNpcs,
            loadLocs: r.loadLocs,
            smoothTerrain: r.smoothTerrain,
            minimizeDrawCalls: !r.hasMultiDraw,
            loadedTextureIds: Int32Array.from(r.loadedTextureIds),
            locPlacementOverrides: this.worldSession.getLocPlacementOverrides(mapId | 0),
        };
        return await this.renderWorkerPool.build.loadStaticMapPacket(input);
    }

    private recordRenderFrameSeamSample(sample: RenderFrameSeamSample): void {
        if (!this.mapViewer.getWorkerRuntimeOptions().mapRenderTelemetry) {
            return;
        }
        this.seamSampleCount = (this.seamSampleCount + 1) | 0;
        this.seamWorldMsTotal += sample.worldMs;
        this.seamApplyWorldMsTotal += sample.applyWorldMs;
        this.seamRenderMsTotal += sample.renderMs;
        this.seamTotalMsTotal += sample.totalMs;
        this.seamWorldChangeCountTotal += sample.worldChangeCount | 0;
        if ((this.seamSampleCount | 0) < 120) {
            return;
        }
        const count = this.seamSampleCount | 0;
        console.log("[map-render][frame-seam] avg", {
            samples: count,
            worldMs: this.seamWorldMsTotal / count,
            applyWorldMs: this.seamApplyWorldMsTotal / count,
            renderMs: this.seamRenderMsTotal / count,
            totalMs: this.seamTotalMsTotal / count,
            worldChangesPerFrame: this.seamWorldChangeCountTotal / count,
        });
        this.seamSampleCount = 0;
        this.seamWorldMsTotal = 0;
        this.seamApplyWorldMsTotal = 0;
        this.seamRenderMsTotal = 0;
        this.seamTotalMsTotal = 0;
        this.seamWorldChangeCountTotal = 0;
    }

    reportRenderFrameSeamSample(sample: RenderFrameSeamSample): void {
        this.recordRenderFrameSeamSample(sample);
    }

    private shouldDropStaticMapPacketForDevSquare(
        staticMapPacket: StaticMapPacket | undefined,
    ): boolean {
        const devsq = this.mapViewer.getDevFixedMapSquare();
        if (
            !devsq ||
            !staticMapPacket ||
            (staticMapPacket.mapData.mapX === devsq.mapX &&
                staticMapPacket.mapData.mapY === devsq.mapY)
        ) {
            return false;
        }
        this.mapManager.loadingMapIds.delete(
            getMapSquareId(staticMapPacket.mapData.mapX, staticMapPacket.mapData.mapY),
        );
        return true;
    }

    private logMapPacketTelemetry(packet: StaticMapPacket): void {
        const mapData = packet.mapData;
        const runtimeRegistration = packet.runtimeRegistration;
        const runtimeBootstrap = packet.runtimeBootstrap;
        const ranges = mapData.drawRanges.base;
        const drawCount = Math.floor((ranges?.length ?? 0) / 3);
        let nonZero = 0;
        if (ranges instanceof Int32Array) {
            for (let i = 0; i < drawCount; i++) {
                const off = i * 3;
                if ((ranges[off + 1] | 0) > 0) {
                    nonZero++;
                }
            }
        }
        console.log("[map-render][telemetry] map packet summary", {
            square: `${mapData.mapX}:${mapData.mapY}`,
            verts: mapData.vertices?.length ?? -1,
            indices: mapData.indices?.length ?? -1,
            drawRangesBaseCount: drawCount,
            drawRangesBaseNonZero: nonZero,
            loadObjs: mapData.loadObjs,
            loadLocs: mapData.loadLocs,
            loadNpcs: mapData.loadNpcs,
            locsAnimated: runtimeRegistration.locsAnimated.length,
            npcVerts: mapData.npcVertices?.length ?? 0,
            npcIndices: mapData.npcIndices?.length ?? 0,
            npcRangesBase: mapData.npcDrawRangesBase?.length ?? 0,
            npcOrderKeys: runtimeBootstrap.npcOrderKeys.length | 0,
            npcTypeAnimTable: runtimeRegistration.npcTypeAnimationTable.length,
        });
    }

    private async finalizeLoadedMap(packet: StaticMapPacket): Promise<void> {
        const mapData = packet.mapData;
        this.animatedLocsByMapId.set(mapData.mapId | 0, packet.runtimeRegistration.locsAnimated);
        this.setMapObjInteractionState(mapData.mapId | 0, {
            staticObjTypeIds: packet.runtimeBootstrap.mapObjState?.staticState?.objTypeIds,
            dynamicObjTypeIds: undefined,
            dynamicRuntimeObjIds: undefined,
        });
        this.mapManager.addMap(mapData.mapX, mapData.mapY);
        this.renderer.addMap(mapData);
        await this.attachLoadedRuntimeMapObjRenderData(packet);
        if (mapData.minimapBlob.size > 0) {
            this.mapViewer.setMapImageUrl(
                mapData.mapX,
                mapData.mapY,
                URL.createObjectURL(mapData.minimapBlob),
                true,
                false,
            );
            return;
        }
        void this.renderWorkerPool.build
            .loadMapImage(mapData.mapX, mapData.mapY, 0, false)
            .then((minimapData) => {
                if (!minimapData || minimapData.minimapBlob.size <= 0) {
                    return;
                }
                this.mapViewer.setMapImageUrl(
                    mapData.mapX,
                    mapData.mapY,
                    URL.createObjectURL(minimapData.minimapBlob),
                    true,
                    false,
                );
            })
            .catch(() => {
                // Ignore minimap warmup failures; map render path is still valid.
            });
    }

    private detachLoadedMapRuntime(mapId: number): void {
        const normalizedMapId = mapId | 0;
        this.animatedLocsByMapId.delete(normalizedMapId);
        this.objInteractionStateByMapId.delete(normalizedMapId);
        this.renderer.removeMap({ mapId: normalizedMapId });
        this.worldSession.deactivateLoadedMap({ mapId: normalizedMapId });
    }

    async queueLoadMap(mapX: number, mapY: number): Promise<void> {
        const queuedActivationVersion = this.worldSession.captureActivationVersion();
        const devsq = this.mapViewer.getDevFixedMapSquare();
        if (devsq && (mapX !== devsq.mapX || mapY !== devsq.mapY)) {
            // Fixed-square dev mode: never queue builds for other squares.
            return;
        }
        const staticMapPacket = await this.loadStaticMapPacket(mapX, mapY);
        if (!this.worldSession.isActivationVersionCurrent(queuedActivationVersion)) {
            return;
        }
        if (this.shouldDropStaticMapPacketForDevSquare(staticMapPacket)) {
            return;
        }
        if (!staticMapPacket) {
            this.mapManager.addInvalidMap(mapX, mapY);
            return;
        }
        if (!this.renderer.isValidMapData(staticMapPacket.mapData)) {
            return;
        }
        if (this.mapViewer.getWorkerRuntimeOptions().mapRenderTelemetry) {
            this.logMapPacketTelemetry(staticMapPacket);
        }
        const ok = await this.staticMapRuntime.applyPacket(staticMapPacket, {
            activationVersion: queuedActivationVersion,
        });
        if (!ok) {
            this.mapManager.addInvalidMap(staticMapPacket.mapData.mapX, staticMapPacket.mapData.mapY);
            return;
        }
    }

    async removeLoadedMap(mapInfo: MapSquareInfo): Promise<void> {
        this.detachLoadedMapRuntime(mapInfo.mapId);
    }

    async applyWorldInput(input: WorldInput): Promise<number> {
        const result = await this.worldSession.applyWorldInput(input);
        const applied = result.applied | 0;
        if ((applied | 0) > 0) {
            this.applyMapObjTypeIdsFromWorldInput(input);
        }
        const objStaticInput = input.obj?.static;
        const objDynamicInput = input.obj?.dynamic;
        const locAnimationInput = input.loc?.animation;
        const locStateInput = input.loc?.state;
        const reloadMapIds = result.reloadMapIds;
        if ((applied | 0) > 0 && reloadMapIds && (reloadMapIds.length | 0) > 0) {
            for (let index = 0; index < reloadMapIds.length; index++) {
                const sourceMapId = reloadMapIds[index];
                if (sourceMapId === undefined) {
                    continue;
                }
                if (!this.mapManager.mapSquares.has(sourceMapId | 0)) {
                    continue;
                }
                await this.staticMapRuntime.reloadMap(sourceMapId | 0);
            }
        }
        const hasRenderAffectingWorldInput =
            (!!objStaticInput?.stateReplacements &&
                (objStaticInput.stateReplacements.length | 0) > 0) ||
            (!!objStaticInput?.additions && (objStaticInput.additions.length | 0) > 0) ||
            (!!objStaticInput?.removals && (objStaticInput.removals.length | 0) > 0) ||
            (!!objDynamicInput?.dynamicSpawns && (objDynamicInput.dynamicSpawns.length | 0) > 0) ||
            (!!objDynamicInput?.dynamicDespawns &&
                (objDynamicInput.dynamicDespawns.length | 0) > 0) ||
            (!!objDynamicInput?.dynamicUpdates &&
                (objDynamicInput.dynamicUpdates.length | 0) > 0) ||
            (!!objDynamicInput?.clearDynamicMaps &&
                (objDynamicInput.clearDynamicMaps.length | 0) > 0) ||
            (!!locStateInput?.visibilityChanges &&
                (locStateInput.visibilityChanges.length | 0) > 0) ||
            (!!locStateInput?.replacements && (locStateInput.replacements.length | 0) > 0) ||
            (!!locStateInput?.replacementClears &&
                (locStateInput.replacementClears.length | 0) > 0) ||
            (!!locAnimationInput?.animationResets &&
                (locAnimationInput.animationResets.length | 0) > 0) ||
            (!!locAnimationInput?.animationPauseStates &&
                (locAnimationInput.animationPauseStates.length | 0) > 0);
        if ((applied | 0) > 0 && hasRenderAffectingWorldInput) {
            this.renderFrameCoordinator.invalidateLatestPacket();
        }
        return applied | 0;
    }

    private async attachLoadedRuntimeMapObjRenderData(
        packet: StaticMapPacket,
    ): Promise<void> {
        await this.applyWorldInput({
            obj: {
                static: {
                    stateReplacements: [
                        {
                            kind: "replaceState",
                            mapId: packet.mapData.mapId | 0,
                            mapObjState: packet.runtimeBootstrap.mapObjState,
                        },
                    ],
                },
            },
        });
    }

    async resetVisibleLocAnimations(): Promise<number> {
        const animationResets: WorldLocAnimationReset[] = [];
        const visibleMapCount = this.mapManager.visibleMapCount | 0;
        for (let i = 0; i < visibleMapCount; i++) {
            const mapInfo = this.mapManager.visibleMaps[i];
            if (!mapInfo) {
                continue;
            }
            const animatedLocs = this.animatedLocsByMapId.get(mapInfo.mapId);
            const animatedLocCount = animatedLocs?.length ?? 0;
            for (let locIndex = 0; locIndex < (animatedLocCount | 0); locIndex++) {
                animationResets.push({
                    mapId: mapInfo.mapId | 0,
                    locIndex: locIndex | 0,
                });
            }
        }
        if ((animationResets.length | 0) <= 0) {
            return 0;
        }
        return await this.applyWorldInput({
            loc: {
                animation: {
                    animationResets,
                },
            },
        });
    }

    async restoreVisibleGroundItems(): Promise<number> {
        const additions: Array<Readonly<{ mapId: number; objIndex: number }>> = [];
        const visibleMapCount = this.mapManager.visibleMapCount | 0;
        for (let i = 0; i < visibleMapCount; i++) {
            const mapInfo = this.mapManager.visibleMaps[i];
            if (!mapInfo) {
                continue;
            }
            const objTypeIds = this.objInteractionStateByMapId.get(mapInfo.mapId | 0)?.staticObjTypeIds;
            if (!(objTypeIds instanceof Int32Array) || (objTypeIds.length | 0) <= 0) {
                continue;
            }
            for (let objIndex = 0; objIndex < objTypeIds.length; objIndex++) {
                if ((objTypeIds[objIndex] | 0) < 0) {
                    continue;
                }
                additions.push({
                    mapId: mapInfo.mapId | 0,
                    objIndex: objIndex | 0,
                });
            }
        }
        if ((additions.length | 0) <= 0) {
            return 0;
        }
        return await this.applyWorldInput({
            obj: {
                static: {
                    additions,
                },
            },
        });
    }

    async spawnGroundItemAtCamera(objTypeId: number, count: number): Promise<number> {
        return await this.applyWorldInput({
            obj: {
                dynamic: {
                    dynamicSpawns: [
                        {
                            mapId: getMapSquareId(
                                this.camera.getMapX() >> 6,
                                this.camera.getMapY() >> 6,
                            ),
                            objTypeId: objTypeId | 0,
                            count: Math.max(1, count | 0),
                            x: this.camera.getMapX() | 0,
                            y: this.camera.getMapY() | 0,
                            plane: 0,
                        },
                    ],
                },
            },
        });
    }

    async clearVisibleDynamicGroundItems(): Promise<number> {
        const clearDynamicMaps: number[] = [];
        const visibleMapCount = this.mapManager.visibleMapCount | 0;
        for (let i = 0; i < visibleMapCount; i++) {
            const mapInfo = this.mapManager.visibleMaps[i];
            if (!mapInfo) {
                continue;
            }
            clearDynamicMaps.push(mapInfo.mapId | 0);
        }
        if ((clearDynamicMaps.length | 0) <= 0) {
            return 0;
        }
        return await this.applyWorldInput({
            obj: {
                dynamic: {
                    clearDynamicMaps,
                },
            },
        });
    }

    override async init() {
        super.init();
        this.inputManager.init(this.canvas);
        this.isInitialized = true;
    }

    initializeCacheState(): void {
        this.animatedLocsByMapId.clear();
        this.objInteractionStateByMapId.clear();
        this.latestRenderFramePacket = undefined;
        this.renderer.initCache();
        this.mapManager.init(
            this.mapViewer.session.mapFileIndex,
            SceneBuilder.fillEmptyTerrain(this.mapViewer.session.cache.info),
        );
        const devsq = this.mapViewer.getDevFixedMapSquare();
        if (devsq) {
            this.mapManager.setFixedMapSquare(devsq.mapX, devsq.mapY);
        } else {
            this.mapManager.clearFixedMapSquare();
        }
        this.mapManager.update(
            this.camera,
            this.renderer.stats.frameCount,
            this.renderer.renderDistance,
            this.renderer.unloadDistance,
        );
    }

    private pauseLoop(): boolean {
        const wasRunning = this.running;
        this.running = false;
        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
        return wasRunning;
    }

    private resumeLoop(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.renderTickCoordinator.requestClockResync();
        this.animationId = requestAnimationFrame(this.frameCallback);
    }

    private async recreateRendererAndMapManager(): Promise<void> {
        this.renderer = this.createRenderer();
        this.mapManager = this.createMapManager();

        if (this.isInitialized) {
            await this.renderer.init(this.canvas);
        }
    }

    async resetForCacheContext(): Promise<void> {
        const wasRunning = this.pauseLoop();
        this.worldSession.reset();
        this.latestRenderFramePacket = undefined;

        try {
            await this.renderer.cleanUp();
            this.renderTickCoordinator.resetForCacheContext(this.renderFrameCoordinator);
            this.mapManager.cleanUp();
            await this.recreateRendererAndMapManager();
            this.initializeCacheState();
        } finally {
            if (wasRunning) {
                this.resumeLoop();
            }
        }
    }

    override async cleanUp(): Promise<void> {
        await super.cleanUp();
        this.animatedLocsByMapId.clear();
        this.objInteractionStateByMapId.clear();
        this.latestRenderFramePacket = undefined;
        this.worldSession.reset();
        this.renderTickCoordinator.resetForShutdown(this.renderFrameCoordinator);
        this.inputManager.cleanUp();
        this.mapManager.cleanUp();
    }

    private getAnimatedLocTypeId(mapId: number, locIndex: number): number | undefined {
        const animatedLocs = this.animatedLocsByMapId.get(mapId | 0);
        return animatedLocs?.[locIndex | 0]?.locTypeId;
    }

    private getAnimatedLocData(mapId: number, locIndex: number): LocAnimatedData | undefined {
        const animatedLocs = this.animatedLocsByMapId.get(mapId | 0);
        return animatedLocs?.[locIndex | 0];
    }

    private setMapObjInteractionState(
        mapId: number,
        state:
            | Readonly<{
                  staticObjTypeIds?: Int32Array;
                  dynamicObjTypeIds?: Int32Array;
                  dynamicRuntimeObjIds?: Int32Array;
              }>
            | undefined,
    ): void {
        if (!state || (!state.staticObjTypeIds && !state.dynamicObjTypeIds)) {
            this.objInteractionStateByMapId.delete(mapId | 0);
            return;
        }
        this.objInteractionStateByMapId.set(mapId | 0, state);
    }

    private applyMapObjTypeIdsFromWorldInput(input: WorldInput): void {
        const stateReplacements = input.obj?.static?.stateReplacements;
        if (!stateReplacements) {
            return;
        }
        for (let index = 0; index < stateReplacements.length; index++) {
            const update = stateReplacements[index];
            if (!update || update.kind !== "replaceState") {
                continue;
            }
            const mapObjState = update.mapObjState;
            const current = this.objInteractionStateByMapId.get(update.mapId | 0);
            this.setMapObjInteractionState(update.mapId | 0, {
                staticObjTypeIds:
                    mapObjState && "staticState" in mapObjState
                        ? mapObjState.staticState?.objTypeIds
                        : current?.staticObjTypeIds,
                dynamicObjTypeIds: current?.dynamicObjTypeIds,
                dynamicRuntimeObjIds: current?.dynamicRuntimeObjIds,
            });
        }
    }

    private getMapObjTargetInfo(
        mapId: number,
        interactId: number,
    ):
        | Readonly<
              | {
                    kind: "static";
                    objTypeId: number;
                    objIndex: number;
                }
              | {
                    kind: "dynamic";
                    objTypeId: number;
                    runtimeObjId: number;
                }
          >
        | undefined {
        const state = this.objInteractionStateByMapId.get(mapId | 0);
        const staticObjTypeId = state?.staticObjTypeIds?.[interactId | 0];
        if (staticObjTypeId !== undefined && (staticObjTypeId | 0) >= 0) {
            return {
                kind: "static",
                objTypeId: staticObjTypeId | 0,
                objIndex: interactId | 0,
            };
        }
        const dynamicObjTypeId = state?.dynamicObjTypeIds?.[interactId | 0];
        const runtimeObjId = state?.dynamicRuntimeObjIds?.[interactId | 0];
        if (
            dynamicObjTypeId !== undefined &&
            runtimeObjId !== undefined &&
            (dynamicObjTypeId | 0) >= 0 &&
            (runtimeObjId | 0) >= 0
        ) {
            return {
                kind: "dynamic",
                objTypeId: dynamicObjTypeId | 0,
                runtimeObjId: runtimeObjId | 0,
            };
        }
        return undefined;
    }

    private ensureInt32Length(values: Int32Array | undefined, minLength: number): Int32Array {
        if ((minLength | 0) <= 0) {
            return values ?? MapViewerRenderer.EMPTY_INT32;
        }
        if (values instanceof Int32Array && (values.length | 0) >= (minLength | 0)) {
            return values;
        }
        const next = new Int32Array(minLength | 0);
        next.fill(-1);
        if (values instanceof Int32Array) {
            next.set(values.subarray(0, Math.min(values.length | 0, minLength | 0)));
        }
        return next;
    }

    private applyMapObjInteractionStateUpdate(
        mapId: number,
        update: NonNullable<RenderFramePacket["runtimeRenderUpdates"]>["updates"][number],
    ): void {
        if (!update) {
            return;
        }
        const current = this.objInteractionStateByMapId.get(mapId | 0);
        let staticObjTypeIds = update.replaceStaticObjRenderData
            ? update.staticObjRenderData?.objTypeIds
            : current?.staticObjTypeIds;
        let dynamicObjTypeIds = current?.dynamicObjTypeIds;
        let dynamicRuntimeObjIds = current?.dynamicRuntimeObjIds;

        if (update.clearDynamicObjRenderData) {
            dynamicObjTypeIds = undefined;
            dynamicRuntimeObjIds = undefined;
        }
        if (update.removeDynamicRuntimeObjIdsPacked && dynamicRuntimeObjIds && dynamicObjTypeIds) {
            const nextDynamicObjTypeIds = dynamicObjTypeIds.slice();
            const nextDynamicRuntimeObjIds = dynamicRuntimeObjIds.slice();
            for (let removeIndex = 0; removeIndex < update.removeDynamicRuntimeObjIdsPacked.length; removeIndex++) {
                const runtimeObjId = update.removeDynamicRuntimeObjIdsPacked[removeIndex] | 0;
                for (let index = 0; index < nextDynamicRuntimeObjIds.length; index++) {
                    if ((nextDynamicRuntimeObjIds[index] | 0) !== (runtimeObjId | 0)) {
                        continue;
                    }
                    nextDynamicRuntimeObjIds[index] = -1;
                    nextDynamicObjTypeIds[index] = -1;
                }
            }
            dynamicObjTypeIds = nextDynamicObjTypeIds;
            dynamicRuntimeObjIds = nextDynamicRuntimeObjIds;
        }
        if (update.appendDynamicObjRenders && (update.appendDynamicObjRenders.length | 0) > 0) {
            let nextDynamicObjTypeIds = dynamicObjTypeIds;
            let nextDynamicRuntimeObjIds = dynamicRuntimeObjIds;
            for (let appendIndex = 0; appendIndex < update.appendDynamicObjRenders.length; appendIndex++) {
                const append: (typeof update.appendDynamicObjRenders)[number] =
                    update.appendDynamicObjRenders[appendIndex];
                if (!append) {
                    continue;
                }
                const interactId = append.interactId | 0;
                nextDynamicObjTypeIds = this.ensureInt32Length(
                    nextDynamicObjTypeIds,
                    (interactId + 1) | 0,
                );
                nextDynamicRuntimeObjIds = this.ensureInt32Length(
                    nextDynamicRuntimeObjIds,
                    (interactId + 1) | 0,
                );
                nextDynamicObjTypeIds[interactId] =
                    append.objRenderData.objTypeIds[interactId] | 0;
                nextDynamicRuntimeObjIds[interactId] = append.runtimeObjId | 0;
            }
            dynamicObjTypeIds = nextDynamicObjTypeIds;
            dynamicRuntimeObjIds = nextDynamicRuntimeObjIds;
        }
        this.setMapObjInteractionState(mapId | 0, {
            staticObjTypeIds,
            dynamicObjTypeIds,
            dynamicRuntimeObjIds,
        });
    }

    private getNpcInteractionTargetInfo(
        mapId: number,
        npcInteractId: number,
    ): Readonly<{ npcInstanceId: number; npcTypeId: number }> | undefined {
        return resolveRenderFrameNpcInteractionTarget(
            this.latestRenderFramePacket,
            mapId | 0,
            npcInteractId | 0,
        );
    }

    private getLocInstanceFromMenuEntry(
        entry: Pick<OsrsMenuEntry, "actionTarget">,
    ): Readonly<{ mapId: number; locIndex: number }> | undefined {
        const actionTarget = entry.actionTarget;
        if (!actionTarget || actionTarget.kind !== MenuTargetType.LOC) {
            return undefined;
        }
        return actionTarget.locInstance;
    }

    private getNpcInstanceFromMenuEntry(
        entry: Pick<OsrsMenuEntry, "actionTarget">,
    ): Readonly<{ mapId: number; npcInstanceId: number }> | undefined {
        const actionTarget = entry.actionTarget;
        if (!actionTarget || actionTarget.kind !== MenuTargetType.NPC) {
            return undefined;
        }
        return actionTarget.npcInstance;
    }

    private onResetLocAnimation = (entry: OsrsMenuEntry) => {
        const locInstance = this.getLocInstanceFromMenuEntry(entry);
        this.mapViewer.closeMenu();
        if (!locInstance) {
            return;
        }
        void this.applyWorldInput({
            loc: {
                animation: {
                    animationResets: [locInstance],
                },
            },
        });
    };

    private onSetLocVisible(visible: boolean): (entry: OsrsMenuEntry) => void {
        return (entry) => {
            const locInstance = this.getLocInstanceFromMenuEntry(entry);
            this.mapViewer.closeMenu();
            if (!locInstance) {
                return;
            }
            const visibilityChanges: WorldLocVisibilityChange[] = [
                {
                    mapId: locInstance.mapId | 0,
                    locIndex: locInstance.locIndex | 0,
                    visible,
                },
            ];
            void this.applyWorldInput({
                loc: {
                    state: {
                        visibilityChanges,
                    },
                },
            });
        };
    }

    private onRotateLoc = (entry: OsrsMenuEntry) => {
        const locInstance = this.getLocInstanceFromMenuEntry(entry);
        this.mapViewer.closeMenu();
        if (!locInstance) {
            return;
        }
        const locData = this.getAnimatedLocData(locInstance.mapId | 0, locInstance.locIndex | 0);
        if (!locData || (locData.placementIndex | 0) < 0 || (locData.sourceMapId | 0) < 0) {
            return;
        }
        const replacements: WorldLocReplacement[] = [
            {
                sourceMapId: locData.sourceMapId | 0,
                placementIndex: locData.placementIndex | 0,
                locTypeId: locData.locTypeId | 0,
                locModelType: locData.locModelType,
                rotation: ((locData.rotation | 0) + 1) & 0x3,
            },
        ];
        void this.applyWorldInput({
            loc: {
                state: {
                    replacements,
                },
            },
        });
    };

    private onReplaceLoc = (entry: OsrsMenuEntry) => {
        const locInstance = this.getLocInstanceFromMenuEntry(entry);
        this.mapViewer.closeMenu();
        if (!locInstance) {
            return;
        }
        const replacementLocTypeId = this.mapViewer.getDevLocReplacementTypeId() | 0;
        if ((replacementLocTypeId | 0) <= 0) {
            return;
        }
        const locData = this.getAnimatedLocData(locInstance.mapId | 0, locInstance.locIndex | 0);
        if (!locData || (locData.placementIndex | 0) < 0 || (locData.sourceMapId | 0) < 0) {
            return;
        }
        const replacements: WorldLocReplacement[] = [
            {
                sourceMapId: locData.sourceMapId | 0,
                placementIndex: locData.placementIndex | 0,
                locTypeId: replacementLocTypeId,
                locModelType: locData.locModelType,
                rotation: locData.rotation | 0,
            },
        ];
        void this.applyWorldInput({
            loc: {
                state: {
                    replacements,
                },
            },
        });
    };

    private onResetLocOverride = (entry: OsrsMenuEntry) => {
        const locInstance = this.getLocInstanceFromMenuEntry(entry);
        this.mapViewer.closeMenu();
        if (!locInstance) {
            return;
        }
        const locData = this.getAnimatedLocData(locInstance.mapId | 0, locInstance.locIndex | 0);
        if (!locData || (locData.placementIndex | 0) < 0 || (locData.sourceMapId | 0) < 0) {
            return;
        }
        const replacementClears: WorldLocReplacementClear[] = [
            {
                sourceMapId: locData.sourceMapId | 0,
                placementIndex: locData.placementIndex | 0,
            },
        ];
        void this.applyWorldInput({
            loc: {
                state: {
                    replacementClears,
                },
            },
        });
    };

    private onSetLocAnimationPaused(paused: boolean): (entry: OsrsMenuEntry) => void {
        return (entry) => {
            const locInstance = this.getLocInstanceFromMenuEntry(entry);
            this.mapViewer.closeMenu();
            if (!locInstance) {
                return;
            }
            void this.applyWorldInput({
                loc: {
                    animation: {
                        animationPauseStates: [
                            {
                                mapId: locInstance.mapId | 0,
                                locIndex: locInstance.locIndex | 0,
                                paused,
                            },
                        ],
                    },
                },
            });
        };
    }

    private onDespawnNpc = (entry: OsrsMenuEntry) => {
        const npcInstance = this.getNpcInstanceFromMenuEntry(entry);
        this.mapViewer.closeMenu();
        if (!npcInstance) {
            return;
        }
        void this.applyWorldInput({
            npc: {
                events: [
                    {
                        kind: "despawn",
                        mapId: npcInstance.mapId | 0,
                        npcInstanceId: npcInstance.npcInstanceId | 0,
                        seq: 0x7fffffff,
                    },
                ],
            },
        });
    };

    private onRemoveGroundItem = (entry: OsrsMenuEntry) => {
        const actionTarget = entry.actionTarget;
        this.mapViewer.closeMenu();
        if (!actionTarget || actionTarget.kind !== MenuTargetType.OBJ) {
            return;
        }
        if (actionTarget.objInstance.kind === "dynamic") {
            void this.applyWorldInput({
                obj: {
                    dynamic: {
                        dynamicDespawns: [
                            {
                                mapId: actionTarget.objInstance.mapId | 0,
                                runtimeObjId: actionTarget.objInstance.runtimeObjId | 0,
                            },
                        ],
                    },
                },
            });
            return;
        }
        void this.applyWorldInput({
            obj: {
                static: {
                    removals: [
                        {
                            mapId: actionTarget.objInstance.mapId | 0,
                            objIndex: actionTarget.objInstance.objIndex | 0,
                        },
                    ],
                },
            },
        });
    };

    private onMoveDynamicGroundItemToCamera = (entry: OsrsMenuEntry) => {
        const actionTarget = entry.actionTarget;
        this.mapViewer.closeMenu();
        if (!actionTarget || actionTarget.kind !== MenuTargetType.OBJ) {
            return;
        }
        if (actionTarget.objInstance.kind !== "dynamic") {
            return;
        }
        void this.applyWorldInput({
            obj: {
                dynamic: {
                    dynamicUpdates: [
                        {
                            mapId: getMapSquareId(
                                this.camera.getMapX() >> 6,
                                this.camera.getMapY() >> 6,
                            ),
                            runtimeObjId: actionTarget.objInstance.runtimeObjId | 0,
                            objTypeId: actionTarget.objTypeId | 0,
                            count: 1,
                            x: this.camera.getMapX() | 0,
                            y: this.camera.getMapY() | 0,
                            plane: 0,
                        },
                    ],
                },
            },
        });
    };

    override update(time: number, deltaTime: number) {
        this.handleInput(deltaTime);

        const { width, height } = this.renderer.getViewportDimensions();
        this.camera.update(width, height);

        const renderDistance = this.renderer.renderDistance;
        const frameCount = this.renderer.stats.frameCount;

        const mapManagerStart = performance.now();
        this.mapManager.update(
            this.camera,
            frameCount,
            renderDistance,
            this.renderer.unloadDistance,
        );
        this.mapManagerTime = performance.now() - mapManagerStart;

        this.renderer.getInteractionControllerRenderer()?.setInteractionInput({
            pointerLocked: this.inputManager.isPointerLock(),
            mouseX: this.inputManager.mouseX,
            mouseY: this.inputManager.mouseY,
        });

        const timeSec = time / 1000;
        const renderTickState = this.renderTickCoordinator.advanceClocks(timeSec);

        const renderTickStart = performance.now();
        this.runRenderTick(
            renderTickState.cycle,
            renderTickState.ticksElapsed,
            renderTickState.clientTicksElapsed,
        );
        this.renderer.rendererStats.tickTime = performance.now() - renderTickStart;
    }

    private runRenderTick(cycle: number, ticksElapsed: number, clientTicksElapsed: number): void {
        this.renderTickCoordinator.applyTick({
            frameInput: {
                frameCount: this.renderer.stats.frameCount,
                cycle,
                ticksElapsed,
                clientTicksElapsed,
            },
            renderFrameCoordinator: this.renderFrameCoordinator,
            applyFramePacket: (packet) => {
                this.latestRenderFramePacket = packet;
                const objUpdates = packet?.runtimeRenderUpdates?.updates;
                if (objUpdates) {
                    for (let index = 0; index < objUpdates.length; index++) {
                        const update = objUpdates[index];
                        if (!update) {
                            continue;
                        }
                        this.applyMapObjInteractionStateUpdate(update.mapId | 0, update);
                    }
                }
                this.renderer.applyFramePacket(packet);
            },
        });
    }

    override render(time: number, deltaTime: number, resized: boolean) {
        super.render(time, deltaTime, resized);
    }

    handleInput(deltaTime: number) {
        this.handleKeyInput(deltaTime);
        this.handleMouseInput();
        this.handleJoystickInput(deltaTime);
    }

    handleKeyInput(deltaTime: number) {
        const deltaTimeSec = deltaTime / 1000;

        const inputManager = this.inputManager;
        const camera = this.mapViewer.camera;

        let cameraSpeedMult = 1.0;
        if (inputManager.isShiftDown()) {
            cameraSpeedMult = 10.0;
        }
        if (inputManager.isKeyDown("Tab")) {
            cameraSpeedMult = 0.1;
        }

        const deltaPitch = 64 * 5 * deltaTimeSec;
        const deltaYaw = 64 * 5 * deltaTimeSec;

        // camera direction controls
        if (inputManager.isKeyDown("ArrowUp")) {
            camera.updatePitch(camera.pitch, deltaPitch);
        }
        if (inputManager.isKeyDown("ArrowDown")) {
            camera.updatePitch(camera.pitch, -deltaPitch);
        }
        if (inputManager.isKeyDown("ArrowRight")) {
            camera.updateYaw(camera.yaw, deltaYaw);
        }
        if (inputManager.isKeyDown("ArrowLeft")) {
            camera.updateYaw(camera.yaw, -deltaYaw);
        }

        // camera position controls
        let deltaX = 0;
        let deltaY = 0;
        let deltaZ = 0;

        const deltaPos = 16 * (this.mapViewer.cameraSpeed * cameraSpeedMult) * deltaTimeSec;
        const deltaHeight = 8 * (this.mapViewer.cameraSpeed * cameraSpeedMult) * deltaTimeSec;

        if (inputManager.isKeyDown("KeyW")) {
            // Forward
            deltaZ -= deltaPos;
        }
        if (inputManager.isKeyDown("KeyA")) {
            // Left
            deltaX += deltaPos;
        }
        if (inputManager.isKeyDown("KeyS")) {
            // Back
            deltaZ += deltaPos;
        }
        if (inputManager.isKeyDown("KeyD")) {
            // Right
            deltaX -= deltaPos;
        }
        if (inputManager.isKeyDown("KeyE") || inputManager.isKeyDown("KeyR")) {
            // Move up
            deltaY -= deltaHeight;
        }
        if (
            inputManager.isKeyDown("KeyQ") ||
            inputManager.isKeyDown("KeyC") ||
            inputManager.isKeyDown("KeyF")
        ) {
            // Move down
            deltaY += deltaHeight;
        }

        if (deltaX !== 0 || deltaZ !== 0) {
            camera.move(deltaX, 0, deltaZ);
        }
        if (deltaY !== 0) {
            camera.move(0, deltaY, 0);
        }

        if (inputManager.isKeyDown("KeyP")) {
            camera.pos[0] = 2780;
            camera.pos[2] = 9537;
        }
    }

    handleMouseInput() {
        const camera = this.mapViewer.camera;

        if (this.inputManager.isPointerLock()) {
            this.mapViewer.closeMenu();
        }

        // mouse/touch controls
        const deltaMouseX = this.inputManager.getDeltaMouseX();
        const deltaMouseY = this.inputManager.getDeltaMouseY();

        if (deltaMouseX !== 0 || deltaMouseY !== 0) {
            if (this.inputManager.isTouch) {
                camera.move(0, clamp(-deltaMouseY, -100, 100) * 0.004, 0);
            } else {
                camera.updatePitch(camera.pitch, deltaMouseY * 0.9);
                camera.updateYaw(camera.yaw, deltaMouseX * -0.9);
            }
        }
    }

    handleJoystickInput(deltaTime: number) {
        const deltaTimeSec = deltaTime / 1000;

        const camera = this.mapViewer.camera;

        const deltaPitch = 64 * 5 * deltaTimeSec;
        const deltaYaw = 64 * 5 * deltaTimeSec;

        // joystick controls
        const positionJoystickEvent = this.inputManager.positionJoystickEvent;
        const cameraJoystickEvent = this.inputManager.cameraJoystickEvent;

        if (positionJoystickEvent) {
            const moveX = positionJoystickEvent.x ?? 0;
            const moveY = positionJoystickEvent.y ?? 0;

            camera.move(moveX * 32 * -deltaTimeSec, 0, moveY * 32 * -deltaTimeSec);
        }

        if (cameraJoystickEvent) {
            const moveX = cameraJoystickEvent.x ?? 0;
            const moveY = cameraJoystickEvent.y ?? 0;
            camera.updatePitch(camera.pitch, deltaPitch * 1.5 * moveY);
            camera.updateYaw(camera.yaw, deltaYaw * 1.5 * moveX);
        }
    }

    override onFrameEnd(): void {
        super.onFrameEnd();

        const frameStats = this.renderer.stats;
        const rendererStats = this.renderer.rendererStats;
        const frameTime = performance.now() - rendererStats.frameStart;

        if (this.inputManager.isKeyDown("KeyH")) {
            this.mapViewer.debugText = `MapManager: ${this.mapManagerTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyJ")) {
            this.mapViewer.debugText = `Interactions: ${rendererStats.interactionsTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyK")) {
            this.mapViewer.debugText = `Tick: ${rendererStats.tickTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyL")) {
            this.mapViewer.debugText = `Opaque Pass: ${rendererStats.opaquePassTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyB")) {
            this.mapViewer.debugText = `Opaque Npc Pass: ${rendererStats.opaqueNpcPassTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyN")) {
            this.mapViewer.debugText = `Transparent Pass: ${rendererStats.transparentPassTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyM")) {
            this.mapViewer.debugText = `Transparent Npc Pass: ${rendererStats.transparentNpcPassTime.toFixed(
                2,
            )}ms`;
        }
        if (this.inputManager.isKeyDown("KeyV")) {
            this.mapViewer.debugText = `Frame Time: ${frameTime.toFixed(2)}ms`;
        }
        if (this.inputManager.isKeyDown("KeyG")) {
            this.mapViewer.debugText =
                `Draw Calls: ${rendererStats.drawCalls} ` +
                `(ranges: ${rendererStats.drawRangeCalls}, multi: ${rendererStats.multiDrawCalls})`;
        }
        if (this.inputManager.isKeyDown("KeyU")) {
            this.mapViewer.debugText = `Frame Time Js: ${frameStats.frameTimeJs.toFixed(2)}ms`;
        }

        if (window.wallpaperFpsLimit !== undefined) {
            this.fpsLimit = window.wallpaperFpsLimit;
        }

        if (this.mapViewer.camera.updated) {
            this.mapViewer.updateSearchParams();
        }

        this.inputManager.onFrameEnd();
        this.mapViewer.camera.onFrameEnd();

        // this.mapViewer.debugText = `Frame Time Js: ${this.stats.frameTimeJs.toFixed(3)}`;
    }

    checkInteractions(
        interactReady: boolean,
        interactBuffer: Float32Array,
        closestInteractIndices: Map<number, number[]>,
    ): void {
        const frameCount = this.renderer.stats.frameCount;

        const isMouseDown = this.inputManager.dragX !== -1 || this.inputManager.dragY !== -1;
        const picked = this.inputManager.pickX !== -1 && this.inputManager.pickY !== -1;

        if (!interactReady && !picked) return;

        const menuCooldown = isTouchDevice ? 50 : 10;

        if (
            this.inputManager.mouseX === -1 ||
            this.inputManager.mouseY === -1 ||
            frameCount - this.mapViewer.menuOpenedFrame < menuCooldown
        ) {
            return;
        }

        // Don't auto close menu on touch devices
        if (this.mapViewer.menuOpen && !picked && !isMouseDown && isTouchDevice) {
            return;
        }

        if (!picked && !this.mapViewer.tooltips) {
            this.mapViewer.closeMenu();
            return;
        }

        const menuEntries: OsrsMenuEntry[] = [];
        const examineEntries: OsrsMenuEntry[] = [];
        const interactionHits = collectInteractionHits({
            interactBuffer,
            closestInteractIndices,
            maxDistance: INTERACTION_RADIUS,
        });
        const worldInteractionTargets = resolveWorldInteractionTargets({
            hits: interactionHits,
            getAnimatedLocTypeId: this.getAnimatedLocTypeId.bind(this),
            getMapObjTargetInfo: this.getMapObjTargetInfo.bind(this),
            getNpcTargetInfo: this.getNpcInteractionTargetInfo.bind(this),
        });
        const interactionTargets = resolveMenuInteractionTargets({
            session: this.mapViewer.session,
            targets: worldInteractionTargets,
            includeUnnamed: this.mapViewer.debugId,
        });
        for (const target of interactionTargets) {
            const actionTarget = getMenuActionTarget(target);
            if (target.kind === InteractType.LOC) {
                for (const option of target.locType.actions) {
                    if (!option) {
                        continue;
                    }
                    menuEntries.push({
                        option,
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.mapViewer.closeMenu,
                    });
                }
                if (picked && target.locInstance) {
                    menuEntries.push({
                        option: "Replace loc",
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.onReplaceLoc,
                    });
                    menuEntries.push({
                        option: "Rotate loc",
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.onRotateLoc,
                    });
                    menuEntries.push({
                        option: "Reset loc override",
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.onResetLocOverride,
                    });
                    menuEntries.push({
                        option: "Hide loc",
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.onSetLocVisible(false),
                    });
                    menuEntries.push({
                        option: "Show loc",
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.onSetLocVisible(true),
                    });
                    menuEntries.push({
                        option: "Reset anim",
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.onResetLocAnimation,
                    });
                    menuEntries.push({
                        option: "Pause anim",
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.onSetLocAnimationPaused(true),
                    });
                    menuEntries.push({
                        option: "Resume anim",
                        targetId: target.locType.id,
                        targetType: MenuTargetType.LOC,
                        targetName: target.locType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.onSetLocAnimationPaused(false),
                    });
                }
                examineEntries.push({
                    option: "Examine",
                    targetId: target.locType.id,
                    targetType: MenuTargetType.LOC,
                    targetName: target.locType.name,
                    targetLevel: -1,
                    actionTarget,
                    onClick: this.mapViewer.onExamine,
                });
                continue;
            }
            if (target.kind === InteractType.OBJ) {
                for (const option of target.objType.groundActions) {
                    if (!option) {
                        continue;
                    }
                    menuEntries.push({
                        option,
                        targetId: target.objType.id,
                        targetType: MenuTargetType.OBJ,
                        targetName: target.objType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.mapViewer.closeMenu,
                    });
                }
                if (picked) {
                    menuEntries.push({
                        option: "Remove item",
                        targetId: target.objType.id,
                        targetType: MenuTargetType.OBJ,
                        targetName: target.objType.name,
                        targetLevel: -1,
                        actionTarget,
                        onClick: this.onRemoveGroundItem,
                    });
                    if (
                        actionTarget.kind === MenuTargetType.OBJ &&
                        actionTarget.objInstance.kind === "dynamic"
                    ) {
                        menuEntries.push({
                            option: "Move item here",
                            targetId: target.objType.id,
                            targetType: MenuTargetType.OBJ,
                            targetName: target.objType.name,
                            targetLevel: -1,
                            actionTarget,
                            onClick: this.onMoveDynamicGroundItemToCamera,
                        });
                    }
                }
                examineEntries.push({
                    option: "Examine",
                    targetId: target.objType.id,
                    targetType: MenuTargetType.OBJ,
                    targetName: target.objType.name,
                    targetLevel: -1,
                    actionTarget,
                    onClick: this.mapViewer.onExamine,
                });
                continue;
            }
            for (const option of target.npcType.actions) {
                if (!option) {
                    continue;
                }
                menuEntries.push({
                    option,
                    targetId: target.npcType.id,
                    targetType: MenuTargetType.NPC,
                    targetName: target.npcType.name,
                    targetLevel: target.npcType.combatLevel,
                    actionTarget,
                    onClick: this.mapViewer.closeMenu,
                });
            }
            if (picked) {
                menuEntries.push({
                    option: "Despawn npc",
                    targetId: target.npcType.id,
                    targetType: MenuTargetType.NPC,
                    targetName: target.npcType.name,
                    targetLevel: target.npcType.combatLevel,
                    actionTarget,
                    onClick: this.onDespawnNpc,
                });
            }
            examineEntries.push({
                option: "Examine",
                targetId: target.npcType.id,
                targetType: MenuTargetType.NPC,
                targetName: target.npcType.name,
                targetLevel: target.npcType.combatLevel,
                actionTarget,
                onClick: this.mapViewer.onExamine,
            });
        }

        menuEntries.push({
            option: "Walk here",
            targetId: -1,
            targetType: MenuTargetType.NONE,
            targetName: "",
            targetLevel: -1,
            onClick: this.mapViewer.closeMenu,
        });
        menuEntries.push(...examineEntries);
        menuEntries.push({
            option: "Cancel",
            targetId: -1,
            targetType: MenuTargetType.NONE,
            targetName: "",
            targetLevel: -1,
            onClick: this.mapViewer.closeMenu,
        });

        this.mapViewer.menuOpen = picked;
        if (picked) {
            this.mapViewer.menuOpenedFrame = frameCount;
        }
        this.mapViewer.menuX = this.inputManager.mouseX;
        this.mapViewer.menuY = this.inputManager.mouseY;
        this.mapViewer.menuEntries = menuEntries;
    }
}
