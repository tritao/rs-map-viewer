uint lookupTextureSlot(uint textureId) {
    ivec2 coord = ivec2(int(textureId & 255u), int((textureId >> 8u) & 255u));
    return texelFetch(u_textureSlotLut, coord, 0).r;
}

void applyVertexMaterialOutputs(Vertex vertex) {
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
}

float computeLoadAlpha() {
    return smoothstep(0.0, 1.0, min((u_currentTime - u_timeLoaded), 1.0));
}

void applySceneFogAndInteract(vec3 localPos, float interactId, float interactType) {
    float loadAlpha = computeLoadAlpha();
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

    float visibleInteractType = interactType * when_neq(v_fogAmount, 1.0);
    v_interactId = vec4(
        interactId,
        float(uint(u_mapPos.x) << 8u | uint(u_mapPos.y)),
        visibleInteractType,
        1.0
    );
}
