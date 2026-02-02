import JavaRandom from "../../../../util/JavaRandom";
import { nextIntJagex } from "../../../../util/MathUtil";
import { ByteBuffer } from "../../../io/ByteBuffer";
import { createPermutations, TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

enum VoronoiOutputMode {
    Nearest = 0,
    SecondNearest = 1,
    SecondMinusNearest = 2,
    ThirdNearest = 3,
    FourthNearest = 4,
}

export class VoronoiNoiseOperation extends TextureOperation {
    seed: number = 0;
    featurePointJitterQ12: number = 2048;
    outputMode: VoronoiOutputMode = VoronoiOutputMode.SecondMinusNearest;
    distanceMetric: number = 1;
    repeatX: number = 5;
    repeatY: number = 5;

    permutations: Int8Array = new Int8Array(512);
    featurePointOffsetsQ12: Int16Array = new Int16Array(512);

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        switch (field) {
            case 0:
                this.repeatX = this.repeatY = buffer.readUnsignedByte();
                break;
            case 1:
                this.seed = buffer.readUnsignedByte();
                break;
            case 2:
                this.featurePointJitterQ12 = buffer.readUnsignedShort();
                break;
            case 3:
                this.outputMode = buffer.readUnsignedByte() as VoronoiOutputMode;
                break;
            case 4:
                this.distanceMetric = buffer.readUnsignedByte();
                break;
            case 5:
                this.repeatX = buffer.readUnsignedByte();
                break;
            case 6:
                this.repeatY = buffer.readUnsignedByte();
                break;
        }
    }

    override init() {
        this.permutations = createPermutations(this.seed);
        this.initFeaturePointOffsets();
    }

    initFeaturePointOffsets(): void {
        const random = new JavaRandom(this.seed);
        this.featurePointOffsetsQ12 = new Int16Array(512);
        if (this.featurePointJitterQ12 > 0) {
            for (let i = 0; i < 512; i++) {
                this.featurePointOffsetsQ12[i] = nextIntJagex(random, this.featurePointJitterQ12);
            }
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const yCoordQ12 = 2048 + this.repeatY * textureGenerator.verticalGradient[line];
            const cellY = yCoordQ12 >> 12;
            const cellYNext = cellY + 1;
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                let nearestDistQ12 = 2147483647;
                let secondNearestDistQ12 = 2147483647;
                let thirdNearestDistQ12 = 2147483647;
                let fourthNearestDistQ12 = 2147483647;

                const xCoordQ12 = this.repeatX * textureGenerator.horizontalGradient[pixel] + 2048;
                const cellX = xCoordQ12 >> 12;
                const cellXNext = cellX + 1;
                for (let yNeighbor = cellY - 1; yNeighbor <= cellYNext; yNeighbor++) {
                    const yPermutation =
                        this.permutations[
                            (yNeighbor >= this.repeatY ? yNeighbor - this.repeatY : yNeighbor) &
                                0xff
                        ] & 0xff;
                    for (let xNeighbor = cellX - 1; xNeighbor <= cellXNext; xNeighbor++) {
                        let featureIndex =
                            (this.permutations[
                                ((xNeighbor >= this.repeatX
                                    ? xNeighbor - this.repeatX
                                    : xNeighbor) +
                                    yPermutation) &
                                    0xff
                            ] &
                                0xff) *
                            2;

                        let dxQ12 =
                            xCoordQ12 -
                            (this.featurePointOffsetsQ12[featureIndex++] + (xNeighbor << 12));
                        let dyQ12 =
                            yCoordQ12 -
                            (this.featurePointOffsetsQ12[featureIndex] + (yNeighbor << 12));
                        let distQ12: number;
                        switch (this.distanceMetric) {
                            case 1:
                                distQ12 = (dxQ12 * dxQ12 + dyQ12 * dyQ12) >> 12;
                                break;
                            case 2:
                                distQ12 =
                                    (dyQ12 < 0 ? -dyQ12 : dyQ12) + (dxQ12 < 0 ? -dxQ12 : dxQ12);
                                break;
                            case 3:
                                dxQ12 = dxQ12 < 0 ? -dxQ12 : dxQ12;
                                dyQ12 = dyQ12 < 0 ? -dyQ12 : dyQ12;
                                distQ12 = Math.max(dxQ12, dyQ12);
                                break;
                            case 4:
                                dxQ12 =
                                    (Math.sqrt(Math.fround(dxQ12 < 0 ? -dxQ12 : dxQ12) / 4096.0) *
                                        4096.0) |
                                    0;
                                dyQ12 =
                                    (Math.sqrt(Math.fround(dyQ12 < 0 ? -dyQ12 : dyQ12) / 4096.0) *
                                        4096.0) |
                                    0;
                                distQ12 = dyQ12 + dxQ12;
                                distQ12 = (distQ12 * distQ12) >> 12;
                                break;

                            case 5:
                                dxQ12 *= dxQ12;
                                dyQ12 *= dyQ12;
                                distQ12 =
                                    (Math.sqrt(
                                        Math.sqrt(Math.fround((dxQ12 + dyQ12) / 1.6777216e7)),
                                    ) *
                                        4096.0) |
                                    0;
                                break;
                            default:
                                distQ12 =
                                    (Math.sqrt(
                                        Math.fround((dyQ12 * dyQ12 + dxQ12 * dxQ12) / 1.6777216e7),
                                    ) *
                                        4096.0) |
                                    0;
                                break;
                        }

                        if (distQ12 < nearestDistQ12) {
                            fourthNearestDistQ12 = thirdNearestDistQ12;
                            thirdNearestDistQ12 = secondNearestDistQ12;
                            secondNearestDistQ12 = nearestDistQ12;
                            nearestDistQ12 = distQ12;
                        } else if (distQ12 < secondNearestDistQ12) {
                            fourthNearestDistQ12 = thirdNearestDistQ12;
                            thirdNearestDistQ12 = secondNearestDistQ12;
                            secondNearestDistQ12 = distQ12;
                        } else if (distQ12 < thirdNearestDistQ12) {
                            fourthNearestDistQ12 = thirdNearestDistQ12;
                            thirdNearestDistQ12 = distQ12;
                        } else if (distQ12 < fourthNearestDistQ12) {
                            fourthNearestDistQ12 = distQ12;
                        }
                    }
                }

                switch (this.outputMode) {
                    case VoronoiOutputMode.Nearest:
                        output[pixel] = nearestDistQ12;
                        break;
                    case VoronoiOutputMode.SecondNearest:
                        output[pixel] = secondNearestDistQ12;
                        break;
                    case VoronoiOutputMode.SecondMinusNearest:
                        output[pixel] = secondNearestDistQ12 - nearestDistQ12;
                        break;
                    case VoronoiOutputMode.ThirdNearest:
                        output[pixel] = thirdNearestDistQ12;
                        break;
                    case VoronoiOutputMode.FourthNearest:
                        output[pixel] = fourthNearestDistQ12;
                        break;
                }
            }
        }
        return output;
    }
}
