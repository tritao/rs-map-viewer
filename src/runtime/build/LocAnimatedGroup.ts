import { SceneLocEntity } from "./SceneLocEntity";
import { AnimationFrames } from "../entities/AnimationFrames";

export type LocAnimatedGroup = {
    anim: AnimationFrames;
    locs: SceneLocEntity[];
};
