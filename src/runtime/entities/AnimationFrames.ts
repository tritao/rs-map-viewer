import type { DrawRange } from "../contracts/DrawRange";

export type AnimationFrames = {
    frames: DrawRange[];
    framesAlpha: DrawRange[] | undefined;
};
