// Extracted NPC/runtime helper decode+emit block from rs_map_render_backend.cpp.
struct DecodedNpcTypeCacheEntry final {
    rs::i32 id = -1;
    rs::NpcType type{};
};

struct DecodedBasTypeCacheEntry final {
    rs::i32 id = -1;
    rs::BasType type{};
};

struct DecodedVarBitTypeCacheEntry final {
    rs::i32 id = -1;
    rs::VarBitType type{};
};

static rs::Status tryDecodeNpcTypeFromBlobCached(
    const MapRenderRuntimeState* runtime,
    const rs::CacheInfo& cacheInfo,
    rs::StringArena* strings,
    rs::Allocator& alloc,
    const rs::i32 npcId,
    std::vector<DecodedNpcTypeCacheEntry>* cache,
    const rs::NpcType** outNpc) {
    if (!strings || !cache || !outNpc) {
        return rs::Status::InvalidArgument;
    }
    *outNpc = nullptr;
    for (std::size_t i = 0; i < cache->size(); i++) {
        if ((*cache)[i].id == npcId) {
            *outNpc = &(*cache)[i].type;
            return rs::Status::Ok;
        }
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_NPC,
        npcId,
        &bytes);
    if (!rs::ok(ss)) {
        if (ss == rs::Status::NotFound && runtime) {
            runtimeRecordMissingBlobKey(
                const_cast<MapRenderRuntimeState*>(runtime),
                RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_NPC,
                0,
                npcId);
        }
        return ss;
    }

    DecodedNpcTypeCacheEntry entry{};
    entry.id = npcId;
    entry.type = rs::NpcType(npcId, cacheInfo);
    rs::Uint8ArrayReader reader(
        bytes,
        0);
    rs::TypeDecodeError err{};
    rs::TypeDecodeContext ctx{cacheInfo, strings, &alloc};
    const rs::Status ds = rs::decodeType(entry.type, reader, &err, &ctx);
    if (!rs::ok(ds)) {
        return ds;
    }

    cache->push_back(std::move(entry));
    *outNpc = &cache->back().type;
    return rs::Status::Ok;
}

static rs::Status tryDecodeVarBitTypeFromBlobCached(
    const MapRenderRuntimeState* runtime,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 varbitId,
    std::vector<DecodedVarBitTypeCacheEntry>* cache,
    const rs::VarBitType** outVarBit) {
    if (!cache || !outVarBit) {
        return rs::Status::InvalidArgument;
    }
    *outVarBit = nullptr;
    for (std::size_t i = 0; i < cache->size(); i++) {
        if ((*cache)[i].id == varbitId) {
            *outVarBit = &(*cache)[i].type;
            return rs::Status::Ok;
        }
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_VARBIT,
        varbitId,
        &bytes);
    if (!rs::ok(ss)) {
        if (ss == rs::Status::NotFound && runtime) {
            runtimeRecordMissingBlobKey(
                const_cast<MapRenderRuntimeState*>(runtime),
                RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_VARBIT,
                0,
                varbitId);
        }
        return ss;
    }

    DecodedVarBitTypeCacheEntry entry{};
    entry.id = varbitId;
    entry.type = rs::VarBitType(varbitId, cacheInfo);
    rs::Uint8ArrayReader reader(
        bytes,
        0);
    rs::TypeDecodeError err{};
    const rs::Status ds = rs::decodeType(entry.type, reader, &err, nullptr);
    if (!rs::ok(ds)) {
        return ds;
    }

    cache->push_back(std::move(entry));
    *outVarBit = &cache->back().type;
    return rs::Status::Ok;
}

