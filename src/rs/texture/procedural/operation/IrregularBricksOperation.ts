import JavaRandom from "../../../../util/JavaRandom";
import { nextIntJagex } from "../../../../util/MathUtil";
import { ByteBuffer } from "../../../io/ByteBuffer";
import { ArrayUtils } from "../../../util/ArrayUtils";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

enum CornerBlendMode {
    Multiply = 0,
    Min = 1,
}

export class IrregularBricksOperation extends TextureOperation {
    seed = 0;
    minBrickWidthQ12 = 1024;
    maxBrickWidthQ12 = 2048;
    minBrickHeightQ12 = 409;
    maxBrickHeightQ12 = 819;
    bevelRadiusScaleQ12 = 1024;
    cornerBlendMode: CornerBlendMode = CornerBlendMode.Multiply;
    bevelJitterQ12 = 1024;
    brickValueVariationQ12 = 1024;

    bevelRadiusPx = 0;

    constructor() {
        super(0, true);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            this.seed = buffer.readUnsignedByte();
        } else if (field === 1) {
            this.minBrickWidthQ12 = buffer.readUnsignedShort();
        } else if (field === 2) {
            this.maxBrickWidthQ12 = buffer.readUnsignedShort();
        } else if (field === 3) {
            this.minBrickHeightQ12 = buffer.readUnsignedShort();
        } else if (field === 4) {
            this.maxBrickHeightQ12 = buffer.readUnsignedShort();
        } else if (field === 5) {
            this.bevelRadiusScaleQ12 = buffer.readUnsignedShort();
        } else if (field === 6) {
            this.cornerBlendMode = buffer.readUnsignedByte() as CornerBlendMode;
        } else if (field === 7) {
            this.bevelJitterQ12 = buffer.readUnsignedShort();
        } else if (field === 8) {
            this.brickValueVariationQ12 = buffer.readUnsignedShort();
        }
    }

    drawBrick(
        textureGenerator: TextureGenerator,
        brickHeightPx: number,
        brickWidthPx: number,
        startX: number,
        startY: number,
        random: JavaRandom,
        pixels: Int32Array[],
    ) {
        const brickValue =
            this.brickValueVariationQ12 > 0
                ? 4096 - nextIntJagex(random, this.brickValueVariationQ12)
                : 4096;
        const bevelJitterPx = (this.bevelRadiusPx * this.bevelJitterQ12) >> 12;
        const bevelRadiusPx =
            this.bevelRadiusPx - (bevelJitterPx > 0 ? nextIntJagex(random, bevelJitterPx) : 0);
        if (textureGenerator.width <= startX) {
            startX -= textureGenerator.width;
        }
        if (bevelRadiusPx > 0) {
            if (brickHeightPx <= 0 || brickWidthPx <= 0) {
                return;
            }

            const halfWidth = (brickWidthPx / 2) | 0;
            const halfHeight = (brickHeightPx / 2) | 0;
            const bevelWidthPx = halfWidth >= bevelRadiusPx ? bevelRadiusPx : halfWidth;
            const bevelHeightPx = bevelRadiusPx > halfHeight ? halfHeight : bevelRadiusPx;
            const innerStartX = startX + bevelWidthPx;
            const innerWidth = brickWidthPx - bevelWidthPx * 2;

            for (let y = 0; y < brickHeightPx; y++) {
                const row = pixels[y + startY];
                if (bevelHeightPx <= y) {
                    const invY = brickHeightPx - y - 1;
                    if (bevelHeightPx <= invY) {
                        for (let dx = 0; dx < bevelWidthPx; dx++) {
                            row[textureGenerator.widthMask & (startX + dx)] = row[
                                textureGenerator.widthMask & (brickWidthPx + startX - dx - 1)
                            ] = ((brickValue * dx) / bevelWidthPx) | 0;
                        }
                        if (innerStartX + innerWidth <= textureGenerator.width) {
                            ArrayUtils.fill(row, innerStartX, innerWidth, brickValue);
                        } else {
                            const rightLen = textureGenerator.width - innerStartX;
                            ArrayUtils.fill(row, innerStartX, rightLen, brickValue);
                            ArrayUtils.fill(row, 0, innerWidth - rightLen, brickValue);
                        }
                    } else {
                        const verticalFade = ((invY * brickValue) / bevelHeightPx) | 0;
                        if (this.cornerBlendMode === CornerBlendMode.Multiply) {
                            for (let dx = 0; dx < bevelWidthPx; dx++) {
                                const horizontalFade = ((dx * brickValue) / bevelWidthPx) | 0;
                                row[textureGenerator.widthMask & (startX + dx)] = row[
                                    (brickWidthPx + startX - dx - 1) & textureGenerator.widthMask
                                ] = (verticalFade * horizontalFade) >> 12;
                            }
                        } else {
                            for (let dx = 0; dx < bevelWidthPx; dx++) {
                                const horizontalFade = ((brickValue * dx) / bevelWidthPx) | 0;
                                row[textureGenerator.widthMask & (dx + startX)] = row[
                                    textureGenerator.widthMask & (startX + brickWidthPx - dx - 1)
                                ] = verticalFade > horizontalFade ? horizontalFade : verticalFade;
                            }
                        }
                        if (textureGenerator.width < innerWidth + innerStartX) {
                            const rightLen = textureGenerator.width - innerStartX;
                            ArrayUtils.fill(row, innerStartX, rightLen, verticalFade);
                            ArrayUtils.fill(row, 0, innerWidth - rightLen, verticalFade);
                        } else {
                            ArrayUtils.fill(row, innerStartX, innerWidth, verticalFade);
                        }
                    }
                } else {
                    const verticalFade = ((y * brickValue) / bevelHeightPx) | 0;
                    if (this.cornerBlendMode === CornerBlendMode.Multiply) {
                        for (let dx = 0; dx < bevelWidthPx; dx++) {
                            const horizontalFade = ((brickValue * dx) / bevelWidthPx) | 0;
                            row[textureGenerator.widthMask & (dx + startX)] = row[
                                (startX + brickWidthPx - dx - 1) & textureGenerator.widthMask
                            ] = (horizontalFade * verticalFade) >> 12;
                        }
                    } else {
                        for (let dx = 0; dx < bevelWidthPx; dx++) {
                            const horizontalFade = ((brickValue * dx) / bevelWidthPx) | 0;
                            row[(dx + startX) & textureGenerator.widthMask] = row[
                                (brickWidthPx + startX - dx - 1) & textureGenerator.widthMask
                            ] = verticalFade <= horizontalFade ? verticalFade : horizontalFade;
                        }
                    }

                    if (innerStartX + innerWidth > textureGenerator.width) {
                        const rightLen = textureGenerator.width - innerStartX;
                        ArrayUtils.fill(row, innerStartX, rightLen, verticalFade);
                        ArrayUtils.fill(row, 0, innerWidth - rightLen, verticalFade);
                    } else {
                        ArrayUtils.fill(row, innerStartX, innerWidth, verticalFade);
                    }
                }
            }
        } else if (textureGenerator.width >= brickWidthPx + startX) {
            for (let y = 0; y < brickHeightPx; y++) {
                ArrayUtils.fill(pixels[y + startY], startX, brickWidthPx, brickValue);
            }
        } else {
            const rightLen = textureGenerator.width - startX;
            for (let y = 0; y < brickHeightPx; y++) {
                const row = pixels[y + startY];
                ArrayUtils.fill(row, startX, rightLen, brickValue);
                ArrayUtils.fill(row, 0, brickWidthPx - rightLen, brickValue);
            }
        }
    }

    override getMonochromeOutput(textureGenerator: TextureGenerator, line: number): Int32Array {
        if (!this.monochromeImageCache) {
            throw new Error("Monochrome image cache is not initialized");
        }
        const output = this.monochromeImageCache.get(line);
        if (!this.monochromeImageCache.dirty) {
            return output;
        }

        let rowXDelta = 0;
        const pixels = this.monochromeImageCache.getAll();
        let rowXOffset = 0;
        let xCursor = 0;
        let prevRowXOffset = 0;
        let segmentCursor = 0;
        let isFirstRow = true;
        let segmentCount = 0;
        let reachedBottom = true;
        const minBrickWidthPx = (this.minBrickWidthQ12 * textureGenerator.width) >> 12;
        let segmentWriteIndex = 0;
        const minBrickHeightPx = (this.minBrickHeightQ12 * textureGenerator.height) >> 12;
        const maxBrickWidthPx = (textureGenerator.width * this.maxBrickWidthQ12) >> 12;
        const maxBrickHeightPx = (this.maxBrickHeightQ12 * textureGenerator.height) >> 12;
        if (maxBrickHeightPx <= 1) {
            return pixels[line];
        }

        this.bevelRadiusPx = ((textureGenerator.width / 8) * this.bevelRadiusScaleQ12) >> 12;
        const maxSegments = (textureGenerator.width / minBrickWidthPx + 1) | 0;
        const random = new JavaRandom(this.seed);

        let segments = new Array<Int32Array>(maxSegments);
        let prevSegments = new Array<Int32Array>(maxSegments);
        for (let i = 0; i < maxSegments; i++) {
            segments[i] = new Int32Array(3);
            prevSegments[i] = new Int32Array(3);
        }

        while (true) {
            while (true) {
                let brickWidthPx =
                    minBrickWidthPx + nextIntJagex(random, maxBrickWidthPx - minBrickWidthPx);
                let brickHeightPx =
                    nextIntJagex(random, maxBrickHeightPx - minBrickHeightPx) + minBrickHeightPx;
                let xEnd = xCursor + brickWidthPx;
                if (xEnd > textureGenerator.width) {
                    brickWidthPx = textureGenerator.width - xCursor;
                    xEnd = textureGenerator.width;
                }

                let startY: number;
                if (isFirstRow) {
                    startY = 0;
                } else {
                    let searchIndex = segmentCursor;
                    const baseSegment = prevSegments[segmentCursor];
                    startY = baseSegment[2];
                    let scannedCount = 0;
                    let targetX = rowXDelta + xEnd;
                    if (targetX < 0) {
                        targetX += textureGenerator.width;
                    }
                    if (textureGenerator.width < targetX) {
                        targetX -= textureGenerator.width;
                    }

                    while (true) {
                        const segment = prevSegments[searchIndex];
                        if (segment[0] <= targetX && targetX <= segment[1]) {
                            if (searchIndex !== segmentCursor) {
                                let startX = xCursor + rowXDelta;
                                if (startX < 0) {
                                    startX += textureGenerator.width;
                                }
                                if (startX > textureGenerator.width) {
                                    startX -= textureGenerator.width;
                                }

                                for (let i = 1; i <= scannedCount; i++) {
                                    const seg = prevSegments[(i + segmentCursor) % segmentCount];
                                    startY = Math.max(startY, seg[2]);
                                }

                                for (let i = 0; i <= scannedCount; i++) {
                                    const seg = prevSegments[(i + segmentCursor) % segmentCount];
                                    const segBottomY = seg[2];
                                    if (segBottomY !== startY) {
                                        const segEndX = seg[1];
                                        const segStartX = seg[0];
                                        let fillStartX: number;
                                        let fillEndX: number;
                                        if (startX < targetX) {
                                            fillStartX = Math.max(startX, segStartX);
                                            fillEndX = Math.min(targetX, segEndX);
                                        } else if (segStartX === 0) {
                                            fillEndX = Math.min(targetX, segEndX);
                                            fillStartX = 0;
                                        } else {
                                            fillStartX = Math.max(startX, segStartX);
                                            fillEndX = textureGenerator.width;
                                        }
                                        this.drawBrick(
                                            textureGenerator,
                                            startY - segBottomY,
                                            fillEndX - fillStartX,
                                            prevRowXOffset + fillStartX,
                                            segBottomY,
                                            random,
                                            pixels,
                                        );
                                    }
                                }
                            }
                            segmentCursor = searchIndex;
                            break;
                        }
                        searchIndex++;
                        if (searchIndex >= segmentCount) {
                            searchIndex = 0;
                        }
                        scannedCount++;
                    }
                }

                if (textureGenerator.height < brickHeightPx + startY) {
                    brickHeightPx = textureGenerator.height - startY;
                } else {
                    reachedBottom = false;
                }

                if (xEnd === textureGenerator.width) {
                    this.drawBrick(
                        textureGenerator,
                        brickHeightPx,
                        brickWidthPx,
                        xCursor + rowXOffset,
                        startY,
                        random,
                        pixels,
                    );
                    if (reachedBottom) {
                        return output;
                    }

                    isFirstRow = false;
                    const newSegmentCount = segmentWriteIndex + 1;
                    const seg = segments[segmentWriteIndex];
                    reachedBottom = true;
                    seg[1] = xEnd;
                    prevRowXOffset = rowXOffset;
                    segmentCount = newSegmentCount;
                    seg[0] = xCursor;
                    seg[2] = brickHeightPx + startY;
                    rowXOffset = nextIntJagex(random, textureGenerator.width);

                    const tmp = prevSegments;
                    segmentCursor = 0;
                    rowXDelta = rowXOffset - prevRowXOffset;
                    prevSegments = segments;
                    let xProbe = rowXDelta;
                    segments = tmp;
                    if (rowXDelta < 0) {
                        xProbe = rowXDelta + textureGenerator.width;
                    }
                    segmentWriteIndex = 0;
                    if (textureGenerator.width < xProbe) {
                        xProbe -= textureGenerator.width;
                    }
                    while (true) {
                        const segCheck = prevSegments[segmentCursor];
                        if (xProbe >= segCheck[0] && segCheck[1] >= xProbe) {
                            xCursor = 0;
                            break;
                        }
                        segmentCursor++;
                        if (segmentCount <= segmentCursor) {
                            segmentCursor = 0;
                        }
                    }
                } else {
                    const seg = segments[segmentWriteIndex++];
                    seg[1] = xEnd;
                    seg[2] = brickHeightPx + startY;
                    seg[0] = xCursor;
                    this.drawBrick(
                        textureGenerator,
                        brickHeightPx,
                        brickWidthPx,
                        rowXOffset + xCursor,
                        startY,
                        random,
                        pixels,
                    );
                    xCursor = xEnd;
                }
            }
        }
    }
}
