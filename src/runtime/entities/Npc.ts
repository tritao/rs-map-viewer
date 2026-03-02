import { NpcType } from "../../rs/config/npctype/NpcType";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import { clamp } from "../../util/MathUtil";
import { AnimationFrames } from "../contracts/AnimationFrames";

export enum MovementType {
    CRAWL = 0,
    WALK = 1,
    RUN = 2,
}

const DIRECTION_ROTATIONS = [768, 1024, 1280, 512, 1536, 256, 0, 1792];

export class Npc {
    rotation: number = 0;
    orientation: number = 0;

    pathX: number[] = new Array(10);
    pathY: number[] = new Array(10);
    pathMovementType: MovementType[] = new Array(10);
    pathLength: number = 0;

    serverPathX: number[] = new Array(25);
    serverPathY: number[] = new Array(25);
    serverPathMovementType: MovementType[] = new Array(25);
    serverPathLength: number = 0;

    x: number;
    y: number;

    movementSeqId: number = -1;
    movementFrame: number = 0;
    movementFrameTick: number = 0;
    movementLoop: number = 0;

    constructor(
        readonly spawnX: number,
        readonly spawnY: number,
        readonly level: number,
        readonly idleAnim: AnimationFrames | undefined,
        readonly walkAnim: AnimationFrames | undefined,
        readonly npcType: NpcType,
        readonly idleSeqId: number,
        readonly walkSeqId: number,
        readonly orderKey?: number,
    ) {
        this.rotation = DIRECTION_ROTATIONS[npcType.spawnDirection];

        this.pathX[0] = clamp(spawnX, 0, 64 - npcType.size);
        this.pathY[0] = clamp(spawnY, 0, 64 - npcType.size);

        this.x = this.pathX[0] * 128 + npcType.size * 64;
        this.y = this.pathY[0] * 128 + npcType.size * 64;
    }

    getSize(): number {
        return this.npcType.size;
    }

    canWalk(): boolean {
        if (this.npcType.cacheInfo.revision >= 508) {
            return (this.npcType.loginScreenProps & 0x2) > 0 && this.walkSeqId !== -1;
        }
        return this.walkSeqId !== -1 && this.walkSeqId !== this.idleSeqId;
    }

    queuePathDir(dir: number, movementType: MovementType) {
        let x = this.pathX[0];
        let y = this.pathY[0];
        switch (dir) {
            case 0:
                x--;
                y++;
                break;
            case 1:
                y++;
                break;
            case 2:
                x++;
                y++;
                break;
            case 3:
                x--;
                break;
            case 4:
                x++;
                break;
            case 5:
                x--;
                y--;
                break;
            case 6:
                y--;
                break;
            case 7:
                x++;
                y--;
                break;
        }

        if (this.pathLength < 9) {
            this.pathLength++;
        }

        for (let i = this.pathLength; i > 0; i--) {
            this.pathX[i] = this.pathX[i - 1];
            this.pathY[i] = this.pathY[i - 1];
            this.pathMovementType[i] = this.pathMovementType[i - 1];
        }

        this.pathX[0] = clamp(x, 0, 64 - this.npcType.size - 1);
        this.pathY[0] = clamp(y, 0, 64 - this.npcType.size - 1);
        this.pathMovementType[0] = movementType;
    }

    queuePath(x: number, y: number, movementType: MovementType) {
        if (this.pathLength < 9) {
            this.pathLength++;
        }

        for (let i = this.pathLength; i > 0; i--) {
            this.pathX[i] = this.pathX[i - 1];
            this.pathY[i] = this.pathY[i - 1];
            this.pathMovementType[i] = this.pathMovementType[i - 1];
        }

        this.pathX[0] = clamp(x, 0, 64 - this.npcType.size - 1);
        this.pathY[0] = clamp(y, 0, 64 - this.npcType.size - 1);
        this.pathMovementType[0] = movementType;
    }

