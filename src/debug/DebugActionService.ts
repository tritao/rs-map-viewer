import type { ObjActionTargetInstance } from "../rs/MenuEntry";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import type { ClientWorldState } from "../client/world/ClientWorldState";
import type { WorldMutationInput } from "../world/WorldSession";

export type ClientWorldObjectTarget = Readonly<{
    mapId: number;
    locIndex: number;
}>;

export type ClientActorTarget = Readonly<{
    mapId: number;
    npcInstanceId: number;
}>;

export type ClientGroundItemTarget = Readonly<{
    mapId: number;
    runtimeObjId: number;
    objTypeId: number;
}>;

type DebugActionServiceDeps = Readonly<{
    clientWorldState: ClientWorldState;
    getDevLocReplacementTypeId(): number;
    getCameraMapPosition(): Readonly<{
        mapId: number;
        x: number;
        y: number;
        plane: number;
    }>;
    applyWorldMutation(input: WorldMutationInput): Promise<number>;
}>;

export class DebugActionService {
    constructor(private readonly deps: DebugActionServiceDeps) {}

    restartWorldObjectAnimation(target: ClientWorldObjectTarget): Promise<number> {
        return this.deps.applyWorldMutation({
            loc: {
                animation: {
                    animationResets: [
                        {
                            mapId: target.mapId | 0,
                            locIndex: target.locIndex | 0,
                        },
                    ],
                },
            },
        });
    }

    setWorldObjectVisible(target: ClientWorldObjectTarget, visible: boolean): Promise<number> {
        return this.deps.applyWorldMutation({
            loc: {
                state: {
                    visibilityChanges: [
                        {
                            mapId: target.mapId | 0,
                            locIndex: target.locIndex | 0,
                            visible,
                        },
                    ],
                },
            },
        });
    }

    rotateWorldObject(target: ClientWorldObjectTarget): Promise<number> {
        const locData = this.getWorldObjectPlacementData(target);
        if (!locData) {
            return Promise.resolve(0);
        }
        return this.deps.applyWorldMutation({
            loc: {
                state: {
                    replacements: [
                        {
                            sourceMapId: locData.rsBacking.sourceMapId | 0,
                            placementIndex: locData.rsBacking.placementIndex | 0,
                            locTypeId: locData.locTypeId | 0,
                            locModelType: locData.locModelType,
                            rotation: ((locData.rotation | 0) + 1) & 0x3,
                        },
                    ],
                },
            },
        });
    }

    replaceWorldObjectWithSelectedType(target: ClientWorldObjectTarget): Promise<number> {
        const replacementLocTypeId = this.deps.getDevLocReplacementTypeId() | 0;
        if ((replacementLocTypeId | 0) <= 0) {
            return Promise.resolve(0);
        }
        const locData = this.getWorldObjectPlacementData(target);
        if (!locData) {
            return Promise.resolve(0);
        }
        return this.deps.applyWorldMutation({
            loc: {
                state: {
                    replacements: [
                        {
                            sourceMapId: locData.rsBacking.sourceMapId | 0,
                            placementIndex: locData.rsBacking.placementIndex | 0,
                            locTypeId: replacementLocTypeId,
                            locModelType: locData.locModelType,
                            rotation: locData.rotation | 0,
                        },
                    ],
                },
            },
        });
    }

    restoreWorldObjectType(target: ClientWorldObjectTarget): Promise<number> {
        const locData = this.getWorldObjectPlacementData(target);
        if (!locData) {
            return Promise.resolve(0);
        }
        return this.deps.applyWorldMutation({
            loc: {
                state: {
                    replacementClears: [
                        {
                            sourceMapId: locData.rsBacking.sourceMapId | 0,
                            placementIndex: locData.rsBacking.placementIndex | 0,
                        },
                    ],
                },
            },
        });
    }

    setWorldObjectAnimationPaused(
        target: ClientWorldObjectTarget,
        paused: boolean,
    ): Promise<number> {
        return this.deps.applyWorldMutation({
            loc: {
                animation: {
                    animationPauseStates: [
                        {
                            mapId: target.mapId | 0,
                            locIndex: target.locIndex | 0,
                            paused,
                        },
                    ],
                },
            },
        });
    }

    removeActor(target: ClientActorTarget): Promise<number> {
        return this.deps.applyWorldMutation({
            npc: {
                events: [
                    {
                        kind: "despawn",
                        mapId: target.mapId | 0,
                        npcInstanceId: target.npcInstanceId | 0,
                        seq: 0x7fffffff,
                    },
                ],
            },
        });
    }

    removeGroundItem(target: ObjActionTargetInstance): Promise<number> {
        if (target.kind === "dynamic") {
            return this.deps.applyWorldMutation({
                obj: {
                    dynamic: {
                        dynamicDespawns: [
                            {
                                mapId: target.mapId | 0,
                                runtimeObjId: target.runtimeObjId | 0,
                            },
                        ],
                    },
                },
            });
        }
        return this.deps.applyWorldMutation({
            obj: {
                static: {
                    removals: [
                        {
                            mapId: target.mapId | 0,
                            objIndex: target.objIndex | 0,
                        },
                    ],
                },
            },
        });
    }

    moveGroundItemToCamera(target: ClientGroundItemTarget): Promise<number> {
        const cameraPosition = this.deps.getCameraMapPosition();
        return this.deps.applyWorldMutation({
            obj: {
                dynamic: {
                    dynamicUpdates: [
                        {
                            mapId: cameraPosition.mapId | 0,
                            runtimeObjId: target.runtimeObjId | 0,
                            objTypeId: target.objTypeId | 0,
                            count: 1,
                            x: cameraPosition.x | 0,
                            y: cameraPosition.y | 0,
                            plane: cameraPosition.plane | 0,
                        },
                    ],
                },
            },
        });
    }

    private getWorldObjectPlacementData(target: ClientWorldObjectTarget) {
        const worldObject = this.deps.clientWorldState.getWorldObjectEntity(
            target.mapId | 0,
            target.locIndex | 0,
        );
        if (
            !worldObject ||
            (worldObject.rsBacking.placementIndex | 0) < 0 ||
            (worldObject.rsBacking.sourceMapId | 0) < 0
        ) {
            return undefined;
        }
        return worldObject;
    }
}

export function getCameraMapPosition(camera: Readonly<{ getMapX(): number; getMapY(): number }>) {
    const x = camera.getMapX() | 0;
    const y = camera.getMapY() | 0;
    return {
        mapId: getMapSquareId(x >> 6, y >> 6),
        x,
        y,
        plane: 0,
    };
}
