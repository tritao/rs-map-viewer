#pragma once

#include "../../cache/CacheInfo.hpp"
#include "../../cache/CacheSystem.hpp"
#include "../../cache/CacheType.hpp"
#include "../../cache/IndexId.hpp"
#include "../../cache/format/Archive.hpp"
#include "../../cache/format/ArchiveFile.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"
#include "../TypeDecode.hpp"
#include "DefaultsGroup.hpp"

namespace rs {

// Mirrors `src/rs/config/defaults/GraphicsDefaults.ts`.
struct GraphicsDefaults {
    i32 id = -1;
    CacheInfo cacheInfo{};

    i32 compass = -1;
    i32 mapEdge = -1;
    i32 mapScenes = -1;
    i32 mapFunctions = -1;
    i32 headIconsPk = -1;
    i32 headIconsPrayer = -1;
    i32 headIconsHint = -1;
    i32 mapMarkers = -1;
    i32 crosses = -1;
    i32 mapDots = -1;
    i32 scrollBars = -1;
    i32 modIcons = -1;

    GraphicsDefaults() = default;
    GraphicsDefaults(i32 id_, const CacheInfo& cacheInfo_) noexcept : id(id_), cacheInfo(cacheInfo_) {}

    Status decodeOpcode(u8 opcode, Uint8ArrayReader& reader) noexcept {
        if (opcode == 1) {
            // skip medium
            u32 unused = 0;
            return reader.readMedium(&unused);
        }
        if (opcode == 2) {
            Status s = reader.readBigSmart(&compass);
            if (!ok(s)) return s;
            s = reader.readBigSmart(&mapEdge);
            if (!ok(s)) return s;
            s = reader.readBigSmart(&mapScenes);
            if (!ok(s)) return s;
            s = reader.readBigSmart(&headIconsPk);
            if (!ok(s)) return s;
            s = reader.readBigSmart(&headIconsPrayer);
            if (!ok(s)) return s;
            s = reader.readBigSmart(&headIconsHint);
            if (!ok(s)) return s;
            s = reader.readBigSmart(&mapMarkers);
            if (!ok(s)) return s;
            s = reader.readBigSmart(&crosses);
            if (!ok(s)) return s;
            s = reader.readBigSmart(&mapDots);
            if (!ok(s)) return s;
            s = reader.readBigSmart(&scrollBars);
            if (!ok(s)) return s;
            return reader.readBigSmart(&modIcons);
        }
        // Mirrors TS behavior: ignore other opcodes.
        return Status::Ok;
    }

    static Result<GraphicsDefaults> tryCreate(const CacheInfo& cacheInfo, const CacheSystem& cacheSystem, Allocator& alloc) noexcept {
        // OSRS: defaults stored in OsrsIndexId.graphicDefaults, archive DefaultsGroup::Graphics, file 0.
        if (cacheInfo.game == GameType::Oldschool) {
            const CacheIndex* defaultsIndex = nullptr;
            const Status s = cacheSystem.getIndex(static_cast<i32>(OsrsIndexId::graphicDefaults), &defaultsIndex);
            if (ok(s) && defaultsIndex) {
                auto archRes = defaultsIndex->getArchive(static_cast<i32>(DefaultsGroup::Graphics), alloc);
                if (!archRes.isOk()) {
                    return Result<GraphicsDefaults>::err(archRes.status());
                }
                const Archive archive = rs::move(archRes.value());
                const Span<const ArchiveFile> files = archive.files();
                const ArchiveFile* f0 = nullptr;
                for (std::size_t i = 0; i < files.size(); i++) {
                    if (files[i].id == 0) {
                        f0 = &files[i];
                        break;
                    }
                }
                if (!f0) {
                    return Result<GraphicsDefaults>::err(Status::NotFound);
                }
                GraphicsDefaults out(f0->archiveId, cacheInfo);
                Uint8ArrayReader reader(f0->data.span(), 0);
                TypeDecodeError err{};
                const Status ds = decodeType(out, reader, &err, nullptr);
                if (!ok(ds)) {
                    return Result<GraphicsDefaults>::err(ds);
                }
                return Result<GraphicsDefaults>::ok(out);
            }
        }

        // RS2 defaults index exists => TS returns "empty defaults" (all -1).
        if (cacheInfo.game == GameType::Runescape && cacheSystem.indexExists(static_cast<i32>(Rs2IndexId::defaults))) {
            return Result<GraphicsDefaults>::ok(GraphicsDefaults(-1, cacheInfo));
        }

        // Fallback: derive from sprite archive names in Dat2IndexId.sprites.
        const CacheIndex* spriteIndex = nullptr;
        const Status sSprites = cacheSystem.getIndex(static_cast<i32>(Dat2IndexId::sprites), &spriteIndex);
        if (!ok(sSprites) || !spriteIndex) {
            return Result<GraphicsDefaults>::err(sSprites);
        }

        GraphicsDefaults out(-1, cacheInfo);
        out.compass = spriteIndex->getArchiveId("compass");
        out.mapEdge = spriteIndex->getArchiveId("mapedge");
        out.mapScenes = spriteIndex->getArchiveId("mapscene");
        out.mapFunctions = spriteIndex->getArchiveId("mapfunction");
        out.headIconsPk = spriteIndex->getArchiveId("headicons_pk");
        out.headIconsPrayer = spriteIndex->getArchiveId("headicons_prayer");
        out.headIconsHint = spriteIndex->getArchiveId("headicons_hint");
        out.mapMarkers = spriteIndex->getArchiveId("mapmarker");
        out.crosses = spriteIndex->getArchiveId("cross");
        out.mapDots = spriteIndex->getArchiveId("mapdots");
        out.scrollBars = spriteIndex->getArchiveId("scrollbar");
        out.modIcons = spriteIndex->getArchiveId("mod_icons");
        return Result<GraphicsDefaults>::ok(out);
    }
};

} // namespace rs
