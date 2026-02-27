#pragma once

#include "../rs/types.hpp"

namespace rs::tooling {

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
