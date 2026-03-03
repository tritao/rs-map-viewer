#include "TerrainTileSampler.hpp"

#include "SceneCommandBuilderInternal.hpp"
#include "TerrainTileBuilder.hpp" // computeOverlayEdgeEligibility, kTerrainTileSize

#include "../config/floortype/OverlayFloorType.hpp"
#include "../config/floortype/UnderlayFloorType.hpp"
#include "../scene/BuildSceneFromMapBytesProvider.hpp" // SceneData

namespace rs {

namespace {

static i32 resolveSdTextureId(const SceneCommandBuildInput& input, i32 textureId) noexcept {
    return scb::isTextureSdFromRuntimeDefs(input, textureId) ? textureId : -1;
}

} // namespace

Status sampleTerrainTile(
    const SceneData& scene,
    const SceneCommandBuildInput& input,
    const TerrainTypeProvider& provider,
    i32 level,
    i32 x,
    i32 y,
    bool smoothUnderlays,
    TerrainTileSample* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    *out = TerrainTileSample{};

    const i32 underlayRaw = static_cast<i32>(scene.underlay(level, x, y));
    const i32 overlayRaw = static_cast<i32>(scene.overlay(level, x, y));

    // Underlay texture info
    if (underlayRaw > 0 && provider.tryLoadUnderlay) {
        const UnderlayFloorType* underlayType = nullptr;
        const Status us = provider.tryLoadUnderlay(provider.ctx, underlayRaw - 1, &underlayType);
        if (ok(us) && underlayType) {
            out->underlayTexturePacked = resolveSdTextureId(input, underlayType->textureId);
            out->underlayTextureSize = underlayType->textureSize > 0 ? underlayType->textureSize : kTerrainTileSize;
        }
    }

    // Underlay blended HSL basis
    out->underlayBlendSw = underlayRaw > 0 ? scene.blendedUnderlay(level, x, y) : -1;
    out->underlayBlendSe = underlayRaw > 0 ? scene.blendedUnderlay(level, x + 1, y) : -1;
    out->underlayBlendNe = underlayRaw > 0 ? scene.blendedUnderlay(level, x + 1, y + 1) : -1;
    out->underlayBlendNw = underlayRaw > 0 ? scene.blendedUnderlay(level, x, y + 1) : -1;
    if (!smoothUnderlays || out->underlayBlendSe == -1) {
        out->underlayBlendSe = out->underlayBlendSw;
    }
    if (!smoothUnderlays || out->underlayBlendNe == -1) {
        out->underlayBlendNe = out->underlayBlendSw;
    }
    if (!smoothUnderlays || out->underlayBlendNw == -1) {
        out->underlayBlendNw = out->underlayBlendSw;
    }

    // Overlay sample selection (blendable overlay corners/edges)
    if (overlayRaw > 0 && provider.tryLoadOverlay) {
        const OverlayFloorType* overlayType = nullptr;
        const Status os = provider.tryLoadOverlay(provider.ctx, overlayRaw - 1, &overlayType);
        if (ok(os) && overlayType) {
            out->hasOverlay = true;

                auto fillOverlaySample = [&](
                    const OverlayFloorType* sample,
                    bool preferBlendColour,
                    i32* outBaseHsl,
                    i32* outTexturePacked,
                    i32* outTextureSize) {
                auto isSdTextureCandidate = [&](i32 textureId) -> bool {
                    // TS uses `textureLoader.isSd(textureId)` here. In the wasm runtime we infer
                    // SD eligibility via runtime-cached per-texture definition blobs (kind=4).
                    return scb::isTextureSdFromRuntimeDefs(input, textureId);
                };

                // Match TS `fillOverlaySample`: prefer primary texture when valid, otherwise
                // fall back to secondary texture, otherwise treat as untextured.
                i32 selectedTextureId = -1;
                if (sample) {
                    if (isSdTextureCandidate(sample->textureId)) {
                        selectedTextureId = sample->textureId;
                    } else if (isSdTextureCandidate(sample->secondaryTextureId)) {
                        selectedTextureId = sample->secondaryTextureId;
                    }
                }

                const i32 packed =
                    (selectedTextureId != -1)
                        ? resolveSdTextureId(input, selectedTextureId)
                        : -1;
                const i32 texSize = (sample && sample->textureSize > 0) ? sample->textureSize : kTerrainTileSize;
                i32 baseHsl = -1;
                if (selectedTextureId >= 0) {
                    baseHsl = -1;
                } else if (sample) {
                    baseHsl = (preferBlendColour && sample->blendHsl != -1)
                        ? sample->blendHsl
                        : sample->primaryHsl;
                }
                *outBaseHsl = baseHsl;
                *outTexturePacked = packed;
                *outTextureSize = texSize;
            };

            const OverlayFloorType* currentOverlay = overlayType;
            i32 defaultTexturePacked = -1;
            i32 defaultTextureSize = kTerrainTileSize;
            i32 defaultBaseHsl = -1;
            fillOverlaySample(currentOverlay, false, &defaultBaseHsl, &defaultTexturePacked, &defaultTextureSize);

            for (i32 i = 0; i < 4; i++) {
                out->overlayCornerBaseHsl[i] = defaultBaseHsl;
                out->overlayEdgeBaseHsl[i] = defaultBaseHsl;
                out->overlayCornerTexturePacked[i] = defaultTexturePacked;
                out->overlayCornerTextureSize[i] = defaultTextureSize;
                out->overlayEdgeTexturePacked[i] = defaultTexturePacked;
                out->overlayEdgeTextureSize[i] = defaultTextureSize;
            }

            const i32 tileShapeRaw = static_cast<i32>(scene.shape(level, x, y));
            const i32 tileRotation = static_cast<i32>(scene.rotation(level, x, y)) & 3;

            const bool currentBlendable = currentOverlay->blendable;
            bool canBlend[4] = {false, false, false, false};
            computeOverlayEdgeEligibility(tileShapeRaw, tileRotation, currentBlendable, canBlend);

            auto tryLoadOverlayAt = [&](i32 sx, i32 sy, const OverlayFloorType** outSample) -> bool {
                if (!outSample) {
                    return false;
                }
                *outSample = nullptr;
                if (!scene.isWithinBounds(level, sx, sy)) {
                    return false;
                }
                const i32 neighborOverlayId = static_cast<i32>(scene.overlay(level, sx, sy)) - 1;
                if (neighborOverlayId < 0) {
                    return false;
                }
                const OverlayFloorType* neighborOverlay = nullptr;
                const Status ns = provider.tryLoadOverlay(provider.ctx, neighborOverlayId, &neighborOverlay);
                if (!ok(ns) || !neighborOverlay) {
                    return false;
                }
                *outSample = neighborOverlay;
                return true;
            };

            auto chooseOverlay = [&](const i32* candX, const i32* candY, i32 count) -> const OverlayFloorType* {
                const OverlayFloorType* best = nullptr;
                i32 bestPriority = -0x3fffffff;
                bool bestIsCurrent = false;
                for (i32 ci = 0; ci < count; ci++) {
                    const OverlayFloorType* candidate = nullptr;
                    if (!tryLoadOverlayAt(candX[ci], candY[ci], &candidate) || !candidate) {
                        continue;
                    }
                    const bool isCurrent = candidate->id == currentOverlay->id;
                    if (!isCurrent && (!currentBlendable || !candidate->blendable)) {
                        continue;
                    }
                    i32 priority = 0;
                    if (input.cacheGame == static_cast<i32>(GameType::Runescape) && input.cacheRevision >= 667) {
                        priority = static_cast<i32>(candidate->blendPriority);
                    }
                    if (!best || priority > bestPriority || (priority == bestPriority && isCurrent && !bestIsCurrent)) {
                        best = candidate;
                        bestPriority = priority;
                        bestIsCurrent = isCurrent;
                    }
                }
                return best ? best : currentOverlay;
            };

            auto fillCorner = [&](i32 cornerIndex, const i32* candX, const i32* candY, i32 count) {
                const OverlayFloorType* sample = chooseOverlay(candX, candY, count);
                const bool preferBlend = sample && sample->id != currentOverlay->id;
                fillOverlaySample(
                    sample,
                    preferBlend,
                    &out->overlayCornerBaseHsl[cornerIndex],
                    &out->overlayCornerTexturePacked[cornerIndex],
                    &out->overlayCornerTextureSize[cornerIndex]);
            };

            auto fillEdge = [&](i32 edgeIndex, const i32* candX, const i32* candY, i32 count) {
                const OverlayFloorType* sample = chooseOverlay(candX, candY, count);
                const bool preferBlend = sample && sample->id != currentOverlay->id;
                fillOverlaySample(
                    sample,
                    preferBlend,
                    &out->overlayEdgeBaseHsl[edgeIndex],
                    &out->overlayEdgeTexturePacked[edgeIndex],
                    &out->overlayEdgeTextureSize[edgeIndex]);
            };

            i32 cx[4]{};
            i32 cy[4]{};
            i32 cc = 0;

            // SW corner
            cx[cc] = x; cy[cc] = y; cc++;
            if (canBlend[3]) { cx[cc] = x - 1; cy[cc] = y; cc++; }
            if (canBlend[0]) { cx[cc] = x; cy[cc] = y - 1; cc++; }
            if (canBlend[3] || canBlend[0]) { cx[cc] = x - 1; cy[cc] = y - 1; cc++; }
            fillCorner(0, cx, cy, cc);

            // SE corner
            cc = 0;
            cx[cc] = x; cy[cc] = y; cc++;
            if (canBlend[1]) { cx[cc] = x + 1; cy[cc] = y; cc++; }
            if (canBlend[0]) { cx[cc] = x; cy[cc] = y - 1; cc++; }
            if (canBlend[1] || canBlend[0]) { cx[cc] = x + 1; cy[cc] = y - 1; cc++; }
            fillCorner(1, cx, cy, cc);

            // NE corner
            cc = 0;
            cx[cc] = x; cy[cc] = y; cc++;
            if (canBlend[1]) { cx[cc] = x + 1; cy[cc] = y; cc++; }
            if (canBlend[2]) { cx[cc] = x; cy[cc] = y + 1; cc++; }
            if (canBlend[1] || canBlend[2]) { cx[cc] = x + 1; cy[cc] = y + 1; cc++; }
            fillCorner(2, cx, cy, cc);

            // NW corner
            cc = 0;
            cx[cc] = x; cy[cc] = y; cc++;
            if (canBlend[3]) { cx[cc] = x - 1; cy[cc] = y; cc++; }
            if (canBlend[2]) { cx[cc] = x; cy[cc] = y + 1; cc++; }
            if (canBlend[3] || canBlend[2]) { cx[cc] = x - 1; cy[cc] = y + 1; cc++; }
            fillCorner(3, cx, cy, cc);

            // Edges S/E/N/W
            cc = 0;
            cx[cc] = x; cy[cc] = y; cc++;
            if (canBlend[0]) { cx[cc] = x; cy[cc] = y - 1; cc++; }
            fillEdge(0, cx, cy, cc);

            cc = 0;
            cx[cc] = x; cy[cc] = y; cc++;
            if (canBlend[1]) { cx[cc] = x + 1; cy[cc] = y; cc++; }
            fillEdge(1, cx, cy, cc);

            cc = 0;
            cx[cc] = x; cy[cc] = y; cc++;
            if (canBlend[2]) { cx[cc] = x; cy[cc] = y + 1; cc++; }
            fillEdge(2, cx, cy, cc);

            cc = 0;
            cx[cc] = x; cy[cc] = y; cc++;
            if (canBlend[3]) { cx[cc] = x - 1; cy[cc] = y; cc++; }
            fillEdge(3, cx, cy, cc);

            out->useOverlayEdgeHsls = true;
        }
    }

    return Status::Ok;
}

} // namespace rs
