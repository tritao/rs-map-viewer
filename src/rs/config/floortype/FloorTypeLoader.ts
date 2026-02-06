import { Archive } from "../../cache/format/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, DatTypeLoader, TypeLoader } from "../TypeLoader";
import { ArchiveBytesProvider } from "../../io/BytesProvider";
import { FloorType } from "./FloorType";
import { OverlayFloorType } from "./OverlayFloorType";
import { UnderlayFloorType } from "./UnderlayFloorType";

export type FloorTypeLoader = TypeLoader<FloorType>;

export type UnderlayFloorTypeLoader = TypeLoader<UnderlayFloorType>;
export type OverlayFloorTypeLoader = TypeLoader<OverlayFloorType>;

export class ArchiveUnderlayFloorTypeLoader
    extends ArchiveTypeLoader<UnderlayFloorType>
    implements UnderlayFloorTypeLoader
{
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(UnderlayFloorType, cacheInfo, new ArchiveBytesProvider(archive));
    }
}

export class ArchiveOverlayFloorTypeLoader
    extends ArchiveTypeLoader<OverlayFloorType>
    implements OverlayFloorTypeLoader
{
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(OverlayFloorType, cacheInfo, new ArchiveBytesProvider(archive));
    }
}

export class DatFloorTypeLoader {
    static create(cacheInfo: CacheInfo, configArchive: Archive): OverlayFloorTypeLoader {
        return DatTypeLoader.create(OverlayFloorType, cacheInfo, configArchive, "flo");
    }
}
