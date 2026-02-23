struct ObjSpawnRecord final {
    i32 id = -1;
    i32 count = 1;
    i32 x = 0;
    i32 y = 0;
    i32 plane = 0;
};

static Status readI32Le(Span<const u8> bytes, i32 off, i32* out) noexcept {
    if (!out) {
        return Status::InvalidArgument;
    }
    if (off < 0 || off > static_cast<i32>(bytes.size()) - 4) {
        return Status::OutOfRange;
    }
    const u32 b0 = static_cast<u32>(bytes[static_cast<std::size_t>(off + 0)]);
    const u32 b1 = static_cast<u32>(bytes[static_cast<std::size_t>(off + 1)]);
    const u32 b2 = static_cast<u32>(bytes[static_cast<std::size_t>(off + 2)]);
    const u32 b3 = static_cast<u32>(bytes[static_cast<std::size_t>(off + 3)]);
    const u32 v = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    *out = static_cast<i32>(v);
    return Status::Ok;
}

static Status decodeObjSpawnsForMap(
    const SceneCommandBuildInput& input,
    i32 mapId,
    Vec<ObjSpawnRecord>* outSpawns) noexcept {
    if (!outSpawns) {
        return Status::InvalidArgument;
    }
    outSpawns->clear();
    const i32 mapIdx = findTypeBlobIndex(input.objSpawnMapIds, mapId);
    if (mapIdx < 0) {
        return Status::NotFound;
    }
    if (mapIdx >= static_cast<i32>(input.objSpawnOffsets.size()) ||
        mapIdx >= static_cast<i32>(input.objSpawnLengths.size())) {
        return Status::SizeMismatch;
    }
    const i32 off = input.objSpawnOffsets[static_cast<std::size_t>(mapIdx)];
    const i32 len = input.objSpawnLengths[static_cast<std::size_t>(mapIdx)];
    if (off < 0 || len <= 0) {
        return Status::NotFound;
    }
    if (off > static_cast<i32>(input.objSpawnBytes.size()) ||
        len > static_cast<i32>(input.objSpawnBytes.size()) - off) {
        return Status::OutOfRange;
    }
    if ((len % 20) != 0) {
        return Status::BadFormat;
    }

    const i32 count = len / 20;
    auto rr = outSpawns->resize(static_cast<std::size_t>(count));
    if (!rr.isOk()) {
        return rr.status();
    }

    Span<const u8> bytes(
        input.objSpawnBytes.data() + off,
        static_cast<std::size_t>(len));
    for (i32 i = 0; i < count; i++) {
        const i32 b = i * 20;
        ObjSpawnRecord rec{};
        Status rs = readI32Le(bytes, b + 0, &rec.id);
        if (!ok(rs)) {
            return rs;
        }
        rs = readI32Le(bytes, b + 4, &rec.count);
        if (!ok(rs)) {
            return rs;
        }
        rs = readI32Le(bytes, b + 8, &rec.x);
        if (!ok(rs)) {
            return rs;
        }
        rs = readI32Le(bytes, b + 12, &rec.y);
        if (!ok(rs)) {
            return rs;
        }
        rs = readI32Le(bytes, b + 16, &rec.plane);
        if (!ok(rs)) {
            return rs;
        }
        if (rec.count <= 0) {
            rec.count = 1;
        }
        (*outSpawns)[static_cast<std::size_t>(i)] = rec;
    }

    return Status::Ok;
}

