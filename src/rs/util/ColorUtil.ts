export function buildPalette(
    brightness: number,
    startHslIndex: number,
    endHslIndex: number,
): Int32Array {
    const palette = new Int32Array(0xffff);

    let paletteIndex = startHslIndex * 128;

    for (let hslIndex = startHslIndex; hslIndex < endHslIndex; hslIndex++) {
        let hue = (hslIndex >> 3) / 64.0 + 0.0078125;
        let saturation = (hslIndex & 7) / 8.0 + 0.0625;

        for (let lightnessIndex = 0; lightnessIndex < 128; lightnessIndex++) {
            const lightness = lightnessIndex / 128.0;
            let rFloat = lightness;
            let gFloat = lightness;
            let bFloat = lightness;
            if (saturation !== 0.0) {
                let q: number;
                if (lightness < 0.5) {
                    q = lightness * (1.0 + saturation);
                } else {
                    q = lightness + saturation - lightness * saturation;
                }

                const p = 2.0 * lightness - q;
                let tR = hue + 0.3333333333333333;
                if (tR > 1.0) {
                    tR--;
                }

                let tB = hue - 0.3333333333333333;
                if (tB < 0.0) {
                    tB++;
                }

                if (6.0 * tR < 1.0) {
                    rFloat = p + (q - p) * 6.0 * tR;
                } else if (2.0 * tR < 1.0) {
                    rFloat = q;
                } else if (3.0 * tR < 2.0) {
                    rFloat = p + (q - p) * (0.6666666666666666 - tR) * 6.0;
                } else {
                    rFloat = p;
                }

                if (6.0 * hue < 1.0) {
                    gFloat = p + (q - p) * 6.0 * hue;
                } else if (2.0 * hue < 1.0) {
                    gFloat = q;
                } else if (3.0 * hue < 2.0) {
                    gFloat = p + (q - p) * (0.6666666666666666 - hue) * 6.0;
                } else {
                    gFloat = p;
                }

                if (6.0 * tB < 1.0) {
                    bFloat = p + (q - p) * 6.0 * tB;
                } else if (2.0 * tB < 1.0) {
                    bFloat = q;
                } else if (3.0 * tB < 2.0) {
                    bFloat = p + (q - p) * (0.6666666666666666 - tB) * 6.0;
                } else {
                    bFloat = p;
                }
            }

            const r = Math.trunc(rFloat * 256.0);
            const g = Math.trunc(gFloat * 256.0);
            const b = Math.trunc(bFloat * 256.0);
            const rgb = (r << 16) + (g << 8) + b;

            let newRgb = brightenRgb(rgb, brightness);
            if (newRgb === 0) {
                newRgb = 1;
            }

            palette[paletteIndex++] = brightenRgb(rgb, brightness);
        }
    }

    return palette;
}

export const HSL_RGB_MAP = buildPalette(0.8, 0, 512);

// console.error("HSL_RGB_MAP", HSL_RGB_MAP[26]);

export const INVALID_HSL_COLOR = 12345678;

export function brightenRgb(rgb: number, brightness: number) {
    let r = (rgb >> 16) / 256.0;
    let g = ((rgb >> 8) & 255) / 256.0;
    let b = (rgb & 255) / 256.0;
    r = Math.pow(r, brightness);
    g = Math.pow(g, brightness);
    b = Math.pow(b, brightness);
    const newR = Math.trunc(r * 256.0);
    const newG = Math.trunc(g * 256.0);
    const newB = Math.trunc(b * 256.0);
    return newR * 0x10000 + newG * 0x100 + newB;
}

export function packHsl(hue: number, saturation: number, lightness: number) {
    if (lightness > 179) {
        saturation = Math.trunc(saturation / 2);
    }

    if (lightness > 192) {
        saturation = Math.trunc(saturation / 2);
    }

    if (lightness > 217) {
        saturation = Math.trunc(saturation / 2);
    }

    if (lightness > 243) {
        saturation = Math.trunc(saturation / 2);
    }

    const sat = Math.trunc(saturation / 32);
    const huePart = Math.trunc(hue / 4);
    const lightPart = Math.trunc(lightness / 2);
    return (sat << 7) + (huePart << 10) + lightPart;
}

