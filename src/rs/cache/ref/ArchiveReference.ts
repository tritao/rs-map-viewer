export class ArchiveReference {
    constructor(
        readonly id: number,
        readonly nameHash: number,
        readonly whirlpool: Uint8Array,
        readonly crc: number,
        readonly revision: number,
        readonly fileCount: number,
        readonly lastFileId: number,
        readonly fileIds: Int32Array,
        readonly fileNameHashes: Int32Array,
    ) {}
}
