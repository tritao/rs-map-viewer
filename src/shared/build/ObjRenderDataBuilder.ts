import type { ObjSpawn } from "../../data/obj/ObjSpawn";
import { InteractType } from "../../runtime/InteractType";
import { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import { Model } from "../../rs/model/Model";
import { Scene, TileRenderFlag } from "../../rs/scene/Scene";
import { ObjModelLoader } from "../../rs/scene/model/ObjModelLoader";
import type { ObjRenderData } from "../../maprender/MapRenderPayload";
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
        interactId: objTypeIds.length | 0,
    });
    if ((objTypeIds.length | 0) >= 0x20000) {
        throw new Error(
            `[map-render][obj] object interaction index overflow: count=${objTypeIds.length | 0}`,
        );
    }
    objTypeIds.push(spawn.id | 0);
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
    minimizeDrawCalls: boolean;
}>;

export function buildObjRenderData(input: BuildObjRenderDataInput): ObjRenderData | undefined {
    if (!input.loadObjs || input.objSpawns.length <= 0) {
        return undefined;
    }
    const sceneModels: SceneModel[] = [];
    const objTypeIds: number[] = [];
    for (const spawn of input.objSpawns) {
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
        );
    }
    if (sceneModels.length <= 0) {
        return undefined;
    }

    const sceneBuf = new SceneGeometryBuffer(input.textureLoader, 20000);
    const modelHashBuf = new ModelHashBuffer(1024);
    emitSceneModelsToSceneGeometryBuffer(
        modelHashBuf,
        input.textureLoader,
        sceneBuf,
        sceneModels,
        input.minimizeDrawCalls,
    );
    if (sceneBuf.vertexCount() <= 0 || sceneBuf.indices.length <= 0) {
        return undefined;
    }
    const runtimeDrawCommandBuckets = collectRuntimeDrawCommandBuckets(sceneBuf);
    return {
        vertices: sceneBuf.vertexBuf.byteArray(),
        indices: new Int32Array(sceneBuf.indices),
        modelInfoTextures: buildModelInfoTexturesFromBuckets(runtimeDrawCommandBuckets),
        drawRanges: buildDrawRangesFromBuckets(runtimeDrawCommandBuckets),
        usedTextureIds: Int32Array.from(sceneBuf.usedTextureIds),
        objTypeIds: Int32Array.from(objTypeIds),
    };
}
