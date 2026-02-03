export enum DatConfigArchiveId {
    title = 1,
    configs = 2,
    interfaces = 3,
    media = 4,
    versionList = 5,
    textures = 6,
}

export enum Dat2ConfigArchiveId {
    underlays = 1,
    identkits = 3,
    overlays = 4,
    inv = 5,
    locs = 6,
    enums = 8,
    npcs = 9,
    objs = 10,
    params = 11,
    seqs = 12,
    spotAnims = 13,
    varbits = 14,
    // TODO(revision-dependent): 16 is "varps" in some revisions; this codebase also uses 16 for "varPlayer".
    varps = 16,
    varClient = 19,
    varClientString = 15,
    // TODO(revision-dependent): 16 collides with `varps` here; confirm naming for the target revision(s).
    varPlayer = 16,
}

export enum OsrsConfigArchiveId {
    hitSplat = 32,
    healthBar = 33,
    struct = 34,
    mapFunctions = 35,
    dbRow = 38,
    dbTable = 39,
}

export enum Rs2ConfigArchiveId {
    bas = 32,
    mapScenes = 34,
    quests = 35,
    mapFunctions = 36,
}
