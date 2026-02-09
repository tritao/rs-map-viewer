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

struct SceneStaticModelInfo final {
    i32 signature = 0;
    i32 verticesCount = 0;
    i32 faceCount = 0;
    i32 textureFaceCount = 0;
    bool hasMayaGroups = false;
};

struct SceneSkeletalInfo final {
    i32 seqId = -1;
    i32 animMayaId = -1;
    i32 baseId = -1;
    i32 poseId = 0;
    i32 curveCount = 0;
    bool hasAlphaTransform = false;
    i32 frame = 0;
    i32 frameHash = 0;
};

struct LocModelService {
    virtual ~LocModelService() = default;
    // Resolves whether a placement can be materialized as a static model and returns
    // a stable materialization signature plus shape counters.
    virtual Status tryResolveStaticModelInfo(
        const LocType& locType,
        i32 placementType,
        i32 rotation,
        SceneStaticModelInfo* out) const noexcept = 0;

    // Resolves anim-maya/skeletal runtime data for the selected sequence id.
    virtual Status tryResolveSkeletalInfo(
        i32 seqId,
        SceneSkeletalInfo* out) const noexcept = 0;
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
