import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";
import type { MenuActionTarget, ObjActionTargetInstance } from "../rs/MenuEntry";
import { MenuTargetType } from "../rs/MenuEntry";
import type { LocType } from "../rs/config/loctype/LocType";
import type { NpcType } from "../rs/config/npctype/NpcType";
import type { ObjType } from "../rs/config/objtype/ObjType";
import { InteractType } from "../runtime/InteractType";
import {
    collectInteractionHits,
    type InteractionHit,
    type WorldInteractionTarget,
} from "../runtime/InteractionTargets";
import { INTERACTION_RADIUS } from "../renderer/InteractionState";
import { isTouchDevice } from "../util/DeviceUtil";
import type { DebugActionService } from "../debug/DebugActionService";
import type { ClientWorldState } from "../client/world/ClientWorldState";
import type { MapViewer } from "./MapViewer";

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
    session: MapViewer["session"];
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

type MapViewerInteractionServiceDeps = Readonly<{
    mapViewer: MapViewer;
    debugActions: DebugActionService;
    clientWorldState: ClientWorldState;
}>;

export class MapViewerInteractionService {
    constructor(private readonly deps: MapViewerInteractionServiceDeps) {}

    checkInteractions(
        interactReady: boolean,
        interactBuffer: Float32Array,
        closestInteractIndices: Map<number, number[]>,
    ): void {
        const { mapViewer } = this.deps;
        const menuState = mapViewer.getMenuState();
        const frameCount = mapViewer.renderer.renderer.stats.frameCount;
        const inputManager = mapViewer.inputManager;
        const isMouseDown = inputManager.dragX !== -1 || inputManager.dragY !== -1;
        const picked = inputManager.pickX !== -1 && inputManager.pickY !== -1;

        if (!interactReady && !picked) {
            return;
        }

        const menuCooldown = isTouchDevice ? 50 : 10;
        if (
            inputManager.mouseX === -1 ||
            inputManager.mouseY === -1 ||
            frameCount - menuState.openedFrame < menuCooldown
        ) {
            return;
        }

        if (menuState.open && !picked && !isMouseDown && isTouchDevice) {
            return;
        }
        if (!picked && !mapViewer.tooltips) {
            mapViewer.closeMenu();
            return;
        }

        const menuEntries: OsrsMenuEntry[] = [];
        const examineEntries: OsrsMenuEntry[] = [];
        const interactionHits = collectInteractionHits({
            interactBuffer,
            closestInteractIndices,
            maxDistance: INTERACTION_RADIUS,
        });
        const worldInteractionTargets = this.deps.clientWorldState.resolveInteractionTargets(
            interactionHits,
        );
        const interactionTargets = resolveMenuInteractionTargets({
            session: mapViewer.session,
            targets: worldInteractionTargets,
            includeUnnamed: mapViewer.debugId,
        });

        for (const target of interactionTargets) {
            this.appendTargetEntries(menuEntries, examineEntries, target, picked);
        }

        menuEntries.push({
            option: "Walk here",
            targetId: -1,
            targetType: MenuTargetType.NONE,
            targetName: "",
            targetLevel: -1,
            onClick: this.onWalkHere,
        });
        menuEntries.push(...examineEntries);
        menuEntries.push({
            option: "Cancel",
            targetId: -1,
            targetType: MenuTargetType.NONE,
            targetName: "",
            targetLevel: -1,
            onClick: mapViewer.closeMenu,
        });

        mapViewer.setMenuState({
            open: picked,
            openedFrame: picked ? frameCount : menuState.openedFrame,
            x: inputManager.mouseX,
            y: inputManager.mouseY,
            entries: menuEntries,
        });
    }

    private appendTargetEntries(
        menuEntries: OsrsMenuEntry[],
        examineEntries: OsrsMenuEntry[],
        target: MenuInteractionTarget,
        picked: boolean,
    ): void {
        switch (target.kind) {
            case InteractType.LOC:
                this.appendLocEntries(menuEntries, examineEntries, target, picked);
                return;
            case InteractType.OBJ:
                this.appendGroundItemEntries(menuEntries, examineEntries, target, picked);
                return;
            case InteractType.NPC:
                this.appendActorEntries(menuEntries, examineEntries, target, picked);
                return;
        }
    }

