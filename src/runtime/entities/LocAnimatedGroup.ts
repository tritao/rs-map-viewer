import { SceneLocEntity } from "../build/SceneLocEntity";
import { AnimationFrames } from "../contracts/AnimationFrames";

export type LocAnimatedGroup = {
    anim: AnimationFrames;
    locs: SceneLocEntity[];
};