export function mixHsl(hslA: number, hslB: number): number {
    if (hslA === INVALID_HSL_COLOR || hslB === INVALID_HSL_COLOR) {
        return INVALID_HSL_COLOR;
    }
    if (hslA === -1) {
        return hslB;
    } else if (hslB === -1) {
        return hslA;
    } else {
        let hue = (hslA >> 10) & 0x3f;
        let saturation = (hslA >> 7) & 0x7;
        let lightness = hslA & 0x7f;

        let hueB = (hslB >> 10) & 0x3f;
        let saturationB = (hslB >> 7) & 0x7;
        let lightnessB = hslB & 0x7f;

        hue += hueB;
        saturation += saturationB;
        lightness += lightnessB;

        hue >>= 1;
        saturation >>= 1;
        lightness >>= 1;

        return (hue << 10) + (saturation << 7) + lightness;
    }
}

export function rgbToHsl(rgb: number): number {
    const r = ((rgb >> 16) & 255) / 256.0;
    const g = ((rgb >> 8) & 255) / 256.0;
    const b = (rgb & 255) / 256.0;

    let minRgb = r;
    if (g < r) {
        minRgb = g;
    }
    if (b < minRgb) {
        minRgb = b;
    }

    let maxRgb = r;
    if (g > r) {
        maxRgb = g;
    }
    if (b > maxRgb) {
        maxRgb = b;
    }

    let hueTemp = 0.0;
    let sat = 0.0;
    const light = (minRgb + maxRgb) / 2.0;
    if (minRgb !== maxRgb) {
        if (light < 0.5) {
            sat = (maxRgb - minRgb) / (minRgb + maxRgb);
        }

        if (light >= 0.5) {
            sat = (maxRgb - minRgb) / (2.0 - maxRgb - minRgb);
        }

        if (maxRgb === r) {
            hueTemp = (g - b) / (maxRgb - minRgb);
        } else if (maxRgb === g) {
            hueTemp = 2.0 + (b - r) / (maxRgb - minRgb);
        } else if (maxRgb === b) {
            hueTemp = 4.0 + (r - g) / (maxRgb - minRgb);
        }
    }

    hueTemp /= 6.0;

    const hue = Math.trunc(hueTemp * 256.0);
    let saturation = Math.trunc(sat * 256.0);
    let lightness = Math.trunc(light * 256.0);
    if (saturation < 0) {
        saturation = 0;
    } else if (saturation > 255) {
        saturation = 255;
    }

    if (lightness < 0) {
        lightness = 0;
    } else if (lightness > 255) {
        lightness = 255;
    }

    return packHsl(hue, saturation, lightness);
}

export function blendLight(hsl: number, lightness: number): number {
    const numerator = (hsl & 127) * lightness;
    lightness = numerator >> 7;
    if (lightness < 2) {
        lightness = 2;
    } else if (lightness > 126) {
        lightness = 126;
    }

    return (hsl & 0xff80) + lightness;
}

export function adjustUnderlayLight(hsl: number, light: number) {
    if (hsl === -1) {
        return INVALID_HSL_COLOR;
    } else {
        const numerator = (hsl & 127) * light;
        light = numerator >> 7;
        if (light < 2) {
            light = 2;
        } else if (light > 126) {
            light = 126;
        }

        return (hsl & 0xff80) + light;
    }
}

export function adjustOverlayLight(hsl: number, light: number) {
    if (hsl === -2) {
        return INVALID_HSL_COLOR;
    } else if (hsl === -1) {
        if (light < 2) {
            light = 2;
        } else if (light > 126) {
            light = 126;
        }

        return light;
    } else {
        const numerator = (hsl & 127) * light;
        light = numerator >> 7;
        if (light < 2) {
            light = 2;
        } else if (light > 126) {
            light = 126;
        }

        return (hsl & 0xff80) + light;
    }
}
