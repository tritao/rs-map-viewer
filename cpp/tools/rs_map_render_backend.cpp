#include "../rs/types.hpp"
#include "../rs/map/NpcSpawnsDecode.hpp"
#include "../rs/core/Allocator.hpp"
#include "../rs/core/Span.hpp"
#include "../rs/core/Vec.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define RS_WASM_KEEPALIVE EMSCRIPTEN_KEEPALIVE
#else
#define RS_WASM_KEEPALIVE
#endif

extern "C" {

static constexpr rs::i32 RS_MAP_RENDER_CAP_HEIGHTMAP = 1 << 0;
static constexpr rs::i32 RS_MAP_RENDER_CAP_NPC_DECODE = 1 << 1;
static constexpr rs::i32 RS_MAP_RENDER_CAP_DRAW_PACK = 1 << 2;

RS_WASM_KEEPALIVE rs::i32 rs_map_render_bridge_abi_version() {
    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_bridge_capabilities() {
    return RS_MAP_RENDER_CAP_HEIGHTMAP | RS_MAP_RENDER_CAP_NPC_DECODE | RS_MAP_RENDER_CAP_DRAW_PACK;
}

RS_WASM_KEEPALIVE rs::i32 rs_heightmap_from_scene_tile_heights(
    const rs::i32* tileHeights,
    rs::i32 levels,
    rs::i32 sizeX,
    rs::i32 sizeY,
    rs::i32 unitsTileHeightBasis,
    rs::i16* outHeightMap,
    rs::i32 outLength) {
    if (!tileHeights || !outHeightMap) {
        return 0;
    }
    if (levels <= 0 || sizeX <= 0 || sizeY <= 0 || unitsTileHeightBasis <= 0) {
        return 0;
    }

    const rs::i32 expectedOutLength = levels * sizeX * sizeY;
    if (outLength != expectedOutLength) {
        return 0;
    }

    rs::i32 outIndex = 0;
    for (rs::i32 level = 0; level < levels; level++) {
        const rs::i32 levelOffset = level * (sizeX + 1) * (sizeY + 1);
        for (rs::i32 x = 0; x < sizeX; x++) {
            for (rs::i32 y = 0; y < sizeY; y++) {
                const rs::i32 src = levelOffset + x * (sizeY + 1) + y;
                const rs::i32 h = tileHeights[src];
                outHeightMap[outIndex++] = static_cast<rs::i16>((-h) / unitsTileHeightBasis);
            }
        }
    }
    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_decode_npc_spawns_from_bytes(
    const rs::u8* tileRenderFlagsLevel1,
    rs::i32 flagsWidth,
    rs::i32 flagsLength,
    rs::i32 borderSize,
    rs::i32 mapX,
    rs::i32 mapY,
    const rs::u8* data,
    rs::i32 dataLength,
    const rs::u8* npcLoginScreenPropsById,
    rs::i32 npcLoginScreenPropsByIdLength,
    rs::i32 requiredLoginScreenPropsMask,
    rs::i32* outPacked,
    rs::i32 outPackedIntLength) {
    if (!tileRenderFlagsLevel1 || !data || flagsLength < 0 || dataLength < 0 || outPackedIntLength < 0) {
        return -1;
    }
    if (npcLoginScreenPropsByIdLength < 0) {
        return -1;
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::Vec<rs::NpcSpawn> decoded(alloc);
    const rs::Status s = rs::decodeNpcSpawnsFromBytes(
        rs::Span<const rs::u8>(tileRenderFlagsLevel1, static_cast<std::size_t>(flagsLength)),
        flagsWidth,
        borderSize,
        mapX,
        mapY,
        rs::Span<const rs::u8>(data, static_cast<std::size_t>(dataLength)),
        &decoded,
        alloc);
    if (!rs::ok(s)) {
        return -1;
    }

    const bool useLoginScreenPropsFilter =
        npcLoginScreenPropsById &&
        npcLoginScreenPropsByIdLength > 0 &&
        requiredLoginScreenPropsMask != 0;

    rs::i32 count = 0;
    for (std::size_t i = 0; i < decoded.size(); i++) {
        const rs::NpcSpawn& spawn = decoded[i];
        if (useLoginScreenPropsFilter) {
            const rs::i32 id = spawn.id;
            if (id < 0 || id >= npcLoginScreenPropsByIdLength) {
                continue;
            }
            const rs::i32 loginScreenProps = static_cast<rs::i32>(npcLoginScreenPropsById[id]);
            if ((loginScreenProps & requiredLoginScreenPropsMask) == 0) {
                continue;
            }
        }
        count++;
    }

    const rs::i32 requiredPackedInts = count * 4;
    if (!outPacked) {
        return count;
    }
    if (outPackedIntLength < requiredPackedInts) {
        return -2;
    }

    rs::i32 outCount = 0;
    for (std::size_t i = 0; i < decoded.size(); i++) {
        const rs::NpcSpawn& spawn = decoded[i];
        if (useLoginScreenPropsFilter) {
            const rs::i32 id = spawn.id;
            if (id < 0 || id >= npcLoginScreenPropsByIdLength) {
                continue;
            }
            const rs::i32 loginScreenProps = static_cast<rs::i32>(npcLoginScreenPropsById[id]);
            if ((loginScreenProps & requiredLoginScreenPropsMask) == 0) {
                continue;
            }
        }

        const rs::i32 off = outCount * 4;
        outPacked[off + 0] = spawn.id;
        outPacked[off + 1] = spawn.x;
        outPacked[off + 2] = spawn.y;
        outPacked[off + 3] = spawn.level;
        outCount++;
    }
    return outCount;
}

static rs::i32 roundHeightOffsetDiv8Js(rs::i32 heightOffset) noexcept {
    if (heightOffset >= 0) {
        return (heightOffset + 4) / 8;
    }
    return -(((-heightOffset) + 3) / 8);
}

RS_WASM_KEEPALIVE rs::i32 rs_pack_draw_commands(
    const rs::i32* cmdOffsets,
    const rs::i32* cmdElements,
    const rs::i32* cmdInstanceCounts,
    rs::i32 cmdCount,
    const rs::i32* packedInstances,
    rs::i32 packedInstancesLength,
    rs::i32* outDrawRanges,
    rs::i32 outDrawRangesLength,
    rs::u16* outModelInfoTexture,
    rs::i32 outModelInfoTextureLength) {
    if (cmdCount < 0 || packedInstancesLength < 0 || outDrawRangesLength < 0 || outModelInfoTextureLength < 0) {
        return -1;
    }
    if (!outModelInfoTexture) {
        return -1;
    }
    if (cmdCount > 0 && (!cmdOffsets || !cmdElements || !cmdInstanceCounts)) {
        return -1;
    }
    if (outDrawRangesLength > 0 && !outDrawRanges) {
        return -1;
    }
    if (packedInstancesLength > 0 && !packedInstances) {
        return -1;
    }

    rs::i32 totalInstances = 0;
    for (rs::i32 i = 0; i < cmdCount; i++) {
        const rs::i32 n = cmdInstanceCounts[i];
        if (n < 0) {
            return -1;
        }
        totalInstances += n;
    }

    const rs::i32 expectedPackedInstancesLength = totalInstances * 8;
    if (packedInstancesLength != expectedPackedInstancesLength) {
        return -2;
    }

    const rs::i32 expectedDrawRangesLength = cmdCount * 3;
    if (outDrawRangesLength != expectedDrawRangesLength) {
        return -2;
    }

    const rs::i32 dataLengthRounded = ((cmdCount * 4 + totalInstances + 15) / 16) * 16;
    const rs::i32 expectedModelInfoTextureLength = (dataLengthRounded > 16 ? dataLengthRounded : 16) * 4;
    if (outModelInfoTextureLength != expectedModelInfoTextureLength) {
        return -2;
    }

    for (rs::i32 i = 0; i < outModelInfoTextureLength; i++) {
        outModelInfoTexture[i] = 0;
    }

    for (rs::i32 i = 0; i < cmdCount; i++) {
        const rs::i32 outOff = i * 3;
        outDrawRanges[outOff + 0] = cmdOffsets[i];
        outDrawRanges[outOff + 1] = cmdElements[i];
        outDrawRanges[outOff + 2] = cmdInstanceCounts[i];
    }

    rs::i32 dataOffset = 0;
    for (rs::i32 i = 0; i < cmdCount; i++) {
        outModelInfoTexture[i * 4] = static_cast<rs::u16>(cmdCount + dataOffset);
        dataOffset += cmdInstanceCounts[i];
    }

    for (rs::i32 i = 0; i < totalInstances; i++) {
        const rs::i32 inOff = i * 8;
        const rs::i32 sceneX = packedInstances[inOff + 0];
        const rs::i32 sceneZ = packedInstances[inOff + 1];
        const rs::i32 heightOffset = packedInstances[inOff + 2];
        const rs::i32 level = packedInstances[inOff + 3];
        const rs::i32 contourGround = packedInstances[inOff + 4];
        const rs::i32 priority = packedInstances[inOff + 5];
        const rs::i32 interactType = packedInstances[inOff + 6];
        const rs::i32 interactId = packedInstances[inOff + 7];

        const rs::i32 outOff = cmdCount * 4 + i * 4;
        outModelInfoTexture[outOff + 0] = static_cast<rs::u16>(sceneX | (level << 14));
        outModelInfoTexture[outOff + 1] = static_cast<rs::u16>(sceneZ | (contourGround << 14));
        const rs::i32 packed3 =
            (priority & 0x7) |
            ((interactId >> 16) << 3) |
            (interactType << 4) |
            (roundHeightOffsetDiv8Js(heightOffset) << 6);
        outModelInfoTexture[outOff + 2] = static_cast<rs::u16>(packed3);
        outModelInfoTexture[outOff + 3] = static_cast<rs::u16>(interactId);
    }

    return 1;
}

} // extern "C"
