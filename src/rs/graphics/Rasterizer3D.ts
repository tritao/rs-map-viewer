import { nextPow2 } from "../../util/MathUtil";
import { HSL_RGB_MAP } from "../util/ColorUtil";
import type { Rasterizer2DContext } from "./Rasterizer2D";

export class Rasterizer3D {
    lowMem = false;
    rasterClipEnable: boolean = false;
    rasterGouraudLowRes: boolean = true;
    rasterAlpha: number = 0;

    rasterClipY: Int32Array = new Int32Array(1024);

    endX: number = 0;
    endY: number = 0;

    centerX: number = 0;
    centerY: number = 0;

    viewportLeft: number = 0;
    viewportRight: number = 0;
    viewportTop: number = 0;
    viewportBottom: number = 0;

    setClip(r2d: Rasterizer2DContext) {
        const Rasterizer3D = this;
        const Rasterizer2D = r2d;
        Rasterizer3D.setRasterClip(
            Rasterizer2D,
            Rasterizer2D.xClipStart,
            Rasterizer2D.yClipStart,
            Rasterizer2D.xClipEnd,
            Rasterizer2D.yClipEnd,
        );
    }

    setRasterClip(
        r2d: Rasterizer2DContext,
        xClipStart: number,
        yClipStart: number,
        xClipEnd: number,
        yClipEnd: number,
    ) {
        const Rasterizer3D = this;
        const Rasterizer2D = r2d;
        Rasterizer3D.endX = xClipEnd - xClipStart;
        Rasterizer3D.endY = yClipEnd - yClipStart;
        Rasterizer3D.calculateViewport();

        if (Rasterizer3D.endY > Rasterizer3D.rasterClipY.length) {
            Rasterizer3D.rasterClipY = new Int32Array(nextPow2(Rasterizer3D.endY));
        }

        let v = xClipStart + Rasterizer2D.width * yClipStart;
        for (let i = 0; i < Rasterizer3D.endY; i++) {
            Rasterizer3D.rasterClipY[i] = v;
            v += Rasterizer2D.width;
        }
    }

    calculateViewport() {
        const Rasterizer3D = this;
        Rasterizer3D.centerX = (Rasterizer3D.endX / 2) | 0;
        Rasterizer3D.centerY = (Rasterizer3D.endY / 2) | 0;
        Rasterizer3D.viewportLeft = -Rasterizer3D.centerX;
        Rasterizer3D.viewportRight = Rasterizer3D.endX - Rasterizer3D.centerX;
        Rasterizer3D.viewportTop = -Rasterizer3D.centerY;
        Rasterizer3D.viewportBottom = Rasterizer3D.endY - Rasterizer3D.centerY;
    }

    setViewport(r2d: Rasterizer2DContext, x: number, y: number) {
        const Rasterizer3D = this;
        const Rasterizer2D = r2d;
        const offset = Rasterizer3D.rasterClipY[0];
        const clipStartY = (offset / Rasterizer2D.width) | 0;
        const clipStartX = offset - clipStartY * Rasterizer2D.width;
        Rasterizer3D.centerX = x - clipStartX;
        Rasterizer3D.centerY = y - clipStartY;
        Rasterizer3D.viewportLeft = -Rasterizer3D.centerX;
        Rasterizer3D.viewportRight = Rasterizer3D.endX - Rasterizer3D.centerX;
        Rasterizer3D.viewportTop = -Rasterizer3D.centerY;
        Rasterizer3D.viewportBottom = Rasterizer3D.endY - Rasterizer3D.centerY;
    }

