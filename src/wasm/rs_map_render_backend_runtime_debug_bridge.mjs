import {
    mapRenderRuntimeBridge,
    runtimeDebugCollectMapInputDigestWithWasm,
    runtimeDebugGetCacheConfigWithWasm,
    runtimeDebugGetLastMapInputHashesWithWasm,
    runtimeDebugGetCachedCommandStreamDigestWithWasm,
    runtimeDebugGetCachedCommandStreamArraysWithWasm,
    runtimeDebugGetLastBuildStatsWithWasm,
    runtimeDebugDecodeOverlayTypeWithWasm,
    runtimeDebugDecodeLocTypeWithWasm,
    runtimeDebugGetLastTerrainTileFaceCountsWithWasm,
    runtimeDebugGetLastCollisionFlagsWithWasm,
    runtimeDebugGetLastTerrainDigestWithWasm,
    runtimeDebugSetTerrainDigestSampleStartVertexWithWasm,
    runtimeDebugSetTerrainProbeWithWasm,
    runtimeDebugGetLastTerrainProbeWithWasm,
    runtimeDebugSetWorldHeightProbeWithWasm,
    runtimeDebugGetLastWorldHeightProbeWithWasm,
    runtimeDebugDecodeCachedTerrainCellWithWasm,
    runtimeDebugGetLastTerrainDigestSamplesPackedWithWasm,
    runtimeDebugGetLastSceneCommandPlanDigestWithWasm,
    runtimeDebugGetLastSceneCommandPlanOpsPackedWithWasm,
    runtimeDebugGetLastSceneCommandPlanOpProvenancePackedWithWasm,
    runtimeDebugGetLastSceneBucketsDigestWithWasm,
    runtimeDebugGetLastLocRenderPlacementDigestWithWasm,
    runtimeDebugGetLastLocRenderPlacementEntriesPackedWithWasm,
    runtimeDebugGetModelFacesDigestWithWasm,
    runtimeDebugGetModelVerticesDigestWithWasm,
    runtimeDebugGetModelVerticesSampleWithWasm,
    runtimeDebugGetModelVerticesSampleRangeWithWasm,
    runtimeDebugGetLocModelVerticesSampleWithWasm,
    runtimeDebugGetLastLocPreMergeGroupKeySignaturesWithWasm,
    runtimeDebugGetLastLocPreMergeGroupKeyEntriesPackedWithWasm,
    runtimeDebugGetLastLocMergeDecisionEntriesPackedWithWasm,
    runtimeDebugGetLastLocMergeNormalsTraceEntriesPackedWithWasm,
    runtimeDebugGetLastCommandProvenancePackedWithWasm,
    runtimeDebugBuildMapPlanFromCacheWithWasm,
    runtimeDebugGetLoadedHeightHashWithWasm,
    runtimeCollectRequiredExpandedTypeIdsWithWasm,
    runtimeCollectRequiredPrimaryTypeIdsWithWasm,
    tryLoadBackendModule,
    uploadRuntimeCacheInputsWithWasm,
} from "./rs_map_render_backend_bridge.mjs";

