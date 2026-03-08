import { GameType, type CacheInfo } from "../rs/cache/CacheInfo";

export type RendererTexturePolicy = Readonly<{
    isNewTextureAnim: boolean;
    maxTexturePreloadCount?: number;
}>;

export function createRendererTexturePolicy(cacheInfo: CacheInfo): RendererTexturePolicy {
    const isRunescape = cacheInfo.game === GameType.Runescape;
    return {
        isNewTextureAnim: isRunescape && cacheInfo.revision >= 681,
        maxTexturePreloadCount: isRunescape && cacheInfo.revision >= 508 ? 64 : undefined,
    };
}
