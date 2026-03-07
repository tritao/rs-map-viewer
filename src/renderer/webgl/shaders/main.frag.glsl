#version 300 es

precision highp float;

layout(std140, column_major) uniform;

#include "./includes/scene-uniforms.glsl";

uniform highp sampler2DArray u_textures;

in vec4 v_color;
in vec2 v_texCoord;
flat in uint v_texId0;
flat in uint v_texId1;
flat in uint v_texSlot0;
flat in uint v_texSlot1;
in float v_texBlend;
flat in float v_alphaCutOff;
in float v_fogAmount;
flat in vec4 v_interactId;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 interactId;

void main() {
    if (u_debugTextureMode > 4.5) {
        fragColor = vec4(v_color.rgb, 1.0);
        interactId = v_interactId;
        return;
    }
    if (u_debugTextureMode > 2.5) {
        fragColor = vec4(1.0, 0.85, 0.2, 1.0);
        interactId = v_interactId;
        return;
    }

    uint slot0 = v_texSlot0;
    uint slot1 = v_texSlot1;

    vec4 textureColor0 = texture(u_textures, vec3(v_texCoord, float(slot0))).bgra;
    vec4 textureColor1 = texture(u_textures, vec3(v_texCoord, float(slot1))).bgra;
    float blend = clamp(v_texBlend, 0.0, 1.0) * float(slot1 != 0u);
    vec4 textureColor = mix(textureColor0, textureColor1, blend);

    // Debug modes:
    // 0 = normal
    // 1 = highlight missing (slot0==0) as magenta
    // 2 = show raw textureColor (no lighting), missing as magenta
    if (u_debugTextureMode > 0.5) {
        if (slot0 == 0u && v_texId0 != 0u) {
            fragColor = vec4(1.0, 0.0, 1.0, 1.0);
            interactId = v_interactId;
            return;
        }
        if (u_debugTextureMode > 1.5) {
            fragColor = textureColor;
            interactId = v_interactId;
            return;
        }
    }

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
