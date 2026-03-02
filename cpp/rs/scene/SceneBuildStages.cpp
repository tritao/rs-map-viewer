#include "SceneBuildStages.hpp"

#include <cmath>

#include "../cache/CacheInfo.hpp"
#include "../config/loctype/LocType.hpp"
#include "../map/LocPlacementsDecode.hpp"
#include "../map/TerrainSquareDecode.hpp"
#include "../util/ColorUtil.hpp"

namespace rs {

namespace {

constexpr i32 kMapSquareSize = TerrainConstants::MAP_SQUARE_SIZE;
constexpr i16 kWaterOverlayIdPlusOne = 6; // SceneBuilder.WATER_OVERLAY_ID + 1

constexpr u8 kRenderBlocked = static_cast<u8>(SceneTileRenderFlag::Blocked);
constexpr u8 kRenderBridge = static_cast<u8>(SceneTileRenderFlag::Bridge);
constexpr u8 kRenderOnLower = static_cast<u8>(SceneTileRenderFlag::RenderOnLowerLevel);
constexpr i32 kBlendRadius = 5; // SceneBuilder.BLEND_RADIUS

constexpr i32 kLightDirX = -50;
constexpr i32 kLightDirY = -10;
constexpr i32 kLightDirZ = -50;
constexpr i32 kLightIntensityBase = 96;
constexpr i32 kLightIntensityFactor = 768;
constexpr i32 kHeightScale = 65536;

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

static i32 mapSquareId(i32 mapX, i32 mapY) noexcept { return (mapX << 8) + mapY; }

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

static Status blendUnderlaysForLevel(
    const SceneRuntimeServices& services,
    SceneData& scene,
    i32 level,
    Vec<i32>* outColors) noexcept {
    if (!outColors) {
        return Status::InvalidArgument;
    }
    outColors->clear();
    auto rr = outColors->resize(static_cast<std::size_t>(scene.sizeX) * static_cast<std::size_t>(scene.sizeY));
    if (!rr.isOk()) {
        return rr.status();
    }
    for (std::size_t i = 0; i < outColors->size(); i++) {
        (*outColors)[i] = -1;
    }

    if (!services.underlayTypes) {
        return Status::Ok;
    }

    const i32 maxSize = (scene.sizeX > scene.sizeY) ? scene.sizeX : scene.sizeY;
    Vec<i32> hues(scene.allocator());
    Vec<i32> sats(scene.allocator());
    Vec<i32> light(scene.allocator());
    Vec<i32> mul(scene.allocator());
    Vec<i32> num(scene.allocator());

    rr = hues.resize(static_cast<std::size_t>(maxSize));
    if (!rr.isOk()) return rr.status();
    rr = sats.resize(static_cast<std::size_t>(maxSize));
    if (!rr.isOk()) return rr.status();
    rr = light.resize(static_cast<std::size_t>(maxSize));
    if (!rr.isOk()) return rr.status();
    rr = mul.resize(static_cast<std::size_t>(maxSize));
    if (!rr.isOk()) return rr.status();
    rr = num.resize(static_cast<std::size_t>(maxSize));
    if (!rr.isOk()) return rr.status();

    for (i32 i = 0; i < maxSize; i++) {
        hues[static_cast<std::size_t>(i)] = 0;
        sats[static_cast<std::size_t>(i)] = 0;
        light[static_cast<std::size_t>(i)] = 0;
        mul[static_cast<std::size_t>(i)] = 0;
        num[static_cast<std::size_t>(i)] = 0;
    }

    const i32 blendStartX = -kBlendRadius;
    const i32 blendStartY = -kBlendRadius;
    const i32 blendEndX = scene.sizeX + kBlendRadius;
    const i32 blendEndY = scene.sizeY + kBlendRadius;

    for (i32 xi = blendStartX; xi < blendEndX; xi++) {
        for (i32 yi = 0; yi < scene.sizeY; yi++) {
            const i32 xEast = xi + kBlendRadius;
            if (xEast >= 0 && xEast < scene.sizeX) {
                const i32 underlayId = static_cast<i32>(scene.underlay(level, xEast, yi));
                if (underlayId > 0) {
                    const UnderlayFloorType* underlay = nullptr;
                    const Status s = services.underlayTypes->tryLoad(underlayId - 1, &underlay);
                    if (ok(s) && underlay) {
                        hues[static_cast<std::size_t>(yi)] += underlay->hue;
                        sats[static_cast<std::size_t>(yi)] += underlay->saturation;
                        light[static_cast<std::size_t>(yi)] += underlay->lightness;
                        mul[static_cast<std::size_t>(yi)] += underlay->hueMultiplier;
                        num[static_cast<std::size_t>(yi)]++;
                    }
                }
            }
            const i32 xWest = xi - kBlendRadius;
            if (xWest >= 0 && xWest < scene.sizeX) {
                const i32 underlayId = static_cast<i32>(scene.underlay(level, xWest, yi));
                if (underlayId > 0) {
                    const UnderlayFloorType* underlay = nullptr;
                    const Status s = services.underlayTypes->tryLoad(underlayId - 1, &underlay);
                    if (ok(s) && underlay) {
                        hues[static_cast<std::size_t>(yi)] -= underlay->hue;
                        sats[static_cast<std::size_t>(yi)] -= underlay->saturation;
                        light[static_cast<std::size_t>(yi)] -= underlay->lightness;
                        mul[static_cast<std::size_t>(yi)] -= underlay->hueMultiplier;
                        num[static_cast<std::size_t>(yi)]--;
                    }
                }
            }
        }

        if (xi < 0 || xi >= scene.sizeX) {
            continue;
        }

        i32 runningHues = 0;
        i32 runningSat = 0;
        i32 runningLight = 0;
        i32 runningMultiplier = 0;
        i32 runningNumber = 0;

        for (i32 yi = blendStartY; yi < blendEndY; yi++) {
            const i32 yNorth = yi + kBlendRadius;
            if (yNorth >= 0 && yNorth < scene.sizeY) {
                runningHues += hues[static_cast<std::size_t>(yNorth)];
                runningSat += sats[static_cast<std::size_t>(yNorth)];
                runningLight += light[static_cast<std::size_t>(yNorth)];
                runningMultiplier += mul[static_cast<std::size_t>(yNorth)];
                runningNumber += num[static_cast<std::size_t>(yNorth)];
            }
            const i32 ySouth = yi - kBlendRadius;
            if (ySouth >= 0 && ySouth < scene.sizeY) {
                runningHues -= hues[static_cast<std::size_t>(ySouth)];
                runningSat -= sats[static_cast<std::size_t>(ySouth)];
                runningLight -= light[static_cast<std::size_t>(ySouth)];
                runningMultiplier -= mul[static_cast<std::size_t>(ySouth)];
                runningNumber -= num[static_cast<std::size_t>(ySouth)];
            }

            if (yi < 0 || yi >= scene.sizeY) {
                continue;
            }

            const i32 underlayId = static_cast<i32>(scene.underlay(level, xi, yi));
            if (underlayId <= 0 || runningMultiplier == 0 || runningNumber == 0) {
                continue;
            }

            const i32 avgHue = static_cast<i32>((static_cast<i64>(runningHues) * 256) / runningMultiplier);
            const i32 avgSat = static_cast<i32>(runningSat / runningNumber);
            const i32 avgLight = static_cast<i32>(runningLight / runningNumber);
            (*outColors)[static_cast<std::size_t>(xi) * static_cast<std::size_t>(scene.sizeY) + static_cast<std::size_t>(yi)] =
                packHsl(avgHue, avgSat, avgLight);
        }
    }

    return Status::Ok;
}

static void calculateTileLightsForLevel(SceneData& scene, i32 level) noexcept {
    const i32 lightMagnitude = static_cast<i32>(
        std::sqrt(static_cast<double>(kLightDirX * kLightDirX + kLightDirY * kLightDirY + kLightDirZ * kLightDirZ)));
    const i32 lightIntensityProduct = lightMagnitude * kLightIntensityFactor;
    const i32 lightIntensity = lightIntensityProduct >> 8;
    if (lightIntensity == 0) {
        return;
    }

    for (i32 x = 0; x < scene.sizeX; x++) {
        for (i32 y = 0; y < scene.sizeY; y++) {
            scene.lightValue(level, x, y) = 0;
        }
    }

    for (i32 x = 1; x < scene.sizeX - 1; x++) {
        for (i32 y = 1; y < scene.sizeY - 1; y++) {
            const i32 heightDeltaX = scene.height(level, x + 1, y) - scene.height(level, x - 1, y);
            const i32 heightDeltaY = scene.height(level, x, y + 1) - scene.height(level, x, y - 1);

            // TS uses Number (double) math here; keep the intermediate in i64 to avoid i32 overflow.
            const i64 sumSquares =
                static_cast<i64>(heightDeltaY) * static_cast<i64>(heightDeltaY) +
                static_cast<i64>(heightDeltaX) * static_cast<i64>(heightDeltaX) +
                static_cast<i64>(kHeightScale);
            const i32 tileNormalLength = static_cast<i32>(
                std::sqrt(static_cast<double>(sumSquares)));
            if (tileNormalLength <= 0) {
                continue;
            }
            const i32 normalizedTileNormalX = static_cast<i32>((heightDeltaX * 256) / tileNormalLength);
            const i32 normalizedTileNormalY = static_cast<i32>(kHeightScale / tileNormalLength);
            const i32 normalizedTileNormalZ = static_cast<i32>((heightDeltaY * 256) / tileNormalLength);
            const i32 dot = normalizedTileNormalX * kLightDirX +
                normalizedTileNormalY * kLightDirY +
                normalizedTileNormalZ * kLightDirZ;
            const double lit = static_cast<double>(dot) / static_cast<double>(lightIntensity) +
                static_cast<double>(kLightIntensityBase);
            const i32 sunLight = static_cast<i32>(std::trunc(lit));

            const i32 lightOcclusion =
                (static_cast<i32>(scene.lightOcclusion(level, x - 1, y)) >> 2) +
                (static_cast<i32>(scene.lightOcclusion(level, x, y - 1)) >> 2) +
                (static_cast<i32>(scene.lightOcclusion(level, x + 1, y)) >> 3) +
                (static_cast<i32>(scene.lightOcclusion(level, x, y + 1)) >> 3) +
                (static_cast<i32>(scene.lightOcclusion(level, x, y)) >> 1);

            const i32 shadedLight = sunLight - lightOcclusion;
            const u16 wrapped = static_cast<u16>(static_cast<u32>(shadedLight) & 0xFFFFu);
            scene.lightValue(level, x, y) = static_cast<i16>(wrapped);
        }
    }
}

static Status buildFinalizeSummaries(
    const SceneRuntimeServices& services,
    SceneData* scene) noexcept {
    if (!scene) {
        return Status::InvalidArgument;
    }
    Vec<i32> blended(scene->allocator());
    for (i32 level = 0; level < scene->levels; level++) {
        const Status bs = blendUnderlaysForLevel(services, *scene, level, &blended);
        if (!ok(bs)) {
            return bs;
        }
        calculateTileLightsForLevel(*scene, level);
        for (i32 x = 0; x < scene->sizeX; x++) {
            for (i32 y = 0; y < scene->sizeY; y++) {
                const std::size_t idx = static_cast<std::size_t>(x) * static_cast<std::size_t>(scene->sizeY) + static_cast<std::size_t>(y);
                scene->blendedUnderlay(level, x, y) = blended[idx];
                scene->modelPresent(level, x, y) = 0;
                if (x <= 0 || y <= 0 || x >= scene->sizeX - 1 || y >= scene->sizeY - 1) {
                    continue;
                }
                const i32 underlayId = static_cast<i32>(scene->underlay(level, x, y)) - 1;
                const i32 overlayId = static_cast<i32>(scene->overlay(level, x, y)) - 1;
                if (underlayId != -1 || overlayId != -1) {
                    scene->modelPresent(level, x, y) = 1;
                }
            }
        }
    }
    return Status::Ok;
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
    SceneLocLoadType locLoadType) noexcept {
    SceneBuildContext out{};
    out.baseX = baseX;
    out.baseY = baseY;
    out.sizeX = sizeX;
    out.sizeY = sizeY;
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
    scratch->emptyTerrainMapIds.clear();
    const bool newFormat = isNewTerrainFormat(services);
    for (i32 mx = context.bounds.mapStartX; mx < context.bounds.mapEndX; mx++) {
        for (i32 my = context.bounds.mapStartY; my < context.bounds.mapEndY; my++) {
            const Status s = mapBytesProvider.tryLoadTerrainBytes(mx, my, &scratch->bytes);
            if (s == Status::NotFound) {
                auto rr = scratch->emptyTerrainMapIds.pushBack(mapSquareId(mx, my));
                if (!rr.isOk()) {
                    return rr.status();
                }
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
    const SceneBuildContext& context,
    SceneData* scene,
    SceneBuildScratch* scratch) noexcept {
    if (!scene || !scratch) {
        return Status::InvalidArgument;
    }
    const auto isMissingTerrain = [&scratch](i32 mx, i32 my) noexcept -> bool {
        const i32 id = mapSquareId(mx, my);
        for (std::size_t i = 0; i < scratch->emptyTerrainMapIds.size(); i++) {
            if (scratch->emptyTerrainMapIds[i] == id) {
                return true;
            }
        }
        return false;
    };
    for (i32 mx = context.bounds.mapStartX; mx < context.bounds.mapEndX; mx++) {
        for (i32 my = context.bounds.mapStartY; my < context.bounds.mapEndY; my++) {
            if (!isMissingTerrain(mx, my)) {
                continue;
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

    const std::size_t tileCount =
        static_cast<std::size_t>(scene->levels) *
        static_cast<std::size_t>(scene->sizeX) *
        static_cast<std::size_t>(scene->sizeY);

    Vec<u8> locCounts(scene->allocator());
    Vec<i32> floorSlots(scene->allocator());
    Vec<i32> wallSlots0(scene->allocator());
    Vec<i32> wallSlots1(scene->allocator());
    Vec<i32> wallDecorationSlots0(scene->allocator());
    Vec<i32> wallDecorationSlots1(scene->allocator());
    Vec<i32> wallDecorDispByTile(scene->allocator());

    auto rr = locCounts.resize(tileCount);
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = floorSlots.resize(tileCount);
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = wallSlots0.resize(tileCount);
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = wallSlots1.resize(tileCount);
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = wallDecorationSlots0.resize(tileCount);
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = wallDecorationSlots1.resize(tileCount);
    if (!rr.isOk()) {
        return rr.status();
    }
    rr = wallDecorDispByTile.resize(tileCount);
    if (!rr.isOk()) {
        return rr.status();
    }

    for (std::size_t i = 0; i < tileCount; i++) {
        locCounts[i] = 0;
        floorSlots[i] = -1;
        wallSlots0[i] = -1;
        wallSlots1[i] = -1;
        wallDecorationSlots0[i] = -1;
        wallDecorationSlots1[i] = -1;
        wallDecorDispByTile[i] = LocType::DEFAULT_DECOR_DISPLACEMENT;
    }

    static constexpr i32 kDispX[4] = {1, 0, -1, 0};
    static constexpr i32 kDispY[4] = {0, -1, 0, 1};
    static constexpr i32 kDiagDispX[4] = {1, -1, -1, 1};
    static constexpr i32 kDiagDispY[4] = {-1, -1, 1, 1};

    const auto samePlacement = [](const SceneLocPlacement& a, const SceneLocPlacement& b) noexcept -> bool {
        return
            a.originalId == b.originalId &&
            a.resolvedId == b.resolvedId &&
            a.level == b.level &&
            a.tileX == b.tileX &&
            a.tileY == b.tileY &&
            a.type == b.type &&
            a.rotation == b.rotation;
    };

    const auto appendOrReplaceSingleSlot =
        [scene](Vec<i32>* slots, std::size_t tileIdx, const SceneLocPlacement& placed) noexcept -> Status {
            if (!slots || tileIdx >= slots->size()) {
                return Status::OutOfRange;
            }
            const i32 existing = (*slots)[tileIdx];
            if (existing >= 0 &&
                static_cast<std::size_t>(existing) < scene->locPlacements.size()) {
                scene->locPlacements[static_cast<std::size_t>(existing)] = placed;
                return Status::Ok;
            }
            auto rrPush = scene->locPlacements.pushBack(placed);
            if (!rrPush.isOk()) {
                return rrPush.status();
            }
            (*slots)[tileIdx] = static_cast<i32>(scene->locPlacements.size() - 1);
            return Status::Ok;
        };

    const auto appendOrReplacePairSlots =
        [scene, &samePlacement](
            Vec<i32>* slot0,
            Vec<i32>* slot1,
            std::size_t tileIdx,
            const SceneLocPlacement& placed) noexcept -> Status {
            if (!slot0 || !slot1 || tileIdx >= slot0->size() || tileIdx >= slot1->size()) {
                return Status::OutOfRange;
            }

            auto appendToSlot = [&](Vec<i32>* slotVec) noexcept -> Status {
                auto rrPush = scene->locPlacements.pushBack(placed);
                if (!rrPush.isOk()) {
                    return rrPush.status();
                }
                (*slotVec)[tileIdx] = static_cast<i32>(scene->locPlacements.size() - 1);
                return Status::Ok;
            };

            const i32 idx0 = (*slot0)[tileIdx];
            if (idx0 >= 0 && static_cast<std::size_t>(idx0) < scene->locPlacements.size()) {
                if (samePlacement(scene->locPlacements[static_cast<std::size_t>(idx0)], placed)) {
                    scene->locPlacements[static_cast<std::size_t>(idx0)] = placed;
                    return Status::Ok;
                }
            } else if (idx0 < 0) {
                return appendToSlot(slot0);
            }

            const i32 idx1 = (*slot1)[tileIdx];
            if (idx1 >= 0 && static_cast<std::size_t>(idx1) < scene->locPlacements.size()) {
                if (samePlacement(scene->locPlacements[static_cast<std::size_t>(idx1)], placed)) {
                    scene->locPlacements[static_cast<std::size_t>(idx1)] = placed;
                    return Status::Ok;
                }
                scene->locPlacements[static_cast<std::size_t>(idx1)] = placed;
                return Status::Ok;
            }

            return appendToSlot(slot1);
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
                if (!scene->isWithinBounds(p.level, sceneX, sceneY)) {
                    continue;
                }

                const LocType* locType = nullptr;
                if (!ok(services.locTypes->tryLoad(p.id, &locType)) || !locType) {
                    continue;
                }
                const LocType* resolved = locType;
                if (services.varProvider && !locType->transforms.empty()) {
                    const LocType* transformed = locType->transform(*services.varProvider, tryLoadLoc);
                    // Match TS `resolveLocTypeForPlacement`: if a transform resolves to -1/unloadable,
                    // treat it as "no loc present" instead of falling back to the base type.
                    if (!transformed) {
                        continue;
                    }
                    resolved = transformed;
                }

                i32 seqId = resolved ? resolved->seqId : -1;
                if (resolved && seqId == -1 && !resolved->randomSeqIds.empty()) {
                    seqId = resolved->randomSeqIds[0];
                }
                // Match TS SceneBuilder:
                // isEntity = seqId != -1 || resolvedTypeHasTransforms || locLoadType==NO_MODELS
                // Note: TS uses the *resolved* locType's `transforms` here (post varProvider resolution).
                const bool baseHadTransforms = locType && !locType->transforms.empty();
                const bool resolvedHasTransforms = resolved && !resolved->transforms.empty();
                (void)baseHadTransforms;
                const bool isEntity =
                    (seqId != -1) ||
                    resolvedHasTransforms ||
                    context.locLoadType == SceneLocLoadType::NoModels;

                i32 staticModelXzRadius = -1;
                if (!isEntity && context.locLoadType == SceneLocLoadType::Models) {
                    if (!services.locModels || !resolved) {
                        return Status::InvalidArgument;
                    }

                    // TS SceneBuilder uses LocModelLoader.getModel(...) for non-entity placements; if the model
                    // can't be resolved, it effectively skips adding the loc. Mirror that by validating here.
                    const Status msValidate = services.locModels->tryValidateStaticModelPlacement(
                        *resolved,
                        p.type,
                        p.rotation);
                    if (!ok(msValidate)) {
                        continue;
                    }

                    // TS SceneBuilder uses `entity.tryGetXZRadius()` to compute light occlusion for NORMAL/NORMAL_DIAGONAL
                    // locs. Mirror that by resolving the first expanded model variant's XZ radius.
                    if ((p.type == 10 || p.type == 11) && resolved->clipped) {
                        // TS `expandLocPlacementModelVariants`:
                        // NORMAL_DIAGONAL (11) uses NORMAL (10) with rotation+4 for model lookup.
                        i32 modelType = p.type;
                        i32 modelRotation = p.rotation;
                        if (p.type == 11) {
                            modelType = 10;
                            modelRotation = p.rotation + 4;
                        }

                        const Status msRadius = services.locModels->tryGetStaticModelXZRadius(
                            *resolved,
                            modelType,
                            modelRotation,
                            &staticModelXzRadius);
                        if (!ok(msRadius)) {
                            // If we can't resolve a radius, fall back to the default occlusion (15) like TS.
                            staticModelXzRadius = -1;
                        }
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
                placed.sizeX = 1;
                placed.sizeY = 1;
                placed.clipped = (resolved && resolved->clipped) ? 1 : 0;
                placed.isEntity = isEntity ? 1 : 0;
                placed.staticModelXzRadius = staticModelXzRadius;

                const bool isFloorDecoration = p.type == 22;
                const bool isWall = p.type >= 0 && p.type <= 3;
                const bool isWallDecoration = p.type >= 4 && p.type <= 8;
                const bool isLoc = p.type == 9 || p.type == 10 || p.type == 11 || (p.type >= 12 && p.type <= 21);

                if (isFloorDecoration || isWall || isWallDecoration) {
                    const std::size_t tIdx = scene->tileIdx(p.level, sceneX, sceneY);
                    if (isFloorDecoration) {
                        const Status ps = appendOrReplaceSingleSlot(&floorSlots, tIdx, placed);
                        if (!ok(ps)) {
                            return ps;
                        }
                    } else if (isWall) {
                        const Status ps = appendOrReplacePairSlots(&wallSlots0, &wallSlots1, tIdx, placed);
                        if (!ok(ps)) {
                            return ps;
                        }
                        // Mirrors TS wall tag displacement source: use the base locType id from the tag.
                        wallDecorDispByTile[tIdx] = locType->decorDisplacement;

                        // TS SceneBuilder: certain wall types call Scene.updateWallDecorationDisplacement
                        // after placement, which scales any already-present wallDecoration offsets.
                        // This is important when a wallDecoration is decoded before its wall.
                        if ((p.type == 0 || p.type == 2) &&
                            locType->decorDisplacement != LocType::DEFAULT_DECOR_DISPLACEMENT &&
                            scene->wallDecorPresent(p.level, sceneX, sceneY) != 0) {
                            scene->wallDecorOffsetX(p.level, sceneX, sceneY) =
                                (locType->decorDisplacement * scene->wallDecorOffsetX(p.level, sceneX, sceneY)) / 16;
                            scene->wallDecorOffsetZ(p.level, sceneX, sceneY) =
                                (locType->decorDisplacement * scene->wallDecorOffsetZ(p.level, sceneX, sceneY)) / 16;
                        }
                    } else {
                        const Status ps = appendOrReplacePairSlots(
                            &wallDecorationSlots0,
                            &wallDecorationSlots1,
                            tIdx,
                            placed);
                        if (!ok(ps)) {
                            return ps;
                        }

                        // Mirror TS `Scene.newWallDecoration` + `Scene.updateWallDecorationDisplacement` behavior:
                        // store the current tile WallDecoration offsets for renderer usage.
                        i32 offX = 0;
                        i32 offZ = 0;
                        const i32 rot = p.rotation & 3;
                        const i32 baseDisp = wallDecorDispByTile[tIdx];
                        if (p.type == 5) { // WALL_DECORATION_OUTSIDE
                            offX = baseDisp * kDispX[rot];
                            offZ = baseDisp * kDispY[rot];
                        } else if (p.type == 6 || p.type == 8) { // diagonal outside / diagonal double
                            const i32 d = baseDisp / 2;
                            offX = d * kDiagDispX[rot];
                            offZ = d * kDiagDispY[rot];
                        }
                        scene->wallDecorOffsetX(p.level, sceneX, sceneY) = offX;
                        scene->wallDecorOffsetZ(p.level, sceneX, sceneY) = offZ;
                        scene->wallDecorPresent(p.level, sceneX, sceneY) = 1;

                        // TS: WALL_DECORATION_INSIDE calls updateWallDecorationDisplacement after placement.
                        if (p.type == 4 &&
                            resolved && resolved->decorDisplacement != LocType::DEFAULT_DECOR_DISPLACEMENT) {
                            // offset = trunc((disp*offset)/16)
                            scene->wallDecorOffsetX(p.level, sceneX, sceneY) =
                                (resolved->decorDisplacement * scene->wallDecorOffsetX(p.level, sceneX, sceneY)) / 16;
                            scene->wallDecorOffsetZ(p.level, sceneX, sceneY) =
                                (resolved->decorDisplacement * scene->wallDecorOffsetZ(p.level, sceneX, sceneY)) / 16;
                        }
                    }


                    if (isWall && resolved && resolved->clipped) {
                        const i32 lvl = p.level;
                        const i32 tx = sceneX;
                        const i32 ty = sceneY;
                        const i32 rot = p.rotation & 3;

                        auto bumpOcclusion = [&](i32 ox, i32 oy, u8 value) noexcept {
                            if (ox < 0 || oy < 0 || ox > scene->sizeX || oy > scene->sizeY) {
                                return;
                            }
                            const u8 current = scene->lightOcclusion(lvl, ox, oy);
                            if (value > current) {
                                scene->lightOcclusion(lvl, ox, oy) = value;
                            }
                        };

                        if (p.type == 0) { // WALL
                            if (rot == 0) {
                                bumpOcclusion(tx, ty, 50);
                                bumpOcclusion(tx, ty + 1, 50);
                            } else if (rot == 1) {
                                bumpOcclusion(tx, ty + 1, 50);
                                bumpOcclusion(tx + 1, ty + 1, 50);
                            } else if (rot == 2) {
                                bumpOcclusion(tx + 1, ty, 50);
                                bumpOcclusion(tx + 1, ty + 1, 50);
                            } else {
                                bumpOcclusion(tx, ty, 50);
                                bumpOcclusion(tx + 1, ty, 50);
                            }
                        } else if (p.type == 1 || p.type == 3) { // WALL_TRI_CORNER / WALL_RECT_CORNER
                            if (rot == 0) {
                                bumpOcclusion(tx, ty + 1, 50);
                            } else if (rot == 1) {
                                bumpOcclusion(tx + 1, ty + 1, 50);
                            } else if (rot == 2) {
                                bumpOcclusion(tx + 1, ty, 50);
                            } else {
                                bumpOcclusion(tx, ty, 50);
                            }
                        }
                    }
                    continue;
                }

                if (!isLoc) {
                    continue;
                }

                // WALL_DIAGONAL can post-scale wallDecoration offsets (TS `SceneBuilder`).
                if (p.type == 9 && resolved &&
                    resolved->decorDisplacement != LocType::DEFAULT_DECOR_DISPLACEMENT &&
                    scene->wallDecorPresent(p.level, sceneX, sceneY) != 0) {
                    scene->wallDecorOffsetX(p.level, sceneX, sceneY) =
                        (resolved->decorDisplacement * scene->wallDecorOffsetX(p.level, sceneX, sceneY)) / 16;
                    scene->wallDecorOffsetZ(p.level, sceneX, sceneY) =
                        (resolved->decorDisplacement * scene->wallDecorOffsetZ(p.level, sceneX, sceneY)) / 16;
                }

                i32 sizeX = 1;
                i32 sizeY = 1;
                if (resolved && (p.type == 10 || p.type == 11)) {
                    sizeX = resolved->sizeX;
                    sizeY = resolved->sizeY;
                    if ((p.rotation & 1) != 0) {
                        const i32 swap = sizeX;
                        sizeX = sizeY;
                        sizeY = swap;
                    }
                }
                placed.sizeX = sizeX;
                placed.sizeY = sizeY;

                const i32 startX = sceneX;
                const i32 startY = sceneY;
                const i32 endX = sceneX + sizeX - 1;
                const i32 endY = sceneY + sizeY - 1;

                bool canPlace = true;
                for (i32 sx = startX; sx <= endX && canPlace; sx++) {
                    for (i32 sy = startY; sy <= endY; sy++) {
                        if (!scene->isWithinBounds(p.level, sx, sy)) {
                            canPlace = false;
                            break;
                        }
                        const std::size_t tIdx = scene->tileIdx(p.level, sx, sy);
                        if (tIdx >= locCounts.size() || locCounts[tIdx] >= 5) {
                            canPlace = false;
                            break;
                        }
                    }
                }
                if (!canPlace) {
                    continue;
                }

                if ((p.type == 10 || p.type == 11) && resolved && resolved->clipped) {
                    i32 lightOcclusion = 15;
                    // TS uses `entity.tryGetXZRadius() !== null` and then `Math.trunc(xzRadius / 4)`,
                    // so a resolved radius of 0 must produce occlusion 0 (not fallback 15).
                    if (!isEntity && staticModelXzRadius >= 0) {
                        lightOcclusion = static_cast<i32>(staticModelXzRadius / 4);
                    }
                    if (lightOcclusion > 30) {
                        lightOcclusion = 30;
                    }
                    const i32 lvl = p.level;
                    const i32 endOccX = startX + sizeX;
                    const i32 endOccY = startY + sizeY;
                    for (i32 sx = startX; sx <= endOccX; sx++) {
                        for (i32 sy = startY; sy <= endOccY; sy++) {
                            if (sx < 0 || sy < 0 || sx > scene->sizeX || sy > scene->sizeY) {
                                continue;
                            }
                            const u8 current = scene->lightOcclusion(lvl, sx, sy);
                            if (static_cast<u8>(lightOcclusion) > current) {
                                scene->lightOcclusion(lvl, sx, sy) = static_cast<u8>(lightOcclusion);
                            }
                        }
                    }
                }

                for (i32 sx = startX; sx <= endX; sx++) {
                    for (i32 sy = startY; sy <= endY; sy++) {
                        const std::size_t tIdx = scene->tileIdx(p.level, sx, sy);
                        locCounts[tIdx] = static_cast<u8>(locCounts[tIdx] + 1);
                    }
                }

                auto rrLoc = scene->locPlacements.pushBack(placed);
                if (!rrLoc.isOk()) {
                    return rrLoc.status();
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
    const Status summaryStatus = buildFinalizeSummaries(services, scene);
    if (!ok(summaryStatus)) {
        return summaryStatus;
    }
    (void)context;
    return Status::Ok;
}

} // namespace rs
