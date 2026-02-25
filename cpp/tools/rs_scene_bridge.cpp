#include "../rs/cache/CacheInfo.hpp"
#include "../rs/config/TypeDecode.hpp"
#include "../rs/config/loctype/LocType.hpp"
#include "../rs/config/vartype/VarBitType.hpp"
#include "../rs/core/Allocator.hpp"
#include "../rs/core/Result.hpp"
#include "../rs/core/StringArena.hpp"
#include "../rs/core/Span.hpp"
#include "../rs/core/Status.hpp"
#include "../rs/core/Vec.hpp"
#include "../rs/io/Uint8ArrayReader.hpp"
#include "../rs/map/LocPlacementsDecode.hpp"
#include "../rs/scene/SceneBuildStages.hpp"
#include "../rs/scene/SceneData.hpp"
#include "../rs/types.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#ifdef RS_SCENE_BRIDGE_NO_WASM_KEEPALIVE
#define RS_WASM_KEEPALIVE
#else
#define RS_WASM_KEEPALIVE EMSCRIPTEN_KEEPALIVE
#endif
#else
#define RS_WASM_KEEPALIVE
#endif

namespace {

static constexpr rs::i32 RS_SCENE_CAP_BUILD = 1 << 0;
static constexpr rs::i32 RS_SCENE_LEVELS = 4;
static constexpr rs::i32 RS_LOC_PLACEMENT_STRIDE = 7;
static constexpr rs::i32 RS_LOC_TYPE_RAW_STRIDE = 9;
static constexpr rs::i32 RS_VARBIT_DEF_STRIDE = 4;

static constexpr rs::i32 RS_LOC_MODEL_TYPE_WALL = 0;
static constexpr rs::i32 RS_LOC_MODEL_TYPE_WALL_TRI_CORNER = 1;
static constexpr rs::i32 RS_LOC_MODEL_TYPE_WALL_CORNER = 2;
static constexpr rs::i32 RS_LOC_MODEL_TYPE_WALL_RECT_CORNER = 3;
static constexpr rs::i32 RS_LOC_MODEL_TYPE_WALL_DIAGONAL = 9;
static constexpr rs::i32 RS_LOC_MODEL_TYPE_NORMAL = 10;
static constexpr rs::i32 RS_LOC_MODEL_TYPE_NORMAL_DIAGIONAL = 11;
static constexpr rs::i32 RS_LOC_MODEL_TYPE_FLOOR_DECORATION = 22;

static constexpr rs::i32 RS_COLLISION_LOC = 0x100;
static constexpr rs::i32 RS_COLLISION_LOC_PROJECTILE = 0x20000;
static constexpr rs::i32 RS_COLLISION_BLOCKED_BY_FLOOR = 0x200000;
static constexpr rs::i32 RS_COLLISION_BLOCKED_BY_FLOOR_DEC = 0x40000;

static constexpr rs::i32 RS_COLLISION_WALL_WEST = 0x80;
static constexpr rs::i32 RS_COLLISION_WALL_EAST = 0x8;
static constexpr rs::i32 RS_COLLISION_WALL_NORTH = 0x2;
static constexpr rs::i32 RS_COLLISION_WALL_SOUTH = 0x20;
static constexpr rs::i32 RS_COLLISION_WALL_NORTH_WEST = 0x1;
static constexpr rs::i32 RS_COLLISION_WALL_NORTH_EAST = 0x4;
static constexpr rs::i32 RS_COLLISION_WALL_SOUTH_EAST = 0x10;
static constexpr rs::i32 RS_COLLISION_WALL_SOUTH_WEST = 0x40;

static constexpr rs::i32 RS_COLLISION_PROJ_WALL_WEST = 0x10000;
static constexpr rs::i32 RS_COLLISION_PROJ_WALL_EAST = 0x1000;
static constexpr rs::i32 RS_COLLISION_PROJ_WALL_NORTH = 0x400;
static constexpr rs::i32 RS_COLLISION_PROJ_WALL_SOUTH = 0x4000;
static constexpr rs::i32 RS_COLLISION_PROJ_WALL_NORTH_WEST = 0x200;
static constexpr rs::i32 RS_COLLISION_PROJ_WALL_NORTH_EAST = 0x800;
static constexpr rs::i32 RS_COLLISION_PROJ_WALL_SOUTH_EAST = 0x2000;
static constexpr rs::i32 RS_COLLISION_PROJ_WALL_SOUTH_WEST = 0x8000;

struct PackedMapBytesView final {
    rs::Span<const rs::i32> mapSquareIds{};
    rs::Span<const rs::i32> terrainOffsets{};
    rs::Span<const rs::i32> terrainLengths{};
    rs::Span<const rs::u8> terrainBytes{};
    rs::Span<const rs::i32> locOffsets{};
    rs::Span<const rs::i32> locLengths{};
    rs::Span<const rs::u8> locBytes{};
};

static rs::i32 mapSquareId(const rs::i32 mapX, const rs::i32 mapY) noexcept {
    return (mapX << 8) + mapY;
}

class PackedMapBytesProvider final : public rs::MapBytesProvider {
public:
    explicit PackedMapBytesProvider(PackedMapBytesView view) noexcept : view_(view) {}

    rs::Status tryLoadTerrainBytes(
        const rs::i32 mapX,
        const rs::i32 mapY,
        rs::Vec<rs::u8>* out) const noexcept override {
        return loadBytes(
            mapSquareId(mapX, mapY),
            view_.terrainOffsets,
            view_.terrainLengths,
            view_.terrainBytes,
            out);
    }

    rs::Status tryLoadLocBytes(
        const rs::i32 mapX,
        const rs::i32 mapY,
        rs::Vec<rs::u8>* out) const noexcept override {
        return loadBytes(
            mapSquareId(mapX, mapY),
            view_.locOffsets,
            view_.locLengths,
            view_.locBytes,
            out);
    }

