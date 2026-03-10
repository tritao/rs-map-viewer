import {
    resolveWorldInteractionTargets,
    type InteractionHit,
    type WorldInteractionTarget,
} from "../../runtime/InteractionTargets";
import type { ClientWorldState } from "./ClientWorldState";

export function resolveClientWorldInteractionTargets(
    clientWorldState: ClientWorldState,
    hits: ReadonlyArray<InteractionHit>,
): WorldInteractionTarget[] {
    return resolveWorldInteractionTargets({
        hits,
        getAnimatedLocTypeId: (mapId, locIndex) =>
            clientWorldState.getWorldObjectEntity(mapId | 0, locIndex | 0)?.locTypeId,
        getMapObjTargetInfo: (mapId, interactId) => {
            const entity = clientWorldState.getGroundItemEntity(mapId | 0, interactId | 0);
            if (!entity || !entity.visible) {
                return undefined;
            }
            if (entity.rsBacking.kind === "obj-static") {
                return {
                    kind: "static" as const,
                    objTypeId: entity.objTypeId | 0,
                    objIndex: entity.rsBacking.objIndex | 0,
                };
            }
            return {
                kind: "dynamic" as const,
                objTypeId: entity.objTypeId | 0,
                runtimeObjId: entity.rsBacking.runtimeObjId | 0,
            };
        },
        getNpcTargetInfo: (mapId, interactId) => {
            const entity = clientWorldState.getActorEntityByInteractId(mapId | 0, interactId | 0);
            if (!entity || !entity.visible) {
                return undefined;
            }
            return {
                npcInstanceId: entity.rsBacking.npcInstanceId | 0,
                npcTypeId: entity.npcTypeId | 0,
            };
        },
    });
}
