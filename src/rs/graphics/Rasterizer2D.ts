export class Rasterizer2D {
    pixels!: Int32Array;

    width: number = 0;
    height: number = 0;

    xClipStart: number = 0;
    yClipStart: number = 0;
    xClipEnd: number = 0;
    yClipEnd: number = 0;

    setRaster(pixels: Int32Array, width: number, height: number) {
        this.pixels = pixels;
        this.width = width;
        this.height = height;
        this.setClip(0, 0, width, height);
    }

    setClip(x: number, y: number, width: number, height: number) {
        if (x < 0) {
            x = 0;
        }

        if (y < 0) {
            y = 0;
        }

        if (width > this.width) {
            width = this.width;
        }

        if (height > this.height) {
            height = this.height;
        }

        this.xClipStart = x;
        this.yClipStart = y;
        this.xClipEnd = width;
        this.yClipEnd = height;
    }

    fillRectangle(x: number, y: number, width: number, height: number, rgb: number) {
        if (x < this.xClipStart) {
            width -= this.xClipStart - x;
            x = this.xClipStart;
        }

        if (y < this.yClipStart) {
            height -= this.yClipStart - y;
            y = this.yClipStart;
        }

        if (x + width > this.xClipEnd) {
            width = this.xClipEnd - x;
        }

        if (height + y > this.yClipEnd) {
            height = this.yClipEnd - y;
        }

        const widthOffset = this.width - width;
        let offset = x + this.width * y;

        for (let h = -height; h < 0; h++) {
            for (let w = -width; w < 0; w++) {
                this.pixels[offset++] = rgb;
            }

            offset += widthOffset;
        }
    }
}