    rasterGouraud(
        r2d: Rasterizer2DContext,
        y0: number,
        y1: number,
        y2: number,
        x0: number,
        x1: number,
        x2: number,
        hsl0: number,
        hsl1: number,
        hsl2: number,
    ) {
        const Rasterizer3D = this;
        const Rasterizer2D = r2d;
        const dx01 = x1 - x0;
        const dy01 = y1 - y0;
        const dx02 = x2 - x0;
        const dy02 = y2 - y0;
        const dhsl01 = hsl1 - hsl0;
        const dhsl02 = hsl2 - hsl0;

        const slope12 = y2 !== y1 ? (((x2 - x1) << 14) / (y2 - y1)) | 0 : 0;
        const slope01 = y0 !== y1 ? ((dx01 << 14) / dy01) | 0 : 0;
        const slope02 = y0 !== y2 ? ((dx02 << 14) / dy02) | 0 : 0;

        const area2 = dx01 * dy02 - dx02 * dy01;
        if (area2 !== 0) {
            const hslStepX = (((dhsl01 * dy02 - dhsl02 * dy01) << 8) / area2) | 0;
            const hslStepY = (((dhsl02 * dx01 - dhsl01 * dx02) << 8) / area2) | 0;
            if (y0 <= y1 && y0 <= y2) {
                if (y0 < Rasterizer3D.endY) {
                    if (y1 > Rasterizer3D.endY) {
                        y1 = Rasterizer3D.endY;
                    }

                    if (y2 > Rasterizer3D.endY) {
                        y2 = Rasterizer3D.endY;
                    }

                    hsl0 = hslStepX + ((hsl0 << 8) - x0 * hslStepX);
                    if (y1 < y2) {
                        x2 = x0 <<= 14;
                        if (y0 < 0) {
                            x2 -= y0 * slope02;
                            x0 -= y0 * slope01;
                            hsl0 -= y0 * hslStepY;
                            y0 = 0;
                        }

                        x1 <<= 14;
                        if (y1 < 0) {
                            x1 -= slope12 * y1;
                            y1 = 0;
                        }

                        if (
                            (y0 !== y1 && slope02 < slope01) ||
                            (y0 === y1 && slope02 > slope12)
                        ) {
                            y2 -= y1;
                            y1 -= y0;
                            y0 = Rasterizer3D.rasterClipY[y0];

                            while (true) {
                                --y1;
                                if (y1 < 0) {
                                    while (true) {
                                        --y2;
                                        if (y2 < 0) {
                                            return;
                                        }

                                        Rasterizer3D.rasterGouraudLine(
                                            Rasterizer2D.pixels,
                                            y0,
                                            x2 >> 14,
                                            x1 >> 14,
                                            hsl0,
                                            hslStepX,
                                        );
                                        x2 += slope02;
                                        x1 += slope12;
                                        hsl0 += hslStepY;
                                        y0 += Rasterizer2D.width;
                                    }
                                }

                                Rasterizer3D.rasterGouraudLine(
                                    Rasterizer2D.pixels,
                                    y0,
                                    x2 >> 14,
                                    x0 >> 14,
                                    hsl0,
                                    hslStepX,
                                );
                                x2 += slope02;
                                x0 += slope01;
                                hsl0 += hslStepY;
                                y0 += Rasterizer2D.width;
                            }
                        } else {
                            y2 -= y1;
                            y1 -= y0;
                            y0 = Rasterizer3D.rasterClipY[y0];

                            while (true) {
                                --y1;
                                if (y1 < 0) {
                                    while (true) {
                                        --y2;
                                        if (y2 < 0) {
                                            return;
                                        }

                                        Rasterizer3D.rasterGouraudLine(
                                            Rasterizer2D.pixels,
                                            y0,
                                            x1 >> 14,
                                            x2 >> 14,
                                            hsl0,
                                            hslStepX,
                                        );
                                        x2 += slope02;
                                        x1 += slope12;
                                        hsl0 += hslStepY;
                                        y0 += Rasterizer2D.width;
                                    }
                                }

                                Rasterizer3D.rasterGouraudLine(
                                    Rasterizer2D.pixels,
                                    y0,
                                    x0 >> 14,
                                    x2 >> 14,
                                    hsl0,
                                    hslStepX,
                                );
                                x2 += slope02;
                                x0 += slope01;
                                hsl0 += hslStepY;
                                y0 += Rasterizer2D.width;
                            }
                        }
                    } else {
                        x1 = x0 <<= 14;
                        if (y0 < 0) {
                            x1 -= y0 * slope02;
                            x0 -= y0 * slope01;
                            hsl0 -= y0 * hslStepY;
                            y0 = 0;
                        }

                        x2 <<= 14;
                        if (y2 < 0) {
                            x2 -= slope12 * y2;
                            y2 = 0;
                        }

                        if (
                            (y0 !== y2 && slope02 < slope01) ||
                            (y0 === y2 && slope12 > slope01)
                        ) {
                            y1 -= y2;
                            y2 -= y0;
                            y0 = Rasterizer3D.rasterClipY[y0];

                            while (true) {
                                --y2;
                                if (y2 < 0) {
                                    while (true) {
                                        --y1;
                                        if (y1 < 0) {
                                            return;
                                        }

                                        Rasterizer3D.rasterGouraudLine(
                                            Rasterizer2D.pixels,
                                            y0,
                                            x2 >> 14,
                                            x0 >> 14,
                                            hsl0,
                                            hslStepX,
                                        );
                                        x2 += slope12;
                                        x0 += slope01;
                                        hsl0 += hslStepY;
                                        y0 += Rasterizer2D.width;
                                    }
                                }

                                Rasterizer3D.rasterGouraudLine(
                                    Rasterizer2D.pixels,
                                    y0,
                                    x1 >> 14,
                                    x0 >> 14,
                                    hsl0,
                                    hslStepX,
                                );
                                x1 += slope02;
                                x0 += slope01;
                                hsl0 += hslStepY;
                                y0 += Rasterizer2D.width;
                            }
                        } else {
                            y1 -= y2;
                            y2 -= y0;
                            y0 = Rasterizer3D.rasterClipY[y0];

                            while (true) {
                                --y2;
                                if (y2 < 0) {
                                    while (true) {
                                        --y1;
                                        if (y1 < 0) {
                                            return;
                                        }

                                        Rasterizer3D.rasterGouraudLine(
                                            Rasterizer2D.pixels,
                                            y0,
                                            x0 >> 14,
                                            x2 >> 14,
                                            hsl0,
                                            hslStepX,
                                        );
                                        x2 += slope12;
                                        x0 += slope01;
                                        hsl0 += hslStepY;
                                        y0 += Rasterizer2D.width;
                                    }
                                }

                                Rasterizer3D.rasterGouraudLine(
                                    Rasterizer2D.pixels,
                                    y0,
                                    x0 >> 14,
                                    x1 >> 14,
                                    hsl0,
                                    hslStepX,
                                );
                                x1 += slope02;
                                x0 += slope01;
                                hsl0 += hslStepY;
                                y0 += Rasterizer2D.width;
                            }
                        }
                    }
                }
            } else if (y1 <= y2) {
                if (y1 < Rasterizer3D.endY) {
                    if (y2 > Rasterizer3D.endY) {
                        y2 = Rasterizer3D.endY;
                    }

                    if (y0 > Rasterizer3D.endY) {
                        y0 = Rasterizer3D.endY;
                    }

                    hsl1 = hslStepX + ((hsl1 << 8) - hslStepX * x1);
                    if (y2 < y0) {
                        x0 = x1 <<= 14;
                        if (y1 < 0) {
                            x0 -= slope01 * y1;
                            x1 -= slope12 * y1;
                            hsl1 -= hslStepY * y1;
                            y1 = 0;
                        }

                        x2 <<= 14;
                        if (y2 < 0) {
                            x2 -= slope02 * y2;
                            y2 = 0;
                        }

                        if (
                            (y2 !== y1 && slope01 < slope12) ||
                            (y2 === y1 && slope01 > slope02)
                        ) {
                            y0 -= y2;
                            y2 -= y1;
                            y1 = Rasterizer3D.rasterClipY[y1];

                            while (true) {
                                --y2;
                                if (y2 < 0) {
                                    while (true) {
                                        --y0;
                                        if (y0 < 0) {
                                            return;
                                        }

                                        Rasterizer3D.rasterGouraudLine(
                                            Rasterizer2D.pixels,
                                            y1,
                                            x0 >> 14,
                                            x2 >> 14,
                                            hsl1,
                                            hslStepX,
                                        );
                                        x0 += slope01;
                                        x2 += slope02;
                                        hsl1 += hslStepY;
                                        y1 += Rasterizer2D.width;
                                    }
                                }

                                Rasterizer3D.rasterGouraudLine(
                                    Rasterizer2D.pixels,
                                    y1,
                                    x0 >> 14,
                                    x1 >> 14,
                                    hsl1,
                                    hslStepX,
                                );
                                x0 += slope01;
                                x1 += slope12;
                                hsl1 += hslStepY;
                                y1 += Rasterizer2D.width;
                            }
                        } else {
                            y0 -= y2;
                            y2 -= y1;
                            y1 = Rasterizer3D.rasterClipY[y1];

                            while (true) {
                                --y2;
                                if (y2 < 0) {
                                    while (true) {
                                        --y0;
                                        if (y0 < 0) {
                                            return;
                                        }

                                        Rasterizer3D.rasterGouraudLine(
                                            Rasterizer2D.pixels,
                                            y1,
                                            x2 >> 14,
                                            x0 >> 14,
                                            hsl1,
                                            hslStepX,
                                        );
                                        x0 += slope01;
                                        x2 += slope02;
                                        hsl1 += hslStepY;
                                        y1 += Rasterizer2D.width;
                                    }
                                }

                                Rasterizer3D.rasterGouraudLine(
                                    Rasterizer2D.pixels,
                                    y1,
                                    x1 >> 14,
                                    x0 >> 14,
                                    hsl1,
                                    hslStepX,
                                );
                                x0 += slope01;
                                x1 += slope12;
                                hsl1 += hslStepY;
                                y1 += Rasterizer2D.width;
                            }
                        }
                    } else {
                        x2 = x1 <<= 14;
                        if (y1 < 0) {
                            x2 -= slope01 * y1;
                            x1 -= slope12 * y1;
                            hsl1 -= hslStepY * y1;
                            y1 = 0;
                        }

                        x0 <<= 14;
                        if (y0 < 0) {
                            x0 -= y0 * slope02;
                            y0 = 0;
                        }

                        if (slope01 < slope12) {
                            y2 -= y0;
                            y0 -= y1;
                            y1 = Rasterizer3D.rasterClipY[y1];

                            while (true) {
                                --y0;
                                if (y0 < 0) {
                                    while (true) {
                                        --y2;
                                        if (y2 < 0) {
                                            return;
                                        }

                                        Rasterizer3D.rasterGouraudLine(
                                            Rasterizer2D.pixels,
                                            y1,
                                            x0 >> 14,
                                            x1 >> 14,
                                            hsl1,
                                            hslStepX,
                                        );
                                        x0 += slope02;
                                        x1 += slope12;
                                        hsl1 += hslStepY;
                                        y1 += Rasterizer2D.width;
                                    }
                                }

                                Rasterizer3D.rasterGouraudLine(
                                    Rasterizer2D.pixels,
                                    y1,
                                    x2 >> 14,
                                    x1 >> 14,
                                    hsl1,
                                    hslStepX,
                                );
                                x2 += slope01;
                                x1 += slope12;
                                hsl1 += hslStepY;
                                y1 += Rasterizer2D.width;
                            }
                        } else {
                            y2 -= y0;
                            y0 -= y1;
                            y1 = Rasterizer3D.rasterClipY[y1];

                            while (true) {
                                --y0;
                                if (y0 < 0) {
                                    while (true) {
                                        --y2;
                                        if (y2 < 0) {
                                            return;
                                        }

                                        Rasterizer3D.rasterGouraudLine(
                                            Rasterizer2D.pixels,
                                            y1,
                                            x1 >> 14,
                                            x0 >> 14,
                                            hsl1,
                                            hslStepX,
                                        );
                                        x0 += slope02;
                                        x1 += slope12;
                                        hsl1 += hslStepY;
                                        y1 += Rasterizer2D.width;
                                    }
                                }

                                Rasterizer3D.rasterGouraudLine(
                                    Rasterizer2D.pixels,
                                    y1,
                                    x1 >> 14,
                                    x2 >> 14,
                                    hsl1,
                                    hslStepX,
                                );
                                x2 += slope01;
                                x1 += slope12;
                                hsl1 += hslStepY;
                                y1 += Rasterizer2D.width;
                            }
                        }
                    }
                }
            } else if (y2 < Rasterizer3D.endY) {
                if (y0 > Rasterizer3D.endY) {
                    y0 = Rasterizer3D.endY;
                }

                if (y1 > Rasterizer3D.endY) {
                    y1 = Rasterizer3D.endY;
                }

                hsl2 = hslStepX + ((hsl2 << 8) - x2 * hslStepX);
                if (y0 < y1) {
                    x1 = x2 <<= 14;
                    if (y2 < 0) {
                        x1 -= slope12 * y2;
                        x2 -= slope02 * y2;
                        hsl2 -= hslStepY * y2;
                        y2 = 0;
                    }

                    x0 <<= 14;
                    if (y0 < 0) {
                        x0 -= y0 * slope01;
                        y0 = 0;
                    }

                    if (slope12 < slope02) {
                        y1 -= y0;
                        y0 -= y2;
                        y2 = Rasterizer3D.rasterClipY[y2];

                        while (true) {
                            --y0;
                            if (y0 < 0) {
                                while (true) {
                                    --y1;
                                    if (y1 < 0) {
                                        return;
                                    }

                                    Rasterizer3D.rasterGouraudLine(
                                        Rasterizer2D.pixels,
                                        y2,
                                        x1 >> 14,
                                        x0 >> 14,
                                        hsl2,
                                        hslStepX,
                                    );
                                    x1 += slope12;
                                    x0 += slope01;
                                    hsl2 += hslStepY;
                                    y2 += Rasterizer2D.width;
                                }
                            }

                            Rasterizer3D.rasterGouraudLine(
                                Rasterizer2D.pixels,
                                y2,
                                x1 >> 14,
                                x2 >> 14,
                                hsl2,
                                hslStepX,
                            );
                            x1 += slope12;
                            x2 += slope02;
                            hsl2 += hslStepY;
                            y2 += Rasterizer2D.width;
                        }
                    } else {
                        y1 -= y0;
                        y0 -= y2;
                        y2 = Rasterizer3D.rasterClipY[y2];

                        while (true) {
                            --y0;
                            if (y0 < 0) {
                                while (true) {
                                    --y1;
                                    if (y1 < 0) {
                                        return;
                                    }

                                    Rasterizer3D.rasterGouraudLine(
                                        Rasterizer2D.pixels,
                                        y2,
                                        x0 >> 14,
                                        x1 >> 14,
                                        hsl2,
                                        hslStepX,
                                    );
                                    x1 += slope12;
                                    x0 += slope01;
                                    hsl2 += hslStepY;
                                    y2 += Rasterizer2D.width;
                                }
                            }

                            Rasterizer3D.rasterGouraudLine(
                                Rasterizer2D.pixels,
                                y2,
                                x2 >> 14,
                                x1 >> 14,
                                hsl2,
                                hslStepX,
                            );
                            x1 += slope12;
                            x2 += slope02;
                            hsl2 += hslStepY;
                            y2 += Rasterizer2D.width;
                        }
                    }
                } else {
                    x0 = x2 <<= 14;
                    if (y2 < 0) {
                        x0 -= slope12 * y2;
                        x2 -= slope02 * y2;
                        hsl2 -= hslStepY * y2;
                        y2 = 0;
                    }

                    x1 <<= 14;
                    if (y1 < 0) {
                        x1 -= slope01 * y1;
                        y1 = 0;
                    }

                    if (slope12 < slope02) {
                        y0 -= y1;
                        y1 -= y2;
                        y2 = Rasterizer3D.rasterClipY[y2];

                        while (true) {
                            --y1;
                            if (y1 < 0) {
                                while (true) {
                                    --y0;
                                    if (y0 < 0) {
                                        return;
                                    }

                                    Rasterizer3D.rasterGouraudLine(
                                        Rasterizer2D.pixels,
                                        y2,
                                        x1 >> 14,
                                        x2 >> 14,
                                        hsl2,
                                        hslStepX,
                                    );
                                    x1 += slope01;
                                    x2 += slope02;
                                    hsl2 += hslStepY;
                                    y2 += Rasterizer2D.width;
                                }
                            }

                            Rasterizer3D.rasterGouraudLine(
                                Rasterizer2D.pixels,
                                y2,
                                x0 >> 14,
                                x2 >> 14,
                                hsl2,
                                hslStepX,
                            );
                            x0 += slope12;
                            x2 += slope02;
                            hsl2 += hslStepY;
                            y2 += Rasterizer2D.width;
                        }
                    } else {
                        y0 -= y1;
                        y1 -= y2;
                        y2 = Rasterizer3D.rasterClipY[y2];

                        while (true) {
                            --y1;
                            if (y1 < 0) {
                                while (true) {
                                    --y0;
                                    if (y0 < 0) {
                                        return;
                                    }

                                    Rasterizer3D.rasterGouraudLine(
                                        Rasterizer2D.pixels,
                                        y2,
                                        x2 >> 14,
                                        x1 >> 14,
                                        hsl2,
                                        hslStepX,
                                    );
                                    x1 += slope01;
                                    x2 += slope02;
                                    hsl2 += hslStepY;
                                    y2 += Rasterizer2D.width;
                                }
                            }

                            Rasterizer3D.rasterGouraudLine(
                                Rasterizer2D.pixels,
                                y2,
                                x2 >> 14,
                                x0 >> 14,
                                hsl2,
                                hslStepX,
                            );
                            x0 += slope12;
                            x2 += slope02;
                            hsl2 += hslStepY;
                            y2 += Rasterizer2D.width;
                        }
                    }
                }
            }
        }
    }

