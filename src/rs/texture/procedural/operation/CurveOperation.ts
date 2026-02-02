import { ByteBuffer } from "../../../io/ByteBuffer";
import { TEXTURE_COSINE_TABLE_Q12, TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

enum CurveInterpolationMode {
    Linear = 0,
    Cosine = 1,
    Cubic = 2,
}

export class CurveOperation extends TextureOperation {
    interpolationMode: CurveInterpolationMode = CurveInterpolationMode.Linear;

    controlPoints!: number[][];

    extrapolatedStartPoint!: number[];
    extrapolatedEndPoint!: number[];

    lookupTable: Int16Array = new Int16Array(257);

    constructor() {
        super(1, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.interpolationMode = buffer.readUnsignedByte() as CurveInterpolationMode;
            const controlPointCount = buffer.readUnsignedByte();
            this.controlPoints = new Array(controlPointCount);
            for (let controlPointIndex = 0; controlPointIndex < controlPointCount; controlPointIndex++) {
                const point = (this.controlPoints[controlPointIndex] = new Array(2));
                point[0] = buffer.readUnsignedShort();
                point[1] = buffer.readUnsignedShort();
            }
        }
    }

    computeExtrapolatedEndpoints(): void {
        const firstControlPoint = this.controlPoints[0];
        const secondControlPoint = this.controlPoints[1];
        const secondLastControlPoint = this.controlPoints[this.controlPoints.length - 2];
        const lastControlPoint = this.controlPoints[this.controlPoints.length - 1];
        this.extrapolatedStartPoint = [
            firstControlPoint[0] + firstControlPoint[0] - secondControlPoint[0],
            firstControlPoint[1] - secondControlPoint[1] + firstControlPoint[1],
        ];
        this.extrapolatedEndPoint = [
            secondLastControlPoint[0] - lastControlPoint[0] + secondLastControlPoint[0],
            secondLastControlPoint[1] - lastControlPoint[1] + secondLastControlPoint[1],
        ];
    }

    getControlPoint(index: number): number[] {
        if (index < 0) {
            return this.extrapolatedStartPoint;
        }
        if (index >= this.controlPoints.length) {
            return this.extrapolatedEndPoint;
        }
        return this.controlPoints[index];
    }

    override init() {
        if (!this.controlPoints) {
            this.controlPoints = [
                [0, 0],
                [4096, 4096],
            ];
        }
        if (this.controlPoints.length < 2) {
            throw new Error("Curve operation requires at least two control points");
        }
        if (this.interpolationMode === CurveInterpolationMode.Cubic) {
            this.computeExtrapolatedEndpoints();
        }
        this.buildLookupTable();
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache not initialized");
        }

        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const input = this.getMonochromeInput(textureGenerator, 0, line);
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                let value = (input[pixel] / 16) | 0;
                if (value < 0) {
                    value = 0;
                }
                if (value > 256) {
                    value = 256;
                }
                output[pixel] = this.lookupTable[value];
            }
        }

        return output;
    }

    buildLookupTable(): void {
        switch (this.interpolationMode) {
            case CurveInterpolationMode.Cubic:
                for (let index = 0; index < 257; index++) {
                    const inputQ12 = index * 16;
                    let segmentIndex: number;
                    for (
                        segmentIndex = 1;
                        segmentIndex < this.controlPoints.length - 1;
                        segmentIndex++
                    ) {
                        if (this.controlPoints[segmentIndex][0] > inputQ12) {
                            break;
                        }
                    }
                    const prevPoint = this.controlPoints[segmentIndex - 1];
                    const nextPoint = this.controlPoints[segmentIndex];
                    const yPrevPrev = this.getControlPoint(segmentIndex - 2)[1];
                    const yPrev = prevPoint[1];
                    const yNext = nextPoint[1];
                    const yNextNext = this.getControlPoint(segmentIndex + 1)[1];
                    const tQ12 =
                        (((inputQ12 - prevPoint[0]) * 4096) / (nextPoint[0] - prevPoint[0])) |
                        0;
                    const tSquaredQ12 = ((tQ12 * tQ12) / 4096) | 0;
                    const coefA = yPrev - yPrevPrev + (yNextNext - yNext);
                    const coefB = yPrevPrev - yPrev - coefA;
                    const coefC = yNext - yPrevPrev;
                    const coefD = yPrev;
                    const cubicTerm = (tSquaredQ12 * ((tQ12 * coefA) >> 12)) >> 12;
                    const quadraticTerm = ((tSquaredQ12 * coefB) / 4096) | 0;
                    const linearTerm = ((tQ12 * coefC) / 4096) | 0;
                    let out = linearTerm + cubicTerm + quadraticTerm + coefD;
                    if (out <= -32768) {
                        out = -32767;
                    }
                    if (out >= 32768) {
                        out = 32767;
                    }
                    this.lookupTable[index] = out;
                }
                break;
            case CurveInterpolationMode.Cosine:
                for (let index = 0; index < 257; index++) {
                    const inputQ12 = index * 16;
                    let segmentIndex: number;
                    for (
                        segmentIndex = 1;
                        segmentIndex < this.controlPoints.length - 1;
                        segmentIndex++
                    ) {
                        if (this.controlPoints[segmentIndex][0] > inputQ12) {
                            break;
                        }
                    }
                    const prevPoint = this.controlPoints[segmentIndex - 1];
                    const nextPoint = this.controlPoints[segmentIndex];
                    const tQ12 =
                        (((inputQ12 - prevPoint[0]) * 4096) / (nextPoint[0] - prevPoint[0])) |
                        0;
                    const nextWeightQ12 =
                        ((4096 - TEXTURE_COSINE_TABLE_Q12[((tQ12 & 8187) / 32) | 0]) / 2) | 0;
                    const prevWeightQ12 = 4096 - nextWeightQ12;
                    let out =
                        ((prevWeightQ12 * prevPoint[1] + nextPoint[1] * nextWeightQ12) / 4096) |
                        0;
                    if (out <= -32768) {
                        out = -32767;
                    }
                    if (out >= 32768) {
                        out = 32767;
                    }
                    this.lookupTable[index] = out;
                }
                break;
            case CurveInterpolationMode.Linear:
                for (let index = 0; index < 257; index++) {
                    const inputQ12 = index * 16;
                    let segmentIndex: number;
                    for (
                        segmentIndex = 1;
                        segmentIndex < this.controlPoints.length - 1;
                        segmentIndex++
                    ) {
                        if (this.controlPoints[segmentIndex][0] > inputQ12) {
                            break;
                        }
                    }
                    const prevPoint = this.controlPoints[segmentIndex - 1];
                    const nextPoint = this.controlPoints[segmentIndex];
                    const nextWeightQ12 =
                        (((inputQ12 - prevPoint[0]) * 4096) / (nextPoint[0] - prevPoint[0])) |
                        0;
                    const prevWeightQ12 = 4096 - nextWeightQ12;
                    let out =
                        ((prevWeightQ12 * prevPoint[1] + nextPoint[1] * nextWeightQ12) / 4096) |
                        0;
                    if (out <= -32768) {
                        out = -32767;
                    }
                    if (out >= 32768) {
                        out = 32767;
                    }
                    this.lookupTable[index] = out;
                }
                break;
        }
    }
}
