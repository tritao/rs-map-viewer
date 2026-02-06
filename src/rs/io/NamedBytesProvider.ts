import { Archive } from "../cache/format/Archive";

export interface NamedBytesProvider {
    getBytes(name: string): Uint8Array | undefined;
}

export class ArchiveNamedBytesProvider implements NamedBytesProvider {
    constructor(readonly archive: Archive) {}

    getBytes(name: string): Uint8Array | undefined {
        return this.archive.getFileNamed(name)?.data ?? undefined;
    }
}

