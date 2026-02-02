import { Archive } from "../../cache/format/Archive";
import { CacheInfo } from "../../cache/CacheInfo";
import { ArchiveTypeLoader, TypeLoader } from "../TypeLoader";
import { QuestType } from "./QuestType";

export type QuestTypeLoader = TypeLoader<QuestType>;

export class ArchiveQuestTypeLoader
    extends ArchiveTypeLoader<QuestType>
    implements QuestTypeLoader
{
    constructor(cacheInfo: CacheInfo, archive: Archive) {
        super(QuestType, cacheInfo, archive);
    }
}
