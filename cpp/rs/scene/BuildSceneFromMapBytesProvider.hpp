#pragma once

#include "../core/Allocator.hpp"
#include "../core/Status.hpp"
#include "SceneBuildStages.hpp"
#include "SceneData.hpp"

namespace rs {

// Mirrors `src/rs/scene/buildSceneFromMapBytesProvider.ts` orchestration boundaries.
Status buildSceneFromMapBytesProvider(
    const SceneRuntimeServices& services,
    const MapBytesProvider& mapBytesProvider,
    const SceneBuildContext& context,
    SceneData* outScene,
    Allocator& alloc
) noexcept;

} // namespace rs
