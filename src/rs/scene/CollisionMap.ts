import { LocModelType } from "../config/loctype/LocModelType";

export interface CollisionData {
    sizeX: number;
    sizeY: number;
    flags: Int32Array;
}

export enum CollisionFlag {
    Loc = 0x100,
    LocProjectile = 0x20000,

    BlockedByFloor = 0x200000,
    BlockedByFloorDecoration = 0x40000,

    WallWest = 0x80,
    WallEast = 0x8,
    WallNorth = 0x2,
    WallSouth = 0x20,

    WallNorthWest = 0x1,
    WallNorthEast = 0x4,
    WallSouthEast = 0x10,
    WallSouthWest = 0x40,

    ProjectileWallWest = 0x10000,
    ProjectileWallEast = 0x1000,
    ProjectileWallNorth = 0x400,
    ProjectileWallSouth = 0x4000,

    ProjectileWallNorthWest = 0x200,
    ProjectileWallNorthEast = 0x800,
    ProjectileWallSouthEast = 0x2000,
    ProjectileWallSouthWest = 0x8000,
}

export class CollisionMap {
    sizeX: number;
    sizeY: number;

    offsetX: number;
    offsetY: number;

    flags: Int32Array;

    static fromData(data: CollisionData): CollisionMap {
        return new CollisionMap(data.sizeX, data.sizeY, data.flags);
    }

    constructor(sizeX: number, sizeY: number, flags?: Int32Array) {
        this.sizeX = sizeX;
        this.sizeY = sizeY;
        this.offsetX = 0;
        this.offsetY = 0;
        if (flags) {
            this.flags = flags;
        } else {
            this.flags = new Int32Array(this.sizeX * this.sizeY);
            this.reset();
        }
    }

    reset(): void {
        for (let x = 0; x < this.sizeX; x++) {
            for (let y = 0; y < this.sizeY; y++) {
                if (x !== 0 && y !== 0 && x < this.sizeX - 5 && y < this.sizeY - 5) {
                    // this.setFlag(x, y, 0x1000000);
                } else {
                    // this.setFlag(x, y, 0xFFFFFF);
                }
                // this.setFlag(x, y, 0x1000000);
            }
        }
    }

    isWithinBounds(x: number, y: number): boolean {
        return x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY;
    }

    getFlag(x: number, y: number): number {
        return this.flags[x + y * this.sizeX];
    }

    hasFlag(x: number, y: number, flag: number): boolean {
        return (this.getFlag(x, y) & flag) !== 0;
    }

    setFlag(x: number, y: number, flag: number): void {
        this.flags[x + y * this.sizeX] = flag;
    }

    flag(x: number, y: number, flag: number): void {
        this.flags[x + y * this.sizeX] |= flag;
    }

    unflag(x: number, y: number, flag: number): void {
        this.flags[x + y * this.sizeX] &= ~flag;
    }

    setBlockedByFloor(x: number, y: number) {
        this.flag(x, y, CollisionFlag.BlockedByFloor);
    }

    setBlockedByFloorDec(x: number, y: number) {
        this.flag(x, y, CollisionFlag.BlockedByFloorDecoration);
    }

    addLoc(x: number, y: number, sizeX: number, sizeY: number, blockProjectile: boolean) {
        let flags = CollisionFlag.Loc;
        if (blockProjectile) {
            flags |= CollisionFlag.LocProjectile;
        }

        for (let fx = x; fx < sizeX + x; fx++) {
            if (fx >= 0 && fx < this.sizeX) {
                for (let fy = y; fy < y + sizeY; fy++) {
                    if (fy >= 0 && fy < this.sizeY) {
                        this.flag(fx, fy, flags);
                    }
                }
            }
        }
    }

