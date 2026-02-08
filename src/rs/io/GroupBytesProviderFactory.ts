import { ArchiveProvider } from "./ArchiveProvider";
import {
    ArchiveBytesProvider,
    BytesProvider,
    EnumeratingArchiveBytesProvider,
    EnumeratingBytesProvider,
} from "./BytesProvider";

/**
 * Provides access to "groups" of sub-files (e.g. cache archives) as a BytesProvider.
 *
 * This is a small abstraction so decoders/loaders can depend on "bytes for (groupId,fileId)"
 * rather than concrete cache container types like Archive.
 */
export interface GroupBytesProviderFactory {
    getGroup(groupId: number): BytesProvider | undefined;
}

export interface EnumeratingGroupBytesProviderFactory extends GroupBytesProviderFactory {
    getEnumeratingGroup(groupId: number): EnumeratingBytesProvider | undefined;
}

export class ArchiveProviderGroupBytesProviderFactory
    implements EnumeratingGroupBytesProviderFactory
{
    constructor(readonly archiveProvider: ArchiveProvider) {}

    getGroup(groupId: number): BytesProvider | undefined {
        const archive = this.archiveProvider.getArchive(groupId);
        return archive ? new ArchiveBytesProvider(archive) : undefined;
    }

    getEnumeratingGroup(groupId: number): EnumeratingBytesProvider | undefined {
        const archive = this.archiveProvider.getArchive(groupId);
        return archive ? new EnumeratingArchiveBytesProvider(archive) : undefined;
    }
}
