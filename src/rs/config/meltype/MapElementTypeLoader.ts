import { CacheInfo } from "../../cache/CacheInfo";
import { Archive } from "../../cache/format/Archive";
import { ArchiveBytesProvider } from "../../io/BytesProvider";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";
import { MapElementType } from "./MapElementType";

export type MapElementTypeLoader = TypeLoader<MapElementType>;

export class ArchiveMapElementTypeLoader
    extends ArchiveTypeLoader<MapElementType>
    implements MapElementTypeLoader
{
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(MapElementType, cacheInfo, new ArchiveBytesProvider(archive));
    }
}
