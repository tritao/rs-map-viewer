import { CacheIndex } from "../cache/CacheIndex";
import { Archive } from "../cache/format/Archive";

export interface ArchiveProvider {
    getArchive(id: number): Archive | undefined;
}

export interface EnumeratingArchiveProvider extends ArchiveProvider {
    getArchiveIds(): Int32Array;
    getArchiveCount(): number;
}

export class IndexArchiveProvider implements EnumeratingArchiveProvider {
    constructor(readonly index: CacheIndex) {}

    getArchive(id: number): Archive | undefined {
        try {
            return this.index.getArchive(id);
        } catch {
            return undefined;
        }
    }

    getArchiveIds(): Int32Array {
        return this.index.getArchiveIds();
    }

    getArchiveCount(): number {
        return this.index.getArchiveCount();
    }
}

