static rs::i32 buildRuntimeCollisionFlagsFromCachedMapInput(
    MapRenderRuntimeState* runtime,
    const rs::i32 baseX,
    const rs::i32 baseY,
    const rs::i32 sizeX,
    const rs::i32 sizeY,
    const rs::i32 locLoadType,
    const std::vector<rs::i32>& mapSquareIds,
    const std::vector<rs::i32>& terrainOffsets,
    const std::vector<rs::i32>& terrainLengths,
    const std::vector<rs::u8>& terrainBytes,
    const std::vector<rs::i32>& locOffsets,
    const std::vector<rs::i32>& locLengths,
    const std::vector<rs::u8>& locBytes) {
    if (!runtime || sizeX <= 0 || sizeY <= 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    static constexpr rs::i32 kLevels = 4;
    const rs::i32 mapCount = static_cast<rs::i32>(mapSquareIds.size());
    const rs::i32 tileCount = kLevels * sizeX * sizeY;
    const rs::i32 heightCount = kLevels * (sizeX + 1) * (sizeY + 1);
    if (mapCount < 0 || tileCount <= 0 || heightCount <= 0) {
        return RS_MAP_RENDER_STATUS_INVALID_ARG;
    }

    // This uses the shared `rs_scene_bridge` seed builder to match TS's terrain/bridge transforms
    // and raw loc placement decode, then runs the shared collision resolver over the resulting
    // tile flags + floor blocks + loc placements.
    std::vector<rs::i32> tileHeights(static_cast<std::size_t>(heightCount));
    std::vector<rs::u8> tileRenderFlags(static_cast<std::size_t>(tileCount));
    std::vector<rs::u16> tileUnderlays(static_cast<std::size_t>(tileCount));
    std::vector<rs::i16> tileOverlays(static_cast<std::size_t>(tileCount));
    std::vector<rs::u8> tileShapes(static_cast<std::size_t>(tileCount));
    std::vector<rs::u8> tileRotations(static_cast<std::size_t>(tileCount));
    std::vector<rs::u8> blockedByFloor(static_cast<std::size_t>(tileCount));
    std::vector<rs::u8> tileMinLevels(static_cast<std::size_t>(tileCount));

    const rs::i32 locCount = rs_build_scene_render_seed_from_map_squares(
        baseX,
        baseY,
        sizeX,
        sizeY,
        locLoadType,
        runtime->cache.cacheGame,
        runtime->cache.cacheRevision,
        mapCount,
        mapCount > 0 ? mapSquareIds.data() : nullptr,
        mapCount > 0 ? terrainOffsets.data() : nullptr,
        mapCount > 0 ? terrainLengths.data() : nullptr,
        terrainBytes.empty() ? nullptr : terrainBytes.data(),
        static_cast<rs::i32>(terrainBytes.size()),
        mapCount > 0 ? locOffsets.data() : nullptr,
        mapCount > 0 ? locLengths.data() : nullptr,
        locBytes.empty() ? nullptr : locBytes.data(),
        static_cast<rs::i32>(locBytes.size()),
        tileHeights.data(),
        heightCount,
        tileRenderFlags.data(),
        tileCount,
        tileUnderlays.data(),
        tileCount,
        tileOverlays.data(),
        tileCount,
        tileShapes.data(),
        tileCount,
        tileRotations.data(),
        tileCount,
        blockedByFloor.data(),
        tileCount,
        tileMinLevels.data(),
        tileCount,
        /*outLocPlacements=*/nullptr,
        /*outLocPlacementIntsCapacity=*/0);
    if (locCount < 0) {
        runtime->debugLastCollisionFlags.clear();
        runtime->debugLastCollisionLevels = 0;
        runtime->debugLastCollisionSizeX = 0;
        runtime->debugLastCollisionSizeY = 0;
        return RS_MAP_RENDER_STATUS_STATE;
    }

    const rs::i32 placementStride = 7;
    const rs::i32 placementInts = locCount > 0 ? (locCount * placementStride) : 0;
    std::vector<rs::i32> locPlacements(static_cast<std::size_t>(placementInts));
    const rs::i32 locCount2 = rs_build_scene_render_seed_from_map_squares(
        baseX,
        baseY,
        sizeX,
        sizeY,
        locLoadType,
        runtime->cache.cacheGame,
        runtime->cache.cacheRevision,
        mapCount,
        mapCount > 0 ? mapSquareIds.data() : nullptr,
        mapCount > 0 ? terrainOffsets.data() : nullptr,
        mapCount > 0 ? terrainLengths.data() : nullptr,
        terrainBytes.empty() ? nullptr : terrainBytes.data(),
        static_cast<rs::i32>(terrainBytes.size()),
        mapCount > 0 ? locOffsets.data() : nullptr,
        mapCount > 0 ? locLengths.data() : nullptr,
        locBytes.empty() ? nullptr : locBytes.data(),
        static_cast<rs::i32>(locBytes.size()),
        tileHeights.data(),
        heightCount,
        tileRenderFlags.data(),
        tileCount,
        tileUnderlays.data(),
        tileCount,
        tileOverlays.data(),
        tileCount,
        tileShapes.data(),
        tileCount,
        tileRotations.data(),
        tileCount,
        blockedByFloor.data(),
        tileCount,
        tileMinLevels.data(),
        tileCount,
        locPlacements.empty() ? nullptr : locPlacements.data(),
        static_cast<rs::i32>(locPlacements.size()));
    if (locCount2 != locCount) {
        runtime->debugLastCollisionFlags.clear();
        runtime->debugLastCollisionLevels = 0;
        runtime->debugLastCollisionSizeX = 0;
        runtime->debugLastCollisionSizeY = 0;
        return RS_MAP_RENDER_STATUS_STATE;
    }

    std::vector<rs::i32> collisionXMajor(static_cast<std::size_t>(tileCount), 0);
    const rs::i32 status = rs_resolve_loc_placements_and_collision_from_initialized_types(
        kLevels,
        sizeX,
        sizeY,
        tileRenderFlags.data(),
        tileCount,
        blockedByFloor.data(),
        tileCount,
        locPlacements.empty() ? nullptr : locPlacements.data(),
        static_cast<rs::i32>(locPlacements.size()),
        runtime->cache.varps.empty() ? nullptr : runtime->cache.varps.data(),
        static_cast<rs::i32>(runtime->cache.varps.size()),
        collisionXMajor.data(),
        tileCount);
    if (status != 1) {
        runtime->debugLastCollisionFlags.clear();
        runtime->debugLastCollisionLevels = 0;
        runtime->debugLastCollisionSizeX = 0;
        runtime->debugLastCollisionSizeY = 0;
        return RS_MAP_RENDER_STATUS_STATE;
    }

    // Canonicalize to TS layout for consumers: y-major index = x + y*sizeX per level.
    runtime->debugLastCollisionFlags.assign(static_cast<std::size_t>(tileCount), 0);
    runtime->debugLastCollisionLevels = kLevels;
    runtime->debugLastCollisionSizeX = sizeX;
    runtime->debugLastCollisionSizeY = sizeY;
    for (rs::i32 level = 0; level < kLevels; level++) {
        const rs::i32 plane = level * sizeX * sizeY;
        for (rs::i32 x = 0; x < sizeX; x++) {
            for (rs::i32 y = 0; y < sizeY; y++) {
                const rs::i32 idxXMajor = plane + x * sizeY + y;
                const rs::i32 idxTs = plane + x + y * sizeX;
                runtime->debugLastCollisionFlags[static_cast<std::size_t>(idxTs)] =
                    collisionXMajor[static_cast<std::size_t>(idxXMajor)];
            }
        }
    }

    return RS_MAP_RENDER_STATUS_OK;
}
