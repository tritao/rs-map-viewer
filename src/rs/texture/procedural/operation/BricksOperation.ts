import JavaRandom from "../../../../util/JavaRandom";
import { nextIntJagex } from "../../../../util/MathUtil";
import { ByteBuffer } from "../../../io/ByteBuffer";
import { idiv, mulShift } from "../../../util/JavaInt";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class BricksOperation extends TextureOperation {
    columns = 4;
    rowCount = 8;
    widthJitterQ12 = 409;
    heightJitterQ12 = 204;
    rowStaggerQ12 = 1024;
    yOffsetQ12 = 0;
    mortarThicknessQ12 = 81;
    brickValueVariationQ12 = 1024;

    halfMortarThicknessQ12 = 0;
    xStepQ12 = 0;
    yStepQ12 = 0;

    brickValueByRowCol!: Int32Array[];
    xBoundariesByRow!: Int32Array[];
    yBoundaries!: Int32Array;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.columns = buffer.readUnsignedByte();
        } else if (field === 1) {
            this.rowCount = buffer.readUnsignedByte();
        } else if (field === 2) {
            this.widthJitterQ12 = buffer.readUnsignedShort();
        } else if (field === 3) {
            this.heightJitterQ12 = buffer.readUnsignedShort();
        } else if (field === 4) {
            this.rowStaggerQ12 = buffer.readUnsignedShort();
        } else if (field === 5) {
            this.yOffsetQ12 = buffer.readUnsignedShort();
        } else if (field === 6) {
            this.mortarThicknessQ12 = buffer.readUnsignedShort();
        } else if (field === 7) {
            this.brickValueVariationQ12 = buffer.readUnsignedShort();
        }
    }

    override init(): void {
        this.brickValueByRowCol = Array.from(
            { length: this.rowCount },
            () => new Int32Array(this.columns),
        );
        this.xBoundariesByRow = Array.from(
            { length: this.rowCount },
            () => new Int32Array(this.columns + 1),
        );
        this.yBoundaries = new Int32Array(this.rowCount + 1);

        const random = new JavaRandom(this.rowCount);
        this.halfMortarThicknessQ12 = idiv(this.mortarThicknessQ12, 2);
        this.xStepQ12 = idiv(4096, this.columns);
        const halfXStepQ12 = idiv(this.xStepQ12, 2);
        this.yStepQ12 = idiv(4096, this.rowCount);
        const halfYStepQ12 = idiv(this.yStepQ12, 2);
        this.yBoundaries[0] = 0;

        for (let row = 0; row < this.rowCount; row++) {
            if (row > 0) {
                let value = this.yStepQ12;
                const randomValue = mulShift(
                    nextIntJagex(random, 4096) - 2048,
                    this.heightJitterQ12,
                    12,
                );
                value += mulShift(randomValue, halfYStepQ12, 12);
                this.yBoundaries[row] = value + this.yBoundaries[row - 1];
            }
            this.xBoundariesByRow[row][0] = 0;
            for (let col = 0; col < this.columns; col++) {
                if (col > 0) {
                    let value = this.xStepQ12;
                    const randomValue = mulShift(
                        nextIntJagex(random, 4096) - 2048,
                        this.widthJitterQ12,
                        12,
                    );
                    value += mulShift(randomValue, halfXStepQ12, 12);
                    this.xBoundariesByRow[row][col] = this.xBoundariesByRow[row][col - 1] + value;
                }
                this.brickValueByRowCol[row][col] =
                    this.brickValueVariationQ12 > 0
                        ? 4096 - nextIntJagex(random, this.brickValueVariationQ12)
                        : 4096;
            }

            this.xBoundariesByRow[row][this.columns] = 4096;
        }

        this.yBoundaries[this.rowCount] = 4096;
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            // if (1) {
            //     return output;
            // }
            let rowIndex = 0;
            let yCoord = this.yOffsetQ12 + textureGenerator.verticalGradient[line];
            for (; yCoord < 0; yCoord += 4096);
            for (; yCoord > 4096; yCoord -= 4096);
            for (; rowIndex < this.rowCount; rowIndex++) {
                if (yCoord < this.yBoundaries[rowIndex]) {
                    break;
                }
            }

            const rowStartY = this.yBoundaries[rowIndex - 1];
            const rowEndY = this.yBoundaries[rowIndex];
            if (
                yCoord > this.halfMortarThicknessQ12 + rowStartY &&
                yCoord < rowEndY - this.halfMortarThicknessQ12
            ) {
                for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                    const stagger = rowIndex % 2 !== 0 ? -this.rowStaggerQ12 : this.rowStaggerQ12;
                    let colIndex = 0;
                    let xCoord =
                        mulShift(this.xStepQ12, stagger, 12) +
                        textureGenerator.horizontalGradient[pixel];
                    for (; xCoord < 0; xCoord += 4096);
                    for (; xCoord > 4096; xCoord -= 4096);
                    for (; colIndex < this.columns; colIndex++) {
                        if (xCoord < this.xBoundariesByRow[rowIndex - 1][colIndex]) {
                            break;
                        }
                    }

                    const colStartX = this.xBoundariesByRow[rowIndex - 1][colIndex - 1];
                    const colEndX = this.xBoundariesByRow[rowIndex - 1][colIndex];
                    if (
                        colStartX + this.halfMortarThicknessQ12 < xCoord &&
                        xCoord < colEndX - this.halfMortarThicknessQ12
                    ) {
                        output[pixel] = this.brickValueByRowCol[rowIndex - 1][colIndex - 1];
                    } else {
                        output[pixel] = 0;
                    }
                }
            } else {
                output.fill(0, 0, textureGenerator.width);
            }
        }
        return output;
    }
}
