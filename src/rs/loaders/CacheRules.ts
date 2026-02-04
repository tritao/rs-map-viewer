import { CacheInfo, GameType } from "../cache/CacheInfo";
import { CacheSystem } from "../cache/CacheSystem";
import { Dat2IndexId, Rs2IndexId } from "../cache/IndexId";
import { OsrsConfigArchiveId, Rs2ConfigArchiveId } from "../cache/ConfigArchiveId";

export type TextureRules =
    | { mode: "sprite" }
    | {
          mode: "materials";
          hasAlphaMaterialField: boolean;
          hasAlphaOperation: boolean;
      }
    | { mode: "old_procedural" };

export type BasRules = { mode: "archive" } | { mode: "dummy" };

export type QuestRules = { mode: "archive" } | { mode: "none" };

export type MapScenesRules = { mode: "archive" } | { mode: "graphics_defaults" };

export type MapFunctionsRules =
    | { mode: "osrs_archive" }
    | { mode: "rs2_archive" }
    | { mode: "graphics_defaults" };

export type CacheRules = Readonly<{
    isIndexConfigs: boolean;
    texture: TextureRules;
    bas: BasRules;
    quests: QuestRules;
    mapScenes: MapScenesRules;
    mapFunctions: MapFunctionsRules;
}>;

export function computeCacheRules(cacheInfo: CacheInfo, cacheSystem: CacheSystem): CacheRules {
    const isIndexConfigs = cacheInfo.game === GameType.Runescape && cacheInfo.revision >= 488;

    const useSpriteTextures =
        cacheInfo.game === GameType.Oldschool ||
        (cacheInfo.game === GameType.Runescape && cacheInfo.revision < 474);

    let texture: TextureRules;
    if (useSpriteTextures) {
        texture = { mode: "sprite" };
    } else if (cacheSystem.indexExists(Rs2IndexId.materials)) {
        texture = {
            mode: "materials",
            // materials removed in 629
            hasAlphaMaterialField: cacheInfo.revision < 629,
            // alpha operation appears after 534 (seen from 537+)
            hasAlphaOperation: cacheInfo.revision >= 537,
        };
    } else {
        texture = { mode: "old_procedural" };
    }

    let bas: BasRules = { mode: "dummy" };
    let quests: QuestRules = { mode: "none" };
    let mapScenes: MapScenesRules = { mode: "graphics_defaults" };
    let mapFunctions: MapFunctionsRules = { mode: "graphics_defaults" };

    try {
        if (cacheSystem.indexExists(Dat2IndexId.configs)) {
            const configIndex = cacheSystem.getIndex(Dat2IndexId.configs);

            if (
                cacheInfo.game === GameType.Runescape &&
                cacheInfo.revision >= 530 &&
                configIndex.archiveExists(Rs2ConfigArchiveId.bas)
            ) {
                bas = { mode: "archive" };
            }

            if (cacheInfo.game === GameType.Runescape && configIndex.archiveExists(Rs2ConfigArchiveId.quests)) {
                quests = { mode: "archive" };
            }

            if (cacheInfo.game === GameType.Runescape && configIndex.archiveExists(Rs2ConfigArchiveId.mapScenes)) {
                mapScenes = { mode: "archive" };
            }

            if (cacheInfo.game === GameType.Oldschool && configIndex.archiveExists(OsrsConfigArchiveId.mapFunctions)) {
                mapFunctions = { mode: "osrs_archive" };
            } else if (
                cacheInfo.game === GameType.Runescape &&
                configIndex.archiveExists(Rs2ConfigArchiveId.mapFunctions)
            ) {
                mapFunctions = { mode: "rs2_archive" };
            }
        }
    } catch {
        // Leave default rules when probing cache structure fails.
    }

    return { isIndexConfigs, texture, bas, quests, mapScenes, mapFunctions };
}
