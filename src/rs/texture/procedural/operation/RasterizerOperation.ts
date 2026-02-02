import { clamp } from "../../../../util/MathUtil";
import { ByteBuffer } from "../../../io/ByteBuffer";
import { ArrayUtils } from "../../../util/ArrayUtils";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

// TODO: actually render
export class RasterizerOperation extends TextureOperation {
    ops?: RasterizerOperationShape[];

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            const count = buffer.readUnsignedByte();
            this.ops = new Array(count);
            for (let i = 0; i < count; i++) {
                const type = buffer.readUnsignedByte();
                if (type === 0) {
                    this.ops[i] = RasterizerOperationLine.create(buffer);
                } else if (type === 1) {
                    this.ops[i] = RasterizerOperationBezierCurve.create(buffer);
                } else if (type === 2) {
                    this.ops[i] = RasterizerOperationRectangle.create(buffer);
                } else if (type === 3) {
                    this.ops[i] = RasterizerOperationEllipse.create(buffer);
                }
            }
        } else if (field === 1) {
            this.isMonochrome = buffer.readUnsignedByte() === 1;
        }
    }

    render(textureGenerator: TextureGenerator, pixels: Int32Array[]): void {
        const width = textureGenerator.width;
        const height = textureGenerator.height;

        Rasterizer.setPixels(pixels);
        Rasterizer.setDimensionMasks(textureGenerator.widthMask, textureGenerator.heightMask);

        if (this.ops === undefined) {
            return;
        }

        for (const op of this.ops) {
            const fillColor = op.fillColor;
            const outlineColor = op.outlineColor;
            if (fillColor >= 0) {
                if (outlineColor >= 0) {
                    op.render(width, height);
                } else {
                    op.renderFill(width, height);
                }
            } else if (outlineColor >= 0) {
                op.renderOutline(width, height);
            }
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (this.monochromeImageCache.dirty) {
            this.render(textureGenerator, this.monochromeImageCache.getAll());
        }
        return output;
    }

    override getColourOutput(textureGenerator: TextureGenerator, line: number): Int32Array[] {
        if (!this.colourImageCache) {
            throw new Error("Colour image cache is not initialized");
        }
        const output = this.colourImageCache.get(line);
        if (this.colourImageCache.dirty) {
            const width = textureGenerator.width;
            const height = textureGenerator.height;
            const pixels = new Array<Int32Array>(height);
            for (let i = 0; i < height; i++) {
                pixels[i] = new Int32Array(width);
            }
            const outputAll = this.colourImageCache.getAll();
            this.render(textureGenerator, pixels);
            for (let y = 0; y < textureGenerator.height; y++) {
                const output = outputAll[y];
                const outputR = output[0];
                const outputG = output[1];
                const outputB = output[2];
                const input = pixels[y];
                for (let x = 0; x < textureGenerator.width; x++) {
                    const rgb = input[x];
                    outputR[x] = (rgb >> 12) & 0xff0;
                    outputG[x] = (rgb >> 4) & 0xff0;
                    outputB[x] = (rgb & 0xff) << 4;
                }
            }
        }
        return output;
    }
}

export class Rasterizer {
    static pixels: Int32Array[];

    static widthMask: number = 0;
    static heightMask: number = 0;
    static startX: number = 0;
    static startY: number = 0;

    static circleOutline: Int32Array;

    static setPixels(pixels: Int32Array[]): void {
        this.pixels = pixels;
    }

    static setDimensionMasks(widthMask: number, heightMask: number): void {
        this.widthMask = widthMask;
        this.heightMask = heightMask;
        this.startX = 0;
        this.startY = 0;
    }

    static initCircleOutline(size: number): void {
        if (this.circleOutline === undefined || this.circleOutline.length < size) {
            this.circleOutline = new Int32Array(size);
        }
    }

    static rasterLine(x0: number, x1: number, y0: number, y1: number, color: number): void {
        const deltaX = x1 - x0;
        const deltaY = y1 - y0;
        if (deltaX === 0) {
            if (deltaY !== 0) {
                Rasterizer.rasterVerticalLine(x0, y0, y1, color);
            }
        } else if (deltaY === 0) {
            Rasterizer.rasterHorizontalLine(x0, x1, y0, color);
        } else {
            const slopeQ12 = ((deltaY << 12) / deltaX) | 0;
            const yIntercept = y0 - ((x0 * slopeQ12) >> 12);
            let startX: number;
            let startY: number;
            if (x0 < Rasterizer.startX) {
                startY = yIntercept + ((Rasterizer.startX * slopeQ12) >> 12);
                startX = Rasterizer.startX;
            } else if (Rasterizer.widthMask >= x0) {
                startX = x0;
                startY = y0;
            } else {
                startX = Rasterizer.widthMask;
                startY = ((Rasterizer.widthMask * slopeQ12) >> 12) + yIntercept;
            }
            let endX: number;
            let endY: number;
            if (x1 < Rasterizer.startX) {
                endX = Rasterizer.startX;
                endY = yIntercept + ((Rasterizer.startX * slopeQ12) >> 12);
            } else if (x1 <= Rasterizer.widthMask) {
                endX = x1;
                endY = y1;
            } else {
                endX = Rasterizer.widthMask;
                endY = ((slopeQ12 * Rasterizer.widthMask) >> 12) + yIntercept;
            }
            if (Rasterizer.startY > endY) {
                endX = ((Rasterizer.startY - yIntercept) << 12) / slopeQ12;
                endY = Rasterizer.startY;
            } else if (Rasterizer.heightMask < endY) {
                endX = ((Rasterizer.heightMask - yIntercept) << 12) / slopeQ12;
                endY = Rasterizer.heightMask;
            }
            if (Rasterizer.startY > startY) {
                startX = ((Rasterizer.startY - yIntercept) << 12) / slopeQ12;
                startY = Rasterizer.startY;
            } else if (startY > Rasterizer.heightMask) {
                startY = Rasterizer.heightMask;
                startX = ((Rasterizer.heightMask - yIntercept) << 12) / slopeQ12;
            }
            Rasterizer.rasterLine0(startX, endX, startY, endY, color);
        }
    }

    static rasterLine0(x0: number, x1: number, y0: number, y1: number, color: number): void {
        let deltaX = x1 - x0;
        let deltaY = y1 - y0;
        if (deltaX === 0) {
            if (deltaY !== 0) {
                Rasterizer.rasterVerticalLine0(x0, y0, y1, color);
            }
        } else if (deltaY === 0) {
            Rasterizer.rasterHorizontalLine0(x0, x1, y0, color);
        } else {
            if (deltaX < 0) {
                deltaX = -deltaX;
            }
            if (deltaY < 0) {
                deltaY = -deltaY;
            }
            const isSteep = deltaY > deltaX;
            if (isSteep) {
                const temp0 = x0;
                x0 = y0;
                y0 = temp0;
                const temp1 = x1;
                x1 = y1;
                y1 = temp1;
            }
            if (x1 < x0) {
                const temp0 = x0;
                x0 = x1;
                const temp1 = y0;
                y0 = y1;
                y1 = temp1;
                x1 = temp0;
            }
            let y = y0;
            const dx = x1 - x0;
            let absDy = y1 - y0;
            const yStep = y1 > y0 ? 1 : -1;
            if (absDy < 0) {
                absDy = -absDy;
            }
            let error = -(dx >> 1);
            if (isSteep) {
                for (let x = x0; x <= x1; x++) {
                    error += absDy;
                    Rasterizer.pixels[x][y] = color;
                    if (error > 0) {
                        y += yStep;
                        error -= dx;
                    }
                }
            } else {
                for (let x = x0; x <= x1; x++) {
                    error += absDy;
                    Rasterizer.pixels[y][x] = color;
                    if (error > 0) {
                        y += yStep;
                        error -= dx;
                    }
                }
            }
        }
    }

    static rasterVerticalLine(x0: number, y0: number, y1: number, color: number) {
        if (Rasterizer.startX <= x0 && Rasterizer.widthMask >= x0) {
            y0 = clamp(y0, Rasterizer.startY, Rasterizer.heightMask);
            y1 = clamp(y1, Rasterizer.startY, Rasterizer.heightMask);
            Rasterizer.rasterVerticalLine0(x0, y0, y1, color);
        }
    }

