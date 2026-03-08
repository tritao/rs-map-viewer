struct ModelInfo {
    vec2 tilePos;
    uint height;
    uint plane;
    uint priority;
#ifdef MODEL_INFO_HAS_CONTOUR
    float contourGround;
#endif
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
#ifdef MODEL_INFO_HAS_CONTOUR
    info.contourGround = float((data.g >> 14) & 0x3u);
#endif
    info.interactType = (data.b >> 4) & 0x3u;
    info.interactId = data.a | (((data.b >> 3u) & 0x1u) << 16u);
    return info;
}
