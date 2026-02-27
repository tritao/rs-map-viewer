import { CacheIndex } from "../cache/CacheIndex";
import { Archive } from "../cache/format/Archive";

export interface ArchiveProvider {
    getArchive(id: number): Archive | undefined;
}

export class IndexArchiveProvider implements ArchiveProvider {
    constructor(readonly index: CacheIndex) {}

    getArchive(id: number): Archive | undefined {
        return this.index.tryGetArchive(id);
    }
}
