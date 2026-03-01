import { BLOCKED_STATEGY, NORMAL_STRATEGY } from "../../rs/pathfinder/CollisionStrategy";
import { Pathfinder } from "../../rs/pathfinder/Pathfinder";
import { ExactRouteStrategy } from "../../rs/pathfinder/RouteStrategy";
import { CollisionFlag } from "../../rs/pathfinder/flag/CollisionFlag";
import { CollisionMap } from "../../rs/scene/CollisionMap";
import { MovementType } from "../../runtime/entities/Npc";
import { clamp } from "../../util/MathUtil";

const routeStrategy = new ExactRouteStrategy();

export type NpcServerMovementLike = {
    level: number;
    spawnX: number;
    spawnY: number;
    pathX: ArrayLike<number>;
    pathY: ArrayLike<number>;
    serverPathX: number[];
    serverPathY: number[];
    serverPathMovementType: MovementType[];
    serverPathLength: number;
    canWalk(): boolean;
    getSize(): number;
    queuePath(x: number, y: number, movementType: MovementType): void;
};

export function planNpcLocalWanderPath(
    npc: NpcServerMovementLike,
    pathfinder: Pathfinder,
    borderSize: number,
    collisionMap: CollisionMap,
): void {
    const size = npc.getSize();
    if (!npc.canWalk() || Math.random() >= 0.1) {
        return;
    }

    const deltaX = Math.round(Math.random() * 10.0 - 5.0);
    const deltaY = Math.round(Math.random() * 10.0 - 5.0);

    const srcX = npc.pathX[0] | 0;
    const srcY = npc.pathY[0] | 0;

    const spawnX = npc.spawnX | 0;
    const spawnY = npc.spawnY | 0;

    const targetX = clamp(spawnX + deltaX, 0, 64 - size - 1);
    const targetY = clamp(spawnY + deltaY, 0, 64 - size - 1);

    routeStrategy.approxDestX = targetX;
    routeStrategy.approxDestY = targetY;
    routeStrategy.destSizeX = 1;
    routeStrategy.destSizeY = 1;

    pathfinder.setNpcFlags(srcX, srcY, spawnX, spawnY, 5, borderSize, collisionMap);

    let collisionStrategy = NORMAL_STRATEGY;
    if (collisionMap.hasFlag(spawnX + borderSize, spawnY + borderSize, CollisionFlag.FLOOR)) {
        collisionStrategy = BLOCKED_STATEGY;
    }

    let steps = pathfinder.findPath(
        srcX,
        srcY,
        size,
        npc.level | 0,
        routeStrategy,
        collisionStrategy,
        CollisionFlag.BLOCK_NPCS,
        true,
    );
    if (steps > 0) {
        if (steps > 24) {
            steps = 24;
        }
        for (let s = 0; s < steps; s++) {
            npc.serverPathX[s] = pathfinder.bufferX[s] | 0;
            npc.serverPathY[s] = pathfinder.bufferY[s] | 0;
            npc.serverPathMovementType[s] = MovementType.WALK;
        }
        npc.serverPathLength = steps;
    }
}

export function stepNpcAlongPlannedPath(
    npc: NpcServerMovementLike,
    borderSize: number,
    collisionMap: CollisionMap,
): void {
    if ((npc.serverPathLength | 0) <= 0) {
        return;
    }
    const size = npc.getSize();
    const currX = npc.pathX[0] | 0;
    const currY = npc.pathY[0] | 0;
    const targetX = npc.serverPathX[(npc.serverPathLength - 1) | 0] | 0;
    const targetY = npc.serverPathY[(npc.serverPathLength - 1) | 0] | 0;
    const deltaX = clamp(targetX - currX, -1, 1);
    const deltaY = clamp(targetY - currY, -1, 1);
    const nextX = (currX + deltaX) | 0;
    const nextY = (currY + deltaY) | 0;

    for (let flagX = currX; flagX < currX + size; flagX++) {
        for (let flagY = currY; flagY < currY + size; flagY++) {
            collisionMap.unflag(
                (flagX + borderSize) | 0,
                (flagY + borderSize) | 0,
                CollisionFlag.BLOCK_NPCS,
            );
        }
    }

    let canMove = true;
    exit: for (let flagX = nextX; flagX < nextX + size; flagX++) {
        for (let flagY = nextY; flagY < nextY + size; flagY++) {
            if (
                collisionMap.hasFlag(
                    (flagX + borderSize) | 0,
                    (flagY + borderSize) | 0,
                    CollisionFlag.BLOCK_NPCS,
                )
            ) {
                canMove = false;
                break exit;
            }
        }
    }

    if (canMove) {
        for (let flagX = nextX; flagX < nextX + size; flagX++) {
            for (let flagY = nextY; flagY < nextY + size; flagY++) {
                collisionMap.flag(
                    (flagX + borderSize) | 0,
                    (flagY + borderSize) | 0,
                    CollisionFlag.BLOCK_NPCS,
                );
            }
        }

        npc.queuePath(nextX, nextY, MovementType.WALK);
    } else {
        for (let flagX = currX; flagX < currX + size; flagX++) {
            for (let flagY = currY; flagY < currY + size; flagY++) {
                collisionMap.flag(
                    (flagX + borderSize) | 0,
                    (flagY + borderSize) | 0,
                    CollisionFlag.BLOCK_NPCS,
                );
            }
        }
    }

    if (nextX === targetX && nextY === targetY) {
        npc.serverPathLength = (npc.serverPathLength - 1) | 0;
    }
}

export function stepNpcSimulatedServerMovement(
    npc: NpcServerMovementLike,
    pathfinder: Pathfinder,
    borderSize: number,
    collisionMaps: CollisionMap[],
): void {
    const collisionMap = collisionMaps[npc.level | 0];
    if (!collisionMap) {
        return;
    }
    planNpcLocalWanderPath(npc, pathfinder, borderSize, collisionMap);
    stepNpcAlongPlannedPath(npc, borderSize, collisionMap);
}
