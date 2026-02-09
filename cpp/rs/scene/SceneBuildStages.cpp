#include "SceneBuildStages.hpp"

#include "../cache/CacheInfo.hpp"
#include "../config/loctype/LocType.hpp"
#include "../map/LocPlacementsDecode.hpp"
#include "../map/TerrainSquareDecode.hpp"

namespace rs {

namespace {

constexpr i32 kMapSquareSize = TerrainConstants::MAP_SQUARE_SIZE;
constexpr i16 kWaterOverlayIdPlusOne = 6; // SceneBuilder.WATER_OVERLAY_ID + 1

constexpr u8 kRenderBlocked = static_cast<u8>(SceneTileRenderFlag::Blocked);
constexpr u8 kRenderBridge = static_cast<u8>(SceneTileRenderFlag::Bridge);
constexpr u8 kRenderOnLower = static_cast<u8>(SceneTileRenderFlag::RenderOnLowerLevel);

static i32 floorDiv(i32 n, i32 d) noexcept {
    const i32 q = n / d;
    const i32 r = n % d;
    if (r != 0 && ((r < 0) != (d < 0))) {
        return static_cast<i32>(q - 1);
    }
    return q;
}

static i32 ceilDiv(i32 n, i32 d) noexcept {
    const i32 q = n / d;
    const i32 r = n % d;
    if (r != 0 && ((r < 0) == (d < 0))) {
        return static_cast<i32>(q + 1);
    }
    return q;
}

static bool isNewTerrainFormat(const SceneRuntimeServices& services) noexcept {
    if (!services.cacheInfo) {
        return false;
    }
    return services.cacheInfo->game == GameType::Oldschool && services.cacheInfo->revision >= 209;
}

static bool shouldFillEmptyTerrainWithWater(const SceneRuntimeServices& services) noexcept {
    if (!services.cacheInfo) {
        return false;
    }
    return services.cacheInfo->game == GameType::Runescape && services.cacheInfo->revision <= 225;
}

static void applyTerrainSquareToScene(
    SceneData& scene,
    const TerrainSquare& decoded,
    i32 offsetX,
    i32 offsetY) noexcept {
    for (i32 level = 0; level < TerrainConstants::MAX_LEVELS; level++) {
        for (i32 x = 0; x < TerrainConstants::MAP_SQUARE_SIZE; x++) {
            for (i32 y = 0; y < TerrainConstants::MAP_SQUARE_SIZE; y++) {
                const i32 sceneX = x + offsetX;
                const i32 sceneY = y + offsetY;
                if (!scene.isWithinBounds(level, sceneX, sceneY)) {
                    continue;
                }
                scene.height(level, sceneX, sceneY) = decoded.height(level, x, y);
                scene.renderFlag(level, sceneX, sceneY) = decoded.renderFlags(level, x, y);
                scene.underlay(level, sceneX, sceneY) = decoded.underlay(level, x, y);
                scene.overlay(level, sceneX, sceneY) = decoded.overlay(level, x, y);
                scene.shape(level, sceneX, sceneY) = decoded.shape(level, x, y);
                scene.rotation(level, sceneX, sceneY) = decoded.rotation(level, x, y);
            }
        }
    }

    // Terrain collision: blocked-by-floor with bridge-adjusted real level.
    for (i32 level = 0; level < TerrainConstants::MAX_LEVELS; level++) {
        for (i32 x = 0; x < TerrainConstants::MAP_SQUARE_SIZE; x++) {
            for (i32 y = 0; y < TerrainConstants::MAP_SQUARE_SIZE; y++) {
                if ((decoded.renderFlags(level, x, y) & kRenderBlocked) == 0) {
                    continue;
                }
                const i32 sceneX = x + offsetX;
                const i32 sceneY = y + offsetY;
                i32 realLevel = level;
                if (scene.levels > 1 && (decoded.renderFlags(1, x, y) & kRenderBridge) != 0) {
                    realLevel = level - 1;
                }
                if (realLevel >= 0 && scene.isWithinBounds(realLevel, sceneX, sceneY)) {
                    scene.blocked(realLevel, sceneX, sceneY) = 1;
                }
            }
        }
    }
}

static void loadEmptyTerrain(
    const SceneRuntimeServices& services,
    SceneData& scene,
    i32 level,
    i32 tileX,
    i32 tileY,
    i32 sizeX,
    i32 sizeY) noexcept {
    const bool fillEmptyTerrain = shouldFillEmptyTerrainWithWater(services);

    for (i32 ty = tileY; ty < tileY + sizeY; ty++) {
        for (i32 tx = tileX; tx < tileX + sizeX; tx++) {
            if (tx >= 0 && tx < scene.sizeX && ty >= 0 && ty < scene.sizeY) {
                if (level == 0) {
                    scene.height(level, tx, ty) = 0;
                    if (fillEmptyTerrain) {
                        scene.overlay(level, tx, ty) = kWaterOverlayIdPlusOne;
                    }
                } else {
                    scene.height(level, tx, ty) = scene.height(level - 1, tx, ty) - TerrainConstants::UNITS_LEVEL_HEIGHT;
                }
            }
        }
    }

    if (tileX > 0 && scene.sizeX > tileX) {
        for (i32 ty = tileY + 1; ty < tileY + sizeY; ty++) {
            if (ty >= 0 && ty < scene.sizeY) {
                scene.height(level, tileX, ty) = scene.height(level, tileX - 1, ty);
            }
        }
    }
    if (tileY > 0 && scene.sizeY > tileY) {
        for (i32 tx = tileX + 1; tx < tileX + sizeX; tx++) {
            if (tx >= 0 && tx < scene.sizeX) {
                scene.height(level, tx, tileY) = scene.height(level, tx, tileY - 1);
            }
        }
    }
    if (tileX >= 0 && tileY >= 0 && tileX < scene.sizeX && tileY < scene.sizeY) {
        if (level != 0) {
            if (tileX > 0 && scene.height(level, tileX - 1, tileY) != scene.height(level - 1, tileX - 1, tileY)) {
                scene.height(level, tileX, tileY) = scene.height(level, tileX - 1, tileY);
            } else if (tileY <= 0 || scene.height(level, tileX, tileY - 1) == scene.height(level - 1, tileX, tileY - 1)) {
                if (tileX > 0 && tileY > 0 &&
                    scene.height(level, tileX - 1, tileY - 1) != scene.height(level - 1, tileX - 1, tileY - 1)) {
                    scene.height(level, tileX, tileY) = scene.height(level, tileX - 1, tileY - 1);
                }
            } else {
                scene.height(level, tileX, tileY) = scene.height(level, tileX, tileY - 1);
            }
        } else if (tileX > 0 && scene.height(level, tileX - 1, tileY) != 0) {
            scene.height(level, tileX, tileY) = scene.height(level, tileX - 1, tileY);
        } else if (tileY > 0 && scene.height(level, tileX, tileY - 1) != 0) {
            scene.height(level, tileX, tileY) = scene.height(level, tileX, tileY - 1);
        } else if (tileX > 0 && tileY > 0 && scene.height(level, tileX - 1, tileY - 1) != 0) {
            scene.height(level, tileX, tileY) = scene.height(level, tileX - 1, tileY - 1);
        }
    }
}

} // namespace

SceneBuildMapBounds computeSceneBuildMapBounds(i32 baseX, i32 baseY, i32 sizeX, i32 sizeY) noexcept {
    SceneBuildMapBounds out{};
    out.mapStartX = floorDiv(baseX, kMapSquareSize);
    out.mapStartY = floorDiv(baseY, kMapSquareSize);
    out.mapEndX = ceilDiv(static_cast<i32>(baseX + sizeX), kMapSquareSize);
    out.mapEndY = ceilDiv(static_cast<i32>(baseY + sizeY), kMapSquareSize);
    return out;
}

SceneBuildContext createSceneBuildContext(
    i32 baseX,
    i32 baseY,
    i32 sizeX,
    i32 sizeY,
    bool smoothUnderlays,
    SceneLocLoadType locLoadType) noexcept {
    SceneBuildContext out{};
    out.baseX = baseX;
    out.baseY = baseY;
    out.sizeX = sizeX;
    out.sizeY = sizeY;
    out.smoothUnderlays = smoothUnderlays;
    out.locLoadType = locLoadType;
    out.bounds = computeSceneBuildMapBounds(baseX, baseY, sizeX, sizeY);
    return out;
}

Status decodeTerrainStage(
    const SceneRuntimeServices& services,
    const MapBytesProvider& mapBytesProvider,
    const SceneBuildContext& context,
    SceneData* scene,
    SceneBuildScratch* scratch) noexcept {
    if (!scene || !scratch) {
        return Status::InvalidArgument;
    }
    const bool newFormat = isNewTerrainFormat(services);
    for (i32 mx = context.bounds.mapStartX; mx < context.bounds.mapEndX; mx++) {
        for (i32 my = context.bounds.mapStartY; my < context.bounds.mapEndY; my++) {
            const Status s = mapBytesProvider.tryLoadTerrainBytes(mx, my, &scratch->bytes);
            if (s == Status::NotFound) {
                continue;
            }
            if (!ok(s)) {
                return s;
            }
            const i32 offsetX = mx * kMapSquareSize - context.baseX;
            const i32 offsetY = my * kMapSquareSize - context.baseY;
            const Status ds = decodeTerrainSquareFromBytesInto(
                scratch->terrain,
                Span<const u8>(scratch->bytes.data(), scratch->bytes.size()),
                newFormat,
                context.baseX + offsetX,
                context.baseY + offsetY);
            if (!ok(ds)) {
                return ds;
            }
            applyTerrainSquareToScene(*scene, scratch->terrain, offsetX, offsetY);
        }
    }
    return Status::Ok;
}

Status fillEmptyTerrainStage(
    const SceneRuntimeServices& services,
    const MapBytesProvider& mapBytesProvider,
    const SceneBuildContext& context,
    SceneData* scene) noexcept {
    if (!scene) {
        return Status::InvalidArgument;
    }
    Vec<u8> bytes(scene->allocator());
    for (i32 mx = context.bounds.mapStartX; mx < context.bounds.mapEndX; mx++) {
        for (i32 my = context.bounds.mapStartY; my < context.bounds.mapEndY; my++) {
            const Status s = mapBytesProvider.tryLoadTerrainBytes(mx, my, &bytes);
            if (ok(s)) {
                continue;
            }
            if (s != Status::NotFound) {
                return s;
            }

            const i32 endX = (mx + 1) * kMapSquareSize;
            const i32 endY = (my + 1) * kMapSquareSize;
            const i32 offsetX = mx * kMapSquareSize - context.baseX;
            const i32 offsetY = my * kMapSquareSize - context.baseY;
            const i32 tileX = (offsetX > 0) ? offsetX : 0;
            const i32 tileY = (offsetY > 0) ? offsetY : 0;
            const i32 emptySizeX = endX - context.baseX - tileX;
            const i32 emptySizeY = endY - context.baseY - tileY;
            for (i32 level = 0; level < scene->levels; level++) {
                loadEmptyTerrain(services, *scene, level, tileX, tileY, emptySizeX, emptySizeY);
            }
        }
    }
    return Status::Ok;
}

Status decodeLocsStage(
    const SceneRuntimeServices& services,
    const MapBytesProvider& mapBytesProvider,
    const SceneBuildContext& context,
    SceneData* scene,
    SceneBuildScratch* scratch) noexcept {
    if (!scene || !scratch || !services.locTypes) {
        return Status::InvalidArgument;
    }

    const auto tryLoadLoc = [&services](i32 id, const LocType** out) noexcept -> Status {
        return services.locTypes->tryLoad(id, out);
    };

    for (i32 mx = context.bounds.mapStartX; mx < context.bounds.mapEndX; mx++) {
        for (i32 my = context.bounds.mapStartY; my < context.bounds.mapEndY; my++) {
            const Status s = mapBytesProvider.tryLoadLocBytes(mx, my, &scratch->bytes);
            if (s == Status::NotFound) {
                continue;
            }
            if (!ok(s)) {
                return s;
            }

            const Status ds = decodeLocPlacementsFromBytes(
                Span<const u8>(scratch->bytes.data(), scratch->bytes.size()),
                &scratch->locPlacements,
                scene->allocator());
            if (!ok(ds)) {
                return ds;
            }

            const i32 offsetX = mx * kMapSquareSize - context.baseX;
            const i32 offsetY = my * kMapSquareSize - context.baseY;
            for (std::size_t i = 0; i < scratch->locPlacements.size(); i++) {
                const LocPlacement& p = scratch->locPlacements[i];
                const i32 sceneX = p.localX + offsetX;
                const i32 sceneY = p.localY + offsetY;

                if (!(sceneX > 0 && sceneY > 0 && sceneX < scene->sizeX - 1 && sceneY < scene->sizeY - 1)) {
                    continue;
                }
                if ((scene->renderFlag(0, sceneX, sceneY) & kRenderOnLower) != 0) {
                    continue;
                }

                const LocType* locType = nullptr;
                if (!ok(services.locTypes->tryLoad(p.id, &locType)) || !locType) {
                    continue;
                }
                const LocType* resolved = locType;
                if (services.varProvider && !locType->transforms.empty()) {
                    const LocType* transformed = locType->transform(*services.varProvider, tryLoadLoc);
                    if (transformed) {
                        resolved = transformed;
                    }
                }

                SceneLocPlacement placed{};
                placed.originalId = p.id;
                placed.resolvedId = resolved ? resolved->id : p.id;
                placed.level = p.level;
                placed.tileX = sceneX;
                placed.tileY = sceneY;
                placed.type = p.type;
                placed.rotation = p.rotation;
                auto rr = scene->locPlacements.pushBack(placed);
                if (!rr.isOk()) {
                    return rr.status();
                }
            }
        }
    }
    return Status::Ok;
}

Status finalizeSceneStage(
    const SceneRuntimeServices& services,
    const SceneBuildContext& context,
    SceneData* scene) noexcept {
    (void)services;
    if (!scene) {
        return Status::InvalidArgument;
    }
    for (i32 level = 0; level < scene->levels; level++) {
        for (i32 x = 0; x < scene->sizeX; x++) {
            for (i32 y = 0; y < scene->sizeY; y++) {
                i32 minLevel = level;
                if ((scene->renderFlag(level, x, y) & kRenderOnLower) != 0) {
                    minLevel = 0;
                } else if (level > 0 && (scene->renderFlag(level, x, y) & kRenderBridge) != 0) {
                    minLevel = level - 1;
                }
                scene->minLevel(level, x, y) = static_cast<u8>(minLevel);
            }
        }
    }
    (void)context;
    return Status::Ok;
}

} // namespace rs
