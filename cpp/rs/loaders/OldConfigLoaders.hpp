#pragma once

#include "../cache/CacheInfo.hpp"
#include "../cache/CacheType.hpp"
#include "../cache/format/Archive.hpp"
#include "../core/Allocator.hpp"
#include "../core/Expected.hpp"
#include "../types.hpp"
#include "../config/DatTypeLoader.hpp"
#include "../config/IndexedDatTypeLoader.hpp"
#include "../config/floortype/OverlayFloorType.hpp"
#include "../config/loctype/LocType.hpp"
#include "../config/npctype/NpcType.hpp"
#include "../config/objtype/ObjType.hpp"
#include "../config/seqtype/SeqType.hpp"
#include "../config/vartype/VarBitType.hpp"
#include "InitError.hpp"

namespace rs {

// Minimal Dat/Legacy config loader set, mirroring TS DatLoaders/LegacyLoaders.
// Uses legacy `<name>.dat` streams and `<name>.dat`+`<name>.idx` indexed blobs from the config archive.
struct OldConfigLoaders final {
    // Own the config archive to keep file byte buffers alive for indexed loaders.
    Archive configArchive{};

    DatTypeLoader<OverlayFloorType> floors{};
    DatTypeLoader<SeqType> seqs{};
    IndexedDatTypeLoader<LocType> locs{};
    IndexedDatTypeLoader<NpcType> npcs{};
    IndexedDatTypeLoader<ObjType> objs{};

    // Present only for Dat caches where revision >= 254.
    DatTypeLoader<VarBitType> varbits{};

    static Expected<OldConfigLoaders, InitError> tryCreate(
        const CacheInfo& cacheInfo,
        CacheType cacheType,
        Archive configArchive,
        Allocator& alloc) noexcept {
        OldConfigLoaders out{};
        out.configArchive = rs::move(configArchive);

        {
            auto r = DatTypeLoader<OverlayFloorType>::fromNamedFiles(cacheInfo, out.configArchive, "flo", alloc);
            if (!r.isOk()) {
                return Expected<OldConfigLoaders, InitError>::err(
                    InitError::decodeFailed(r.status(), "DatTypeLoader<OverlayFloorType>(flo)"));
            }
            out.floors = rs::move(r.value());
        }
        {
            auto r = DatTypeLoader<SeqType>::fromNamedFiles(cacheInfo, out.configArchive, "seq", alloc);
            if (!r.isOk()) {
                return Expected<OldConfigLoaders, InitError>::err(
                    InitError::decodeFailed(r.status(), "DatTypeLoader<SeqType>(seq)"));
            }
            out.seqs = rs::move(r.value());
        }
        {
            auto r = IndexedDatTypeLoader<LocType>::fromNamedFiles(cacheInfo, out.configArchive, "loc", alloc);
            if (!r.isOk()) {
                return Expected<OldConfigLoaders, InitError>::err(
                    InitError::decodeFailed(r.status(), "IndexedDatTypeLoader<LocType>(loc)"));
            }
            out.locs = rs::move(r.value());
        }
        {
            auto r = IndexedDatTypeLoader<NpcType>::fromNamedFiles(cacheInfo, out.configArchive, "npc", alloc);
            if (!r.isOk()) {
                return Expected<OldConfigLoaders, InitError>::err(
                    InitError::decodeFailed(r.status(), "IndexedDatTypeLoader<NpcType>(npc)"));
            }
            out.npcs = rs::move(r.value());
        }
        {
            auto r = IndexedDatTypeLoader<ObjType>::fromNamedFiles(cacheInfo, out.configArchive, "obj", alloc);
            if (!r.isOk()) {
                return Expected<OldConfigLoaders, InitError>::err(
                    InitError::decodeFailed(r.status(), "IndexedDatTypeLoader<ObjType>(obj)"));
            }
            out.objs = rs::move(r.value());
        }

        // Varbits:
        // - Legacy: TS uses DummyVarBitTypeLoader always.
        // - Dat: varbits appear from revision 254+.
        if (cacheType == CacheType::Dat && cacheInfo.revision >= 254) {
            auto r = DatTypeLoader<VarBitType>::fromNamedFiles(cacheInfo, out.configArchive, "varbit", alloc);
            if (!r.isOk()) {
                return Expected<OldConfigLoaders, InitError>::err(
                    InitError::decodeFailed(r.status(), "DatTypeLoader<VarBitType>(varbit)"));
            }
            out.varbits = rs::move(r.value());
        }

        return Expected<OldConfigLoaders, InitError>::ok(rs::move(out));
    }
};

} // namespace rs