    static rasterVerticalLine0(x0: number, y0: number, y1: number, color: number) {
        if (y1 >= y0) {
            for (let y = y0; y < y1; y++) {
                Rasterizer.pixels[y][x0] = color;
            }
        } else {
            for (let y = y1; y < y0; y++) {
                Rasterizer.pixels[y][x0] = color;
            }
        }
    }

    static rasterHorizontalLine(x0: number, x1: number, y0: number, color: number) {
        if (Rasterizer.startY <= y0 && y0 <= Rasterizer.heightMask) {
            x0 = clamp(x0, Rasterizer.startX, Rasterizer.widthMask);
            x1 = clamp(x1, Rasterizer.startX, Rasterizer.widthMask);
            Rasterizer.rasterHorizontalLine0(x0, x1, y0, color);
        }
    }

    static rasterHorizontalLine0(x0: number, x1: number, y0: number, color: number) {
        if (x1 >= x0) {
            ArrayUtils.fillRange(Rasterizer.pixels[y0], x0, x1, color);
        } else {
            ArrayUtils.fillRange(Rasterizer.pixels[y0], x1, x0, color);
        }
    }

    static rasterBezierCurve(
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        x3: number,
        y3: number,
        outlineColor: number,
    ) {
        if (
            Rasterizer.startX <= x0 &&
            x0 <= Rasterizer.widthMask &&
            Rasterizer.startX <= x1 &&
            Rasterizer.widthMask >= x1 &&
            Rasterizer.startX <= x2 &&
            Rasterizer.widthMask >= x2 &&
            Rasterizer.startX <= x3 &&
            x3 <= Rasterizer.widthMask &&
            y0 >= Rasterizer.startY &&
            y0 <= Rasterizer.heightMask &&
            y1 >= Rasterizer.startY &&
            Rasterizer.heightMask >= y1 &&
            y2 >= Rasterizer.startY &&
            Rasterizer.heightMask >= y2 &&
            Rasterizer.startY <= y3 &&
            Rasterizer.heightMask >= y3
        ) {
            Rasterizer.rasterBezierCurve0(x0, y0, x1, y1, x2, y2, x3, y3, outlineColor);
        } else {
            Rasterizer.rasterBezierCurveClamped(x0, y0, x1, y1, x2, y2, x3, y3, outlineColor);
        }
    }

    static rasterBezierCurve0(
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        x3: number,
        y3: number,
        outlineColor: number,
    ) {
        if (x0 === x1 && y0 === y1 && x2 === x3 && y2 === y3) {
            Rasterizer.rasterLine0(x0, x3, y0, y3, outlineColor);
            return;
        }
        let prevX = x0;
        let prevY = y0;
        const threeX0 = x0 * 3;
        const threeY0 = y0 * 3;
        const threeX1 = x1 * 3;
        const threeX2 = x2 * 3;
        const threeY1 = y1 * 3;
        const threeY2 = y2 * 3;
        const coeffX3 = threeX1 + x3 - x0 - threeX2;
        const coeffY3 = threeY1 + y3 - threeY2 - y0;
        const coeffX2 = threeX2 + threeX0 - threeX1 - threeX1;
        const coeffY2 = threeY2 + threeY0 - threeY1 - threeY1;
        const coeffY1 = threeY1 - threeY0;
        const coeffX1 = threeX1 - threeX0;
        for (let tQ12 = 128; tQ12 <= 4096; tQ12 += 128) {
            const t2Q12 = (tQ12 * tQ12) >> 12;
            const t3Q12 = (tQ12 * t2Q12) >> 12;
            const xTerm3 = t3Q12 * coeffX3;
            const xTerm2 = t2Q12 * coeffX2;
            const xTerm1 = coeffX1 * tQ12;
            const yTerm2 = coeffY2 * t2Q12;
            const x = ((xTerm1 + xTerm2 + xTerm3) >> 12) + x0;
            const yTerm3 = coeffY3 * t3Q12;
            const yTerm1 = coeffY1 * tQ12;
            const y = ((yTerm1 + yTerm3 + yTerm2) >> 12) + y0;
            Rasterizer.rasterLine0(prevX, x, prevY, y, outlineColor);
            prevX = x;
            prevY = y;
        }
    }

    static rasterBezierCurveClamped(
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        x3: number,
        y3: number,
        outlineColor: number,
    ) {
        if (x1 === x0 && y1 === y0 && x2 === x3 && y2 === y3) {
            Rasterizer.rasterLine(x0, x3, y0, y3, outlineColor);
            return;
        }
        let prevX = x0;
        let prevY = y0;
        const threeX0 = x0 * 3;
        const threeY0 = y0 * 3;
        const threeX1 = x1 * 3;
        const threeX2 = x2 * 3;
        const threeY1 = y1 * 3;
        const threeY2 = y2 * 3;
        const coeffX3 = x3 + threeX1 - x0 - threeX2;
        const coeffX2 = threeX0 + threeX2 - threeX1 - threeX1;
        const coeffY2 = threeY2 + threeY0 - threeY1 - threeY1;
        const coeffY3 = threeY1 + y3 - y0 - threeY2;
        const coeffX1 = threeX1 - threeX0;
        const coeffY1 = threeY1 - threeY0;
        for (let tQ12 = 128; tQ12 <= 4096; tQ12 += 128) {
            const t2Q12 = (tQ12 * tQ12) >> 12;
            const xTerm2 = t2Q12 * coeffX2;
            const t3Q12 = (tQ12 * t2Q12) >> 12;
            const xTerm3 = t3Q12 * coeffX3;
            const yTerm1 = coeffY1 * tQ12;
            const yTerm2 = coeffY2 * t2Q12;
            const yTerm3 = coeffY3 * t3Q12;
            const xTerm1 = coeffX1 * tQ12;
            const x = ((xTerm1 + xTerm2 + xTerm3) >> 12) + x0;
            const y = ((yTerm1 + yTerm3 + yTerm2) >> 12) + y0;
            Rasterizer.rasterLine(prevX, x, prevY, y, outlineColor);
            prevY = y;
            prevX = x;
        }
    }

    static rasterRectangle(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        if (
            x0 >= Rasterizer.startX &&
            x1 <= Rasterizer.widthMask &&
            Rasterizer.startY <= y0 &&
            y1 <= Rasterizer.heightMask
        ) {
            Rasterizer.rasterRectangle0(x0, x1, y0, y1, fillColor, outlineColor, outlineWidth);
        } else {
            Rasterizer.rasterRectangleClamped(
                x0,
                x1,
                y0,
                y1,
                fillColor,
                outlineColor,
                outlineWidth,
            );
        }
    }

