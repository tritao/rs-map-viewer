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
          objInstance: Readonly<{
              mapId: number;
              objIndex: number;
          }>;
      }>
    | Readonly<{
          kind: InteractType.NPC;
          hit: InteractionHit & { kind: InteractType.NPC };
          npcTypeId: number;
          npcInstance: Readonly<{
              mapId: number;
              npcInstanceId: number;
          }>;
      }>;

export function collectInteractionHits(input: Readonly<{
    interactBuffer: Float32Array;
    closestInteractIndices: ReadonlyMap<number, number[]>;
    maxDistance: number;
}>): InteractionHit[] {
    const hits: InteractionHit[] = [];
    const locKeys = new Set<string>();
    const objKeys = new Set<string>();
    const npcKeys = new Set<string>();

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
                const objKey = `${mapId}:${id}`;
                if (objKeys.has(objKey)) {
                    continue;
                }
                objKeys.add(objKey);
                hits.push({ kind, id, mapId, distance });
                continue;
            }
            if (kind === InteractType.NPC) {
                const npcKey = `${mapId}:${id}`;
                if (npcKeys.has(npcKey)) {
                    continue;
                }
                npcKeys.add(npcKey);
                hits.push({ kind, id, mapId, distance });
            }
        }
    }

    return hits;
}

export function resolveWorldInteractionTargets(input: Readonly<{
    hits: ReadonlyArray<InteractionHit>;
    getAnimatedLocTypeId?: (mapId: number, locIndex: number) => number | undefined;
    getMapObjTypeId?: (mapId: number, objIndex: number) => number | undefined;
    getNpcTargetInfo?: (
        mapId: number,
        npcInteractId: number,
    ) =>
        | Readonly<{
              npcInstanceId: number;
              npcTypeId: number;
          }>
        | undefined;
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
            const objIndex = hit.id | 0;
            const objTypeId = input.getMapObjTypeId?.(hit.mapId | 0, objIndex | 0);
            if (objTypeId === undefined) {
                continue;
            }
            targets.push({
                kind: InteractType.OBJ,
                hit: hit as InteractionHit & { kind: InteractType.OBJ },
                objTypeId,
                objInstance: {
                    mapId: hit.mapId | 0,
                    objIndex,
                },
            });
            continue;
        }

        if (hit.kind === InteractType.NPC) {
            const npcTarget = input.getNpcTargetInfo?.(hit.mapId | 0, hit.id | 0);
            if (!npcTarget) {
                continue;
            }
            targets.push({
                kind: InteractType.NPC,
                hit: hit as InteractionHit & { kind: InteractType.NPC },
                npcTypeId: npcTarget.npcTypeId | 0,
                npcInstance: {
                    mapId: hit.mapId | 0,
                    npcInstanceId: npcTarget.npcInstanceId | 0,
                },
            });
        }
    }

    return targets;
}