    private appendLocEntries(
        menuEntries: OsrsMenuEntry[],
        examineEntries: OsrsMenuEntry[],
        target: Extract<MenuInteractionTarget, { kind: InteractType.LOC }>,
        picked: boolean,
    ): void {
        const actionTarget = getMenuActionTarget(target);
        this.appendActionEntries(
            menuEntries,
            target.locType.actions,
            target.locType.id,
            MenuTargetType.LOC,
            target.locType.name,
            -1,
            actionTarget,
            this.onWorldObjectAction.bind(this),
        );
        if (picked && target.locInstance) {
            this.pushMenuEntry(menuEntries, "Replace loc", target.locType.id, MenuTargetType.LOC, target.locType.name, -1, actionTarget, this.onReplaceLoc);
            this.pushMenuEntry(menuEntries, "Rotate loc", target.locType.id, MenuTargetType.LOC, target.locType.name, -1, actionTarget, this.onRotateLoc);
            this.pushMenuEntry(menuEntries, "Reset loc override", target.locType.id, MenuTargetType.LOC, target.locType.name, -1, actionTarget, this.onResetLocOverride);
            this.pushMenuEntry(menuEntries, "Hide loc", target.locType.id, MenuTargetType.LOC, target.locType.name, -1, actionTarget, this.onSetLocVisible(false));
            this.pushMenuEntry(menuEntries, "Show loc", target.locType.id, MenuTargetType.LOC, target.locType.name, -1, actionTarget, this.onSetLocVisible(true));
            this.pushMenuEntry(menuEntries, "Reset anim", target.locType.id, MenuTargetType.LOC, target.locType.name, -1, actionTarget, this.onResetLocAnimation);
            this.pushMenuEntry(menuEntries, "Pause anim", target.locType.id, MenuTargetType.LOC, target.locType.name, -1, actionTarget, this.onSetLocAnimationPaused(true));
            this.pushMenuEntry(menuEntries, "Resume anim", target.locType.id, MenuTargetType.LOC, target.locType.name, -1, actionTarget, this.onSetLocAnimationPaused(false));
        }
        this.pushExamineEntry(
            examineEntries,
            target.locType.id,
            MenuTargetType.LOC,
            target.locType.name,
            -1,
            actionTarget,
            () =>
                this.deps.mapViewer.examineWorldObject({
                    locTypeId: target.locType.id | 0,
                    mapId: target.locInstance?.mapId,
                    locIndex: target.locInstance?.locIndex,
                }),
        );
    }

    private appendGroundItemEntries(
        menuEntries: OsrsMenuEntry[],
        examineEntries: OsrsMenuEntry[],
        target: Extract<MenuInteractionTarget, { kind: InteractType.OBJ }>,
        picked: boolean,
    ): void {
        const actionTarget = getMenuActionTarget(target);
        this.appendActionEntries(
            menuEntries,
            target.objType.groundActions,
            target.objType.id,
            MenuTargetType.OBJ,
            target.objType.name,
            -1,
            actionTarget,
            this.onGroundItemAction.bind(this),
        );
        if (picked) {
            this.pushMenuEntry(menuEntries, "Remove item", target.objType.id, MenuTargetType.OBJ, target.objType.name, -1, actionTarget, this.onRemoveGroundItem);
            if (actionTarget.kind === MenuTargetType.OBJ && actionTarget.objInstance.kind === "dynamic") {
                this.pushMenuEntry(menuEntries, "Move item here", target.objType.id, MenuTargetType.OBJ, target.objType.name, -1, actionTarget, this.onMoveDynamicGroundItemToCamera);
            }
        }
        this.pushExamineEntry(
            examineEntries,
            target.objType.id,
            MenuTargetType.OBJ,
            target.objType.name,
            -1,
            actionTarget,
            () =>
                this.deps.mapViewer.examineGroundItem({
                    objTypeId: target.objType.id | 0,
                    objInstance: target.objInstance,
                }),
        );
    }