static Status appendObjPlacementGeometry(
    const SceneCommandBuildInput& input,
    const ObjType& resolved,
    i32 modelId,
    i32 sceneX,
    i32 sceneZ,
    i32 sceneHeight,
    bool transparentOnly,
    Vec<u8>* outVertices,
    Vec<i32>* outIndices,
    i32* outElements,
    Allocator& alloc) noexcept {
    if (!outVertices || !outIndices || !outElements) {
        return Status::InvalidArgument;
    }
    *outElements = 0;

    ModelData model(alloc);
    const Status ms = tryDecodeObjModelFromBlob(input, resolved, modelId, &model, alloc);
    if (!ok(ms)) {
        return ms;
    }

    const i32 ambient = resolved.ambient + 64;
    const i32 contrast = resolved.contrast + 768;
    const i32 lightIntensity = modelLightIntensity(contrast);

    ModelFaceLightingState lighting(alloc);
    const Status ls = initModelFaceLightingState(model, &lighting, alloc);
    if (!ok(ls)) {
        return ls;
    }

    for (i32 fi = 0; fi < model.faceCount; fi++) {
        i32 renderType = modelFaceRenderType(model, fi);
        const i32 textureId = modelFaceRawTextureId(model, fi);
        const i32 rawAlphaSigned = modelFaceRawAlpha(model, fi);
        if (rawAlphaSigned == -2) {
            renderType = 3;
        } else if (rawAlphaSigned == -1) {
            renderType = 2;
        }

        const i32 packedTextureId = mapTextureIdToPackedIndex(input.textureIds, textureId);
        const i32 effectiveTextureId = packedTextureId != -1 ? textureId : -1;

        i32 alpha = 0xff;
        if (model.hasFaceAlphas &&
            effectiveTextureId == -1 &&
            fi < static_cast<i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<i32>(model.faceAlphas[static_cast<std::size_t>(fi)]) & 0xff);
        }
        if (alpha == 0 || alpha == 1) {
            continue;
        }

        if (effectiveTextureId == -1) {
            if (renderType != 0 && renderType != 1 && renderType != 3) {
                continue;
            }
        } else {
            if (renderType != 0 && renderType != 1) {
                continue;
            }
        }

        const bool textureAlpha =
            effectiveTextureId != -1 &&
            isTextureTransparent(input.textureTransparentIds, effectiveTextureId);
        const bool transparent =
            alpha < 0xff ||
            textureAlpha;
        if (transparent != transparentOnly) {
            continue;
        }

        if (fi >= static_cast<i32>(model.indices1.size()) ||
            fi >= static_cast<i32>(model.indices2.size()) ||
            fi >= static_cast<i32>(model.indices3.size()) ||
            fi >= static_cast<i32>(model.faceColors.size())) {
            continue;
        }
        const i32 ia = model.indices1[static_cast<std::size_t>(fi)];
        const i32 ib = model.indices2[static_cast<std::size_t>(fi)];
        const i32 ic = model.indices3[static_cast<std::size_t>(fi)];
        if (ia < 0 || ib < 0 || ic < 0 ||
            ia >= static_cast<i32>(model.verticesX.size()) ||
            ib >= static_cast<i32>(model.verticesX.size()) ||
            ic >= static_cast<i32>(model.verticesX.size()) ||
            ia >= static_cast<i32>(model.verticesY.size()) ||
            ib >= static_cast<i32>(model.verticesY.size()) ||
            ic >= static_cast<i32>(model.verticesY.size()) ||
            ia >= static_cast<i32>(model.verticesZ.size()) ||
            ib >= static_cast<i32>(model.verticesZ.size()) ||
            ic >= static_cast<i32>(model.verticesZ.size())) {
            continue;
        }

        i32 priority = 0;
            if (fi < static_cast<i32>(model.faceRenderPriorities.size())) {
                priority = static_cast<i32>(model.faceRenderPriorities[static_cast<std::size_t>(fi)]);
            }

            const i32 baseColor = static_cast<i32>(model.faceColors[static_cast<std::size_t>(fi)] & 0xffffu);
        i32 hslA = baseColor;
        i32 hslB = baseColor;
        i32 hslC = baseColor;
        if (renderType == 0) {
            const i32 shadeA = modelVertexShade(lighting, ia, ambient, lightIntensity);
            const i32 shadeB = modelVertexShade(lighting, ib, ambient, lightIntensity);
            const i32 shadeC = modelVertexShade(lighting, ic, ambient, lightIntensity);
            if (effectiveTextureId == -1) {
                hslA = modelAdjustLightness(baseColor, shadeA);
                hslB = modelAdjustLightness(baseColor, shadeB);
                hslC = modelAdjustLightness(baseColor, shadeC);
            } else {
                hslA = modelClampLightness(shadeA);
                hslB = modelClampLightness(shadeB);
                hslC = modelClampLightness(shadeC);
            }
        } else if (renderType == 1) {
            const i32 shade = modelFaceShade(lighting, fi, ambient, lightIntensity);
            if (effectiveTextureId == -1) {
                hslA = modelAdjustLightness(baseColor, shade);
            } else {
                hslA = modelClampLightness(shade);
            }
            hslB = hslA;
            hslC = hslA;
        } else if (renderType == 3) {
            hslA = 128;
            hslB = 128;
            hslC = 128;
        }

        float u0 = 0.0f;
            float v0 = 0.0f;
            float u1 = 0.0f;
            float v1 = 0.0f;
            float u2 = 0.0f;
            float v2 = 0.0f;
        if (effectiveTextureId != -1) {
            i32 texCoord = -1;
            if (model.hasTextureCoords && fi < static_cast<i32>(model.textureCoords.size())) {
                texCoord = static_cast<i32>(model.textureCoords[static_cast<std::size_t>(fi)]);
            }
            i32 textureRenderType = 0;
            if (texCoord != -1) {
                const i32 tc = texCoord & 0xff;
                if (tc >= 0 && tc < static_cast<i32>(model.textureRenderTypes.size())) {
                    textureRenderType =
                        static_cast<i32>(model.textureRenderTypes[static_cast<std::size_t>(tc)]) & 0xff;
                }
            }
            if (textureRenderType == 0) {
                computeModelFaceUvType0(
                    model,
                    fi,
                    texCoord,
                    &u0,
                    &v0,
                    &u1,
                    &v1,
                    &u2,
                    &v2);
            }
        }

        const i32 baseVertex = static_cast<i32>(outVertices->size() / 16);
        Status vs = appendPackedVertex(
            outVertices,
            sceneX + model.verticesX[static_cast<std::size_t>(ia)],
            sceneHeight + model.verticesY[static_cast<std::size_t>(ia)],
            sceneZ + model.verticesZ[static_cast<std::size_t>(ia)],
            hslA,
            alpha,
            u0,
            v0,
            priority + 1,
            packedTextureId);
        if (!ok(vs)) return vs;
        vs = appendPackedVertex(
            outVertices,
            sceneX + model.verticesX[static_cast<std::size_t>(ib)],
            sceneHeight + model.verticesY[static_cast<std::size_t>(ib)],
            sceneZ + model.verticesZ[static_cast<std::size_t>(ib)],
            hslB,
            alpha,
            u1,
            v1,
            priority + 1,
            packedTextureId);
        if (!ok(vs)) return vs;
        vs = appendPackedVertex(
            outVertices,
            sceneX + model.verticesX[static_cast<std::size_t>(ic)],
            sceneHeight + model.verticesY[static_cast<std::size_t>(ic)],
            sceneZ + model.verticesZ[static_cast<std::size_t>(ic)],
            hslC,
            alpha,
            u2,
            v2,
            priority + 1,
            packedTextureId);
        if (!ok(vs)) return vs;

        auto rr = outIndices->pushBack(baseVertex);
        if (!rr.isOk()) return rr.status();
        rr = outIndices->pushBack(baseVertex + 1);
        if (!rr.isOk()) return rr.status();
        rr = outIndices->pushBack(baseVertex + 2);
        if (!rr.isOk()) return rr.status();
        *outElements += 3;
    }

    return Status::Ok;
}
struct ObjCommandGroup final {
    i32 objTypeId = -1;
    i32 interactId = -1;
    i32 modelId = -1;
    i32 modelHash = 0;
    i32 level = 0;
    i32 priority = 10;
    bool includeLod = true;
    i32 opaqueElementsPerInstance = 0;
    i32 alphaElementsPerInstance = 0;
    Vec<ModelInfo> mergedInstances;
    Vec<ModelInfo> interactInstances;
    Vec<i32> sceneHeights;

