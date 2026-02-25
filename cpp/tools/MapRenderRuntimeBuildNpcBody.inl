if (runtimeHandle <= 0 || sizeX <= 0 || sizeY <= 0 || borderSize < 0) {
    return RS_MAP_RENDER_STATUS_INVALID_ARG;
}
MapRenderRuntimeState* runtime = getMapRenderRuntime(runtimeHandle);
if (!runtime) {
    return RS_MAP_RENDER_STATUS_NOT_FOUND;
}

rs::tooling::MapRenderLoadedPayloadState loaded{};
loaded.bucketCmdCounts.assign(static_cast<std::size_t>(RS_DRAW_BUCKET_COUNT), 0);
loaded.bucketModelInfoLengths.assign(static_cast<std::size_t>(RS_DRAW_BUCKET_COUNT), 0);
loaded.drawRangesPacked.clear();
loaded.totalModelInfoLength = 0;
loaded.levels = RS_SCENE_LEVELS;
loaded.sizeX = sizeX;
loaded.sizeY = sizeY;
loaded.unitsTileHeightBasis = runtime->cache.unitsTileHeightBasis;

rs::CacheInfo cacheInfo{};
cacheInfo.game = static_cast<rs::GameType>(runtime->cache.cacheGame);
cacheInfo.revision = runtime->cache.cacheRevision;

const rs::i32 mapId = mapSquareId(mapX, mapY);
auto it = runtime->cache.mapSquares.find(mapId);
if (it != runtime->cache.mapSquares.end()) {
    const MapRenderCachedMapSquare& square = it->second;
    if (square.hasNpc && !square.npcBytes.empty()) {
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
            rs::Span<const rs::u8>(square.npcBytes.data(), square.npcBytes.size()),
            &spawns,
            alloc);
        if (!rs::ok(ds)) {
            return mapRenderStatusFromCoreStatus(ds);
        }

        rs::StringArena strings(alloc);
        std::vector<DecodedNpcTypeCacheEntry> npcCache{};
        npcCache.reserve(128);
        std::vector<DecodedBasTypeCacheEntry> basCache{};
        basCache.reserve(64);
        std::vector<DecodedVarBitTypeCacheEntry> varbitCache{};
        varbitCache.reserve(64);
        std::unordered_map<std::uint64_t, rs::i32> npcTupleOccurrences{};

        const rs::i32 mapBaseX = mapX * kMapSquareSize;
        const rs::i32 mapBaseY = mapY * kMapSquareSize;
        for (std::size_t i = 0; i < spawns.size(); i++) {
            const rs::NpcSpawn& spawn = spawns[i];
            const rs::i32 sceneTileX = (spawn.x - mapBaseX) + borderSize;
            const rs::i32 sceneTileY = (spawn.y - mapBaseY) + borderSize;
            if (sceneTileX < 0 || sceneTileY < 0 || sceneTileX >= sizeX || sceneTileY >= sizeY) {
                continue;
            }

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
            if ((npcType->loginScreenProps & 0x1) == 0) {
                continue;
            }

            const rs::BasType* basType = nullptr;
            if (npcType->basTypeId >= 0) {
                const rs::Status basStatus = tryDecodeBasTypeFromBlobCached(
                    runtime->cache.basTypes,
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

            const rs::i32 indexStart = static_cast<rs::i32>(loaded.npcIndices.size());
            for (std::size_t mi = 0; mi < npcType->modelIds.size(); mi++) {
                const rs::i32 modelId = npcType->modelIds[mi];
                if (modelId < 0) {
                    continue;
                }

                rs::ModelData model(alloc);
                const rs::Status ms = tryDecodeModelDataFromBlob(
                    runtime->cache.models,
                    modelId,
                    alloc,
                    &model);
                if (!rs::ok(ms)) {
                    continue;
                }

                applyNpcModelMutations(&model, *npcType);

                rs::i32 modelIndexCount = 0;
                const rs::Status gs = appendNpcModelGeometry(
                    model,
                    runtime->cache.textureIds.ids,
                    sceneTileX,
                    sceneTileY,
                    &loaded.npcVertices,
                    &loaded.npcIndices,
                    &modelIndexCount);
                if (!rs::ok(gs)) {
                    return mapRenderStatusFromCoreStatus(gs);
                }
            }

            const rs::i32 indexCount = static_cast<rs::i32>(loaded.npcIndices.size()) - indexStart;
            if (indexCount <= 0) {
                continue;
            }

            const std::uint64_t tupleKey =
                (static_cast<std::uint64_t>(static_cast<rs::u16>(spawn.level & 0xffff)) << 48) |
                (static_cast<std::uint64_t>(static_cast<rs::u16>(spawn.id & 0xffff)) << 32) |
                (static_cast<std::uint64_t>(static_cast<rs::u16>(spawn.x & 0xffff)) << 16) |
                static_cast<std::uint64_t>(static_cast<rs::u16>(spawn.y & 0xffff));
            const rs::i32 occurrence = npcTupleOccurrences[tupleKey]++;
            loaded.npcOrderKeys.push_back(makeNpcOrderKey(spawn, occurrence));
            loaded.npcDrawRangesBase.push_back(indexStart * 4);
            loaded.npcDrawRangesBase.push_back(indexCount);
            loaded.npcDrawRangesBase.push_back(1);
        }
    }
}

loaded.loaded = true;
runtime->mapPayload = std::move(loaded);
runtime->payloadGeneration++;
clearPacketHandlesForRuntime(runtimeHandle);
return RS_MAP_RENDER_STATUS_OK;
