import { Node } from "./collection/Node";

export enum SpawnObjectClassType {
    Wall = 0,
    WallDecoration = 1,
    Loc = 2,
    FloorDecoration = 3
}

export class SpawnObjectNode extends Node {
    public locationIndex: number;
    public locationRotation: number;
    public locationType: number;
    public index: number;
    public rotation: number;
    public type: number;
    public cycle: number = -1;
    public plane: number;
    public classType: SpawnObjectClassType;
    public x: number;
    public y: number;
    public spawnCycle: number;

    constructor() {
        super();
        this.locationIndex = 0;
        this.locationRotation = 0;
        this.locationType = 0;
        this.index = 0;
        this.rotation = 0;
        this.type = 0;
        this.plane = 0;
        this.classType = SpawnObjectClassType.Wall
        this.x = 0;
        this.y = 0;
        this.spawnCycle = 0;
    }
}
