import { CacheInfo, GameType } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";
import { FloorType } from "./FloorType";
import { rgbToHsl } from "../../util/ColorUtil";

export class OverlayFloorType extends Type implements FloorType {
    primaryRgb: number;

    textureId: number;
    secondaryTextureId: number;

    hideUnderlay: boolean;

    /**
     * Secondary colour used by some caches (commonly minimap/alt colour).
     * Not present in all revisions/game types.
     */
    secondaryRgb: number;

    /**
     * RuneScape (e.g. 667) "blend colour" (used for overlay blending).
     * Not present in all revisions/game types.
     */
    blendRgb: number;

    primaryHsl: number;
    blendHsl: number;

    /**
     * RuneScape-style occlusion flag (opcode 5 flips this to false).
     *
     * Oldschool uses opcode 5 for `hideUnderlay = false` instead, so this field isn't meaningful there.
     */
    occludes: boolean;

    hue: number;
    saturation: number;
    lightness: number;

    hueBlend: number;
    hueMultiplier: number;

    secondaryHue: number;
    secondarySaturation: number;
    secondaryLightness: number;

    textureSize: number;
    blockShadow: boolean;
    textureBrightness: number;

    /**
     * RuneScape blend priority (if supported by the cache).
     *
     * Note: in RuneScape 667, this is post-processed as `(blendPriority << 8) | id`.
     */
    blendPriority: number;

    /**
     * Whether this overlay participates in terrain blending.
     *
     * In RuneScape 667 this maps to `FloorOverlayType.blendable`.
     */
    blendable: boolean;

    underwaterColor: number;
    waterOpacity: number;
    waterBias: number;

    // Old caches uses the same type for overlays and underlays
    isOverlay: boolean;
    name?: string;

    constructor(id: number, cacheInfo: CacheInfo) {
        super(id, cacheInfo);
        this.primaryRgb = 0;
        this.textureId = -1;
        this.secondaryTextureId = -1;
        this.hideUnderlay = true;
        this.secondaryRgb = -1;
        this.blendRgb = -1;
        this.primaryHsl = -1;
        this.blendHsl = -1;
        this.occludes = true;
        this.hue = 0;
        this.saturation = 0;
        this.lightness = 0;
        this.hueBlend = 0;
        this.hueMultiplier = 0;
        this.secondaryHue = 0;
        this.secondarySaturation = 0;
        this.secondaryLightness = 0;
        this.textureSize = 128;
        this.blockShadow = true;
        this.textureBrightness = 8;
        this.blendPriority = 8;
        this.blendable = false;
        this.underwaterColor = 0x122b3d;
        this.waterOpacity = 16;
        this.waterBias = 127;
        this.isOverlay = cacheInfo.game !== GameType.Runescape || cacheInfo.revision > 377;

        // `hideUnderlay` is not a concept on all game types/revisions (e.g. RuneScape 667 uses opcode 5 for occludes).
        if (cacheInfo.game === GameType.Runescape) {
            this.hideUnderlay = false;
        }
    }

    getHueBlend(): number {
        return this.hueBlend;
    }

