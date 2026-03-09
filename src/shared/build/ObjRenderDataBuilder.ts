import type { ObjSpawn } from "../../data/obj/ObjSpawn";
import { InteractType } from "../../runtime/InteractType";
import { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import { Model } from "../../rs/model/Model";
import { Scene, TileRenderFlag } from "../../rs/scene/Scene";
import { ObjModelLoader } from "../../rs/scene/model/ObjModelLoader";
import {
    MAP_RENDER_DRAW_BUCKET_KEYS,
    type MapRenderDrawBucketKey,
    type ObjRenderData,
} from "../../maprender/MapRenderPayload";
import type { MapObjStateModelInfoIndices } from "../StaticMapPacket";
import { buildDrawRangesFromBuckets, buildModelInfoTexturesFromBuckets, collectRuntimeDrawCommandBuckets } from "./SceneDrawCommandBuilder";
import { emitSceneModelsToSceneGeometryBuffer } from "./SceneDrawPlan";
import { ModelHashBuffer } from "./ModelHashBuffer";
import { ContourGroundType, SceneGeometryBuffer, type SceneModel } from "./SceneGeometryBuffer";

function createObjSceneModel(
    objTypeLoader: ObjTypeLoader,
    objModelLoader: ObjModelLoader,
    sceneModels: SceneModel[],
    objTypeIds: number[],
    scene: Scene,
    baseX: number,
    baseY: number,
    borderSize: number,
    spawn: ObjSpawn,
    interactId = objTypeIds.length | 0,
): void {
    const objResult = objTypeLoader.tryLoad(spawn.id);
    if (!objResult.ok) {
        return;
    }
    const objType = objResult.value;
    if (objType.name === "null") {
        return;
    }

    const tileX = (spawn.x - baseX) | 0;
    const tileY = (spawn.y - baseY) | 0;
    const model = objModelLoader.getModel(spawn.id, spawn.count);
    if (!model) {
        return;
    }

    let renderLevel = spawn.plane;
    if (renderLevel < 3 && (scene.tileRenderFlags[1][tileX][tileY] & TileRenderFlag.Bridge) !== 0) {
        renderLevel = spawn.plane + 1;
    }

    const sceneHeight = scene.getCenterHeight(renderLevel, tileX, tileY);
    let heightOffset = 0;
    const tile = scene.tiles[renderLevel][tileX][tileY];
    if (!tile || !tile.tileModel || tile.tileModel.faces.length === 0) {
        return;
    }
    for (const loc of tile.locs) {
        if ((loc.flags & 256) === 256 && loc.entity instanceof Model) {
            const locModel = loc.entity;
            locModel.calculateBoundsCylinder();
            if (locModel.contourHeight > heightOffset) {
                heightOffset = locModel.contourHeight;
            }
        }
    }

    let contourGround = ContourGroundType.CENTER_TILE;
    if (heightOffset !== 0) {
        heightOffset -= sceneHeight;
        contourGround = ContourGroundType.NONE;
    }

    sceneModels.push({
        model,
        lowDetail: false,
        forceMerge: false,
        sceneHeight,
        sceneX: (tileX - borderSize) * 128 + 64,
        sceneZ: (tileY - borderSize) * 128 + 64,
        heightOffset,
        level: renderLevel,
        contourGround,
        priority: 10,
        interactType: InteractType.OBJ,
        interactId: interactId | 0,
    });
    if ((interactId | 0) >= 0x20000) {
        throw new Error(
            `[map-render][obj] object interaction index overflow: interactId=${interactId | 0}`,
        );
    }
    const nextLength = ((interactId | 0) + 1) | 0;
    if ((objTypeIds.length | 0) < (nextLength | 0)) {
        objTypeIds.length = nextLength | 0;
    }
    objTypeIds[interactId | 0] = spawn.id | 0;
}

export type BuildObjRenderDataInput = Readonly<{
    loadObjs: boolean;
    objTypeLoader: ObjTypeLoader;
    objModelLoader: ObjModelLoader;
    scene: Scene;
    textureLoader: ConstructorParameters<typeof SceneGeometryBuffer>[0];
    baseX: number;
    baseY: number;
    borderSize: number;
    objSpawns: ReadonlyArray<ObjSpawn>;
    interactIds?: ArrayLike<number>;
    minimizeDrawCalls: boolean;
}>;

function createObjModelInfoIndices(objCount: number): MapObjStateModelInfoIndices {
    const buckets = {} as Record<MapRenderDrawBucketKey, Int32Array>;
    for (let bucketIndex = 0; bucketIndex < MAP_RENDER_DRAW_BUCKET_KEYS.length; bucketIndex++) {
        buckets[MAP_RENDER_DRAW_BUCKET_KEYS[bucketIndex]!] = new Int32Array(objCount).fill(-1);
    }
    return buckets;
}

function buildObjModelInfoIndices(
    runtimeDrawCommandBuckets: ReturnType<typeof collectRuntimeDrawCommandBuckets>,
    objCount: number,
): MapObjStateModelInfoIndices {
    const modelInfoIndices = createObjModelInfoIndices(objCount | 0);
    for (let bucketIndex = 0; bucketIndex < MAP_RENDER_DRAW_BUCKET_KEYS.length; bucketIndex++) {
        const key = MAP_RENDER_DRAW_BUCKET_KEYS[bucketIndex]!;
        const commands = runtimeDrawCommandBuckets[key];
        const indices = modelInfoIndices[key];
        let modelInfoIndex = commands.length | 0;
        for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
            const command = commands[commandIndex]!;
            for (let instanceIndex = 0; instanceIndex < command.instances.length; instanceIndex++) {
                const instance = command.instances[instanceIndex]!;
                if ((instance.interactType | 0) !== (InteractType.OBJ | 0)) {
                    modelInfoIndex = (modelInfoIndex + 1) | 0;
                    continue;
                }
                const interactId = instance.interactId | 0;
                if (interactId >= 0 && interactId < (indices.length | 0)) {
                    indices[interactId] = modelInfoIndex | 0;
                }
                modelInfoIndex = (modelInfoIndex + 1) | 0;
            }
        }
    }
    return modelInfoIndices;
}

