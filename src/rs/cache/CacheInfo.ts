export enum GameType {
    Classic,
    Runescape,
    Oldschool,
}

export function getGameTypeName(gameType: GameType): String {
    switch(gameType) {
    case GameType.Classic: return "classic"
    case GameType.Runescape: return "runescape"
    case GameType.Oldschool: return "oldschool"
    default: throw Error("Unknown game type");
    }
}

export function getGameTypeFromName(name: string): GameType {
    if (name === "classic") {
        return GameType.Classic;
    } else if (name === "runescape") {
        return GameType.Runescape;
    } else if (name === "oldschool") {
        return GameType.Oldschool;
    } else {
        throw new Error("Unknown game type");
    }
}

export type CacheInfo = {
    name: string;
    game: GameType;
    environment: string;
    revision: number;
    timestamp: string;
    size: number;
};

export function sortCachesNewToOld(caches: CacheInfo[]): void {
    caches.sort((a, b) => {
        const isOsrsA = a.game === GameType.Oldschool;
        const isOsrsB = b.game === GameType.Oldschool;
        const isLiveA = a.environment === "live";
        const isLiveB = b.environment === "live";
        const dateA = Date.parse(a.timestamp);
        const dateB = Date.parse(b.timestamp);
        return (
            (isOsrsB ? 1 : 0) - (isOsrsA ? 1 : 0) ||
            (isLiveB ? 1 : 0) - (isLiveA ? 1 : 0) ||
            b.revision - a.revision ||
            dateB - dateA
        );
    });
}

export function getLatestCache(caches: CacheInfo[]): CacheInfo | undefined {
    if (caches.length === 0) {
        return undefined;
    }

    sortCachesNewToOld(caches);

    return caches[0];
}
