// Extracted from rs_map_render_backend.cpp to keep runtime helper/type-demand logic modular.
static bool assignBytes(
    std::vector<rs::u8>* out,
    bool* outHas,
    const rs::u8* data,
    const rs::i32 dataLength) {
    if (!out || !outHas) {
        return false;
    }
    if (dataLength < 0) {
        return false;
    }
    if (dataLength > 0 && !data) {
        return false;
    }
    out->clear();
    if (dataLength > 0) {
        out->assign(data, data + static_cast<std::size_t>(dataLength));
        *outHas = true;
    } else {
        *outHas = false;
    }
    return true;
}

static rs::i32 divFloor(const rs::i32 num, const rs::i32 den) noexcept {
    if (den == 0) {
        return 0;
    }
    if (num >= 0) {
        return num / den;
    }
    return -(((-num) + den - 1) / den);
}

static rs::i32 divCeil(const rs::i32 num, const rs::i32 den) noexcept {
    if (den == 0) {
        return 0;
    }
    if (num >= 0) {
        return (num + den - 1) / den;
    }
    return -((-num) / den);
}

static constexpr rs::i32 kMapSquareSize = rs::TerrainConstants::MAP_SQUARE_SIZE;
static constexpr rs::i32 kRuntimeDrawBucketCount = 8;

static bool isRuntimeNewTerrainFormat(const MapRenderRuntimeState& runtime) noexcept {
    const rs::GameType game = static_cast<rs::GameType>(runtime.cache.cacheGame);
    return game == rs::GameType::Oldschool && runtime.cache.cacheRevision >= 209;
}

