import { ByteBuffer } from "../../io/ByteBuffer";

export class SectorCluster {
    static readonly SIZE: i32 = 6;

    static decode(buffer: ByteBuffer): SectorCluster {
        const size = buffer.readMedium();
        const sector = buffer.readMedium();
        return new SectorCluster(size, sector);
    }

    constructor(
        readonly size: i32,
        readonly sector: i32,
    ) {}
}