static rs::Status tryDecodeBasTypeFromBlobCached(
    const MapRenderRuntimeState* runtime,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 basId,
    std::vector<DecodedBasTypeCacheEntry>* cache,
    const rs::BasType** outBas) {
    if (!cache || !outBas) {
        return rs::Status::InvalidArgument;
    }
    *outBas = nullptr;
    for (std::size_t i = 0; i < cache->size(); i++) {
        if ((*cache)[i].id == basId) {
            *outBas = &(*cache)[i].type;
            return rs::Status::Ok;
        }
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_BAS,
        basId,
        &bytes);
    if (!rs::ok(ss)) {
        if (ss == rs::Status::NotFound && runtime) {
            runtimeRecordMissingBlobKey(
                const_cast<MapRenderRuntimeState*>(runtime),
                RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_BAS,
                0,
                basId);
        }
        return ss;
    }

    DecodedBasTypeCacheEntry entry{};
    entry.id = basId;
    entry.type = rs::BasType(basId, cacheInfo);
    rs::Uint8ArrayReader reader(
        bytes,
        0);
    rs::TypeDecodeError err{};
    const rs::Status ds = rs::decodeType(entry.type, reader, &err, nullptr);
    if (!rs::ok(ds)) {
        return ds;
    }

    cache->push_back(std::move(entry));
    *outBas = &cache->back().type;
    return rs::Status::Ok;
}

static rs::i32 getRuntimeVarpValue(
    const std::vector<rs::i32>& varps,
    const rs::i32 varpId) noexcept {
    if (varpId < 0 || static_cast<std::size_t>(varpId) >= varps.size()) {
        return 0;
    }
    return varps[static_cast<std::size_t>(varpId)];
}

static rs::i32 getRuntimeVarbitValue(
    const MapRenderRuntimeState* runtime,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 varbitId,
    std::vector<DecodedVarBitTypeCacheEntry>* varbitCache) {
    if (!runtime || !varbitCache || varbitId < 0) {
        return 0;
    }
    const rs::VarBitType* varbit = nullptr;
    const rs::Status status = tryDecodeVarBitTypeFromBlobCached(
        runtime,
        cacheInfo,
        varbitId,
        varbitCache,
        &varbit);
    if (!rs::ok(status) || !varbit) {
        return 0;
    }
    const rs::i32 varpValue = getRuntimeVarpValue(runtime->cache.varps, varbit->baseVar);
    const rs::i32 bitCount = varbit->endBit - varbit->startBit + 1;
    if (bitCount <= 0 || bitCount > 31) {
        return 0;
    }
    const rs::i32 mask = (1 << bitCount) - 1;
    return (varpValue >> varbit->startBit) & mask;
}

static const rs::NpcType* resolveNpcTypeForSpawn(
    const MapRenderRuntimeState* runtime,
    const rs::CacheInfo& cacheInfo,
    rs::StringArena* strings,
    rs::Allocator& alloc,
    const rs::i32 npcId,
    std::vector<DecodedNpcTypeCacheEntry>* npcCache,
    std::vector<DecodedVarBitTypeCacheEntry>* varbitCache) {
    if (!runtime || !strings || !npcCache || !varbitCache) {
        return nullptr;
    }

    const rs::NpcType* base = nullptr;
    const rs::Status bs = tryDecodeNpcTypeFromBlobCached(
        runtime,
        cacheInfo,
        strings,
        alloc,
        npcId,
        npcCache,
        &base);
    if (!rs::ok(bs) || !base) {
        return nullptr;
    }

    if (base->transforms.empty()) {
        return base;
    }

    rs::i32 transformIndex = -1;
    if (base->transformVarbit != -1) {
        transformIndex = getRuntimeVarbitValue(runtime, cacheInfo, base->transformVarbit, varbitCache);
    } else if (base->transformVarp != -1) {
        transformIndex = getRuntimeVarpValue(runtime->cache.varps, base->transformVarp);
    }

    rs::i32 transformId = base->transforms[base->transforms.size() - 1];
    if (transformIndex >= 0 &&
        transformIndex < static_cast<rs::i32>(base->transforms.size()) - 1 &&
        base->transforms[static_cast<std::size_t>(transformIndex)] != -1) {
        transformId = base->transforms[static_cast<std::size_t>(transformIndex)];
    }
    if (transformId == -1) {
        return nullptr;
    }

    const rs::NpcType* transformed = nullptr;
    const rs::Status ts = tryDecodeNpcTypeFromBlobCached(
        runtime,
        cacheInfo,
        strings,
        alloc,
        transformId,
        npcCache,
        &transformed);
    if (!rs::ok(ts) || !transformed) {
        return nullptr;
    }
    return transformed;
}

