#pragma once

#include "../types.hpp"

namespace rs {

// Mirrors `src/rs/cache/IndexId.ts`.

enum class LegacyIndexId : i32 {
    configs = 0,
    media = 1,
    textures = 2,
    models = 3,
    maps = 4,
};

enum class DatIndexId : i32 {
    configs = 0,
    models = 1,
    animations = 2,
    sounds = 3,
    maps = 4,
};

enum class Dat2IndexId : i32 {
    animations = 0,
    skeletons = 1,
    configs = 2,
    interfaces = 3,
    soundEffects = 4,
    maps = 5,
    musicTracks = 6,
    models = 7,
    sprites = 8,
    textures = 9,
    binary = 10,
    musicJingles = 11,
    clientScript = 12,
    fonts = 13,
    musicSamples = 14,
    musicPatches = 15,
};

enum class OsrsIndexId : i32 {
    worldMapOld = 16,
    graphicDefaults = 17,
    worldMapGeography = 18,
    worldMap = 19,
    worldMapGround = 20,
    dbTableIndex = 21,
};

enum class Rs2IndexId : i32 {
    locs = 16,
    enums = 17,
    npcs = 18,
    objs = 19,
    seqs = 20,
    spotAnims = 21,
    varbits = 22,
    materials = 26,
    particles = 27,
    defaults = 28,
};

} // namespace rs
