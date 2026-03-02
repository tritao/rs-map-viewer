import type { AnimationFrames } from "./AnimationFrames";

export type NpcTypeAnimationEntry = Readonly<{
    npcTypeId: number;
    idleAnim?: AnimationFrames;
    walkAnim?: AnimationFrames;
}>;