    rs::Status tryLoadNpcSpawnBytes(
        const rs::i32 mapX,
        const rs::i32 mapY,
        rs::Vec<rs::u8>* out) const noexcept override {
        (void)mapX;
        (void)mapY;
        if (out) {
            out->clear();
        }
        return rs::Status::NotFound;
    }

private:
    rs::Status loadBytes(
        const rs::i32 key,
        const rs::Span<const rs::i32> offsets,
        const rs::Span<const rs::i32> lengths,
        const rs::Span<const rs::u8> data,
        rs::Vec<rs::u8>* out) const noexcept {
        if (!out) {
            return rs::Status::InvalidArgument;
        }
        const rs::i32 idx = findMapIndex(key);
        if (idx < 0) {
            out->clear();
            return rs::Status::NotFound;
        }
        const rs::i32 len = lengths[static_cast<std::size_t>(idx)];
        if (len <= 0) {
            out->clear();
            return rs::Status::NotFound;
        }
        const rs::i32 off = offsets[static_cast<std::size_t>(idx)];
        if (off < 0 || off > static_cast<rs::i32>(data.size()) ||
            len > static_cast<rs::i32>(data.size()) - off) {
            return rs::Status::OutOfRange;
        }
        out->clear();
        auto rr = out->resize(static_cast<std::size_t>(len));
        if (!rr.isOk()) {
            return rr.status();
        }
        for (rs::i32 i = 0; i < len; i++) {
            (*out)[static_cast<std::size_t>(i)] = data[static_cast<std::size_t>(off + i)];
        }
        return rs::Status::Ok;
    }

    rs::i32 findMapIndex(const rs::i32 key) const noexcept {
        for (std::size_t i = 0; i < view_.mapSquareIds.size(); i++) {
            if (view_.mapSquareIds[i] == key) {
                return static_cast<rs::i32>(i);
            }
        }
        return -1;
    }