    explicit ObjCommandGroup(Allocator& alloc) noexcept
        : mergedInstances(alloc), interactInstances(alloc), sceneHeights(alloc) {}
};

enum class ObjRenderOpKind : i32 {
    Instanced = 1,
    MergeByPlacement = 2,
};

struct ObjRenderOp final {
    ObjRenderOpKind kind = ObjRenderOpKind::Instanced;
    i32 groupIndex = -1;
    bool transparent = false;
    i32 elementsPerInstance = 0;
};

static i32 findObjCommandGroupIndex(
    Span<const ObjCommandGroup> groups,
    i32 objTypeId,
    i32 interactId,
    i32 modelId,
    i32 level,
    i32 priority,
    bool includeLod) noexcept {
    for (std::size_t i = 0; i < groups.size(); i++) {
        const ObjCommandGroup& group = groups[i];
        if (group.objTypeId == objTypeId &&
            group.interactId == interactId &&
            group.modelId == modelId &&
            group.level == level &&
            group.priority == priority &&
            group.includeLod == includeLod) {
            if (i > static_cast<std::size_t>(2147483647)) {
                return -1;
            }
            return static_cast<i32>(i);
        }
    }
    return -1;
}

static Status buildObjRenderCommandPlan(
    const SceneCommandBuildInput& input,
    const Vec<ObjCommandGroup>& groups,
    Vec<ObjRenderOp>* outOps,
    Vec<SceneCommandPlanDebugOp>* planOps,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!outOps) {
        return Status::InvalidArgument;
    }
    (void)alloc;
    outOps->clear();

    for (std::size_t gi = 0; gi < groups.size(); gi++) {
        const ObjCommandGroup& group = groups[gi];
        if (group.mergedInstances.empty()) {
            continue;
        }

        if (group.mergedInstances.size() != group.interactInstances.size() ||
            group.mergedInstances.size() != group.sceneHeights.size()) {
            return Status::SizeMismatch;
        }

        for (i32 pass = 0; pass < 2; pass++) {
            const bool transparent = pass == 1;
            const i32 elementsPerInstance = transparent
                ? group.alphaElementsPerInstance
                : group.opaqueElementsPerInstance;
            if (elementsPerInstance <= 0) {
                continue;
            }

            bool canInstance = true;
            if (group.sceneHeights.empty()) {
                canInstance = false;
            } else {
                const i32 firstHeight = group.sceneHeights[0];
                for (std::size_t hi = 1; hi < group.sceneHeights.size(); hi++) {
                    if (group.sceneHeights[hi] != firstHeight) {
                        canInstance = false;
                        break;
                    }
                }
            }

            const SceneModelMergeDecision mergeDecision = decideSceneModelMergeStrategy(
                static_cast<i32>(group.mergedInstances.size()),
                group.opaqueElementsPerInstance / 3,
                group.alphaElementsPerInstance / 3,
                input.minimizeDrawCalls);
            const bool mergeByPlacement =
                !canInstance ||
                (transparent ? mergeDecision.mergeTransparent : mergeDecision.mergeOpaque);

            if (debugOut) {
                if (mergeByPlacement) {
                    debugOut->debugObjMergeByPlacementCount++;
                } else {
                    debugOut->debugObjInstancedGroupCount++;
                }
            }

            if (planOps) {
                const i32 faceCount = elementsPerInstance / 3;
                if (faceCount > 0) {
                    SceneCommandPlanDebugOp op{};
                    op.transparent = transparent;
                    if (mergeByPlacement) {
                        op.kind = SceneCommandPlanDebugOpKind::MergedGroup;
                        op.lowDetail = !group.includeLod;
                        op.level = group.level;
                        op.priority = group.priority;
                        op.modelCount = static_cast<i32>(group.mergedInstances.size());
                    } else {
                        op.kind = SceneCommandPlanDebugOpKind::Instanced;
                        op.modelHash = group.modelHash;
                        op.faceCount = faceCount;
                        op.instanceCount = static_cast<i32>(group.interactInstances.size());
                        op.lodInstanceCount = group.includeLod ? op.instanceCount : 0;
                    }
                    auto rrOp = planOps->pushBack(op);
                    if (!rrOp.isOk()) {
                        return rrOp.status();
                    }
                }
            }

            ObjRenderOp op{};
            op.kind = mergeByPlacement ? ObjRenderOpKind::MergeByPlacement : ObjRenderOpKind::Instanced;
            op.groupIndex = static_cast<i32>(gi);
            op.transparent = transparent;
            op.elementsPerInstance = elementsPerInstance;
            auto rr = outOps->pushBack(op);
            if (!rr.isOk()) {
                return rr.status();
            }
        }
    }

    return Status::Ok;
}