    rasterGouraudLine(
        pixels: Int32Array,
        offset: number,
        startX: number,
        endX: number,
        hslIndex: number,
        grad: number,
    ) {
        const Rasterizer3D = this;
        if (Rasterizer3D.rasterClipEnable) {
            if (endX > Rasterizer3D.endX) {
                endX = Rasterizer3D.endX;
            }

            if (startX < 0) {
                startX = 0;
            }
        }

        if (startX >= endX) {
            return;
        }

        offset += startX;
        hslIndex += startX * grad;

        if (Rasterizer3D.rasterGouraudLowRes) {
            throw new Error("Not implemented");
        } else {
            let loops = endX - startX;
            if (Rasterizer3D.rasterAlpha === 0) {
                do {
                    pixels[offset++] = HSL_RGB_MAP[hslIndex >> 8];
                    hslIndex += grad;
                    loops--;
                } while (loops > 0);
            } else {
                const srcAlpha = Rasterizer3D.rasterAlpha;
                const dstAlpha = 256 - Rasterizer3D.rasterAlpha;

                do {
                    let color = HSL_RGB_MAP[hslIndex >> 8];
                    hslIndex += grad;
                    color =
                        (((dstAlpha * (color & 0xff00)) >> 8) & 0xff00) +
                        (((dstAlpha * (color & 0xff00ff)) >> 8) & 0xff00ff);
                    const src = pixels[offset];
                    pixels[offset++] =
                        ((((src & 0xff00ff) * srcAlpha) >> 8) & 0xff00ff) +
                        (((srcAlpha * (src & 0xff00)) >> 8) & 0xff00) +
                        color;
                    loops--;
                } while (loops > 0);
            }
        }
    }
}
