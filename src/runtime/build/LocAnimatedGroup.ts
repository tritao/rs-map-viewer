import { SceneLocEntity } from "./SceneLocEntity";
import { AnimationFrames } from "../entities/AnimationFrames";
import { LocModelType } from "../../rs/config/loctype/LocModelType";

export type LocAnimatedGroup = {
    anim: AnimationFrames;
    locs: SceneLocEntity[];
};

export function createLocAnimatedGroupKey(
    rotation: number,
    type: LocModelType,
    locTypeId: number,
): number {
    return rotation + (type << 3) + (locTypeId << 10);
}
