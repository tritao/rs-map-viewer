import { LocModelType } from "../rs/config/loctype/LocModelType";
import { AnimationFrames } from "./entities/AnimationFrames";

export type LocAnimatedData = {
    locTypeId: number;
    locModelType: LocModelType;
    rotation: number;
    level: number;
    tileX: number;
    tileY: number;

    drawRangeIndex: number;
    drawRangeAlphaIndex: number;

    drawRangeLodIndex: number;
    drawRangeLodAlphaIndex: number;

    drawRangeInteractIndex: number;
    drawRangeInteractAlphaIndex: number;

    drawRangeInteractLodIndex: number;
    drawRangeInteractLodAlphaIndex: number;

    anim: AnimationFrames;

    seqId: number;
    randomStart: boolean;
};
