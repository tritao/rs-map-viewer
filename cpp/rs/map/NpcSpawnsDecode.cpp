#include "NpcSpawnsDecode.hpp"

#include "../io/Uint8ArrayReader.hpp"
#include "TerrainConstants.hpp"

namespace rs {

static constexpr u8 TILE_RENDER_FLAG_BRIDGE = 0x2; // TileRenderFlag.Bridge

Status decodeNpcSpawnsFromBytes(
    Span<const u8> tileRenderFlagsLevel1,
    i32 flagsWidth,
    i32 borderSize,
    i32 mapX,
    i32 mapY,
    Span<const u8> data,
    Vec<NpcSpawn>* out,
    Allocator& alloc) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    if (flagsWidth <= 0) {
        return Status::InvalidArgument;
    }
    // Minimal bounds check for the bridge lookup indices we do (x,y are in [0..63]).
    const i32 required = (borderSize + TerrainConstants::MAP_SQUARE_SIZE);
    if (tileRenderFlagsLevel1.size() < static_cast<std::size_t>(required * flagsWidth)) {
        return Status::OutOfRange;
    }

    *out = Vec<NpcSpawn>(alloc);
    Uint8ArrayReader reader(data, 0);

    const i32 baseX = mapX * TerrainConstants::MAP_SQUARE_SIZE;
    const i32 baseY = mapY * TerrainConstants::MAP_SQUARE_SIZE;

    while (reader.remaining() > 0) {
        u16 packed = 0;
        Status s = reader.readUnsignedShort(&packed);
        if (!ok(s)) {
            return s;
        }
        i32 level = static_cast<i32>(packed >> 14);
        const i32 x = static_cast<i32>((packed >> 7) & 0x3f);
        const i32 y = static_cast<i32>(packed & 0x3f);

        u16 idU16 = 0;
        s = reader.readUnsignedShort(&idU16);
        if (!ok(s)) {
            return s;
        }
        const i32 id = static_cast<i32>(idU16);

        if (level > 0) {
            const i32 fx = x + borderSize;
            const i32 fy = y + borderSize;
            const std::size_t idx = static_cast<std::size_t>(fx) * static_cast<std::size_t>(flagsWidth) + static_cast<std::size_t>(fy);
            if ((tileRenderFlagsLevel1[idx] & TILE_RENDER_FLAG_BRIDGE) != 0) {
                level--;
            }
        }

        NpcSpawn spawn{};
        spawn.id = id;
        spawn.x = baseX + x;
        spawn.y = baseY + y;
        spawn.level = level;

        auto rr = out->pushBack(spawn);
        if (!rr.isOk()) {
            return rr.status();
        }
    }

    return Status::Ok;
}

} // namespace rs

