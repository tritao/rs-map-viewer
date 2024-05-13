import { Renderable } from "../Renderable";

export abstract class Actor extends Renderable {
    public pulseCycle: number;
    public dynamic: boolean = false;
    public size: number = 1;

    // Position-related data
    public worldX: number;
    public worldY: number;
    public modelHeight: number = 200;

    public currentRotation: number;
    public stillPathPosition: number;
    public nextStepOrientation: number;
    public degreesToTurn: number = 32;

    // Movement-related data
    public pathX: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    public pathY: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    public pathLength: number;

    public runningQueue: boolean[] = [false, false, false, false, false, false, false, false, false, false];
    public movementCycle: number;
    public endCycle: number = -1000;
    public resyncWalkCycle: number;

    public movementStartX: number;
    public movementEndX: number;
    public movementStartY: number;
    public movementEndY: number;
    public moveCycleEnd: number;
    public moveCycleStart: number;
    public moveDirection: number;

    public movementAnimation: number = -1;
    public displayedMovementFrames: number;

    public faceX: number;
    public faceY: number;
    public faceActor: number = -1;

    // Graphics-related data
    public graphic: number = -1;
    public spotGraphicHeight: number;
    public spotGraphicDelay: number;

    // Animation-related data
    public currentAnimation: number;
    public animationSequence: number;
    public animationDelay: number;
    public animationCycle: number;
    public animationResetCycle: number;

    public emoteAnimation: number = -1;
    public displayedEmoteFrames: number;

    public idleAnimation: number = -1;
    public runAnimationId: number = -1;
    public walkAnimationId: number = -1;
    public turnAroundAnimationId: number = -1;
    public turnRightAnimationId: number = -1;
    public turnLeftAnimationId: number = -1;
    public standTurnAnimationId: number = -1;

    // Chat-related data
    public forcedChat: string|null;
    public textCycle: number = 100;
    public textColour: number;
    public textEffect: number;

    // Hit-related data
    public hitDamages: number[] = [0, 0, 0, 0];
    public hitTypes: number[] = [0, 0, 0, 0];
    public hitCycles: number[] = [0, 0, 0, 0];

    // Health-related data
    public health: number;
    public maximumHealth: number;

    constructor() {
        super();
        this.forcedChat = null;
        this.textColour = 0;
        this.nextStepOrientation = 0;
        this.pulseCycle = 0;
        this.displayedMovementFrames = 0;
        this.movementCycle = 0;
        this.textEffect = 0;
        this.health = 0;
        this.maximumHealth = 0;
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
        this.animationCycle = 0;
        this.spotGraphicDelay = 0;
        this.spotGraphicHeight = 0;
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

    public setPosition(x: number, y: number, discard: boolean) {
        //if (this.emoteAnimation !== -1 && AnimationSequence.animations[this.emoteAnimation].priority === 1) { this.emoteAnimation = -1; }
        if (!discard) {
            const distX: number = x - this.pathX[0];
            const distY: number = y - this.pathY[0];
            if (distX >= -8 && distX <= 8 && distY >= -8 && distY <= 8) {
                if (this.pathLength < 9) { this.pathLength++; }
                for (let i = this.pathLength; i > 0; i--) {{
                    this.pathX[i] = this.pathX[i - 1];
                    this.pathY[i] = this.pathY[i - 1];
                    this.runningQueue[i] = this.runningQueue[i - 1];
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
        this.worldX = this.pathX[0] * 128 + this.size * 64;
        this.worldY = this.pathY[0] * 128 + this.size * 64;
    }

    public updateHits(hitType: number, hitDamage: number, hitCycle: number) {
        for (let hit: number = 0; hit < 4; hit++) {if (this.hitCycles[hit] <= hitCycle) {
            this.hitDamages[hit] = hitDamage;
            this.hitTypes[hit] = hitType;
            this.hitCycles[hit] = hitCycle + 70;
            return;
        }}
    }
}
