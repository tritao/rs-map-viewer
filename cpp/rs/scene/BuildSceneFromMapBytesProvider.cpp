#include "BuildSceneFromMapBytesProvider.hpp"

namespace rs {

Status buildSceneFromMapBytesProvider(
    const SceneRuntimeServices& services,
    const MapBytesProvider& mapBytesProvider,
    const SceneBuildContext& context,
    SceneData* outScene,
    Allocator& alloc) noexcept {
    if (!outScene) {
        return Status::InvalidArgument;
    }
    auto rr = outScene->init(TerrainConstants::MAX_LEVELS, context.sizeX, context.sizeY, alloc);
    if (!rr.isOk()) {
        return rr.status();
    }

    SceneBuildScratch scratch{};
    rr = scratch.init(alloc);
    if (!rr.isOk()) {
        return rr.status();
    }

    Status s = decodeTerrainStage(services, mapBytesProvider, context, outScene, &scratch);
    if (!ok(s)) {
        return s;
    }
    s = fillEmptyTerrainStage(services, context, outScene, &scratch);
    if (!ok(s)) {
        return s;
    }
    s = decodeLocsStage(services, mapBytesProvider, context, outScene, &scratch);
    if (!ok(s)) {
        return s;
    }
    return finalizeSceneStage(services, context, outScene);
}

} // namespace rs
