import type { App as PicoApp, DrawCall, Program, Texture, UniformBuffer, VertexArray } from "picogl";

export function packDrawRangeArgs(drawRangesPacked: Int32Array): Array<[number, number, number]> {
    const drawRangeCount = (drawRangesPacked.length / 3) | 0;
    const drawRangeArgs = new Array<[number, number, number]>(drawRangeCount);
    for (let i = 0; i < drawRangeCount; i++) {
        const off = i * 3;
        drawRangeArgs[i] = [
            drawRangesPacked[off + 0] | 0,
            drawRangesPacked[off + 1] | 0,
            drawRangesPacked[off + 2] | 0,
        ];
    }
    return drawRangeArgs;
}

export function createSceneDrawCall(
    app: PicoApp,
    input: {
        program: Program;
        vertexArray: VertexArray;
        sceneUniformBuffer: UniformBuffer;
        timeLoaded: number;
        mapPos: Float32Array | readonly [number, number];
        textureArray: Texture;
        textureMaterials: Texture;
        textureSlotLut: Texture;
        drawRangesPacked: Int32Array;
        modelInfoTexture?: Texture;
        heightMapTexture?: Texture;
    },
): DrawCall {
    const drawCall = app
        .createDrawCall(input.program, input.vertexArray)
        .uniformBlock("SceneUniforms", input.sceneUniformBuffer)
        .uniform("u_timeLoaded", input.timeLoaded)
        .uniform("u_mapPos", input.mapPos)
        .texture("u_textures", input.textureArray)
        .texture("u_textureMaterials", input.textureMaterials)
        .texture("u_textureSlotLut", input.textureSlotLut)
        .drawRanges(...packDrawRangeArgs(input.drawRangesPacked));

    if (input.modelInfoTexture) {
        drawCall.texture("u_modelInfoTexture", input.modelInfoTexture);
    }
    if (input.heightMapTexture) {
        drawCall.texture("u_heightMap", input.heightMapTexture);
    }
    return drawCall;
}