    addWall(x: number, y: number, type: LocModelType, rotation: number, blockProjectile: boolean) {
        if (type === LocModelType.WALL) {
            if (rotation === 0) {
                this.flag(x, y, CollisionFlag.WallWest);
                this.flag(x - 1, y, CollisionFlag.WallEast);
            }

            if (rotation === 1) {
                this.flag(x, y, CollisionFlag.WallNorth);
                this.flag(x, y + 1, CollisionFlag.WallSouth);
            }

            if (rotation === 2) {
                this.flag(x, y, CollisionFlag.WallEast);
                this.flag(x + 1, y, CollisionFlag.WallWest);
            }

            if (rotation === 3) {
                this.flag(x, y, CollisionFlag.WallSouth);
                this.flag(x, y - 1, CollisionFlag.WallNorth);
            }
        }

        if (type === LocModelType.WALL_TRI_CORNER || type === LocModelType.WALL_RECT_CORNER) {
            if (rotation === 0) {
                this.flag(x, y, CollisionFlag.WallNorthWest);
                this.flag(x - 1, y + 1, CollisionFlag.WallSouthEast);
            }

            if (rotation === 1) {
                this.flag(x, y, CollisionFlag.WallNorthEast);
                this.flag(x + 1, y + 1, CollisionFlag.WallSouthWest);
            }

            if (rotation === 2) {
                this.flag(x, y, CollisionFlag.WallSouthEast);
                this.flag(x + 1, y - 1, CollisionFlag.WallNorthWest);
            }

            if (rotation === 3) {
                this.flag(x, y, CollisionFlag.WallSouthWest);
                this.flag(x - 1, y - 1, CollisionFlag.WallNorthEast);
            }
        }

        if (type === LocModelType.WALL_CORNER) {
            if (rotation === 0) {
                this.flag(x, y, CollisionFlag.WallWest | CollisionFlag.WallNorth);
                this.flag(x - 1, y, CollisionFlag.WallEast);
                this.flag(x, y + 1, CollisionFlag.WallSouth);
            }

            if (rotation === 1) {
                this.flag(x, y, CollisionFlag.WallEast | CollisionFlag.WallNorth);
                this.flag(x, y + 1, CollisionFlag.WallSouth);
                this.flag(x + 1, y, CollisionFlag.WallWest);
            }

            if (rotation === 2) {
                this.flag(x, y, CollisionFlag.WallEast | CollisionFlag.WallSouth);
                this.flag(x + 1, y, CollisionFlag.WallWest);
                this.flag(x, y - 1, CollisionFlag.WallNorth);
            }

            if (rotation === 3) {
                this.flag(x, y, CollisionFlag.WallWest | CollisionFlag.WallSouth);
                this.flag(x, y - 1, CollisionFlag.WallNorth);
                this.flag(x - 1, y, CollisionFlag.WallEast);
            }
        }

        if (blockProjectile) {
            if (type === LocModelType.WALL) {
                if (rotation === 0) {
                    this.flag(x, y, CollisionFlag.ProjectileWallWest);
                    this.flag(x - 1, y, CollisionFlag.ProjectileWallEast);
                }

                if (rotation === 1) {
                    this.flag(x, y, CollisionFlag.ProjectileWallNorth);
                    this.flag(x, y + 1, CollisionFlag.ProjectileWallSouth);
                }

                if (rotation === 2) {
                    this.flag(x, y, CollisionFlag.ProjectileWallEast);
                    this.flag(x + 1, y, CollisionFlag.ProjectileWallWest);
                }

                if (rotation === 3) {
                    this.flag(x, y, CollisionFlag.ProjectileWallSouth);
                    this.flag(x, y - 1, CollisionFlag.ProjectileWallNorth);
                }
            }

            if (type === LocModelType.WALL_TRI_CORNER || type === LocModelType.WALL_RECT_CORNER) {
                if (rotation === 0) {
                    this.flag(x, y, CollisionFlag.ProjectileWallNorthWest);
                    this.flag(x - 1, y + 1, CollisionFlag.ProjectileWallSouthEast);
                }

                if (rotation === 1) {
                    this.flag(x, y, CollisionFlag.ProjectileWallNorthEast);
                    this.flag(x + 1, y + 1, CollisionFlag.ProjectileWallSouthWest);
                }

                if (rotation === 2) {
                    this.flag(x, y, CollisionFlag.ProjectileWallSouthEast);
                    this.flag(x + 1, y - 1, CollisionFlag.ProjectileWallNorthWest);
                }

                if (rotation === 3) {
                    this.flag(x, y, CollisionFlag.ProjectileWallSouthWest);
                    this.flag(x - 1, y - 1, CollisionFlag.ProjectileWallNorthEast);
                }
            }

            if (type === LocModelType.WALL_CORNER) {
                if (rotation === 0) {
                    this.flag(
                        x,
                        y,
                        CollisionFlag.ProjectileWallWest | CollisionFlag.ProjectileWallNorth,
                    );
                    this.flag(x - 1, y, CollisionFlag.ProjectileWallEast);
                    this.flag(x, y + 1, CollisionFlag.ProjectileWallSouth);
                }

                if (rotation === 1) {
                    this.flag(
                        x,
                        y,
                        CollisionFlag.ProjectileWallEast | CollisionFlag.ProjectileWallNorth,
                    );
                    this.flag(x, y + 1, CollisionFlag.ProjectileWallSouth);
                    this.flag(x + 1, y, CollisionFlag.ProjectileWallWest);
                }

                if (rotation === 2) {
                    this.flag(
                        x,
                        y,
                        CollisionFlag.ProjectileWallEast | CollisionFlag.ProjectileWallSouth,
                    );
                    this.flag(x + 1, y, CollisionFlag.ProjectileWallWest);
                    this.flag(x, y - 1, CollisionFlag.ProjectileWallNorth);
                }

                if (rotation === 3) {
                    this.flag(
                        x,
                        y,
                        CollisionFlag.ProjectileWallWest | CollisionFlag.ProjectileWallSouth,
                    );
                    this.flag(x, y - 1, CollisionFlag.ProjectileWallNorth);
                    this.flag(x - 1, y, CollisionFlag.ProjectileWallEast);
                }
            }
        }
    }
}
