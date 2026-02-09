#pragma once

#include "../cache/CacheInfo.hpp"
#include "../config/floortype/FloorTypeLoaders.hpp"
#include "../config/loctype/LocTypeLoader.hpp"
#include "../config/vartype/VarProvider.hpp"
#include "../core/Status.hpp"
#include "../texture/procedural/ProceduralSources.hpp"

namespace rs {

struct UnderlayTypeService {
    virtual ~UnderlayTypeService() = default;
    virtual Status tryLoad(i32 id, const UnderlayFloorType** out) const noexcept = 0;
};

struct OverlayTypeService {
    virtual ~OverlayTypeService() = default;
    virtual Status tryLoad(i32 id, const OverlayFloorType** out) const noexcept = 0;
};

struct LocTypeService {
    virtual ~LocTypeService() = default;
    virtual Status tryLoad(i32 id, const LocType** out) const noexcept = 0;
};

struct LocModelService {
    virtual ~LocModelService() = default;
    // Resolves whether a placement can be materialized as a static model and returns
    // a stable signature for parity/debug surfaces.
    virtual Status tryResolveModelSignature(
        const LocType& locType,
        i32 placementType,
        i32 rotation,
        i32* outSignature) const noexcept = 0;
};

// Mirrors `src/rs/scene/SceneRuntimeServices.ts` and keeps scene dependencies explicit.
struct SceneRuntimeServices final {
    const UnderlayTypeService* underlayTypes = nullptr;
    const OverlayTypeService* overlayTypes = nullptr;
    const LocTypeService* locTypes = nullptr;
    const ITextureSource* textureSource = nullptr;
    const LocModelService* locModels = nullptr;
    const VarProvider* varProvider = nullptr;
    const CacheInfo* cacheInfo = nullptr;
};

} // namespace rs