    static rasterRectangle0(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        const innerTopY = y0 + outlineWidth;
        const innerBottomY = y1 - outlineWidth;
        const innerLeftX = x0 + outlineWidth;
        const innerRightX = x1 - outlineWidth;
        for (let y = y0; y < innerTopY; y++) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0, x1, outlineColor);
        }
        for (let y = y1; y > innerBottomY; y--) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0, x1, outlineColor);
        }
        for (let y = innerTopY; y <= innerBottomY; y++) {
            const rowPixels = Rasterizer.pixels[y];
            ArrayUtils.fillRange(rowPixels, x0, innerLeftX, outlineColor);
            ArrayUtils.fillRange(rowPixels, innerLeftX, innerRightX, fillColor);
            ArrayUtils.fillRange(rowPixels, innerRightX, x1, outlineColor);
        }
    }

    static rasterRectangleClamped(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        const y0Clamped = clamp(y0, Rasterizer.startY, Rasterizer.heightMask);
        const y1Clamped = clamp(y1, Rasterizer.startY, Rasterizer.heightMask);
        const x0Clamped = clamp(x0, Rasterizer.startX, Rasterizer.widthMask);
        const x1Clamped = clamp(x1, Rasterizer.startX, Rasterizer.widthMask);
        const innerTopY = clamp(y0 + outlineWidth, Rasterizer.startY, Rasterizer.heightMask);
        const innerBottomY = clamp(y1 - outlineWidth, Rasterizer.startY, Rasterizer.heightMask);
        for (let y = y0Clamped; y < innerTopY; y++) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0Clamped, x1Clamped, outlineColor);
        }
        for (let y = y1Clamped; y > innerBottomY; y--) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0Clamped, x1Clamped, outlineColor);
        }
        const innerLeftX = clamp(x0 + outlineWidth, Rasterizer.startX, Rasterizer.widthMask);
        const innerRightX = clamp(x1 - outlineWidth, Rasterizer.startX, Rasterizer.widthMask);
        for (let y = innerTopY; y <= innerBottomY; y++) {
            const rowPixels = Rasterizer.pixels[y];
            ArrayUtils.fillRange(rowPixels, x0Clamped, innerLeftX, outlineColor);
            ArrayUtils.fillRange(rowPixels, innerLeftX, innerRightX, fillColor);
            ArrayUtils.fillRange(rowPixels, innerRightX, x1Clamped, outlineColor);
        }
    }

    static rasterRectangleFill(x0: number, x1: number, y0: number, y1: number, fillColor: number) {
        if (
            Rasterizer.startX <= x0 &&
            x1 <= Rasterizer.widthMask &&
            Rasterizer.startY <= y0 &&
            y1 <= Rasterizer.heightMask
        ) {
            Rasterizer.rasterRectangleFill0(x0, x1, y0, y1, fillColor);
        } else {
            Rasterizer.rasterRectangleFillClamped(x0, x1, y0, y1, fillColor);
        }
    }

    static rasterRectangleFill0(x0: number, x1: number, y0: number, y1: number, fillColor: number) {
        for (let y = y0; y <= y1; y++) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0, x1, fillColor);
        }
    }

    static rasterRectangleFillClamped(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        fillColor: number,
    ) {
        const y0Clamped = clamp(y0, Rasterizer.startY, Rasterizer.heightMask);
        const y1Clamped = clamp(y1, Rasterizer.startY, Rasterizer.heightMask);
        const x0Clamped = clamp(x0, Rasterizer.startX, Rasterizer.widthMask);
        const x1Clamped = clamp(x1, Rasterizer.startX, Rasterizer.widthMask);
        for (let y = y0Clamped; y <= y1Clamped; y++) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0Clamped, x1Clamped, fillColor);
        }
    }

    static rasterRectangleOutline(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        if (
            x0 >= Rasterizer.startX &&
            Rasterizer.widthMask >= x1 &&
            y0 >= Rasterizer.startY &&
            Rasterizer.heightMask >= y1
        ) {
            if (outlineWidth === 1) {
                Rasterizer.rasterRectangleOutlineWidth1(x0, x1, y0, y1, outlineColor);
            } else {
                Rasterizer.rasterRectangleOutline0(x0, x1, y0, y1, outlineColor, outlineWidth);
            }
        } else if (outlineWidth === 1) {
            Rasterizer.rasterRectangleOutlineWidth1Clamped(x0, x1, y0, y1, outlineColor);
        } else {
            Rasterizer.rasterRectangleOutlineClamped(x0, x1, y0, y1, outlineColor, outlineWidth);
        }
    }

    static rasterRectangleOutlineWidth1(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        outlineColor: number,
    ) {
        ArrayUtils.fillRange(Rasterizer.pixels[y0++], x0, x1, outlineColor);
        ArrayUtils.fillRange(Rasterizer.pixels[y1--], x0, x1, outlineColor);
        for (let y = y0; y <= y1; y++) {
            const rowPixels = Rasterizer.pixels[y];
            rowPixels[x0] = rowPixels[x1] = outlineColor;
        }
    }

    static rasterRectangleOutline0(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        const innerTopY = outlineWidth + y0;
        const innerBottomY = y1 - outlineWidth;
        const innerLeftX = outlineWidth + x0;
        for (let y = y0; y < innerTopY; y++) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0, x1, outlineColor);
        }
        for (let y = y1; y > innerBottomY; y--) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0, x1, outlineColor);
        }
        const innerRightX = x1 - outlineWidth;
        for (let y = innerTopY; y <= innerBottomY; y++) {
            const rowPixels = Rasterizer.pixels[y];
            ArrayUtils.fillRange(rowPixels, x0, innerLeftX, outlineColor);
            ArrayUtils.fillRange(rowPixels, innerRightX, x1, outlineColor);
        }
    }

    static rasterRectangleOutlineWidth1Clamped(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        outlineColor: number,
    ) {
        if (Rasterizer.heightMask < y0 || Rasterizer.startY > y1) {
            return;
        }
        let shouldDrawLeftEdge: boolean;
        if (Rasterizer.startX > x0) {
            x0 = Rasterizer.startX;
            shouldDrawLeftEdge = false;
        } else if (x0 > Rasterizer.widthMask) {
            x0 = Rasterizer.widthMask;
            shouldDrawLeftEdge = false;
        } else {
            shouldDrawLeftEdge = true;
        }
        let shouldDrawRightEdge: boolean;
        if (x1 < Rasterizer.startX) {
            x1 = Rasterizer.startX;
            shouldDrawRightEdge = false;
        } else if (Rasterizer.widthMask < x1) {
            x1 = Rasterizer.widthMask;
            shouldDrawRightEdge = false;
        } else {
            shouldDrawRightEdge = true;
        }
        let yStart: number;
        if (Rasterizer.startY <= y0) {
            yStart = y0 + 1;
            ArrayUtils.fillRange(Rasterizer.pixels[y0], x0, x1, outlineColor);
        } else {
            yStart = Rasterizer.startY;
        }
        let yEnd: number;
        if (Rasterizer.heightMask < y1) {
            yEnd = Rasterizer.heightMask;
        } else {
            yEnd = y1 - 1;
            ArrayUtils.fillRange(Rasterizer.pixels[y1], x0, x1, outlineColor);
        }
        if (shouldDrawLeftEdge && shouldDrawRightEdge) {
            for (let y = yStart; y <= yEnd; y++) {
                const rowPixels = Rasterizer.pixels[y];
                rowPixels[x0] = rowPixels[x1] = outlineColor;
            }
        } else if (shouldDrawLeftEdge) {
            for (let y = yStart; y <= yEnd; y++) {
                Rasterizer.pixels[y][x0] = outlineColor;
            }
        } else if (shouldDrawRightEdge) {
            for (let y = yStart; y <= yEnd; y++) {
                Rasterizer.pixels[y][x1] = outlineColor;
            }
        }
    }

    static rasterRectangleOutlineClamped(
        x0: number,
        x1: number,
        y0: number,
        y1: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        const y0Clamped = clamp(y0, Rasterizer.startY, Rasterizer.heightMask);
        const y1Clamped = clamp(y1, Rasterizer.startY, Rasterizer.heightMask);
        const x0Clamped = clamp(x0, Rasterizer.startX, Rasterizer.widthMask);
        const x1Clamped = clamp(x1, Rasterizer.startX, Rasterizer.widthMask);
        const innerTopY = clamp(outlineWidth + y0, Rasterizer.startY, Rasterizer.heightMask);
        const innerBottomY = clamp(y1 - outlineWidth, Rasterizer.startY, Rasterizer.heightMask);
        for (let y = y0Clamped; y < innerTopY; y++) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0Clamped, x1Clamped, outlineColor);
        }
        for (let y = y1Clamped; y > innerBottomY; y--) {
            ArrayUtils.fillRange(Rasterizer.pixels[y], x0Clamped, x1Clamped, outlineColor);
        }
        const innerLeftX = clamp(x0 + outlineWidth, Rasterizer.startX, Rasterizer.widthMask);
        const innerRightX = clamp(x1 - outlineWidth, Rasterizer.startX, Rasterizer.widthMask);
        for (let y = innerTopY; y <= innerBottomY; y++) {
            const rowPixels = Rasterizer.pixels[y];
            ArrayUtils.fillRange(rowPixels, x0Clamped, innerLeftX, outlineColor);
            ArrayUtils.fillRange(rowPixels, innerRightX, x1Clamped, outlineColor);
        }
    }

    static rasterEllipse(
        x: number,
        y: number,
        sizeX: number,
        sizeY: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        if (sizeX === sizeY) {
            Rasterizer.rasterCircle(x, y, sizeX, fillColor, outlineColor, outlineWidth);
        } else if (
            x - sizeX >= Rasterizer.startX &&
            Rasterizer.widthMask >= sizeX + x &&
            y - sizeY >= Rasterizer.startY &&
            sizeY + y <= Rasterizer.heightMask
        ) {
            Rasterizer.rasterEllipse0(x, y, sizeX, sizeY, fillColor, outlineColor, outlineWidth);
        } else {
            Rasterizer.rasterEllipseClamped(
                x,
                y,
                sizeX,
                sizeY,
                fillColor,
                outlineColor,
                outlineWidth,
            );
        }
    }

    static rasterEllipse0(
        x: number,
        y: number,
        sizeX: number,
        sizeY: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        let xOffsetOuter = 0;
        let yOffsetOuter = sizeY;
        const innerRadiusX = sizeX - outlineWidth;
        let xOffsetInner = 0;
        const innerRadiusY = sizeY - outlineWidth;
        const rx2 = sizeX * sizeX;
        const ry2 = sizeY * sizeY;
        const innerRx2 = innerRadiusX * innerRadiusX;
        const innerRy2 = innerRadiusY * innerRadiusY;
        const twoRy2 = ry2 << 1;
        const twoInnerRy2 = innerRy2 << 1;
        const twoRx2 = rx2 << 1;
        const twoInnerRx2 = innerRx2 << 1;
        const twoRy = sizeY << 1;
        const twoInnerRy = innerRadiusY << 1;
        let outerDecisionA = rx2 * (1 - twoRy) + twoRy2;
        let outerDecisionB = ry2 - twoRx2 * (twoRy - 1);
        let innerDecisionA = twoInnerRy2 + (1 - twoInnerRy) * innerRx2;
        let innerDecisionB = innerRy2 - twoInnerRx2 * (twoInnerRy - 1);
        const fourRx2 = rx2 << 2;
        const fourRy2 = ry2 << 2;
        const fourInnerRy2 = innerRy2 << 2;
        const fourInnerRx2 = innerRx2 << 2;
        let outerDecisionAInc = twoRy2 * 3;
        let outerDecisionBDec = twoRx2 * (twoRy - 3);
        let innerDecisionAInc = twoInnerRy2 * 3;
        let outerDecisionBInc = fourRy2;
        let innerDecisionBDec = (twoInnerRy - 3) * twoInnerRx2;
        let innerDecisionBInc = fourInnerRy2;
        let outerDecisionAAdjust = (sizeY - 1) * fourRx2;
        let innerDecisionAAdjust = fourInnerRx2 * (innerRadiusY - 1);
        const centerRow = Rasterizer.pixels[y];
        ArrayUtils.fillRange(centerRow, x - sizeX, x - innerRadiusX, outlineColor);
        ArrayUtils.fillRange(centerRow, x - innerRadiusX, innerRadiusX + x, fillColor);
        ArrayUtils.fillRange(centerRow, innerRadiusX + x, x + sizeX, outlineColor);
        while (yOffsetOuter > 0) {
            if (outerDecisionA < 0) {
                while (outerDecisionA < 0) {
                    outerDecisionA += outerDecisionAInc;
                    outerDecisionAInc += fourRy2;
                    xOffsetOuter++;
                    outerDecisionB += outerDecisionBInc;
                    outerDecisionBInc += fourRy2;
                }
            }
            if (outerDecisionB < 0) {
                outerDecisionA += outerDecisionAInc;
                outerDecisionB += outerDecisionBInc;
                outerDecisionAInc += fourRy2;
                xOffsetOuter++;
                outerDecisionBInc += fourRy2;
            }
            outerDecisionA += -outerDecisionAAdjust;
            const outerLeftX = x - xOffsetOuter;
            const isWithinInnerY = innerRadiusY >= yOffsetOuter;
            const outerRightX = x + xOffsetOuter;
            outerDecisionAAdjust -= fourRx2;
            yOffsetOuter--;
            outerDecisionB += -outerDecisionBDec;
            const yTop = yOffsetOuter + y;
            outerDecisionBDec -= fourRx2;
            if (isWithinInnerY) {
                if (innerDecisionA < 0) {
                    while (innerDecisionA < 0) {
                        xOffsetInner++;
                        innerDecisionB += innerDecisionBInc;
                        innerDecisionA += innerDecisionAInc;
                        innerDecisionBInc += fourInnerRy2;
                        innerDecisionAInc += fourInnerRy2;
                    }
                }
                if (innerDecisionB < 0) {
                    innerDecisionA += innerDecisionAInc;
                    innerDecisionAInc += fourInnerRy2;
                    xOffsetInner++;
                    innerDecisionB += innerDecisionBInc;
                    innerDecisionBInc += fourInnerRy2;
                }
                innerDecisionB += -innerDecisionBDec;
                innerDecisionA += -innerDecisionAAdjust;
                innerDecisionAAdjust -= fourInnerRx2;
                innerDecisionBDec -= fourInnerRx2;
            }
            const yBottom = y - yOffsetOuter;
            if (isWithinInnerY) {
                const innerLeftX = x - xOffsetInner;
                ArrayUtils.fillRange(
                    Rasterizer.pixels[yBottom],
                    outerLeftX,
                    innerLeftX,
                    outlineColor,
                );
                const innerRightX = x + xOffsetInner;
                ArrayUtils.fillRange(
                    Rasterizer.pixels[yBottom],
                    innerLeftX,
                    innerRightX,
                    fillColor,
                );
                ArrayUtils.fillRange(
                    Rasterizer.pixels[yBottom],
                    innerRightX,
                    outerRightX,
                    outlineColor,
                );
                ArrayUtils.fillRange(Rasterizer.pixels[yTop], outerLeftX, innerLeftX, outlineColor);
                ArrayUtils.fillRange(Rasterizer.pixels[yTop], innerLeftX, innerRightX, fillColor);
                ArrayUtils.fillRange(
                    Rasterizer.pixels[yTop],
                    innerRightX,
                    outerRightX,
                    outlineColor,
                );
            } else {
                ArrayUtils.fillRange(
                    Rasterizer.pixels[yBottom],
                    outerLeftX,
                    outerRightX,
                    outlineColor,
                );
                ArrayUtils.fillRange(
                    Rasterizer.pixels[yTop],
                    outerLeftX,
                    outerRightX,
                    outlineColor,
                );
            }
        }
    }

    static rasterEllipseClamped(
        x: number,
        y: number,
        sizeX: number,
        sizeY: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        let xOffsetOuter = 0;
        const innerRadiusY = sizeY - outlineWidth;
        let yOffsetOuter = sizeY;
        let xOffsetInner = 0;
        const innerRadiusX = sizeX - outlineWidth;
        const rx2 = sizeX * sizeX;
        const ry2 = sizeY * sizeY;
        const innerRx2 = innerRadiusX * innerRadiusX;
        const twoRy2 = ry2 << 1;
        const innerRy2 = innerRadiusY * innerRadiusY;
        const twoRx2 = rx2 << 1;
        const twoInnerRy2 = innerRy2 << 1;
        const twoInnerRx2 = innerRx2 << 1;
        const twoRy = sizeY << 1;
        const twoInnerRy = innerRadiusY << 1;
        let outerDecisionA = twoRy2 + (1 - twoRy) * rx2;
        let outerDecisionB = ry2 - (twoRy - 1) * twoRx2;
        let innerDecisionA = innerRx2 * (1 - twoInnerRy) + twoInnerRy2;
        const fourRx2 = rx2 << 2;
        let innerDecisionB = innerRy2 - twoInnerRx2 * (twoInnerRy - 1);
        const fourRy2 = ry2 << 2;
        const fourInnerRx2 = innerRx2 << 2;
        const fourInnerRy2 = innerRy2 << 2;
        let outerDecisionAInc = twoRy2 * 3;
        let innerDecisionAInc = twoInnerRy2 * 3;
        let outerDecisionBDec = twoRx2 * (twoRy - 3);
        let outerDecisionBInc = fourRy2;
        let innerDecisionBDec = (twoInnerRy - 3) * twoInnerRx2;
        let outerDecisionAAdjust = fourRx2 * (sizeY - 1);
        let innerDecisionBInc = fourInnerRy2;
        let innerDecisionAAdjust = (innerRadiusY - 1) * fourInnerRx2;
        if (y >= Rasterizer.startY && Rasterizer.heightMask >= y) {
            const centerRow = Rasterizer.pixels[y];
            const outerLeftX = clamp(x - sizeX, Rasterizer.startX, Rasterizer.widthMask);
            const outerRightX = clamp(x + sizeX, Rasterizer.startX, Rasterizer.widthMask);
            const innerLeftX = clamp(x - innerRadiusX, Rasterizer.startX, Rasterizer.widthMask);
            const innerRightX = clamp(x + innerRadiusX, Rasterizer.startX, Rasterizer.widthMask);
            ArrayUtils.fillRange(centerRow, outerLeftX, innerLeftX, outlineColor);
            ArrayUtils.fillRange(centerRow, innerLeftX, innerRightX, fillColor);
            ArrayUtils.fillRange(centerRow, innerRightX, outerRightX, outlineColor);
        }
        while (yOffsetOuter > 0) {
            if (outerDecisionA < 0) {
                while (outerDecisionA < 0) {
                    outerDecisionA += outerDecisionAInc;
                    xOffsetOuter++;
                    outerDecisionAInc += fourRy2;
                    outerDecisionB += outerDecisionBInc;
                    outerDecisionBInc += fourRy2;
                }
            }
            if (outerDecisionB < 0) {
                xOffsetOuter++;
                outerDecisionA += outerDecisionAInc;
                outerDecisionAInc += fourRy2;
                outerDecisionB += outerDecisionBInc;
                outerDecisionBInc += fourRy2;
            }
            const isWithinInnerY = innerRadiusY >= yOffsetOuter;
            outerDecisionB += -outerDecisionBDec;
            yOffsetOuter--;
            if (isWithinInnerY) {
                if (innerDecisionA < 0) {
                    while (innerDecisionA < 0) {
                        innerDecisionA += innerDecisionAInc;
                        innerDecisionB += innerDecisionBInc;
                        innerDecisionAInc += fourInnerRy2;
                        innerDecisionBInc += fourInnerRy2;
                        xOffsetInner++;
                    }
                }
                if (innerDecisionB < 0) {
                    innerDecisionA += innerDecisionAInc;
                    innerDecisionAInc += fourInnerRy2;
                    innerDecisionB += innerDecisionBInc;
                    innerDecisionBInc += fourInnerRy2;
                    xOffsetInner++;
                }
                innerDecisionB += -innerDecisionBDec;
                innerDecisionBDec -= fourInnerRx2;
                innerDecisionA += -innerDecisionAAdjust;
                innerDecisionAAdjust -= fourInnerRx2;
            }
            outerDecisionA += -outerDecisionAAdjust;
            const yTop = yOffsetOuter + y;
            const yBottom = y - yOffsetOuter;
            outerDecisionAAdjust -= fourRx2;
            outerDecisionBDec -= fourRx2;
            if (yTop >= Rasterizer.startY && Rasterizer.heightMask >= yBottom) {
                const outerRightX = clamp(
                    xOffsetOuter + x,
                    Rasterizer.startX,
                    Rasterizer.widthMask,
                );
                const outerLeftX = clamp(x - xOffsetOuter, Rasterizer.startX, Rasterizer.widthMask);
                if (isWithinInnerY) {
                    const innerRightX = clamp(
                        x + xOffsetInner,
                        Rasterizer.startX,
                        Rasterizer.widthMask,
                    );
                    const innerLeftX = clamp(
                        x - xOffsetInner,
                        Rasterizer.startX,
                        Rasterizer.widthMask,
                    );
                    if (Rasterizer.startY <= yBottom) {
                        const rowPixels = Rasterizer.pixels[yBottom];
                        ArrayUtils.fillRange(rowPixels, outerLeftX, innerLeftX, outlineColor);
                        ArrayUtils.fillRange(rowPixels, innerLeftX, innerRightX, fillColor);
                        ArrayUtils.fillRange(rowPixels, innerRightX, outerRightX, outlineColor);
                    }
                    if (Rasterizer.heightMask >= yTop) {
                        const rowPixels = Rasterizer.pixels[yTop];
                        ArrayUtils.fillRange(rowPixels, outerLeftX, innerLeftX, outlineColor);
                        ArrayUtils.fillRange(rowPixels, innerLeftX, innerRightX, fillColor);
                        ArrayUtils.fillRange(rowPixels, innerRightX, outerRightX, outlineColor);
                    }
                } else {
                    if (yBottom >= Rasterizer.startY) {
                        ArrayUtils.fillRange(
                            Rasterizer.pixels[yBottom],
                            outerLeftX,
                            outerRightX,
                            outlineColor,
                        );
                    }
                    if (Rasterizer.heightMask >= yTop) {
                        ArrayUtils.fillRange(
                            Rasterizer.pixels[yTop],
                            outerLeftX,
                            outerRightX,
                            outlineColor,
                        );
                    }
                }
            }
        }
    }

    static rasterCircle(
        x: number,
        y: number,
        size: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        if (
            Rasterizer.startX <= x - size &&
            size + x <= Rasterizer.widthMask &&
            y - size >= Rasterizer.startY &&
            Rasterizer.heightMask >= size + y
        ) {
            Rasterizer.rasterCircle0(x, y, size, fillColor, outlineColor, outlineWidth);
        } else {
            Rasterizer.rasterCircleClamped(x, y, size, fillColor, outlineColor, outlineWidth);
        }
    }

    static rasterCircle0(
        x: number,
        y: number,
        size: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        Rasterizer.initCircleOutline(size);
        let xOffset = 0;
        let outerError = -size;
        let innerRadius = size - outlineWidth;
        let yOffset = size;
        let innerDelta = -1;
        let outerDelta = -1;
        const centerRow = Rasterizer.pixels[y];
        if (innerRadius < 0) {
            innerRadius = 0;
        }
        let innerOutlineY = innerRadius;
        const innerLeftX = x - innerRadius;
        ArrayUtils.fillRange(centerRow, x - size, innerLeftX, outlineColor);
        const innerRightX = innerRadius + x;
        let innerError = -innerRadius;
        ArrayUtils.fillRange(centerRow, innerLeftX, innerRightX, fillColor);
        ArrayUtils.fillRange(centerRow, innerRightX, x + size, outlineColor);
        while (yOffset > xOffset) {
            outerDelta += 2;
            outerError += outerDelta;
            innerDelta += 2;
            innerError += innerDelta;
            if (innerError >= 0 && innerOutlineY >= 1) {
                Rasterizer.circleOutline[innerOutlineY] = xOffset;
                innerOutlineY--;
                innerError -= innerOutlineY << 1;
            }
            xOffset++;
            if (outerError >= 0) {
                yOffset--;
                if (yOffset >= innerRadius) {
                    const upperRow = Rasterizer.pixels[y + yOffset];
                    const rightX = x + xOffset;
                    const lowerRow = Rasterizer.pixels[y - yOffset];
                    const leftX = x - xOffset;
                    ArrayUtils.fillRange(upperRow, leftX, rightX, outlineColor);
                    ArrayUtils.fillRange(lowerRow, leftX, rightX, outlineColor);
                } else {
                    const upperRow = Rasterizer.pixels[yOffset + y];
                    const innerHalfWidth = Rasterizer.circleOutline[yOffset];
                    const lowerRow = Rasterizer.pixels[y - yOffset];
                    const outerRightX = xOffset + x;
                    const innerLeftX = x - innerHalfWidth;
                    const innerRightX = innerHalfWidth + x;
                    const outerLeftX = x - xOffset;
                    ArrayUtils.fillRange(upperRow, outerLeftX, innerLeftX, outlineColor);
                    ArrayUtils.fillRange(upperRow, innerLeftX, innerRightX, fillColor);
                    ArrayUtils.fillRange(upperRow, innerRightX, outerRightX, outlineColor);
                    ArrayUtils.fillRange(lowerRow, outerLeftX, innerLeftX, outlineColor);
                    ArrayUtils.fillRange(lowerRow, innerLeftX, innerRightX, fillColor);
                    ArrayUtils.fillRange(lowerRow, innerRightX, outerRightX, outlineColor);
                }
                outerError -= yOffset << 1;
            }
            const upperRow = Rasterizer.pixels[y + xOffset];
            const lowerRow = Rasterizer.pixels[y - xOffset];
            const rightX = yOffset + x;
            const leftX = x - yOffset;
            if (innerRadius <= xOffset) {
                ArrayUtils.fillRange(upperRow, leftX, rightX, outlineColor);
                ArrayUtils.fillRange(lowerRow, leftX, rightX, outlineColor);
            } else {
                const innerHalfWidthAtX =
                    xOffset > innerOutlineY ? Rasterizer.circleOutline[xOffset] : innerOutlineY;
                const innerRightX = innerHalfWidthAtX + x;
                const innerLeftX = x - innerHalfWidthAtX;
                ArrayUtils.fillRange(upperRow, leftX, innerLeftX, outlineColor);
                ArrayUtils.fillRange(upperRow, innerLeftX, innerRightX, fillColor);
                ArrayUtils.fillRange(upperRow, innerRightX, rightX, outlineColor);
                ArrayUtils.fillRange(lowerRow, leftX, innerLeftX, outlineColor);
                ArrayUtils.fillRange(lowerRow, innerLeftX, innerRightX, fillColor);
                ArrayUtils.fillRange(lowerRow, innerRightX, rightX, outlineColor);
            }
        }
    }

    static rasterCircleClamped(
        x: number,
        y: number,
        size: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        Rasterizer.initCircleOutline(size);
        let innerRadius = size - outlineWidth;
        let yOffset = size;
        let xOffset = 0;
        let outerError = -size;
        if (innerRadius < 0) {
            innerRadius = 0;
        }
        let innerOutlineY = innerRadius;
        if (Rasterizer.startY <= y && y <= Rasterizer.heightMask) {
            const centerRow = Rasterizer.pixels[y];
            const outerLeftX = clamp(x - size, Rasterizer.startX, Rasterizer.widthMask);
            const outerRightX = clamp(size + x, Rasterizer.startX, Rasterizer.widthMask);
            const innerLeftX = clamp(x - innerRadius, Rasterizer.startX, Rasterizer.widthMask);
            const innerRightX = clamp(x + innerRadius, Rasterizer.startX, Rasterizer.widthMask);
            ArrayUtils.fillRange(centerRow, outerLeftX, innerLeftX, outlineColor);
            ArrayUtils.fillRange(centerRow, innerLeftX, innerRightX, fillColor);
            ArrayUtils.fillRange(centerRow, innerRightX, outerRightX, outlineColor);
        }
        let innerError = -innerRadius;
        let innerDelta = -1;
        let outerDelta = -1;
        while (xOffset < yOffset) {
            innerDelta += 2;
            innerError += innerDelta;
            outerDelta += 2;
            if (innerError >= 0 && innerOutlineY >= 1) {
                innerOutlineY--;
                innerError -= innerOutlineY << 1;
                Rasterizer.circleOutline[innerOutlineY] = xOffset;
            }
            xOffset++;
            outerError += outerDelta;
            if (outerError >= 0) {
                yOffset--;
                outerError -= yOffset << 1;
                const yBottom = y - yOffset;
                const yTop = y + yOffset;
                if (Rasterizer.startY <= yTop && yBottom <= Rasterizer.heightMask) {
                    if (yOffset >= innerRadius) {
                        const outerRightX = clamp(
                            x + xOffset,
                            Rasterizer.startX,
                            Rasterizer.widthMask,
                        );
                        const outerLeftX = clamp(
                            x - xOffset,
                            Rasterizer.startX,
                            Rasterizer.widthMask,
                        );
                        if (Rasterizer.heightMask >= yTop) {
                            ArrayUtils.fillRange(
                                Rasterizer.pixels[yTop],
                                outerLeftX,
                                outerRightX,
                                outlineColor,
                            );
                        }
                        if (yBottom >= Rasterizer.startY) {
                            ArrayUtils.fillRange(
                                Rasterizer.pixels[yBottom],
                                outerLeftX,
                                outerRightX,
                                outlineColor,
                            );
                        }
                    } else {
                        const innerHalfWidth = Rasterizer.circleOutline[yOffset];
                        const outerRightX = clamp(
                            x + xOffset,
                            Rasterizer.startX,
                            Rasterizer.widthMask,
                        );
                        const outerLeftX = clamp(
                            x - xOffset,
                            Rasterizer.startX,
                            Rasterizer.widthMask,
                        );
                        const innerRightX = clamp(
                            x + innerHalfWidth,
                            Rasterizer.startX,
                            Rasterizer.widthMask,
                        );
                        const innerLeftX = clamp(
                            x - innerHalfWidth,
                            Rasterizer.startX,
                            Rasterizer.widthMask,
                        );
                        if (Rasterizer.heightMask >= yTop) {
                            const rowPixels = Rasterizer.pixels[yTop];
                            ArrayUtils.fillRange(rowPixels, outerLeftX, innerLeftX, outlineColor);
                            ArrayUtils.fillRange(rowPixels, innerLeftX, innerRightX, fillColor);
                            ArrayUtils.fillRange(rowPixels, innerRightX, outerRightX, outlineColor);
                        }
                        if (Rasterizer.startY <= yBottom) {
                            const rowPixels = Rasterizer.pixels[yBottom];
                            ArrayUtils.fillRange(rowPixels, outerLeftX, innerLeftX, outlineColor);
                            ArrayUtils.fillRange(rowPixels, innerLeftX, innerRightX, fillColor);
                            ArrayUtils.fillRange(rowPixels, innerRightX, outerRightX, outlineColor);
                        }
                    }
                }
            }
            const yTop = y + xOffset;
            const yBottom = y - xOffset;
            if (Rasterizer.startY <= yTop && Rasterizer.heightMask >= yBottom) {
                const outerRightXRaw = yOffset + x;
                const outerLeftXRaw = x - yOffset;
                if (outerRightXRaw >= Rasterizer.startX && Rasterizer.widthMask >= outerLeftXRaw) {
                    const outerRightX = clamp(
                        outerRightXRaw,
                        Rasterizer.startX,
                        Rasterizer.widthMask,
                    );
                    const outerLeftX = clamp(
                        outerLeftXRaw,
                        Rasterizer.startX,
                        Rasterizer.widthMask,
                    );
                    if (xOffset >= innerRadius) {
                        if (Rasterizer.heightMask >= yTop) {
                            ArrayUtils.fillRange(
                                Rasterizer.pixels[yTop],
                                outerLeftX,
                                outerRightX,
                                outlineColor,
                            );
                        }
                        if (Rasterizer.startY <= yBottom) {
                            ArrayUtils.fillRange(
                                Rasterizer.pixels[yBottom],
                                outerLeftX,
                                outerRightX,
                                outlineColor,
                            );
                        }
                    } else {
                        const innerHalfWidthAtX =
                            innerOutlineY >= xOffset
                                ? innerOutlineY
                                : Rasterizer.circleOutline[xOffset];
                        const innerRightX = clamp(
                            x + innerHalfWidthAtX,
                            Rasterizer.startX,
                            Rasterizer.widthMask,
                        );
                        const innerLeftX = clamp(
                            x - innerHalfWidthAtX,
                            Rasterizer.startX,
                            Rasterizer.widthMask,
                        );
                        if (Rasterizer.heightMask >= yTop) {
                            const rowPixels = Rasterizer.pixels[yTop];
                            ArrayUtils.fillRange(rowPixels, outerLeftX, innerLeftX, outlineColor);
                            ArrayUtils.fillRange(rowPixels, innerLeftX, innerRightX, fillColor);
                            ArrayUtils.fillRange(rowPixels, innerRightX, outerRightX, outlineColor);
                        }
                        if (Rasterizer.startY <= yBottom) {
                            const rowPixels = Rasterizer.pixels[yBottom];
                            ArrayUtils.fillRange(rowPixels, outerLeftX, innerLeftX, outlineColor);
                            ArrayUtils.fillRange(rowPixels, innerLeftX, innerRightX, fillColor);
                            ArrayUtils.fillRange(rowPixels, innerRightX, outerRightX, outlineColor);
                        }
                    }
                }
            }
        }
    }

    static rasterEllipseFill(
        x: number,
        y: number,
        sizeX: number,
        sizeY: number,
        fillColor: number,
    ) {
        if (sizeX === sizeY) {
            Rasterizer.rasterCircleFill(x, y, sizeX, fillColor);
        } else if (
            Rasterizer.startX <= x - sizeX &&
            Rasterizer.widthMask >= x + sizeX &&
            y - sizeY >= Rasterizer.startY &&
            Rasterizer.heightMask >= y + sizeY
        ) {
            Rasterizer.rasterEllipseFill0(x, y, sizeX, sizeY, fillColor);
        } else {
            Rasterizer.rasterEllipseFillClamped(x, y, sizeX, sizeY, fillColor);
        }
    }

    static rasterEllipseFill0(
        x: number,
        y: number,
        sizeX: number,
        sizeY: number,
        fillColor: number,
    ) {
        ArrayUtils.fillRange(Rasterizer.pixels[y], x - sizeX, sizeX + x, fillColor);
        let xOffset = 0;
        let yOffset = sizeY;
        const rx2 = sizeX * sizeX;
        const ry2 = sizeY * sizeY;
        const twoRx2 = rx2 << 1;
        const twoRy = sizeY << 1;
        const twoRy2 = ry2 << 1;
        let decisionB = ry2 - twoRx2 * (twoRy - 1);
        let decisionA = twoRy2 + (1 - twoRy) * rx2;
        const fourRx2 = rx2 << 2;
        let decisionAInc = twoRy2 * 3;
        let decisionBDec = twoRx2 * ((sizeY << 1) - 3);
        const fourRy2 = ry2 << 2;
        let decisionBInc = fourRy2;
        let decisionAAdjust = (sizeY - 1) * fourRx2;
        while (yOffset > 0) {
            if (decisionA < 0) {
                while (decisionA < 0) {
                    xOffset++;
                    decisionA += decisionAInc;
                    decisionB += decisionBInc;
                    decisionBInc += fourRy2;
                    decisionAInc += fourRy2;
                }
            }
            yOffset--;
            if (decisionB < 0) {
                decisionB += decisionBInc;
                decisionA += decisionAInc;
                decisionAInc += fourRy2;
                decisionBInc += fourRy2;
                xOffset++;
            }
            const yBottom = y - yOffset;
            decisionA += -decisionAAdjust;
            const rightX = x + xOffset;
            decisionAAdjust -= fourRx2;
            const yTop = yOffset + y;
            decisionB += -decisionBDec;
            decisionBDec -= fourRx2;
            const leftX = x - xOffset;
            ArrayUtils.fillRange(Rasterizer.pixels[yBottom], leftX, rightX, fillColor);
            ArrayUtils.fillRange(Rasterizer.pixels[yTop], leftX, rightX, fillColor);
        }
    }

    static rasterEllipseFillClamped(
        x: number,
        y: number,
        sizeX: number,
        sizeY: number,
        fillColor: number,
    ) {
        let yOffset = sizeY;
        let xOffset = 0;
        const ry2 = sizeY * sizeY;
        const rx2 = sizeX * sizeX;
        const twoRx2 = rx2 << 1;
        const twoRy2 = ry2 << 1;
        const twoRy = sizeY << 1;
        let decisionB = ry2 - (twoRy - 1) * twoRx2;
        let decisionA = (1 - twoRy) * rx2 + twoRy2;
        const fourRx2 = rx2 << 2;
        const fourRy2 = ry2 << 2;
        let decisionAInc = twoRy2 * 3;
        let decisionBInc = fourRy2;
        let decisionBDec = ((sizeY << 1) - 3) * twoRx2;
        if (y >= Rasterizer.startY && Rasterizer.heightMask >= y) {
            const rightX = clamp(x + sizeX, Rasterizer.startX, Rasterizer.widthMask);
            const leftX = clamp(x - sizeX, Rasterizer.startX, Rasterizer.widthMask);
            ArrayUtils.fillRange(Rasterizer.pixels[y], leftX, rightX, fillColor);
        }
        let decisionAAdjust = fourRx2 * (sizeY - 1);
        while (yOffset > 0) {
            if (decisionA < 0) {
                while (decisionA < 0) {
                    decisionA += decisionAInc;
                    decisionB += decisionBInc;
                    decisionBInc += fourRy2;
                    decisionAInc += fourRy2;
                    xOffset++;
                }
            }
            yOffset--;
            if (decisionB < 0) {
                decisionB += decisionBInc;
                decisionBInc += fourRy2;
                decisionA += decisionAInc;
                xOffset++;
                decisionAInc += fourRy2;
            }
            decisionA += -decisionAAdjust;
            const yBottom = y - yOffset;
            decisionB += -decisionBDec;
            decisionAAdjust -= fourRx2;
            const yTop = yOffset + y;
            decisionBDec -= fourRx2;
            if (yTop >= Rasterizer.startY && Rasterizer.heightMask >= yBottom) {
                const rightX = clamp(xOffset + x, Rasterizer.startX, Rasterizer.widthMask);
                const leftX = clamp(x - xOffset, Rasterizer.startX, Rasterizer.widthMask);
                if (Rasterizer.startY <= yBottom) {
                    ArrayUtils.fillRange(Rasterizer.pixels[yBottom], leftX, rightX, fillColor);
                }
                if (yTop <= Rasterizer.heightMask) {
                    ArrayUtils.fillRange(Rasterizer.pixels[yTop], leftX, rightX, fillColor);
                }
            }
        }
    }

    static rasterCircleFill(x: number, y: number, size: number, fillColor: number) {
        if (
            x - size >= Rasterizer.startX &&
            Rasterizer.widthMask >= x + size &&
            y - size >= Rasterizer.startY &&
            y + size <= Rasterizer.heightMask
        ) {
            Rasterizer.rasterCircleFill0(x, y, size, fillColor);
        } else {
            Rasterizer.rasterCircleFillClamped(x, y, size, fillColor);
        }
    }

    static rasterCircleFill0(x: number, y: number, size: number, fillColor: number) {
        ArrayUtils.fillRange(Rasterizer.pixels[y], x - size, size + x, fillColor);
        let xOffset = 0;
        let yOffset = size;
        let error = -size;
        let delta = -1;
        while (yOffset > xOffset) {
            delta += 2;
            xOffset++;
            error += delta;
            if (error >= 0) {
                yOffset--;
                error -= yOffset << 1;
                const upperRow = Rasterizer.pixels[y - yOffset];
                const lowerRow = Rasterizer.pixels[y + yOffset];
                const leftX = x - xOffset;
                const rightX = x + xOffset;
                ArrayUtils.fillRange(lowerRow, leftX, rightX, fillColor);
                ArrayUtils.fillRange(upperRow, leftX, rightX, fillColor);
            }
            const rightX = x + yOffset;
            const leftX = x - yOffset;
            const lowerRow = Rasterizer.pixels[y + xOffset];
            const upperRow = Rasterizer.pixels[y - xOffset];
            ArrayUtils.fillRange(lowerRow, leftX, rightX, fillColor);
            ArrayUtils.fillRange(upperRow, leftX, rightX, fillColor);
        }
    }

    static rasterCircleFillClamped(x: number, y: number, size: number, fillColor: number) {
        let xOffset = 0;
        let yOffset = size;
        let delta = -1;
        let error = -size;
        let rightX = clamp(size + x, Rasterizer.startX, Rasterizer.widthMask);
        let leftX = clamp(x - size, Rasterizer.startX, Rasterizer.widthMask);
        ArrayUtils.fillRange(Rasterizer.pixels[y], leftX, rightX, fillColor);
        while (yOffset > xOffset) {
            delta += 2;
            error += delta;
            if (error > 0) {
                yOffset--;
                error -= yOffset << 1;
                const yBottom = y - yOffset;
                const yTop = yOffset + y;
                if (yTop >= Rasterizer.startY && yBottom <= Rasterizer.heightMask) {
                    let rightX = clamp(x + xOffset, Rasterizer.startX, Rasterizer.widthMask);
                    let leftX = clamp(x - xOffset, Rasterizer.startX, Rasterizer.widthMask);
                    if (Rasterizer.heightMask >= yTop) {
                        ArrayUtils.fillRange(Rasterizer.pixels[yTop], leftX, rightX, fillColor);
                    }
                    if (Rasterizer.startY <= yBottom) {
                        ArrayUtils.fillRange(Rasterizer.pixels[yBottom], leftX, rightX, fillColor);
                    }
                }
            }
            xOffset++;
            const yBottom = y - xOffset;
            const yTop = y + xOffset;
            if (Rasterizer.startY <= yTop && yBottom <= Rasterizer.heightMask) {
                const rightX = clamp(x + yOffset, Rasterizer.startX, Rasterizer.widthMask);
                const leftX = clamp(x - yOffset, Rasterizer.startX, Rasterizer.widthMask);
                if (yTop <= Rasterizer.heightMask) {
                    ArrayUtils.fillRange(Rasterizer.pixels[yTop], leftX, rightX, fillColor);
                }
                if (Rasterizer.startY <= yBottom) {
                    ArrayUtils.fillRange(Rasterizer.pixels[yBottom], leftX, rightX, fillColor);
                }
            }
        }
    }
}

