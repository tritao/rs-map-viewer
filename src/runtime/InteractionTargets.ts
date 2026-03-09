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

export function resolveInteractionTargets(input: Readonly<{
    session: CacheSession;
    hits: ReadonlyArray<InteractionHit>;
    includeUnnamed: boolean;
    getAnimatedLocTypeId?: (mapId: number, locIndex: number) => number | undefined;
}>): ResolvedInteractionTarget[] {
    const targets: ResolvedInteractionTarget[] = [];

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
            const locResult = input.session.tryLoadLocType(locTypeId);
            if (!locResult.ok) {
                continue;
            }
            const locType = locResult.value;
            if (locType.name === "null" && !input.includeUnnamed) {
                continue;
            }
            targets.push({
                kind: InteractType.LOC,
                hit: hit as InteractionHit & { kind: InteractType.LOC },
                locType,
                locInstance,
            });
            continue;
        }

        if (hit.kind === InteractType.OBJ) {
            const objResult = input.session.tryLoadObjType(hit.id);
            if (!objResult.ok) {
                continue;
            }
            const objType = objResult.value;
            if (objType.name === "null" && !input.includeUnnamed) {
                continue;
            }
            targets.push({
                kind: InteractType.OBJ,
                hit: hit as InteractionHit & { kind: InteractType.OBJ },
                objType,
            });
            continue;
        }

        if (hit.kind === InteractType.NPC) {
            const npcResult = input.session.tryLoadNpcType(hit.id);
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
            targets.push({
                kind: InteractType.NPC,
                hit: hit as InteractionHit & { kind: InteractType.NPC },
                npcType,
            });
        }
    }

    return targets;
}