    private appendActorEntries(
        menuEntries: OsrsMenuEntry[],
        examineEntries: OsrsMenuEntry[],
        target: Extract<MenuInteractionTarget, { kind: InteractType.NPC }>,
        picked: boolean,
    ): void {
        const actionTarget = getMenuActionTarget(target);
        this.appendActionEntries(
            menuEntries,
            target.npcType.actions,
            target.npcType.id,
            MenuTargetType.NPC,
            target.npcType.name,
            target.npcType.combatLevel,
            actionTarget,
            this.onActorAction.bind(this),
        );
        if (picked) {
            this.pushMenuEntry(menuEntries, "Despawn npc", target.npcType.id, MenuTargetType.NPC, target.npcType.name, target.npcType.combatLevel, actionTarget, this.onDespawnNpc);
        }
        this.pushExamineEntry(
            examineEntries,
            target.npcType.id,
            MenuTargetType.NPC,
            target.npcType.name,
            target.npcType.combatLevel,
            actionTarget,
            () =>
                this.deps.mapViewer.examineActor({
                    npcTypeId: target.npcType.id | 0,
                    npcInstance: target.npcInstance,
                }),
        );
    }

    private appendActionEntries(
        menuEntries: OsrsMenuEntry[],
        options: ReadonlyArray<string | null | undefined>,
        targetId: number,
        targetType: MenuTargetType,
        targetName: string,
        targetLevel: number,
        actionTarget: MenuActionTarget,
        onClickFactory: (option: string) => (entry: OsrsMenuEntry) => void,
    ): void {
        for (const option of options) {
            if (!option) {
                continue;
            }
            this.pushMenuEntry(
                menuEntries,
                option,
                targetId,
                targetType,
                targetName,
                targetLevel,
                actionTarget,
                onClickFactory(option),
            );
        }
    }

    private pushExamineEntry(
        entries: OsrsMenuEntry[],
        targetId: number,
        targetType: MenuTargetType,
        targetName: string,
        targetLevel: number,
        actionTarget: MenuActionTarget,
        onExamine: () => void,
    ): void {
        this.pushMenuEntry(
            entries,
            "Examine",
            targetId,
            targetType,
            targetName,
            targetLevel,
            actionTarget,
            () => {
                onExamine();
                this.deps.mapViewer.closeMenu();
            },
        );
    }

    private pushMenuEntry(
        entries: OsrsMenuEntry[],
        option: string,
        targetId: number,
        targetType: MenuTargetType,
        targetName: string,
        targetLevel: number,
        actionTarget: MenuActionTarget | undefined,
        onClick: (entry: OsrsMenuEntry) => void,
    ): void {
        entries.push({
            option,
            targetId,
            targetType,
            targetName,
            targetLevel,
            actionTarget,
            onClick,
        });
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
        this.deps.mapViewer.closeMenu();
        if (!locInstance) {
            return;
        }
        void this.deps.debugActions.restartWorldObjectAnimation(locInstance);
    };

    private onWalkHere = () => {
        const { mapViewer } = this.deps;
        void mapViewer.walkToScreenPoint({
            screenX: mapViewer.inputManager.mouseX | 0,
            screenY: mapViewer.inputManager.mouseY | 0,
            viewportWidth: mapViewer.renderer.canvas.offsetWidth | 0,
            viewportHeight: mapViewer.renderer.canvas.offsetHeight | 0,
        });
        mapViewer.closeMenu();
    };

    private onWorldObjectAction(option: string): (entry: OsrsMenuEntry) => void {
        return (entry) => {
            const actionTarget = entry.actionTarget;
            if (!actionTarget || actionTarget.kind !== MenuTargetType.LOC) {
                this.deps.mapViewer.closeMenu();
                return;
            }
            this.deps.mapViewer.clientCommands.interactWithWorldObject(option, actionTarget);
            this.deps.mapViewer.closeMenu();
        };
    }

    private onGroundItemAction(option: string): (entry: OsrsMenuEntry) => void {
        return (entry) => {
            const actionTarget = entry.actionTarget;
            if (!actionTarget || actionTarget.kind !== MenuTargetType.OBJ) {
                this.deps.mapViewer.closeMenu();
                return;
            }
            this.deps.mapViewer.clientCommands.interactWithGroundItem(option, actionTarget);
            this.deps.mapViewer.closeMenu();
        };
    }

