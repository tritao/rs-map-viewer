import { TextureLoader } from "../../rs/texture/TextureLoader";
import { ModelHashBuffer, getModelHash } from "./ModelHashBuffer";
import {
    type DrawCommand,
    type ModelFace,
    type ModelMergeGroup,
    type SceneGeometryBuffer,
    type SceneModel,
    decideSceneModelMergeStrategy,
    getModelFaces,
    splitModelFacesByTransparency,
} from "./SceneGeometryBuffer";

export type SceneDrawPlanOp =
    | Readonly<{
          kind: "instanced";
          modelHash: number;
          model: SceneModel["model"];
          transparent: boolean;
          faces: readonly ModelFace[];
          instances: readonly SceneModel[];
          lodInstances: readonly SceneModel[];
      }>
    | Readonly<{
          kind: "mergedGroup";
          group: ModelMergeGroup;
      }>;

export type SceneDrawPlan = Readonly<{
    ops: readonly SceneDrawPlanOp[];
}>;

export type SceneDrawPlanOptions = Readonly<{
    keepPerInstanceMetadata?: boolean;
}>;

export type SceneDrawPlanDigest = Readonly<{
    opCount: number;
    mergedGroupOpCount: number;
    instancedOpCount: number;
    instancedFacesTotal: number;
    instancedInstancesTotal: number;
    instancedLodInstancesTotal: number;
    seqHash: number;
    multisetHashSum: number;
    multisetHashXor: number;
}>;

function fnv1a32UpdateInt(hash: number, value: number): number {
    const h = ((hash >>> 0) ^ (value >>> 0)) >>> 0;
    // Math.imul keeps 32-bit behavior.
    return Math.imul(h, 16777619) >>> 0;
}

function hashPlanOp(op: SceneDrawPlanOp): number {
    let h = 2166136261 >>> 0;
    if (op.kind === "mergedGroup") {
        h = fnv1a32UpdateInt(h, 1);
        h = fnv1a32UpdateInt(h, op.group.transparent ? 1 : 0);
        h = fnv1a32UpdateInt(h, op.group.lowDetail ? 1 : 0);
        h = fnv1a32UpdateInt(h, op.group.level | 0);
        h = fnv1a32UpdateInt(h, op.group.priority | 0);
        h = fnv1a32UpdateInt(h, op.group.models.length | 0);
        return h >>> 0;
    }

    h = fnv1a32UpdateInt(h, 2);
    h = fnv1a32UpdateInt(h, op.modelHash | 0);
    h = fnv1a32UpdateInt(h, op.transparent ? 1 : 0);
    h = fnv1a32UpdateInt(h, op.faces.length | 0);
    h = fnv1a32UpdateInt(h, op.instances.length | 0);
    h = fnv1a32UpdateInt(h, op.lodInstances.length | 0);
    return h >>> 0;
}

export function summarizeSceneDrawPlan(plan: SceneDrawPlan): SceneDrawPlanDigest {
    let mergedGroupOpCount = 0;
    let instancedOpCount = 0;
    let instancedFacesTotal = 0;
    let instancedInstancesTotal = 0;
    let instancedLodInstancesTotal = 0;

    let seqHash = 2166136261 >>> 0;
    let multisetHashSum = 0 >>> 0;
    let multisetHashXor = 0 >>> 0;
    for (let i = 0; i < plan.ops.length; i++) {
        const op = plan.ops[i];
        const opHash = hashPlanOp(op);
        seqHash = fnv1a32UpdateInt(seqHash, opHash);
        multisetHashSum = (multisetHashSum + opHash) >>> 0;
        multisetHashXor = (multisetHashXor ^ opHash) >>> 0;
        if (op.kind === "mergedGroup") {
            mergedGroupOpCount++;
        } else {
            instancedOpCount++;
            instancedFacesTotal += op.faces.length | 0;
            instancedInstancesTotal += op.instances.length | 0;
            instancedLodInstancesTotal += op.lodInstances.length | 0;
        }
    }

    return {
        opCount: plan.ops.length | 0,
        mergedGroupOpCount: mergedGroupOpCount | 0,
        instancedOpCount: instancedOpCount | 0,
        instancedFacesTotal: instancedFacesTotal | 0,
        instancedInstancesTotal: instancedInstancesTotal | 0,
        instancedLodInstancesTotal: instancedLodInstancesTotal | 0,
        seqHash: seqHash >>> 0,
        multisetHashSum: multisetHashSum >>> 0,
        multisetHashXor: multisetHashXor >>> 0,
    };
}