    private updateMovementTransformState() {
        this.movementSeqId = this.idleSeqId;
        if (this.pathLength > 0) {
            const currX = this.x;
            const currY = this.y;
            const nextX = this.pathX[this.pathLength - 1] * 128 + this.npcType.size * 64;
            const nextY = this.pathY[this.pathLength - 1] * 128 + this.npcType.size * 64;

            if (currX < nextX) {
                if (currY < nextY) {
                    this.orientation = 1280;
                } else if (currY > nextY) {
                    this.orientation = 1792;
                } else {
                    this.orientation = 1536;
                }
            } else if (currX > nextX) {
                if (currY < nextY) {
                    this.orientation = 768;
                } else if (currY > nextY) {
                    this.orientation = 256;
                } else {
                    this.orientation = 512;
                }
            } else if (currY < nextY) {
                this.orientation = 1024;
            } else if (currY > nextY) {
                this.orientation = 0;
            }

            this.movementSeqId = this.walkSeqId;

            const movementType = this.pathMovementType[this.pathLength - 1];
            if (
                nextX - currX <= 256 &&
                nextX - currX >= -256 &&
                nextY - currY <= 256 &&
                nextY - currY >= -256
            ) {
                let movementSpeed = 4;

                if (this.npcType.isClickable) {
                    if (this.rotation !== this.orientation && this.npcType.rotationSpeed !== 0) {
                        movementSpeed = 2;
                    }
                    if (this.pathLength > 2) {
                        movementSpeed = 6;
                    }
                    if (this.pathLength > 3) {
                        movementSpeed = 8;
                    }
                } else {
                    if (this.pathLength > 1) {
                        movementSpeed = 6;
                    }
                    if (this.pathLength > 2) {
                        movementSpeed = 8;
                    }
                }

                if (movementType === MovementType.RUN) {
                    movementSpeed <<= 1;
                } else if (movementType === MovementType.CRAWL) {
                    movementSpeed >>= 1;
                }

                if (currX !== nextX || currY !== nextY) {
                    if (currX < nextX) {
                        this.x += movementSpeed;
                        if (this.x > nextX) {
                            this.x = nextX;
                        }
                    } else if (currX > nextX) {
                        this.x -= movementSpeed;
                        if (this.x < nextX) {
                            this.x = nextX;
                        }
                    }

                    if (currY < nextY) {
                        this.y += movementSpeed;
                        if (this.y > nextY) {
                            this.y = nextY;
                        }
                    } else if (currY > nextY) {
                        this.y -= movementSpeed;
                        if (this.y < nextY) {
                            this.y = nextY;
                        }
                    }
                }

                if (this.x === nextX && this.y === nextY) {
                    this.pathLength--;
                }
            } else {
                this.x = nextX;
                this.y = nextY;
                this.pathLength--;
            }
        }

        const deltaRotation = (this.orientation - this.rotation) & 2047;
        if (deltaRotation !== 0) {
            const rotateDir = deltaRotation > 1024 ? -1 : 1;
            this.rotation += rotateDir * this.npcType.rotationSpeed;
            if (
                deltaRotation < this.npcType.rotationSpeed ||
                deltaRotation > 2048 - this.npcType.rotationSpeed
            ) {
                this.rotation = this.orientation;
            }

            this.rotation &= 2047;
        }
    }

    updateMovementTransformOnly() {
        this.updateMovementTransformState();
    }

    updateMovement(seqTypeLoader: SeqTypeLoader, seqFrameLoader: SeqFrameLoader) {
        this.updateMovementTransformState();

        this.updateMovementSeq(seqTypeLoader, seqFrameLoader);
    }

    updateMovementSeq(seqTypeLoader: SeqTypeLoader, seqFrameLoader: SeqFrameLoader) {
        if (this.movementSeqId !== -1) {
            const seqResult = seqTypeLoader.tryLoad(this.movementSeqId);
            if (!seqResult.ok) {
                return;
            }
            const seqType = seqResult.value;
            if (!seqType.hasAnimMayaSeq() && seqType.frameIds) {
                this.movementFrameTick++;
                if (
                    this.movementFrame < seqType.frameIds.length &&
                    this.movementFrameTick >
                        seqType.getFrameLength(seqFrameLoader, this.movementFrame)
                ) {
                    this.movementFrameTick = 1;
                    this.movementFrame++;
                }

                if (this.movementFrame >= seqType.frameIds.length) {
                    if (seqType.frameStep > 0) {
                        this.movementFrame -= seqType.frameStep;
                        if (seqType.looping) {
                            this.movementLoop++;
                        }

                        if (
                            this.movementFrame < 0 ||
                            this.movementFrame >= seqType.frameIds.length ||
                            (seqType.looping && this.movementLoop >= seqType.maxLoops)
                        ) {
                            this.movementFrameTick = 0;
                            this.movementFrame = 0;
                            this.movementLoop = 0;
                        } else {
                            this.movementFrameTick = 0;
                            this.movementFrame = 0;
                        }
                    } else {
                        this.movementFrameTick = 0;
                        this.movementFrame = 0;
                    }
                }
            } else if (seqType.hasAnimMayaSeq()) {
                this.movementFrame++;
                const frameCount = seqType.getAnimMayaDuration();
                if (this.movementFrame >= frameCount) {
                    if (seqType.frameStep > 0) {
                        this.movementFrame -= seqType.frameStep;
                        if (seqType.looping) {
                            this.movementLoop++;
                        }

                        if (
                            this.movementFrame < 0 ||
                            this.movementFrame >= seqType.frameIds.length ||
                            (seqType.looping && this.movementLoop >= seqType.maxLoops)
                        ) {
                            this.movementFrameTick = 0;
                            this.movementFrame = 0;
                            this.movementLoop = 0;
                        } else {
                            this.movementFrameTick = 0;
                            this.movementFrame = 0;
                        }
                    } else {
                        this.movementFrameTick = 0;
                        this.movementFrame = 0;
                    }
                }
            } else {
                this.movementSeqId = -1;
            }
        }
    }

    getAnimationFrames(): AnimationFrames | undefined {
        return this.walkAnim && this.movementSeqId === this.walkSeqId
            ? this.walkAnim
            : this.idleAnim;
    }
}