export abstract class RasterizerOperationShape {
    constructor(
        readonly fillColor: number,
        readonly outlineColor: number,
        readonly outlineWidth: number,
    ) {}

    abstract render(width: number, height: number): void;

    abstract renderFill(width: number, height: number): void;

    abstract renderOutline(width: number, height: number): void;
}

export class RasterizerOperationLine extends RasterizerOperationShape {
    static create(buffer: ByteBuffer): RasterizerOperationLine {
        const x0 = buffer.readShort();
        const y0 = buffer.readShort();
        const x1 = buffer.readShort();
        const y1 = buffer.readShort();
        const color = buffer.readMedium();
        const outlineWidth = buffer.readUnsignedByte();
        return new RasterizerOperationLine(x0, y0, x1, y1, color, outlineWidth);
    }

    constructor(
        readonly x0: number,
        readonly y0: number,
        readonly x1: number,
        readonly y1: number,
        color: number,
        outlineWidth: number,
    ) {
        super(-1, color, outlineWidth);
    }

    override render(width: number, height: number): void {}

    override renderFill(width: number, height: number): void {}

    override renderOutline(width: number, height: number): void {
        const x0 = (this.x0 * width) >> 12;
        const x1 = (this.x1 * width) >> 12;
        const y0 = (this.y0 * height) >> 12;
        const y1 = (this.y1 * height) >> 12;
        Rasterizer.rasterLine(x0, x1, y0, y1, this.outlineColor);
    }
}

