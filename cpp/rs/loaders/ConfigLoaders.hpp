#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheSystem.hpp"
#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Status.hpp"
#include "../types.hpp"
#include "../config/vartype/VarBitTypeLoader.hpp"
#include "../config/floortype/FloorTypeLoaders.hpp"
#include "../config/idktype/IdkTypeLoader.hpp"
#include "../config/enumtype/EnumTypeLoader.hpp"
#include "../config/invtype/InvTypeLoader.hpp"
#include "../config/loctype/LocTypeLoader.hpp"
#include "../config/npctype/NpcTypeLoader.hpp"
#include "../config/objtype/ObjTypeLoader.hpp"
#include "../config/paramtype/ParamTypeLoader.hpp"
#include "../config/seqtype/SeqTypeLoader.hpp"
#include "../config/spotanimtype/SpotAnimTypeLoader.hpp"
#include "../config/bastype/BasTypeLoader.hpp"
#include "../config/questtype/QuestTypeLoader.hpp"
#include "../config/mapscenetype/MapSceneTypeLoader.hpp"
#include "../config/meltype/MapElementTypeLoader.hpp"
#include "../config/structtype/StructTypeLoader.hpp"

namespace rs {

struct ConfigLoaders {
    VarBitTypeLoader varBits;
    UnderlayFloorTypeLoader underlays;
    OverlayFloorTypeLoader overlays;
    InvTypeLoader invs;
    IdkTypeLoader identKits;
    LocTypeLoader locs;
    EnumTypeLoader enums;
    NpcTypeLoader npcs;
    ObjTypeLoader objs;
    ParamTypeLoader params;
    SeqTypeLoader seqs;
    SpotAnimTypeLoader spotAnims;

    // Optional / revision-dependent config archives (loaded when present).
    BasTypeLoader bas;
    QuestTypeLoader quests;
    MapSceneTypeLoader mapScenes;
    MapElementTypeLoader mapFunctions;
    StructTypeLoader structs;
};

// Minimal starting point for the config/loaders port. Extend this struct as we port more config types.
Result<ConfigLoaders> tryCreateConfigLoaders(const CacheSystem& cacheSystem, const CacheInfo& cacheInfo, Allocator& alloc) noexcept;

} // namespace rs
