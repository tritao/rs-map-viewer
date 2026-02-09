#pragma once

inline Status decodeModelDataV2(Span<const u8> data, ModelData* out) noexcept {
    if (!out) return Status::InvalidArgument;
    if (data.size() < 23) return Status::BadFormat;

    Uint8ArrayReader footer(data, data.size() - 23);
    u16 vertexCountU16 = 0;
    u16 faceCountU16 = 0;
    u8 texTriangleCount = 0;
    u8 usesTextures = 0;
    u8 priorityOrFlag = 0;
    u8 hasFaceAlphas = 0;
    u8 hasFaceSkins = 0;
    u8 hasVertexSkins = 0;
    u8 hasMayaGroups = 0;
    u16 vertexDeltaXLen = 0;
    u16 vertexDeltaYLen = 0;
    u16 vertexDeltaZLen = 0;
    u16 faceIndexLen = 0;
    u16 vertexSkinAndMayaLen = 0;

    Status s = footer.readUnsignedShort(&vertexCountU16);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&faceCountU16);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&texTriangleCount);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&usesTextures);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&priorityOrFlag);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasFaceAlphas);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasFaceSkins);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasVertexSkins);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasMayaGroups);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&vertexDeltaXLen);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&vertexDeltaYLen);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&vertexDeltaZLen);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&faceIndexLen);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&vertexSkinAndMayaLen);
    if (!ok(s)) return s;

    std::size_t offset = static_cast<std::size_t>(vertexCountU16);
    const std::size_t faceIndexTypeOffset = offset;
    offset += static_cast<std::size_t>(faceCountU16);
    const std::size_t facePriorityOffset = offset;
    if (priorityOrFlag == 255) {
        offset += static_cast<std::size_t>(faceCountU16);
    }
    const std::size_t faceSkinOffset = offset;
    if (hasFaceSkins == 1) {
        offset += static_cast<std::size_t>(faceCountU16);
    }
    const std::size_t faceFlagOffset = offset;
    if (usesTextures == 1) {
        offset += static_cast<std::size_t>(faceCountU16);
    }
    const std::size_t vertexSkinAndMayaOffset = offset;
    offset += static_cast<std::size_t>(vertexSkinAndMayaLen);
    const std::size_t faceAlphaOffset = offset;
    if (hasFaceAlphas == 1) {
        offset += static_cast<std::size_t>(faceCountU16);
    }
    const std::size_t faceIndexDataOffset = offset;
    offset += static_cast<std::size_t>(faceIndexLen);
    const std::size_t faceColorOffset = offset;
    offset += static_cast<std::size_t>(faceCountU16) * 2u;
    const std::size_t textureTriangleMappingOffset = offset;
    offset += static_cast<std::size_t>(texTriangleCount) * 6u;
    const std::size_t vertexDeltaXOffset = offset;
    offset += static_cast<std::size_t>(vertexDeltaXLen);
    const std::size_t vertexDeltaYOffset = offset;
    offset += static_cast<std::size_t>(vertexDeltaYLen);
    const std::size_t vertexDeltaZOffset = offset;
    (void)vertexDeltaZOffset;

    s = initModelCoreArrays(out, static_cast<i32>(vertexCountU16), static_cast<i32>(faceCountU16));
    if (!ok(s)) return s;
    out->version = 2;
    out->textureFaceCount = static_cast<i32>(texTriangleCount);
    out->priority = (priorityOrFlag == 255) ? 0 : static_cast<i32>(priorityOrFlag);
    out->usedVertexCount = out->verticesCount;

    if (texTriangleCount > 0) {
        s = initRequiredVec(&out->textureRenderTypes, static_cast<std::size_t>(texTriangleCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureMappingP, static_cast<std::size_t>(texTriangleCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureMappingM, static_cast<std::size_t>(texTriangleCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureMappingN, static_cast<std::size_t>(texTriangleCount));
        if (!ok(s)) return s;
        for (i32 i = 0; i < static_cast<i32>(texTriangleCount); i++) {
            out->textureRenderTypes[static_cast<std::size_t>(i)] = 0;
        }
    } else {
        clearVec(&out->textureRenderTypes);
        clearVec(&out->textureMappingP);
        clearVec(&out->textureMappingM);
        clearVec(&out->textureMappingN);
    }
    clearVec(&out->textureScaleX);
    clearVec(&out->textureScaleY);
    clearVec(&out->textureScaleZ);
    clearVec(&out->textureRotation);
    clearVec(&out->textureDirection);
    clearVec(&out->textureSpeed);
    clearVec(&out->textureTransU);
    clearVec(&out->textureTransV);

    s = initOptionalVec(hasVertexSkins == 1, &out->vertexSkins, static_cast<std::size_t>(vertexCountU16), &out->hasVertexSkins);
    if (!ok(s)) return s;
    s = initOptionalVec(usesTextures == 1, &out->faceRenderTypes, static_cast<std::size_t>(faceCountU16), &out->hasFaceRenderTypes);
    if (!ok(s)) return s;
    s = initOptionalVec(usesTextures == 1, &out->textureCoords, static_cast<std::size_t>(faceCountU16), &out->hasTextureCoords);
    if (!ok(s)) return s;
    s = initOptionalVec(usesTextures == 1, &out->faceTextures, static_cast<std::size_t>(faceCountU16), &out->hasFaceTextures);
    if (!ok(s)) return s;
    s = initOptionalVec(priorityOrFlag == 255, &out->faceRenderPriorities, static_cast<std::size_t>(faceCountU16), &out->hasFaceRenderPriorities);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceAlphas == 1, &out->faceAlphas, static_cast<std::size_t>(faceCountU16), &out->hasFaceAlphas);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceSkins == 1, &out->faceSkins, static_cast<std::size_t>(faceCountU16), &out->hasFaceSkins);
    if (!ok(s)) return s;
    s = initOptionalNestedIntVec(hasMayaGroups == 1, static_cast<i32>(vertexCountU16), &out->animMayaGroups, &out->animMayaScales, out);
    if (!ok(s)) return s;

    Uint8ArrayReader skinReader(data, 0);
    s = decodeModelVerticesDelta(
        data,
        0,
        vertexDeltaXOffset,
        vertexDeltaYOffset,
        vertexDeltaZOffset,
        static_cast<i32>(vertexCountU16),
        out);
    if (!ok(s)) return s;
    s = skinReader.seek(vertexSkinAndMayaOffset);
    if (!ok(s)) return s;
    for (i32 i = 0; i < static_cast<i32>(vertexCountU16); i++) {
        if (out->hasVertexSkins) {
            u8 skin = 0;
            s = skinReader.readUnsignedByte(&skin);
            if (!ok(s)) return s;
            out->vertexSkins[static_cast<std::size_t>(i)] = static_cast<i32>(skin);
        }
    }
    if (out->hasMayaGroups) {
        for (i32 i = 0; i < static_cast<i32>(vertexCountU16); i++) {
            u8 groupCount = 0;
            s = skinReader.readUnsignedByte(&groupCount);
            if (!ok(s)) return s;
            Vec<i32>& groups = out->animMayaGroups[static_cast<std::size_t>(i)];
            Vec<i32>& scales = out->animMayaScales[static_cast<std::size_t>(i)];
            auto rr = groups.resize(static_cast<std::size_t>(groupCount));
            if (!rr.isOk()) return rr.status();
            rr = scales.resize(static_cast<std::size_t>(groupCount));
            if (!rr.isOk()) return rr.status();
            for (i32 j = 0; j < static_cast<i32>(groupCount); j++) {
                u8 g = 0;
                u8 sc = 0;
                s = skinReader.readUnsignedByte(&g);
                if (!ok(s)) return s;
                s = skinReader.readUnsignedByte(&sc);
                if (!ok(s)) return s;
                groups[static_cast<std::size_t>(j)] = static_cast<i32>(g);
                scales[static_cast<std::size_t>(j)] = static_cast<i32>(sc);
            }
        }
    }

    Uint8ArrayReader colorReader(data, 0);
    Uint8ArrayReader flagReader(data, 0);
    Uint8ArrayReader priorityReader(data, 0);
    Uint8ArrayReader alphaReader(data, 0);
    Uint8ArrayReader faceSkinReader(data, 0);
    s = colorReader.seek(faceColorOffset);
    if (!ok(s)) return s;
    s = flagReader.seek(faceFlagOffset);
    if (!ok(s)) return s;
    s = priorityReader.seek(facePriorityOffset);
    if (!ok(s)) return s;
    s = alphaReader.seek(faceAlphaOffset);
    if (!ok(s)) return s;
    s = faceSkinReader.seek(faceSkinOffset);
    if (!ok(s)) return s;

    bool hasRenderType = false;
    bool isTextured = false;
    for (i32 i = 0; i < static_cast<i32>(faceCountU16); i++) {
        const std::size_t fi = static_cast<std::size_t>(i);
        u16 c = 0;
        s = colorReader.readUnsignedShort(&c);
        if (!ok(s)) return s;
        out->faceColors[fi] = c;

        if (usesTextures == 1 && out->hasFaceRenderTypes && out->hasTextureCoords && out->hasFaceTextures) {
            u8 flag = 0;
            s = flagReader.readUnsignedByte(&flag);
            if (!ok(s)) return s;
            if ((flag & 0x1) == 1) {
                out->faceRenderTypes[fi] = 1;
                hasRenderType = true;
            } else {
                out->faceRenderTypes[fi] = 0;
            }
            if ((flag & 0x2) == 2) {
                out->textureCoords[fi] = static_cast<i8>(flag >> 2);
                out->faceTextures[fi] = static_cast<i16>(out->faceColors[fi]);
                out->faceColors[fi] = 127;
                if (out->faceTextures[fi] != -1) {
                    isTextured = true;
                }
            } else {
                out->textureCoords[fi] = static_cast<i8>(-1);
                out->faceTextures[fi] = static_cast<i16>(-1);
            }
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
    }

    s = decodeModelFaceIndices(
        data,
        faceIndexDataOffset,
        faceIndexTypeOffset,
        static_cast<i32>(faceCountU16),
        true,
        out);
    if (!ok(s)) return s;

    if (texTriangleCount > 0) {
        Uint8ArrayReader mapReader(data, 0);
        s = mapReader.seek(textureTriangleMappingOffset);
        if (!ok(s)) return s;
        for (i32 i = 0; i < static_cast<i32>(texTriangleCount); i++) {
            u16 p = 0, m = 0, n = 0;
            s = mapReader.readUnsignedShort(&p);
            if (!ok(s)) return s;
            s = mapReader.readUnsignedShort(&m);
            if (!ok(s)) return s;
            s = mapReader.readUnsignedShort(&n);
            if (!ok(s)) return s;
            out->textureRenderTypes[static_cast<std::size_t>(i)] = 0;
            out->textureMappingP[static_cast<std::size_t>(i)] = static_cast<i16>(p);
            out->textureMappingM[static_cast<std::size_t>(i)] = static_cast<i16>(m);
            out->textureMappingN[static_cast<std::size_t>(i)] = static_cast<i16>(n);
        }
    }

    cleanupLegacyTextureFlags(out, isTextured, hasRenderType);
    return Status::Ok;
}