export class RasterizerOperationBezierCurve extends RasterizerOperationShape {
    static create(buffer: ByteBuffer): RasterizerOperationBezierCurve {
        const x0 = buffer.readShort();
        const y0 = buffer.readShort();
        const x1 = buffer.readShort();
        const y1 = buffer.readShort();
        const x2 = buffer.readShort();
        const y2 = buffer.readShort();
        const x3 = buffer.readShort();
        const y3 = buffer.readShort();
        const color = buffer.readMedium();
        const outlineWidth = buffer.readUnsignedByte();
        return new RasterizerOperationBezierCurve(
            x0,
            y0,
            x1,
            y1,
            x2,
            y2,
            x3,
            y3,
            color,
            outlineWidth,
        );
    }

    constructor(
        readonly x0: number,
        readonly y0: number,
        readonly x1: number,
        readonly y1: number,
        readonly x2: number,
        readonly y2: number,
        readonly x3: number,
        readonly y3: number,
        color: number,
        outlineWidth: number,
    ) {
        super(-1, color, outlineWidth);
    }

    override render(width: number, height: number): void {}

    override renderFill(width: number, height: number): void {}

    override renderOutline(width: number, height: number): void {
        const x0 = (width * this.x0) >> 12;
        const y0 = (height * this.y0) >> 12;
        const x1 = (width * this.x1) >> 12;
        const y1 = (height * this.y1) >> 12;
        const x2 = (width * this.x2) >> 12;
        const y2 = (height * this.y2) >> 12;
        const x3 = (width * this.x3) >> 12;
        const y3 = (height * this.y3) >> 12;
        Rasterizer.rasterBezierCurve(x0, y0, x1, y1, x2, y2, x3, y3, this.outlineColor);
    }
}

