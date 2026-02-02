import { ByteBuffer } from "../../../io/ByteBuffer";
import { TextureGenerator } from "../TextureGenerator";
import { TextureOperation } from "./TextureOperation";

export class GradientOperation extends TextureOperation {
    presetId: number = 0;

    // Each stop is [posQ12, rQ12, gQ12, bQ12] with posQ12 in [0, 4096]
    stops?: Int32Array[];

    rgbLookup: Int32Array = new Int32Array(257);

    constructor() {
        super(1, false);
    }

    override decode(field: number, buffer: ByteBuffer): void {
        if (field === 0) {
            const presetId = buffer.readUnsignedByte();
            if (presetId === 0) {
                const stopCount = buffer.readUnsignedByte();
                this.stops = new Array(stopCount);
                for (let i = 0; i < stopCount; i++) {
                    const stop = (this.stops[i] = new Int32Array(4));
                    stop[0] = buffer.readUnsignedShort();
                    stop[1] = buffer.readUnsignedByte() << 4;
                    stop[2] = buffer.readUnsignedByte() << 4;
                    stop[3] = buffer.readUnsignedByte() << 4;
                }
            } else {
                this.presetId = presetId;
                this.setGradientPreset(presetId);
            }
        }
    }

    override init() {
        if (!this.stops) {
            this.setGradientPreset(1);
        }
        this.buildLookupTable();
    }

    override getColourOutput(textureGenerator: TextureGenerator, line: number): Int32Array[] {
        if (!this.colourImageCache) {
            throw new Error("Colour image cache is not initialized");
        }
        const output = this.colourImageCache.get(line);
        if (this.colourImageCache.dirty) {
            const input = this.getMonochromeInput(textureGenerator, 0, line);
            const outputR = output[0];
            const outputG = output[1];
            const outputB = output[2];
            for (let pixel = 0; pixel < textureGenerator.width; pixel++) {
                let index = input[pixel] >> 4;
                if (index < 0) {
                    index = 0;
                }
                if (index > 256) {
                    index = 256;
                }
                const rgb = this.rgbLookup[index];
                outputR[pixel] = (rgb & 0xff0000) >> 12;
                outputG[pixel] = (rgb & 0xff00) >> 4;
                outputB[pixel] = (rgb & 0xff) << 4;
            }
        }
        return output;
    }

    buildLookupTable(): void {
        if (!this.stops) {
            return;
        }

        const stopCount = this.stops.length;
        if (stopCount <= 0) {
            return;
        }
        for (let i = 0; i < this.rgbLookup.length; i++) {
            let stopIndex = 0;
            const posQ12 = i << 4;
            for (const stop of this.stops) {
                if (stop[0] > posQ12) {
                    break;
                }
                stopIndex++;
            }
            let r: number;
            let g: number;
            let b: number;
            if (stopIndex < stopCount) {
                const stopN = this.stops[stopIndex];
                if (stopIndex > 0) {
                    const stopP = this.stops[stopIndex - 1];
                    const nMod = (((posQ12 - stopP[0]) << 12) / (stopN[0] - stopP[0])) | 0;
                    const pMod = 4096 - nMod;
                    r = (stopP[1] * pMod + stopN[1] * nMod) >> 12;
                    g = (stopP[2] * pMod + stopN[2] * nMod) >> 12;
                    b = (stopN[3] * nMod + stopP[3] * pMod) >> 12;
                } else {
                    r = stopN[1];
                    g = stopN[2];
                    b = stopN[3];
                }
            } else {
                const stop = this.stops[stopCount - 1];
                r = stop[1];
                g = stop[2];
                b = stop[3];
            }
            r >>= 4;
            g >>= 4;
            b >>= 4;
            if (r < 0) {
                r = 0;
            } else if (r > 255) {
                r = 255;
            }
            if (g < 0) {
                g = 0;
            } else if (g > 255) {
                g = 255;
            }
            if (b < 0) {
                b = 0;
            } else if (b > 255) {
                b = 255;
            }
            this.rgbLookup[i] = (r << 16) | (g << 8) | b;
        }
    }