export const mapRenderRuntimeDebugBridge = {
    ...mapRenderRuntimeBridge,
    async debugCollectCachedMapInputDigest(runtimeHandle, sceneBuildInput) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        if (!uploadRuntimeCacheInputsWithWasm(backendModule, runtimeHandle, sceneBuildInput)) {
            return undefined;
        }
        return runtimeDebugCollectMapInputDigestWithWasm(
            backendModule,
            runtimeHandle,
            sceneBuildInput,
        );
    },
    async debugGetRuntimeCacheConfig(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetCacheConfigWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLoadedHeightHash(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLoadedHeightHashWithWasm(backendModule, runtimeHandle);
    },
    async debugDecodeCachedTerrainCell(runtimeHandle, mapX, mapY, level, localX, localY) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugDecodeCachedTerrainCellWithWasm(
            backendModule,
            runtimeHandle,
            mapX,
            mapY,
            level,
            localX,
            localY,
        );
    },
    async debugGetRuntimeMapInputHashes(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastMapInputHashesWithWasm(backendModule, runtimeHandle);
    },
    async debugCollectRequiredPrimaryTypeIds(runtimeHandle, sceneBuildInput) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        if (!uploadRuntimeCacheInputsWithWasm(backendModule, runtimeHandle, sceneBuildInput)) {
            return undefined;
        }
        return runtimeCollectRequiredPrimaryTypeIdsWithWasm(
            backendModule,
            runtimeHandle,
            sceneBuildInput,
        );
    },
    async debugCollectRequiredExpandedTypeIds(runtimeHandle, sceneBuildInput) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        if (!uploadRuntimeCacheInputsWithWasm(backendModule, runtimeHandle, sceneBuildInput)) {
            return undefined;
        }
        return runtimeCollectRequiredExpandedTypeIdsWithWasm(
            backendModule,
            runtimeHandle,
            sceneBuildInput,
        );
    },
    async debugGetRuntimeCachedCommandStreamDigest(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetCachedCommandStreamDigestWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeCachedCommandStreamArrays(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetCachedCommandStreamArraysWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastBuildStats(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastBuildStatsWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastTerrainTileFaceCounts(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastTerrainTileFaceCountsWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastCollisionFlags(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastCollisionFlagsWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastTerrainDigest(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastTerrainDigestWithWasm(backendModule, runtimeHandle);
    },
    async debugSetTerrainDigestSampleStartVertex(runtimeHandle, startVertex) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return false;
        }
        return runtimeDebugSetTerrainDigestSampleStartVertexWithWasm(
            backendModule,
            runtimeHandle,
            startVertex,
        );
    },
    async debugSetTerrainProbe(runtimeHandle, level, tileX, tileY) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return false;
        }
        return runtimeDebugSetTerrainProbeWithWasm(
            backendModule,
            runtimeHandle,
            level,
            tileX,
            tileY,
        );
    },
    async debugGetRuntimeLastTerrainProbe(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastTerrainProbeWithWasm(backendModule, runtimeHandle);
    },
    async debugSetWorldHeightProbe(runtimeHandle, level, worldX, worldZ) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return false;
        }
        return runtimeDebugSetWorldHeightProbeWithWasm(
            backendModule,
            runtimeHandle,
            level,
            worldX,
            worldZ,
        );
    },
    async debugGetRuntimeLastWorldHeightProbe(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastWorldHeightProbeWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastTerrainDigestSamplesPacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastTerrainDigestSamplesPackedWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastSceneCommandPlanDigest(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastSceneCommandPlanDigestWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastSceneCommandPlanOpsPacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastSceneCommandPlanOpsPackedWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastSceneCommandPlanOpProvenancePacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastSceneCommandPlanOpProvenancePackedWithWasm(
            backendModule,
            runtimeHandle,
        );
    },
    async debugGetRuntimeLastSceneBucketsDigest(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastSceneBucketsDigestWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastLocRenderPlacementDigest(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastLocRenderPlacementDigestWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastLocRenderPlacementEntriesPacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastLocRenderPlacementEntriesPackedWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeModelFacesDigest(runtimeHandle, modelId) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetModelFacesDigestWithWasm(backendModule, runtimeHandle, modelId);
    },
    async debugGetRuntimeModelVerticesDigest(runtimeHandle, modelId) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetModelVerticesDigestWithWasm(backendModule, runtimeHandle, modelId);
    },
    async debugGetRuntimeModelVerticesSample(runtimeHandle, modelId) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetModelVerticesSampleWithWasm(backendModule, runtimeHandle, modelId);
    },
    async debugGetRuntimeModelVerticesSampleRange(runtimeHandle, modelId, startVertex) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetModelVerticesSampleRangeWithWasm(
            backendModule,
            runtimeHandle,
            modelId,
            startVertex,
        );
    },
    async debugGetRuntimeLocModelVerticesSample(runtimeHandle, locTypeId, placementType, rotation, modelId) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLocModelVerticesSampleWithWasm(
            backendModule,
            runtimeHandle,
            locTypeId,
            placementType,
            rotation,
            modelId,
        );
    },
    async debugGetRuntimeLastLocPreMergeGroupKeySignatures(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastLocPreMergeGroupKeySignaturesWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastLocPreMergeGroupKeyEntriesPacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastLocPreMergeGroupKeyEntriesPackedWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastLocMergeDecisionEntriesPacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastLocMergeDecisionEntriesPackedWithWasm(backendModule, runtimeHandle);
    },
    async debugGetRuntimeLastLocMergeNormalsTraceEntriesPacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastLocMergeNormalsTraceEntriesPackedWithWasm(
            backendModule,
            runtimeHandle,
        );
    },
    async debugGetRuntimeLastCommandProvenancePacked(runtimeHandle) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugGetLastCommandProvenancePackedWithWasm(backendModule, runtimeHandle);
    },
    async debugBuildMapPlanFromCache(runtimeHandle, request) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return false;
        }
        return runtimeDebugBuildMapPlanFromCacheWithWasm(backendModule, runtimeHandle, request);
    },
    async debugDecodeRuntimeOverlayType(runtimeHandle, overlayId) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugDecodeOverlayTypeWithWasm(backendModule, runtimeHandle, overlayId);
    },
    async debugDecodeRuntimeLocType(runtimeHandle, locTypeId) {
        const backendModule = await tryLoadBackendModule();
        if (!backendModule) {
            return undefined;
        }
        return runtimeDebugDecodeLocTypeWithWasm(backendModule, runtimeHandle, locTypeId);
    },
};