    getHueMultiplier(): number {
        return this.hueMultiplier;
    }

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 1) {
            this.primaryRgb = buffer.readMedium();
        } else if (opcode === 2) {
            this.textureId = buffer.readUnsignedByte();
        } else if (opcode === 3) {
            if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision <= 377) {
                this.isOverlay = true;
            } else {
                this.textureId = buffer.readUnsignedShort();
                if (this.textureId === 0xffff) {
                    this.textureId = -1;
                }
            }
        } else if (opcode === 5) {
            // Oldschool-style: hide underlay
            // RuneScape-style: occludes=false (not currently used by the viewer)
            if (this.cacheInfo.game !== GameType.Runescape) {
                this.hideUnderlay = false;
            } else {
                this.occludes = false;
            }
        } else if (opcode === 6) {
            this.name = this.readString(buffer);
        } else if (opcode === 7) {
            // Oldschool-style: secondary colour
            // RuneScape-style: blend colour
            if (this.cacheInfo.game === GameType.Runescape) {
                this.blendRgb = buffer.readMedium();
            } else {
                this.secondaryRgb = buffer.readMedium();
            }
        } else if (opcode === 8) {
            // nothing
        } else if (opcode === 9) {
            this.textureSize = buffer.readUnsignedShort();
        } else if (opcode === 10) {
            this.blockShadow = false;
        } else if (opcode === 11) {
            // Revision-dependent opcode.
            // - RuneScape 667: blendPriority
            // - Some older caches (e.g. rt4 530): textureBrightness
            const value = buffer.readUnsignedByte();
            if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision >= 667) {
                this.blendPriority = value;
            } else {
                this.textureBrightness = value;
            }
        } else if (opcode === 12) {
            this.blendable = true;
        } else if (opcode === 13) {
            this.underwaterColor = buffer.readMedium();
        } else if (opcode === 14) {
            /*
             * Handles how deep into water the player is able to see,
             * seems to (but not confirmed) work in jumps of 2, so: "0, 2, 4, 6" etc.
             * It seems any number equals to or less than 0, removes any visual
             * effect obscuring the depth view. The first increment in order,
             * being 2, blocks almost 100% of the view of the underwater map (UM).
             */
            this.waterOpacity = buffer.readUnsignedByte();
        } else if (opcode === 15) {
            this.secondaryTextureId = buffer.readUnsignedShort();
            if (this.secondaryTextureId === 0xffff) {
                this.secondaryTextureId = -1;
            }
        } else if (opcode === 16) {
            this.waterBias = buffer.readUnsignedByte();
        } else {
            throw new Error(
                "OverlayFloorType: Opcode " + opcode + " not implemented. id: " + this.id,
            );
        }
    }

    override post(): void {
        if (this.secondaryRgb !== -1) {
            this.setHsl(this.secondaryRgb);
            this.secondaryHue = this.hue;
            this.secondarySaturation = this.saturation;
            this.secondaryLightness = this.lightness;
        }

        if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision >= 667) {
            // Mirrors 667 client postDecode.
            this.blendPriority = (this.blendPriority << 8) | this.id;
        }

        this.setHsl(this.primaryRgb);

        this.primaryHsl = this.primaryRgb === 0xff00ff ? -2 : rgbToHsl(this.primaryRgb);
        this.blendHsl =
            this.blendRgb === -1
                ? -1
                : this.blendRgb === 0xff00ff
                  ? -2
                  : rgbToHsl(this.blendRgb);
    }

    setHsl(rgb: number): void {
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

        let hue = 0.0;
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
                hue = (g - b) / (maxRgb - minRgb);
            } else if (maxRgb === g) {
                hue = 2.0 + (b - r) / (maxRgb - minRgb);
            } else if (maxRgb === b) {
                hue = 4.0 + (r - g) / (maxRgb - minRgb);
            }
        }

        hue /= 6.0;
        this.hue = (hue * 256.0) | 0;
        this.saturation = (sat * 256.0) | 0;
        this.lightness = (light * 256.0) | 0;
        if (this.saturation < 0) {
            this.saturation = 0;
        } else if (this.saturation > 255) {
            this.saturation = 255;
        }

        if (this.lightness < 0) {
            this.lightness = 0;
        } else if (this.lightness > 255) {
            this.lightness = 255;
        }

        if (light > 0.5) {
            this.hueMultiplier = (512.0 * (sat * (1.0 - light))) | 0;
        } else {
            this.hueMultiplier = (512.0 * (sat * light)) | 0;
        }
        if (this.hueMultiplier < 1) {
            this.hueMultiplier = 1;
        }
        this.hueBlend = (this.hueMultiplier * hue) | 0;
    }
}