    private onActorAction(option: string): (entry: OsrsMenuEntry) => void {
        return (entry) => {
            const actionTarget = entry.actionTarget;
            if (!actionTarget || actionTarget.kind !== MenuTargetType.NPC) {
                this.deps.mapViewer.closeMenu();
                return;
            }
            this.deps.mapViewer.clientCommands.interactWithActor(option, actionTarget);
            this.deps.mapViewer.closeMenu();
        };
    }

    private onSetLocVisible(visible: boolean): (entry: OsrsMenuEntry) => void {
        return (entry) => {
            this.withLocInstance(entry, (locInstance) =>
                this.deps.debugActions.setWorldObjectVisible(locInstance, visible),
            );
        };
    }

    private onRotateLoc = (entry: OsrsMenuEntry) => {
        this.withLocInstance(entry, (locInstance) =>
            this.deps.debugActions.rotateWorldObject(locInstance),
        );
    };

    private onReplaceLoc = (entry: OsrsMenuEntry) => {
        this.withLocInstance(entry, (locInstance) =>
            this.deps.debugActions.replaceWorldObjectWithSelectedType(locInstance),
        );
    };

    private onResetLocOverride = (entry: OsrsMenuEntry) => {
        this.withLocInstance(entry, (locInstance) =>
            this.deps.debugActions.restoreWorldObjectType(locInstance),
        );
    };

    private onSetLocAnimationPaused(paused: boolean): (entry: OsrsMenuEntry) => void {
        return (entry) => {
            this.withLocInstance(entry, (locInstance) =>
                this.deps.debugActions.setWorldObjectAnimationPaused(locInstance, paused),
            );
        };
    }

    private onDespawnNpc = (entry: OsrsMenuEntry) => {
        this.withNpcInstance(entry, (npcInstance) =>
            this.deps.debugActions.removeActor(npcInstance),
        );
    };

    private onRemoveGroundItem = (entry: OsrsMenuEntry) => {
        this.withGroundItemTarget(entry, (actionTarget) =>
            this.deps.debugActions.removeGroundItem(actionTarget.objInstance),
        );
    };

    private onMoveDynamicGroundItemToCamera = (entry: OsrsMenuEntry) => {
        this.withGroundItemTarget(entry, (actionTarget) => {
            if (actionTarget.objInstance.kind !== "dynamic") {
                return Promise.resolve(0);
            }
            return this.deps.debugActions.moveGroundItemToCamera({
                mapId: actionTarget.objInstance.mapId | 0,
                runtimeObjId: actionTarget.objInstance.runtimeObjId | 0,
                objTypeId: actionTarget.objTypeId | 0,
            });
        });
    };

    private withLocInstance(
        entry: OsrsMenuEntry,
        action: (locInstance: Readonly<{ mapId: number; locIndex: number }>) => Promise<number>,
    ): void {
        const locInstance = this.getLocInstanceFromMenuEntry(entry);
        this.deps.mapViewer.closeMenu();
        if (!locInstance) {
            return;
        }
        void action(locInstance);
    }

    private withNpcInstance(
        entry: OsrsMenuEntry,
        action: (
            npcInstance: Readonly<{ mapId: number; npcInstanceId: number }>,
        ) => Promise<number>,
    ): void {
        const npcInstance = this.getNpcInstanceFromMenuEntry(entry);
        this.deps.mapViewer.closeMenu();
        if (!npcInstance) {
            return;
        }
        void action(npcInstance);
    }

    private withGroundItemTarget(
        entry: OsrsMenuEntry,
        action: (
            actionTarget: Extract<MenuActionTarget, { kind: MenuTargetType.OBJ }>,
        ) => Promise<number>,
    ): void {
        const actionTarget = entry.actionTarget;
        this.deps.mapViewer.closeMenu();
        if (!actionTarget || actionTarget.kind !== MenuTargetType.OBJ) {
            return;
        }
        void action(actionTarget);
    }
}