function createModelGroups(
    outOps: SceneDrawPlanOp[],
    mergedGroupsInOrder: ModelMergeGroup[],
    modelGroupMap: Map<number, ModelMergeGroup>,
    sceneModels: SceneModel[],
    transparent: boolean,
): void {
    for (const sceneModel of sceneModels) {
        const key =
            Number(transparent) |
            ((sceneModel.lowDetail ? 1 : 0) << 1) |
            (sceneModel.level << 2) |
            (sceneModel.priority << 4);

        const group = modelGroupMap.get(key);
        if (group) {
            group.models.push(sceneModel);
        } else {
            const newGroup: ModelMergeGroup = {
                transparent,
                lowDetail: sceneModel.lowDetail,
                level: sceneModel.level,
                priority: sceneModel.priority,
                models: [sceneModel],
            };
            modelGroupMap.set(key, newGroup);
            mergedGroupsInOrder.push(newGroup);
        }
    }
}

export function buildSceneDrawPlanFromSceneModels(
    modelHashBuf: ModelHashBuffer,
    textureLoader: TextureLoader,
    sceneModels: readonly SceneModel[],
    minimizeDrawCalls: boolean,
    options?: SceneDrawPlanOptions,
): SceneDrawPlan {
    const keepPerInstanceMetadata = options?.keepPerInstanceMetadata === true;
    const groupedModels = new Map<number, { firstSeen: number; models: SceneModel[] }>();
    for (let i = 0; i < sceneModels.length; i++) {
        const sceneModel = sceneModels[i];
        const hash = getModelHash(modelHashBuf, sceneModel.model);
        const entry = groupedModels.get(hash);
        if (entry) {
            entry.models.push(sceneModel);
        } else {
            groupedModels.set(hash, { firstSeen: i, models: [sceneModel] });
        }
    }
    const grouped = Array.from(groupedModels.entries());
    grouped.sort((a, b) => (a[1].firstSeen | 0) - (b[1].firstSeen | 0));

    const ops: SceneDrawPlanOp[] = [];
    // Important: TS merges "force-merge" and "merge-by-placement" geometry across different
    // model hashes when they share the same bucket key (transparent/lowDetail/level/priority).
    const modelGroupMap: Map<number, ModelMergeGroup> = new Map();
    const mergedGroupsInOrder: ModelMergeGroup[] = [];
    for (const [modelHash, entry] of grouped) {
        const models = entry.models;
        const model = models[0].model;
        const { opaqueFaces, transparentFaces } = splitModelFacesByTransparency(
            textureLoader,
            model,
        );

        const mergeModels: SceneModel[] = [];
        const instancedModels: SceneModel[] = [];
        const lodModels: SceneModel[] = [];
        for (const sceneModel of models) {
            if (sceneModel.forceMerge) {
                mergeModels.push(sceneModel);
            } else {
                instancedModels.push(sceneModel);
                if (!sceneModel.lowDetail) {
                    lodModels.push(sceneModel);
                }
            }
        }

        if (keepPerInstanceMetadata) {
            const allInstances = mergeModels.concat(instancedModels);
            const allLodInstances = allInstances.filter((sceneModel) => !sceneModel.lowDetail);
            if (opaqueFaces.length > 0 && (allInstances.length | 0) > 0) {
                ops.push({
                    kind: "instanced",
                    modelHash,
                    model,
                    transparent: false,
                    faces: opaqueFaces,
                    instances: allInstances,
                    lodInstances: allLodInstances,
                });
            }
            if (transparentFaces.length > 0 && (allInstances.length | 0) > 0) {
                ops.push({
                    kind: "instanced",
                    modelHash,
                    model,
                    transparent: true,
                    faces: transparentFaces,
                    instances: allInstances,
                    lodInstances: allLodInstances,
                });
            }
            continue;
        }

        // Keep insertion order stable by emitting merged groups the first time we see each key.
        createModelGroups(ops, mergedGroupsInOrder, modelGroupMap, mergeModels, false);
        if (transparentFaces.length > 0) {
            createModelGroups(ops, mergedGroupsInOrder, modelGroupMap, mergeModels, true);
        }

        const instanceCount = instancedModels.length;
        const mergeDecision = decideSceneModelMergeStrategy(
            instanceCount,
            opaqueFaces.length,
            transparentFaces.length,
            minimizeDrawCalls,
        );

        if (mergeDecision.mergeOpaque) {
            createModelGroups(ops, mergedGroupsInOrder, modelGroupMap, instancedModels, false);
        } else if (opaqueFaces.length > 0) {
            ops.push({
                kind: "instanced",
                modelHash,
                model,
                transparent: false,
                faces: opaqueFaces,
                instances: models,
                lodInstances: lodModels,
            });
        }

        if (mergeDecision.mergeTransparent && transparentFaces.length > 0) {
            createModelGroups(ops, mergedGroupsInOrder, modelGroupMap, instancedModels, true);
        } else if (transparentFaces.length > 0) {
            ops.push({
                kind: "instanced",
                modelHash,
                model,
                transparent: true,
                faces: transparentFaces,
                instances: models,
                lodInstances: lodModels,
            });
        }
    }

    // TS order: all instanced commands first, then merged groups (map insertion order).
    for (let i = 0; i < mergedGroupsInOrder.length; i++) {
        ops.push({
            kind: "mergedGroup",
            group: mergedGroupsInOrder[i],
        });
    }

    return { ops };
}

