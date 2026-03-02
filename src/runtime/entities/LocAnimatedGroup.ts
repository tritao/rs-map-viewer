import { AnimationFrames } from "../contracts/AnimationFrames";
import { SceneLocEntity } from "../build/SceneLocEntity";

export type LocAnimatedGroup = {
    anim: AnimationFrames;
    locs: SceneLocEntity[];
};
