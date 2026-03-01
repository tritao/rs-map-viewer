import type { SeqType } from "../../rs/config/seqtype/SeqType";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { DrawRange } from "../../renderer/DrawRange";
import type { LocAnimated } from "../entities/LocAnimated";
import type { Npc } from "../entities/Npc";
import { LOC_CYCLE_SCALE } from "../../wasm/LocCycle";
import type { DrawRangeTickStateInput } from "../../wasm/DrawRangeTickState";
import type {
    TsTickCapability,
    WasmTickCapability,
    TickPatchBackendResult,
} from "../contracts/TickCapability";

const DRAW_RANGE_STRIDE = 3;
const DRAW_RANGE_OFFSET_INDEX = 0;
const DRAW_RANGE_ELEMENTS_INDEX = 1;
const DRAW_RANGE_INSTANCES_INDEX = 2;

export class MapSquareTickState implements TsTickCapability, WasmTickCapability {
    constructor(readonly id: number) {}

    private locsAnimated: LocAnimated[] = [];
    private npcs: Npc[] = [];
    locFrameIds = new Int32Array(0);
    locDrawRangeIndicesBase = new Int32Array(0);
    locDrawRangeIndicesAlpha = new Int32Array(0);
    locDrawRangeIndicesLod = new Int32Array(0);
    locDrawRangeIndicesLodAlpha = new Int32Array(0);
    locDrawRangeIndicesInteract = new Int32Array(0);
    locDrawRangeIndicesInteractAlpha = new Int32Array(0);
    locDrawRangeIndicesInteractLod = new Int32Array(0);
    locDrawRangeIndicesInteractLodAlpha = new Int32Array(0);
    locAnimFrameOffsetsBase = new Int32Array(0);
    locAnimFrameCountsBase = new Int32Array(0);
    locAnimFramesBasePacked = new Int32Array(0);
    locAnimFrameOffsetsAlpha = new Int32Array(0);
    locAnimFrameCountsAlpha = new Int32Array(0);
    locAnimFramesAlphaPacked = new Int32Array(0);
    locCycleStartsFixed = new Int32Array(0);
    locSeqFrameSteps = new Int32Array(0);
    locSeqHasAnimMaya = new Int32Array(0);
    locSeqAnimMayaDurations = new Int32Array(0);
    locSeqFrameLengthOffsets = new Int32Array(0);
    locSeqFrameLengthCounts = new Int32Array(0);
    locSeqFrameLengthsPacked = new Int32Array(0);
    locSeqIds = new Int32Array(0);
    locSeqActiveFlags = new Int32Array(0);
    locTickPatchesByVariant: Int32Array[] = new Array<Int32Array>(8);

    npcDrawRangeIndices = new Int32Array(0);
    npcX = new Int32Array(0);
    npcY = new Int32Array(0);
    npcOrientation = new Int32Array(0);
    npcRotation = new Int32Array(0);
    npcPathLength = new Int32Array(0);
    npcMovementSeqId = new Int32Array(0);
    npcPathXPacked = new Int32Array(0);
    npcPathYPacked = new Int32Array(0);
    npcPathMovementTypePacked = new Int32Array(0);
    npcSize = new Int32Array(0);
    npcIsClickable = new Int32Array(0);
    npcRotationSpeed = new Int32Array(0);
    npcIdleSeqId = new Int32Array(0);
    npcWalkSeqId = new Int32Array(0);
    npcHasWalkAnim = new Int32Array(0);
    npcFrameIds = new Int32Array(0);
    npcFrameTicks = new Int32Array(0);
    npcMovementLoops = new Int32Array(0);
    npcSelectedAnimFrameOffsets = new Int32Array(0);
    npcSelectedAnimFrameCounts = new Int32Array(0);
    npcIdleFrameOffsetsBase = new Int32Array(0);
    npcIdleFrameCountsBase = new Int32Array(0);
    npcWalkFrameOffsetsBase = new Int32Array(0);
    npcWalkFrameCountsBase = new Int32Array(0);
    npcAnimFramesBasePacked = new Int32Array(0);
    npcIdleFrameOffsetsAlpha = new Int32Array(0);
    npcIdleFrameCountsAlpha = new Int32Array(0);
    npcWalkFrameOffsetsAlpha = new Int32Array(0);
    npcWalkFrameCountsAlpha = new Int32Array(0);
    npcAnimFramesAlphaPacked = new Int32Array(0);
    npcNullAlphaFrameOffset = 0;
    npcIdleSeqValid = new Int32Array(0);
    npcIdleSeqHasAnimMaya = new Int32Array(0);
    npcIdleSeqAnimMayaDurations = new Int32Array(0);
    npcIdleSeqFrameSteps = new Int32Array(0);
    npcIdleSeqLooping = new Int32Array(0);
    npcIdleSeqMaxLoops = new Int32Array(0);
    npcIdleSeqFrameIdCounts = new Int32Array(0);
    npcIdleSeqFrameLengthOffsets = new Int32Array(0);
    npcIdleSeqFrameLengthCounts = new Int32Array(0);
    npcWalkSeqValid = new Int32Array(0);
    npcWalkSeqHasAnimMaya = new Int32Array(0);
    npcWalkSeqAnimMayaDurations = new Int32Array(0);
    npcWalkSeqFrameSteps = new Int32Array(0);
    npcWalkSeqLooping = new Int32Array(0);
    npcWalkSeqMaxLoops = new Int32Array(0);
    npcWalkSeqFrameIdCounts = new Int32Array(0);
    npcWalkSeqFrameLengthOffsets = new Int32Array(0);
    npcWalkSeqFrameLengthCounts = new Int32Array(0);
    npcSelectedSeqValid = new Int32Array(0);
    npcSelectedSeqHasAnimMaya = new Int32Array(0);
    npcSelectedSeqAnimMayaDurations = new Int32Array(0);
    npcSelectedSeqFrameSteps = new Int32Array(0);
    npcSelectedSeqLooping = new Int32Array(0);
    npcSelectedSeqMaxLoops = new Int32Array(0);
    npcSelectedSeqFrameIdCounts = new Int32Array(0);
    npcSelectedSeqFrameLengthOffsets = new Int32Array(0);
    npcSelectedSeqFrameLengthCounts = new Int32Array(0);
    npcSeqFrameLengthsPacked = new Int32Array(0);
    npcTickPatchesByVariant: Int32Array[] = [new Int32Array(0), new Int32Array(0)];
    private cppTickStateInitialized = false;

