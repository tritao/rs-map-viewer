export class FloatUtil {
    static MAX_VALUE: number = 3.4028234663852886e38;

    static buffer: ArrayBuffer = new ArrayBuffer(4);
    static view: DataView = new DataView(FloatUtil.buffer);

    static floatBitsToInt(n: number): number {
        this.view.setFloat32(0, n, true);
        return this.view.getInt32(0, true);
    }

    static intBitsToFloat(n: number): number {
        this.view.setInt32(0, n, true);
        return this.view.getFloat32(0, true);
    }

    static packFloat11(v: number): number {
        return 1024 - Math.round(v / (1 / 64));
    }

    static unpackFloat11(v: number): number {
        return 16 - v / 64;
    }

    // 0-1, 1/63 decimal precision
    static packFloat6(v: number): number {
        return Math.round(v / (1 / 63));
    }

    static unpackFloat6(v: number): number {
        return v / 63;
    }
}
