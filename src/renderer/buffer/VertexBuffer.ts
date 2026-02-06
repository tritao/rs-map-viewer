import { FloatUtil } from "../../util/FloatUtil";
import { clamp } from "../../util/MathUtil";
import { DataBuffer } from "./DataBuffer";

export class VertexBuffer extends DataBuffer {
    static readonly STRIDE = 16;

    vertexIndices: Map<bigint, number>;

    constructor(count: number) {
        super(VertexBuffer.STRIDE, count);
        this.vertexIndices = new Map<bigint, number>();
    }

    addVertex(
        x: number,
        y: number,
        z: number,
        hsl: number,
        alpha: number,
        u: number,
        v: number,
        textureId: number,
        priority: number,
        reuseVertex: boolean = true,
        textureId1: number = -1,
        textureBlend: number = 0,
    ) {
        // Packed format supports 11-bit texture indices (0..2047). Values are indices into the cache's
        // `textureIds` list, not raw cache texture ids.
        if (textureId >= 2048) {
            textureId = -1;
        }
        if (textureId1 >= 2048) {
            textureId1 = -1;
        }

        const blendClamped = clamp(textureBlend, 0, 1);
        const hasBlend =
            textureId !== -1 && textureId1 !== -1 && textureId1 !== textureId && blendClamped > 0;
        const isTextured = textureId !== -1;
        if (isTextured) {
            // textureId = 119;
            // only light
            hsl &= 127;
            hsl |= (textureId & 0x1ff) << 7;
        }

        const xPos = clamp(x + 0x4000, 0, 0x8000);
        const yPos = clamp(-y + 0x4000, 0, 0x8000);
        const zPos = clamp(z + 0x4000, 0, 0x8000);

        priority &= 0x7;

        const uPacked = clamp(FloatUtil.packFloat11(u), 0, 0x7ff);
        const vPacked = clamp(FloatUtil.packFloat11(v), 0, 0x7ff);

        const v0 = (xPos << 17) | ((uPacked & 0x3f) << 11) | vPacked;

        const v1 = yPos | (hsl << 15) | (Number(isTextured) << 31);

        const v2 =
            (zPos << 17) |
            (alpha << 9) |
            (priority << 6) |
            (((textureId >> 9) & 0x1) << 5) |
            (uPacked >> 6);

        const blend8 = hasBlend ? clamp(Math.round(blendClamped * 255), 0, 255) : 0;
        const isTextured1 = hasBlend;
        const tex1Lo = isTextured1 ? clamp(textureId1, 0, 0x3ff) : 0;
        const tex0Hi = (textureId >> 10) & 0x1;
        const tex1Hi = (textureId1 >> 10) & 0x1;
        const v3 =
            tex1Lo |
            (Number(isTextured1) << 10) |
            (blend8 << 11) |
            (tex0Hi << 19) |
            (tex1Hi << 20);

        if (reuseVertex) {
            const v0u = v0 >>> 0;
            const v1u = v1 >>> 0;
            const v2u = v2 >>> 0;
            const v3u = v3 >>> 0;
            const hash =
                (BigInt(v0u) << 96n) |
                (BigInt(v1u) << 64n) |
                (BigInt(v2u) << 32n) |
                BigInt(v3u);
            const cachedIndex = this.vertexIndices.get(hash);
            if (cachedIndex !== undefined) {
                return cachedIndex;
            } else {
                this.vertexIndices.set(hash, this.offset);
            }
        }
        this.ensureSize(1);
        const byteOffset = this.byteOffset();

        this.view.setUint32(byteOffset, v0, true);
        this.view.setUint32(byteOffset + 4, v1, true);
        this.view.setUint32(byteOffset + 8, v2, true);
        this.view.setUint32(byteOffset + 12, v3, true);

        return this.offset++;
    }
}
