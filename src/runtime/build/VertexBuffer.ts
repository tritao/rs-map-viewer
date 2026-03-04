import { FloatUtil } from "../../util/FloatUtil";
import { clamp } from "../../util/MathUtil";
import { DataBuffer } from "./DataBuffer";

function hashVertex(v0: number, v1: number, v2: number, v3: number): number {
    // FNV-1a 32-bit over 4x u32, using imul for 32-bit overflow behavior.
    let h = 0x811c9dc5;
    h = Math.imul(h ^ v0, 0x01000193);
    h = Math.imul(h ^ v1, 0x01000193);
    h = Math.imul(h ^ v2, 0x01000193);
    h = Math.imul(h ^ v3, 0x01000193);
    return h >>> 0;
}

export class VertexBuffer extends DataBuffer {
    static readonly STRIDE = 16;

    private u32: Uint32Array;
    private vertexHashHeads: Map<number, number>;
    private vertexNext: Int32Array;

    constructor(count: number) {
        super(VertexBuffer.STRIDE, count);
        this.u32 = new Uint32Array(this.bytes.buffer);
        this.vertexHashHeads = new Map<number, number>();
        this.vertexNext = new Int32Array(count);
        this.vertexNext.fill(-1);
    }

    override ensureSize(count: number): boolean {
        const resized = super.ensureSize(count);
        if (resized) {
            this.u32 = new Uint32Array(this.bytes.buffer);
            const newCapacity = Math.floor(this.view.byteLength / this.stride);
            const next = new Int32Array(newCapacity);
            next.fill(-1);
            next.set(this.vertexNext, 0);
            this.vertexNext = next;
        }
        return resized;
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
        // Packed format stores raw cache texture ids (0-based) as `textureIdPlus1` (0 reserved).
        // We cap to 16-bit `textureIdPlus1` (0..65535), so raw ids must be <= 65534.
        if (textureId > 0xfffe) {
            textureId = -1;
        }
        if (textureId1 > 0xfffe) {
            textureId1 = -1;
        }

        const blendClamped = clamp(textureBlend, 0, 1);
        const tex0 = textureId !== -1 ? (textureId + 1) | 0 : 0;
        const tex1 = textureId1 !== -1 ? (textureId1 + 1) | 0 : 0;
        const hasBlend = tex0 !== 0 && tex1 !== 0 && tex1 !== tex0 && blendClamped > 0;
        const isTextured = tex0 !== 0;
        if (isTextured) {
            // textureId = 119;
            // only light
            hsl &= 127;
            hsl |= (tex0 & 0x1ff) << 7;
        }

        const xPos = clamp(x + 0x4000, 0, 0x8000);
        const yPos = clamp(-y + 0x4000, 0, 0x8000);
        const zPos = clamp(z + 0x4000, 0, 0x8000);

        priority &= 0x7;

        const uPacked = clamp(FloatUtil.packFloat11(u), 0, 0x7ff);
        const vPacked = clamp(FloatUtil.packFloat11(v), 0, 0x7ff);

        const v0 = (xPos << 17) | ((uPacked & 0x3f) << 11) | vPacked;

        const v1 = yPos | (hsl << 15) | (Number(isTextured) << 31);

        const v2 = (zPos << 17) | (alpha << 9) | (priority << 6) | (uPacked >> 6);

        const blend8 = hasBlend ? clamp(Math.round(blendClamped * 255), 0, 255) : 0;

        // Store texture ids as 16-bit `textureIdPlus1` values:
        // - tex0 low 9 bits in `hsl` high bits (like the old packing)
        // - tex0 high 7 bits in v3[19..25]
        // - tex1 low 10 bits in v3[0..9]
        // - tex1 high 6 bits in v3[26..31]
        const tex0High7 = isTextured ? (tex0 >> 9) & 0x7f : 0;
        const tex1Low10 = hasBlend ? tex1 & 0x3ff : 0;
        const tex1High6 = hasBlend ? (tex1 >> 10) & 0x3f : 0;
        const v3 =
            tex1Low10 |
            (Number(hasBlend) << 10) |
            (blend8 << 11) |
            (tex0High7 << 19) |
            (tex1High6 << 26);

        const v0u = v0 >>> 0;
        const v1u = v1 >>> 0;
        const v2u = v2 >>> 0;
        const v3u = v3 >>> 0;

        if (reuseVertex) {
            const hash = hashVertex(v0u, v1u, v2u, v3u);

            let index = this.vertexHashHeads.get(hash);
            while (index !== undefined && index !== -1) {
                const base = index * 4;
                if (
                    this.u32[base] >>> 0 === v0u &&
                    this.u32[base + 1] >>> 0 === v1u &&
                    this.u32[base + 2] >>> 0 === v2u &&
                    this.u32[base + 3] >>> 0 === v3u
                ) {
                    return index;
                }
                index = this.vertexNext[index];
            }
        }
        this.ensureSize(1);
        const index = this.offset;
        const byteOffset = this.byteOffset();

        this.view.setUint32(byteOffset, v0, true);
        this.view.setUint32(byteOffset + 4, v1, true);
        this.view.setUint32(byteOffset + 8, v2, true);
        this.view.setUint32(byteOffset + 12, v3, true);

        if (reuseVertex) {
            const hash = hashVertex(v0u, v1u, v2u, v3u);
            const head = this.vertexHashHeads.get(hash) ?? -1;
            this.vertexNext[index] = head;
            this.vertexHashHeads.set(hash, index);
        }

        this.offset++;
        return index;
    }
}
