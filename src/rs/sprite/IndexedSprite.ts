import type { Rasterizer2DContext } from "../graphics/Rasterizer2D";

export class IndexedSprite {
    pixels!: Uint8Array;

    palette!: Int32Array;

    subWidth!: number;

    subHeight!: number;

    xOffset!: number;

    yOffset!: number;

    width!: number;

    height!: number;

    static raster(
        pixels: Int32Array,
        spritePixels: Uint8Array,
        palette: Int32Array,
        startX: number,
        startY: number,
        width: number,
        height: number,
        endX: number,
        endY: number,
    ): void {
        let quadCountNeg = -(width >> 2);
        width = -(width & 3);

        for (let rowNeg = -height; rowNeg < 0; rowNeg++) {
            for (let quadNeg = quadCountNeg; quadNeg < 0; quadNeg++) {
                let p = spritePixels[startX++];
                if (p !== 0) {
                    pixels[startY++] = palette[p & 0xff];
                } else {
                    startY++;
                }

                p = spritePixels[startX++];
                if (p !== 0) {
                    pixels[startY++] = palette[p & 0xff];
                } else {
                    startY++;
                }

                p = spritePixels[startX++];
                if (p !== 0) {
                    pixels[startY++] = palette[p & 0xff];
                } else {
                    startY++;
                }

                p = spritePixels[startX++];
                if (p !== 0) {
                    pixels[startY++] = palette[p & 0xff];
                } else {
                    startY++;
                }
            }

            for (let remNeg = width; remNeg < 0; remNeg++) {
                const paletteIndex = spritePixels[startX++];
                if (paletteIndex !== 0) {
                    pixels[startY++] = palette[paletteIndex & 0xff];
                } else {
                    startY++;
                }
            }

            startY += endX;
            startX += endY;
        }
    }

    normalize(): void {
        if (this.subWidth !== this.width || this.subHeight !== this.height) {
            const pixels = new Uint8Array(this.width * this.height);
            let index = 0;

            for (let y = 0; y < this.subHeight; y++) {
                for (let x = 0; x < this.subWidth; x++) {
                    pixels[x + (y + this.yOffset) * this.width + this.xOffset] =
                        this.pixels[index++];
                }
            }

            this.pixels = pixels;
            this.subWidth = this.width;
            this.subHeight = this.height;
            this.xOffset = 0;
            this.yOffset = 0;
        }
    }

    shiftColors(rOffset: number, gOffset: number, bOffset: number): void {
        for (let i = 0; i < this.palette.length; i++) {
            let r = (this.palette[i] >> 16) & 255;
            r += rOffset;
            if (r < 0) {
                r = 0;
            } else if (r > 255) {
                r = 255;
            }

            let g = (this.palette[i] >> 8) & 255;
            g += gOffset;
            if (g < 0) {
                g = 0;
            } else if (g > 255) {
                g = 255;
            }

            let b = this.palette[i] & 255;
            b += bOffset;
            if (b < 0) {
                b = 0;
            } else if (b > 255) {
                b = 255;
            }

            this.palette[i] = b + (g << 8) + (r << 16);
        }
    }

    getPixelsRgb(): Int32Array {
        const dstWidth = this.width;

        const dst = new Int32Array(this.width * this.height);

        for (let y = 0; y < this.height; y++) {
            let srcIndex = y * this.width;
            let dstIndex = this.xOffset + (y + this.yOffset) * dstWidth;
            for (let x = 0; x < this.width; x++) {
                const rgb = this.palette[this.pixels[srcIndex++] & 0xff];
                if (rgb !== 0) {
                    dst[dstIndex++] = ~0xffffff | rgb;
                } else {
                    dst[dstIndex++] = 0;
                }
            }
        }

        return dst;
    }

    getCanvas(): OffscreenCanvas {
        const canvas = new OffscreenCanvas(this.width, this.height);

        const ctx = canvas.getContext("2d")!;
        const imageData = ctx.createImageData(this.width, this.height);

        for (let i = 0; i < this.pixels.length; i++) {
            const rgb = this.palette[this.pixels[i] & 0xff];
            if (rgb !== 0) {
                imageData.data[i * 4] = (rgb >> 16) & 0xff;
                imageData.data[i * 4 + 1] = (rgb >> 8) & 0xff;
                imageData.data[i * 4 + 2] = rgb & 0xff;
                imageData.data[i * 4 + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);

        return canvas;
    }

    drawAt(r2d: Rasterizer2DContext, x: number, y: number): void {
        const Rasterizer2D = r2d;
        x += this.xOffset;
        y += this.yOffset;
        let startY = x + y * Rasterizer2D.width;
        let startX = 0;
        let height = this.subHeight;
        let width = this.subWidth;
        let endX = Rasterizer2D.width - width;
        let endY = 0;
        if (y < Rasterizer2D.yClipStart) {
            const clipY = Rasterizer2D.yClipStart - y;
            height -= clipY;
            y = Rasterizer2D.yClipStart;
            startX += clipY * width;
            startY += clipY * Rasterizer2D.width;
        }

        if (height + y > Rasterizer2D.yClipEnd) {
            height -= height + y - Rasterizer2D.yClipEnd;
        }

        if (x < Rasterizer2D.xClipStart) {
            const clipX = Rasterizer2D.xClipStart - x;
            width -= clipX;
            x = Rasterizer2D.xClipStart;
            startX += clipX;
            startY += clipX;
            endY += clipX;
            endX += clipX;
        }

        if (width + x > Rasterizer2D.xClipEnd) {
            const clipRight = width + x - Rasterizer2D.xClipEnd;
            width -= clipRight;
            endY += clipRight;
            endX += clipRight;
        }

        if (width > 0 && height > 0) {
            IndexedSprite.raster(
                Rasterizer2D.pixels,
                this.pixels,
                this.palette,
                startX,
                startY,
                width,
                height,
                endX,
                endY,
            );
        }
    }
}
