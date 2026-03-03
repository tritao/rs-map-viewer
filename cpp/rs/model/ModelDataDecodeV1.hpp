#pragma once

inline Status decodeModelDataV1(Span<const u8> data, ModelData* out) noexcept {
    if (!out) return Status::InvalidArgument;
    if (data.size() < 23) return Status::BadFormat;

    Uint8ArrayReader footer(data, data.size() - 23);
    u16 vertexCountU16 = 0;
    u16 faceCountU16 = 0;
    u8 texFaceCount = 0;
    u8 flags = 0;
    u8 modelPriority = 0;
    u8 hasFaceAlpha = 0;
    u8 hasFaceSkins = 0;
    u8 hasFaceTextures = 0;
    u8 hasVertexSkins = 0;
    u16 modelVerticesX = 0;
    u16 modelVerticesY = 0;
    u16 modelVerticesZ = 0;
    u16 faceIndicesLen = 0;
    u16 textureIndicesLen = 0;

    Status s = footer.readUnsignedShort(&vertexCountU16);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&faceCountU16);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&texFaceCount);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&flags);
    if (!ok(s)) return s;
    const bool hasFaceRenderTypes = (flags & 0x1) == 0x1;
    const bool hasVersion = (flags & 0x8) == 0x8;
    s = footer.readUnsignedByte(&modelPriority);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasFaceAlpha);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasFaceSkins);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasFaceTextures);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasVertexSkins);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&modelVerticesX);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&modelVerticesY);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&modelVerticesZ);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&faceIndicesLen);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&textureIndicesLen);
    if (!ok(s)) return s;

    i32 version = 1;
    if (hasVersion) {
        // TS parity: in decodeV1, `buf1.offset` starts at (len - 23) and after reading
        // vertexCount/faceCount/texFaceCount/flags it is at (len - 17); then it does `offset -= 7`,
        // so the version byte is at (len - 24).
        if (data.size() < 24) return Status::BadFormat;
        Uint8ArrayReader versionReader(data, data.size() - 24);
        u8 v = 0;
        s = versionReader.readUnsignedByte(&v);
        if (!ok(s)) return s;
        version = static_cast<i32>(v);
    }

    i32 simpleTextureFaceCount = 0;
    i32 complexTextureFaceCount = 0;
    i32 cubeTextureFaceCount = 0;
    if (texFaceCount > 0) {
        s = initRequiredVec(&out->textureRenderTypes, static_cast<std::size_t>(texFaceCount));
        if (!ok(s)) return s;
        Uint8ArrayReader tr(data, 0);
        for (i32 i = 0; i < static_cast<i32>(texFaceCount); i++) {
            i8 type = 0;
            s = tr.readByte(&type);
            if (!ok(s)) return s;
            out->textureRenderTypes[static_cast<std::size_t>(i)] = type;
            if (type == 0) simpleTextureFaceCount++;
            if (type >= 1 && type <= 3) complexTextureFaceCount++;
            if (type == 2) cubeTextureFaceCount++;
        }
    } else {
        clearVec(&out->textureRenderTypes);
    }

    std::size_t offset = static_cast<std::size_t>(texFaceCount) + static_cast<std::size_t>(vertexCountU16);
    const std::size_t vertexFlagsOffset = offset;
    if (hasFaceRenderTypes) offset += static_cast<std::size_t>(faceCountU16);
    const std::size_t faceCompressTypeOffset = offset;
    offset += static_cast<std::size_t>(faceCountU16);
    const std::size_t facePrioritiesOffset = offset;
    if (modelPriority == 255) offset += static_cast<std::size_t>(faceCountU16);
    const std::size_t faceSkinsOffset = offset;
    if (hasFaceSkins == 1) offset += static_cast<std::size_t>(faceCountU16);
    const std::size_t vertexSkinsOffset = offset;
    if (hasVertexSkins == 1) offset += static_cast<std::size_t>(vertexCountU16);
    const std::size_t faceAlphasOffset = offset;
    if (hasFaceAlpha == 1) offset += static_cast<std::size_t>(faceCountU16);
    const std::size_t faceIndicesOffset = offset;
    offset += static_cast<std::size_t>(faceIndicesLen);
    const std::size_t faceMaterialsOffset = offset;
    if (hasFaceTextures == 1) offset += static_cast<std::size_t>(faceCountU16) * 2u;
    const std::size_t faceTextureIndicesOffset = offset;
    offset += static_cast<std::size_t>(textureIndicesLen);
    const std::size_t faceColorsOffset = offset;
    offset += static_cast<std::size_t>(faceCountU16) * 2u;
    const std::size_t xVertexOffset = offset;
    offset += static_cast<std::size_t>(modelVerticesX);
    const std::size_t yVertexOffset = offset;
    offset += static_cast<std::size_t>(modelVerticesY);
    const std::size_t zVertexOffset = offset;
    offset += static_cast<std::size_t>(modelVerticesZ);
    const std::size_t simpleTexturesOffset = offset;
    offset += static_cast<std::size_t>(simpleTextureFaceCount) * 6u;
    const std::size_t complexTexturesOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount) * 6u;
    i32 textureBytes = 6;
    if (version == 14) {
        textureBytes = 7;
    } else if (version >= 15) {
        textureBytes = 9;
    }
    const std::size_t texturesScalesOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount) * static_cast<std::size_t>(textureBytes);
    const std::size_t texturesRotationOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount);
    const std::size_t texturesDirectionOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount);
    const std::size_t texturesTranslationOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount) + static_cast<std::size_t>(cubeTextureFaceCount) * 2u;
    (void)vertexFlagsOffset;
    (void)offset;

    s = initModelCoreArrays(out, static_cast<i32>(vertexCountU16), static_cast<i32>(faceCountU16));
    if (!ok(s)) return s;
    out->version = version;
    out->textureFaceCount = static_cast<i32>(texFaceCount);
    out->priority = (modelPriority == 255) ? 0 : static_cast<i32>(modelPriority);
    out->usedVertexCount = -1;

    s = initOptionalVec(hasFaceRenderTypes, &out->faceRenderTypes, static_cast<std::size_t>(faceCountU16), &out->hasFaceRenderTypes);
    if (!ok(s)) return s;
    s = initOptionalVec(modelPriority == 255, &out->faceRenderPriorities, static_cast<std::size_t>(faceCountU16), &out->hasFaceRenderPriorities);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceAlpha == 1, &out->faceAlphas, static_cast<std::size_t>(faceCountU16), &out->hasFaceAlphas);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceSkins == 1, &out->faceSkins, static_cast<std::size_t>(faceCountU16), &out->hasFaceSkins);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceTextures == 1, &out->faceTextures, static_cast<std::size_t>(faceCountU16), &out->hasFaceTextures);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceTextures == 1 && texFaceCount > 0, &out->textureCoords, static_cast<std::size_t>(faceCountU16), &out->hasTextureCoords);
    if (!ok(s)) return s;
    s = initOptionalVec(hasVertexSkins == 1, &out->vertexSkins, static_cast<std::size_t>(vertexCountU16), &out->hasVertexSkins);
    if (!ok(s)) return s;
    s = initOptionalNestedIntVec(false, 0, &out->animMayaGroups, &out->animMayaScales, out);
    if (!ok(s)) return s;

    if (texFaceCount > 0) {
        s = initRequiredVec(&out->textureMappingP, static_cast<std::size_t>(texFaceCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureMappingM, static_cast<std::size_t>(texFaceCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureMappingN, static_cast<std::size_t>(texFaceCount));
        if (!ok(s)) return s;

        // TS parity: V1 only allocates the per-face texture transform arrays when those texture faces exist.
        // For models with only type=0 texture faces, these arrays stay empty/absent in TS.
        if (complexTextureFaceCount > 0) {
            const std::size_t n = static_cast<std::size_t>(complexTextureFaceCount);
            s = initRequiredVec(&out->textureScaleX, n);
            if (!ok(s)) return s;
            s = initRequiredVec(&out->textureScaleY, n);
            if (!ok(s)) return s;
            s = initRequiredVec(&out->textureScaleZ, n);
            if (!ok(s)) return s;
            s = initRequiredVec(&out->textureRotation, n);
            if (!ok(s)) return s;
            s = initRequiredVec(&out->textureDirection, n);
            if (!ok(s)) return s;
            s = initRequiredVec(&out->textureSpeed, n);
            if (!ok(s)) return s;
        } else {
            clearVec(&out->textureScaleX);
            clearVec(&out->textureScaleY);
            clearVec(&out->textureScaleZ);
            clearVec(&out->textureRotation);
            clearVec(&out->textureDirection);
            clearVec(&out->textureSpeed);
        }

        if (cubeTextureFaceCount > 0) {
            const std::size_t n = static_cast<std::size_t>(cubeTextureFaceCount);
            s = initRequiredVec(&out->textureTransU, n);
            if (!ok(s)) return s;
            s = initRequiredVec(&out->textureTransV, n);
            if (!ok(s)) return s;
        } else {
            clearVec(&out->textureTransU);
            clearVec(&out->textureTransV);
        }
    } else {
        clearVec(&out->textureMappingP);
        clearVec(&out->textureMappingM);
        clearVec(&out->textureMappingN);
        clearVec(&out->textureScaleX);
        clearVec(&out->textureScaleY);
        clearVec(&out->textureScaleZ);
        clearVec(&out->textureRotation);
        clearVec(&out->textureDirection);
        clearVec(&out->textureSpeed);
        clearVec(&out->textureTransU);
        clearVec(&out->textureTransV);
    }

    s = decodeModelVerticesDelta(
        data,
        static_cast<std::size_t>(texFaceCount),
        xVertexOffset,
        yVertexOffset,
        zVertexOffset,
        static_cast<i32>(vertexCountU16),
        out);
    if (!ok(s)) return s;

    Uint8ArrayReader vertexSkinReader(data, 0);
    s = vertexSkinReader.seek(vertexSkinsOffset);
    if (!ok(s)) return s;
    for (i32 i = 0; i < static_cast<i32>(vertexCountU16); i++) {
        if (out->hasVertexSkins) {
            u8 skin = 0;
            s = vertexSkinReader.readUnsignedByte(&skin);
            if (!ok(s)) return s;
            out->vertexSkins[static_cast<std::size_t>(i)] = static_cast<i32>(skin);
        }
    }

    Uint8ArrayReader colorReader(data, 0);
    Uint8ArrayReader renderTypeReader(data, 0);
    Uint8ArrayReader priorityReader(data, 0);
    Uint8ArrayReader alphaReader(data, 0);
    Uint8ArrayReader faceSkinReader(data, 0);
    Uint8ArrayReader faceTextureReader(data, 0);
    Uint8ArrayReader textureCoordReader(data, 0);
    s = colorReader.seek(faceColorsOffset);
    if (!ok(s)) return s;
    s = renderTypeReader.seek(vertexFlagsOffset);
    if (!ok(s)) return s;
    s = priorityReader.seek(facePrioritiesOffset);
    if (!ok(s)) return s;
    s = alphaReader.seek(faceAlphasOffset);
    if (!ok(s)) return s;
    s = faceSkinReader.seek(faceSkinsOffset);
    if (!ok(s)) return s;
    s = faceTextureReader.seek(faceMaterialsOffset);
    if (!ok(s)) return s;
    s = textureCoordReader.seek(faceTextureIndicesOffset);
    if (!ok(s)) return s;

    for (i32 i = 0; i < static_cast<i32>(faceCountU16); i++) {
        const std::size_t fi = static_cast<std::size_t>(i);
        u16 c = 0;
        s = colorReader.readUnsignedShort(&c);
        if (!ok(s)) return s;
        out->faceColors[fi] = c;

        if (out->hasFaceRenderTypes) {
            i8 rt = 0;
            s = renderTypeReader.readByte(&rt);
            if (!ok(s)) return s;
            out->faceRenderTypes[fi] = rt;
        }
        if (out->hasFaceRenderPriorities) {
            i8 p = 0;
            s = priorityReader.readByte(&p);
            if (!ok(s)) return s;
            out->faceRenderPriorities[fi] = p;
        }
        if (out->hasFaceAlphas) {
            i8 a = 0;
            s = alphaReader.readByte(&a);
            if (!ok(s)) return s;
            out->faceAlphas[fi] = a;
        }
        if (out->hasFaceSkins) {
            u8 skin = 0;
            s = faceSkinReader.readUnsignedByte(&skin);
            if (!ok(s)) return s;
            out->faceSkins[fi] = static_cast<i32>(skin);
        }
        if (out->hasFaceTextures) {
            u16 tex = 0;
            s = faceTextureReader.readUnsignedShort(&tex);
            if (!ok(s)) return s;
            out->faceTextures[fi] = static_cast<i16>(static_cast<i32>(tex) - 1);
        }
        if (out->hasTextureCoords) {
            if (out->hasFaceTextures && out->faceTextures[fi] != -1) {
                u8 coord = 0;
                s = textureCoordReader.readUnsignedByte(&coord);
                if (!ok(s)) return s;
                out->textureCoords[fi] = static_cast<i8>(static_cast<i32>(coord) - 1);
            } else {
                out->textureCoords[fi] = static_cast<i8>(-1);
            }
        }
    }

    s = decodeModelFaceIndices(
        data,
        faceIndicesOffset,
        faceCompressTypeOffset,
        static_cast<i32>(faceCountU16),
        true,
        out);
    if (!ok(s)) return s;

    s = decodeTextureMappingV1(
        data,
        simpleTexturesOffset,
        complexTexturesOffset,
        texturesScalesOffset,
        texturesRotationOffset,
        texturesDirectionOffset,
        texturesTranslationOffset,
        version,
        out);
    if (!ok(s)) return s;

    if (version >= 13) {
        out->scaleDown(2);
    }
    return Status::Ok;
}
