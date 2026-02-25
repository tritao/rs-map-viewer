// Extracted packet-independent animation/tick exports from rs_map_render_backend.cpp.
RS_WASM_KEEPALIVE rs::i32 rs_emit_draw_range_patches_from_frames(
    const rs::i32* drawRangeIndices,
    const rs::i32* frameIds,
    const rs::i32* animFrameOffsets,
    const rs::i32* animFrameCounts,
    rs::i32 entityCount,
    const rs::i32* animFramesPacked,
    rs::i32 animFramesPackedLength,
    rs::i32* outPatchesPacked,
    rs::i32 outPatchesPackedLength) {
    if (!drawRangeIndices || !frameIds || !animFrameOffsets || !animFrameCounts || !outPatchesPacked) {
        return -1;
    }
    if (entityCount < 0 || animFramesPackedLength < 0 || outPatchesPackedLength < 0) {
        return -1;
    }
    if (animFramesPackedLength > 0 && !animFramesPacked) {
        return -1;
    }
    if (outPatchesPackedLength < entityCount * 4) {
        return -2;
    }

    rs::i32 patchCount = 0;
    for (rs::i32 i = 0; i < entityCount; i++) {
        const rs::i32 drawRangeIndex = drawRangeIndices[i];
        if (drawRangeIndex < 0) {
            continue;
        }

        const rs::i32 frameOffsetBase = animFrameOffsets[i];
        const rs::i32 frameCount = animFrameCounts[i];
        if (frameOffsetBase < 0 || frameCount <= 0) {
            continue;
        }

        const rs::i32 frameId = frameIds[i];
        if (frameId < 0 || frameId >= frameCount) {
            continue;
        }

        const rs::i32 frameOffset = frameOffsetBase + frameId * 3;
        if (frameOffset < 0 || frameOffset + 2 >= animFramesPackedLength) {
            return -2;
        }

        const rs::i32 patchOffset = patchCount * 4;
        outPatchesPacked[patchOffset + 0] = drawRangeIndex;
        outPatchesPacked[patchOffset + 1] = animFramesPacked[frameOffset + 0];
        outPatchesPacked[patchOffset + 2] = animFramesPacked[frameOffset + 1];
        outPatchesPacked[patchOffset + 3] = animFramesPacked[frameOffset + 2];
        patchCount++;
    }

    return patchCount;
}

