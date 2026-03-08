import type { AnimationFrames } from "../entities/AnimationFrames";

export type NpcTypeAnimationEntry = Readonly<{
    npcTypeId: number;
    idleAnim?: AnimationFrames;
    walkAnim?: AnimationFrames;
}>;
