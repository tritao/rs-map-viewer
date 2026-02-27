import { CollisionFlag } from "../rs/pathfinder/flag/CollisionFlag";
import { Pathfinder } from "../rs/pathfinder/Pathfinder";
import type { CollisionData } from "../rs/scene/CollisionMap";
import { CollisionMap } from "../rs/scene/CollisionMap";

export type SimNpcLike = Readonly<{
    level: number;
    pathX: ArrayLike<number>;
    pathY: ArrayLike<number>;
    getSize(): number;
    updateServerMovement(pathfinder: Pathfinder, borderSize: number, collisionMaps: CollisionMap[]): void;
}>;

export class SimWorld {
    private readonly collisionByMapId: Map<number, CollisionMap[] | CollisionData[]> = new Map();
    private readonly seededNpcFlagsByMapId: Set<number> = new Set();

    onMapLoaded(mapId: number, collisionDatas: CollisionData[]): void {
        this.collisionByMapId.set(mapId, collisionDatas);
        this.seededNpcFlagsByMapId.delete(mapId);
    }

    onMapUnloaded(mapId: number): void {
        this.collisionByMapId.delete(mapId);
        this.seededNpcFlagsByMapId.delete(mapId);
    }

    private getCollisionMaps(mapId: number): CollisionMap[] | undefined {
        const value = this.collisionByMapId.get(mapId);
        if (!value) {
            return undefined;
        }
        if (value.length === 0) {
            return [];
        }
        // Disambiguate the union by checking for a CollisionMap-only field.
        if (typeof (value[0] as CollisionMap).flag === "function") {
            return value as CollisionMap[];
        }
        const maps = (value as CollisionData[]).map(CollisionMap.fromData);
        this.collisionByMapId.set(mapId, maps);
        return maps;
    }

    tickNpcMovement(
        mapId: number,
        pathfinder: Pathfinder,
        borderSize: number,
        npcs: ReadonlyArray<SimNpcLike>,
        ticksElapsed: number,
    ): void {
        const collisionMaps = this.getCollisionMaps(mapId);
        if (!collisionMaps) {
            return;
        }
        if (!this.seededNpcFlagsByMapId.has(mapId)) {
            this.seedNpcCollisionFlags(borderSize, collisionMaps, npcs);
            this.seededNpcFlagsByMapId.add(mapId);
        }
        for (let t = 0; t < ticksElapsed; t++) {
            for (const npc of npcs) {
                npc.updateServerMovement(pathfinder, borderSize, collisionMaps);
            }
        }
    }

    private seedNpcCollisionFlags(
        borderSize: number,
        collisionMaps: CollisionMap[],
        npcs: ReadonlyArray<Pick<SimNpcLike, "level" | "pathX" | "pathY" | "getSize">>,
    ): void {
        for (const npc of npcs) {
            const collisionMap = collisionMaps[npc.level | 0];
            if (!collisionMap) {
                continue;
            }
            const currentX = npc.pathX[0] | 0;
            const currentY = npc.pathY[0] | 0;
            const size = npc.getSize() | 0;
            for (let flagX = currentX; flagX < currentX + size; flagX++) {
                for (let flagY = currentY; flagY < currentY + size; flagY++) {
                    collisionMap.flag(
                        (flagX + borderSize) | 0,
                        (flagY + borderSize) | 0,
                        CollisionFlag.BLOCK_NPCS,
                    );
                }
            }
        }
    }
}

