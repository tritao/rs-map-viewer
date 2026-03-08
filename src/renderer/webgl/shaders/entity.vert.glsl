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
#include "./includes/model-info.glsl"
#include "./includes/scene-vertex-common.glsl"

void main() {
    Vertex vertex = decodeVertex(a_vertex.x, a_vertex.y, a_vertex.z, a_vertex.w, u_brightness);
    int offset = int(texelFetch(u_modelInfoTexture, getDataTexCoordFromIndex(DRAW_ID + u_drawIdOffset), 0).r);

    applyVertexMaterialOutputs(vertex);

    ModelInfo modelInfo = decodeModelInfo(offset);

    vec3 localPos = vertex.pos + vec3(modelInfo.tilePos.x, -float(modelInfo.height), modelInfo.tilePos.y);
    localPos /= 128.0;
    localPos += vec3(u_mapPos.x, 0, u_mapPos.y) * vec3(64);
    applySceneFogAndInteract(localPos, float(modelInfo.interactId), float(modelInfo.interactType));

    gl_Position = u_viewMatrix * vec4(localPos, 1.0);
    gl_Position.z += float(modelInfo.plane) * 0.005 + float(modelInfo.priority) * 0.0007;
    gl_Position = u_projectionMatrix * gl_Position;
}
