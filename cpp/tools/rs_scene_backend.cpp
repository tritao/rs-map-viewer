#include "../rs/cache/CacheInfo.hpp"
#include "../rs/core/Allocator.hpp"
#include "../rs/core/Result.hpp"
#include "../rs/core/Span.hpp"
#include "../rs/core/Status.hpp"
#include "../rs/core/Vec.hpp"
#include "../rs/map/LocPlacementsDecode.hpp"
#include "../rs/scene/SceneBuildStages.hpp"
#include "../rs/scene/SceneData.hpp"
#include "../rs/types.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define RS_WASM_KEEPALIVE EMSCRIPTEN_KEEPALIVE
#else
#define RS_WASM_KEEPALIVE
#endif

namespace {

static constexpr rs::i32 RS_SCENE_CAP_BUILD = 1 << 0;
static constexpr rs::i32 RS_SCENE_LEVELS = 4;
static constexpr rs::i32 RS_LOC_PLACEMENT_STRIDE = 7;

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

} // namespace

extern "C" {

RS_WASM_KEEPALIVE rs::i32 rs_scene_bridge_abi_version() {
    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_scene_bridge_capabilities() {
    return RS_SCENE_CAP_BUILD;
}

RS_WASM_KEEPALIVE rs::i32 rs_build_scene_data_from_map_squares(
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
