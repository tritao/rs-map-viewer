struct Material {
    int animU;
    int animV;
    float alphaCutOff;
};

ivec2 getTextureIdLutCoord(uint textureId) {
    return ivec2(int(textureId & 255u), int((textureId >> 8u) & 255u));
}

Material getMaterial(uint textureId) {
    ivec4 data = texelFetch(u_textureMaterials, getTextureIdLutCoord(textureId), 0);

    Material material;
    material.animU = data.r;
    material.animV = data.g;
    material.alphaCutOff = float(data.b & 0xFF) / 255.0;

    return material;
}