static Status executeObjRenderOpMergeByPlacement(
    const SceneCommandBuildInput& input,
    const ObjType& resolved,
    const ObjCommandGroup& group,
    bool transparent,
    i32 elementsPerInstance,
    SceneBuffer* buffer,
    i32* indexCount,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount) {
        return Status::InvalidArgument;
    }
    if (elementsPerInstance <= 0) {
        return Status::InvalidArgument;
    }
    if (group.mergedInstances.size() != group.interactInstances.size() ||
        group.mergedInstances.size() != group.sceneHeights.size()) {
        return Status::SizeMismatch;
    }

    const i32 mergedOffsetBytes = (*indexCount) * 4;
    i32 mergedElements = 0;

    for (std::size_t ii = 0; ii < group.mergedInstances.size(); ii++) {
        const ModelInfo& mergedInst = group.mergedInstances[ii];
        const i32 modelOffsetBytes = (*indexCount) * 4;
        i32 generatedElements = 0;
        const Status gs = appendObjPlacementGeometry(
            input,
            resolved,
            group.modelId,
            mergedInst.sceneX,
            mergedInst.sceneZ,
            group.sceneHeights[ii],
            transparent,
            &buffer->vertices,
            &buffer->indices,
            &generatedElements,
            alloc);
        if (!ok(gs)) {
            return gs;
        }
        if (generatedElements != elementsPerInstance) {
            if (debugOut) {
                const i32 delta = elementsPerInstance - generatedElements;
                debugOut->debugGeometryElementMismatchCount++;
                debugOut->debugGeometryElementMismatchTotalDelta += (delta >= 0) ? delta : -delta;
                if ((delta >= 0 ? delta : -delta) > debugOut->debugGeometryElementMismatchMaxDelta) {
                    debugOut->debugGeometryElementMismatchMaxDelta = (delta >= 0) ? delta : -delta;
                    debugOut->debugGeometryElementMismatchSampleTypeId = group.objTypeId;
                    debugOut->debugGeometryElementMismatchSamplePlacementType = 0;
                    debugOut->debugGeometryElementMismatchSampleRotation = 0;
                }
            }
        }

        const i32 effectiveElements = generatedElements;

        ModelInfo interactDummy = group.interactInstances[ii];
        interactDummy.sceneX = 0;
        interactDummy.sceneZ = 0;
        interactDummy.heightOffset = 0;
        interactDummy.contourGround = static_cast<i32>(ContourGroundType::None);
        Span<const ModelInfo> interactSpan(&interactDummy, 1);
        const Status is = buffer->emitInteractCommand(
            modelOffsetBytes,
            effectiveElements,
            interactSpan,
            transparent,
            group.includeLod);
        if (!ok(is)) {
            return is;
        }

        *indexCount += effectiveElements;
        mergedElements += elementsPerInstance;
    }

    ModelInfo mergedDummy{};
    mergedDummy.level = group.level;
    mergedDummy.contourGround = static_cast<i32>(ContourGroundType::None);
    mergedDummy.priority = group.priority;
    mergedDummy.interactType = static_cast<i32>(InteractType::None);
    mergedDummy.interactId = 0xffff;
    const Status ms = buffer->emitMergedCommand(
        mergedOffsetBytes,
        mergedElements,
        Span<const ModelInfo>(&mergedDummy, 1),
        transparent,
        group.includeLod);
    if (!ok(ms)) {
        return ms;
    }

    return Status::Ok;
}