static rs::i32 frameLengthAt(
    const rs::i32* frameLengthsPacked,
    const rs::i32 frameLengthsPackedLength,
    const rs::i32 offset,
    const rs::i32 index) noexcept {
    const rs::i32 at = offset + index;
    if (!frameLengthsPacked || at < 0 || at >= frameLengthsPackedLength) {
        return 1;
    }
    const rs::i32 v = frameLengthsPacked[at];
    return v > 0 ? v : 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_advance_loc_frames_fixed(
    rs::i32* inOutFrameIds,
    rs::i32* inOutCycleStartsFixed,
    const rs::i32* frameSteps,
    const rs::i32* hasAnimMaya,
    const rs::i32* animMayaDurations,
    const rs::i32* frameLengthOffsets,
    const rs::i32* frameLengthCounts,
    rs::i32 entityCount,
    rs::i32 cycleNowFixed,
    const rs::i32* frameLengthsPacked,
    rs::i32 frameLengthsPackedLength,
    rs::i32* outActiveFlags) {
    if (!inOutFrameIds || !inOutCycleStartsFixed ||
        !frameSteps || !hasAnimMaya || !animMayaDurations ||
        !frameLengthOffsets || !frameLengthCounts ||
        !outActiveFlags) {
        return -1;
    }
    if (entityCount < 0 || frameLengthsPackedLength < 0) {
        return -1;
    }
    if (frameLengthsPackedLength > 0 && !frameLengthsPacked) {
        return -1;
    }

    for (rs::i32 i = 0; i < entityCount; i++) {
        rs::i32 frame = inOutFrameIds[i];
        rs::i32 cycleStart = inOutCycleStartsFixed[i];
        const rs::i32 frameStep = frameSteps[i];
        const bool isMaya = hasAnimMaya[i] != 0;
        const rs::i32 mayaDuration = animMayaDurations[i];
        const rs::i32 frameLengthsOffset = frameLengthOffsets[i];
        const rs::i32 frameLengthsCount = frameLengthCounts[i];

        bool active = true;
        rs::i32 elapsed = cycleNowFixed - cycleStart;
        if (elapsed < 0) {
            elapsed = 0;
        }
        if (elapsed > 100 * RS_LOC_CYCLE_SCALE && frameStep > 0) {
            elapsed = 100 * RS_LOC_CYCLE_SCALE;
        }

        if (isMaya) {
            if (mayaDuration <= 0) {
                frame = 0;
                cycleStart = cycleNowFixed - RS_LOC_CYCLE_SCALE;
                active = false;
            } else {
                frame += elapsed / RS_LOC_CYCLE_SCALE;
                elapsed = elapsed % RS_LOC_CYCLE_SCALE;
                if (frame >= mayaDuration) {
                    frame = mayaDuration - frameStep;
                    if (frame < 0 || frame > mayaDuration) {
                        frame = 0;
                        cycleStart = cycleNowFixed - RS_LOC_CYCLE_SCALE;
                        active = false;
                    }
                }
            }
        } else {
            if (frameLengthsCount <= 0 || frameLengthsOffset < 0) {
                frame = 0;
                cycleStart = cycleNowFixed - RS_LOC_CYCLE_SCALE;
                active = false;
            } else {
                while (true) {
                    if (frame < 0 || frame >= frameLengthsCount) {
                        frame = 0;
                        cycleStart = cycleNowFixed - RS_LOC_CYCLE_SCALE;
                        active = false;
                        break;
                    }
                    const rs::i32 frameLen = frameLengthAt(
                        frameLengthsPacked,
                        frameLengthsPackedLength,
                        frameLengthsOffset,
                        frame);
                    const rs::i32 frameLenFixed = frameLen * RS_LOC_CYCLE_SCALE;
                    if (elapsed <= frameLenFixed) {
                        break;
                    }
                    elapsed -= frameLenFixed;
                    frame++;
                    if (frame >= frameLengthsCount) {
                        frame -= frameStep;
                        if (frame < 0 || frame >= frameLengthsCount) {
                            frame = 0;
                            cycleStart = cycleNowFixed - RS_LOC_CYCLE_SCALE;
                            active = false;
                            break;
                        }
                    }
                }
            }
        }

        if (active) {
            cycleStart = cycleNowFixed - elapsed;
        }

        inOutFrameIds[i] = frame;
        inOutCycleStartsFixed[i] = cycleStart;
        outActiveFlags[i] = active ? 1 : 0;
    }

    return 1;
}

RS_WASM_KEEPALIVE rs::i32 rs_advance_npc_frames_from_seq_state(
    rs::i32* inOutFrameIds,
    rs::i32* inOutFrameTicks,
    rs::i32* inOutMovementLoops,
    const rs::i32* selectedSeqValid,
    const rs::i32* selectedHasAnimMaya,
    const rs::i32* selectedAnimMayaDurations,
    const rs::i32* selectedFrameSteps,
    const rs::i32* selectedLooping,
    const rs::i32* selectedMaxLoops,
    const rs::i32* selectedFrameIdCounts,
    const rs::i32* selectedFrameLengthOffsets,
    const rs::i32* selectedFrameLengthCounts,
    rs::i32 entityCount,
    rs::i32 tickCount,
    const rs::i32* frameLengthsPacked,
    rs::i32 frameLengthsPackedLength) {
    if (!inOutFrameIds || !inOutFrameTicks || !inOutMovementLoops ||
        !selectedSeqValid || !selectedHasAnimMaya || !selectedAnimMayaDurations ||
        !selectedFrameSteps || !selectedLooping || !selectedMaxLoops ||
        !selectedFrameIdCounts || !selectedFrameLengthOffsets || !selectedFrameLengthCounts) {
        return -1;
    }
    if (entityCount < 0 || tickCount < 0 || frameLengthsPackedLength < 0) {
        return -1;
    }
    if (frameLengthsPackedLength > 0 && !frameLengthsPacked) {
        return -1;
    }

    for (rs::i32 i = 0; i < entityCount; i++) {
        rs::i32 frame = inOutFrameIds[i];
        rs::i32 frameTick = inOutFrameTicks[i];
        rs::i32 movementLoop = inOutMovementLoops[i];

        const bool seqValid = selectedSeqValid[i] != 0;
        const bool hasAnimMayaSeq = selectedHasAnimMaya[i] != 0;
        const rs::i32 animMayaDuration = selectedAnimMayaDurations[i];
        const rs::i32 frameStep = selectedFrameSteps[i];
        const bool looping = selectedLooping[i] != 0;
        const rs::i32 maxLoops = selectedMaxLoops[i];
        const rs::i32 frameIdCount = selectedFrameIdCounts[i];
        const rs::i32 frameLengthOffset = selectedFrameLengthOffsets[i];
        const rs::i32 frameLengthCount = selectedFrameLengthCounts[i];

        if (seqValid) {
            for (rs::i32 t = 0; t < tickCount; t++) {
                if (!hasAnimMayaSeq && frameLengthCount > 0) {
                    frameTick++;
                    if (frame < frameLengthCount &&
                        frameTick > frameLengthAt(
                            frameLengthsPacked,
                            frameLengthsPackedLength,
                            frameLengthOffset,
                            frame)) {
                        frameTick = 1;
                        frame++;
                    }

                    if (frame >= frameLengthCount) {
                        if (frameStep > 0) {
                            frame -= frameStep;
                            if (looping) {
                                movementLoop++;
                            }
                            if (frame < 0 ||
                                frame >= frameIdCount ||
                                (looping && movementLoop >= maxLoops)) {
                                frameTick = 0;
                                frame = 0;
                                movementLoop = 0;
                            } else {
                                frameTick = 0;
                                frame = 0;
                            }
                        } else {
                            frameTick = 0;
                            frame = 0;
                        }
                    }
                } else if (hasAnimMayaSeq) {
                    frame++;
                    if (frame >= animMayaDuration) {
                        if (frameStep > 0) {
                            frame -= frameStep;
                            if (looping) {
                                movementLoop++;
                            }
                            if (frame < 0 ||
                                frame >= frameIdCount ||
                                (looping && movementLoop >= maxLoops)) {
                                frameTick = 0;
                                frame = 0;
                                movementLoop = 0;
                            } else {
                                frameTick = 0;
                                frame = 0;
                            }
                        } else {
                            frameTick = 0;
                            frame = 0;
                        }
                    }
                }
            }
        }

        inOutFrameIds[i] = frame;
        inOutFrameTicks[i] = frameTick;
        inOutMovementLoops[i] = movementLoop;
    }

    return 1;
}

static void advanceNpcMovementTransformOne(
    rs::i32& x,
    rs::i32& y,
    rs::i32& orientation,
    rs::i32& rotation,
    rs::i32& pathLength,
    rs::i32& movementSeqId,
    const rs::i32* pathX,
    const rs::i32* pathY,
    const rs::i32* pathMovementType,
    const rs::i32 npcSize,
    const bool npcIsClickable,
    const rs::i32 npcRotationSpeed,
    const rs::i32 idleSeqId,
    const rs::i32 walkSeqId) {
    movementSeqId = idleSeqId;
    if (pathLength > 0) {
        const rs::i32 currX = x;
        const rs::i32 currY = y;
        const rs::i32 nextPathIndex = pathLength - 1;
        if (nextPathIndex < 0 || nextPathIndex >= RS_NPC_PATH_QUEUE_LEN) {
            pathLength = 0;
            return;
        }

        const rs::i32 nextX = pathX[nextPathIndex] * 128 + npcSize * 64;
        const rs::i32 nextY = pathY[nextPathIndex] * 128 + npcSize * 64;

        if (currX < nextX) {
            if (currY < nextY) {
                orientation = 1280;
            } else if (currY > nextY) {
                orientation = 1792;
            } else {
                orientation = 1536;
            }
        } else if (currX > nextX) {
            if (currY < nextY) {
                orientation = 768;
            } else if (currY > nextY) {
                orientation = 256;
            } else {
                orientation = 512;
            }
        } else if (currY < nextY) {
            orientation = 1024;
        } else if (currY > nextY) {
            orientation = 0;
        }

        movementSeqId = walkSeqId;

        const rs::i32 movementType = pathMovementType[nextPathIndex];
        if (nextX - currX <= 256 &&
            nextX - currX >= -256 &&
            nextY - currY <= 256 &&
            nextY - currY >= -256) {
            rs::i32 movementSpeed = 4;
            if (npcIsClickable) {
                if (rotation != orientation && npcRotationSpeed != 0) {
                    movementSpeed = 2;
                }
                if (pathLength > 2) {
                    movementSpeed = 6;
                }
                if (pathLength > 3) {
                    movementSpeed = 8;
                }
            } else {
                if (pathLength > 1) {
                    movementSpeed = 6;
                }
                if (pathLength > 2) {
                    movementSpeed = 8;
                }
            }

            if (movementType == RS_MOVEMENT_TYPE_RUN) {
                movementSpeed <<= 1;
            } else if (movementType == RS_MOVEMENT_TYPE_CRAWL) {
                movementSpeed >>= 1;
            }

            if (currX != nextX || currY != nextY) {
                if (currX < nextX) {
                    x += movementSpeed;
                    if (x > nextX) {
                        x = nextX;
                    }
                } else if (currX > nextX) {
                    x -= movementSpeed;
                    if (x < nextX) {
                        x = nextX;
                    }
                }

                if (currY < nextY) {
                    y += movementSpeed;
                    if (y > nextY) {
                        y = nextY;
                    }
                } else if (currY > nextY) {
                    y -= movementSpeed;
                    if (y < nextY) {
                        y = nextY;
                    }
                }
            }

            if (x == nextX && y == nextY) {
                pathLength--;
            }
        } else {
            x = nextX;
            y = nextY;
            pathLength--;
        }
    }

    const rs::i32 deltaRotation = (orientation - rotation) & 2047;
    if (deltaRotation != 0) {
        const rs::i32 rotateDir = deltaRotation > 1024 ? -1 : 1;
        rotation += rotateDir * npcRotationSpeed;
        if (deltaRotation < npcRotationSpeed ||
            deltaRotation > 2048 - npcRotationSpeed) {
            rotation = orientation;
        }
        rotation &= 2047;
    }
}

RS_WASM_KEEPALIVE rs::i32 rs_advance_npc_movement_transforms(
    rs::i32* inOutX,
    rs::i32* inOutY,
    rs::i32* inOutOrientation,
    rs::i32* inOutRotation,
    rs::i32* inOutPathLength,
    rs::i32* inOutMovementSeqId,
    const rs::i32* pathXPacked,
    rs::i32 pathXPackedLength,
    const rs::i32* pathYPacked,
    rs::i32 pathYPackedLength,
    const rs::i32* pathMovementTypePacked,
    rs::i32 pathMovementTypePackedLength,
    const rs::i32* npcSize,
    const rs::i32* npcIsClickable,
    const rs::i32* npcRotationSpeed,
    const rs::i32* idleSeqId,
    const rs::i32* walkSeqId,
    rs::i32 entityCount,
    rs::i32 tickCount) {
    if (!inOutX || !inOutY || !inOutOrientation || !inOutRotation || !inOutPathLength ||
        !inOutMovementSeqId || !pathXPacked || !pathYPacked || !pathMovementTypePacked ||
        !npcSize || !npcIsClickable || !npcRotationSpeed || !idleSeqId || !walkSeqId) {
        return -1;
    }
    if (entityCount < 0 || tickCount < 0 ||
        pathXPackedLength < 0 || pathYPackedLength < 0 || pathMovementTypePackedLength < 0) {
        return -1;
    }
    const rs::i32 requiredPathLength = entityCount * RS_NPC_PATH_QUEUE_LEN;
    if (pathXPackedLength < requiredPathLength ||
        pathYPackedLength < requiredPathLength ||
        pathMovementTypePackedLength < requiredPathLength) {
        return -2;
    }

    for (rs::i32 i = 0; i < entityCount; i++) {
        rs::i32 x = inOutX[i];
        rs::i32 y = inOutY[i];
        rs::i32 orientation = inOutOrientation[i];
        rs::i32 rotation = inOutRotation[i];
        rs::i32 pathLength = inOutPathLength[i];
        rs::i32 movementSeqId = inOutMovementSeqId[i];
        const rs::i32* pathX = pathXPacked + i * RS_NPC_PATH_QUEUE_LEN;
        const rs::i32* pathY = pathYPacked + i * RS_NPC_PATH_QUEUE_LEN;
        const rs::i32* pathMovementType = pathMovementTypePacked + i * RS_NPC_PATH_QUEUE_LEN;

        for (rs::i32 t = 0; t < tickCount; t++) {
            advanceNpcMovementTransformOne(
                x,
                y,
                orientation,
                rotation,
                pathLength,
                movementSeqId,
                pathX,
                pathY,
                pathMovementType,
                npcSize[i],
                npcIsClickable[i] != 0,
                npcRotationSpeed[i],
                idleSeqId[i],
                walkSeqId[i]);
        }

        inOutX[i] = x;
        inOutY[i] = y;
        inOutOrientation[i] = orientation;
        inOutRotation[i] = rotation;
        inOutPathLength[i] = pathLength;
        inOutMovementSeqId[i] = movementSeqId;
    }

    return 1;
}

static void advanceNpcSeqOneTick(
    rs::i32& frame,
    rs::i32& frameTick,
    rs::i32& movementLoop,
    const bool seqValid,
    const bool hasAnimMayaSeq,
    const rs::i32 animMayaDuration,
    const rs::i32 frameStep,
    const bool looping,
    const rs::i32 maxLoops,
    const rs::i32 frameIdCount,
    const rs::i32 frameLengthOffset,
    const rs::i32 frameLengthCount,
    const rs::i32* frameLengthsPacked,
    const rs::i32 frameLengthsPackedLength) {
    if (!seqValid) {
        return;
    }
    if (!hasAnimMayaSeq && frameLengthCount > 0) {
        frameTick++;
        if (frame < frameLengthCount &&
            frameTick > frameLengthAt(
                frameLengthsPacked,
                frameLengthsPackedLength,
                frameLengthOffset,
                frame)) {
            frameTick = 1;
            frame++;
        }

        if (frame >= frameLengthCount) {
            if (frameStep > 0) {
                frame -= frameStep;
                if (looping) {
                    movementLoop++;
                }
                if (frame < 0 ||
                    frame >= frameIdCount ||
                    (looping && movementLoop >= maxLoops)) {
                    frameTick = 0;
                    frame = 0;
                    movementLoop = 0;
                } else {
                    frameTick = 0;
                    frame = 0;
                }
            } else {
                frameTick = 0;
                frame = 0;
            }
        }
    } else if (hasAnimMayaSeq) {
        frame++;
        if (frame >= animMayaDuration) {
            if (frameStep > 0) {
                frame -= frameStep;
                if (looping) {
                    movementLoop++;
                }
                if (frame < 0 ||
                    frame >= frameIdCount ||
                    (looping && movementLoop >= maxLoops)) {
                    frameTick = 0;
                    frame = 0;
                    movementLoop = 0;
                } else {
                    frameTick = 0;
                    frame = 0;
                }
            } else {
                frameTick = 0;
                frame = 0;
            }
        }
    }
}

static rs::i32 emitNpcPatchesFromSelectedFrames(
    const rs::i32* frameIds,
    const rs::i32* movementSeqId,
    const rs::i32* hasWalkAnim,
    const rs::i32* walkSeqId,
    const rs::i32* drawRangeIndices,
    const rs::i32* idleAnimFrameOffsets,
    const rs::i32* idleAnimFrameCounts,
    const rs::i32* walkAnimFrameOffsets,
    const rs::i32* walkAnimFrameCounts,
    const rs::i32* animFramesPacked,
    const rs::i32 animFramesPackedLength,
    const bool useNullFallbackWhenMissing,
    const rs::i32 nullFallbackOffset,
    const rs::i32 nullFallbackCount,
    const rs::i32 entityCount,
    rs::i32* outPatchesPacked,
    const rs::i32 outPatchesPackedLength) {
    if (!outPatchesPacked || outPatchesPackedLength < entityCount * 4) {
        return -2;
    }
    if (animFramesPackedLength > 0 && !animFramesPacked) {
        return -1;
    }

    rs::i32 patchCount = 0;
    for (rs::i32 i = 0; i < entityCount; i++) {
        const rs::i32 drawRangeIndex = drawRangeIndices[i];
        if (drawRangeIndex < 0) {
            continue;
        }

        const bool useWalk = hasWalkAnim[i] != 0 && movementSeqId[i] == walkSeqId[i];
        rs::i32 frameOffsetBase = useWalk
            ? walkAnimFrameOffsets[i]
            : idleAnimFrameOffsets[i];
        rs::i32 frameCount = useWalk
            ? walkAnimFrameCounts[i]
            : idleAnimFrameCounts[i];

        if (useNullFallbackWhenMissing && (frameOffsetBase < 0 || frameCount <= 0)) {
            frameOffsetBase = nullFallbackOffset;
            frameCount = nullFallbackCount;
        }
        if (frameOffsetBase < 0 || frameCount <= 0) {
            continue;
        }

        const rs::i32 frameId = frameIds[i];
        if (frameId < 0 || frameId >= frameCount) {
            continue;
        }
        const rs::i32 frameOffset = frameOffsetBase + frameId * 3;
        if (frameOffset < 0 || frameOffset + 2 >= animFramesPackedLength) {
            return -2;
        }
        const rs::i32 outPatchOffset = patchCount * 4;
        outPatchesPacked[outPatchOffset + 0] = drawRangeIndex;
        outPatchesPacked[outPatchOffset + 1] = animFramesPacked[frameOffset + 0];
        outPatchesPacked[outPatchOffset + 2] = animFramesPacked[frameOffset + 1];
        outPatchesPacked[outPatchOffset + 3] = animFramesPacked[frameOffset + 2];
        patchCount++;
    }
    return patchCount;
}

