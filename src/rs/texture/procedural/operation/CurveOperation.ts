import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class CurveOperation extends TextureOperation {
    interpolationMode: number = 0;

    controlPoints!: number[][];

    extrapolatedStartPoint!: number[];
    extrapolatedEndPoint!: number[];

    lookupTable: Int16Array = new Int16Array(257);

    constructor() {
        super(1, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.interpolationMode = buffer.readUnsignedByte();
            const controlPointCount = buffer.readUnsignedByte();
            this.controlPoints = new Array(controlPointCount);
            for (let i = 0; i < controlPointCount; i++) {
                const point = (this.controlPoints[i] = new Array(2));
                point[0] = buffer.readUnsignedShort();
                point[1] = buffer.readUnsignedShort();
            }
        }
    }

    computeExtrapolatedEndpoints(): void {
        const start0 = this.controlPoints[0];
        const start1 = this.controlPoints[1];
        const end0 = this.controlPoints[this.controlPoints.length - 2];
        const end1 = this.controlPoints[this.controlPoints.length - 1];
        this.extrapolatedStartPoint = [
            start0[0] + start0[0] - start1[0],
            start0[1] - start1[1] + start0[1],
        ];
        this.extrapolatedEndPoint = [end0[0] - end1[0] + end0[0], end0[1] - end1[1] + end0[1]];
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
        if (this.interpolationMode === 2) {
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
            case 2:
                for (let index = 0; index < 257; index++) {
                    const indexTimes16 = index * 16;
                    let segmentIndex: number;
                    for (
                        segmentIndex = 1;
                        segmentIndex < this.controlPoints.length - 1;
                        segmentIndex++
                    ) {
                        if (this.controlPoints[segmentIndex][0] > indexTimes16) {
                            break;
                        }
                    }
                    const prevPoint = this.controlPoints[segmentIndex - 1];
                    const nextPoint = this.controlPoints[segmentIndex];
                    const yPrevPrev = this.getControlPoint(segmentIndex - 2)[1];
                    const yPrev = prevPoint[1];
                    const yNext = nextPoint[1];
                    const yNextNext = this.getControlPoint(segmentIndex + 1)[1];
                    const interpIn =
                        (((indexTimes16 - prevPoint[0]) * 4096) / (nextPoint[0] - prevPoint[0])) |
                        0;
                    const xSq = ((interpIn * interpIn) / 4096) | 0;
                    const coefA = yPrev - yPrevPrev + (yNextNext - yNext);
                    const coefB = yPrevPrev - yPrev - coefA;
                    const coefC = yNext - yPrevPrev;
                    const coefD = yPrev;
                    const cubicTerm = (xSq * ((interpIn * coefA) >> 12)) >> 12;
                    const quadraticTerm = ((xSq * coefB) / 4096) | 0;
                    const linearTerm = ((interpIn * coefC) / 4096) | 0;
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
            case 1: // COSINE INTERPOLATION
                for (let index = 0; index < 257; index++) {
                    const indexTimes16 = index * 16;
                    let segmentIndex: number;
                    for (
                        segmentIndex = 1;
                        segmentIndex < this.controlPoints.length - 1;
                        segmentIndex++
                    ) {
                        if (this.controlPoints[segmentIndex][0] > indexTimes16) {
                            break;
                        }
                    }
                    const prevPoint = this.controlPoints[segmentIndex - 1];
                    const nextPoint = this.controlPoints[segmentIndex];
                    const interpIn =
                        (((indexTimes16 - prevPoint[0]) * 4096) / (nextPoint[0] - prevPoint[0])) |
                        0;
                    const nMul =
                        ((4096 - TextureGenerator.COSINE[((interpIn & 8187) / 32) | 0]) / 2) | 0;
                    const pMul = 4096 - nMul;
                    let out = ((pMul * prevPoint[1] + nextPoint[1] * nMul) / 4096) | 0;
                    if (out <= -32768) {
                        out = -32767;
                    }
                    if (out >= 32768) {
                        out = 32767;
                    }
                    this.lookupTable[index] = out;
                }
                break;
            case 0: // LINEAR INTERPOLATION
                for (let index = 0; index < 257; index++) {
                    const indexTimes16 = index * 16;
                    let segmentIndex: number;
                    for (
                        segmentIndex = 1;
                        segmentIndex < this.controlPoints.length - 1;
                        segmentIndex++
                    ) {
                        if (this.controlPoints[segmentIndex][0] > indexTimes16) {
                            break;
                        }
                    }
                    const prevPoint = this.controlPoints[segmentIndex - 1];
                    const nextPoint = this.controlPoints[segmentIndex];
                    const nMul =
                        (((indexTimes16 - prevPoint[0]) * 4096) / (nextPoint[0] - prevPoint[0])) |
                        0;
                    const pMul = 4096 - nMul;
                    let out = ((pMul * prevPoint[1] + nextPoint[1] * nMul) / 4096) | 0;
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
