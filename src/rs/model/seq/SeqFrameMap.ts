import { SeqFrame } from "./SeqFrame";

export class SeqFrameMap {
    constructor(readonly frames: Array<SeqFrame | undefined>) {}

    hasAlphaTransform(frame: number) {
        return this.frames[frame]?.hasAlphaTransform ?? false;
    }
}
