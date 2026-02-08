export enum GameType {
    Classic,
    Runescape,
    Oldschool,
}

export function getGameTypeName(gameType: GameType): string {
    switch (gameType) {
        case GameType.Classic:
            return "classic";
        case GameType.Runescape:
            return "runescape";
        case GameType.Oldschool:
            return "oldschool";
        default:
            throw new Error("Unknown game type");
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

export class CacheInfo {
    constructor(
        public name: string,
        public game: GameType,
        public environment: string,
        public revision: number,
        public timestamp: string,
        public size: number,
    ) {}
}

export function sortCachesNewToOld(caches: Array<CacheInfo>): void {
    caches.sort((a, b) => {
        const isOsrsA = a.game === GameType.Oldschool;
        const isOsrsB = b.game === GameType.Oldschool;
        const isLiveA = a.environment === "live";
        const isLiveB = b.environment === "live";
        return (
            (isOsrsB ? 1 : 0) - (isOsrsA ? 1 : 0) ||
            (isLiveB ? 1 : 0) - (isLiveA ? 1 : 0) ||
            b.revision - a.revision
        );
    });
}

export function getLatestCache(caches: Array<CacheInfo>): CacheInfo | null {
    if (caches.length === 0) {
        return null;
    }

    sortCachesNewToOld(caches);

    return caches[0];
}
