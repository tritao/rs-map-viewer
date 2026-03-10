import type { DrawRange } from "../../maprender/MapRenderData";

export type AnimationFrames = {
    frames: DrawRange[];
    framesAlpha: DrawRange[] | undefined;
};