static rs::i32 collectRuntimeCachedMapInput(
    const MapRenderRuntimeState& runtime,
    const rs::i32 baseX,
    const rs::i32 baseY,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    std::vector<rs::i32>* outMapSquareIds,
    std::vector<rs::i32>* outTerrainOffsets,
    std::vector<rs::i32>* outTerrainLengths,
    std::vector<rs::u8>* outTerrainBytes,
    std::vector<rs::i32>* outLocOffsets,
    std::vector<rs::i32>* outLocLengths,
    std::vector<rs::u8>* outLocBytes) {
    if (!outMapSquareIds ||
        !outTerrainOffsets ||
        !outTerrainLengths ||
        !outTerrainBytes ||
        !outLocOffsets ||
        !outLocLengths ||
        !outLocBytes ||
        sizeX <= 0 ||
        sizeY <= 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    outMapSquareIds->clear();
    outTerrainOffsets->clear();
    outTerrainLengths->clear();
    outTerrainBytes->clear();
    outLocOffsets->clear();
    outLocLengths->clear();
    outLocBytes->clear();

    const rs::i32 mapStartX = divFloor(baseX, kMapSquareSize);
    const rs::i32 mapStartY = divFloor(baseY, kMapSquareSize);
    const rs::i32 mapEndX = divCeil(baseX + sizeX, kMapSquareSize);
    const rs::i32 mapEndY = divCeil(baseY + sizeY, kMapSquareSize);

    for (rs::i32 mapX = mapStartX; mapX < mapEndX; mapX++) {
        for (rs::i32 mapY = mapStartY; mapY < mapEndY; mapY++) {
            const rs::i32 key = mapSquareId(mapX, mapY);
            const auto it = runtime.cache.mapSquares.find(key);
            if (it == runtime.cache.mapSquares.end()) {
                continue;
            }
            const MapRenderCachedMapSquare& square = it->second;
            if (!square.hasTerrain && !square.hasLoc) {
                continue;
            }

            outMapSquareIds->push_back(key);

            if (square.hasTerrain && !square.terrainBytes.empty()) {
                if (outTerrainBytes->size() > static_cast<std::size_t>(2147483647)) {
                    return RS_MAP_RENDER_STATUS_CAPACITY;
                }
                outTerrainOffsets->push_back(static_cast<rs::i32>(outTerrainBytes->size()));
                outTerrainLengths->push_back(static_cast<rs::i32>(square.terrainBytes.size()));
                outTerrainBytes->insert(
                    outTerrainBytes->end(),
                    square.terrainBytes.begin(),
                    square.terrainBytes.end());
            } else {
                outTerrainOffsets->push_back(-1);
                outTerrainLengths->push_back(-1);
            }

            if (square.hasLoc && !square.locBytes.empty()) {
                if (outLocBytes->size() > static_cast<std::size_t>(2147483647)) {
                    return RS_MAP_RENDER_STATUS_CAPACITY;
                }
                outLocOffsets->push_back(static_cast<rs::i32>(outLocBytes->size()));
                outLocLengths->push_back(static_cast<rs::i32>(square.locBytes.size()));
                outLocBytes->insert(
                    outLocBytes->end(),
                    square.locBytes.begin(),
                    square.locBytes.end());
            } else {
                outLocOffsets->push_back(-1);
                outLocLengths->push_back(-1);
            }
        }
    }

    if (outMapSquareIds->empty()) {
        return RS_MAP_RENDER_STATUS_NOT_FOUND;
    }
    return RS_MAP_RENDER_STATUS_OK;
}

static rs::Status readI32LeRaw(
    const rs::u8* data,
    const rs::i32 length,
    const rs::i32 offset,
    rs::i32* out) noexcept {
    if (!data || !out || length < 0 || offset < 0 || offset > length - 4) {
        return rs::Status::InvalidArgument;
    }
    const rs::u32 b0 = static_cast<rs::u32>(data[offset + 0]);
    const rs::u32 b1 = static_cast<rs::u32>(data[offset + 1]);
    const rs::u32 b2 = static_cast<rs::u32>(data[offset + 2]);
    const rs::u32 b3 = static_cast<rs::u32>(data[offset + 3]);
    const rs::u32 v = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    *out = static_cast<rs::i32>(v);
    return rs::Status::Ok;
}

static rs::i32 collectRuntimeRequiredPrimaryTypePairs(
    MapRenderRuntimeState* runtime,
    const rs::i32 baseX,
    const rs::i32 baseY,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 includeLocs,
    const rs::i32 includeObjs,
    const rs::i32 includeNpcs,
    std::vector<rs::i32>* outPairs) {
    if (!runtime || !outPairs || sizeX <= 0 || sizeY <= 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outPairs->clear();
    const rs::i32 materializeStatus = materializeRuntimeTypeEntriesIfDirty(runtime);
    if (materializeStatus != RS_MAP_RENDER_STATUS_OK) {
        return materializeStatus;
    }

    const rs::i32 mapStartX = divFloor(baseX, kMapSquareSize);
    const rs::i32 mapStartY = divFloor(baseY, kMapSquareSize);
    const rs::i32 mapEndX = divCeil(baseX + sizeX, kMapSquareSize);
    const rs::i32 mapEndY = divCeil(baseY + sizeY, kMapSquareSize);

    std::unordered_set<rs::i32> locTypeIds{};
    std::unordered_set<rs::i32> npcTypeIds{};
    std::unordered_set<rs::i32> objTypeIds{};

    if (includeLocs != 0 || includeNpcs != 0) {
        rs::Allocator& alloc = rs::defaultAllocator();
        rs::Vec<rs::LocPlacement> placements(alloc);
        for (rs::i32 mapX = mapStartX; mapX < mapEndX; mapX++) {
            for (rs::i32 mapY = mapStartY; mapY < mapEndY; mapY++) {
                const rs::i32 key = mapSquareId(mapX, mapY);
                const auto it = runtime->cache.mapSquares.find(key);
                if (it == runtime->cache.mapSquares.end()) {
                    continue;
                }
                const MapRenderCachedMapSquare& square = it->second;
                if (includeLocs != 0 && square.hasLoc && !square.locBytes.empty()) {
                    placements.clear();
                    const rs::Status ds = rs::decodeLocPlacementsFromBytes(
                        rs::Span<const rs::u8>(square.locBytes.data(), square.locBytes.size()),
                        &placements,
                        alloc);
                    if (!rs::ok(ds)) {
                        return RS_MAP_RENDER_STATUS_STATE;
                    }
                    for (std::size_t i = 0; i < placements.size(); i++) {
                        const rs::i32 id = placements[i].id;
                        if (id >= 0) {
                            locTypeIds.insert(id);
                        }
                    }
                }
                if (includeNpcs != 0 && square.hasNpc && square.npcBytes.size() >= 4) {
                    const rs::i32 count = static_cast<rs::i32>(square.npcBytes.size() / 4);
                    for (rs::i32 i = 0; i < count; i++) {
                        const rs::i32 off = i * 4;
                        const rs::i32 npcId =
                            (static_cast<rs::i32>(square.npcBytes[static_cast<std::size_t>(off + 2)]) << 8) |
                            static_cast<rs::i32>(square.npcBytes[static_cast<std::size_t>(off + 3)]);
                        if (npcId >= 0) {
                            npcTypeIds.insert(npcId);
                        }
                    }
                }
            }
        }
    }

    if (includeObjs != 0 && runtime->cache.objSpawns.loaded) {
        const MapRenderCachedTypeBlob& objSpawns = runtime->cache.objSpawns;
        for (rs::i32 mapX = mapStartX; mapX < mapEndX; mapX++) {
            for (rs::i32 mapY = mapStartY; mapY < mapEndY; mapY++) {
                const rs::i32 mapId = mapSquareId(mapX, mapY);
                const auto found = std::lower_bound(
                    objSpawns.ids.begin(),
                    objSpawns.ids.end(),
                    mapId);
                if (found == objSpawns.ids.end() || (*found) != mapId) {
                    continue;
                }
                const rs::i32 mapIdx = static_cast<rs::i32>(found - objSpawns.ids.begin());
                if (mapIdx >= static_cast<rs::i32>(objSpawns.offsets.size()) ||
                    mapIdx >= static_cast<rs::i32>(objSpawns.lengths.size())) {
                    return RS_MAP_RENDER_STATUS_STATE;
                }
                const rs::i32 off = objSpawns.offsets[static_cast<std::size_t>(mapIdx)];
                const rs::i32 len = objSpawns.lengths[static_cast<std::size_t>(mapIdx)];
                if (off < 0 || len <= 0) {
                    continue;
                }
                if (off > static_cast<rs::i32>(objSpawns.bytes.size()) ||
                    len > static_cast<rs::i32>(objSpawns.bytes.size()) - off ||
                    (len % 20) != 0) {
                    return RS_MAP_RENDER_STATUS_STATE;
                }
                for (rs::i32 recOff = 0; recOff < len; recOff += 20) {
                    rs::i32 objId = -1;
                    const rs::Status status = readI32LeRaw(
                        objSpawns.bytes.data() + static_cast<std::size_t>(off),
                        len,
                        recOff,
                        &objId);
                    if (!rs::ok(status)) {
                        return RS_MAP_RENDER_STATUS_STATE;
                    }
                    if (objId >= 0) {
                        objTypeIds.insert(objId);
                    }
                }
            }
        }
    }

    std::vector<rs::i32> locSorted(locTypeIds.begin(), locTypeIds.end());
    std::vector<rs::i32> npcSorted(npcTypeIds.begin(), npcTypeIds.end());
    std::vector<rs::i32> objSorted(objTypeIds.begin(), objTypeIds.end());
    std::sort(locSorted.begin(), locSorted.end());
    std::sort(npcSorted.begin(), npcSorted.end());
    std::sort(objSorted.begin(), objSorted.end());

    const auto appendKindIds = [outPairs](const rs::i32 kind, const std::vector<rs::i32>& ids) {
        for (std::size_t i = 0; i < ids.size(); i++) {
            outPairs->push_back(kind);
            outPairs->push_back(ids[i]);
        }
    };
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_LOC, locSorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_NPC, npcSorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_OBJ, objSorted);

    return RS_MAP_RENDER_STATUS_OK;
}

static rs::i32 findTypeBlobIndexForDeps(
    const std::vector<rs::i32>& ids,
    const rs::i32 id) {
    for (std::size_t i = 0; i < ids.size(); i++) {
        if (ids[i] == id) {
            return static_cast<rs::i32>(i);
        }
    }
    return -1;
}

static rs::Status getTypeBlobEntrySpanForDeps(
    const MapRenderCachedTypeBlob& blob,
    const rs::i32 id,
    rs::Span<const rs::u8>* outBytes) {
    if (!outBytes || id < 0) {
        return rs::Status::InvalidArgument;
    }
    *outBytes = rs::Span<const rs::u8>();
    if (!blob.loaded) {
        return rs::Status::NotFound;
    }
    const rs::i32 blobIdx = findTypeBlobIndexForDeps(blob.ids, id);
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
    *outBytes = rs::Span<const rs::u8>(
        blob.bytes.data() + static_cast<std::size_t>(off),
        static_cast<std::size_t>(len));
    return rs::Status::Ok;
}

static rs::Status decodeLocTypeFromBlobForDeps(
    const MapRenderCachedTypeBlob& blob,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 locTypeId,
    rs::StringArena* strings,
    rs::Allocator& alloc,
    rs::LocType* outType) {
    if (!strings || !outType || locTypeId < 0) {
        return rs::Status::InvalidArgument;
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeBlobEntrySpanForDeps(blob, locTypeId, &bytes);
    if (!rs::ok(ss)) {
        return ss;
    }
    *outType = rs::LocType(locTypeId, cacheInfo);
    rs::Uint8ArrayReader reader(bytes, 0);
    rs::TypeDecodeError err{};
    rs::TypeDecodeContext ctx{cacheInfo, strings, &alloc};
    const rs::Status ds = rs::decodeType(*outType, reader, &err, &ctx);
    if (!rs::ok(ds)) {
        return ds;
    }
    outType->post();
    return rs::Status::Ok;
}

static rs::Status decodeObjTypeFromBlobForDeps(
    const MapRenderCachedTypeBlob& blob,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 objTypeId,
    rs::StringArena* strings,
    rs::Allocator& alloc,
    rs::ObjType* outType) {
    if (!strings || !outType || objTypeId < 0) {
        return rs::Status::InvalidArgument;
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeBlobEntrySpanForDeps(blob, objTypeId, &bytes);
    if (!rs::ok(ss)) {
        return ss;
    }
    *outType = rs::ObjType(objTypeId, cacheInfo);
    rs::Uint8ArrayReader reader(bytes, 0);
    rs::TypeDecodeError err{};
    rs::TypeDecodeContext ctx{cacheInfo, strings, &alloc};
    return rs::decodeType(*outType, reader, &err, &ctx);
}

static rs::Status decodeNpcTypeFromBlobForDeps(
    const MapRenderCachedTypeBlob& blob,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 npcTypeId,
    rs::StringArena* strings,
    rs::Allocator& alloc,
    rs::NpcType* outType) {
    if (!strings || !outType || npcTypeId < 0) {
        return rs::Status::InvalidArgument;
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeBlobEntrySpanForDeps(blob, npcTypeId, &bytes);
    if (!rs::ok(ss)) {
        return ss;
    }
    *outType = rs::NpcType(npcTypeId, cacheInfo);
    rs::Uint8ArrayReader reader(bytes, 0);
    rs::TypeDecodeError err{};
    rs::TypeDecodeContext ctx{cacheInfo, strings, &alloc};
    return rs::decodeType(*outType, reader, &err, &ctx);
}

static rs::Status decodeVarBitTypeFromBlobForDeps(
    const MapRenderCachedTypeBlob& blob,
    const rs::CacheInfo& cacheInfo,
    const rs::i32 varbitId,
    rs::VarBitType* outType) {
    if (!outType || varbitId < 0) {
        return rs::Status::InvalidArgument;
    }
    rs::Span<const rs::u8> bytes{};
    const rs::Status ss = getTypeBlobEntrySpanForDeps(blob, varbitId, &bytes);
    if (!rs::ok(ss)) {
        return ss;
    }
    *outType = rs::VarBitType(varbitId, cacheInfo);
    rs::Uint8ArrayReader reader(bytes, 0);
    rs::TypeDecodeError err{};
    return rs::decodeType(*outType, reader, &err, nullptr);
}

static rs::i32 getRuntimeVarpValueForDeps(
    const std::vector<rs::i32>& varps,
    const rs::i32 varpId) noexcept {
    if (varpId < 0 || static_cast<std::size_t>(varpId) >= varps.size()) {
        return 0;
    }
    return varps[static_cast<std::size_t>(varpId)];
}

static void appendNpcSeqIdsForDeps(
    const rs::NpcType& npcType,
    std::unordered_set<rs::i32>* outSeqTypeIds) {
    if (!outSeqTypeIds) {
        return;
    }
    const rs::i32 seqIds[] = {
        npcType.idleSeqId,
        npcType.turnLeftSeqId,
        npcType.turnRightSeqId,
        npcType.walkSeqId,
        npcType.walkBackSeqId,
        npcType.walkLeftSeqId,
        npcType.walkRightSeqId,
        npcType.runSeqId,
        npcType.runBackSeqId,
        npcType.runLeftSeqId,
        npcType.runRightSeqId,
        npcType.crawlSeqId,
        npcType.crawlBackSeqId,
        npcType.crawlLeftSeqId,
        npcType.crawlRightSeqId,
    };
    for (std::size_t i = 0; i < (sizeof(seqIds) / sizeof(seqIds[0])); i++) {
        const rs::i32 seqId = seqIds[i];
        if (seqId >= 0) {
            outSeqTypeIds->insert(seqId);
        }
    }
}

static rs::i32 collectRuntimeRequiredExpandedTypePairs(
    MapRenderRuntimeState* runtime,
    const rs::i32 baseX,
    const rs::i32 baseY,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 includeLocs,
    const rs::i32 includeObjs,
    const rs::i32 includeNpcs,
    std::vector<rs::i32>* outPairs) {
    if (!runtime || !outPairs || sizeX <= 0 || sizeY <= 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }
    outPairs->clear();
    const rs::i32 materializeStatus = materializeRuntimeTypeEntriesIfDirty(runtime);
    if (materializeStatus != RS_MAP_RENDER_STATUS_OK) {
        return materializeStatus;
    }

    std::vector<rs::i32> primaryPairs{};
    const rs::i32 primaryStatus = collectRuntimeRequiredPrimaryTypePairs(
        runtime,
        baseX,
        baseY,
        sizeX,
        sizeY,
        includeLocs,
        includeObjs,
        includeNpcs,
        &primaryPairs);
    if (primaryStatus != RS_MAP_RENDER_STATUS_OK) {
        return primaryStatus;
    }

    std::unordered_set<rs::i32> locTypeIds{};
    std::unordered_set<rs::i32> objTypeIds{};
    std::unordered_set<rs::i32> npcTypeIds{};
    std::unordered_set<rs::i32> varbitTypeIds{};
    std::unordered_set<rs::i32> modelIds{};
    std::unordered_set<rs::i32> seqTypeIds{};
    std::unordered_set<rs::i32> basTypeIds{};
    std::unordered_set<rs::i32> underlayTypeIds{};
    std::unordered_set<rs::i32> overlayTypeIds{};

    for (std::size_t i = 0; i + 1 < primaryPairs.size(); i += 2) {
        const rs::i32 kind = primaryPairs[i];
        const rs::i32 id = primaryPairs[i + 1];
        if (id < 0) {
            continue;
        }
        if (kind == RS_MAP_RENDER_TYPE_BLOB_LOC) {
            locTypeIds.insert(id);
        } else if (kind == RS_MAP_RENDER_TYPE_BLOB_OBJ) {
            objTypeIds.insert(id);
        } else if (kind == RS_MAP_RENDER_TYPE_BLOB_NPC) {
            npcTypeIds.insert(id);
        }
    }

    rs::CacheInfo cacheInfo{};
    cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
    cacheInfo.revision = runtime->cache.cacheRevision;
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::StringArena strings(alloc, 1 << 14);

    const rs::i32 mapStartX = divFloor(baseX, kMapSquareSize);
    const rs::i32 mapStartY = divFloor(baseY, kMapSquareSize);
    const rs::i32 mapEndX = divCeil(baseX + sizeX, kMapSquareSize);
    const rs::i32 mapEndY = divCeil(baseY + sizeY, kMapSquareSize);
    const bool newTerrainFormat = isRuntimeNewTerrainFormat(*runtime);
    rs::TerrainSquare terrainScratch{};
    const auto terrainInit = terrainScratch.init(alloc);
    if (!terrainInit.isOk()) {
        return RS_MAP_RENDER_STATUS_STATE;
    }
    for (rs::i32 mapX = mapStartX; mapX < mapEndX; mapX++) {
        for (rs::i32 mapY = mapStartY; mapY < mapEndY; mapY++) {
            const rs::i32 key = mapSquareId(mapX, mapY);
            const auto it = runtime->cache.mapSquares.find(key);
            if (it == runtime->cache.mapSquares.end()) {
                continue;
            }
            const MapRenderCachedMapSquare& square = it->second;
            if (!square.hasTerrain || square.terrainBytes.empty()) {
                continue;
            }
            const rs::Status ds = rs::decodeTerrainSquareFromBytesInto(
                terrainScratch,
                rs::Span<const rs::u8>(square.terrainBytes.data(), square.terrainBytes.size()),
                newTerrainFormat,
                mapX * kMapSquareSize,
                mapY * kMapSquareSize);
            if (!rs::ok(ds)) {
                return RS_MAP_RENDER_STATUS_STATE;
            }
            const rs::i32 worldTileX0 = mapX * kMapSquareSize;
            const rs::i32 worldTileY0 = mapY * kMapSquareSize;
            for (rs::i32 level = 0; level < rs::TerrainConstants::MAX_LEVELS; level++) {
                for (rs::i32 tileX = 0; tileX < kMapSquareSize; tileX++) {
                    const rs::i32 worldX = worldTileX0 + tileX;
                    if (worldX < baseX || worldX >= (baseX + sizeX)) {
                        continue;
                    }
                    for (rs::i32 tileY = 0; tileY < kMapSquareSize; tileY++) {
                        const rs::i32 worldY = worldTileY0 + tileY;
                        if (worldY < baseY || worldY >= (baseY + sizeY)) {
                            continue;
                        }
                        const rs::i32 underlayRaw =
                            static_cast<rs::i32>(terrainScratch.underlay(level, tileX, tileY));
                        if (underlayRaw > 0) {
                            underlayTypeIds.insert(underlayRaw - 1);
                        }
                        const rs::i32 overlayRaw =
                            static_cast<rs::i32>(terrainScratch.overlay(level, tileX, tileY));
                        if (overlayRaw > 0) {
                            overlayTypeIds.insert(overlayRaw - 1);
                        }
                    }
                }
            }
        }
    }

    std::unordered_map<rs::i32, rs::LocType> locTypeCache{};
    std::unordered_set<rs::i32> locTypeMissing{};
    auto getLocType = [&](const rs::i32 typeId) -> const rs::LocType* {
        if (typeId < 0) {
            return nullptr;
        }
        const auto it = locTypeCache.find(typeId);
        if (it != locTypeCache.end()) {
            return &it->second;
        }
        if (locTypeMissing.find(typeId) != locTypeMissing.end()) {
            return nullptr;
        }
        rs::LocType decoded{};
        const rs::Status ds = decodeLocTypeFromBlobForDeps(
            runtime->cache.locTypes,
            cacheInfo,
            typeId,
            &strings,
            alloc,
            &decoded);
        if (!rs::ok(ds)) {
            locTypeMissing.insert(typeId);
            return nullptr;
        }
        const auto inserted = locTypeCache.emplace(typeId, rs::move(decoded));
        return &inserted.first->second;
    };

    std::unordered_map<rs::i32, rs::ObjType> objTypeCache{};
    std::unordered_set<rs::i32> objTypeMissing{};
    auto getObjType = [&](const rs::i32 typeId) -> const rs::ObjType* {
        if (typeId < 0) {
            return nullptr;
        }
        const auto it = objTypeCache.find(typeId);
        if (it != objTypeCache.end()) {
            return &it->second;
        }
        if (objTypeMissing.find(typeId) != objTypeMissing.end()) {
            return nullptr;
        }
        rs::ObjType decoded{};
        const rs::Status ds = decodeObjTypeFromBlobForDeps(
            runtime->cache.objTypes,
            cacheInfo,
            typeId,
            &strings,
            alloc,
            &decoded);
        if (!rs::ok(ds)) {
            objTypeMissing.insert(typeId);
            return nullptr;
        }
        const auto inserted = objTypeCache.emplace(typeId, rs::move(decoded));
        return &inserted.first->second;
    };

    std::unordered_map<rs::i32, rs::NpcType> npcTypeCache{};
    std::unordered_set<rs::i32> npcTypeMissing{};
    auto getNpcType = [&](const rs::i32 typeId) -> const rs::NpcType* {
        if (typeId < 0) {
            return nullptr;
        }
        const auto it = npcTypeCache.find(typeId);
        if (it != npcTypeCache.end()) {
            return &it->second;
        }
        if (npcTypeMissing.find(typeId) != npcTypeMissing.end()) {
            return nullptr;
        }
        rs::NpcType decoded{};
        const rs::Status ds = decodeNpcTypeFromBlobForDeps(
            runtime->cache.npcTypes,
            cacheInfo,
            typeId,
            &strings,
            alloc,
            &decoded);
        if (!rs::ok(ds)) {
            npcTypeMissing.insert(typeId);
            return nullptr;
        }
        const auto inserted = npcTypeCache.emplace(typeId, rs::move(decoded));
        return &inserted.first->second;
    };

    std::unordered_map<rs::i32, rs::VarBitType> varbitTypeCache{};
    std::unordered_set<rs::i32> varbitTypeMissing{};
    auto getVarbitType = [&](const rs::i32 typeId) -> const rs::VarBitType* {
        if (typeId < 0) {
            return nullptr;
        }
        const auto it = varbitTypeCache.find(typeId);
        if (it != varbitTypeCache.end()) {
            return &it->second;
        }
        if (varbitTypeMissing.find(typeId) != varbitTypeMissing.end()) {
            return nullptr;
        }
        rs::VarBitType decoded{};
        const rs::Status ds = decodeVarBitTypeFromBlobForDeps(
            runtime->cache.varbits,
            cacheInfo,
            typeId,
            &decoded);
        if (!rs::ok(ds)) {
            varbitTypeMissing.insert(typeId);
            return nullptr;
        }
        const auto inserted = varbitTypeCache.emplace(typeId, rs::move(decoded));
        return &inserted.first->second;
    };

    auto getVarbitValue = [&](const rs::i32 varbitId) -> rs::i32 {
        const rs::VarBitType* varbit = getVarbitType(varbitId);
        if (!varbit) {
            return 0;
        }
        const rs::i32 varpValue = getRuntimeVarpValueForDeps(runtime->cache.varps, varbit->baseVar);
        const rs::i32 bitCount = varbit->endBit - varbit->startBit + 1;
        if (bitCount <= 0 || bitCount > 31) {
            return 0;
        }
        const rs::i32 mask = (1 << bitCount) - 1;
        return (varpValue >> varbit->startBit) & mask;
    };

    if (includeLocs != 0) {
        std::vector<rs::i32> locQueue(locTypeIds.begin(), locTypeIds.end());
        std::size_t locQueueIndex = 0;
        while (locQueueIndex < locQueue.size()) {
            const rs::i32 locTypeId = locQueue[locQueueIndex++];
            if (locTypeId < 0) {
                continue;
            }
            const rs::LocType* locType = getLocType(locTypeId);
            if (!locType) {
                continue;
            }

            if (locType->transformVarbit >= 0) {
                varbitTypeIds.insert(locType->transformVarbit);
            }

            const rs::i32 transformIndex =
                (locType->transformVarbit >= 0)
                    ? getVarbitValue(locType->transformVarbit)
                    : ((locType->transformVarp >= 0)
                           ? getRuntimeVarpValueForDeps(runtime->cache.varps, locType->transformVarp)
                           : -1);
            const rs::i32 resolvedTransformId = locType->resolveTransformId(transformIndex);
            if (resolvedTransformId >= 0 &&
                locTypeIds.insert(resolvedTransformId).second) {
                locQueue.push_back(resolvedTransformId);
            }

            for (std::size_t i = 0; i < locType->transforms.size(); i++) {
                const rs::i32 transformId = locType->transforms[i];
                if (transformId >= 0 &&
                    locTypeIds.insert(transformId).second) {
                    locQueue.push_back(transformId);
                }
            }

            for (std::size_t g = 0; g < locType->models.size(); g++) {
                const rs::Vec<rs::i32>& group = locType->models[g];
                for (std::size_t j = 0; j < group.size(); j++) {
                    const rs::i32 modelId = group[j];
                    if (modelId >= 0) {
                        modelIds.insert(modelId);
                    }
                }
            }
            if (locType->seqId >= 0) {
                seqTypeIds.insert(locType->seqId);
            }
            for (std::size_t i = 0; i < locType->randomSeqIds.size(); i++) {
                const rs::i32 seqId = locType->randomSeqIds[i];
                if (seqId >= 0) {
                    seqTypeIds.insert(seqId);
                }
            }
        }
    }

    if (includeObjs != 0 && runtime->cache.objSpawns.loaded) {
        const MapRenderCachedTypeBlob& objSpawns = runtime->cache.objSpawns;
        for (rs::i32 mapX = mapStartX; mapX < mapEndX; mapX++) {
            for (rs::i32 mapY = mapStartY; mapY < mapEndY; mapY++) {
                const rs::i32 mapId = mapSquareId(mapX, mapY);
                const auto found = std::lower_bound(
                    objSpawns.ids.begin(),
                    objSpawns.ids.end(),
                    mapId);
                if (found == objSpawns.ids.end() || (*found) != mapId) {
                    continue;
                }
                const rs::i32 mapIdx = static_cast<rs::i32>(found - objSpawns.ids.begin());
                if (mapIdx >= static_cast<rs::i32>(objSpawns.offsets.size()) ||
                    mapIdx >= static_cast<rs::i32>(objSpawns.lengths.size())) {
                    return RS_MAP_RENDER_STATUS_STATE;
                }
                const rs::i32 off = objSpawns.offsets[static_cast<std::size_t>(mapIdx)];
                const rs::i32 len = objSpawns.lengths[static_cast<std::size_t>(mapIdx)];
                if (off < 0 || len <= 0) {
                    continue;
                }
                if (off > static_cast<rs::i32>(objSpawns.bytes.size()) ||
                    len > static_cast<rs::i32>(objSpawns.bytes.size()) - off ||
                    (len % 20) != 0) {
                    return RS_MAP_RENDER_STATUS_STATE;
                }
                for (rs::i32 recOff = 0; recOff < len; recOff += 20) {
                    rs::i32 spawnObjId = -1;
                    rs::i32 spawnObjCount = 0;
                    rs::Status s = readI32LeRaw(
                        objSpawns.bytes.data() + static_cast<std::size_t>(off),
                        len,
                        recOff + 0,
                        &spawnObjId);
                    if (!rs::ok(s)) {
                        return RS_MAP_RENDER_STATUS_STATE;
                    }
                    s = readI32LeRaw(
                        objSpawns.bytes.data() + static_cast<std::size_t>(off),
                        len,
                        recOff + 4,
                        &spawnObjCount);
                    if (!rs::ok(s)) {
                        return RS_MAP_RENDER_STATUS_STATE;
                    }
                    if (spawnObjId < 0) {
                        continue;
                    }
                    rs::i32 currentObjId = spawnObjId;
                    rs::i32 currentObjCount = spawnObjCount;
                    for (rs::i32 depth = 0; depth < 16; depth++) {
                        if (currentObjId < 0) {
                            break;
                        }
                        objTypeIds.insert(currentObjId);
                        const rs::ObjType* objType = getObjType(currentObjId);
                        if (!objType) {
                            break;
                        }
                        if (depth == 0 && rs::equalsIgnoreCaseAscii(objType->name, "null")) {
                            break;
                        }
                        if (objType->model >= 0) {
                            modelIds.insert(objType->model);
                        }

                        rs::i32 nextObjId = -1;
                        if (currentObjCount > 1 &&
                            !objType->countObj.empty() &&
                            !objType->countCo.empty()) {
                            const std::size_t n = std::min(
                                static_cast<std::size_t>(10),
                                std::min(objType->countObj.size(), objType->countCo.size()));
                            for (std::size_t i = 0; i < n; i++) {
                                const rs::i32 threshold = objType->countCo[i];
                                if (threshold != 0 && currentObjCount >= threshold) {
                                    nextObjId = objType->countObj[i];
                                }
                            }
                        }
                        if (nextObjId < 0 || nextObjId == currentObjId) {
                            break;
                        }
                        currentObjId = nextObjId;
                        currentObjCount = 1;
                    }
                }
            }
        }
    }

    if (includeNpcs != 0) {
        std::vector<rs::i32> npcQueue(npcTypeIds.begin(), npcTypeIds.end());
        std::size_t npcQueueIndex = 0;
        while (npcQueueIndex < npcQueue.size()) {
            const rs::i32 npcTypeId = npcQueue[npcQueueIndex++];
            if (npcTypeId < 0) {
                continue;
            }
            const rs::NpcType* npcType = getNpcType(npcTypeId);
            if (!npcType) {
                continue;
            }

            if (npcType->transformVarbit >= 0) {
                varbitTypeIds.insert(npcType->transformVarbit);
            }
            if (npcType->basTypeId >= 0) {
                basTypeIds.insert(npcType->basTypeId);
            }
            for (std::size_t i = 0; i < npcType->modelIds.size(); i++) {
                const rs::i32 modelId = npcType->modelIds[i];
                if (modelId >= 0) {
                    modelIds.insert(modelId);
                }
            }
            appendNpcSeqIdsForDeps(*npcType, &seqTypeIds);

            const rs::i32 transformIndex =
                (npcType->transformVarbit >= 0)
                    ? getVarbitValue(npcType->transformVarbit)
                    : ((npcType->transformVarp >= 0)
                           ? getRuntimeVarpValueForDeps(runtime->cache.varps, npcType->transformVarp)
                           : -1);
            rs::i32 resolvedTransformId = -1;
            if (!npcType->transforms.empty()) {
                resolvedTransformId = npcType->transforms[npcType->transforms.size() - 1];
                if (transformIndex >= 0 &&
                    transformIndex < static_cast<rs::i32>(npcType->transforms.size()) - 1) {
                    const rs::i32 candidate = npcType->transforms[static_cast<std::size_t>(transformIndex)];
                    if (candidate != -1) {
                        resolvedTransformId = candidate;
                    }
                }
            }
            if (resolvedTransformId >= 0 &&
                npcTypeIds.insert(resolvedTransformId).second) {
                npcQueue.push_back(resolvedTransformId);
            }
            for (std::size_t i = 0; i < npcType->transforms.size(); i++) {
                const rs::i32 transformId = npcType->transforms[i];
                if (transformId >= 0 &&
                    npcTypeIds.insert(transformId).second) {
                    npcQueue.push_back(transformId);
                }
            }
        }
    }

    std::vector<rs::i32> locSorted(locTypeIds.begin(), locTypeIds.end());
    std::vector<rs::i32> objSorted(objTypeIds.begin(), objTypeIds.end());
    std::vector<rs::i32> npcSorted(npcTypeIds.begin(), npcTypeIds.end());
    std::vector<rs::i32> varbitSorted(varbitTypeIds.begin(), varbitTypeIds.end());
    std::vector<rs::i32> modelSorted(modelIds.begin(), modelIds.end());
    std::vector<rs::i32> seqSorted(seqTypeIds.begin(), seqTypeIds.end());
    std::vector<rs::i32> basSorted(basTypeIds.begin(), basTypeIds.end());
    std::vector<rs::i32> underlaySorted(underlayTypeIds.begin(), underlayTypeIds.end());
    std::vector<rs::i32> overlaySorted(overlayTypeIds.begin(), overlayTypeIds.end());

    std::sort(locSorted.begin(), locSorted.end());
    std::sort(objSorted.begin(), objSorted.end());
    std::sort(npcSorted.begin(), npcSorted.end());
    std::sort(varbitSorted.begin(), varbitSorted.end());
    std::sort(modelSorted.begin(), modelSorted.end());
    std::sort(seqSorted.begin(), seqSorted.end());
    std::sort(basSorted.begin(), basSorted.end());
    std::sort(underlaySorted.begin(), underlaySorted.end());
    std::sort(overlaySorted.begin(), overlaySorted.end());

    const auto appendKindIds = [outPairs](const rs::i32 kind, const std::vector<rs::i32>& ids) {
        for (std::size_t i = 0; i < ids.size(); i++) {
            outPairs->push_back(kind);
            outPairs->push_back(ids[i]);
        }
    };
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_LOC, locSorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_OBJ, objSorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_NPC, npcSorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_VARBIT, varbitSorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_MODEL, modelSorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_SEQ_TYPE, seqSorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_BAS, basSorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_UNDERLAY, underlaySorted);
    appendKindIds(RS_MAP_RENDER_TYPE_BLOB_OVERLAY, overlaySorted);
    return RS_MAP_RENDER_STATUS_OK;
}
