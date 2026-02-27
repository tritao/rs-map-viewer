import { DecodeError } from "../../core/DecodeError";
import { SeqFrame } from "./SeqFrame";

export class SeqFrameMap {
    constructor(
        readonly frames: Array<SeqFrame | undefined>,
        readonly errors: Map<number, DecodeError> = new Map(),
    ) {}

    hasAlphaTransform(frame: number) {
        return this.frames[frame]?.hasAlphaTransform ?? false;
    }
}