    setLocsAnimated(locsAnimated: LocAnimated[]): void {
        this.locsAnimated = locsAnimated;
    }

    setNpcs(npcs: Npc[]): void {
        this.npcs = npcs;
    }

    private static appendAnimationFramesPacked(
        packed: number[],
        frames: readonly DrawRange[] | undefined,
    ): { offset: number; count: number } {
        if (!frames || frames.length === 0) {
            return {
                offset: -1,
                count: 0,
            };
        }
        const offset = packed.length;
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            packed.push(
                frame[DRAW_RANGE_OFFSET_INDEX] | 0,
                frame[DRAW_RANGE_ELEMENTS_INDEX] | 0,
                frame[DRAW_RANGE_INSTANCES_INDEX] | 0,
            );
        }
        return {
            offset,
            count: frames.length | 0,
        };
    }

    private static appendSeqFrameLengthsPacked(
        packed: number[],
        seqType: SeqType | undefined,
        seqFrameLoader: SeqFrameLoader,
    ): { offset: number; count: number } {
        if (!seqType?.frameIds || seqType.frameIds.length === 0) {
            return {
                offset: -1,
                count: 0,
            };
        }
        const offset = packed.length;
        for (let i = 0; i < seqType.frameIds.length; i++) {
            packed.push(seqType.getFrameLength(seqFrameLoader, i) | 0);
        }
        return {
            offset,
            count: seqType.frameIds.length | 0,
        };
    }

    initLocAnimationPatchData(seqFrameLoader: SeqFrameLoader, seqIds: number[]): void {
        const count = this.locsAnimated.length | 0;
        this.locFrameIds = new Int32Array(count);
        this.locCycleStartsFixed = new Int32Array(count);
        this.locSeqFrameSteps = new Int32Array(count);
        this.locSeqHasAnimMaya = new Int32Array(count);
        this.locSeqAnimMayaDurations = new Int32Array(count);
        this.locSeqFrameLengthOffsets = new Int32Array(count);
        this.locSeqFrameLengthCounts = new Int32Array(count);
        this.locSeqFrameLengthsPacked = new Int32Array(0);
        this.locSeqIds = Int32Array.from(seqIds);
        this.locSeqActiveFlags = new Int32Array(count);

        this.locDrawRangeIndicesBase = new Int32Array(count);
        this.locDrawRangeIndicesAlpha = new Int32Array(count);
        this.locDrawRangeIndicesLod = new Int32Array(count);
        this.locDrawRangeIndicesLodAlpha = new Int32Array(count);
        this.locDrawRangeIndicesInteract = new Int32Array(count);
        this.locDrawRangeIndicesInteractAlpha = new Int32Array(count);
        this.locDrawRangeIndicesInteractLod = new Int32Array(count);
        this.locDrawRangeIndicesInteractLodAlpha = new Int32Array(count);

        this.locAnimFrameOffsetsBase = new Int32Array(count);
        this.locAnimFrameCountsBase = new Int32Array(count);
        this.locAnimFrameOffsetsAlpha = new Int32Array(count);
        this.locAnimFrameCountsAlpha = new Int32Array(count);

        const basePacked: number[] = [];
        const alphaPacked: number[] = [];
        const seqFrameLengthsPacked: number[] = [];
        for (let i = 0; i < count; i++) {
            const loc = this.locsAnimated[i];
            this.locFrameIds[i] = loc.frame | 0;
            this.locCycleStartsFixed[i] = Math.round(loc.cycleStart * LOC_CYCLE_SCALE) | 0;
            this.locSeqActiveFlags[i] = loc.seqType ? 1 : 0;
            this.locSeqFrameSteps[i] = loc.seqType?.frameStep ?? -1;
            this.locSeqHasAnimMaya[i] = (loc.seqType?.animMayaId ?? -1) >= 0 ? 1 : 0;
            this.locSeqAnimMayaDurations[i] =
                ((loc.seqType?.animMayaEnd ?? 0) - (loc.seqType?.animMayaStart ?? 0)) | 0;

            const frameLengthMeta = MapSquareTickState.appendSeqFrameLengthsPacked(
                seqFrameLengthsPacked,
                loc.seqType,
                seqFrameLoader,
            );
            this.locSeqFrameLengthOffsets[i] = frameLengthMeta.offset | 0;
            this.locSeqFrameLengthCounts[i] = frameLengthMeta.count | 0;

            this.locDrawRangeIndicesBase[i] = loc.drawRangeIndex | 0;
            this.locDrawRangeIndicesAlpha[i] = loc.drawRangeAlphaIndex | 0;
            this.locDrawRangeIndicesLod[i] = loc.drawRangeLodIndex | 0;
            this.locDrawRangeIndicesLodAlpha[i] = loc.drawRangeLodAlphaIndex | 0;
            this.locDrawRangeIndicesInteract[i] = loc.drawRangeInteractIndex | 0;
            this.locDrawRangeIndicesInteractAlpha[i] = loc.drawRangeInteractAlphaIndex | 0;
            this.locDrawRangeIndicesInteractLod[i] = loc.drawRangeInteractLodIndex | 0;
            this.locDrawRangeIndicesInteractLodAlpha[i] = loc.drawRangeInteractLodAlphaIndex | 0;

            const baseMeta = MapSquareTickState.appendAnimationFramesPacked(
                basePacked,
                loc.anim.frames,
            );
            this.locAnimFrameOffsetsBase[i] = baseMeta.offset | 0;
            this.locAnimFrameCountsBase[i] = baseMeta.count | 0;

            const alphaMeta = MapSquareTickState.appendAnimationFramesPacked(
                alphaPacked,
                loc.anim.framesAlpha,
            );
            this.locAnimFrameOffsetsAlpha[i] = alphaMeta.offset | 0;
            this.locAnimFrameCountsAlpha[i] = alphaMeta.count | 0;
        }

        this.locSeqFrameLengthsPacked = Int32Array.from(seqFrameLengthsPacked);
        this.locAnimFramesBasePacked = Int32Array.from(basePacked);
        this.locAnimFramesAlphaPacked = Int32Array.from(alphaPacked);
        this.locTickPatchesByVariant = new Array<Int32Array>(8);
        for (let i = 0; i < 8; i++) {
            this.locTickPatchesByVariant[i] = new Int32Array(count * 4);
        }
    }

    syncLocAnimationFrameIds(): void {
        for (let i = 0; i < this.locsAnimated.length; i++) {
            this.locFrameIds[i] = this.locsAnimated[i].frame | 0;
        }
    }

    private syncLocAnimationStateFromObjects(): void {
        for (let i = 0; i < this.locsAnimated.length; i++) {
            const loc = this.locsAnimated[i];
            this.locFrameIds[i] = loc.frame | 0;
            this.locCycleStartsFixed[i] = Math.round(loc.cycleStart * LOC_CYCLE_SCALE) | 0;
            this.locSeqActiveFlags[i] = loc.seqType ? 1 : 0;
        }
    }

    ensureCppTickStateInitializedFromObjects(): boolean {
        if (this.cppTickStateInitialized) {
            return false;
        }
        this.syncLocAnimationStateFromObjects();
        this.syncNpcFrameStateFromObjects();
        this.cppTickStateInitialized = true;
        return true;
    }

    resetCppTickStateLifecycle(): void {
        this.cppTickStateInitialized = false;
    }

    private applyLocAnimationStateToObjects(): void {
        for (let i = 0; i < this.locsAnimated.length; i++) {
            const loc = this.locsAnimated[i];
            loc.frame = this.locFrameIds[i] | 0;
            loc.cycleStart = (this.locCycleStartsFixed[i] | 0) / LOC_CYCLE_SCALE;
            if (this.locSeqActiveFlags[i] === 0) {
                loc.seqType = undefined;
            }
        }
    }

    getLocDrawRangeIndicesForPass(
        isAlpha: boolean,
        isInteract: boolean,
        isLod: boolean,
    ): Int32Array {
        if (isInteract) {
            if (isLod) {
                return isAlpha
                    ? this.locDrawRangeIndicesInteractLodAlpha
                    : this.locDrawRangeIndicesInteractLod;
            }
            return isAlpha
                ? this.locDrawRangeIndicesInteractAlpha
                : this.locDrawRangeIndicesInteract;
        }
        if (isLod) {
            return isAlpha ? this.locDrawRangeIndicesLodAlpha : this.locDrawRangeIndicesLod;
        }
        return isAlpha ? this.locDrawRangeIndicesAlpha : this.locDrawRangeIndicesBase;
    }

    initNpcAnimationPatchData(
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        packetDrawRangesBase?: Int32Array,
        packetDrawRangesAlpha?: Int32Array,
    ): void {
        const count = this.npcs.length | 0;
        this.npcDrawRangeIndices = new Int32Array(count);
        this.npcX = new Int32Array(count);
        this.npcY = new Int32Array(count);
        this.npcOrientation = new Int32Array(count);
        this.npcRotation = new Int32Array(count);
        this.npcPathLength = new Int32Array(count);
        this.npcMovementSeqId = new Int32Array(count);
        this.npcPathXPacked = new Int32Array(count * 10);
        this.npcPathYPacked = new Int32Array(count * 10);
        this.npcPathMovementTypePacked = new Int32Array(count * 10);
        this.npcSize = new Int32Array(count);
        this.npcIsClickable = new Int32Array(count);
        this.npcRotationSpeed = new Int32Array(count);
        this.npcIdleSeqId = new Int32Array(count);
        this.npcWalkSeqId = new Int32Array(count);
        this.npcHasWalkAnim = new Int32Array(count);
        this.npcFrameIds = new Int32Array(count);
        this.npcFrameTicks = new Int32Array(count);
        this.npcMovementLoops = new Int32Array(count);
        this.npcSelectedAnimFrameOffsets = new Int32Array(count);
        this.npcSelectedAnimFrameCounts = new Int32Array(count);
        this.npcSelectedSeqValid = new Int32Array(count);
        this.npcSelectedSeqHasAnimMaya = new Int32Array(count);
        this.npcSelectedSeqAnimMayaDurations = new Int32Array(count);
        this.npcSelectedSeqFrameSteps = new Int32Array(count);
        this.npcSelectedSeqLooping = new Int32Array(count);
        this.npcSelectedSeqMaxLoops = new Int32Array(count);
        this.npcSelectedSeqFrameIdCounts = new Int32Array(count);
        this.npcSelectedSeqFrameLengthOffsets = new Int32Array(count);
        this.npcSelectedSeqFrameLengthCounts = new Int32Array(count);

        this.npcIdleFrameOffsetsBase = new Int32Array(count);
        this.npcIdleFrameCountsBase = new Int32Array(count);
        this.npcWalkFrameOffsetsBase = new Int32Array(count);
        this.npcWalkFrameCountsBase = new Int32Array(count);
        this.npcIdleFrameOffsetsAlpha = new Int32Array(count);
        this.npcIdleFrameCountsAlpha = new Int32Array(count);
        this.npcWalkFrameOffsetsAlpha = new Int32Array(count);
        this.npcWalkFrameCountsAlpha = new Int32Array(count);
        this.npcIdleSeqValid = new Int32Array(count);
        this.npcIdleSeqHasAnimMaya = new Int32Array(count);
        this.npcIdleSeqAnimMayaDurations = new Int32Array(count);
        this.npcIdleSeqFrameSteps = new Int32Array(count);
        this.npcIdleSeqLooping = new Int32Array(count);
        this.npcIdleSeqMaxLoops = new Int32Array(count);
        this.npcIdleSeqFrameIdCounts = new Int32Array(count);
        this.npcIdleSeqFrameLengthOffsets = new Int32Array(count);
        this.npcIdleSeqFrameLengthCounts = new Int32Array(count);
        this.npcWalkSeqValid = new Int32Array(count);
        this.npcWalkSeqHasAnimMaya = new Int32Array(count);
        this.npcWalkSeqAnimMayaDurations = new Int32Array(count);
        this.npcWalkSeqFrameSteps = new Int32Array(count);
        this.npcWalkSeqLooping = new Int32Array(count);
        this.npcWalkSeqMaxLoops = new Int32Array(count);
        this.npcWalkSeqFrameIdCounts = new Int32Array(count);
        this.npcWalkSeqFrameLengthOffsets = new Int32Array(count);
        this.npcWalkSeqFrameLengthCounts = new Int32Array(count);

        const basePacked: number[] = [];
        const alphaPacked: number[] = [0, 0, 0];
        const seqFrameLengthsPacked: number[] = [];
        this.npcNullAlphaFrameOffset = 0;

        const hasPacketBaseRanges =
            packetDrawRangesBase instanceof Int32Array &&
            packetDrawRangesBase.length >= count * DRAW_RANGE_STRIDE;
        const hasPacketAlphaRanges =
            packetDrawRangesAlpha instanceof Int32Array &&
            packetDrawRangesAlpha.length >= count * DRAW_RANGE_STRIDE;

        for (let i = 0; i < count; i++) {
            this.npcDrawRangeIndices[i] = i | 0;
            const npc = this.npcs[i];
            this.npcX[i] = npc.x | 0;
            this.npcY[i] = npc.y | 0;
            this.npcOrientation[i] = npc.orientation | 0;
            this.npcRotation[i] = npc.rotation | 0;
            this.npcPathLength[i] = npc.pathLength | 0;
            this.npcMovementSeqId[i] = npc.movementSeqId | 0;
            this.npcSize[i] = npc.getSize() | 0;
            this.npcIsClickable[i] = npc.npcType.isClickable ? 1 : 0;
            this.npcRotationSpeed[i] = npc.npcType.rotationSpeed | 0;
            this.npcIdleSeqId[i] = npc.idleSeqId | 0;
            this.npcWalkSeqId[i] = npc.walkSeqId | 0;
            this.npcHasWalkAnim[i] =
                npc.walkSeqId !== -1 && npc.walkSeqId !== npc.idleSeqId ? 1 : 0;
            const pathBase = i * 10;
            for (let p = 0; p < 10; p++) {
                this.npcPathXPacked[pathBase + p] = npc.pathX[p] | 0;
                this.npcPathYPacked[pathBase + p] = npc.pathY[p] | 0;
                this.npcPathMovementTypePacked[pathBase + p] = npc.pathMovementType[p] | 0;
            }
            this.npcFrameIds[i] = npc.movementFrame | 0;
            this.npcFrameTicks[i] = npc.movementFrameTick | 0;
            this.npcMovementLoops[i] = npc.movementLoop | 0;
            if (hasPacketBaseRanges) {
                const rangeOff = i * DRAW_RANGE_STRIDE;
                const idleBaseOffset = basePacked.length;
                basePacked.push(
                    packetDrawRangesBase![rangeOff + DRAW_RANGE_OFFSET_INDEX] | 0,
                    packetDrawRangesBase![rangeOff + DRAW_RANGE_ELEMENTS_INDEX] | 0,
                    packetDrawRangesBase![rangeOff + DRAW_RANGE_INSTANCES_INDEX] | 0,
                );
                this.npcIdleFrameOffsetsBase[i] = idleBaseOffset | 0;
                this.npcIdleFrameCountsBase[i] = 1;
                this.npcWalkFrameOffsetsBase[i] = idleBaseOffset | 0;
                this.npcWalkFrameCountsBase[i] = 1;

                if (hasPacketAlphaRanges) {
                    const idleAlphaOffset = alphaPacked.length;
                    alphaPacked.push(
                        packetDrawRangesAlpha![rangeOff + DRAW_RANGE_OFFSET_INDEX] | 0,
                        packetDrawRangesAlpha![rangeOff + DRAW_RANGE_ELEMENTS_INDEX] | 0,
                        packetDrawRangesAlpha![rangeOff + DRAW_RANGE_INSTANCES_INDEX] | 0,
                    );
                    this.npcIdleFrameOffsetsAlpha[i] = idleAlphaOffset | 0;
                    this.npcIdleFrameCountsAlpha[i] = 1;
                    this.npcWalkFrameOffsetsAlpha[i] = idleAlphaOffset | 0;
                    this.npcWalkFrameCountsAlpha[i] = 1;
                } else {
                    this.npcIdleFrameOffsetsAlpha[i] = this.npcNullAlphaFrameOffset;
                    this.npcIdleFrameCountsAlpha[i] = 1;
                    this.npcWalkFrameOffsetsAlpha[i] = this.npcNullAlphaFrameOffset;
                    this.npcWalkFrameCountsAlpha[i] = 1;
                }
            } else {
                const idleBase = MapSquareTickState.appendAnimationFramesPacked(
                    basePacked,
                    npc.idleAnim?.frames,
                );
                this.npcIdleFrameOffsetsBase[i] = idleBase.offset | 0;
                this.npcIdleFrameCountsBase[i] = idleBase.count | 0;

                const walkBase = MapSquareTickState.appendAnimationFramesPacked(
                    basePacked,
                    npc.walkAnim?.frames,
                );
                this.npcWalkFrameOffsetsBase[i] = walkBase.offset | 0;
                this.npcWalkFrameCountsBase[i] = walkBase.count | 0;

                const idleAlpha = MapSquareTickState.appendAnimationFramesPacked(
                    alphaPacked,
                    npc.idleAnim?.framesAlpha,
                );
                this.npcIdleFrameOffsetsAlpha[i] = idleAlpha.offset | 0;
                this.npcIdleFrameCountsAlpha[i] = idleAlpha.count | 0;

                const walkAlpha = MapSquareTickState.appendAnimationFramesPacked(
                    alphaPacked,
                    npc.walkAnim?.framesAlpha,
                );
                this.npcWalkFrameOffsetsAlpha[i] = walkAlpha.offset | 0;
                this.npcWalkFrameCountsAlpha[i] = walkAlpha.count | 0;
            }

            const idleSeq = npc.idleSeqId >= 0 ? seqTypeLoader.tryLoad(npc.idleSeqId) : undefined;
            const idleSeqType = idleSeq?.ok ? idleSeq.value : undefined;
            this.npcIdleSeqValid[i] = idleSeqType ? 1 : 0;
            this.npcIdleSeqHasAnimMaya[i] = idleSeqType?.hasAnimMayaSeq() ? 1 : 0;
            this.npcIdleSeqAnimMayaDurations[i] = idleSeqType?.getAnimMayaDuration() ?? 0;
            this.npcIdleSeqFrameSteps[i] = idleSeqType?.frameStep ?? -1;
            this.npcIdleSeqLooping[i] = idleSeqType?.looping ? 1 : 0;
            this.npcIdleSeqMaxLoops[i] = idleSeqType?.maxLoops ?? 0;
            this.npcIdleSeqFrameIdCounts[i] = idleSeqType?.frameIds?.length ?? 0;
            const idleSeqFramesMeta = MapSquareTickState.appendSeqFrameLengthsPacked(
                seqFrameLengthsPacked,
                idleSeqType,
                seqFrameLoader,
            );
            this.npcIdleSeqFrameLengthOffsets[i] = idleSeqFramesMeta.offset | 0;
            this.npcIdleSeqFrameLengthCounts[i] = idleSeqFramesMeta.count | 0;

            const walkSeq = npc.walkSeqId >= 0 ? seqTypeLoader.tryLoad(npc.walkSeqId) : undefined;
            const walkSeqType = walkSeq?.ok ? walkSeq.value : undefined;
            this.npcWalkSeqValid[i] = walkSeqType ? 1 : 0;
            this.npcWalkSeqHasAnimMaya[i] = walkSeqType?.hasAnimMayaSeq() ? 1 : 0;
            this.npcWalkSeqAnimMayaDurations[i] = walkSeqType?.getAnimMayaDuration() ?? 0;
            this.npcWalkSeqFrameSteps[i] = walkSeqType?.frameStep ?? -1;
            this.npcWalkSeqLooping[i] = walkSeqType?.looping ? 1 : 0;
            this.npcWalkSeqMaxLoops[i] = walkSeqType?.maxLoops ?? 0;
            this.npcWalkSeqFrameIdCounts[i] = walkSeqType?.frameIds?.length ?? 0;
            const walkSeqFramesMeta = MapSquareTickState.appendSeqFrameLengthsPacked(
                seqFrameLengthsPacked,
                walkSeqType,
                seqFrameLoader,
            );
            this.npcWalkSeqFrameLengthOffsets[i] = walkSeqFramesMeta.offset | 0;
            this.npcWalkSeqFrameLengthCounts[i] = walkSeqFramesMeta.count | 0;
        }

        this.npcAnimFramesBasePacked = Int32Array.from(basePacked);
        this.npcAnimFramesAlphaPacked = Int32Array.from(alphaPacked);
        this.npcSeqFrameLengthsPacked = Int32Array.from(seqFrameLengthsPacked);
        this.npcTickPatchesByVariant = [new Int32Array(count * 4), new Int32Array(count * 4)];
    }

    syncNpcAnimationSelection(isAlpha: boolean): void {
        for (let i = 0; i < this.npcs.length; i++) {
            const npc = this.npcs[i];
            this.npcFrameIds[i] = npc.movementFrame | 0;
            const useWalk = npc.walkSeqId !== -1 && npc.movementSeqId === npc.walkSeqId;
            if (!isAlpha) {
                this.npcSelectedAnimFrameOffsets[i] = useWalk
                    ? this.npcWalkFrameOffsetsBase[i]
                    : this.npcIdleFrameOffsetsBase[i];
                this.npcSelectedAnimFrameCounts[i] = useWalk
                    ? this.npcWalkFrameCountsBase[i]
                    : this.npcIdleFrameCountsBase[i];
                continue;
            }

            let selectedOffset = useWalk
                ? this.npcWalkFrameOffsetsAlpha[i]
                : this.npcIdleFrameOffsetsAlpha[i];
            let selectedCount = useWalk
                ? this.npcWalkFrameCountsAlpha[i]
                : this.npcIdleFrameCountsAlpha[i];
            if (selectedOffset < 0 || selectedCount <= 0) {
                selectedOffset = this.npcNullAlphaFrameOffset;
                selectedCount = 1;
            }
            this.npcSelectedAnimFrameOffsets[i] = selectedOffset;
            this.npcSelectedAnimFrameCounts[i] = selectedCount;
        }
    }

    private syncNpcFrameStateFromObjects(): void {
        for (let i = 0; i < this.npcs.length; i++) {
            const npc = this.npcs[i];
            this.npcX[i] = npc.x | 0;
            this.npcY[i] = npc.y | 0;
            this.npcOrientation[i] = npc.orientation | 0;
            this.npcRotation[i] = npc.rotation | 0;
            this.npcPathLength[i] = npc.pathLength | 0;
            this.npcMovementSeqId[i] = npc.movementSeqId | 0;
            this.npcFrameIds[i] = npc.movementFrame | 0;
            this.npcFrameTicks[i] = npc.movementFrameTick | 0;
            this.npcMovementLoops[i] = npc.movementLoop | 0;
        }
    }

    syncNpcMovementStateFromObjects(): void {
        for (let i = 0; i < this.npcs.length; i++) {
            const npc = this.npcs[i];
            this.npcX[i] = npc.x | 0;
            this.npcY[i] = npc.y | 0;
            this.npcOrientation[i] = npc.orientation | 0;
            this.npcRotation[i] = npc.rotation | 0;
            this.npcPathLength[i] = npc.pathLength | 0;
            this.npcMovementSeqId[i] = npc.movementSeqId | 0;
        }
    }

    syncNpcPathStateFromObjects(): void {
        for (let i = 0; i < this.npcs.length; i++) {
            const npc = this.npcs[i];
            const pathBase = i * 10;
            for (let p = 0; p < 10; p++) {
                this.npcPathXPacked[pathBase + p] = npc.pathX[p] | 0;
                this.npcPathYPacked[pathBase + p] = npc.pathY[p] | 0;
                this.npcPathMovementTypePacked[pathBase + p] = npc.pathMovementType[p] | 0;
            }
        }
    }

    syncNpcSequenceSelectionForUpdate(): void {
        for (let i = 0; i < this.npcs.length; i++) {
            const npc = this.npcs[i];
            this.npcFrameIds[i] = npc.movementFrame | 0;
            this.npcFrameTicks[i] = npc.movementFrameTick | 0;
            this.npcMovementLoops[i] = npc.movementLoop | 0;

            const useWalk = npc.walkSeqId !== -1 && npc.movementSeqId === npc.walkSeqId;
            if (useWalk) {
                this.npcSelectedSeqValid[i] = this.npcWalkSeqValid[i] | 0;
                this.npcSelectedSeqHasAnimMaya[i] = this.npcWalkSeqHasAnimMaya[i] | 0;
                this.npcSelectedSeqAnimMayaDurations[i] = this.npcWalkSeqAnimMayaDurations[i] | 0;
                this.npcSelectedSeqFrameSteps[i] = this.npcWalkSeqFrameSteps[i] | 0;
                this.npcSelectedSeqLooping[i] = this.npcWalkSeqLooping[i] | 0;
                this.npcSelectedSeqMaxLoops[i] = this.npcWalkSeqMaxLoops[i] | 0;
                this.npcSelectedSeqFrameIdCounts[i] = this.npcWalkSeqFrameIdCounts[i] | 0;
                this.npcSelectedSeqFrameLengthOffsets[i] = this.npcWalkSeqFrameLengthOffsets[i] | 0;
                this.npcSelectedSeqFrameLengthCounts[i] = this.npcWalkSeqFrameLengthCounts[i] | 0;
                continue;
            }
            this.npcSelectedSeqValid[i] = this.npcIdleSeqValid[i] | 0;
            this.npcSelectedSeqHasAnimMaya[i] = this.npcIdleSeqHasAnimMaya[i] | 0;
            this.npcSelectedSeqAnimMayaDurations[i] = this.npcIdleSeqAnimMayaDurations[i] | 0;
            this.npcSelectedSeqFrameSteps[i] = this.npcIdleSeqFrameSteps[i] | 0;
            this.npcSelectedSeqLooping[i] = this.npcIdleSeqLooping[i] | 0;
            this.npcSelectedSeqMaxLoops[i] = this.npcIdleSeqMaxLoops[i] | 0;
            this.npcSelectedSeqFrameIdCounts[i] = this.npcIdleSeqFrameIdCounts[i] | 0;
            this.npcSelectedSeqFrameLengthOffsets[i] = this.npcIdleSeqFrameLengthOffsets[i] | 0;
            this.npcSelectedSeqFrameLengthCounts[i] = this.npcIdleSeqFrameLengthCounts[i] | 0;
        }
    }

    private applyNpcFrameStateToObjects(): void {
        for (let i = 0; i < this.npcs.length; i++) {
            const npc = this.npcs[i];
            npc.x = this.npcX[i] | 0;
            npc.y = this.npcY[i] | 0;
            npc.orientation = this.npcOrientation[i] | 0;
            npc.rotation = this.npcRotation[i] | 0;
            npc.pathLength = this.npcPathLength[i] | 0;
            npc.movementSeqId = this.npcMovementSeqId[i] | 0;
            npc.movementFrame = this.npcFrameIds[i] | 0;
            npc.movementFrameTick = this.npcFrameTicks[i] | 0;
            npc.movementLoop = this.npcMovementLoops[i] | 0;
        }
    }

    getLocsAnimated(): ReadonlyArray<LocAnimated> {
        return this.locsAnimated;
    }

    getLocFrameId(locIndex: number): number {
        return this.locFrameIds[locIndex] | 0;
    }

    setLocFrameId(locIndex: number, frameId: number): void {
        this.locFrameIds[locIndex] = frameId | 0;
    }

    getNpcs(): ReadonlyArray<Npc> {
        return this.npcs;
    }

    getWasmTickStateInput(): DrawRangeTickStateInput {
        return {
            locFrameIds: this.locFrameIds,
            locCycleStartsFixed: this.locCycleStartsFixed,
            locFrameSteps: this.locSeqFrameSteps,
            locHasAnimMaya: this.locSeqHasAnimMaya,
            locAnimMayaDurations: this.locSeqAnimMayaDurations,
            locFrameLengthOffsets: this.locSeqFrameLengthOffsets,
            locFrameLengthCounts: this.locSeqFrameLengthCounts,
            locFrameLengthsPacked: this.locSeqFrameLengthsPacked,
            locSeqIds: this.locSeqIds,
            locOutActiveFlags: this.locSeqActiveFlags,
            locDrawRangeIndicesBase: this.locDrawRangeIndicesBase,
            locAnimFrameOffsetsBase: this.locAnimFrameOffsetsBase,
            locAnimFrameCountsBase: this.locAnimFrameCountsBase,
            locAnimFramesBasePacked: this.locAnimFramesBasePacked,
            outLocPatchesPacked: this.locTickPatchesByVariant[0]!,
            locDrawRangeIndicesAlpha: this.locDrawRangeIndicesAlpha,
            locDrawRangeIndicesLod: this.locDrawRangeIndicesLod,
            locDrawRangeIndicesLodAlpha: this.locDrawRangeIndicesLodAlpha,
            locDrawRangeIndicesInteract: this.locDrawRangeIndicesInteract,
            locDrawRangeIndicesInteractAlpha: this.locDrawRangeIndicesInteractAlpha,
            locDrawRangeIndicesInteractLod: this.locDrawRangeIndicesInteractLod,
            locDrawRangeIndicesInteractLodAlpha: this.locDrawRangeIndicesInteractLodAlpha,
            locAnimFrameOffsetsAlpha: this.locAnimFrameOffsetsAlpha,
            locAnimFrameCountsAlpha: this.locAnimFrameCountsAlpha,
            locAnimFramesAlphaPacked: this.locAnimFramesAlphaPacked,
            outLocAlphaPatchesPacked: this.locTickPatchesByVariant[1]!,
            outLocLodPatchesPacked: this.locTickPatchesByVariant[2]!,
            outLocLodAlphaPatchesPacked: this.locTickPatchesByVariant[3]!,
            outLocInteractPatchesPacked: this.locTickPatchesByVariant[4]!,
            outLocInteractAlphaPatchesPacked: this.locTickPatchesByVariant[5]!,
            outLocInteractLodPatchesPacked: this.locTickPatchesByVariant[6]!,
            outLocInteractLodAlphaPatchesPacked: this.locTickPatchesByVariant[7]!,
            npcX: this.npcX,
            npcY: this.npcY,
            npcOrientation: this.npcOrientation,
            npcRotation: this.npcRotation,
            npcPathLength: this.npcPathLength,
            npcMovementSeqId: this.npcMovementSeqId,
            npcPathXPacked: this.npcPathXPacked,
            npcPathYPacked: this.npcPathYPacked,
            npcPathMovementTypePacked: this.npcPathMovementTypePacked,
            npcSize: this.npcSize,
            npcIsClickable: this.npcIsClickable,
            npcRotationSpeed: this.npcRotationSpeed,
            npcIdleSeqId: this.npcIdleSeqId,
            npcWalkSeqId: this.npcWalkSeqId,
            npcHasWalkAnim: this.npcHasWalkAnim,
            npcFrameIds: this.npcFrameIds,
            npcFrameTicks: this.npcFrameTicks,
            npcMovementLoops: this.npcMovementLoops,
            npcIdleSeqValid: this.npcIdleSeqValid,
            npcIdleSeqHasAnimMaya: this.npcIdleSeqHasAnimMaya,
            npcIdleSeqAnimMayaDurations: this.npcIdleSeqAnimMayaDurations,
            npcIdleSeqFrameSteps: this.npcIdleSeqFrameSteps,
            npcIdleSeqLooping: this.npcIdleSeqLooping,
            npcIdleSeqMaxLoops: this.npcIdleSeqMaxLoops,
            npcIdleSeqFrameIdCounts: this.npcIdleSeqFrameIdCounts,
            npcIdleSeqFrameLengthOffsets: this.npcIdleSeqFrameLengthOffsets,
            npcIdleSeqFrameLengthCounts: this.npcIdleSeqFrameLengthCounts,
            npcWalkSeqValid: this.npcWalkSeqValid,
            npcWalkSeqHasAnimMaya: this.npcWalkSeqHasAnimMaya,
            npcWalkSeqAnimMayaDurations: this.npcWalkSeqAnimMayaDurations,
            npcWalkSeqFrameSteps: this.npcWalkSeqFrameSteps,
            npcWalkSeqLooping: this.npcWalkSeqLooping,
            npcWalkSeqMaxLoops: this.npcWalkSeqMaxLoops,
            npcWalkSeqFrameIdCounts: this.npcWalkSeqFrameIdCounts,
            npcWalkSeqFrameLengthOffsets: this.npcWalkSeqFrameLengthOffsets,
            npcWalkSeqFrameLengthCounts: this.npcWalkSeqFrameLengthCounts,
            npcSeqFrameLengthsPacked: this.npcSeqFrameLengthsPacked,
            npcDrawRangeIndices: this.npcDrawRangeIndices,
            npcIdleAnimFrameOffsetsBase: this.npcIdleFrameOffsetsBase,
            npcIdleAnimFrameCountsBase: this.npcIdleFrameCountsBase,
            npcWalkAnimFrameOffsetsBase: this.npcWalkFrameOffsetsBase,
            npcWalkAnimFrameCountsBase: this.npcWalkFrameCountsBase,
            npcAnimFramesBasePacked: this.npcAnimFramesBasePacked,
            outNpcPatchesPacked: this.npcTickPatchesByVariant[0]!,
            npcIdleAnimFrameOffsetsAlpha: this.npcIdleFrameOffsetsAlpha,
            npcIdleAnimFrameCountsAlpha: this.npcIdleFrameCountsAlpha,
            npcWalkAnimFrameOffsetsAlpha: this.npcWalkFrameOffsetsAlpha,
            npcWalkAnimFrameCountsAlpha: this.npcWalkFrameCountsAlpha,
            npcAnimFramesAlphaPacked: this.npcAnimFramesAlphaPacked,
            npcNullAlphaFrameOffset: this.npcNullAlphaFrameOffset,
            outNpcAlphaPatchesPacked: this.npcTickPatchesByVariant[1]!,
        };
    }

    applyWasmTickResult(_result: TickPatchBackendResult): void {
        this.applyLocAnimationStateToObjects();
        this.applyNpcFrameStateToObjects();
    }
}
