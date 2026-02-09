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

            const i32 tileNormalLength = static_cast<i32>(
                std::sqrt(static_cast<double>(heightDeltaY * heightDeltaY + heightDeltaX * heightDeltaX + kHeightScale)));
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
            const u16 wrapped = static_cast<u16>(static_cast<u32>(sunLight) & 0xFFFFu);
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

                i32 seqId = resolved ? resolved->seqId : -1;
                if (resolved && seqId == -1 && !resolved->randomSeqIds.empty()) {
                    seqId = resolved->randomSeqIds[0];
                }
                const bool isEntity = (seqId != -1) ||
                    (resolved && !resolved->transforms.empty()) ||
                    context.locLoadType == SceneLocLoadType::NoModels;

                if (!isEntity && context.locLoadType == SceneLocLoadType::Models) {
                    if (!services.locModels || !resolved) {
                        return Status::InvalidArgument;
                    }
                    const Status ms = services.locModels->tryValidateStaticModelPlacement(
                        *resolved,
                        p.type,
                        p.rotation);
                    if (!ok(ms)) {
                        continue;
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
