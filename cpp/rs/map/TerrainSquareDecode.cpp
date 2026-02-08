#include "TerrainSquareDecode.hpp"

#include "../io/Uint8ArrayReader.hpp"
#include "../util/HeightCalc.hpp"

namespace rs {

static inline Status readTerrainValue(Uint8ArrayReader& reader, bool newFormat, bool signedValue, i32* out) noexcept {
    if (!out) return Status::InvalidArgument;
    if (newFormat) {
        if (signedValue) {
            i16 v = 0;
            const Status s = reader.readShort(&v);
            if (!ok(s)) return s;
            *out = static_cast<i32>(v);
            return Status::Ok;
        }
        u16 v = 0;
        const Status s = reader.readUnsignedShort(&v);
        if (!ok(s)) return s;
        *out = static_cast<i32>(v);
        return Status::Ok;
    }
    if (signedValue) {
        i8 v = 0;
        const Status s = reader.readByte(&v);
        if (!ok(s)) return s;
        *out = static_cast<i32>(v);
        return Status::Ok;
    }
    u8 v = 0;
    const Status s = reader.readUnsignedByte(&v);
    if (!ok(s)) return s;
    *out = static_cast<i32>(v);
    return Status::Ok;
}

Status decodeTerrainSquareFromBytesInto(
    TerrainSquare& out,
    Span<const u8> data,
    bool newTerrainFormat,
    i32 worldTileX0,
    i32 worldTileY0
) noexcept {
    Uint8ArrayReader reader(data, 0);

    for (i32 level = 0; level < TerrainConstants::MAX_LEVELS; level++) {
        for (i32 x = 0; x < TerrainConstants::MAP_SQUARE_SIZE; x++) {
            for (i32 y = 0; y < TerrainConstants::MAP_SQUARE_SIZE; y++) {
                out.renderFlags(level, x, y) = 0;
                out.underlay(level, x, y) = 0;
                out.overlay(level, x, y) = 0;
                out.shape(level, x, y) = 0;
                out.rotation(level, x, y) = 0;

                for (;;) {
                    i32 v = 0;
                    Status s = readTerrainValue(reader, newTerrainFormat, false, &v);
                    if (!ok(s)) return s;

                    if (v == 0) {
                        if (level == 0) {
                            const i32 worldX = worldTileX0 + x + 932731;
                            const i32 worldY = worldTileY0 + y + 556238;
                            out.height(level, x, y) =
                                -HeightCalc::generateHeight(worldX, worldY) * TerrainConstants::UNITS_TILE_HEIGHT_BASIS;
                        } else {
                            out.height(level, x, y) = out.height(level - 1, x, y) - TerrainConstants::UNITS_LEVEL_HEIGHT;
                        }
                        break;
                    }

                    if (v == 1) {
                        u8 heightU8 = 0;
                        s = reader.readUnsignedByte(&heightU8);
                        if (!ok(s)) return s;
                        i32 height = static_cast<i32>(heightU8);
                        if (height == 1) {
                            height = 0;
                        }
                        if (level == 0) {
                            out.height(level, x, y) = -height * TerrainConstants::UNITS_TILE_HEIGHT_BASIS;
                        } else {
                            out.height(level, x, y) =
                                out.height(level - 1, x, y) - height * TerrainConstants::UNITS_TILE_HEIGHT_BASIS;
                        }
                        break;
                    }

                    if (v <= 49) {
                        i32 overlay = 0;
                        s = readTerrainValue(reader, newTerrainFormat, false, &overlay);
                        if (!ok(s)) return s;
                        out.overlay(level, x, y) = static_cast<i16>(overlay);
                        const i32 shapeAndRotation = v - 2;
                        out.shape(level, x, y) = static_cast<u8>(shapeAndRotation >> 2);
                        out.rotation(level, x, y) = static_cast<u8>(shapeAndRotation & 3);
                    } else if (v <= 81) {
                        out.renderFlags(level, x, y) = static_cast<u8>(v - 49);
                    } else {
                        out.underlay(level, x, y) = static_cast<u16>(v - 81);
                    }
                }
            }
        }
    }

    return Status::Ok;
}

} // namespace rs

