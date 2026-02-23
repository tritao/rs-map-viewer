struct DecodedUnderlayTypeCache;
struct DecodedOverlayTypeCache;
struct DecodedObjTypeCache;

static i32 mapTextureIdToPackedIndex(Span<const i32> textureIds, i32 textureId) noexcept;
static Status tryDecodeUnderlayTypeFromBlob(
    const SceneCommandBuildInput& input,
    i32 underlayId,
    DecodedUnderlayTypeCache* cache,
    const UnderlayFloorType** outType,
    Allocator& alloc) noexcept;
static Status tryDecodeOverlayTypeFromBlob(
    const SceneCommandBuildInput& input,
    i32 overlayId,
    DecodedOverlayTypeCache* cache,
    const OverlayFloorType** outType,
    Allocator& alloc) noexcept;
static Status tryDecodeObjTypeFromBlob(
    const SceneCommandBuildInput& input,
    DecodedObjTypeCache* cache,
    i32 objTypeId,
    const ObjType** outObjType,
    Allocator& alloc) noexcept;

static Status appendTerrainFallbackGeometryForLevel(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    i32 level,
    i32 startX,
    i32 startY,
    i32 endX,
    i32 endY,
    i32 border,
    SceneCommandStream* debugOut,
    TerrainTileFaceCountGrid* debugGrid,
    Vec<u8>* outTileHasValidFaceColorsAForLowDetail,
    SceneBuffer* buffer,
    i32* outLevelElements,
    DecodedUnderlayTypeCache* underlayCache,
    DecodedOverlayTypeCache* overlayCache,
    Allocator& alloc) noexcept {
    if (!buffer || !outLevelElements || !underlayCache || !overlayCache) {
        return Status::InvalidArgument;
    }

    *outLevelElements = 0;
    const i32 vertexOffset = border * -kTerrainTileSize;

    if (debugGrid && level == 0) {
        const i32 w = endX - startX;
        const i32 h = endY - startY;
        const Status es = debugGrid->ensure(scene.levels, w, h, border);
        if (!ok(es)) {
            return es;
        }
    }



    struct TerrainSamplerCtx final {
        const SceneCommandBuildInput* input = nullptr;
        DecodedUnderlayTypeCache* underlayCache = nullptr;
        DecodedOverlayTypeCache* overlayCache = nullptr;
        Allocator* alloc = nullptr;
    };

    auto tryLoadUnderlayCb = [](void* c, i32 underlayIdMinusOne, const UnderlayFloorType** outType) noexcept -> Status {
        if (!c || !outType) {
            return Status::InvalidArgument;
        }
        *outType = nullptr;
        TerrainSamplerCtx* ctx = static_cast<TerrainSamplerCtx*>(c);
        return tryDecodeUnderlayTypeFromBlob(
            *ctx->input,
            underlayIdMinusOne,
            ctx->underlayCache,
            outType,
            *ctx->alloc);
    };

    auto tryLoadOverlayCb = [](void* c, i32 overlayIdMinusOne, const OverlayFloorType** outType) noexcept -> Status {
        if (!c || !outType) {
            return Status::InvalidArgument;
        }
        *outType = nullptr;
        TerrainSamplerCtx* ctx = static_cast<TerrainSamplerCtx*>(c);
        return tryDecodeOverlayTypeFromBlob(
            *ctx->input,
            overlayIdMinusOne,
            ctx->overlayCache,
            outType,
            *ctx->alloc);
    };

    TerrainSamplerCtx samplerCtx{&input, underlayCache, overlayCache, &alloc};
    TerrainTypeProvider samplerProvider{&samplerCtx, tryLoadUnderlayCb, tryLoadOverlayCb};
    for (i32 x = startX; x < endX; x++) {
        for (i32 y = startY; y < endY; y++) {
            if (!scene.isWithinBounds(level, x, y)) {
                continue;
            }
            if (x + 1 >= scene.sizeX || y + 1 >= scene.sizeY) {
                continue;
            }            if (scene.minLevel(level, x, y) > 3) {
                continue;
            }
            if (debugOut) {
                debugOut->debugTerrainTilesConsidered++;
            }

            const i32 underlayRaw = static_cast<i32>(scene.underlay(level, x, y));
            const i32 overlayRaw = static_cast<i32>(scene.overlay(level, x, y));

            TerrainTileSample tileSample{};
            const Status sampleStatus = sampleTerrainTile(
                scene,
                input.cacheGame,
                input.cacheRevision,
                input.textureIds,
                samplerProvider,
                level,
                x,
                y,
                input.smoothTerrain,
                &tileSample);
            if (!ok(sampleStatus)) {
                return sampleStatus;
            }

            const bool hasOverlay = tileSample.hasOverlay;
            const bool useOverlayEdgeHsls = tileSample.useOverlayEdgeHsls;
            const i32 underlayTexturePacked = tileSample.underlayTexturePacked;
            const i32 underlayTextureSize = tileSample.underlayTextureSize;
            const i32 underlayBlendSw = tileSample.underlayBlendSw;
            const i32 underlayBlendSe = tileSample.underlayBlendSe;
            const i32 underlayBlendNe = tileSample.underlayBlendNe;
            const i32 underlayBlendNw = tileSample.underlayBlendNw;
            const i32* overlayCornerBaseHsl = tileSample.overlayCornerBaseHsl;
            const i32* overlayEdgeBaseHsl = tileSample.overlayEdgeBaseHsl;
            const i32* overlayCornerTexturePacked = tileSample.overlayCornerTexturePacked;
            const i32* overlayCornerTextureSize = tileSample.overlayCornerTextureSize;
            const i32* overlayEdgeTexturePacked = tileSample.overlayEdgeTexturePacked;
            const i32* overlayEdgeTextureSize = tileSample.overlayEdgeTextureSize;

            const i32 lightSw = static_cast<i32>(scene.lightValue(level, x, y));
            const i32 lightSe = static_cast<i32>(scene.lightValue(level, x + 1, y));
            const i32 lightNe = static_cast<i32>(scene.lightValue(level, x + 1, y + 1));
            const i32 lightNw = static_cast<i32>(scene.lightValue(level, x, y + 1));

            const i32 underlayHslSw = adjustUnderlayLight(underlayBlendSw, lightSw);
            const i32 underlayHslSe = adjustUnderlayLight(underlayBlendSe, lightSe);
            const i32 underlayHslNe = adjustUnderlayLight(underlayBlendNe, lightNe);
            const i32 underlayHslNw = adjustUnderlayLight(underlayBlendNw, lightNw);

            const i32 overlayHslSw = adjustOverlayLight(overlayCornerBaseHsl[0], lightSw);
            const i32 overlayHslSe = adjustOverlayLight(overlayCornerBaseHsl[1], lightSe);
            const i32 overlayHslNe = adjustOverlayLight(overlayCornerBaseHsl[2], lightNe);
            const i32 overlayHslNw = adjustOverlayLight(overlayCornerBaseHsl[3], lightNw);
            const i32 lightS = (lightSw + lightSe) >> 1;
            const i32 lightE = (lightSe + lightNe) >> 1;
            const i32 lightN = (lightNe + lightNw) >> 1;
            const i32 lightW = (lightNw + lightSw) >> 1;
            const i32 overlayHslSAvg = adjustOverlayLight(overlayEdgeBaseHsl[0], lightS);
            const i32 overlayHslEAvg = adjustOverlayLight(overlayEdgeBaseHsl[1], lightE);
            const i32 overlayHslNAvg = adjustOverlayLight(overlayEdgeBaseHsl[2], lightN);
            const i32 overlayHslWAvg = adjustOverlayLight(overlayEdgeBaseHsl[3], lightW);

            i32 shapeId = 0;
            i32 rotation = 0;
            if (hasOverlay) {
                shapeId = static_cast<i32>(scene.shape(level, x, y)) + 1;
                if (shapeId < 1 || shapeId > 12) {
                    shapeId = 0;
                }
                rotation = static_cast<i32>(scene.rotation(level, x, y)) & 3;
            }

            const bool hasUnderlay = underlayRaw > 0;
            bool tileFaceColorsAAllValid = true;
            const i32 levelElementsBefore = *outLevelElements;
            const Status gs = appendTerrainTileGeometry(
                scene,
                level,
                x,
                y,
                vertexOffset,
                shapeId,
                rotation,
                hasOverlay,
                hasUnderlay,
                underlayHslSw,
                underlayHslSe,
                underlayHslNe,
                underlayHslNw,
                overlayHslSw,
                overlayHslSe,
                overlayHslNe,
                overlayHslNw,
                overlayHslSAvg,
                overlayHslEAvg,
                overlayHslNAvg,
                overlayHslWAvg,
                useOverlayEdgeHsls,
                underlayTexturePacked,
                underlayTextureSize,
                overlayCornerTexturePacked,
                overlayCornerTextureSize,
                overlayEdgeTexturePacked,
                overlayEdgeTextureSize,
                &tileFaceColorsAAllValid,
                debugOut,
                &buffer->vertices,
                &buffer->indices,
                outLevelElements);
            if (!ok(gs)) {
                return gs;
            }
            if (outTileHasValidFaceColorsAForLowDetail && scene.isWithinBounds(level, x, y)) {
                const i32 hasTileModel = (hasUnderlay || hasOverlay) ? 1 : 0;
                (*outTileHasValidFaceColorsAForLowDetail)[scene.tileIdx(level, x, y)] =
                    (hasTileModel != 0 && tileFaceColorsAAllValid) ? 1 : 0;
            }
            if (debugGrid && !debugGrid->counts.empty()) {
                const i32 levelElementsAfter = *outLevelElements;
                const i32 deltaElements = levelElementsAfter - levelElementsBefore;
                const i32 facesEmitted = (deltaElements > 0) ? (deltaElements / 3) : 0;
                const i32 lx = x - startX;
                const i32 ly = y - startY;
                debugGrid->set(level, lx, ly, facesEmitted);
            }
            if (debugOut && *outLevelElements > levelElementsBefore) {
                debugOut->debugTerrainTilesEmitted++;
            }
        }
    }

    return Status::Ok;
}

