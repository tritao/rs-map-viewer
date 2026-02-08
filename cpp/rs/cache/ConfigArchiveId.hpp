#pragma once

#include "../types.hpp"

namespace rs {

// Mirrors `src/rs/cache/ConfigArchiveId.ts`.

enum class DatConfigArchiveId : i32 {
    title = 1,
    configs = 2,
    interfaces = 3,
    media = 4,
    versionList = 5,
    textures = 6,
};

enum class Dat2ConfigArchiveId : i32 {
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
    // NOTE: archive ids 15/16/19 are revision-dependent across clients; TS keeps both varps and varPlayer as 16.
    varClientString = 15,
    varps = 16,
    varPlayer = 16,
    varClient = 19,
};

enum class OsrsConfigArchiveId : i32 {
    hitSplat = 32,
    healthBar = 33,
    struct_ = 34,
    mapFunctions = 35,
    dbRow = 38,
    dbTable = 39,
};

enum class Rs2ConfigArchiveId : i32 {
    bas = 32,
    mapScenes = 34,
    quests = 35,
    mapFunctions = 36,
};

} // namespace rs
