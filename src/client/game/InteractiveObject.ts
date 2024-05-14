import { Renderable } from "./renderable/Renderable";

export class InteractiveObject {
    public z: number;

    public worldZ: number;
    public worldX: number;
    public worldY: number;

    public renderable: Renderable|null;

    public rotation: number;

    public tileLeft: number;
    public tileRight: number;
    public tileTop: number;
    public tileBottom: number;

    public anInt123: number;
    public cycle: number;
    public uid: number;
    public config: number;

    constructor() {
        this.z = 0;
        this.worldZ = 0;
        this.tileLeft = 0;
        this.worldX = 0;
        this.worldY = 0;
        this.renderable = null;
        this.rotation = 0;
        this.tileLeft = 0;
        this.tileRight = 0;
        this.tileTop = 0;
        this.tileBottom = 0;
        this.anInt123 = 0;
        this.cycle = 0;
        this.uid = 0;
        this.config = 0;
    }
}