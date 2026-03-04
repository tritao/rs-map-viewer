export { ModelHashBuffer } from "./ModelHashBuffer";
export { ContourGroundType, SceneBuffer } from "./SceneBuffer";
export type { SceneModel } from "./SceneBuffer";
export {
    buildDrawRangesFromBuckets,
    buildModelInfoTexturesFromBuckets,
    buildRuntimeCommandStreamInputFromBuckets,
    collectRuntimeDrawCommandBuckets,
} from "./SceneCommandBuilder";
export type { MapRenderCommandStreamRuntimeInput } from "./SceneCommandBuilder";
export { emitSceneModelsToSceneBuffer, summarizeSceneCommandPlan } from "./SceneCommandPlan";
export { buildNpcGeometry } from "./NpcGeometryBuilder";
export type { BuildNpcGeometryInput, BuiltNpcGeometry } from "./NpcGeometryBuilder";
export type { SceneCommandPlan, SceneCommandPlanDigest } from "./SceneCommandPlan";
export { createLocAnimatedGroupKey, resolveLocRenderPlacement } from "./LocRenderPlacementResolver";
export type { SceneLocEntity } from "./SceneLocEntity";
export { getSceneLocs } from "./SceneLocs";

// Runtime entities consumed by the TS scene-build backend.
export type { LocAnimatedData } from "../entities/LocAnimatedData";
export type { LocAnimatedGroup } from "../entities/LocAnimatedGroup";
export { createNpcDatas, createNpcDatasFromSpawns } from "../entities/NpcData";
export type { NpcSpawnGroup } from "../entities/NpcSpawnGroup";