export class RasterizerOperationRectangle extends RasterizerOperationShape {
    static create(buffer: ByteBuffer): RasterizerOperationRectangle {
        const x0 = buffer.readShort();
        const y0 = buffer.readShort();
        const x1 = buffer.readShort();
        const y1 = buffer.readShort();
        const fillColor = buffer.readMedium();
        const outlineColor = buffer.readMedium();
        const outlineWidth = buffer.readUnsignedByte();
        return new RasterizerOperationRectangle(
            x0,
            y0,
            x1,
            y1,
            fillColor,
            outlineColor,
            outlineWidth,
        );
    }

    constructor(
        readonly x0: number,
        readonly y0: number,
        readonly x1: number,
        readonly y1: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        super(fillColor, outlineColor, outlineWidth);
    }

    override render(width: number, height: number): void {
        const x0 = (this.x0 * width) >> 12;
        const x1 = (this.x1 * width) >> 12;
        const y0 = (this.y0 * height) >> 12;
        const y1 = (this.y1 * height) >> 12;
        Rasterizer.rasterRectangle(
            x0,
            x1,
            y0,
            y1,
            this.fillColor,
            this.outlineColor,
            this.outlineWidth,
        );
    }

    override renderFill(width: number, height: number): void {
        const x0 = (this.x0 * width) >> 12;
        const x1 = (this.x1 * width) >> 12;
        const y0 = (this.y0 * height) >> 12;
        const y1 = (this.y1 * height) >> 12;
        Rasterizer.rasterRectangleFill(x0, x1, y0, y1, this.fillColor);
    }

