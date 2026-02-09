#pragma once

#include "../core/Allocator.hpp"
#include "../core/Result.hpp"
#include "../core/Span.hpp"
#include "../core/Status.hpp"
#include "../core/Vec.hpp"
#include "../map/LocPlacementsDecode.hpp"
#include "../map/TerrainSquare.hpp"
#include "../map/TerrainConstants.hpp"
#include "../types.hpp"
#include "SceneData.hpp"
#include "SceneRuntimeServices.hpp"

namespace rs {

enum class SceneLocLoadType : u8 {
    Models = 0,
    NoModels = 1,
};

struct SceneBuildMapBounds final {
    i32 mapStartX = 0;
    i32 mapStartY = 0;
    i32 mapEndX = 0;
    i32 mapEndY = 0;
};

struct SceneBuildContext final {
    i32 baseX = 0;
    i32 baseY = 0;
    i32 sizeX = 0;
    i32 sizeY = 0;
    SceneLocLoadType locLoadType = SceneLocLoadType::Models;
    SceneBuildMapBounds bounds{};
};

struct MapBytesProvider {
    virtual ~MapBytesProvider() = default;
    virtual Status tryLoadTerrainBytes(i32 mapX, i32 mapY, Vec<u8>* out) const noexcept = 0;
    virtual Status tryLoadLocBytes(i32 mapX, i32 mapY, Vec<u8>* out) const noexcept = 0;
    virtual Status tryLoadNpcSpawnBytes(i32 mapX, i32 mapY, Vec<u8>* out) const noexcept = 0;
};

struct SceneBuildScratch final {
    TerrainSquare terrain{};
    Vec<LocPlacement> locPlacements{};
    Vec<i32> emptyTerrainMapIds{};
    Vec<u8> bytes{};

    Result<void> init(Allocator& alloc) noexcept {
        locPlacements = Vec<LocPlacement>(alloc);
        emptyTerrainMapIds = Vec<i32>(alloc);
        bytes = Vec<u8>(alloc);
        return terrain.init(alloc);
    }
};

SceneBuildMapBounds computeSceneBuildMapBounds(i32 baseX, i32 baseY, i32 sizeX, i32 sizeY) noexcept;

SceneBuildContext createSceneBuildContext(
    i32 baseX,
    i32 baseY,
    i32 sizeX,
    i32 sizeY,
    SceneLocLoadType locLoadType
) noexcept;

Status decodeTerrainStage(
    const SceneRuntimeServices& services,
    const MapBytesProvider& mapBytesProvider,
    const SceneBuildContext& context,
    SceneData* scene,
    SceneBuildScratch* scratch
) noexcept;

Status fillEmptyTerrainStage(
    const SceneRuntimeServices& services,
    const SceneBuildContext& context,
    SceneData* scene,
    SceneBuildScratch* scratch
) noexcept;

Status decodeLocsStage(
    const SceneRuntimeServices& services,
    const MapBytesProvider& mapBytesProvider,
    const SceneBuildContext& context,
    SceneData* scene,
    SceneBuildScratch* scratch
) noexcept;

Status finalizeSceneStage(
    const SceneRuntimeServices& services,
    const SceneBuildContext& context,
    SceneData* scene
) noexcept;

} // namespace rs
