import type { LocType } from "../rs/config/loctype/LocType";
import type { NpcType } from "../rs/config/npctype/NpcType";
import type { ObjType } from "../rs/config/objtype/ObjType";
import type { CacheSession } from "../rs/loaders/CacheSession";
import { InteractType } from "./contracts/InteractType";

export type InteractionHit = Readonly<{
    kind: InteractType;
    id: number;
    distance: number;
}>;

export type ResolvedInteractionTarget =
    | Readonly<{
          kind: InteractType.LOC;
          hit: InteractionHit & { kind: InteractType.LOC };
          locType: LocType;
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
    const locIds = new Set<number>();
    const objIds = new Set<number>();
    const npcIds = new Set<number>();

    for (let distance = 0; distance <= (input.maxDistance | 0); distance++) {
        const indices = input.closestInteractIndices.get(distance);
        if (!indices) {
            continue;
        }
        for (const index of indices) {
            const id = input.interactBuffer[index] | 0;
            const kind = input.interactBuffer[index + 2] | 0;
            if (kind === InteractType.LOC) {
                if (locIds.has(id)) {
                    continue;
                }
                locIds.add(id);
                hits.push({ kind, id, distance });
                continue;
            }
            if (kind === InteractType.OBJ) {
                if (objIds.has(id)) {
                    continue;
                }
                objIds.add(id);
                hits.push({ kind, id, distance });
                continue;
            }
            if (kind === InteractType.NPC) {
                if (npcIds.has(id)) {
                    continue;
                }
                npcIds.add(id);
                hits.push({ kind, id, distance });
            }
        }
    }

    return hits;
}

export function resolveInteractionTargets(input: Readonly<{
    session: CacheSession;
    hits: ReadonlyArray<InteractionHit>;
    includeUnnamed: boolean;
}>): ResolvedInteractionTarget[] {
    const targets: ResolvedInteractionTarget[] = [];

    for (const hit of input.hits) {
        if (hit.kind === InteractType.LOC) {
            const locResult = input.session.tryLoadLocType(hit.id);
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
