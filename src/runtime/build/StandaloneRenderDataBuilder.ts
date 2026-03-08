import type { SdRenderableDrawRanges, SdRenderableModelInfoTextures } from "../../maprender/MapRenderPayload";
import { InteractType } from "../contracts/InteractType";
import { Model } from "../../rs/model/Model";
import type { TextureLoader } from "../../rs/texture/TextureLoader";
import {
    buildDrawRangesFromBuckets,
    buildModelInfoTexturesFromBuckets,
    collectRuntimeDrawCommandBuckets,
} from "./SceneDrawCommandBuilder";
import { ModelHashBuffer } from "./ModelHashBuffer";
import { ContourGroundType, SceneGeometryBuffer, type SceneModel } from "./SceneGeometryBuffer";
import { emitSceneModelsToSceneGeometryBuffer } from "./SceneDrawPlan";

const DEFAULT_SCENE_BUFFER_VERTEX_CAPACITY = 4096;

export type StandaloneRenderData = Readonly<{
    vertices: Uint8Array;
    indices: Int32Array;
    modelInfoTextures: SdRenderableModelInfoTextures;
    drawRanges: SdRenderableDrawRanges;
    usedTextureIds: Int32Array;
    fitRadius: number;
}>;

export type BuildStandaloneRenderDataInput = Readonly<{
    textureLoader: TextureLoader;
    model: Model;
    interactType: InteractType;
    interactId: number;
    minimizeDrawCalls?: boolean;
}>;

function createSceneModel(input: BuildStandaloneRenderDataInput): SceneModel {
    return {
        model: input.model,
        lowDetail: false,
        forceMerge: false,
        sceneHeight: 0,
        sceneX: 0,
        sceneZ: 0,
        heightOffset: 0,
        level: 0,
        contourGround: ContourGroundType.NONE,
        priority: 0,
        interactType: input.interactType,
        interactId: input.interactId | 0,
    };
}

export function buildStandaloneRenderData(
    input: BuildStandaloneRenderDataInput,
): StandaloneRenderData | undefined {
    input.model.calculateBoundsCylinder();

    const sceneBuf = new SceneGeometryBuffer(
        input.textureLoader,
        Math.max(DEFAULT_SCENE_BUFFER_VERTEX_CAPACITY, input.model.usedVertexCount | 0),
    );
    const modelHashBuf = new ModelHashBuffer(32);
    emitSceneModelsToSceneGeometryBuffer(
        modelHashBuf,
        input.textureLoader,
        sceneBuf,
        [createSceneModel(input)],
        input.minimizeDrawCalls ?? false,
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
        fitRadius: Math.max(128, input.model.radius | 0),
    };
}
