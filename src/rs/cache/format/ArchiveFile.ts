export class ArchiveFile {
    constructor(
        readonly id: number,
        readonly archiveId: number,
        readonly data: Uint8Array,
    ) {}
}