    override renderOutline(width: number, height: number): void {
        const x0 = (this.x0 * width) >> 12;
        const x1 = (this.x1 * width) >> 12;
        const y0 = (this.y0 * height) >> 12;
        const y1 = (this.y1 * height) >> 12;
        Rasterizer.rasterRectangleOutline(x0, x1, y0, y1, this.outlineColor, this.outlineWidth);
    }
}

export class RasterizerOperationEllipse extends RasterizerOperationShape {
    static create(buffer: ByteBuffer): RasterizerOperationEllipse {
        const x = buffer.readShort();
        const y = buffer.readShort();
        const sizeX = buffer.readShort();
        const sizeY = buffer.readShort();
        const fillColor = buffer.readMedium();
        const outlineColor = buffer.readMedium();
        const outlineWidth = buffer.readUnsignedByte();
        return new RasterizerOperationEllipse(
            x,
            y,
            sizeX,
            sizeY,
            fillColor,
            outlineColor,
            outlineWidth,
        );
    }

    constructor(
        readonly x: number,
        readonly y: number,
        readonly sizeX: number,
        readonly sizeY: number,
        fillColor: number,
        outlineColor: number,
        outlineWidth: number,
    ) {
        super(fillColor, outlineColor, outlineWidth);
    }

    override render(width: number, height: number): void {
        const x = (this.x * width) >> 12;
        const y = (this.y * height) >> 12;
        const sizeX = (this.sizeX * width) >> 12;
        const sizeY = (this.sizeY * height) >> 12;
        Rasterizer.rasterEllipse(
            x,
            y,
            sizeX,
            sizeY,
            this.fillColor,
            this.outlineColor,
            this.outlineWidth,
        );
    }

    override renderFill(width: number, height: number): void {
        const x = (this.x * width) >> 12;
        const y = (this.y * height) >> 12;
        const sizeX = (this.sizeX * width) >> 12;
        const sizeY = (this.sizeY * height) >> 12;
        Rasterizer.rasterEllipseFill(x, y, sizeX, sizeY, this.fillColor);
    }

    override renderOutline(width: number, height: number): void {}
}