static void applyNpcModelMutations(
    rs::ModelData* model,
    const rs::NpcType& npcType) noexcept {
    if (!model) {
        return;
    }

    if (!npcType.recolorFrom.empty()) {
        const bool recolorAsRetexture =
            npcType.cacheInfo.game == rs::GameType::Runescape &&
            npcType.cacheInfo.revision <= 377;
        for (std::size_t i = 0; i < npcType.recolorFrom.size(); i++) {
            const rs::i32 from = npcType.recolorFrom[i];
            const rs::i32 to = i < npcType.recolorTo.size() ? npcType.recolorTo[i] : from;
            model->recolor(from, to);
            if (recolorAsRetexture) {
                model->retexture(from, to);
            }
        }
    }

    for (std::size_t i = 0; i < npcType.retextureFrom.size(); i++) {
        const rs::i32 from = npcType.retextureFrom[i];
        const rs::i32 to = i < npcType.retextureTo.size() ? npcType.retextureTo[i] : from;
        model->retexture(from, to);
    }

    if (npcType.widthScale != 128 || npcType.heightScale != 128) {
        model->resize(npcType.widthScale, npcType.heightScale, npcType.widthScale);
    }
}

static rs::Status tryDecodeModelDataFromRuntime(
    const MapRenderRuntimeState* runtime,
    const rs::i32 modelId,
    rs::Allocator& alloc,
    rs::ModelData* outModel) {
    if (!outModel) {
        return rs::Status::InvalidArgument;
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeEntrySpanForDeps(
        runtime,
        RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
        modelId,
        &bytes);
    if (!rs::ok(ss)) {
        // Legacy caches do not provide per-model raw bytes; use the legacy global file loader.
        if (ss == rs::Status::NotFound && runtime) {
            rs::ModelData legacy(alloc);
            const rs::Status ls = runtimeTryLoadLegacyModelFromRuntimeCtx(runtime, modelId, &legacy, alloc);
            if (rs::ok(ls)) {
                *outModel = rs::move(legacy);
                return rs::Status::Ok;
            }
            runtimeRecordMissingBlobKey(
                const_cast<MapRenderRuntimeState*>(runtime),
                RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_MODEL,
                0,
                modelId);
        }
        return ss;
    }

    rs::ModelData decoded(alloc);
    const rs::Status ds = rs::decodeModelData(
        bytes,
        &decoded,
        alloc);
    if (!rs::ok(ds)) {
        return ds;
    }
    *outModel = rs::move(decoded);
    return rs::Status::Ok;
}

static rs::Status appendNpcModelGeometry(
    const rs::ModelData& model,
    const std::vector<rs::i32>& textureSdIds,
    const rs::i32 sceneTileX,
    const rs::i32 sceneTileY,
    std::vector<rs::u8>* outVertices,
    std::vector<rs::i32>* outIndices,
    rs::i32* outIndexCount) {
    if (!outVertices || !outIndices || !outIndexCount) {
        return rs::Status::InvalidArgument;
    }
    *outIndexCount = 0;

    // Important: NPC vertex geometry must be in model-local coordinates. The shader applies
    // per-NPC translation from the NPC data texture (`npcInfo.tilePos`). If we bake tile
    // translation here, NPCs get translated twice and end up off-map.
    (void)sceneTileX;
    (void)sceneTileY;
    const rs::i32 locX = 0;
    const rs::i32 locZ = 0;
    const rs::i32 tileHeight = 0;

    for (rs::i32 fi = 0; fi < model.faceCount; fi++) {
        rs::i32 textureId = -1;
        if (model.hasFaceTextures && fi < static_cast<rs::i32>(model.faceTextures.size())) {
            textureId = static_cast<rs::i32>(model.faceTextures[static_cast<std::size_t>(fi)]);
        }
        const rs::i32 textureIdSd =
            (textureId >= 0 && std::binary_search(textureSdIds.begin(), textureSdIds.end(), textureId))
                ? textureId
                : -1;

        rs::i32 alpha = 0xff;
        if (model.hasFaceAlphas && textureId == -1 && fi < static_cast<rs::i32>(model.faceAlphas.size())) {
            alpha = 0xff - (static_cast<rs::i32>(model.faceAlphas[static_cast<std::size_t>(fi)]) & 0xff);
        }

        if (fi >= static_cast<rs::i32>(model.indices1.size()) ||
            fi >= static_cast<rs::i32>(model.indices2.size()) ||
            fi >= static_cast<rs::i32>(model.indices3.size()) ||
            fi >= static_cast<rs::i32>(model.faceColors.size())) {
            continue;
        }

        const rs::i32 ia = model.indices1[static_cast<std::size_t>(fi)];
        const rs::i32 ib = model.indices2[static_cast<std::size_t>(fi)];
        const rs::i32 ic = model.indices3[static_cast<std::size_t>(fi)];
        if (ia < 0 || ib < 0 || ic < 0 ||
            ia >= static_cast<rs::i32>(model.verticesX.size()) ||
            ib >= static_cast<rs::i32>(model.verticesX.size()) ||
            ic >= static_cast<rs::i32>(model.verticesX.size()) ||
            ia >= static_cast<rs::i32>(model.verticesY.size()) ||
            ib >= static_cast<rs::i32>(model.verticesY.size()) ||
            ic >= static_cast<rs::i32>(model.verticesY.size()) ||
            ia >= static_cast<rs::i32>(model.verticesZ.size()) ||
            ib >= static_cast<rs::i32>(model.verticesZ.size()) ||
            ic >= static_cast<rs::i32>(model.verticesZ.size())) {
            continue;
        }

        rs::i32 priority = 10;
        if (model.hasFaceRenderPriorities && fi < static_cast<rs::i32>(model.faceRenderPriorities.size())) {
            priority = static_cast<rs::i32>(model.faceRenderPriorities[static_cast<std::size_t>(fi)]) & 0xff;
        }

        const rs::i32 hsl = static_cast<rs::i32>(model.faceColors[static_cast<std::size_t>(fi)]);
        const rs::i32 baseVertex = static_cast<rs::i32>(outVertices->size() / 16);

        rs::Status vs = appendPackedVertex(
            outVertices,
            locX + model.verticesX[static_cast<std::size_t>(ia)],
            tileHeight + model.verticesY[static_cast<std::size_t>(ia)],
            locZ + model.verticesZ[static_cast<std::size_t>(ia)],
            hsl,
            alpha,
            0.0f,
            0.0f,
            priority,
            textureIdSd);
        if (!rs::ok(vs)) {
            return vs;
        }

        vs = appendPackedVertex(
            outVertices,
            locX + model.verticesX[static_cast<std::size_t>(ib)],
            tileHeight + model.verticesY[static_cast<std::size_t>(ib)],
            locZ + model.verticesZ[static_cast<std::size_t>(ib)],
            hsl,
            alpha,
            1.0f,
            0.0f,
            priority,
            textureIdSd);
        if (!rs::ok(vs)) {
            return vs;
        }

        vs = appendPackedVertex(
            outVertices,
            locX + model.verticesX[static_cast<std::size_t>(ic)],
            tileHeight + model.verticesY[static_cast<std::size_t>(ic)],
            locZ + model.verticesZ[static_cast<std::size_t>(ic)],
            hsl,
            alpha,
            1.0f,
            1.0f,
            priority,
            textureIdSd);
        if (!rs::ok(vs)) {
            return vs;
        }

        outIndices->push_back(baseVertex + 0);
        outIndices->push_back(baseVertex + 1);
        outIndices->push_back(baseVertex + 2);
        *outIndexCount += 3;
    }

    return rs::Status::Ok;
}


static rs::i32 makeNpcOrderKey(const rs::NpcSpawn& spawn, const rs::i32 occurrence) noexcept {
    rs::u32 hash = 2166136261u;
    hash = fnv1a32UpdateI32(hash, spawn.id);
    hash = fnv1a32UpdateI32(hash, spawn.x);
    hash = fnv1a32UpdateI32(hash, spawn.y);
    hash = fnv1a32UpdateI32(hash, spawn.level);
    hash = fnv1a32UpdateI32(hash, occurrence);
    return static_cast<rs::i32>(hash);
}

// Best-effort: NPC geometry must not make map packet build fail. If NPC decode/model
// loads fail, we return a failure status and callers should clear the NPC fields and
// continue with the base map payload.
static rs::i32 tryBuildNpcGeometryForMapSquareIntoPayloadFromCache(
    MapRenderRuntimeState* runtime,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 mapX,
    const rs::i32 mapY,
    const rs::i32 borderSize,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    rs::tooling::MapRenderLoadedPayloadState* payload) {
    if (!runtime || !payload) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    rs::i32 debugSpawnsDecoded = 0;
    rs::i32 debugSpawnsInBounds = 0;
    rs::i32 debugResolvedType = 0;
    rs::i32 debugLoginPropRenderable = 0;
    rs::i32 debugModelDecodeOk = 0;
    rs::i32 debugModelDecodeFailed = 0;
    rs::i32 debugSpawnsWithGeometry = 0;
    const auto finalize = [&](const rs::i32 status) noexcept -> rs::i32 {
        runtime->debugLastNpcBuildStatus = status;
        runtime->debugLastNpcSpawnsDecoded = debugSpawnsDecoded;
        runtime->debugLastNpcSpawnsInBounds = debugSpawnsInBounds;
        runtime->debugLastNpcResolvedType = debugResolvedType;
        runtime->debugLastNpcLoginPropRenderable = debugLoginPropRenderable;
        runtime->debugLastNpcModelDecodeOk = debugModelDecodeOk;
        runtime->debugLastNpcModelDecodeFailed = debugModelDecodeFailed;
        runtime->debugLastNpcSpawnsWithGeometry = debugSpawnsWithGeometry;
        runtime->debugLastNpcDrawRangeCount =
            static_cast<rs::i32>(payload->npcDrawRangesBase.size() / 3U);
        runtime->debugLastNpcVertexBytes = static_cast<rs::i32>(payload->npcVertices.size());
        runtime->debugLastNpcIndexCount = static_cast<rs::i32>(payload->npcIndices.size());
        return status;
    };
    payload->npcDrawRangesBase.clear();
    payload->npcDrawRangesAlpha.clear();
    payload->npcVertices.clear();
    payload->npcIndices.clear();
    payload->npcOrderKeys.clear();

    const std::vector<rs::u8>* npcBytes = tryGetRuntimeCachedMapSquareNpcBytes(*runtime, mapX, mapY);
    runtime->debugLastNpcSpawnBytesLength =
        npcBytes ? static_cast<rs::i32>(npcBytes->size()) : 0;
    if (!npcBytes || npcBytes->empty()) {
        return finalize(RS_MAP_RENDER_STATUS_OK);
    }

    std::vector<rs::u8> tileFlags;
    tileFlags.resize(static_cast<std::size_t>(sizeX * sizeY), 0);

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::Vec<rs::NpcSpawn> spawns(alloc);
    const rs::Status ds = rs::decodeNpcSpawnsFromBytes(
        rs::Span<const rs::u8>(tileFlags.data(), tileFlags.size()),
        sizeY,
        borderSize,
        mapX,
        mapY,
        rs::Span<const rs::u8>(npcBytes->data(), npcBytes->size()),
        &spawns,
        alloc);
    if (!rs::ok(ds)) {
        return finalize(mapRenderStatusFromCoreStatus(ds));
    }
    debugSpawnsDecoded = static_cast<rs::i32>(spawns.size());

    rs::StringArena strings(alloc);
    std::vector<DecodedNpcTypeCacheEntry> npcCache{};
    npcCache.reserve(128);
    std::vector<DecodedBasTypeCacheEntry> basCache{};
    basCache.reserve(64);
    std::vector<DecodedVarBitTypeCacheEntry> varbitCache{};
    varbitCache.reserve(64);
    std::unordered_map<std::uint64_t, rs::i32> npcTupleOccurrences{};
    std::vector<rs::i32> textureSdIds{};
    collectBlobDomainTypeListPreferPayloadOrKeys(runtime, RS_MAP_RENDER_BLOB_DOMAIN_TYPE_ENTRY_TEXTURE_IDS, &textureSdIds);

    const rs::i32 mapBaseX = mapX * kMapSquareSize;
    const rs::i32 mapBaseY = mapY * kMapSquareSize;
    for (std::size_t i = 0; i < spawns.size(); i++) {
        const rs::NpcSpawn& spawn = spawns[i];
        const rs::i32 sceneTileX = (spawn.x - mapBaseX) + borderSize;
        const rs::i32 sceneTileY = (spawn.y - mapBaseY) + borderSize;
        if (sceneTileX < 0 || sceneTileY < 0 || sceneTileX >= sizeX || sceneTileY >= sizeY) {
            continue;
        }
        debugSpawnsInBounds++;

        const rs::NpcType* npcType = resolveNpcTypeForSpawn(
            runtime,
            cacheInfo,
            &strings,
            alloc,
            spawn.id,
            &npcCache,
            &varbitCache);
        if (!npcType) {
            continue;
        }
        debugResolvedType++;
        if ((npcType->loginScreenProps & 0x1) == 0) {
            continue;
        }
        debugLoginPropRenderable++;

        const rs::BasType* basType = nullptr;
        if (npcType->basTypeId >= 0) {
            const rs::Status basStatus = tryDecodeBasTypeFromBlobCached(
                runtime,
                cacheInfo,
                npcType->basTypeId,
                &basCache,
                &basType);
            (void)basStatus;
        }
        (void)basType;

        if (npcType->modelIds.empty()) {
            continue;
        }

        const rs::i32 indexStart = static_cast<rs::i32>(payload->npcIndices.size());
        for (std::size_t mi = 0; mi < npcType->modelIds.size(); mi++) {
            const rs::i32 modelId = npcType->modelIds[mi];
            if (modelId < 0) {
                continue;
            }

            rs::ModelData model(alloc);
            const rs::Status ms = tryDecodeModelDataFromRuntime(
                runtime,
                modelId,
                alloc,
                &model);
            if (!rs::ok(ms)) {
                debugModelDecodeFailed++;
                continue;
            }
            debugModelDecodeOk++;

            applyNpcModelMutations(&model, *npcType);

            rs::i32 modelIndexCount = 0;
            const rs::Status gs = appendNpcModelGeometry(
                model,
                textureSdIds,
                sceneTileX,
                sceneTileY,
                &payload->npcVertices,
                &payload->npcIndices,
                &modelIndexCount);
            if (!rs::ok(gs)) {
                return finalize(mapRenderStatusFromCoreStatus(gs));
            }
        }

        // Emit exactly one draw-range entry per NPC spawn. The range spans all models that
        // successfully decoded for the NPC type.
        const rs::i32 indexCount = static_cast<rs::i32>(payload->npcIndices.size()) - indexStart;
        if (indexCount > 0) {
            debugSpawnsWithGeometry++;
            const std::uint64_t tupleKey =
                (static_cast<std::uint64_t>(static_cast<rs::u16>(spawn.level & 0xffff)) << 48) |
                (static_cast<std::uint64_t>(static_cast<rs::u16>(spawn.id & 0xffff)) << 32) |
                (static_cast<std::uint64_t>(static_cast<rs::u16>(spawn.x & 0xffff)) << 16) |
                static_cast<std::uint64_t>(static_cast<rs::u16>(spawn.y & 0xffff));
            const rs::i32 occurrence = npcTupleOccurrences[tupleKey]++;
            payload->npcOrderKeys.push_back(makeNpcOrderKey(spawn, occurrence));
            payload->npcDrawRangesBase.push_back(indexStart * 4);
            payload->npcDrawRangesBase.push_back(indexCount);
            payload->npcDrawRangesBase.push_back(1);
        }
    }

    return finalize(RS_MAP_RENDER_STATUS_OK);
}
