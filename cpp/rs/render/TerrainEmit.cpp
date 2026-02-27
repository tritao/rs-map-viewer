#include "SceneCommandBuilderInternal.hpp"

#include "../config/floortype/OverlayFloorType.hpp"
#include "../config/floortype/UnderlayFloorType.hpp"
#include "../scene/SceneData.hpp"
#include "TerrainTileBuilder.hpp"
#include "TerrainTileSampler.hpp"

namespace rs {
namespace scb {

Status analyzeTerrainLowDetailTileFlags(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    i32 startX,
    i32 startY,
    i32 endX,
    i32 endY,
    i32 border,
    Vec<u8>* outTileHasValidFaceColorsAForLowDetail,
    DecodedUnderlayTypeCache* underlayCache,
    DecodedOverlayTypeCache* overlayCache,
    Allocator& alloc) noexcept {
    if (!outTileHasValidFaceColorsAForLowDetail || !underlayCache || !overlayCache) {
        return Status::InvalidArgument;
    }

    const std::size_t tileCount =
        static_cast<std::size_t>(scene.levels) *
        static_cast<std::size_t>(scene.sizeX) *
        static_cast<std::size_t>(scene.sizeY);
    if (outTileHasValidFaceColorsAForLowDetail->size() < tileCount) {
        return Status::SizeMismatch;
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

    // Reuse small scratch buffers to compute `tileFaceColorsAAllValid` via the same path as full
    // terrain emission, but discard all geometry.
    Vec<u8> scratchVertices(alloc);
    Vec<i32> scratchIndices(alloc);
    const i32 vertexOffset = border * -kTerrainTileSize;

    for (i32 level = 0; level < scene.levels; level++) {
        for (i32 x = startX; x < endX; x++) {
            for (i32 y = startY; y < endY; y++) {
                if (!scene.isWithinBounds(level, x, y)) {
                    continue;
                }
                if (x + 1 >= scene.sizeX || y + 1 >= scene.sizeY) {
                    continue;
                }
                if (scene.minLevel(level, x, y) > 3) {
                    continue;
                }

                const i32 underlayRaw = static_cast<i32>(scene.underlay(level, x, y));
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
                i32 scratchElements = 0;
                scratchVertices.clear();
                scratchIndices.clear();
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
                    /*debugOut=*/nullptr,
                    &scratchVertices,
                    &scratchIndices,
                    &scratchElements);
                if (!ok(gs)) {
                    return gs;
                }

                const i32 hasTileModel = (hasUnderlay || hasOverlay) ? 1 : 0;
                (*outTileHasValidFaceColorsAForLowDetail)[scene.tileIdx(level, x, y)] =
                    (hasTileModel != 0 && tileFaceColorsAAllValid) ? 1 : 0;
            }
        }
    }

    return Status::Ok;
}

Status appendTerrainFallbackGeometryForLevel(
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
	            if (debugOut &&
	                debugOut->debugTerrainProbeHit == 0 &&
	                debugOut->debugTerrainProbeLevel == level &&
	                debugOut->debugTerrainProbeTileX == x &&
	                debugOut->debugTerrainProbeTileY == y) {
                debugOut->debugTerrainProbeHit = 1;
                debugOut->debugTerrainProbePacked[0] = underlayRaw;
                debugOut->debugTerrainProbePacked[1] = overlayRaw;
                debugOut->debugTerrainProbePacked[2] = shapeId;
                debugOut->debugTerrainProbePacked[3] = rotation;
                debugOut->debugTerrainProbePacked[4] = useOverlayEdgeHsls ? 1 : 0;
                debugOut->debugTerrainProbePacked[5] = underlayTexturePacked;
                debugOut->debugTerrainProbePacked[6] = underlayTextureSize;
                debugOut->debugTerrainProbePacked[7] = underlayBlendSw;
                debugOut->debugTerrainProbePacked[8] = underlayBlendSe;
                debugOut->debugTerrainProbePacked[9] = underlayBlendNe;
                debugOut->debugTerrainProbePacked[10] = underlayBlendNw;
                debugOut->debugTerrainProbePacked[11] = lightSw;
                debugOut->debugTerrainProbePacked[12] = lightSe;
                debugOut->debugTerrainProbePacked[13] = lightNe;
                debugOut->debugTerrainProbePacked[14] = lightNw;
                debugOut->debugTerrainProbePacked[15] = underlayHslSw;
                debugOut->debugTerrainProbePacked[16] = underlayHslSe;
                debugOut->debugTerrainProbePacked[17] = underlayHslNe;
                debugOut->debugTerrainProbePacked[18] = underlayHslNw;
                // Capture occlusion samples around the NE light cell (x+1,y+1) used to produce lightNe.
                const i32 cellX = x + 1;
                const i32 cellY = y + 1;
                const i32 occlW = static_cast<i32>(scene.lightOcclusion(level, cellX - 1, cellY));
                const i32 occlS = static_cast<i32>(scene.lightOcclusion(level, cellX, cellY - 1));
                const i32 occlE = static_cast<i32>(scene.lightOcclusion(level, cellX + 1, cellY));
                const i32 occlN = static_cast<i32>(scene.lightOcclusion(level, cellX, cellY + 1));
                const i32 occlC = static_cast<i32>(scene.lightOcclusion(level, cellX, cellY));
                debugOut->debugTerrainProbePacked[19] = occlW;
                debugOut->debugTerrainProbePacked[20] = occlS;
                debugOut->debugTerrainProbePacked[21] = occlE;
                debugOut->debugTerrainProbePacked[22] = occlN;
	                debugOut->debugTerrainProbePacked[23] = occlC;
                // Terrain color mismatch debugging: expose overlay corner/edge base HSL choices so the
                // TS parity script can compute the resulting overlay HSLs and diff against TS.
                debugOut->debugTerrainProbePacked[24] = overlayCornerBaseHsl[0];
                debugOut->debugTerrainProbePacked[25] = overlayCornerBaseHsl[1];
                debugOut->debugTerrainProbePacked[26] = overlayCornerBaseHsl[2];
                debugOut->debugTerrainProbePacked[27] = overlayCornerBaseHsl[3];
                debugOut->debugTerrainProbePacked[28] = overlayEdgeBaseHsl[0];
                debugOut->debugTerrainProbePacked[29] = overlayEdgeBaseHsl[1];
                debugOut->debugTerrainProbePacked[30] = overlayEdgeBaseHsl[2];
	                debugOut->debugTerrainProbePacked[31] = overlayEdgeBaseHsl[3];

	                // Best-effort occlusion-writer debugging for the NE east occlusion cell (cellX+1,cellY),
	                // which directly feeds `occlE` in the probe output.
	                // This helps chase down terrain HSL mismatches caused by tileLightOcclusions divergence.
	                i32 bestValue = -1;
	                const SceneLocPlacement* best = nullptr;
                    const i32 probeOccX = cellX + 1;
                    const i32 probeOccY = cellY;
	                for (std::size_t i = 0; i < scene.locPlacements.size(); i++) {
	                    const SceneLocPlacement& p = scene.locPlacements[i];
	                    if (p.level != level) {
	                        continue;
	                    }
	                    if (p.clipped == 0) {
	                        continue;
	                    }
	                    if (!(p.type == 10 || p.type == 11)) {
	                        continue;
	                    }
	                    const i32 startX = p.tileX;
	                    const i32 startY = p.tileY;
	                    const i32 endOccX = p.tileX + p.sizeX;
	                    const i32 endOccY = p.tileY + p.sizeY;
	                    if (probeOccX < startX || probeOccY < startY || probeOccX > endOccX || probeOccY > endOccY) {
	                        continue;
	                    }
	                    i32 value = 15;
	                    if (p.isEntity == 0 && p.staticModelXzRadius > 0) {
	                        value = static_cast<i32>(p.staticModelXzRadius / 4);
	                        if (value > 30) {
	                            value = 30;
	                        }
	                    }
	                    if (value > bestValue) {
	                        bestValue = value;
	                        best = &p;
	                    }
	                }
	                // [32..] writer info for the east occlusion cell (occlE).
	                debugOut->debugTerrainProbePacked[32] = best ? 1 : 0;
	                debugOut->debugTerrainProbePacked[33] = best ? best->originalId : -1;
	                debugOut->debugTerrainProbePacked[34] = best ? best->resolvedId : -1;
	                debugOut->debugTerrainProbePacked[35] = best ? best->type : -1;
	                debugOut->debugTerrainProbePacked[36] = best ? best->rotation : -1;
	                debugOut->debugTerrainProbePacked[37] = best ? best->tileX : -1;
	                debugOut->debugTerrainProbePacked[38] = best ? best->tileY : -1;
	                debugOut->debugTerrainProbePacked[39] = best ? best->sizeX : -1;
	                debugOut->debugTerrainProbePacked[40] = best ? best->sizeY : -1;
	                debugOut->debugTerrainProbePacked[41] = best ? best->isEntity : -1;
		                debugOut->debugTerrainProbePacked[42] = best ? best->staticModelXzRadius : -1;
		                debugOut->debugTerrainProbePacked[43] = best ? bestValue : -1;
		                debugOut->debugTerrainProbePacked[44] = best ? best->level : -1;

                        // World-coordinate context for the probed tile (helps debug baseX/baseY mismatches).
                        // Store near the end of the generous probe payload to avoid shifting existing fields.
                        debugOut->debugTerrainProbePacked[60] = input.baseX;
                        debugOut->debugTerrainProbePacked[61] = input.baseY;
                        debugOut->debugTerrainProbePacked[62] = input.baseX + x;
                        debugOut->debugTerrainProbePacked[63] = input.baseY + y;
		            }
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

} // namespace scb
} // namespace rs
