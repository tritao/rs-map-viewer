#pragma once

inline Status decodeModelDataV3(Span<const u8> data, ModelData* out) noexcept {
    if (!out) return Status::InvalidArgument;
    if (data.size() < 26) return Status::BadFormat;

    Uint8ArrayReader footer(data, data.size() - 26);
    u16 vertexCountU16 = 0;
    u16 faceCountU16 = 0;
    u8 texTriangleCount = 0;
    u8 hasFaceRenderTypes = 0;
    u8 priorityOrFlag = 0;
    u8 hasFaceAlphas = 0;
    u8 hasFaceSkins = 0;
    u8 hasFaceTextures = 0;
    u8 hasVertexSkins = 0;
    u8 hasMayaGroups = 0;
    u16 vertexDeltaXLen = 0;
    u16 vertexDeltaYLen = 0;
    u16 vertexDeltaZLen = 0;
    u16 faceIndexLen = 0;
    u16 textureCoordLen = 0;
    u16 vertexSkinAndMayaLen = 0;

    Status s = footer.readUnsignedShort(&vertexCountU16);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&faceCountU16);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&texTriangleCount);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasFaceRenderTypes);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&priorityOrFlag);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasFaceAlphas);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasFaceSkins);
    if (!ok(s)) return s;
    s = footer.readUnsignedByte(&hasFaceTextures);
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
    s = footer.readUnsignedShort(&textureCoordLen);
    if (!ok(s)) return s;
    s = footer.readUnsignedShort(&vertexSkinAndMayaLen);
    if (!ok(s)) return s;

    i32 simpleTextureFaceCount = 0;
    i32 complexTextureFaceCount = 0;
    i32 cubeTextureFaceCount = 0;

    if (texTriangleCount > 0) {
        s = initRequiredVec(&out->textureRenderTypes, static_cast<std::size_t>(texTriangleCount));
        if (!ok(s)) return s;
        Uint8ArrayReader tr(data, 0);
        for (i32 i = 0; i < static_cast<i32>(texTriangleCount); i++) {
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

    std::size_t offset = static_cast<std::size_t>(texTriangleCount) + static_cast<std::size_t>(vertexCountU16);
    const std::size_t faceRenderTypeOffset = offset;
    if (hasFaceRenderTypes == 1) {
        offset += static_cast<std::size_t>(faceCountU16);
    }
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
    const std::size_t vertexSkinAndMayaOffset = offset;
    offset += static_cast<std::size_t>(vertexSkinAndMayaLen);
    const std::size_t faceAlphaOffset = offset;
    if (hasFaceAlphas == 1) {
        offset += static_cast<std::size_t>(faceCountU16);
    }
    const std::size_t faceIndexDataOffset = offset;
    offset += static_cast<std::size_t>(faceIndexLen);
    const std::size_t faceTextureOffset = offset;
    if (hasFaceTextures == 1) {
        offset += static_cast<std::size_t>(faceCountU16) * 2u;
    }
    const std::size_t textureCoordOffset = offset;
    offset += static_cast<std::size_t>(textureCoordLen);
    const std::size_t faceColorOffset = offset;
    offset += static_cast<std::size_t>(faceCountU16) * 2u;
    const std::size_t vertexDeltaXOffset = offset;
    offset += static_cast<std::size_t>(vertexDeltaXLen);
    const std::size_t vertexDeltaYOffset = offset;
    offset += static_cast<std::size_t>(vertexDeltaYLen);
    const std::size_t vertexDeltaZOffset = offset;
    offset += static_cast<std::size_t>(vertexDeltaZLen);
    const std::size_t simpleTextureMappingOffset = offset;
    offset += static_cast<std::size_t>(simpleTextureFaceCount) * 6u;
    const std::size_t complexTextureMappingOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount) * 6u;
    const std::size_t complexTextureScaleOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount) * 6u;
    const std::size_t complexTextureRotationOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount) * 2u;
    const std::size_t complexTextureDirectionOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount);
    const std::size_t complexTextureTranslationOffset = offset;
    offset += static_cast<std::size_t>(complexTextureFaceCount) * 2u +
              static_cast<std::size_t>(cubeTextureFaceCount) * 2u;
    (void)offset;

    s = initModelCoreArrays(out, static_cast<i32>(vertexCountU16), static_cast<i32>(faceCountU16));
    if (!ok(s)) return s;
    out->version = 3;
    out->textureFaceCount = static_cast<i32>(texTriangleCount);
    out->priority = (priorityOrFlag == 255) ? 0 : static_cast<i32>(priorityOrFlag);
    out->usedVertexCount = out->verticesCount;

    s = initOptionalVec(hasFaceRenderTypes == 1, &out->faceRenderTypes, static_cast<std::size_t>(faceCountU16), &out->hasFaceRenderTypes);
    if (!ok(s)) return s;
    s = initOptionalVec(priorityOrFlag == 255, &out->faceRenderPriorities, static_cast<std::size_t>(faceCountU16), &out->hasFaceRenderPriorities);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceAlphas == 1, &out->faceAlphas, static_cast<std::size_t>(faceCountU16), &out->hasFaceAlphas);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceSkins == 1, &out->faceSkins, static_cast<std::size_t>(faceCountU16), &out->hasFaceSkins);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceTextures == 1, &out->faceTextures, static_cast<std::size_t>(faceCountU16), &out->hasFaceTextures);
    if (!ok(s)) return s;
    s = initOptionalVec(hasFaceTextures == 1 && texTriangleCount > 0, &out->textureCoords, static_cast<std::size_t>(faceCountU16), &out->hasTextureCoords);
    if (!ok(s)) return s;
    s = initOptionalVec(hasVertexSkins == 1, &out->vertexSkins, static_cast<std::size_t>(vertexCountU16), &out->hasVertexSkins);
    if (!ok(s)) return s;
    s = initOptionalNestedIntVec(hasMayaGroups == 1, static_cast<i32>(vertexCountU16), &out->animMayaGroups, &out->animMayaScales, out);
    if (!ok(s)) return s;

    if (texTriangleCount > 0) {
        s = initRequiredVec(&out->textureMappingP, static_cast<std::size_t>(texTriangleCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureMappingM, static_cast<std::size_t>(texTriangleCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureMappingN, static_cast<std::size_t>(texTriangleCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureScaleX, static_cast<std::size_t>(complexTextureFaceCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureScaleY, static_cast<std::size_t>(complexTextureFaceCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureScaleZ, static_cast<std::size_t>(complexTextureFaceCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureRotation, static_cast<std::size_t>(complexTextureFaceCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureDirection, static_cast<std::size_t>(complexTextureFaceCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureSpeed, static_cast<std::size_t>(complexTextureFaceCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureTransU, static_cast<std::size_t>(cubeTextureFaceCount));
        if (!ok(s)) return s;
        s = initRequiredVec(&out->textureTransV, static_cast<std::size_t>(cubeTextureFaceCount));
        if (!ok(s)) return s;
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

    Uint8ArrayReader vSkinReader(data, 0);
    s = decodeModelVerticesDelta(
        data,
        static_cast<std::size_t>(texTriangleCount),
        vertexDeltaXOffset,
        vertexDeltaYOffset,
        vertexDeltaZOffset,
        static_cast<i32>(vertexCountU16),
        out);
    if (!ok(s)) return s;

    s = vSkinReader.seek(vertexSkinAndMayaOffset);
    if (!ok(s)) return s;
    for (i32 i = 0; i < static_cast<i32>(vertexCountU16); i++) {
        if (out->hasVertexSkins) {
            u8 skin = 0;
            s = vSkinReader.readUnsignedByte(&skin);
            if (!ok(s)) return s;
            out->vertexSkins[static_cast<std::size_t>(i)] = static_cast<i32>(skin);
        }
    }

    if (out->hasMayaGroups) {
        for (i32 i = 0; i < static_cast<i32>(vertexCountU16); i++) {
            u8 groupCount = 0;
            s = vSkinReader.readUnsignedByte(&groupCount);
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
                s = vSkinReader.readUnsignedByte(&g);
                if (!ok(s)) return s;
                s = vSkinReader.readUnsignedByte(&sc);
                if (!ok(s)) return s;
                groups[static_cast<std::size_t>(j)] = static_cast<i32>(g);
                scales[static_cast<std::size_t>(j)] = static_cast<i32>(sc);
            }
        }
    }

    Uint8ArrayReader colorReader(data, 0);
    Uint8ArrayReader renderTypeReader(data, 0);
    Uint8ArrayReader priorityReader(data, 0);
    Uint8ArrayReader alphaReader(data, 0);
    Uint8ArrayReader faceSkinReader(data, 0);
    Uint8ArrayReader faceTextureReader(data, 0);
    Uint8ArrayReader coordReader(data, 0);
    s = colorReader.seek(faceColorOffset);
    if (!ok(s)) return s;
    s = renderTypeReader.seek(faceRenderTypeOffset);
    if (!ok(s)) return s;
    s = priorityReader.seek(facePriorityOffset);
    if (!ok(s)) return s;
    s = alphaReader.seek(faceAlphaOffset);
    if (!ok(s)) return s;
    s = faceSkinReader.seek(faceSkinOffset);
    if (!ok(s)) return s;
    s = faceTextureReader.seek(faceTextureOffset);
    if (!ok(s)) return s;
    s = coordReader.seek(textureCoordOffset);
    if (!ok(s)) return s;

    for (i32 i = 0; i < static_cast<i32>(faceCountU16); i++) {
        u16 faceColor = 0;
        s = colorReader.readUnsignedShort(&faceColor);
        if (!ok(s)) return s;
        out->faceColors[static_cast<std::size_t>(i)] = faceColor;

        if (out->hasFaceRenderTypes) {
            i8 rt = 0;
            s = renderTypeReader.readByte(&rt);
            if (!ok(s)) return s;
            out->faceRenderTypes[static_cast<std::size_t>(i)] = rt;
        }
        if (out->hasFaceRenderPriorities) {
            i8 pr = 0;
            s = priorityReader.readByte(&pr);
            if (!ok(s)) return s;
            out->faceRenderPriorities[static_cast<std::size_t>(i)] = pr;
        }
        if (out->hasFaceAlphas) {
            i8 a = 0;
            s = alphaReader.readByte(&a);
            if (!ok(s)) return s;
            out->faceAlphas[static_cast<std::size_t>(i)] = a;
        }
        if (out->hasFaceSkins) {
            u8 skin = 0;
            s = faceSkinReader.readUnsignedByte(&skin);
            if (!ok(s)) return s;
            out->faceSkins[static_cast<std::size_t>(i)] = static_cast<i32>(skin);
        }
        if (out->hasFaceTextures) {
            u16 tex = 0;
            s = faceTextureReader.readUnsignedShort(&tex);
            if (!ok(s)) return s;
            out->faceTextures[static_cast<std::size_t>(i)] = static_cast<i16>(static_cast<i32>(tex) - 1);
        }
        if (out->hasTextureCoords && out->hasFaceTextures && out->faceTextures[static_cast<std::size_t>(i)] != -1) {
            u8 coord = 0;
            s = coordReader.readUnsignedByte(&coord);
            if (!ok(s)) return s;
            out->textureCoords[static_cast<std::size_t>(i)] = static_cast<i8>(static_cast<i32>(coord) - 1);
        }
    }

    s = decodeModelFaceColors(data, faceColorOffset, static_cast<i32>(faceCountU16), out);
    if (!ok(s)) return s;

    s = decodeModelFaceIndices(
        data,
        faceIndexDataOffset,
        faceIndexTypeOffset,
        static_cast<i32>(faceCountU16),
        false,
        out);
    if (!ok(s)) return s;

    s = decodeTextureMappingV3(
        data,
        simpleTextureMappingOffset,
        complexTextureMappingOffset,
        complexTextureScaleOffset,
        complexTextureRotationOffset,
        complexTextureDirectionOffset,
        complexTextureTranslationOffset,
        out);
    if (!ok(s)) return s;

    return Status::Ok;
}