static Status executeObjRenderOpInstanced(
    const SceneCommandBuildInput& input,
    const ObjType& resolved,
    const ObjCommandGroup& group,
    bool transparent,
    i32 elementsPerInstance,
    SceneBuffer* buffer,
    i32* indexCount,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount) {
        return Status::InvalidArgument;
    }
    if (elementsPerInstance <= 0) {
        return Status::InvalidArgument;
    }
    if (group.sceneHeights.empty()) {
        return Status::InvalidArgument;
    }

    const i32 modelOffsetBytes = (*indexCount) * 4;
    i32 generatedElements = 0;
    const Status gs = appendObjPlacementGeometry(
        input,
        resolved,
        group.modelId,
        0,
        0,
        group.sceneHeights[0],
        transparent,
        &buffer->vertices,
        &buffer->indices,
        &generatedElements,
        alloc);
    if (!ok(gs)) {
        return gs;
    }
    if (generatedElements != elementsPerInstance) {
        if (debugOut) {
            const i32 delta = elementsPerInstance - generatedElements;
            debugOut->debugGeometryElementMismatchCount++;
            debugOut->debugGeometryElementMismatchTotalDelta += (delta >= 0) ? delta : -delta;
            if ((delta >= 0 ? delta : -delta) > debugOut->debugGeometryElementMismatchMaxDelta) {
                debugOut->debugGeometryElementMismatchMaxDelta = (delta >= 0) ? delta : -delta;
                debugOut->debugGeometryElementMismatchSampleTypeId = group.objTypeId;
                debugOut->debugGeometryElementMismatchSamplePlacementType = 0;
                debugOut->debugGeometryElementMismatchSampleRotation = 0;
            }
        }
    }

    const i32 effectiveElements = generatedElements;
    const Status ms = buffer->emitMergedCommand(
        modelOffsetBytes,
        effectiveElements,
        Span<const ModelInfo>(group.interactInstances.data(), group.interactInstances.size()),
        transparent,
        group.includeLod);
    if (!ok(ms)) {
        return ms;
    }
    const Status is = buffer->emitInteractCommand(
        modelOffsetBytes,
        effectiveElements,
        Span<const ModelInfo>(group.interactInstances.data(), group.interactInstances.size()),
        transparent,
        group.includeLod);
    if (!ok(is)) {
        return is;
    }
    *indexCount += elementsPerInstance;

    return Status::Ok;
}

