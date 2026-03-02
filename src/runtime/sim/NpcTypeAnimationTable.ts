import type { AnimationFrames } from "../contracts/AnimationFrames";

export type NpcTypeAnimationEntry = Readonly<{
    npcTypeId: number;
    idleAnim?: AnimationFrames;
    walkAnim?: AnimationFrames;
}>;
