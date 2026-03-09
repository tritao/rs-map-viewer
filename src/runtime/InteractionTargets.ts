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