static Status emitObjCommandsFromPackedSpawns(
    const SceneCommandBuildInput& input,
    const SceneData& scene,
    Vec<SceneCommandPlanDebugOp>* planOps,
    SceneBuffer* buffer,
    i32* indexCount,
    DecodedObjTypeCache* objTypeCache,
    DecodedModelFaceStatsCache* objModelCache,
    SceneCommandStream* debugOut,
    Allocator& alloc) noexcept {
    if (!buffer || !indexCount || !objTypeCache || !objModelCache) {
        return Status::InvalidArgument;
    }

    const i32 mapStartX = floorDiv(input.baseX, TerrainConstants::MAP_SQUARE_SIZE);
    const i32 mapStartY = floorDiv(input.baseY, TerrainConstants::MAP_SQUARE_SIZE);
    const i32 mapEndX = ceilDiv(
        static_cast<i32>(input.baseX + input.sizeX),
        TerrainConstants::MAP_SQUARE_SIZE);
    const i32 mapEndY = ceilDiv(
        static_cast<i32>(input.baseY + input.sizeY),
        TerrainConstants::MAP_SQUARE_SIZE);

    Vec<ObjSpawnRecord> spawns(alloc);
    Vec<ObjCommandGroup> groups(alloc);

    const i32 border = inferTerrainBorderSize(input.sizeX, input.sizeY);

    for (i32 mx = mapStartX; mx < mapEndX; mx++) {
        for (i32 my = mapStartY; my < mapEndY; my++) {
            const i32 mapId = (mx << 8) + my;
            const Status ds = decodeObjSpawnsForMap(input, mapId, &spawns);
            if (ds == Status::NotFound) {
                continue;
            }
            if (!ok(ds)) {
                return ds;
            }
            if (debugOut && spawns.size() <= static_cast<std::size_t>(2147483647)) {
                debugOut->debugObjSpawnsDecoded += static_cast<i32>(spawns.size());
            }

            const i32 offsetX = mx * TerrainConstants::MAP_SQUARE_SIZE - input.baseX;
            const i32 offsetY = my * TerrainConstants::MAP_SQUARE_SIZE - input.baseY;

            for (std::size_t i = 0; i < spawns.size(); i++) {
                const ObjSpawnRecord& spawn = spawns[i];
                if (spawn.id < 0) {
                    continue;
                }
                const i32 localX = spawn.x - (mx * TerrainConstants::MAP_SQUARE_SIZE);
                const i32 localY = spawn.y - (my * TerrainConstants::MAP_SQUARE_SIZE);
                const i32 tileX = localX + offsetX;
                const i32 tileY = localY + offsetY;
                if (!(tileX > 0 && tileY > 0 && tileX < input.sizeX - 1 && tileY < input.sizeY - 1)) {
                    continue;
                }

                i32 renderLevel = spawn.plane;
                if (renderLevel < 0 || renderLevel >= scene.levels) {
                    continue;
                }
                if (renderLevel < 3 &&
                    scene.isWithinBounds(1, tileX, tileY) &&
                    (scene.renderFlag(1, tileX, tileY) &
                     static_cast<u8>(SceneTileRenderFlag::Bridge)) != 0) {
                    renderLevel = renderLevel + 1;
                }
                if (!scene.isWithinBounds(renderLevel, tileX, tileY)) {
                    continue;
                }
                if (debugOut) {
                    debugOut->debugObjSpawnsInBounds++;
                }

                const ObjType* resolved = resolveObjTypeForCount(
                    input,
                    objTypeCache,
                    spawn.id,
                    spawn.count,
                    alloc);
                if (!resolved) {
                    continue;
                }
                if (equalsIgnoreCaseAscii(resolved->name, "null")) {
                    continue;
                }

                const i32 modelId = resolved->model;
                if (modelId < 0) {
                    continue;
                }
                if (debugOut) {
                    debugOut->debugObjModelCandidates++;
                }

                const i32 sceneHeight = (
                    scene.height(renderLevel, tileX, tileY) +
                    scene.height(renderLevel, tileX + 1, tileY) +
                    scene.height(renderLevel, tileX, tileY + 1) +
                    scene.height(renderLevel, tileX + 1, tileY + 1)) >> 2;

                const ModelFaceStats* stats = nullptr;
                const Status ms = tryDecodeObjModelFaceStatsFromBlob(
                    input,
                    objModelCache,
                    *resolved,
                    modelId,
                    &stats,
                    alloc);
                if (!ok(ms) || !stats) {
                    continue;
                }
                if (stats->opaqueElements <= 0 && stats->alphaElements <= 0) {
                    continue;
                }

                const i32 priority = 10;
                const bool includeLod = true;
                const i32 groupIndex = findObjCommandGroupIndex(
                    Span<const ObjCommandGroup>(groups.data(), groups.size()),
                    resolved->id,
                    spawn.id,
                    modelId,
                    renderLevel,
                    priority,
                    includeLod);

                i32 targetGroupIndex = groupIndex;
                if (targetGroupIndex < 0) {
                    ObjCommandGroup group(alloc);
                    group.objTypeId = resolved->id;
                    group.interactId = spawn.id;
                    group.modelId = modelId;
                    group.modelHash = stats->modelHash;
                    group.level = renderLevel;
                    group.priority = priority;
                    group.includeLod = includeLod;
                    group.opaqueElementsPerInstance = stats->opaqueElements;
                    group.alphaElementsPerInstance = stats->alphaElements;
                    auto rrGroup = groups.pushBack(rs::move(group));
                    if (!rrGroup.isOk()) {
                        return rrGroup.status();
                    }
                    targetGroupIndex = static_cast<i32>(groups.size() - 1);
                }

                if (targetGroupIndex < 0 ||
                    targetGroupIndex >= static_cast<i32>(groups.size())) {
                    return Status::OutOfRange;
                }

                ObjCommandGroup& group = groups[static_cast<std::size_t>(targetGroupIndex)];
                if (group.modelHash != stats->modelHash ||
                    group.opaqueElementsPerInstance != stats->opaqueElements ||
                    group.alphaElementsPerInstance != stats->alphaElements) {
                    continue;
                }

                ModelInfo mergedInst{};
                mergedInst.sceneX = (tileX - border) * 128 + 64;
                mergedInst.sceneZ = (tileY - border) * 128 + 64;
                mergedInst.heightOffset = 0;
                mergedInst.level = renderLevel;
                mergedInst.contourGround = static_cast<i32>(ContourGroundType::CenterTile);
                mergedInst.priority = priority;
                mergedInst.interactType = static_cast<i32>(InteractType::None);
                mergedInst.interactId = 0xffff;
                auto rrMerged = group.mergedInstances.pushBack(mergedInst);
                if (!rrMerged.isOk()) {
                    return rrMerged.status();
                }
                if (debugOut) {
                    debugOut->debugObjInstancesQueued++;
                }

                ModelInfo interactInst = mergedInst;
                interactInst.interactType = static_cast<i32>(InteractType::Obj);
                interactInst.interactId = spawn.id;
                auto rrInteract = group.interactInstances.pushBack(interactInst);
                if (!rrInteract.isOk()) {
                    return rrInteract.status();
                }

                auto rrHeight = group.sceneHeights.pushBack(sceneHeight);
                if (!rrHeight.isOk()) {
                    return rrHeight.status();
                }
            }
        }
    }

    Vec<ObjRenderOp> ops(alloc);
    const Status ps = buildObjRenderCommandPlan(
        input,
        groups,
        &ops,
        planOps,
        debugOut,
        alloc);
    if (!ok(ps)) {
        return ps;
    }

    Vec<const ObjType*> resolvedTypes(alloc);
    auto rrResolved = resolvedTypes.resize(groups.size());
    if (!rrResolved.isOk()) {
        return rrResolved.status();
    }
    for (std::size_t i = 0; i < resolvedTypes.size(); i++) {
        resolvedTypes[i] = nullptr;
    }

    for (std::size_t oi = 0; oi < ops.size(); oi++) {
        const ObjRenderOp& op = ops[oi];
        if (op.groupIndex < 0 || op.groupIndex >= static_cast<i32>(groups.size())) {
            return Status::OutOfRange;
        }
        const ObjCommandGroup& group = groups[static_cast<std::size_t>(op.groupIndex)];
        if (group.mergedInstances.empty()) {
            continue;
        }

        const std::size_t gi = static_cast<std::size_t>(op.groupIndex);
        const ObjType* resolved = resolvedTypes[gi];
        if (!resolved) {
            const Status ts = tryDecodeObjTypeFromBlob(
                input,
                objTypeCache,
                group.objTypeId,
                &resolved,
                alloc);
            if (!ok(ts) || !resolved) {
                continue;
            }
            resolvedTypes[gi] = resolved;
        }

        Status s = Status::Ok;
        if (op.kind == ObjRenderOpKind::MergeByPlacement) {
            s = executeObjRenderOpMergeByPlacement(
                input,
                *resolved,
                group,
                op.transparent,
                op.elementsPerInstance,
                buffer,
                indexCount,
                debugOut,
                alloc);
        } else {
            s = executeObjRenderOpInstanced(
                input,
                *resolved,
                group,
                op.transparent,
                op.elementsPerInstance,
                buffer,
                indexCount,
                debugOut,
                alloc);
        }
        if (!ok(s)) {
            return s;
        }
    }

    return Status::Ok;
}

