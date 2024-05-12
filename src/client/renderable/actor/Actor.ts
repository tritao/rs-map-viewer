import { Renderable } from "../Renderable";

export abstract class Actor extends Renderable {
    public forcedChat: string|null;
    public textCycle: number = 100;
    public textColour: number;

    public nextStepOrientation: number;
    public pulseCycle: number;

    public pathX: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    public pathY: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    public movementAnimation: number = -1;
    public displayedMovementFrames: number;
    public movementCycle: number;

    public runningQueue: boolean[] = [false, false, false, false, false, false, false, false, false, false];

    public dynamic: boolean = false;

    public textEffect: number;

    public modelHeight: number = 200;

    public endCycle: number = -1000;

    public anInt1596: number;

    public anInt1597: number;

    public faceX: number;
    public faceY: number;

    public turnSpeed: number = 32;

    public boundaryDimension: number = 1;

    public movementStartX: number;
    public movementEndX: number;
    public movementStartY: number;
    public movementEndY: number;
    public moveCycleEnd: number;
    public moveCycleStart: number;
    public moveDirection: number;

    public faceActor: number = -1;

    public worldX: number;
    public worldY: number;

    public currentRotation: number;
    public stillPathPosition: number;

    public graphic: number = -1;

    public currentAnimation: number;

    public anInt1616: number;

    public anInt1617: number;

    public spotAnimationDelay: number;

    public walkAnimationId: number = -1;

    public turnAroundAnimationId: number = -1;
    public turnRightAnimationId: number = -1;
    public turnLeftAnimationId: number = -1;

    public resyncWalkCycle: number;

    public emoteAnimation: number = -1;

    public displayedEmoteFrames: number;

    public animationSequence: number;

    public animationDelay: number;

    public animationResetCycle: number;

    public runAnimationId: number = -1;

    public hitDamages: number[] = [0, 0, 0, 0];
    public hitTypes: number[] = [0, 0, 0, 0];
    public hitCycles: number[] = [0, 0, 0, 0];

    public pathLength: number;

    public idleAnimation: number = -1;
    public standTurnAnimationId: number = -1;

    constructor() {
        super();
        this.forcedChat = null;
        this.textColour = 0;
        this.nextStepOrientation = 0;
        this.pulseCycle = 0;
        this.displayedMovementFrames = 0;
        this.movementCycle = 0;
        this.textEffect = 0;
        this.anInt1596 = 0;
        this.anInt1597 = 0;
        this.faceX = 0;
        this.faceY = 0;
        this.movementStartX = 0;
        this.movementEndX = 0;
        this.movementStartY = 0;
        this.movementEndY = 0;
        this.moveCycleEnd = 0;
        this.moveCycleStart = 0;
        this.moveDirection = 0;
        this.worldX = 0;
        this.worldY = 0;
        this.currentRotation = 0;
        this.stillPathPosition = 0;
        this.currentAnimation = 0;
        this.anInt1616 = 0;
        this.anInt1617 = 0;
        this.spotAnimationDelay = 0;
        this.resyncWalkCycle = 0;
        this.displayedEmoteFrames = 0;
        this.animationSequence = 0;
        this.animationDelay = 0;
        this.animationResetCycle = 0;
        this.pathLength = 0;
    }

    public resetPath() {
        this.pathLength = 0;
        this.stillPathPosition = 0;
    }

    public isVisible(): boolean {
        return false;
    }

    public move(direction: number, running: boolean) {
        let x: number = this.pathX[0];
        let y: number = this.pathY[0];
        if (direction === 0) {
            x--;
            y++;
        }
        if (direction === 1) { y++; }
        if (direction === 2) {
            x++;
            y++;
        }
        if (direction === 3) { x--; }
        if (direction === 4) { x++; }
        if (direction === 5) {
            x--;
            y--;
        }
        if (direction === 6) { y--; }
        if (direction === 7) {
            x++;
            y--;
        }
        //if (this.emoteAnimation !== -1 && AnimationSequence.animations[this.emoteAnimation].priority === 1) { this.emoteAnimation = -1; }
        if (this.pathLength < 9) { this.pathLength++; }
        for (let pos: number = this.pathLength; pos > 0; pos--) {{
            this.pathX[pos] = this.pathX[pos - 1];
            this.pathY[pos] = this.pathY[pos - 1];
            this.runningQueue[pos] = this.runningQueue[pos - 1];
        }}
        this.pathX[0] = x;
        this.pathY[0] = y;
        this.runningQueue[0] = running;
    }

    public updateHits(hitType: number, hitDamage: number, hitCycle: number) {
        for (let hit: number = 0; hit < 4; hit++) {if (this.hitCycles[hit] <= hitCycle) {
            this.hitDamages[hit] = hitDamage;
            this.hitTypes[hit] = hitType;
            this.hitCycles[hit] = hitCycle + 70;
            return;
        }}
    }

    public setPosition(x: number, y: number, discard: boolean) {
        //if (this.emoteAnimation !== -1 && AnimationSequence.animations[this.emoteAnimation].priority === 1) { this.emoteAnimation = -1; }
        if (!discard) {
            const k: number = x - this.pathX[0];
            const i1: number = y - this.pathY[0];
            if (k >= -8 && k <= 8 && i1 >= -8 && i1 <= 8) {
                if (this.pathLength < 9) { this.pathLength++; }
                for (let j1: number = this.pathLength; j1 > 0; j1--) {{
                    this.pathX[j1] = this.pathX[j1 - 1];
                    this.pathY[j1] = this.pathY[j1 - 1];
                    this.runningQueue[j1] = this.runningQueue[j1 - 1];
                }}
                this.pathX[0] = x;
                this.pathY[0] = y;
                this.runningQueue[0] = false;
                return;
            }
        }
        this.pathLength = 0;
        this.stillPathPosition = 0;
        this.resyncWalkCycle = 0;
        this.pathX[0] = x;
        this.pathY[0] = y;
        this.worldX = this.pathX[0] * 128 + this.boundaryDimension * 64;
        this.worldY = this.pathY[0] * 128 + this.boundaryDimension * 64;
    }
}
