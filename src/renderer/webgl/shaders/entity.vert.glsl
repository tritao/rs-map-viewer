#version 300 es

#include "./includes/multi-draw.glsl";

#define TEXTURE_ANIM_UNIT (1.0f / 128.0f)
#define FOG_CORNER_ROUNDING 8.0

precision highp float;

layout(std140, column_major) uniform;

uniform highp isampler2D u_textureMaterials;
uniform highp usampler2D u_textureSlotLut;

#include "./includes/scene-uniforms.glsl";

uniform int u_drawIdOffset;
uniform vec2 u_mapPos;
uniform float u_timeLoaded;
uniform highp usampler2D u_modelInfoTexture;

layout(location = 0) in uvec4 a_vertex;

out vec4 v_color;
out vec2 v_texCoord;
flat out uint v_texId0;
flat out uint v_texId1;
flat out uint v_texSlot0;
flat out uint v_texSlot1;
out float v_texBlend;
flat out float v_alphaCutOff;
out float v_fogAmount;
flat out vec4 v_interactId;

#include "./includes/branchless-logic.glsl";
#include "./includes/hsl-to-rgb.glsl";
#include "./includes/unpack-float.glsl";
#include "./includes/fog.glsl";
#include "./includes/material.glsl";
#include "./includes/vertex.glsl";

struct ModelInfo {
    vec2 tilePos;
    uint height;
    uint plane;
    uint priority;
    uint interactType;
    uint interactId;
};

ivec2 getDataTexCoordFromIndex(int index) {
    return ivec2(index % 16, index / 16);
}

ModelInfo decodeModelInfo(int offset) {
    uvec4 data = texelFetch(u_modelInfoTexture, getDataTexCoordFromIndex(offset + gl_InstanceID), 0);

    ModelInfo info;
    info.tilePos = vec2(float(data.r & 0x3FFFu), float(data.g & 0x3FFFu));
    info.height = (data.b >> 6) * 8u;
    info.plane = data.r >> 14;
    info.priority = data.b & 0x7u;
    info.interactType = (data.b >> 4) & 0x3u;
    info.interactId = data.a | (((data.b >> 3u) & 0x1u) << 16u);
    return info;
}

uint lookupTextureSlot(uint textureId) {
    ivec2 coord = ivec2(int(textureId & 255u), int((textureId >> 8u) & 255u));
    return texelFetch(u_textureSlotLut, coord, 0).r;
}

void main() {
    Vertex vertex = decodeVertex(a_vertex.x, a_vertex.y, a_vertex.z, a_vertex.w, u_brightness);
    float bypassModelInfo = when_gt(u_debugTextureMode, 3.5);
    int offset = int((1.0 - bypassModelInfo) * float(texelFetch(u_modelInfoTexture, getDataTexCoordFromIndex(DRAW_ID + u_drawIdOffset), 0).r));

    v_color = vertex.color;

    Material material0 = getMaterial(vertex.textureId);
    vec2 textureAnimation = vec2(material0.animU, material0.animV);

    if (u_isNewTextureAnim > 0.5) {
        v_texCoord = vertex.texCoord + mod(mod(u_currentTime, 128.0) * textureAnimation / 64.0, 1.0);
    } else {
        v_texCoord = vertex.texCoord + (u_currentTime / 0.02) * textureAnimation * TEXTURE_ANIM_UNIT;
    }
    v_texId0 = vertex.textureId;
    v_texId1 = vertex.textureId1;
    v_texSlot0 = lookupTextureSlot(vertex.textureId);
    v_texSlot1 = lookupTextureSlot(vertex.textureId1);
    v_texBlend = vertex.texBlend;

    Material material1 = getMaterial(vertex.textureId1);
    v_alphaCutOff = max(material0.alphaCutOff, material1.alphaCutOff);

    ModelInfo modelInfo;
    if (bypassModelInfo > 0.5) {
        modelInfo.tilePos = vec2(0.0);
        modelInfo.height = 0u;
        modelInfo.plane = 0u;
        modelInfo.priority = 0u;
        modelInfo.interactType = 0u;
        modelInfo.interactId = 0u;
    } else {
        modelInfo = decodeModelInfo(offset);
    }

    vec3 localPos = vertex.pos + vec3(modelInfo.tilePos.x, -float(modelInfo.height), modelInfo.tilePos.y);
    localPos /= 128.0;
    localPos += vec3(u_mapPos.x, 0, u_mapPos.y) * vec3(64);

    float loadAlpha = smoothstep(0.0, 1.0, min((u_currentTime - u_timeLoaded), 1.0));
    float isLoading = when_neq(loadAlpha, 1.0);

    float dist = -sdRoundedBox(
        vec2(localPos.x - u_cameraPos.x, localPos.z - u_cameraPos.y),
        vec2(u_renderDistance),
        FOG_CORNER_ROUNDING
    );

    float fogDepth = min(u_fogDepth, u_renderDistance);
    v_fogAmount = fogFactorLinear(dist, 0.0, fogDepth);
    v_fogAmount = isLoading * max(1.0 - loadAlpha, v_fogAmount) +
        (1.0 - isLoading) * v_fogAmount;

    float interactType = when_neq(v_fogAmount, 1.0) * float(modelInfo.interactType);

    v_interactId = vec4(
        float(modelInfo.interactId),
        float(uint(u_mapPos.x) << 8u | uint(u_mapPos.y)),
        interactType,
        1.0
    );

    gl_Position = u_viewMatrix * vec4(localPos, 1.0);
    gl_Position.z += float(modelInfo.plane) * 0.005 + float(modelInfo.priority) * 0.0007;
    gl_Position = u_projectionMatrix * gl_Position;
}
