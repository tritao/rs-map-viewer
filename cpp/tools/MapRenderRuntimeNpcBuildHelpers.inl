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
    const MapRenderCachedTypeBlob& blob,
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
    if (!blob.loaded) {
        return rs::Status::NotFound;
    }
    const rs::i32 blobIdx = findTypeBlobIndex(blob.ids, npcId);
    if (blobIdx < 0) {
        return rs::Status::NotFound;
    }
    if (blobIdx >= static_cast<rs::i32>(blob.offsets.size()) ||
        blobIdx >= static_cast<rs::i32>(blob.lengths.size())) {
        return rs::Status::SizeMismatch;
    }

    const rs::i32 off = blob.offsets[static_cast<std::size_t>(blobIdx)];
    const rs::i32 len = blob.lengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return rs::Status::NotFound;
    }
    if (off > static_cast<rs::i32>(blob.bytes.size()) ||
        len > static_cast<rs::i32>(blob.bytes.size()) - off) {
        return rs::Status::OutOfRange;
    }

    DecodedNpcTypeCacheEntry entry{};
    entry.id = npcId;
    entry.type = rs::NpcType(npcId, cacheInfo);
    rs::Uint8ArrayReader reader(
        rs::Span<const rs::u8>(blob.bytes.data() + off, static_cast<std::size_t>(len)),
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
    const MapRenderCachedTypeBlob& blob,
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
    if (!blob.loaded) {
        return rs::Status::NotFound;
    }
    const rs::i32 blobIdx = findTypeBlobIndex(blob.ids, varbitId);
    if (blobIdx < 0) {
        return rs::Status::NotFound;
    }
    if (blobIdx >= static_cast<rs::i32>(blob.offsets.size()) ||
        blobIdx >= static_cast<rs::i32>(blob.lengths.size())) {
        return rs::Status::SizeMismatch;
    }

    const rs::i32 off = blob.offsets[static_cast<std::size_t>(blobIdx)];
    const rs::i32 len = blob.lengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return rs::Status::NotFound;
    }
    if (off > static_cast<rs::i32>(blob.bytes.size()) ||
        len > static_cast<rs::i32>(blob.bytes.size()) - off) {
        return rs::Status::OutOfRange;
    }

    DecodedVarBitTypeCacheEntry entry{};
    entry.id = varbitId;
    entry.type = rs::VarBitType(varbitId, cacheInfo);
    rs::Uint8ArrayReader reader(
        rs::Span<const rs::u8>(blob.bytes.data() + off, static_cast<std::size_t>(len)),
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
    const MapRenderCachedTypeBlob& blob,
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
    if (!blob.loaded) {
        return rs::Status::NotFound;
    }
    const rs::i32 blobIdx = findTypeBlobIndex(blob.ids, basId);
    if (blobIdx < 0) {
        return rs::Status::NotFound;
    }
    if (blobIdx >= static_cast<rs::i32>(blob.offsets.size()) ||
        blobIdx >= static_cast<rs::i32>(blob.lengths.size())) {
        return rs::Status::SizeMismatch;
    }

    const rs::i32 off = blob.offsets[static_cast<std::size_t>(blobIdx)];
    const rs::i32 len = blob.lengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return rs::Status::NotFound;
    }
    if (off > static_cast<rs::i32>(blob.bytes.size()) ||
        len > static_cast<rs::i32>(blob.bytes.size()) - off) {
        return rs::Status::OutOfRange;
    }

    DecodedBasTypeCacheEntry entry{};
    entry.id = basId;
    entry.type = rs::BasType(basId, cacheInfo);
    rs::Uint8ArrayReader reader(
        rs::Span<const rs::u8>(blob.bytes.data() + off, static_cast<std::size_t>(len)),
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
        runtime->cache.varbits,
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
        runtime->cache.npcTypes,
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
        runtime->cache.npcTypes,
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

static rs::Status tryDecodeModelDataFromBlob(
    const MapRenderCachedTypeBlob& blob,
    const rs::i32 modelId,
    rs::Allocator& alloc,
    rs::ModelData* outModel) {
    if (!outModel) {
        return rs::Status::InvalidArgument;
    }
    if (!blob.loaded) {
        return rs::Status::NotFound;
    }
    const rs::i32 blobIdx = findTypeBlobIndex(blob.ids, modelId);
    if (blobIdx < 0) {
        return rs::Status::NotFound;
    }
    if (blobIdx >= static_cast<rs::i32>(blob.offsets.size()) ||
        blobIdx >= static_cast<rs::i32>(blob.lengths.size())) {
        return rs::Status::SizeMismatch;
    }

    const rs::i32 off = blob.offsets[static_cast<std::size_t>(blobIdx)];
    const rs::i32 len = blob.lengths[static_cast<std::size_t>(blobIdx)];
    if (off < 0 || len <= 0) {
        return rs::Status::NotFound;
    }
    if (off > static_cast<rs::i32>(blob.bytes.size()) ||
        len > static_cast<rs::i32>(blob.bytes.size()) - off) {
        return rs::Status::OutOfRange;
    }

    rs::ModelData decoded(alloc);
    const rs::Status ds = rs::decodeModelData(
        rs::Span<const rs::u8>(blob.bytes.data() + off, static_cast<std::size_t>(len)),
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
    const std::vector<rs::i32>& textureIds,
    const rs::i32 sceneTileX,
    const rs::i32 sceneTileY,
    std::vector<rs::u8>* outVertices,
    std::vector<rs::i32>* outIndices,
    rs::i32* outIndexCount) {
    if (!outVertices || !outIndices || !outIndexCount) {
        return rs::Status::InvalidArgument;
    }
    *outIndexCount = 0;

    const rs::i32 locX = sceneTileX * 128 + 64;
    const rs::i32 locZ = sceneTileY * 128 + 64;
    const rs::i32 tileHeight = 0;

    for (rs::i32 fi = 0; fi < model.faceCount; fi++) {
        rs::i32 textureId = -1;
        if (model.hasFaceTextures && fi < static_cast<rs::i32>(model.faceTextures.size())) {
            textureId = static_cast<rs::i32>(model.faceTextures[static_cast<std::size_t>(fi)]);
        }
        const rs::i32 packedTextureId = mapTextureIdToPackedIndex(textureIds, textureId);

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
            packedTextureId);
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
            packedTextureId);
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
            packedTextureId);
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
