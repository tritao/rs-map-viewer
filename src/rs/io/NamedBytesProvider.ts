import { Archive } from "../cache/format/Archive";
import { BytesProvider } from "./BytesProvider";

export type NamedBytesProvider = BytesProvider<string>;

export class ArchiveNamedBytesProvider implements NamedBytesProvider {
    constructor(readonly archive: Archive) {}

    getBytes(name: string): Uint8Array | undefined {
        return this.archive.getFileNamed(name)?.data ?? undefined;
    }
}