export function buildObjRenderData(input: BuildObjRenderDataInput): ObjRenderData | undefined {
    if (!input.loadObjs || input.objSpawns.length <= 0) {
        return undefined;
    }
    const sceneModels: SceneModel[] = [];
    const objTypeIds: number[] = [];
    for (let spawnIndex = 0; spawnIndex < input.objSpawns.length; spawnIndex++) {
        const spawn = input.objSpawns[spawnIndex]!;
        createObjSceneModel(
            input.objTypeLoader,
            input.objModelLoader,
            sceneModels,
            objTypeIds,
            input.scene,
            input.baseX,
            input.baseY,
            input.borderSize,
            spawn,
            input.interactIds?.[spawnIndex | 0],
        );
    }
    if (sceneModels.length <= 0) {
        return undefined;
    }
    const objTypeIdsPacked = new Int32Array(objTypeIds.length | 0);
    objTypeIdsPacked.fill(-1);
    for (let index = 0; index < objTypeIds.length; index++) {
        const objTypeId = objTypeIds[index];
        if (objTypeId !== undefined) {
            objTypeIdsPacked[index] = objTypeId | 0;
        }
    }

    const sceneBuf = new SceneGeometryBuffer(input.textureLoader, 20000);
    const modelHashBuf = new ModelHashBuffer(1024);
    emitSceneModelsToSceneGeometryBuffer(
        modelHashBuf,
        input.textureLoader,
        sceneBuf,
        sceneModels,
        input.minimizeDrawCalls,
        {
            preserveInstances: true,
        },
    );
    if (sceneBuf.vertexCount() <= 0 || sceneBuf.indices.length <= 0) {
        return undefined;
    }
    const runtimeDrawCommandBuckets = collectRuntimeDrawCommandBuckets(sceneBuf);
    const modelInfoIndices = buildObjModelInfoIndices(
        runtimeDrawCommandBuckets,
        objTypeIdsPacked.length | 0,
    );
    return {
        vertices: sceneBuf.vertexBuf.byteArray(),
        indices: new Int32Array(sceneBuf.indices),
        modelInfoTextures: buildModelInfoTexturesFromBuckets(runtimeDrawCommandBuckets),
        modelInfoIndices,
        drawRanges: buildDrawRangesFromBuckets(runtimeDrawCommandBuckets),
        usedTextureIds: Int32Array.from(sceneBuf.usedTextureIds),
        objTypeIds: objTypeIdsPacked,
    };
}