    setGradientPreset(preset: number) {
        this.presetId = preset;
        switch (preset) {
            case 1:
                this.stops = new Array(2);
                for (let i = 0; i < this.stops.length; i++) {
                    this.stops[i] = new Int32Array(4);
                }
                this.stops[0][0] = 0;
                this.stops[0][1] = 0;
                this.stops[0][2] = 0;
                this.stops[0][3] = 0;

                this.stops[1][0] = 4096;
                this.stops[1][1] = 4096;
                this.stops[1][2] = 4096;
                this.stops[1][3] = 4096;
                break;
            case 2:
                this.stops = new Array(8);
                for (let i = 0; i < this.stops.length; i++) {
                    this.stops[i] = new Int32Array(4);
                }
                this.stops[0][0] = 0;
                this.stops[0][1] = 2650;
                this.stops[0][2] = 2602;
                this.stops[0][3] = 2361;

                this.stops[1][0] = 2867;
                this.stops[1][1] = 2313;
                this.stops[1][2] = 1799;
                this.stops[1][3] = 1558;

                this.stops[2][0] = 3072;
                this.stops[2][1] = 2618;
                this.stops[2][2] = 1734;
                this.stops[2][3] = 1413;

                this.stops[3][0] = 3276;
                this.stops[3][1] = 2296;
                this.stops[3][2] = 1220;
                this.stops[3][3] = 947;

                this.stops[4][0] = 3481;
                this.stops[4][1] = 2072;
                this.stops[4][2] = 963;
                this.stops[4][3] = 722;

                this.stops[5][0] = 3686;
                this.stops[5][1] = 2730;
                this.stops[5][2] = 2152;
                this.stops[5][3] = 1766;

                this.stops[6][0] = 3891;
                this.stops[6][1] = 2232;
                this.stops[6][2] = 1060;
                this.stops[6][3] = 915;

                this.stops[7][0] = 4096;
                this.stops[7][1] = 1686;
                this.stops[7][2] = 1413;
                this.stops[7][3] = 1140;
                break;
            case 3:
                this.stops = new Array(7);
                for (let i = 0; i < this.stops.length; i++) {
                    this.stops[i] = new Int32Array(4);
                }

                this.stops[0][1] = 0;
                this.stops[0][2] = 0;
                this.stops[0][0] = 0;
                this.stops[0][3] = 4096;

                this.stops[1][1] = 0;
                this.stops[1][0] = 663;
                this.stops[1][3] = 4096;
                this.stops[1][2] = 4096;

                this.stops[2][2] = 4096;
                this.stops[2][1] = 0;
                this.stops[2][0] = 1363;
                this.stops[2][3] = 0;

                this.stops[3][3] = 0;
                this.stops[3][2] = 4096;
                this.stops[3][1] = 4096;
                this.stops[3][0] = 2048;

                this.stops[4][3] = 0;
                this.stops[4][0] = 2727;
                this.stops[4][2] = 0;
                this.stops[4][1] = 4096;

                this.stops[5][1] = 4096;
                this.stops[5][0] = 3411;
                this.stops[5][2] = 0;
                this.stops[5][3] = 4096;

                this.stops[6][3] = 4096;
                this.stops[6][2] = 0;
                this.stops[6][1] = 0;
                this.stops[6][0] = 4096;
                break;

            case 4:
                this.stops = new Array(6);
                for (let i = 0; i < this.stops.length; i++) {
                    this.stops[i] = new Int32Array(4);
                }
                this.stops[0][3] = 0;
                this.stops[0][1] = 0;
                this.stops[0][0] = 0;
                this.stops[0][2] = 0;

                this.stops[1][0] = 1843;
                this.stops[1][3] = 1493;
                this.stops[1][2] = 0;
                this.stops[1][1] = 0;

                this.stops[2][3] = 2939;
                this.stops[2][0] = 2457;
                this.stops[2][1] = 0;
                this.stops[2][2] = 0;

                this.stops[3][3] = 3565;
                this.stops[3][0] = 2781;
                this.stops[3][1] = 0;
                this.stops[3][2] = 1124;

                this.stops[4][3] = 4031;
                this.stops[4][1] = 546;
                this.stops[4][0] = 3481;
                this.stops[4][2] = 3084;

                this.stops[5][0] = 4096;
                this.stops[5][2] = 4096;
                this.stops[5][1] = 4096;
                this.stops[5][3] = 4096;
                break;
            case 5:
                this.stops = new Array(16);
                for (let i = 0; i < this.stops.length; i++) {
                    this.stops[i] = new Int32Array(4);
                }
                this.stops[0][2] = 192;
                this.stops[0][0] = 0;
                this.stops[0][1] = 80;
                this.stops[0][3] = 321;

                this.stops[1][1] = 321;
                this.stops[1][0] = 155;
                this.stops[1][3] = 562;
                this.stops[1][2] = 449;

                this.stops[2][1] = 578;
                this.stops[2][0] = 389;
                this.stops[2][3] = 803;
                this.stops[2][2] = 690;

                this.stops[3][2] = 995;
                this.stops[3][0] = 671;
                this.stops[3][3] = 1140;
                this.stops[3][1] = 947;

                this.stops[4][2] = 1397;
                this.stops[4][1] = 1285;
                this.stops[4][0] = 897;
                this.stops[4][3] = 1509;

                this.stops[5][2] = 1429;
                this.stops[5][0] = 1175;
                this.stops[5][3] = 1413;
                this.stops[5][1] = 1525;

                this.stops[6][3] = 1333;
                this.stops[6][0] = 1368;
                this.stops[6][1] = 1734;
                this.stops[6][2] = 1461;

                this.stops[7][0] = 1507;
                this.stops[7][1] = 1413;
                this.stops[7][3] = 1702;
                this.stops[7][2] = 1525;

                this.stops[8][1] = 1108;
                this.stops[8][2] = 1590;
                this.stops[8][3] = 2056;
                this.stops[8][0] = 1736;

                this.stops[9][1] = 1766;
                this.stops[9][0] = 2088;
                this.stops[9][3] = 2666;
                this.stops[9][2] = 2056;

                this.stops[10][2] = 2586;
                this.stops[10][0] = 2355;
                this.stops[10][1] = 2409;
                this.stops[10][3] = 3276;

                this.stops[11][1] = 3116;
                this.stops[11][3] = 3228;
                this.stops[11][2] = 3148;
                this.stops[11][0] = 2691;

                this.stops[12][2] = 3710;
                this.stops[12][1] = 3806;
                this.stops[12][3] = 3196;
                this.stops[12][0] = 3031;

                this.stops[13][1] = 3437;
                this.stops[13][2] = 3421;
                this.stops[13][3] = 3019;
                this.stops[13][0] = 3522;

                this.stops[14][1] = 3116;
                this.stops[14][0] = 3727;
                this.stops[14][2] = 3148;
                this.stops[14][3] = 3228;

                this.stops[15][1] = 2377;
                this.stops[15][2] = 2505;
                this.stops[15][3] = 2746;
                this.stops[15][0] = 4096;
                break;

            case 6:
                this.stops = new Array(4);
                for (let i = 0; i < this.stops.length; i++) {
                    this.stops[i] = new Int32Array(4);
                }
                this.stops[0][3] = 0;
                this.stops[0][2] = 4096;
                this.stops[0][0] = 2048;
                this.stops[0][1] = 0;

                this.stops[1][2] = 4096;
                this.stops[1][1] = 4096;
                this.stops[1][3] = 0;
                this.stops[1][0] = 2867;

                this.stops[2][1] = 4096;
                this.stops[2][2] = 4096;
                this.stops[2][3] = 0;
                this.stops[2][0] = 3276;

                this.stops[3][2] = 0;
                this.stops[3][0] = 4096;
                this.stops[3][3] = 0;
                this.stops[3][1] = 4096;
                break;
            default:
                throw new Error(`Invalid gradient preset: ${preset}`);
        }
    }
}
