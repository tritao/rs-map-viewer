struct Vertex {
    vec3 pos;
    vec4 color;
    vec2 texCoord;
    uint textureId;
    uint textureId1;
    float texBlend;
    uint priority;
};

Vertex decodeVertex(uint v0, uint v1, uint v2, uint v3, float brightness) {
    float x = float(int((v0 >> 17u) & 0x7FFFu) - 0x4000);
    float u = unpackFloat11(((v0 >> 11u) & 0x3Fu) | ((v2 & 0x1Fu) << 6u));
    float v = unpackFloat11(v0 & 0x7FFu);

    float y = -float(int((v1) & 0x7FFFu) - 0x4000);
    int hsl = int((v1 >> 15u) & 0xFFFFu);
    float isTextured = float((v1 >> 31) & 0x1u);
    // Texture ids are stored as 16-bit `textureIdPlus1` values (0 reserved):
    // - tex0 low 9 bits in hsl[7..15]
    // - tex0 high 7 bits in v3[19..25]
    // - tex1 low 10 bits in v3[0..9]
    // - tex1 high 6 bits in v3[26..31]
    uint tex0Low9 = uint((hsl >> 7) & 0x1FF);
    uint tex0High7 = (v3 >> 19u) & 0x7Fu;
    float textureId = float((tex0Low9 | (tex0High7 << 9u))) * isTextured;

    float isTextured1 = float((v3 >> 10u) & 0x1u);
    uint tex1Low10 = v3 & 0x3FFu;
    uint tex1High6 = (v3 >> 26u) & 0x3Fu;
    float textureId1 = float((tex1Low10 | (tex1High6 << 10u))) * isTextured1;
    float texBlend = float((v3 >> 11u) & 0xFFu) / 255.0;

    float z = float(int((v2 >> 17u) & 0x7FFFu) - 0x4000);
    float alpha = float((v2 >> 9u) & 0xFFu) / 255.0;
    uint priority = ((v2 >> 6u) & 0x7u);

    vec4 color = when_eq(textureId, 0.0) * vec4(hslToRgb(hsl, brightness), alpha)
        + when_neq(textureId, 0.0) * vec4(vec3(float(hsl & 0x7F) / 127.0), alpha);

    return Vertex(vec3(x, y, z), color, vec2(u, v), uint(textureId), uint(textureId1), texBlend, priority);
}
