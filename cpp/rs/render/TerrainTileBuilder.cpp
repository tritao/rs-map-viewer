#include "TerrainTileBuilder.hpp"

#include "PackedVertex.hpp"
#include "SceneCommandBuilder.hpp" // SceneCommandStream

#include "../scene/BuildSceneFromMapBytesProvider.hpp" // SceneData

namespace rs {

namespace {

static constexpr i32 kTerrainInvalidHslColor = 12345678;
static constexpr i32 kTerrainHalfTileSize = kTerrainTileSize / 2;
static constexpr i32 kTerrainQuarterTileSize = kTerrainTileSize / 4;
static constexpr i32 kTerrainThreeQuarterTileSize = (kTerrainTileSize * 3) / 4;

static inline u32 fnv1a32UpdateI32(u32 hash, i32 value) noexcept {
    const u32 h = (hash ^ static_cast<u32>(value)) * 16777619u;
    return h;
}

static inline i32 quantizeUv4096(float v) noexcept {
    // Match TS `quantizeUv(v) = (v * 4096) | 0` (truncate toward zero).
    return static_cast<i32>(v * 4096.0f);
}

static inline void terrainDigestUpdateVertex(
    SceneCommandStream* debugOut,
    i32 px,
    i32 py,
    i32 pz,
    i32 phsl,
    float pu,
    float pv,
    i32 ptexturePacked,
    i32 ptexturePacked1,
    float ptexBlend) noexcept {
    if (!debugOut) {
        return;
    }
    u32 h = static_cast<u32>(debugOut->debugTerrainDigestHash);
    h = fnv1a32UpdateI32(h, px);
    h = fnv1a32UpdateI32(h, py);
    h = fnv1a32UpdateI32(h, pz);
    h = fnv1a32UpdateI32(h, phsl);
    h = fnv1a32UpdateI32(h, quantizeUv4096(pu));
    h = fnv1a32UpdateI32(h, quantizeUv4096(pv));
    h = fnv1a32UpdateI32(h, ptexturePacked);
    h = fnv1a32UpdateI32(h, ptexturePacked1);
    h = fnv1a32UpdateI32(h, static_cast<i32>(ptexBlend));
    debugOut->debugTerrainDigestHash = static_cast<i32>(h);
}

static inline void terrainDigestAccumulateFace(
    SceneCommandStream* debugOut,
    i32 level) noexcept {
    if (!debugOut) {
        return;
    }
    debugOut->debugTerrainDigestFacesTotal++;
    debugOut->debugTerrainDigestVerticesTotal += 3;
    if (level == 0) {
        debugOut->debugTerrainDigestLevelFaces0++;
        debugOut->debugTerrainDigestLevelVertices0 += 3;
    } else if (level == 1) {
        debugOut->debugTerrainDigestLevelFaces1++;
        debugOut->debugTerrainDigestLevelVertices1 += 3;
    } else if (level == 2) {
        debugOut->debugTerrainDigestLevelFaces2++;
        debugOut->debugTerrainDigestLevelVertices2 += 3;
    } else if (level == 3) {
        debugOut->debugTerrainDigestLevelFaces3++;
        debugOut->debugTerrainDigestLevelVertices3 += 3;
    }
}

struct TerrainShapeDef final {
    const i32* vertexIndices = nullptr;
    i32 vertexCount = 0;
    const i32* faceValues = nullptr;
    i32 faceValueCount = 0;
};

static constexpr i32 kTerrainShapeVertexIndices0[] = {1, 3, 5, 7};
static constexpr i32 kTerrainShapeVertexIndices1[] = {1, 3, 5, 7};
static constexpr i32 kTerrainShapeVertexIndices2[] = {1, 3, 5, 7};
static constexpr i32 kTerrainShapeVertexIndices3[] = {1, 3, 5, 7, 6};
static constexpr i32 kTerrainShapeVertexIndices4[] = {1, 3, 5, 7, 6};
static constexpr i32 kTerrainShapeVertexIndices5[] = {1, 3, 5, 7, 6};
static constexpr i32 kTerrainShapeVertexIndices6[] = {1, 3, 5, 7, 6};
static constexpr i32 kTerrainShapeVertexIndices7[] = {1, 3, 5, 7, 2, 6};
static constexpr i32 kTerrainShapeVertexIndices8[] = {1, 3, 5, 7, 2, 8};
static constexpr i32 kTerrainShapeVertexIndices9[] = {1, 3, 5, 7, 2, 8};
static constexpr i32 kTerrainShapeVertexIndices10[] = {1, 3, 5, 7, 11, 12};
static constexpr i32 kTerrainShapeVertexIndices11[] = {1, 3, 5, 7, 11, 12};
static constexpr i32 kTerrainShapeVertexIndices12[] = {1, 3, 5, 7, 13, 14};

static constexpr i32 kTerrainShapeFaces0[] = {0, 1, 2, 3, 0, 0, 1, 3};
static constexpr i32 kTerrainShapeFaces1[] = {1, 1, 2, 3, 1, 0, 1, 3};
static constexpr i32 kTerrainShapeFaces2[] = {0, 1, 2, 3, 1, 0, 1, 3};
static constexpr i32 kTerrainShapeFaces3[] = {0, 0, 1, 2, 0, 0, 2, 4, 1, 0, 4, 3};
static constexpr i32 kTerrainShapeFaces4[] = {0, 0, 1, 4, 0, 0, 4, 3, 1, 1, 2, 4};
static constexpr i32 kTerrainShapeFaces5[] = {0, 0, 4, 3, 1, 0, 1, 2, 1, 0, 2, 4};
static constexpr i32 kTerrainShapeFaces6[] = {0, 1, 2, 4, 1, 0, 1, 4, 1, 0, 4, 3};
static constexpr i32 kTerrainShapeFaces7[] = {0, 4, 1, 2, 0, 4, 2, 5, 1, 0, 4, 5, 1, 0, 5, 3};
static constexpr i32 kTerrainShapeFaces8[] = {0, 4, 1, 2, 0, 4, 2, 3, 0, 4, 3, 5, 1, 0, 4, 5};
static constexpr i32 kTerrainShapeFaces9[] = {0, 0, 4, 5, 1, 4, 1, 2, 1, 4, 2, 3, 1, 4, 3, 5};
static constexpr i32 kTerrainShapeFaces10[] = {
    0, 0, 1, 5, 0, 1, 4, 5, 0, 1, 2, 4,
    1, 0, 5, 3, 1, 5, 4, 3, 1, 4, 2, 3,
};
static constexpr i32 kTerrainShapeFaces11[] = {
    1, 0, 1, 5, 1, 1, 4, 5, 1, 1, 2, 4,
    0, 0, 5, 3, 0, 5, 4, 3, 0, 4, 2, 3,
};
static constexpr i32 kTerrainShapeFaces12[] = {
    1, 0, 5, 4, 1, 0, 1, 5, 0, 0, 4, 3,
    0, 4, 5, 3, 0, 5, 2, 3, 0, 1, 2, 5,
};

static constexpr bool kBlendableOverlayNeighborEdgeEligibilityByShape[13][4] = {
    {false, false, false, false},
    {false, true, true, false},
    {true, false, true, false},
    {true, false, true, false},
    {false, false, true, false},
    {false, false, true, false},
    {true, false, true, false},
    {true, false, false, true},
    {true, false, false, true},
    {true, true, false, false},
    {false, false, false, false},
    {false, true, false, true},
    {false, false, false, false},
};

static constexpr bool kNonBlendableOverlayNeighborEdgeEligibilityByShape[13][4] = {
    {false, false, false, false},
    {false, false, false, false},
    {false, false, true, false},
    {false, false, true, false},
    {false, false, true, false},
    {false, false, true, false},
    {true, false, true, false},
    {true, false, false, true},
    {true, false, false, true},
    {false, false, false, false},
    {false, false, false, false},
    {false, false, false, false},
    {false, false, false, false},
};

static TerrainShapeDef terrainShapeDef(i32 shapeId) noexcept {
    switch (shapeId) {
        case 0: return TerrainShapeDef{kTerrainShapeVertexIndices0, 4, kTerrainShapeFaces0, 8};
        case 1: return TerrainShapeDef{kTerrainShapeVertexIndices1, 4, kTerrainShapeFaces1, 8};
        case 2: return TerrainShapeDef{kTerrainShapeVertexIndices2, 4, kTerrainShapeFaces2, 8};
        case 3: return TerrainShapeDef{kTerrainShapeVertexIndices3, 5, kTerrainShapeFaces3, 12};
        case 4: return TerrainShapeDef{kTerrainShapeVertexIndices4, 5, kTerrainShapeFaces4, 12};
        case 5: return TerrainShapeDef{kTerrainShapeVertexIndices5, 5, kTerrainShapeFaces5, 12};
        case 6: return TerrainShapeDef{kTerrainShapeVertexIndices6, 5, kTerrainShapeFaces6, 12};
        case 7: return TerrainShapeDef{kTerrainShapeVertexIndices7, 6, kTerrainShapeFaces7, 16};
        case 8: return TerrainShapeDef{kTerrainShapeVertexIndices8, 6, kTerrainShapeFaces8, 16};
        case 9: return TerrainShapeDef{kTerrainShapeVertexIndices9, 6, kTerrainShapeFaces9, 16};
        case 10: return TerrainShapeDef{kTerrainShapeVertexIndices10, 6, kTerrainShapeFaces10, 24};
        case 11: return TerrainShapeDef{kTerrainShapeVertexIndices11, 6, kTerrainShapeFaces11, 24};
        case 12: return TerrainShapeDef{kTerrainShapeVertexIndices12, 6, kTerrainShapeFaces12, 24};
        default: return TerrainShapeDef{kTerrainShapeVertexIndices0, 4, kTerrainShapeFaces0, 8};
    }
}

} // namespace

void computeOverlayEdgeEligibility(
    i32 shapeRaw,
    i32 rotation,
    bool blendable,
    bool outWorld[4]) noexcept {
    const auto& table = blendable
        ? kBlendableOverlayNeighborEdgeEligibilityByShape
        : kNonBlendableOverlayNeighborEdgeEligibilityByShape;
    const bool* local = (shapeRaw >= 0 && shapeRaw < 13)
        ? table[shapeRaw]
        : table[0];

    for (i32 worldEdge = 0; worldEdge < 4; worldEdge++) {
        const i32 localEdge = (worldEdge - rotation) & 3;
        outWorld[worldEdge] = local[localEdge];
    }
}

i32 adjustUnderlayLight(i32 hsl, i32 light) noexcept {
    if (hsl == -1) {
        return kTerrainInvalidHslColor;
    }
    i32 outLight = ((hsl & 127) * light) >> 7;
    if (outLight < 2) {
        outLight = 2;
    } else if (outLight > 126) {
        outLight = 126;
    }
    return (hsl & 0xff80) + outLight;
}

i32 adjustOverlayLight(i32 hsl, i32 light) noexcept {
    if (hsl == -2) {
        return kTerrainInvalidHslColor;
    }
    if (hsl == -1) {
        i32 outLight = light;
        if (outLight < 2) {
            outLight = 2;
        } else if (outLight > 126) {
            outLight = 126;
        }
        return outLight;
    }

    i32 outLight = ((hsl & 127) * light) >> 7;
    if (outLight < 2) {
        outLight = 2;
    } else if (outLight > 126) {
        outLight = 126;
    }
    return (hsl & 0xff80) + outLight;
}

i32 mixHsl(i32 hslA, i32 hslB) noexcept {
    if (hslA == kTerrainInvalidHslColor || hslB == kTerrainInvalidHslColor) {
        return kTerrainInvalidHslColor;
    }
    if (hslA == -1) {
        return hslB;
    }
    if (hslB == -1) {
        return hslA;
    }

    i32 hue = ((hslA >> 10) & 0x3f) + ((hslB >> 10) & 0x3f);
    i32 sat = ((hslA >> 7) & 0x7) + ((hslB >> 7) & 0x7);
    i32 light = (hslA & 0x7f) + (hslB & 0x7f);
    hue >>= 1;
    sat >>= 1;
    light >>= 1;
    return (hue << 10) + (sat << 7) + light;
}

Status appendTerrainTileGeometry(
    const SceneData& scene,
    i32 level,
    i32 x,
    i32 y,
    i32 vertexOffset,
    i32 shapeId,
    i32 rotation,
    bool hasOverlay,
    bool hasUnderlay,
    i32 underlayHslSw,
    i32 underlayHslSe,
    i32 underlayHslNe,
    i32 underlayHslNw,
    i32 overlayHslSw,
    i32 overlayHslSe,
    i32 overlayHslNe,
    i32 overlayHslNw,
    i32 overlayHslSAvg,
    i32 overlayHslEAvg,
    i32 overlayHslNAvg,
    i32 overlayHslWAvg,
    bool useOverlayEdgeHsls,
    i32 underlayTexturePacked,
    i32 underlayTextureSize,
    const i32* overlayCornerTexturePacked,
    const i32* overlayCornerTextureSize,
    const i32* overlayEdgeTexturePacked,
    const i32* overlayEdgeTextureSize,
    bool* outFaceColorsAAllValid,
    SceneCommandStream* debugOut,
    Vec<u8>* outVertices,
    Vec<i32>* outIndices,
    i32* outLevelElements) noexcept {
    if (!outVertices || !outIndices || !outLevelElements) {
        return Status::InvalidArgument;
    }
    if (outFaceColorsAAllValid) {
        *outFaceColorsAAllValid = true;
    }

    TerrainShapeDef shape = terrainShapeDef(shapeId);
    if (!shape.vertexIndices || !shape.faceValues || shape.vertexCount <= 0 || shape.faceValueCount <= 0) {
        return Status::InvalidArgument;
    }

    i32 vertexX[8]{};
    i32 vertexY[8]{};
    i32 vertexZ[8]{};
    i32 underlayHsls[8]{};
    i32 overlayHsls[8]{};
    i32 chosenCornerIndex[8]{};
    float chosenCornerWeight[8]{};
    i32 edgeForVertex[8]{};
    for (i32 i = 0; i < 8; i++) {
        edgeForVertex[static_cast<std::size_t>(i)] = -1;
    }

    const i32 tileBaseX = x * kTerrainTileSize + vertexOffset;
    const i32 tileBaseZ = y * kTerrainTileSize + vertexOffset;

    for (i32 i = 0; i < shape.vertexCount; i++) {
        i32 vertexIndex = shape.vertexIndices[static_cast<std::size_t>(i)];
        if ((vertexIndex & 1) == 0 && vertexIndex <= 8) {
            vertexIndex = ((vertexIndex - rotation - rotation - 1) & 7) + 1;
        }
        if (vertexIndex > 8 && vertexIndex <= 12) {
            vertexIndex = ((vertexIndex - 9 - rotation) & 3) + 9;
        }
        if (vertexIndex > 12 && vertexIndex <= 16) {
            vertexIndex = ((vertexIndex - 13 - rotation) & 3) + 13;
        }

        if (vertexIndex == 2) {
            edgeForVertex[static_cast<std::size_t>(i)] = 0;
        } else if (vertexIndex == 4) {
            edgeForVertex[static_cast<std::size_t>(i)] = 1;
        } else if (vertexIndex == 6) {
            edgeForVertex[static_cast<std::size_t>(i)] = 2;
        } else if (vertexIndex == 8) {
            edgeForVertex[static_cast<std::size_t>(i)] = 3;
        }

        i32 vx = 0;
        i32 vz = 0;
        i32 vy = 0;
        i32 vhUnderlay = 0;
        i32 vhOverlay = 0;

        if (vertexIndex == 1) {
            vx = tileBaseX;
            vz = tileBaseZ;
            vy = scene.height(level, x, y);
            vhUnderlay = underlayHslSw;
            vhOverlay = overlayHslSw;
        } else if (vertexIndex == 2) {
            vx = tileBaseX + kTerrainHalfTileSize;
            vz = tileBaseZ;
            vy = (scene.height(level, x + 1, y) + scene.height(level, x, y)) >> 1;
            vhUnderlay = mixHsl(underlayHslSe, underlayHslSw);
            vhOverlay = useOverlayEdgeHsls ? overlayHslSAvg : ((overlayHslSe + overlayHslSw) >> 1);
        } else if (vertexIndex == 3) {
            vx = tileBaseX + kTerrainTileSize;
            vz = tileBaseZ;
            vy = scene.height(level, x + 1, y);
            vhUnderlay = underlayHslSe;
            vhOverlay = overlayHslSe;
        } else if (vertexIndex == 4) {
            vx = tileBaseX + kTerrainTileSize;
            vz = tileBaseZ + kTerrainHalfTileSize;
            vy = (scene.height(level, x + 1, y + 1) + scene.height(level, x + 1, y)) >> 1;
            vhUnderlay = mixHsl(underlayHslSe, underlayHslNe);
            vhOverlay = useOverlayEdgeHsls ? overlayHslEAvg : ((overlayHslSe + overlayHslNe) >> 1);
        } else if (vertexIndex == 5) {
            vx = tileBaseX + kTerrainTileSize;
            vz = tileBaseZ + kTerrainTileSize;
            vy = scene.height(level, x + 1, y + 1);
            vhUnderlay = underlayHslNe;
            vhOverlay = overlayHslNe;
        } else if (vertexIndex == 6) {
            vx = tileBaseX + kTerrainHalfTileSize;
            vz = tileBaseZ + kTerrainTileSize;
            vy = (scene.height(level, x + 1, y + 1) + scene.height(level, x, y + 1)) >> 1;
            vhUnderlay = mixHsl(underlayHslNw, underlayHslNe);
            vhOverlay = useOverlayEdgeHsls ? overlayHslNAvg : ((overlayHslNw + overlayHslNe) >> 1);
        } else if (vertexIndex == 7) {
            vx = tileBaseX;
            vz = tileBaseZ + kTerrainTileSize;
            vy = scene.height(level, x, y + 1);
            vhUnderlay = underlayHslNw;
            vhOverlay = overlayHslNw;
        } else if (vertexIndex == 8) {
            vx = tileBaseX;
            vz = tileBaseZ + kTerrainHalfTileSize;
            vy = (scene.height(level, x, y + 1) + scene.height(level, x, y)) >> 1;
            vhUnderlay = mixHsl(underlayHslNw, underlayHslSw);
            vhOverlay = useOverlayEdgeHsls ? overlayHslWAvg : ((overlayHslNw + overlayHslSw) >> 1);
        } else if (vertexIndex == 9) {
            vx = tileBaseX + kTerrainHalfTileSize;
            vz = tileBaseZ + kTerrainQuarterTileSize;
            vy = (scene.height(level, x + 1, y) + scene.height(level, x, y)) >> 1;
            vhUnderlay = mixHsl(underlayHslSe, underlayHslSw);
            vhOverlay = (overlayHslSe + overlayHslSw) >> 1;
        } else if (vertexIndex == 10) {
            vx = tileBaseX + kTerrainThreeQuarterTileSize;
            vz = tileBaseZ + kTerrainHalfTileSize;
            vy = (scene.height(level, x + 1, y + 1) + scene.height(level, x + 1, y)) >> 1;
            vhUnderlay = mixHsl(underlayHslSe, underlayHslNe);
            vhOverlay = (overlayHslSe + overlayHslNe) >> 1;
        } else if (vertexIndex == 11) {
            vx = tileBaseX + kTerrainHalfTileSize;
            vz = tileBaseZ + kTerrainThreeQuarterTileSize;
            vy = (scene.height(level, x + 1, y + 1) + scene.height(level, x, y + 1)) >> 1;
            vhUnderlay = mixHsl(underlayHslNw, underlayHslNe);
            vhOverlay = (overlayHslNw + overlayHslNe) >> 1;
        } else if (vertexIndex == 12) {
            vx = tileBaseX + kTerrainQuarterTileSize;
            vz = tileBaseZ + kTerrainHalfTileSize;
            vy = (scene.height(level, x, y + 1) + scene.height(level, x, y)) >> 1;
            vhUnderlay = mixHsl(underlayHslNw, underlayHslSw);
            vhOverlay = (overlayHslNw + overlayHslSw) >> 1;
        } else if (vertexIndex == 13) {
            vx = tileBaseX + kTerrainQuarterTileSize;
            vz = tileBaseZ + kTerrainQuarterTileSize;
            vy = scene.height(level, x, y);
            vhUnderlay = underlayHslSw;
            vhOverlay = overlayHslSw;
        } else if (vertexIndex == 14) {
            vx = tileBaseX + kTerrainThreeQuarterTileSize;
            vz = tileBaseZ + kTerrainQuarterTileSize;
            vy = scene.height(level, x + 1, y);
            vhUnderlay = underlayHslSe;
            vhOverlay = overlayHslSe;
        } else if (vertexIndex == 15) {
            vx = tileBaseX + kTerrainThreeQuarterTileSize;
            vz = tileBaseZ + kTerrainThreeQuarterTileSize;
            vy = scene.height(level, x + 1, y + 1);
            vhUnderlay = underlayHslNe;
            vhOverlay = overlayHslNe;
        } else {
            vx = tileBaseX + kTerrainQuarterTileSize;
            vz = tileBaseZ + kTerrainThreeQuarterTileSize;
            vy = scene.height(level, x, y + 1);
            vhUnderlay = underlayHslNw;
            vhOverlay = overlayHslNw;
        }

        vertexX[static_cast<std::size_t>(i)] = vx;
        vertexY[static_cast<std::size_t>(i)] = vy;
        vertexZ[static_cast<std::size_t>(i)] = vz;
        underlayHsls[static_cast<std::size_t>(i)] = vhUnderlay;
        overlayHsls[static_cast<std::size_t>(i)] = vhOverlay;

        const float localU = static_cast<float>(vx - tileBaseX) / static_cast<float>(kTerrainTileSize);
        const float localV = static_cast<float>(vz - tileBaseZ) / static_cast<float>(kTerrainTileSize);
        const float wSw = (1.0f - localU) * (1.0f - localV);
        const float wSe = localU * (1.0f - localV);
        const float wNe = localU * localV;
        const float wNw = (1.0f - localU) * localV;

        i32 corner = 0;
        float best = wSw;
        if (wSe > best) {
            best = wSe;
            corner = 1;
        }
        if (wNe > best) {
            best = wNe;
            corner = 2;
        }
        if (wNw > best) {
            best = wNw;
            corner = 3;
        }
        chosenCornerIndex[static_cast<std::size_t>(i)] = corner;
        chosenCornerWeight[static_cast<std::size_t>(i)] = best;
    }

    auto appendTerrainPackedVertexIndex = [&](
        i32 px,
        i32 py,
        i32 pz,
        i32 phsl,
        i32 palpha,
        float pu,
        float pv,
        i32 ppriority,
        i32 ptextureId,
        i32 ptextureId1,
        float ptextureBlend,
        i32* outIndex) noexcept {
        if (!outIndex) {
            return Status::InvalidArgument;
        }
        const i32 index = static_cast<i32>(outVertices->size() / 16);
        const Status vs = PackedVertex::append(
            outVertices,
            px,
            py,
            pz,
            phsl,
            palpha,
            pu,
            pv,
            ppriority,
            ptextureId,
            ptextureId1,
            ptextureBlend);
        if (!ok(vs)) {
            return vs;
        }
        *outIndex = index;
        return Status::Ok;
    };

    const i32 faceCount = shape.faceValueCount / 4;
    i32 faceOff = 0;
    for (i32 fi = 0; fi < faceCount; fi++) {
        const i32 faceOverlayFlag = shape.faceValues[static_cast<std::size_t>(faceOff++)];
        const bool faceIsOverlay = hasOverlay && (faceOverlayFlag == 1);
        i32 a = shape.faceValues[static_cast<std::size_t>(faceOff++)];
        i32 b = shape.faceValues[static_cast<std::size_t>(faceOff++)];
        i32 c = shape.faceValues[static_cast<std::size_t>(faceOff++)];

        if (a < 4) {
            a = (a - rotation) & 3;
        }
        if (b < 4) {
            b = (b - rotation) & 3;
        }
        if (c < 4) {
            c = (c - rotation) & 3;
        }

        i32 hslA = faceIsOverlay ? overlayHsls[static_cast<std::size_t>(a)] : underlayHsls[static_cast<std::size_t>(a)];
        i32 hslB = faceIsOverlay ? overlayHsls[static_cast<std::size_t>(b)] : underlayHsls[static_cast<std::size_t>(b)];
        i32 hslC = faceIsOverlay ? overlayHsls[static_cast<std::size_t>(c)] : underlayHsls[static_cast<std::size_t>(c)];

        if (outFaceColorsAAllValid && hslA == kTerrainInvalidHslColor) {
            *outFaceColorsAAllValid = false;
        }

        i32 texturePacked = underlayTexturePacked;
        i32 textureSizeRaw = underlayTextureSize;
        i32 texturePacked1 = -1;
        float texBlendA = 0.0f;
        float texBlendB = 0.0f;
        float texBlendC = 0.0f;

        if (faceIsOverlay) {
            float cornerWeights[4]{0.0f, 0.0f, 0.0f, 0.0f};
            const i32 ca = chosenCornerIndex[static_cast<std::size_t>(a)];
            const i32 cb = chosenCornerIndex[static_cast<std::size_t>(b)];
            const i32 cc = chosenCornerIndex[static_cast<std::size_t>(c)];
            cornerWeights[static_cast<std::size_t>(ca)] += chosenCornerWeight[static_cast<std::size_t>(a)];
            cornerWeights[static_cast<std::size_t>(cb)] += chosenCornerWeight[static_cast<std::size_t>(b)];
            cornerWeights[static_cast<std::size_t>(cc)] += chosenCornerWeight[static_cast<std::size_t>(c)];

            i32 bestCorner = 0;
            float bestWeight = cornerWeights[0];
            for (i32 ci = 1; ci < 4; ci++) {
                if (cornerWeights[static_cast<std::size_t>(ci)] > bestWeight) {
                    bestWeight = cornerWeights[static_cast<std::size_t>(ci)];
                    bestCorner = ci;
                }
            }

            texturePacked = overlayCornerTexturePacked ? overlayCornerTexturePacked[static_cast<std::size_t>(bestCorner)] : -1;
            textureSizeRaw = overlayCornerTextureSize ? overlayCornerTextureSize[static_cast<std::size_t>(bestCorner)] : kTerrainTileSize;

            const i32 faceTextureSize = (textureSizeRaw > 0) ? textureSizeRaw : kTerrainTileSize;
            if (texturePacked != -1 && overlayCornerTexturePacked && overlayCornerTextureSize && overlayEdgeTexturePacked && overlayEdgeTextureSize) {
                auto prefForVertex = [&](i32 v, i32* outTex, i32* outSize) {
                    const i32 corner = chosenCornerIndex[static_cast<std::size_t>(v)];
                    i32 tex = overlayCornerTexturePacked[static_cast<std::size_t>(corner)];
                    i32 size = overlayCornerTextureSize[static_cast<std::size_t>(corner)];
                    const i32 edge = edgeForVertex[static_cast<std::size_t>(v)];
                    if (edge != -1) {
                        const i32 edgeTex = overlayEdgeTexturePacked[static_cast<std::size_t>(edge)];
                        if (edgeTex != -1) {
                            tex = edgeTex;
                            size = overlayEdgeTextureSize[static_cast<std::size_t>(edge)];
                        }
                    }
                    if (size <= 0) {
                        size = kTerrainTileSize;
                    }
                    *outTex = tex;
                    *outSize = size;
                };

                i32 pA = -1, pB = -1, pC = -1;
                i32 sA = kTerrainTileSize, sB = kTerrainTileSize, sC = kTerrainTileSize;
                prefForVertex(a, &pA, &sA);
                prefForVertex(b, &pB, &sB);
                prefForVertex(c, &pC, &sC);

                i32 candidate = -1;
                i32 candidateCount = 0;
                auto consider = [&](i32 texId, i32 texSize) {
                    if (texId == -1 || texId == texturePacked || texSize != faceTextureSize) {
                        return;
                    }
                    i32 count = 0;
                    if (pA == texId && sA == texSize) count++;
                    if (pB == texId && sB == texSize) count++;
                    if (pC == texId && sC == texSize) count++;
                    if (count > candidateCount) {
                        candidate = texId;
                        candidateCount = count;
                    }
                };

                consider(pA, sA);
                consider(pB, sB);
                consider(pC, sC);

                if (candidate != -1 && candidateCount > 0) {
                    texBlendA = (pA == candidate && sA == faceTextureSize) ? 1.0f : 0.0f;
                    texBlendB = (pB == candidate && sB == faceTextureSize) ? 1.0f : 0.0f;
                    texBlendC = (pC == candidate && sC == faceTextureSize) ? 1.0f : 0.0f;

                    const i32 sum = static_cast<i32>(texBlendA) + static_cast<i32>(texBlendB) + static_cast<i32>(texBlendC);
                    if (sum == 3) {
                        texturePacked = candidate;
                        texturePacked1 = -1;
                        texBlendA = 0.0f;
                        texBlendB = 0.0f;
                        texBlendC = 0.0f;
                    } else if (sum > 0) {
                        texturePacked1 = candidate;
                    }
                }
            }
        }

        const i32 textureSize = textureSizeRaw > 0 ? textureSizeRaw : kTerrainTileSize;

        if (hslA == kTerrainInvalidHslColor && texturePacked == -1) {
            continue;
        }

        const float u0 = static_cast<float>(vertexX[static_cast<std::size_t>(a)] - tileBaseX) /
            static_cast<float>(textureSize);
        const float v0 = static_cast<float>(vertexZ[static_cast<std::size_t>(a)] - tileBaseZ) /
            static_cast<float>(textureSize);
        const float u1 = static_cast<float>(vertexX[static_cast<std::size_t>(b)] - tileBaseX) /
            static_cast<float>(textureSize);
        const float v1 = static_cast<float>(vertexZ[static_cast<std::size_t>(b)] - tileBaseZ) /
            static_cast<float>(textureSize);
        const float u2 = static_cast<float>(vertexX[static_cast<std::size_t>(c)] - tileBaseX) /
            static_cast<float>(textureSize);
        const float v2 = static_cast<float>(vertexZ[static_cast<std::size_t>(c)] - tileBaseZ) /
            static_cast<float>(textureSize);

        i32 idxA = 0;
        i32 idxB = 0;
        i32 idxC = 0;

        Status vs = appendTerrainPackedVertexIndex(
            vertexX[static_cast<std::size_t>(a)],
            vertexY[static_cast<std::size_t>(a)],
            vertexZ[static_cast<std::size_t>(a)],
            hslA,
            0xff,
            u0,
            v0,
            0,
            texturePacked,
            texturePacked1,
            texBlendA,
            &idxA);
        if (!ok(vs)) {
            return vs;
        }

        vs = appendTerrainPackedVertexIndex(
            vertexX[static_cast<std::size_t>(b)],
            vertexY[static_cast<std::size_t>(b)],
            vertexZ[static_cast<std::size_t>(b)],
            hslB,
            0xff,
            u1,
            v1,
            0,
            texturePacked,
            texturePacked1,
            texBlendB,
            &idxB);
        if (!ok(vs)) {
            return vs;
        }

        vs = appendTerrainPackedVertexIndex(
            vertexX[static_cast<std::size_t>(c)],
            vertexY[static_cast<std::size_t>(c)],
            vertexZ[static_cast<std::size_t>(c)],
            hslC,
            0xff,
            u2,
            v2,
            0,
            texturePacked,
            texturePacked1,
            texBlendC,
            &idxC);
        if (!ok(vs)) {
            return vs;
        }

        auto rr = outIndices->pushBack(idxA);
        if (!rr.isOk()) {
            return rr.status();
        }
        rr = outIndices->pushBack(idxB);
        if (!rr.isOk()) {
            return rr.status();
        }
        rr = outIndices->pushBack(idxC);
        if (!rr.isOk()) {
            return rr.status();
        }
        *outLevelElements += 3;
        if (debugOut) {
            debugOut->debugTerrainFacesEmitted++;
            terrainDigestUpdateVertex(
                debugOut,
                vertexX[static_cast<std::size_t>(a)],
                vertexY[static_cast<std::size_t>(a)],
                vertexZ[static_cast<std::size_t>(a)],
                hslA,
                u0,
                v0,
                texturePacked,
                texturePacked1,
                texBlendA);
            terrainDigestUpdateVertex(
                debugOut,
                vertexX[static_cast<std::size_t>(b)],
                vertexY[static_cast<std::size_t>(b)],
                vertexZ[static_cast<std::size_t>(b)],
                hslB,
                u1,
                v1,
                texturePacked,
                texturePacked1,
                texBlendB);
            terrainDigestUpdateVertex(
                debugOut,
                vertexX[static_cast<std::size_t>(c)],
                vertexY[static_cast<std::size_t>(c)],
                vertexZ[static_cast<std::size_t>(c)],
                hslC,
                u2,
                v2,
                texturePacked,
                texturePacked1,
                texBlendC);
            terrainDigestAccumulateFace(debugOut, level);
            if (faceIsOverlay) {
                if (level == 0) debugOut->debugTerrainFacesOverlayLevel0++;
                else if (level == 1) debugOut->debugTerrainFacesOverlayLevel1++;
                else if (level == 2) debugOut->debugTerrainFacesOverlayLevel2++;
                else if (level == 3) debugOut->debugTerrainFacesOverlayLevel3++;
            } else {
                if (level == 0) debugOut->debugTerrainFacesUnderlayLevel0++;
                else if (level == 1) debugOut->debugTerrainFacesUnderlayLevel1++;
                else if (level == 2) debugOut->debugTerrainFacesUnderlayLevel2++;
                else if (level == 3) debugOut->debugTerrainFacesUnderlayLevel3++;
            }
        }
    }

    return Status::Ok;
}

} // namespace rs
