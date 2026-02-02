import { Archive } from "../../cache/format/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader } from "../TypeLoader";
import { MapSceneType } from "./MapSceneType";

export class MapSceneTypeLoader extends ArchiveTypeLoader<MapSceneType> {
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(MapSceneType, cacheInfo, archive);
    }
}
