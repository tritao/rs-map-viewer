import { AnimationFrames } from "../../renderer/AnimationFrames";
import { SceneLocEntity } from "../build/SceneLocEntity";

export type LocAnimatedGroup = {
    anim: AnimationFrames;
    locs: SceneLocEntity[];
};
