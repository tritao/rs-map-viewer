import type { LocType } from "../rs/config/loctype/LocType";
import type { NpcType } from "../rs/config/npctype/NpcType";
import type { ObjType } from "../rs/config/objtype/ObjType";
import type { CacheSession } from "../rs/loaders/CacheSession";
import {
    decodeAnimatedLocInteractIndex,
    InteractType,
    isAnimatedLocInteractId,
} from "./InteractType";

export type InteractionHit = Readonly<{
    kind: InteractType;
    id: number;
    mapId: number;
    distance: number;
}>;

export type WorldInteractionTarget =
    | Readonly<{
          kind: InteractType.LOC;
          hit: InteractionHit & { kind: InteractType.LOC };
          locTypeId: number;
          locInstance?: Readonly<{
              mapId: number;
              locIndex: number;
          }>;
      }>
    | Readonly<{
          kind: InteractType.OBJ;
          hit: InteractionHit & { kind: InteractType.OBJ };
          objTypeId: number;
      }>
    | Readonly<{
          kind: InteractType.NPC;
          hit: InteractionHit & { kind: InteractType.NPC };
          npcTypeId: number;
      }>;

export type ResolvedInteractionTarget =
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
      }>
    | Readonly<{
          kind: InteractType.NPC;
          hit: InteractionHit & { kind: InteractType.NPC };
          npcType: NpcType;
      }>;

export function collectInteractionHits(input: Readonly<{
    interactBuffer: Float32Array;
    closestInteractIndices: ReadonlyMap<number, number[]>;
    maxDistance: number;
}>): InteractionHit[] {
    const hits: InteractionHit[] = [];
    const locKeys = new Set<string>();
    const objIds = new Set<number>();
    const npcIds = new Set<number>();

    for (let distance = 0; distance <= (input.maxDistance | 0); distance++) {
        const indices = input.closestInteractIndices.get(distance);
        if (!indices) {
            continue;
        }
        for (const index of indices) {
            const id = input.interactBuffer[index] | 0;
            const mapId = input.interactBuffer[index + 1] | 0;
            const kind = input.interactBuffer[index + 2] | 0;
            if (kind === InteractType.LOC) {
                const locKey = isAnimatedLocInteractId(id) ? `${mapId}:${id}` : `${id}`;
                if (locKeys.has(locKey)) {
                    continue;
                }
                locKeys.add(locKey);
                hits.push({ kind, id, mapId, distance });
                continue;
            }
            if (kind === InteractType.OBJ) {
                if (objIds.has(id)) {
                    continue;
                }
                objIds.add(id);
                hits.push({ kind, id, mapId, distance });
                continue;
            }
            if (kind === InteractType.NPC) {
                if (npcIds.has(id)) {
                    continue;
                }
                npcIds.add(id);
                hits.push({ kind, id, mapId, distance });
            }
        }
    }

    return hits;
}

export function resolveWorldInteractionTargets(input: Readonly<{
    hits: ReadonlyArray<InteractionHit>;
    getAnimatedLocTypeId?: (mapId: number, locIndex: number) => number | undefined;
}>): WorldInteractionTarget[] {
    const targets: WorldInteractionTarget[] = [];

    for (const hit of input.hits) {
        if (hit.kind === InteractType.LOC) {
            let locTypeId = hit.id | 0;
            let locInstance:
                | Readonly<{
                      mapId: number;
                      locIndex: number;
                  }>
                | undefined;
            if (isAnimatedLocInteractId(locTypeId)) {
                const locIndex = decodeAnimatedLocInteractIndex(locTypeId);
                if (locIndex === undefined || !input.getAnimatedLocTypeId) {
                    continue;
                }
                const resolvedLocTypeId = input.getAnimatedLocTypeId(hit.mapId | 0, locIndex | 0);
                if (resolvedLocTypeId === undefined) {
                    continue;
                }
                locTypeId = resolvedLocTypeId | 0;
                locInstance = {
                    mapId: hit.mapId | 0,
                    locIndex: locIndex | 0,
                };
            }
            targets.push({
                kind: InteractType.LOC,
                hit: hit as InteractionHit & { kind: InteractType.LOC },
                locTypeId,
                locInstance,
            });
            continue;
        }

        if (hit.kind === InteractType.OBJ) {
            targets.push({
                kind: InteractType.OBJ,
                hit: hit as InteractionHit & { kind: InteractType.OBJ },
                objTypeId: hit.id | 0,
            });
            continue;
        }

        if (hit.kind === InteractType.NPC) {
            targets.push({
                kind: InteractType.NPC,
                hit: hit as InteractionHit & { kind: InteractType.NPC },
                npcTypeId: hit.id | 0,
            });
        }
    }

    return targets;
}

export function resolveInteractionTargets(input: Readonly<{
    session: CacheSession;
    targets: ReadonlyArray<WorldInteractionTarget>;
    includeUnnamed: boolean;
}>): ResolvedInteractionTarget[] {
    const resolvedTargets: ResolvedInteractionTarget[] = [];

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
        });
    }

    return resolvedTargets;
}
