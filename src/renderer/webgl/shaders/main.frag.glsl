#version 300 es

precision highp float;

layout(std140, column_major) uniform;

#include "./includes/scene-uniforms.glsl";

uniform highp sampler2DArray u_textures;

in vec4 v_color;
in vec2 v_texCoord;
flat in uint v_texId0;
flat in uint v_texId1;
in float v_texBlend;
flat in float v_alphaCutOff;
in float v_fogAmount;
flat in vec4 v_interactId;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 interactId;

void main() {
    vec4 textureColor0 = texture(u_textures, vec3(v_texCoord, v_texId0)).bgra;
    vec4 textureColor1 = texture(u_textures, vec3(v_texCoord, v_texId1)).bgra;
    float blend = clamp(v_texBlend, 0.0, 1.0) * float(v_texId1 != 0u);
    vec4 textureColor = mix(textureColor0, textureColor1, blend);
    fragColor = pow(textureColor, vec4(vec3(u_brightness), 1.0)) *
        vec4(round(v_color.rgb * u_colorBanding) / u_colorBanding, v_color.a);
#ifdef DISCARD_ALPHA
    if ((v_texId0 == 0u && fragColor.a < 0.01) || (textureColor.a < v_alphaCutOff)) {
        discard;
    }
#endif
    fragColor = mix(fragColor, u_skyColor, v_fogAmount);
    interactId = v_interactId;
}