    PackedMapBytesView view_{};
};

static rs::Status collectRawLocPlacements(
    const rs::MapBytesProvider& mapBytesProvider,
    const rs::SceneBuildContext& context,
    rs::Vec<rs::SceneLocPlacement>* outLocPlacements,
    rs::Allocator& alloc) noexcept {
    if (!outLocPlacements) {
        return rs::Status::InvalidArgument;
    }

    *outLocPlacements = rs::Vec<rs::SceneLocPlacement>(alloc);
    rs::Vec<rs::u8> locBytes(alloc);
    rs::Vec<rs::LocPlacement> decoded(alloc);

    for (rs::i32 mx = context.bounds.mapStartX; mx < context.bounds.mapEndX; mx++) {
        for (rs::i32 my = context.bounds.mapStartY; my < context.bounds.mapEndY; my++) {
            const rs::Status loadStatus = mapBytesProvider.tryLoadLocBytes(mx, my, &locBytes);
            if (loadStatus == rs::Status::NotFound) {
                continue;
            }
            if (!rs::ok(loadStatus)) {
                return loadStatus;
            }

            const rs::Status decodeStatus = rs::decodeLocPlacementsFromBytes(
                rs::Span<const rs::u8>(locBytes.data(), locBytes.size()),
                &decoded,
                alloc);
            if (!rs::ok(decodeStatus)) {
                return decodeStatus;
            }

            const rs::i32 offsetX =
                mx * rs::TerrainConstants::MAP_SQUARE_SIZE - context.baseX;
            const rs::i32 offsetY =
                my * rs::TerrainConstants::MAP_SQUARE_SIZE - context.baseY;
            for (std::size_t i = 0; i < decoded.size(); i++) {
                const rs::LocPlacement& p = decoded[i];
                const rs::i32 sceneX = p.localX + offsetX;
                const rs::i32 sceneY = p.localY + offsetY;

                if (!(sceneX > 0 &&
                      sceneY > 0 &&
                      sceneX < context.sizeX - 1 &&
                      sceneY < context.sizeY - 1)) {
                    continue;
                }

                rs::SceneLocPlacement out{};
                out.originalId = p.id;
                out.resolvedId = p.id;
                out.level = p.level;
                out.tileX = sceneX;
                out.tileY = sceneY;
                out.type = p.type;
                out.rotation = p.rotation;
                auto rr = outLocPlacements->pushBack(out);
                if (!rr.isOk()) {
                    return rr.status();
                }
            }
        }
    }

    return rs::Status::Ok;
}

template <typename T>
static rs::i32 copyToOutput(
    rs::Span<const T> src,
    T* dst,
    const rs::i32 dstLength) noexcept {
    if (!dst || dstLength != static_cast<rs::i32>(src.size())) {
        return -2;
    }
    for (std::size_t i = 0; i < src.size(); i++) {
        dst[i] = src[i];
    }
    return 0;
}

static rs::GameType gameTypeFromInt(const rs::i32 value) noexcept {
    switch (value) {
    case 0:
        return rs::GameType::Classic;
    case 1:
        return rs::GameType::Runescape;
    case 2:
        return rs::GameType::Oldschool;
    default:
        return rs::GameType::Runescape;
    }
}

static bool isTileWithinBounds(
    const rs::i32 levels,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 level,
    const rs::i32 x,
    const rs::i32 y) noexcept {
    return level >= 0 &&
        level < levels &&
        x >= 0 &&
        x < sizeX &&
        y >= 0 &&
        y < sizeY;
}

static rs::i32 tileIndex(
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 level,
    const rs::i32 x,
    const rs::i32 y) noexcept {
    return (level * sizeX + x) * sizeY + y;
}

static void collisionFlag(
    rs::i32* flags,
    const rs::i32 levels,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 level,
    const rs::i32 x,
    const rs::i32 y,
    const rs::i32 flag) noexcept {
    if (!isTileWithinBounds(levels, sizeX, sizeY, level, x, y)) {
        return;
    }
    const rs::i32 idx = tileIndex(sizeX, sizeY, level, x, y);
    flags[idx] |= flag;
}

static void collisionAddLoc(
    rs::i32* flags,
    const rs::i32 levels,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 level,
    const rs::i32 x,
    const rs::i32 y,
    const rs::i32 locSizeX,
    const rs::i32 locSizeY,
    const bool blockProjectile) noexcept {
    rs::i32 locFlags = RS_COLLISION_LOC;
    if (blockProjectile) {
        locFlags |= RS_COLLISION_LOC_PROJECTILE;
    }
    for (rs::i32 fx = x; fx < x + locSizeX; fx++) {
        for (rs::i32 fy = y; fy < y + locSizeY; fy++) {
            collisionFlag(flags, levels, sizeX, sizeY, level, fx, fy, locFlags);
        }
    }
}

static void collisionAddWall(
    rs::i32* flags,
    const rs::i32 levels,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 level,
    const rs::i32 x,
    const rs::i32 y,
    const rs::i32 type,
    const rs::i32 rotation,
    const bool blockProjectile) noexcept {
    if (type == RS_LOC_MODEL_TYPE_WALL) {
        if (rotation == 0) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_WALL_WEST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y, RS_COLLISION_WALL_EAST);
        } else if (rotation == 1) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_WALL_NORTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y + 1, RS_COLLISION_WALL_SOUTH);
        } else if (rotation == 2) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_WALL_EAST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y, RS_COLLISION_WALL_WEST);
        } else if (rotation == 3) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_WALL_SOUTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y - 1, RS_COLLISION_WALL_NORTH);
        }
    }

    if (type == RS_LOC_MODEL_TYPE_WALL_TRI_CORNER || type == RS_LOC_MODEL_TYPE_WALL_RECT_CORNER) {
        if (rotation == 0) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_WALL_NORTH_WEST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y + 1, RS_COLLISION_WALL_SOUTH_EAST);
        } else if (rotation == 1) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_WALL_NORTH_EAST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y + 1, RS_COLLISION_WALL_SOUTH_WEST);
        } else if (rotation == 2) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_WALL_SOUTH_EAST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y - 1, RS_COLLISION_WALL_NORTH_WEST);
        } else if (rotation == 3) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_WALL_SOUTH_WEST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y - 1, RS_COLLISION_WALL_NORTH_EAST);
        }
    }

    if (type == RS_LOC_MODEL_TYPE_WALL_CORNER) {
        if (rotation == 0) {
            collisionFlag(
                flags,
                levels,
                sizeX,
                sizeY,
                level,
                x,
                y,
                RS_COLLISION_WALL_WEST | RS_COLLISION_WALL_NORTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y, RS_COLLISION_WALL_EAST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y + 1, RS_COLLISION_WALL_SOUTH);
        } else if (rotation == 1) {
            collisionFlag(
                flags,
                levels,
                sizeX,
                sizeY,
                level,
                x,
                y,
                RS_COLLISION_WALL_EAST | RS_COLLISION_WALL_NORTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y + 1, RS_COLLISION_WALL_SOUTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y, RS_COLLISION_WALL_WEST);
        } else if (rotation == 2) {
            collisionFlag(
                flags,
                levels,
                sizeX,
                sizeY,
                level,
                x,
                y,
                RS_COLLISION_WALL_EAST | RS_COLLISION_WALL_SOUTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y, RS_COLLISION_WALL_WEST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y - 1, RS_COLLISION_WALL_NORTH);
        } else if (rotation == 3) {
            collisionFlag(
                flags,
                levels,
                sizeX,
                sizeY,
                level,
                x,
                y,
                RS_COLLISION_WALL_WEST | RS_COLLISION_WALL_SOUTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y - 1, RS_COLLISION_WALL_NORTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y, RS_COLLISION_WALL_EAST);
        }
    }

    if (!blockProjectile) {
        return;
    }

    if (type == RS_LOC_MODEL_TYPE_WALL) {
        if (rotation == 0) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_PROJ_WALL_WEST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y, RS_COLLISION_PROJ_WALL_EAST);
        } else if (rotation == 1) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_PROJ_WALL_NORTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y + 1, RS_COLLISION_PROJ_WALL_SOUTH);
        } else if (rotation == 2) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_PROJ_WALL_EAST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y, RS_COLLISION_PROJ_WALL_WEST);
        } else if (rotation == 3) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_PROJ_WALL_SOUTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y - 1, RS_COLLISION_PROJ_WALL_NORTH);
        }
    }

    if (type == RS_LOC_MODEL_TYPE_WALL_TRI_CORNER || type == RS_LOC_MODEL_TYPE_WALL_RECT_CORNER) {
        if (rotation == 0) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_PROJ_WALL_NORTH_WEST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y + 1, RS_COLLISION_PROJ_WALL_SOUTH_EAST);
        } else if (rotation == 1) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_PROJ_WALL_NORTH_EAST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y + 1, RS_COLLISION_PROJ_WALL_SOUTH_WEST);
        } else if (rotation == 2) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_PROJ_WALL_SOUTH_EAST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y - 1, RS_COLLISION_PROJ_WALL_NORTH_WEST);
        } else if (rotation == 3) {
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y, RS_COLLISION_PROJ_WALL_SOUTH_WEST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y - 1, RS_COLLISION_PROJ_WALL_NORTH_EAST);
        }
    }

    if (type == RS_LOC_MODEL_TYPE_WALL_CORNER) {
        if (rotation == 0) {
            collisionFlag(
                flags,
                levels,
                sizeX,
                sizeY,
                level,
                x,
                y,
                RS_COLLISION_PROJ_WALL_WEST | RS_COLLISION_PROJ_WALL_NORTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y, RS_COLLISION_PROJ_WALL_EAST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y + 1, RS_COLLISION_PROJ_WALL_SOUTH);
        } else if (rotation == 1) {
            collisionFlag(
                flags,
                levels,
                sizeX,
                sizeY,
                level,
                x,
                y,
                RS_COLLISION_PROJ_WALL_EAST | RS_COLLISION_PROJ_WALL_NORTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y + 1, RS_COLLISION_PROJ_WALL_SOUTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y, RS_COLLISION_PROJ_WALL_WEST);
        } else if (rotation == 2) {
            collisionFlag(
                flags,
                levels,
                sizeX,
                sizeY,
                level,
                x,
                y,
                RS_COLLISION_PROJ_WALL_EAST | RS_COLLISION_PROJ_WALL_SOUTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x + 1, y, RS_COLLISION_PROJ_WALL_WEST);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y - 1, RS_COLLISION_PROJ_WALL_NORTH);
        } else if (rotation == 3) {
            collisionFlag(
                flags,
                levels,
                sizeX,
                sizeY,
                level,
                x,
                y,
                RS_COLLISION_PROJ_WALL_WEST | RS_COLLISION_PROJ_WALL_SOUTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x, y - 1, RS_COLLISION_PROJ_WALL_NORTH);
            collisionFlag(flags, levels, sizeX, sizeY, level, x - 1, y, RS_COLLISION_PROJ_WALL_EAST);
        }
    }
}

