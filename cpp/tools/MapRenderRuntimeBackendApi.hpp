#pragma once

#include "../rs/types.hpp"

namespace rs::tooling {

template <typename Runtime, typename MapSquareIdFn, typename AssignBytesFn>
inline i32 runtimeCachePutMapSquare(
    Runtime* runtime,
    const i32 mapX,
    const i32 mapY,
    const u8* terrainBytes,
    const i32 terrainBytesLength,
    const u8* locBytes,
    const i32 locBytesLength,
    const u8* npcBytes,
    const i32 npcBytesLength,
    MapSquareIdFn&& mapSquareId,
    AssignBytesFn&& assignBytes,
    const i32 invalidArgStatus,
    const i32 okStatus) {
    if (!runtime) {
        return invalidArgStatus;
    }

    const i32 key = mapSquareId(mapX, mapY);
    auto& square = runtime->cache.mapSquares[key];
    if (!assignBytes(&square.terrainBytes, &square.hasTerrain, terrainBytes, terrainBytesLength) ||
        !assignBytes(&square.locBytes, &square.hasLoc, locBytes, locBytesLength) ||
        !assignBytes(&square.npcBytes, &square.hasNpc, npcBytes, npcBytesLength)) {
        return invalidArgStatus;
    }
    if (!square.hasTerrain && !square.hasLoc && !square.hasNpc) {
        runtime->cache.mapSquares.erase(key);
    }
    return okStatus;
}

template <typename Runtime, typename MapSquareIdFn, typename AssignBytesFn>
inline i32 runtimeCachePutMapSquaresPacked(
    Runtime* runtime,
    const i32 count,
    const i32* mapXs,
    const i32* mapYs,
    const i32* terrainOffsets,
    const i32* terrainLengths,
    const u8* terrainBytes,
    const i32 terrainBytesLength,
    const i32* locOffsets,
    const i32* locLengths,
    const u8* locBytes,
    const i32 locBytesLength,
    const i32* npcOffsets,
    const i32* npcLengths,
    const u8* npcBytes,
    const i32 npcBytesLength,
    MapSquareIdFn&& mapSquareId,
    AssignBytesFn&& assignBytes,
    const i32 invalidArgStatus,
    const i32 okStatus) {
    if (!runtime || count < 0 || terrainBytesLength < 0 || locBytesLength < 0 || npcBytesLength < 0) {
        return invalidArgStatus;
    }
    if (count == 0) {
        return okStatus;
    }
    if (!mapXs || !mapYs || !terrainOffsets || !terrainLengths || !locOffsets || !locLengths ||
        !npcOffsets || !npcLengths) {
        return invalidArgStatus;
    }
    if (terrainBytesLength > 0 && !terrainBytes) {
        return invalidArgStatus;
    }
    if (locBytesLength > 0 && !locBytes) {
        return invalidArgStatus;
    }
    if (npcBytesLength > 0 && !npcBytes) {
        return invalidArgStatus;
    }

    auto resolveSlice = [](const u8* bytes,
                           const i32 bytesLength,
                           const i32 offset,
                           const i32 length,
                           const u8** outData,
                           i32* outLength) -> bool {
        if (!outData || !outLength) {
            return false;
        }
        if (length <= 0 || offset < 0) {
            *outData = nullptr;
            *outLength = 0;
            return true;
        }
        if (!bytes || bytesLength < 0 || offset > bytesLength || length > (bytesLength - offset)) {
            return false;
        }
        *outData = bytes + offset;
        *outLength = length;
        return true;
    };

    for (i32 i = 0; i < count; i++) {
        const i32 mapX = mapXs[i];
        const i32 mapY = mapYs[i];
        const i32 terrainOffset = terrainOffsets[i];
        const i32 terrainLength = terrainLengths[i];
        const i32 locOffset = locOffsets[i];
        const i32 locLength = locLengths[i];
        const i32 npcOffset = npcOffsets[i];
        const i32 npcLength = npcLengths[i];

        const u8* terrainData = nullptr;
        i32 terrainDataLength = 0;
        if (!resolveSlice(
                terrainBytes,
                terrainBytesLength,
                terrainOffset,
                terrainLength,
                &terrainData,
                &terrainDataLength)) {
            return invalidArgStatus;
        }
        const u8* locData = nullptr;
        i32 locDataLength = 0;
        if (!resolveSlice(locBytes, locBytesLength, locOffset, locLength, &locData, &locDataLength)) {
            return invalidArgStatus;
        }
        const u8* npcData = nullptr;
        i32 npcDataLength = 0;
        if (!resolveSlice(npcBytes, npcBytesLength, npcOffset, npcLength, &npcData, &npcDataLength)) {
            return invalidArgStatus;
        }

        const i32 key = mapSquareId(mapX, mapY);
        auto& square = runtime->cache.mapSquares[key];
        if (!assignBytes(&square.terrainBytes, &square.hasTerrain, terrainData, terrainDataLength) ||
            !assignBytes(&square.locBytes, &square.hasLoc, locData, locDataLength) ||
            !assignBytes(&square.npcBytes, &square.hasNpc, npcData, npcDataLength)) {
            return invalidArgStatus;
        }
        if (!square.hasTerrain && !square.hasLoc && !square.hasNpc) {
            runtime->cache.mapSquares.erase(key);
        }
    }

    return okStatus;
}

template <typename Runtime>
inline i32 runtimeCacheClearMapSquares(
    Runtime* runtime,
    const i32 invalidArgStatus,
    const i32 okStatus) {
    if (!runtime) {
        return invalidArgStatus;
    }
    runtime->cache.mapSquares.clear();
    return okStatus;
}

template <typename Runtime, typename ResolveBlobFn>
inline i32 runtimeCachePutTypeBlob(
    Runtime* runtime,
    const i32 kind,
    const i32* ids,
    const i32* offsets,
    const i32* lengths,
    const i32 count,
    const u8* bytes,
    const i32 bytesLength,
    ResolveBlobFn&& resolveBlob,
    const i32 invalidArgStatus,
    const i32 okStatus) {
    if (!runtime || count < 0 || bytesLength < 0) {
        return invalidArgStatus;
    }
    if (count > 0 && (!ids || !offsets || !lengths)) {
        return invalidArgStatus;
    }
    if (bytesLength > 0 && !bytes) {
        return invalidArgStatus;
    }

    auto* blob = resolveBlob(runtime, kind);
    if (!blob) {
        return invalidArgStatus;
    }

    blob->ids.assign(ids, ids + static_cast<std::size_t>(count));
    blob->offsets.assign(offsets, offsets + static_cast<std::size_t>(count));
    blob->lengths.assign(lengths, lengths + static_cast<std::size_t>(count));
    blob->bytes.assign(bytes, bytes + static_cast<std::size_t>(bytesLength));
    blob->loaded = true;
    runtime->cache.typeGeneration++;
    runtime->cache.appliedTypeGeneration = -1;
    return okStatus;
}

template <typename Runtime>
inline i32 runtimeCacheSetVarps(
    Runtime* runtime,
    const i32* varps,
    const i32 varpCount,
    const i32 invalidArgStatus,
    const i32 okStatus) {
    if (!runtime || varpCount < 0) {
        return invalidArgStatus;
    }
    if (varpCount > 0 && !varps) {
        return invalidArgStatus;
    }
    runtime->cache.varps.assign(varps, varps + static_cast<std::size_t>(varpCount));
    return okStatus;
}

template <typename BuildFn, typename RuntimeLookupFn, typename AllocatePacketHandleFn>
inline i32 runtimeBuildPacketHandle(
    const i32 runtimeHandle,
    i32* outPacketHandle,
    BuildFn&& build,
    RuntimeLookupFn&& lookupRuntime,
    AllocatePacketHandleFn&& allocatePacketHandle,
    const i32 okStatus,
    const i32 invalidArgStatus,
    const i32 stateStatus,
    const i32 capacityStatus) {
    if (!outPacketHandle) {
        return invalidArgStatus;
    }
    *outPacketHandle = 0;
    const i32 buildStatus = build();
    if (buildStatus != okStatus) {
        return buildStatus;
    }
    const auto* runtime = lookupRuntime(runtimeHandle);
    if (!runtime || !runtime->mapPayload.loaded) {
        return stateStatus;
    }
    const i32 packetHandle = allocatePacketHandle(runtimeHandle, runtime->payloadGeneration);
    if (packetHandle <= 0) {
        return capacityStatus;
    }
    *outPacketHandle = packetHandle;
    return okStatus;
}

} // namespace rs::tooling

