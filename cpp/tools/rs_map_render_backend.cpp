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
static constexpr rs::i32 RS_MAP_RENDER_CAP_SCENE_PACK = 1 << 3;
static constexpr rs::i32 RS_DRAW_BUCKET_COUNT = 8;

RS_WASM_KEEPALIVE rs::i32 rs_map_render_bridge_abi_version() {
    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_map_render_bridge_capabilities() {
    return RS_MAP_RENDER_CAP_HEIGHTMAP |
           RS_MAP_RENDER_CAP_NPC_DECODE |
           RS_MAP_RENDER_CAP_SCENE_PACK;
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

static rs::i32 modelInfoTextureLengthFromCounts(rs::i32 cmdCount, rs::i32 instanceCount) noexcept {
    const rs::i32 dataLengthRounded = ((cmdCount * 4 + instanceCount + 15) / 16) * 16;
    return (dataLengthRounded > 16 ? dataLengthRounded : 16) * 4;
}

RS_WASM_KEEPALIVE rs::i32 rs_pack_scene_staging(
    const rs::i32* tileHeights,
    rs::i32 levels,
    rs::i32 sizeX,
    rs::i32 sizeY,
    rs::i32 unitsTileHeightBasis,
    const rs::i32* bucketCmdCounts,
    const rs::i32* cmdOffsets,
    const rs::i32* cmdElements,
    const rs::i32* cmdInstanceCounts,
    rs::i32 totalCmdCount,
    const rs::i32* packedInstances,
    rs::i32 packedInstancesLength,
    rs::i32* outDrawRanges,
    rs::i32 outDrawRangesLength,
    rs::u16* outModelInfoTextureConcat,
    rs::i32 outModelInfoTextureConcatLength,
    rs::i16* outHeightMap,
    rs::i32 outHeightMapLength) {
    if (!tileHeights || !bucketCmdCounts || !outModelInfoTextureConcat || !outHeightMap) {
        return -1;
    }
    if (levels <= 0 || sizeX <= 0 || sizeY <= 0 || unitsTileHeightBasis <= 0) {
        return -1;
    }
    if (totalCmdCount < 0 || packedInstancesLength < 0 || outDrawRangesLength < 0 || outModelInfoTextureConcatLength < 0) {
        return -1;
    }
    if (totalCmdCount > 0 && (!cmdOffsets || !cmdElements || !cmdInstanceCounts)) {
        return -1;
    }
    if (outDrawRangesLength > 0 && !outDrawRanges) {
        return -1;
    }
    if (packedInstancesLength > 0 && !packedInstances) {
        return -1;
    }

    const rs::i32 expectedHeightMapLength = levels * sizeX * sizeY;
    if (outHeightMapLength != expectedHeightMapLength) {
        return -2;
    }
    if (rs_heightmap_from_scene_tile_heights(
            tileHeights,
            levels,
            sizeX,
            sizeY,
            unitsTileHeightBasis,
            outHeightMap,
            outHeightMapLength) != 1) {
        return -1;
    }

    rs::i32 expectedTotalCmdCount = 0;
    for (rs::i32 bucket = 0; bucket < RS_DRAW_BUCKET_COUNT; bucket++) {
        const rs::i32 n = bucketCmdCounts[bucket];
        if (n < 0) {
            return -1;
        }
        expectedTotalCmdCount += n;
    }
    if (expectedTotalCmdCount != totalCmdCount) {
        return -2;
    }

    const rs::i32 expectedDrawRangesLength = totalCmdCount * 3;
    if (outDrawRangesLength != expectedDrawRangesLength) {
        return -2;
    }

    rs::i32 cmdCursor = 0;
    rs::i32 instanceCursor = 0;
    rs::i32 modelInfoCursor = 0;

    for (rs::i32 bucket = 0; bucket < RS_DRAW_BUCKET_COUNT; bucket++) {
        const rs::i32 cmdCount = bucketCmdCounts[bucket];
        rs::i32 bucketInstanceCount = 0;
        for (rs::i32 i = 0; i < cmdCount; i++) {
            const rs::i32 n = cmdInstanceCounts[cmdCursor + i];
            if (n < 0) {
                return -1;
            }
            bucketInstanceCount += n;
        }

        const rs::i32 bucketModelInfoLength = modelInfoTextureLengthFromCounts(cmdCount, bucketInstanceCount);
        if (modelInfoCursor + bucketModelInfoLength > outModelInfoTextureConcatLength) {
            return -2;
        }
        for (rs::i32 i = 0; i < bucketModelInfoLength; i++) {
            outModelInfoTextureConcat[modelInfoCursor + i] = 0;
        }

        rs::i32 dataOffset = 0;
        for (rs::i32 i = 0; i < cmdCount; i++) {
            const rs::i32 cmdIndex = cmdCursor + i;
            const rs::i32 outDrawOff = cmdIndex * 3;
            outDrawRanges[outDrawOff + 0] = cmdOffsets[cmdIndex];
            outDrawRanges[outDrawOff + 1] = cmdElements[cmdIndex];
            outDrawRanges[outDrawOff + 2] = cmdInstanceCounts[cmdIndex];

            outModelInfoTextureConcat[modelInfoCursor + i * 4] = static_cast<rs::u16>(cmdCount + dataOffset);
            dataOffset += cmdInstanceCounts[cmdIndex];
        }

        for (rs::i32 i = 0; i < bucketInstanceCount; i++) {
            const rs::i32 inOff = (instanceCursor + i) * 8;
            if (inOff + 7 >= packedInstancesLength) {
                return -2;
            }
            const rs::i32 sceneX = packedInstances[inOff + 0];
            const rs::i32 sceneZ = packedInstances[inOff + 1];
            const rs::i32 heightOffset = packedInstances[inOff + 2];
            const rs::i32 level = packedInstances[inOff + 3];
            const rs::i32 contourGround = packedInstances[inOff + 4];
            const rs::i32 priority = packedInstances[inOff + 5];
            const rs::i32 interactType = packedInstances[inOff + 6];
            const rs::i32 interactId = packedInstances[inOff + 7];

            const rs::i32 outOff = modelInfoCursor + cmdCount * 4 + i * 4;
            outModelInfoTextureConcat[outOff + 0] = static_cast<rs::u16>(sceneX | (level << 14));
            outModelInfoTextureConcat[outOff + 1] = static_cast<rs::u16>(sceneZ | (contourGround << 14));
            const rs::i32 packed3 =
                (priority & 0x7) |
                ((interactId >> 16) << 3) |
                (interactType << 4) |
                (roundHeightOffsetDiv8Js(heightOffset) << 6);
            outModelInfoTextureConcat[outOff + 2] = static_cast<rs::u16>(packed3);
            outModelInfoTextureConcat[outOff + 3] = static_cast<rs::u16>(interactId);
        }

        cmdCursor += cmdCount;
        instanceCursor += bucketInstanceCount;
        modelInfoCursor += bucketModelInfoLength;
    }

    if (cmdCursor != totalCmdCount) {
        return -2;
    }
    if (instanceCursor * 8 != packedInstancesLength) {
        return -2;
    }
    if (modelInfoCursor != outModelInfoTextureConcatLength) {
        return -2;
    }

    return 1;
}

} // extern "C"
