import JavaRandom from "java-random";

import { nextIntJagex } from "../../../../util/MathUtil";
import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class VoronoiNoiseOperation extends TextureOperation {
    static temp0: number = 0;
    static temp1: number = 0;
    static temp2: number = 0;
    static temp3: number = 0;

    rngSeed: number = 0;
    field2: number = 2048;
    field3: number = 2;
    field4: number = 1;
    field5: number = 5;
    field6: number = 5;

    permutations: Int8Array = new Int8Array(512);
    randomNs: Int16Array = new Int16Array(512);

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        switch (field) {
            case 0:
                this.field5 = this.field6 = buffer.readUnsignedByte();
                break;
            case 1:
                this.rngSeed = buffer.readUnsignedByte();
                break;
            case 2:
                this.field2 = buffer.readUnsignedShort();
                break;
            case 3:
                this.field3 = buffer.readUnsignedByte();
                break;
            case 4:
                this.field4 = buffer.readUnsignedByte();
                break;
            case 5:
                this.field5 = buffer.readUnsignedByte();
                break;
            case 6:
                this.field6 = buffer.readUnsignedByte();
                break;
        }
    }

    override init() {
        this.permutations = TextureGenerator.initPermutations(this.rngSeed);
        this.initRandomNumbers();
    }

    initRandomNumbers(): void {
        const random = new JavaRandom(this.rngSeed);
        this.randomNs = new Int16Array(512);
        if (this.field2 > 0) {
            for (let i = 0; i < 512; i++) {
                this.randomNs[i] = nextIntJagex(random, this.field2);
            }
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            const yFixed = 2048 + this.field6 * textureGenerator.verticalGradient[line];
            const yCell = yFixed >> 12;
            const yCellNext = yCell + 1;
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                VoronoiNoiseOperation.temp0 = 2147483647;
                VoronoiNoiseOperation.temp1 = 2147483647;
                VoronoiNoiseOperation.temp2 = 2147483647;
                VoronoiNoiseOperation.temp3 = 2147483647;

                const xFixed = this.field5 * textureGenerator.horizontalGradient[pixel] + 2048;
                const xCell = xFixed >> 12;
                const xCellNext = xCell + 1;
                for (let yNeighbor = yCell - 1; yNeighbor <= yCellNext; yNeighbor++) {
                    const yPermutation =
                        this.permutations[
                            (yNeighbor >= this.field6 ? yNeighbor - this.field6 : yNeighbor) & 0xff
                        ] & 0xff;
                    for (let xNeighbor = xCell - 1; xNeighbor <= xCellNext; xNeighbor++) {
                        let randomOffsetIndex =
                            (this.permutations[
                                ((xNeighbor >= this.field5 ? xNeighbor - this.field5 : xNeighbor) +
                                    yPermutation) &
                                    0xff
                            ] &
                                0xff) *
                            2;

                        let dxFixed =
                            xFixed - (this.randomNs[randomOffsetIndex++] + (xNeighbor << 12));
                        let dyFixed =
                            yFixed - (this.randomNs[randomOffsetIndex] + (yNeighbor << 12));
                        let distance: number;
                        switch (this.field4) {
                            case 1:
                                distance = (dxFixed * dxFixed + dyFixed * dyFixed) >> 12;
                                break;
                            case 2:
                                distance =
                                    (dyFixed < 0 ? -dyFixed : dyFixed) +
                                    (dxFixed < 0 ? -dxFixed : dxFixed);
                                break;
                            case 3:
                                dxFixed = dxFixed < 0 ? -dxFixed : dxFixed;
                                dyFixed = dyFixed < 0 ? -dyFixed : dyFixed;
                                distance = Math.max(dxFixed, dyFixed);
                                break;
                            case 4:
                                dxFixed =
                                    (Math.sqrt(
                                        Math.fround(dxFixed < 0 ? -dxFixed : dxFixed) / 4096.0,
                                    ) *
                                        4096.0) |
                                    0;
                                dyFixed =
                                    (Math.sqrt(
                                        Math.fround(dyFixed < 0 ? -dyFixed : dyFixed) / 4096.0,
                                    ) *
                                        4096.0) |
                                    0;
                                distance = dyFixed + dxFixed;
                                distance = (distance * distance) >> 12;
                                break;

                            case 5:
                                dxFixed *= dxFixed;
                                dyFixed *= dyFixed;
                                distance =
                                    (Math.sqrt(
                                        Math.sqrt(Math.fround((dxFixed + dyFixed) / 1.6777216e7)),
                                    ) *
                                        4096.0) |
                                    0;
                                break;
                            default:
                                distance =
                                    (Math.sqrt(
                                        Math.fround(
                                            (dyFixed * dyFixed + dxFixed * dxFixed) / 1.6777216e7,
                                        ),
                                    ) *
                                        4096.0) |
                                    0;
                                break;
                        }

                        if (distance < VoronoiNoiseOperation.temp3) {
                            VoronoiNoiseOperation.temp0 = VoronoiNoiseOperation.temp1;
                            VoronoiNoiseOperation.temp1 = VoronoiNoiseOperation.temp2;
                            VoronoiNoiseOperation.temp2 = VoronoiNoiseOperation.temp3;
                            VoronoiNoiseOperation.temp3 = distance;
                        } else if (distance < VoronoiNoiseOperation.temp2) {
                            VoronoiNoiseOperation.temp0 = VoronoiNoiseOperation.temp1;
                            VoronoiNoiseOperation.temp1 = VoronoiNoiseOperation.temp2;
                            VoronoiNoiseOperation.temp2 = distance;
                        } else if (distance < VoronoiNoiseOperation.temp1) {
                            VoronoiNoiseOperation.temp0 = VoronoiNoiseOperation.temp1;
                            VoronoiNoiseOperation.temp1 = distance;
                        } else if (distance < VoronoiNoiseOperation.temp0) {
                            VoronoiNoiseOperation.temp0 = distance;
                        }
                    }
                }

                switch (this.field3) {
                    case 0:
                        output[pixel] = VoronoiNoiseOperation.temp3;
                        break;
                    case 1:
                        output[pixel] = VoronoiNoiseOperation.temp2;
                        break;
                    case 2:
                        output[pixel] = VoronoiNoiseOperation.temp2 - VoronoiNoiseOperation.temp3;
                        break;
                    case 3:
                        output[pixel] = VoronoiNoiseOperation.temp1;
                        break;
                    case 4:
                        output[pixel] = VoronoiNoiseOperation.temp0;
                        break;
                }
            }
        }
        return output;
    }
}