static const rs::i32* findLocTypeRaw(
    const rs::i32* locTypeRows,
    const rs::i32 rowCount,
    const rs::i32 id) noexcept {
    rs::i32 lo = 0;
    rs::i32 hi = rowCount - 1;
    while (lo <= hi) {
        const rs::i32 mid = lo + ((hi - lo) >> 1);
        const rs::i32* row = locTypeRows + mid * RS_LOC_TYPE_RAW_STRIDE;
        const rs::i32 midId = row[0];
        if (midId == id) {
            return row;
        }
        if (midId < id) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return nullptr;
}

static const rs::i32* findVarbitDef(
    const rs::i32* varbitDefs,
    const rs::i32 varbitCount,
    const rs::i32 id) noexcept {
    rs::i32 lo = 0;
    rs::i32 hi = varbitCount - 1;
    while (lo <= hi) {
        const rs::i32 mid = lo + ((hi - lo) >> 1);
        const rs::i32* row = varbitDefs + mid * RS_VARBIT_DEF_STRIDE;
        const rs::i32 midId = row[0];
        if (midId == id) {
            return row;
        }
        if (midId < id) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return nullptr;
}

static rs::i32 getVarpValue(
    const rs::i32* varpValues,
    const rs::i32 varpValuesLength,
    const rs::i32 id) noexcept {
    if (!varpValues || id < 0 || id >= varpValuesLength) {
        return 0;
    }
    return varpValues[id];
}

static rs::i32 getVarbitValue(
    const rs::i32* varbitDefs,
    const rs::i32 varbitCount,
    const rs::i32* varpValues,
    const rs::i32 varpValuesLength,
    const rs::i32 varbitId) noexcept {
    if (varbitId < 0) {
        return 0;
    }
    const rs::i32* def = findVarbitDef(varbitDefs, varbitCount, varbitId);
    if (!def) {
        return 0;
    }
    const rs::i32 baseVar = def[1];
    const rs::i32 startBit = def[2];
    const rs::i32 endBit = def[3];
    const rs::i32 width = endBit - startBit;
    if (width <= 0 || startBit < 0 || startBit >= 31) {
        return 0;
    }
    const rs::i32 baseValue = getVarpValue(varpValues, varpValuesLength, baseVar);
    rs::u32 mask = 0;
    if (width >= 31) {
        mask = 0x7FFFFFFFu;
    } else {
        mask = (static_cast<rs::u32>(1u) << static_cast<rs::u32>(width)) - 1u;
    }
    return static_cast<rs::i32>((static_cast<rs::u32>(baseValue >> startBit)) & mask);
}

static rs::i32 resolveTransformIdFromRaw(
    const rs::i32* locTypeRow,
    const rs::i32* transforms,
    const rs::i32 transformsLength,
    const rs::i32* varbitDefs,
    const rs::i32 varbitCount,
    const rs::i32* varpValues,
    const rs::i32 varpValuesLength) noexcept {
    if (!locTypeRow) {
        return -1;
    }
    const rs::i32 transformsOffset = locTypeRow[7];
    const rs::i32 transformsCount = locTypeRow[8];
    if (!transforms || transformsCount <= 0 || transformsOffset < 0 ||
        transformsOffset >= transformsLength ||
        transformsCount > transformsLength - transformsOffset) {
        return -1;
    }

    rs::i32 transformIndex = -1;
    const rs::i32 transformVarbit = locTypeRow[5];
    const rs::i32 transformVarp = locTypeRow[6];
    if (transformVarbit != -1) {
        transformIndex = getVarbitValue(
            varbitDefs,
            varbitCount,
            varpValues,
            varpValuesLength,
            transformVarbit);
    } else if (transformVarp != -1) {
        transformIndex = getVarpValue(varpValues, varpValuesLength, transformVarp);
    }

    rs::i32 transformId = transforms[transformsOffset + transformsCount - 1];
    if (transformIndex >= 0 &&
        transformIndex < transformsCount - 1 &&
        transforms[transformsOffset + transformIndex] != -1) {
        transformId = transforms[transformsOffset + transformIndex];
    }
    return transformId;
}

static const rs::i32* resolveLocTypeRow(
    const rs::i32* locTypeRows,
    const rs::i32 rowCount,
    const rs::i32* transforms,
    const rs::i32 transformsLength,
    const rs::i32* varbitDefs,
    const rs::i32 varbitCount,
    const rs::i32* varpValues,
    const rs::i32 varpValuesLength,
    const rs::i32 originalId) noexcept {
    const rs::i32* base = findLocTypeRaw(locTypeRows, rowCount, originalId);
    if (!base) {
        return nullptr;
    }
    const rs::i32 transformId = resolveTransformIdFromRaw(
        base,
        transforms,
        transformsLength,
        varbitDefs,
        varbitCount,
        varpValues,
        varpValuesLength);
    if (transformId == -1) {
        return base;
    }
    const rs::i32* transformed = findLocTypeRaw(locTypeRows, rowCount, transformId);
    return transformed ? transformed : base;
}

static rs::Status appendLocTypeRawRow(
    rs::Vec<rs::i32>* outRows,
    const rs::i32 id,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 clipType,
    const rs::i32 blocksProjectile,
    const rs::i32 transformVarbit,
    const rs::i32 transformVarp,
    const rs::i32 transformsOffset,
    const rs::i32 transformsCount) noexcept {
    if (!outRows) {
        return rs::Status::InvalidArgument;
    }
    const rs::i32 values[RS_LOC_TYPE_RAW_STRIDE] = {
        id,
        sizeX,
        sizeY,
        clipType,
        blocksProjectile,
        transformVarbit,
        transformVarp,
        transformsOffset,
        transformsCount,
    };
    for (rs::i32 i = 0; i < RS_LOC_TYPE_RAW_STRIDE; i++) {
        auto rr = outRows->pushBack(values[i]);
        if (!rr.isOk()) {
            return rr.status();
        }
    }
    return rs::Status::Ok;
}

static rs::Status decodeLocTypeRawRowsFromPackedBytes(
    const rs::GameType game,
    const rs::i32 revision,
    const rs::i32* locTypeIds,
    const rs::i32* locTypeOffsets,
    const rs::i32* locTypeLengths,
    const rs::i32 locTypeCount,
    const rs::u8* locTypeBytes,
    const rs::i32 locTypeBytesLength,
    rs::Vec<rs::i32>* outRows,
    rs::Vec<rs::i32>* outTransforms,
    rs::Allocator& alloc) noexcept {
    if (!outRows || !outTransforms) {
        return rs::Status::InvalidArgument;
    }
    *outRows = rs::Vec<rs::i32>(alloc);
    *outTransforms = rs::Vec<rs::i32>(alloc);

    if (locTypeCount <= 0) {
        return rs::Status::Ok;
    }
    if (!locTypeIds || !locTypeOffsets || !locTypeLengths) {
        return rs::Status::InvalidArgument;
    }
    if (locTypeBytesLength > 0 && !locTypeBytes) {
        return rs::Status::InvalidArgument;
    }

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = game;
    cacheInfo.revision = revision;
    rs::StringArena strings(alloc);
    const rs::TypeDecodeContext ctx{cacheInfo, &strings, &alloc};

    for (rs::i32 i = 0; i < locTypeCount; i++) {
        const rs::i32 id = locTypeIds[i];
        const rs::i32 off = locTypeOffsets[i];
        const rs::i32 len = locTypeLengths[i];
        if (len <= 0) {
            continue;
        }
        if (off < 0 || off > locTypeBytesLength || len > locTypeBytesLength - off) {
            return rs::Status::OutOfRange;
        }

        rs::LocType locType(id, cacheInfo);
        rs::Uint8ArrayReader reader(
            rs::Span<const rs::u8>(
                locTypeBytes + off,
                static_cast<std::size_t>(len)),
            0);
        rs::TypeDecodeError err{};
        const rs::Status decodeStatus = rs::decodeType(locType, reader, &err, &ctx);
        if (!rs::ok(decodeStatus)) {
            continue;
        }
        locType.post();

        const rs::i32 transformsOffset = static_cast<rs::i32>(outTransforms->size());
        for (std::size_t t = 0; t < locType.transforms.size(); t++) {
            auto rr = outTransforms->pushBack(locType.transforms[t]);
            if (!rr.isOk()) {
                return rr.status();
            }
        }
        const rs::i32 transformsCount = static_cast<rs::i32>(locType.transforms.size());

        const rs::Status rowStatus = appendLocTypeRawRow(
            outRows,
            id,
            locType.sizeX,
            locType.sizeY,
            locType.clipType,
            locType.blocksProjectile ? 1 : 0,
            locType.transformVarbit,
            locType.transformVarp,
            transformsOffset,
            transformsCount);
        if (!rs::ok(rowStatus)) {
            return rowStatus;
        }
    }

    return rs::Status::Ok;
}

static rs::Status decodeVarbitDefsFromPackedBytes(
    const rs::GameType game,
    const rs::i32 revision,
    const rs::i32* varbitIds,
    const rs::i32* varbitOffsets,
    const rs::i32* varbitLengths,
    const rs::i32 varbitCount,
    const rs::u8* varbitBytes,
    const rs::i32 varbitBytesLength,
    rs::Vec<rs::i32>* outDefs,
    rs::Allocator& alloc) noexcept {
    if (!outDefs) {
        return rs::Status::InvalidArgument;
    }
    *outDefs = rs::Vec<rs::i32>(alloc);

    if (varbitCount <= 0) {
        return rs::Status::Ok;
    }
    if (!varbitIds || !varbitOffsets || !varbitLengths) {
        return rs::Status::InvalidArgument;
    }
    if (varbitBytesLength > 0 && !varbitBytes) {
        return rs::Status::InvalidArgument;
    }

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = game;
    cacheInfo.revision = revision;

    for (rs::i32 i = 0; i < varbitCount; i++) {
        const rs::i32 id = varbitIds[i];
        const rs::i32 off = varbitOffsets[i];
        const rs::i32 len = varbitLengths[i];
        if (len <= 0) {
            continue;
        }
        if (off < 0 || off > varbitBytesLength || len > varbitBytesLength - off) {
            return rs::Status::OutOfRange;
        }

        rs::VarBitType varbit(id, cacheInfo);
        rs::Uint8ArrayReader reader(
            rs::Span<const rs::u8>(varbitBytes + off, static_cast<std::size_t>(len)),
            0);
        rs::TypeDecodeError err{};
        const rs::Status decodeStatus = rs::decodeType(varbit, reader, &err);
        if (!rs::ok(decodeStatus)) {
            continue;
        }

        const rs::i32 values[RS_VARBIT_DEF_STRIDE] = {
            id,
            varbit.baseVar,
            varbit.startBit,
            varbit.endBit,
        };
        for (rs::i32 v = 0; v < RS_VARBIT_DEF_STRIDE; v++) {
            auto rr = outDefs->pushBack(values[v]);
            if (!rr.isOk()) {
                return rr.status();
            }
        }
    }

    return rs::Status::Ok;
}

struct SceneTypeDecodeState final {
    bool initialized = false;
    rs::GameType game = rs::GameType::Runescape;
    rs::i32 revision = 0;
    rs::Vec<rs::i32> locTypeRows;
    rs::Vec<rs::i32> locTypeTransforms;
    rs::Vec<rs::i32> varbitDefs;

    SceneTypeDecodeState() noexcept
        : locTypeRows(rs::defaultAllocator()),
          locTypeTransforms(rs::defaultAllocator()),
          varbitDefs(rs::defaultAllocator()) {}
};

static SceneTypeDecodeState& sceneTypeDecodeState() noexcept {
    static SceneTypeDecodeState state{};
    return state;
}

static void resetSceneTypeDecodeState() noexcept {
    SceneTypeDecodeState& state = sceneTypeDecodeState();
    state.initialized = false;
    state.game = rs::GameType::Runescape;
    state.revision = 0;
    state.locTypeRows.clear();
    state.locTypeTransforms.clear();
    state.varbitDefs.clear();
}

static rs::Status initSceneTypeDecodeStateFromPackedBytes(
    const rs::GameType game,
    const rs::i32 revision,
    const rs::i32* locTypeIds,
    const rs::i32 locTypeCount,
    const rs::i32* locTypeOffsets,
    const rs::i32* locTypeLengths,
    const rs::u8* locTypeBytes,
    const rs::i32 locTypeBytesLength,
    const rs::i32* varbitIds,
    const rs::i32 varbitCount,
    const rs::i32* varbitOffsets,
    const rs::i32* varbitLengths,
    const rs::u8* varbitBytes,
    const rs::i32 varbitBytesLength) noexcept {
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::Vec<rs::i32> decodedLocTypeRows(alloc);
    rs::Vec<rs::i32> decodedLocTypeTransforms(alloc);
    rs::Vec<rs::i32> decodedVarbitDefs(alloc);

    const rs::Status locDecodeStatus = decodeLocTypeRawRowsFromPackedBytes(
        game,
        revision,
        locTypeIds,
        locTypeOffsets,
        locTypeLengths,
        locTypeCount,
        locTypeBytes,
        locTypeBytesLength,
        &decodedLocTypeRows,
        &decodedLocTypeTransforms,
        alloc);
    if (!rs::ok(locDecodeStatus)) {
        return locDecodeStatus;
    }

    const rs::Status varbitDecodeStatus = decodeVarbitDefsFromPackedBytes(
        game,
        revision,
        varbitIds,
        varbitOffsets,
        varbitLengths,
        varbitCount,
        varbitBytes,
        varbitBytesLength,
        &decodedVarbitDefs,
        alloc);
    if (!rs::ok(varbitDecodeStatus)) {
        return varbitDecodeStatus;
    }

    SceneTypeDecodeState& state = sceneTypeDecodeState();
    state.game = game;
    state.revision = revision;
    state.locTypeRows = rs::move(decodedLocTypeRows);
    state.locTypeTransforms = rs::move(decodedLocTypeTransforms);
    state.varbitDefs = rs::move(decodedVarbitDefs);
    state.initialized = true;
    return rs::Status::Ok;
}

} // namespace

extern "C" {

RS_WASM_KEEPALIVE rs::i32 rs_scene_bridge_abi_version() {
    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_scene_bridge_capabilities() {
    return RS_SCENE_CAP_BUILD;
}

static rs::i32 resolve_loc_placements_and_collision(
    rs::i32 levels,
    rs::i32 sizeX,
    rs::i32 sizeY,
    const rs::u8* tileRenderFlags,
    rs::i32 tileRenderFlagsLength,
    const rs::u8* blockedByFloor,
    rs::i32 blockedByFloorLength,
    rs::i32* locPlacements,
    rs::i32 locPlacementIntsLength,
    const rs::i32* locTypeRows,
    rs::i32 locTypeRowIntsLength,
    const rs::i32* locTypeTransforms,
    rs::i32 locTypeTransformsLength,
    const rs::i32* varbitDefs,
    rs::i32 varbitDefIntsLength,
    const rs::i32* varpValues,
    rs::i32 varpValuesLength,
    rs::i32* outCollisionFlags,
    rs::i32 outCollisionFlagsLength);

RS_WASM_KEEPALIVE void rs_scene_types_reset() {
    resetSceneTypeDecodeState();
}

RS_WASM_KEEPALIVE rs::i32 rs_scene_types_init(
    rs::i32 cacheGame,
    rs::i32 cacheRevision,
    const rs::i32* locTypeIds,
    rs::i32 locTypeCount,
    const rs::i32* locTypeOffsets,
    const rs::i32* locTypeLengths,
    const rs::u8* locTypeBytes,
    rs::i32 locTypeBytesLength,
    const rs::i32* varbitIds,
    rs::i32 varbitCount,
    const rs::i32* varbitOffsets,
    const rs::i32* varbitLengths,
    const rs::u8* varbitBytes,
    rs::i32 varbitBytesLength) {
    if (locTypeCount < 0 || locTypeBytesLength < 0 || varbitCount < 0 || varbitBytesLength < 0) {
        return -1;
    }
    if (locTypeCount > 0 && (!locTypeIds || !locTypeOffsets || !locTypeLengths)) {
        return -1;
    }
    if (locTypeBytesLength > 0 && !locTypeBytes) {
        return -1;
    }
    if (varbitCount > 0 && (!varbitIds || !varbitOffsets || !varbitLengths)) {
        return -1;
    }
    if (varbitBytesLength > 0 && !varbitBytes) {
        return -1;
    }

    resetSceneTypeDecodeState();
    const rs::Status initStatus = initSceneTypeDecodeStateFromPackedBytes(
        gameTypeFromInt(cacheGame),
        cacheRevision,
        locTypeIds,
        locTypeCount,
        locTypeOffsets,
        locTypeLengths,
        locTypeBytes,
        locTypeBytesLength,
        varbitIds,
        varbitCount,
        varbitOffsets,
        varbitLengths,
        varbitBytes,
        varbitBytesLength);
    return rs::ok(initStatus) ? 1 : -1;
}

RS_WASM_KEEPALIVE rs::i32 rs_resolve_loc_placements_and_collision_from_initialized_types(
    rs::i32 levels,
    rs::i32 sizeX,
    rs::i32 sizeY,
    const rs::u8* tileRenderFlags,
    rs::i32 tileRenderFlagsLength,
    const rs::u8* blockedByFloor,
    rs::i32 blockedByFloorLength,
    rs::i32* locPlacements,
    rs::i32 locPlacementIntsLength,
    const rs::i32* varpValues,
    rs::i32 varpValuesLength,
    rs::i32* outCollisionFlags,
    rs::i32 outCollisionFlagsLength) {
    const SceneTypeDecodeState& state = sceneTypeDecodeState();
    if (!state.initialized) {
        return -3;
    }
    return resolve_loc_placements_and_collision(
        levels,
        sizeX,
        sizeY,
        tileRenderFlags,
        tileRenderFlagsLength,
        blockedByFloor,
        blockedByFloorLength,
        locPlacements,
        locPlacementIntsLength,
        state.locTypeRows.data(),
        static_cast<rs::i32>(state.locTypeRows.size()),
        state.locTypeTransforms.data(),
        static_cast<rs::i32>(state.locTypeTransforms.size()),
        state.varbitDefs.data(),
        static_cast<rs::i32>(state.varbitDefs.size()),
        varpValues,
        varpValuesLength,
        outCollisionFlags,
        outCollisionFlagsLength);
}

static rs::i32 resolve_loc_placements_and_collision(
    rs::i32 levels,
    rs::i32 sizeX,
    rs::i32 sizeY,
    const rs::u8* tileRenderFlags,
    rs::i32 tileRenderFlagsLength,
    const rs::u8* blockedByFloor,
    rs::i32 blockedByFloorLength,
    rs::i32* locPlacements,
    rs::i32 locPlacementIntsLength,
    const rs::i32* locTypeRows,
    rs::i32 locTypeRowIntsLength,
    const rs::i32* locTypeTransforms,
    rs::i32 locTypeTransformsLength,
    const rs::i32* varbitDefs,
    rs::i32 varbitDefIntsLength,
    const rs::i32* varpValues,
    rs::i32 varpValuesLength,
    rs::i32* outCollisionFlags,
    rs::i32 outCollisionFlagsLength) {
    if (levels <= 0 || sizeX <= 0 || sizeY <= 0) {
        return -1;
    }
    if (!tileRenderFlags || !blockedByFloor || !outCollisionFlags ||
        (locPlacementIntsLength > 0 && !locPlacements) ||
        (locTypeRowIntsLength > 0 && !locTypeRows)) {
        return -1;
    }
    if (locPlacementIntsLength < 0 ||
        locTypeRowIntsLength < 0 ||
        locTypeTransformsLength < 0 ||
        varbitDefIntsLength < 0 ||
        varpValuesLength < 0) {
        return -1;
    }
    if (locPlacementIntsLength % RS_LOC_PLACEMENT_STRIDE != 0 ||
        locTypeRowIntsLength % RS_LOC_TYPE_RAW_STRIDE != 0 ||
        varbitDefIntsLength % RS_VARBIT_DEF_STRIDE != 0) {
        return -1;
    }
    if (locTypeTransformsLength > 0 && !locTypeTransforms) {
        return -1;
    }
    if (varbitDefIntsLength > 0 && !varbitDefs) {
        return -1;
    }
    if (varpValuesLength > 0 && !varpValues) {
        return -1;
    }

    const rs::i32 tileCount = levels * sizeX * sizeY;
    if (tileRenderFlagsLength != tileCount ||
        blockedByFloorLength != tileCount ||
        outCollisionFlagsLength != tileCount) {
        return -2;
    }

    for (rs::i32 i = 0; i < tileCount; i++) {
        outCollisionFlags[i] = blockedByFloor[i] != 0 ? RS_COLLISION_BLOCKED_BY_FLOOR : 0;
    }

    const rs::i32 locCount = locPlacementIntsLength / RS_LOC_PLACEMENT_STRIDE;
    const rs::i32 locTypeRowCount = locTypeRowIntsLength / RS_LOC_TYPE_RAW_STRIDE;
    const rs::i32 varbitCount = varbitDefIntsLength / RS_VARBIT_DEF_STRIDE;

    for (rs::i32 i = 0; i < locCount; i++) {
        const rs::i32 off = i * RS_LOC_PLACEMENT_STRIDE;
        const rs::i32 originalId = locPlacements[off + 0];
        const rs::i32 level = locPlacements[off + 2];
        const rs::i32 tileX = locPlacements[off + 3];
        const rs::i32 tileY = locPlacements[off + 4];
        const rs::i32 type = locPlacements[off + 5];
        const rs::i32 rotation = locPlacements[off + 6] & 3;

        if (!isTileWithinBounds(levels, sizeX, sizeY, level, tileX, tileY)) {
            continue;
        }

        rs::i32 transformedLevel = level;
        if (levels > 1) {
            const rs::i32 bridgeIdx = tileIndex(sizeX, sizeY, 1, tileX, tileY);
            if ((tileRenderFlags[bridgeIdx] & static_cast<rs::u8>(rs::SceneTileRenderFlag::Bridge)) != 0) {
                transformedLevel = level - 1;
            }
        }
        if (!isTileWithinBounds(levels, sizeX, sizeY, transformedLevel, tileX, tileY)) {
            continue;
        }

        const rs::i32* resolved = resolveLocTypeRow(
            locTypeRows,
            locTypeRowCount,
            locTypeTransforms,
            locTypeTransformsLength,
            varbitDefs,
            varbitCount,
            varpValues,
            varpValuesLength,
            originalId);
        if (!resolved) {
            continue;
        }

        const rs::i32 resolvedId = resolved[0];
        const rs::i32 locSizeXBase = resolved[1];
        const rs::i32 locSizeYBase = resolved[2];
        const rs::i32 clipType = resolved[3];
        const bool blocksProjectile = resolved[4] != 0;
        locPlacements[off + 1] = resolvedId;

        if (clipType == 0) {
            continue;
        }

        rs::i32 locSizeX = locSizeXBase;
        rs::i32 locSizeY = locSizeYBase;
        if (rotation == 1 || rotation == 3) {
            const rs::i32 tmp = locSizeX;
            locSizeX = locSizeY;
            locSizeY = tmp;
        }

        if (type == RS_LOC_MODEL_TYPE_FLOOR_DECORATION) {
            if (clipType == 1) {
                collisionFlag(
                    outCollisionFlags,
                    levels,
                    sizeX,
                    sizeY,
                    transformedLevel,
                    tileX,
                    tileY,
                    RS_COLLISION_BLOCKED_BY_FLOOR_DEC);
            }
            continue;
        }
        if (type == RS_LOC_MODEL_TYPE_NORMAL ||
            type == RS_LOC_MODEL_TYPE_NORMAL_DIAGIONAL ||
            type == RS_LOC_MODEL_TYPE_WALL_DIAGONAL) {
            collisionAddLoc(
                outCollisionFlags,
                levels,
                sizeX,
                sizeY,
                transformedLevel,
                tileX,
                tileY,
                locSizeX,
                locSizeY,
                blocksProjectile);
            continue;
        }
        if (type == RS_LOC_MODEL_TYPE_WALL ||
            type == RS_LOC_MODEL_TYPE_WALL_TRI_CORNER ||
            type == RS_LOC_MODEL_TYPE_WALL_CORNER ||
            type == RS_LOC_MODEL_TYPE_WALL_RECT_CORNER) {
            collisionAddWall(
                outCollisionFlags,
                levels,
                sizeX,
                sizeY,
                transformedLevel,
                tileX,
                tileY,
                type,
                rotation,
                blocksProjectile);
            continue;
        }
    }

    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_build_scene_render_seed_from_map_squares(
    rs::i32 baseX,
    rs::i32 baseY,
    rs::i32 sizeX,
    rs::i32 sizeY,
    rs::i32 locLoadType,
    rs::i32 cacheGame,
    rs::i32 cacheRevision,
    rs::i32 mapCount,
    const rs::i32* mapSquareIds,
    const rs::i32* terrainOffsets,
    const rs::i32* terrainLengths,
    const rs::u8* terrainBytes,
    rs::i32 terrainBytesLength,
    const rs::i32* locOffsets,
    const rs::i32* locLengths,
    const rs::u8* locBytes,
    rs::i32 locBytesLength,
    rs::i32* outTileHeights,
    rs::i32 outTileHeightsLength,
    rs::u8* outTileRenderFlags,
    rs::i32 outTileRenderFlagsLength,
    rs::u16* outTileUnderlays,
    rs::i32 outTileUnderlaysLength,
    rs::i16* outTileOverlays,
    rs::i32 outTileOverlaysLength,
    rs::u8* outTileShapes,
    rs::i32 outTileShapesLength,
    rs::u8* outTileRotations,
    rs::i32 outTileRotationsLength,
    rs::u8* outBlockedByFloor,
    rs::i32 outBlockedByFloorLength,
    rs::u8* outTileMinLevels,
    rs::i32 outTileMinLevelsLength,
    rs::i32* outLocPlacements,
    rs::i32 outLocPlacementIntsCapacity) {
    if (sizeX <= 0 || sizeY <= 0 || mapCount < 0 || terrainBytesLength < 0 || locBytesLength < 0) {
        return -1;
    }
    if (mapCount > 0 &&
        (!mapSquareIds || !terrainOffsets || !terrainLengths || !locOffsets || !locLengths)) {
        return -1;
    }
    if (terrainBytesLength > 0 && !terrainBytes) {
        return -1;
    }
    if (locBytesLength > 0 && !locBytes) {
        return -1;
    }

    const rs::i32 tileCount = RS_SCENE_LEVELS * sizeX * sizeY;
    const rs::i32 heightCount = RS_SCENE_LEVELS * (sizeX + 1) * (sizeY + 1);
    if (outTileHeightsLength != heightCount ||
        outTileRenderFlagsLength != tileCount ||
        outTileUnderlaysLength != tileCount ||
        outTileOverlaysLength != tileCount ||
        outTileShapesLength != tileCount ||
        outTileRotationsLength != tileCount ||
        outBlockedByFloorLength != tileCount ||
        outTileMinLevelsLength != tileCount) {
        return -2;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::SceneData scene{};
    auto sceneInit = scene.init(RS_SCENE_LEVELS, sizeX, sizeY, alloc);
    if (!sceneInit.isOk()) {
        return -1;
    }

    rs::SceneBuildScratch scratch{};
    auto scratchInit = scratch.init(alloc);
    if (!scratchInit.isOk()) {
        return -1;
    }

    const rs::SceneBuildContext context = rs::createSceneBuildContext(
        baseX,
        baseY,
        sizeX,
        sizeY,
        locLoadType == static_cast<rs::i32>(rs::SceneLocLoadType::NoModels)
            ? rs::SceneLocLoadType::NoModels
            : rs::SceneLocLoadType::Models);

    PackedMapBytesView mapBytesView{};
    mapBytesView.mapSquareIds = rs::Span<const rs::i32>(
        mapSquareIds,
        static_cast<std::size_t>(mapCount));
    mapBytesView.terrainOffsets = rs::Span<const rs::i32>(
        terrainOffsets,
        static_cast<std::size_t>(mapCount));
    mapBytesView.terrainLengths = rs::Span<const rs::i32>(
        terrainLengths,
        static_cast<std::size_t>(mapCount));
    mapBytesView.terrainBytes = rs::Span<const rs::u8>(
        terrainBytes,
        static_cast<std::size_t>(terrainBytesLength));
    mapBytesView.locOffsets = rs::Span<const rs::i32>(
        locOffsets,
        static_cast<std::size_t>(mapCount));
    mapBytesView.locLengths = rs::Span<const rs::i32>(
        locLengths,
        static_cast<std::size_t>(mapCount));
    mapBytesView.locBytes = rs::Span<const rs::u8>(
        locBytes,
        static_cast<std::size_t>(locBytesLength));
    const PackedMapBytesProvider mapBytesProvider(mapBytesView);

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = gameTypeFromInt(cacheGame);
    cacheInfo.revision = cacheRevision;
    rs::SceneRuntimeServices services{};
    services.cacheInfo = &cacheInfo;

    const rs::Status terrainStatus = rs::decodeTerrainStage(
        services,
        mapBytesProvider,
        context,
        &scene,
        &scratch);
    if (!rs::ok(terrainStatus)) {
        return -1;
    }
    const rs::Status emptyStatus = rs::fillEmptyTerrainStage(
        services,
        context,
        &scene,
        &scratch);
    if (!rs::ok(emptyStatus)) {
        return -1;
    }
    const rs::Status finalizeStatus = rs::finalizeSceneStage(services, context, &scene);
    if (!rs::ok(finalizeStatus)) {
        return -1;
    }

    rs::Vec<rs::SceneLocPlacement> locPlacements(alloc);
    const rs::Status locStatus = collectRawLocPlacements(
        mapBytesProvider,
        context,
        &locPlacements,
        alloc);
    if (!rs::ok(locStatus)) {
        return -1;
    }

    if (copyToOutput(
            rs::Span<const rs::i32>(scene.tileHeights.data(), scene.tileHeights.size()),
            outTileHeights,
            outTileHeightsLength) != 0 ||
        copyToOutput(
            rs::Span<const rs::u8>(scene.tileRenderFlags.data(), scene.tileRenderFlags.size()),
            outTileRenderFlags,
            outTileRenderFlagsLength) != 0 ||
        copyToOutput(
            rs::Span<const rs::u16>(scene.tileUnderlays.data(), scene.tileUnderlays.size()),
            outTileUnderlays,
            outTileUnderlaysLength) != 0 ||
        copyToOutput(
            rs::Span<const rs::i16>(scene.tileOverlays.data(), scene.tileOverlays.size()),
            outTileOverlays,
            outTileOverlaysLength) != 0 ||
        copyToOutput(
            rs::Span<const rs::u8>(scene.tileShapes.data(), scene.tileShapes.size()),
            outTileShapes,
            outTileShapesLength) != 0 ||
        copyToOutput(
            rs::Span<const rs::u8>(scene.tileRotations.data(), scene.tileRotations.size()),
            outTileRotations,
            outTileRotationsLength) != 0 ||
        copyToOutput(
            rs::Span<const rs::u8>(scene.blockedByFloor.data(), scene.blockedByFloor.size()),
            outBlockedByFloor,
            outBlockedByFloorLength) != 0 ||
        copyToOutput(
            rs::Span<const rs::u8>(scene.tileMinLevels.data(), scene.tileMinLevels.size()),
            outTileMinLevels,
            outTileMinLevelsLength) != 0) {
        return -2;
    }

    const rs::i32 locCount = static_cast<rs::i32>(locPlacements.size());
    const rs::i32 requiredLocPlacementInts = locCount * RS_LOC_PLACEMENT_STRIDE;
    if (!outLocPlacements || outLocPlacementIntsCapacity <= 0) {
        return locCount;
    }
    if (outLocPlacementIntsCapacity < requiredLocPlacementInts) {
        return -2;
    }
    for (rs::i32 i = 0; i < locCount; i++) {
        const rs::SceneLocPlacement& loc = locPlacements[static_cast<std::size_t>(i)];
        const rs::i32 off = i * RS_LOC_PLACEMENT_STRIDE;
        outLocPlacements[off + 0] = loc.originalId;
        outLocPlacements[off + 1] = loc.resolvedId;
        outLocPlacements[off + 2] = loc.level;
        outLocPlacements[off + 3] = loc.tileX;
        outLocPlacements[off + 4] = loc.tileY;
        outLocPlacements[off + 5] = loc.type;
        outLocPlacements[off + 6] = loc.rotation;
    }

    return locCount;
}

} // extern "C"
