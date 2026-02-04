import { CacheInfo, GameType } from "../cache/CacheInfo";
import { CacheSystem } from "../cache/CacheSystem";
import { Rs2IndexId } from "../cache/IndexId";

export type TextureRules =
    | { mode: "sprite" }
    | {
          mode: "materials";
          hasAlphaMaterialField: boolean;
          hasAlphaOperation: boolean;
      }
    | { mode: "old_procedural" };

export type CacheRules = {
    isIndexConfigs: boolean;
    texture: TextureRules;
};

export function computeCacheRules(cacheInfo: CacheInfo, cacheSystem: CacheSystem): CacheRules {
    const isIndexConfigs = cacheInfo.game === GameType.Runescape && cacheInfo.revision >= 488;

    const useSpriteTextures =
        cacheInfo.game === GameType.Oldschool ||
        (cacheInfo.game === GameType.Runescape && cacheInfo.revision < 474);

    if (useSpriteTextures) {
        return { isIndexConfigs, texture: { mode: "sprite" } };
    }

    if (cacheSystem.indexExists(Rs2IndexId.materials)) {
        return {
            isIndexConfigs,
            texture: {
                mode: "materials",
                // materials removed in 629
                hasAlphaMaterialField: cacheInfo.revision < 629,
                // alpha operation appears after 534 (seen from 537+)
                hasAlphaOperation: cacheInfo.revision >= 537,
            },
        };
    }

    return { isIndexConfigs, texture: { mode: "old_procedural" } };
}