export function executeSceneDrawPlan(plan: SceneDrawPlan, sceneBuf: SceneGeometryBuffer): void {
    for (const op of plan.ops) {
        if (op.kind === "mergedGroup") {
            sceneBuf.addModelGroup(op.group);
            continue;
        }

        const { offset: indexOffset, elements: elementCount } = sceneBuf.writeModelGeometry(
            op.model,
            op.faces as readonly ModelFace[],
        );

        const drawCommand: DrawCommand = {
            offset: indexOffset,
            elements: elementCount,
            instances: op.instances as SceneModel[],
        };
        sceneBuf.emitMergedCommand(drawCommand, op.transparent, false);
        sceneBuf.emitInteractCommand(drawCommand, op.transparent, false);

        if (op.lodInstances.length > 0) {
            const drawCommandLod: DrawCommand = {
                offset: indexOffset,
                elements: elementCount,
                instances: op.lodInstances as SceneModel[],
            };
            if (op.transparent) {
                sceneBuf.emitCommandToBucket("lodAlpha", drawCommandLod);
                sceneBuf.emitCommandToBucket("interactLodAlpha", drawCommandLod);
            } else {
                sceneBuf.emitCommandToBucket("lod", drawCommandLod);
                sceneBuf.emitCommandToBucket("interactLod", drawCommandLod);
            }
        }
    }
}

export function emitSceneModelsToSceneGeometryBuffer(
    modelHashBuf: ModelHashBuffer,
    textureLoader: TextureLoader,
    sceneBuf: SceneGeometryBuffer,
    sceneModels: readonly SceneModel[],
    minimizeDrawCalls: boolean,
    options?: SceneDrawPlanOptions,
): SceneDrawPlan {
    const plan = buildSceneDrawPlanFromSceneModels(
        modelHashBuf,
        textureLoader,
        sceneModels,
        minimizeDrawCalls,
        options,
    );
    executeSceneDrawPlan(plan, sceneBuf);
    return plan;
}
