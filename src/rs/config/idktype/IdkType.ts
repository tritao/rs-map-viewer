import { CacheInfo } from "../../cache/CacheInfo";
import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

// Identity Kit
export class IdkType extends Type {
    bodyPartyId: number;

    modelIds!: number[];

    recolorFrom!: number[];
    recolorTo!: number[];

    retextureFrom!: number[];
    retextureTo!: number[];

    ifModelIds: number[];

    nonSelectable: boolean;

    constructor(id: number, cacheInfo: CacheInfo) {
        super(id, cacheInfo);
        this.bodyPartyId = -1;
        this.ifModelIds = [-1, -1, -1, -1, -1];
        this.nonSelectable = false;
    }

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 1) {
            this.bodyPartyId = buffer.readUnsignedByte();
        } else if (opcode === 2) {
            const modelCount = buffer.readUnsignedByte();
            this.modelIds = Array.from({ length: modelCount }, () => buffer.readUnsignedShort());
        } else if (opcode === 3) {
            this.nonSelectable = true;
        } else if (opcode === 40) {
            const count = buffer.readUnsignedByte();
            this.recolorFrom = Array.from({ length: count }, () => 0);
            this.recolorTo = Array.from({ length: count }, () => 0);
            for (let i = 0; i < count; i++) {
                this.recolorFrom[i] = buffer.readUnsignedShort();
                this.recolorTo[i] = buffer.readUnsignedShort();
            }
        } else if (opcode === 41) {
            const count = buffer.readUnsignedByte();
            this.retextureFrom = Array.from({ length: count }, () => 0);
            this.retextureTo = Array.from({ length: count }, () => 0);
            for (let i = 0; i < count; i++) {
                this.retextureFrom[i] = buffer.readUnsignedShort();
                this.retextureTo[i] = buffer.readUnsignedShort();
            }
        } else if (opcode >= 60 && opcode < 70) {
            this.ifModelIds[opcode - 60] = buffer.readUnsignedShort();
        }
    }
}
