import { vec2 } from "gl-matrix";
import PicoGL, {
    DrawCall,
    App as PicoApp,
    Program,
    Texture,
    UniformBuffer,
    VertexArray,
    VertexBuffer,
} from "picogl";

import { BasTypeLoader } from "../../../rs/config/bastype/BasTypeLoader";
import { NpcTypeLoader } from "../../../rs/config/npctype/NpcTypeLoader";
import { SeqType } from "../../../rs/config/seqtype/SeqType";
import { SeqTypeLoader } from "../../../rs/config/seqtype/SeqTypeLoader";
import { SeqFrameLoader } from "../../../rs/model/seq/SeqFrameLoader";
import { Scene } from "../../../rs/scene/Scene";
import { DrawRange, NULL_DRAW_RANGE } from "../../DrawRange";
import { RenderableType } from "../../Renderer";
import { SdRenderableData } from "../../loader/SdRenderableData";
import { LocAnimated } from "../../loc/LocAnimated";
import { Npc } from "../../npc/Npc";
import { LOC_CYCLE_SCALE } from "../../../wasm/LocCycle";
import { orderByPacketKeys } from "../../npc/orderByPacketKeys";
import type { DrawRangeTickStateInput } from "../../../wasm/DrawRangeTickState";
import type {
    TickCapability,
    TickPatchBackendResult,
} from "../../patch/TickCapability";

const FRAME_RENDER_DELAY = 3;

const DRAW_RANGE_STRIDE = 3;
const DRAW_RANGE_OFFSET_INDEX = 0;
const DRAW_RANGE_ELEMENTS_INDEX = 1;
const DRAW_RANGE_INSTANCES_INDEX = 2;

function createModelInfoTexture(app: PicoApp, data: Uint16Array): Texture {
    return app.createTexture2D(data, 16, Math.max(Math.ceil(data.length / 16 / 4), 1), {
        internalFormat: PicoGL.RGBA16UI,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
    });
}

export type DrawCallRange = {
    drawCall: DrawCall;
    drawRangesPacked: Int32Array;
};

export const enum DrawCallKey {
    Base = 0,
    Alpha = 1,
    Lod = 2,
    LodAlpha = 3,
    Interact = 4,
    InteractAlpha = 5,
    InteractLod = 6,
    InteractLodAlpha = 7,
}

export type CreateDrawCallFunction = (
    program: Program,
    modelInfoTexture: Texture | undefined,
    drawRangesPacked: Int32Array,
    useNpcGeometry?: boolean,
) => DrawCallRange;

export class WebGLRenderable implements TickCapability {
    interleavedBuffer!: VertexBuffer;
    indexBuffer!: VertexBuffer;
    vertexArray!: VertexArray;
    npcInterleavedBuffer?: VertexBuffer;
    npcIndexBuffer?: VertexBuffer;
    npcVertexArray?: VertexArray;

    modelInfoTexture!: Texture;
    modelInfoTextureAlpha!: Texture;

    modelInfoTextureLod!: Texture;
    modelInfoTextureLodAlpha!: Texture;

    modelInfoTextureInteract!: Texture;
    modelInfoTextureInteractAlpha!: Texture;

    modelInfoTextureInteractLod!: Texture;
    modelInfoTextureInteractLodAlpha!: Texture;

    heightMapTexture!: Texture;

    drawCall!: DrawCallRange;
    drawCallAlpha!: DrawCallRange;

    drawCallLod!: DrawCallRange;
    drawCallLodAlpha!: DrawCallRange;

    drawCallInteract!: DrawCallRange;
    drawCallInteractAlpha!: DrawCallRange;

    drawCallInteractLod!: DrawCallRange;
    drawCallInteractLodAlpha!: DrawCallRange;

    drawCallNpc!: DrawCallRange;

    // Animated locs
    locsAnimated!: LocAnimated[];

    // Npcs
    npcs!: Npc[];

    // Loc animation patch data (packed draw ranges)
    locFrameIds!: Int32Array;
    locDrawRangeIndicesBase!: Int32Array;
    locDrawRangeIndicesAlpha!: Int32Array;
    locDrawRangeIndicesLod!: Int32Array;
    locDrawRangeIndicesLodAlpha!: Int32Array;
    locDrawRangeIndicesInteract!: Int32Array;
    locDrawRangeIndicesInteractAlpha!: Int32Array;
    locDrawRangeIndicesInteractLod!: Int32Array;
    locDrawRangeIndicesInteractLodAlpha!: Int32Array;
    locAnimFrameOffsetsBase!: Int32Array;
    locAnimFrameCountsBase!: Int32Array;
    locAnimFramesBasePacked!: Int32Array;
    locAnimFrameOffsetsAlpha!: Int32Array;
    locAnimFrameCountsAlpha!: Int32Array;
    locAnimFramesAlphaPacked!: Int32Array;
    locCycleStartsFixed!: Int32Array;
    locSeqFrameSteps!: Int32Array;
    locSeqHasAnimMaya!: Int32Array;
    locSeqAnimMayaDurations!: Int32Array;
    locSeqFrameLengthOffsets!: Int32Array;
    locSeqFrameLengthCounts!: Int32Array;
    locSeqFrameLengthsPacked!: Int32Array;
    locSeqIds!: Int32Array;
    locSeqActiveFlags!: Int32Array;
    locTickPatchesByVariant!: Int32Array[]; // 8 loc variants in stream order

    // NPC animation patch data (packed draw ranges)
    npcDrawRangeIndices!: Int32Array;
    npcX!: Int32Array;
    npcY!: Int32Array;
    npcOrientation!: Int32Array;
    npcRotation!: Int32Array;
    npcPathLength!: Int32Array;
    npcMovementSeqId!: Int32Array;
    npcPathXPacked!: Int32Array;
    npcPathYPacked!: Int32Array;
    npcPathMovementTypePacked!: Int32Array;
    npcSize!: Int32Array;
    npcIsClickable!: Int32Array;
    npcRotationSpeed!: Int32Array;
    npcIdleSeqId!: Int32Array;
    npcWalkSeqId!: Int32Array;
    npcHasWalkAnim!: Int32Array;
    npcFrameIds!: Int32Array;
    npcFrameTicks!: Int32Array;
    npcMovementLoops!: Int32Array;
    npcSelectedAnimFrameOffsets!: Int32Array;
    npcSelectedAnimFrameCounts!: Int32Array;
    npcIdleFrameOffsetsBase!: Int32Array;
    npcIdleFrameCountsBase!: Int32Array;
    npcWalkFrameOffsetsBase!: Int32Array;
    npcWalkFrameCountsBase!: Int32Array;
    npcAnimFramesBasePacked!: Int32Array;
    npcIdleFrameOffsetsAlpha!: Int32Array;
    npcIdleFrameCountsAlpha!: Int32Array;
    npcWalkFrameOffsetsAlpha!: Int32Array;
    npcWalkFrameCountsAlpha!: Int32Array;
    npcAnimFramesAlphaPacked!: Int32Array;
    npcNullAlphaFrameOffset!: number;
    npcIdleSeqValid!: Int32Array;
    npcIdleSeqHasAnimMaya!: Int32Array;
    npcIdleSeqAnimMayaDurations!: Int32Array;
    npcIdleSeqFrameSteps!: Int32Array;
    npcIdleSeqLooping!: Int32Array;
    npcIdleSeqMaxLoops!: Int32Array;
    npcIdleSeqFrameIdCounts!: Int32Array;
    npcIdleSeqFrameLengthOffsets!: Int32Array;
    npcIdleSeqFrameLengthCounts!: Int32Array;
    npcWalkSeqValid!: Int32Array;
    npcWalkSeqHasAnimMaya!: Int32Array;
    npcWalkSeqAnimMayaDurations!: Int32Array;
    npcWalkSeqFrameSteps!: Int32Array;
    npcWalkSeqLooping!: Int32Array;
    npcWalkSeqMaxLoops!: Int32Array;
    npcWalkSeqFrameIdCounts!: Int32Array;
    npcWalkSeqFrameLengthOffsets!: Int32Array;
    npcWalkSeqFrameLengthCounts!: Int32Array;
    npcSelectedSeqValid!: Int32Array;
    npcSelectedSeqHasAnimMaya!: Int32Array;
    npcSelectedSeqAnimMayaDurations!: Int32Array;
    npcSelectedSeqFrameSteps!: Int32Array;
    npcSelectedSeqLooping!: Int32Array;
    npcSelectedSeqMaxLoops!: Int32Array;
    npcSelectedSeqFrameIdCounts!: Int32Array;
    npcSelectedSeqFrameLengthOffsets!: Int32Array;
    npcSelectedSeqFrameLengthCounts!: Int32Array;
    npcSeqFrameLengthsPacked!: Int32Array;
    npcTickPatchesByVariant!: Int32Array[]; // 2 npc variants [base, alpha]
    private cppTickStateInitialized = false;

    // Actual cache texture IDs used by this renderable (optional; used for texture residency).
    usedTextureIds?: Int32Array;

    static load(
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        npcTypeLoader: NpcTypeLoader,
        basTypeLoader: BasTypeLoader,
        app: PicoApp,
        mainProgram: Program,
        mainAlphaProgram: Program,
        npcProgram: Program,
        textureArray: Texture,
        textureMaterials: Texture,
        textureSlotLut: Texture,
        sceneUniformBuffer: UniformBuffer,
        data: SdRenderableData,
        time: number,
        frame: number,
    ): WebGLRenderable {
        const { ids, type } = data;

        const mapPos = vec2.fromValues(0, 0);
        const heightMapSize = 0;

        // const time = performance.now() * 0.001;

        const createDrawCall: CreateDrawCallFunction = (
            program: Program,
            modelInfoTexture: Texture | undefined,
            drawRangesPacked: Int32Array,
            useNpcGeometry?: boolean,
        ): DrawCallRange => {
            const drawRangeCount = (drawRangesPacked.length / DRAW_RANGE_STRIDE) | 0;
            const drawRangeArgs = new Array<DrawRange>(drawRangeCount);
            for (let i = 0; i < drawRangeCount; i++) {
                const off = i * DRAW_RANGE_STRIDE;
                drawRangeArgs[i] = [
                    drawRangesPacked[off + DRAW_RANGE_OFFSET_INDEX] | 0,
                    drawRangesPacked[off + DRAW_RANGE_ELEMENTS_INDEX] | 0,
                    drawRangesPacked[off + DRAW_RANGE_INSTANCES_INDEX] | 0,
                ];
            }
            const drawCall = app
                .createDrawCall(
                    program,
                    useNpcGeometry && renderable.npcVertexArray
                        ? renderable.npcVertexArray
                        : renderable.vertexArray,
                )
                .uniformBlock("SceneUniforms", sceneUniformBuffer)
                .uniform("u_timeLoaded", time)
                .uniform("u_mapPos", mapPos)
                // .uniform("u_drawIdOffset", drawIdOffset)
                .texture("u_textures", textureArray)
                .texture("u_textureMaterials", textureMaterials)
                .texture("u_textureSlotLut", textureSlotLut)
                .texture("u_heightMap", renderable.heightMapTexture)
                .drawRanges(...drawRangeArgs);

            if (modelInfoTexture) {
                drawCall.texture("u_modelInfoTexture", modelInfoTexture);
            }

            return {
                drawCall,
                drawRangesPacked,
            };
        };

        const renderable = new WebGLRenderable(
            type,
            ids,
            data.borderSize,
            data.tileRenderFlags,
            time,
            frame,
        );
        renderable.createBuffers(app, data);
        renderable.createNpcGeometryBuffers(app, data);
        renderable.createHeightMapTexture(app, new Int16Array(), heightMapSize);
        renderable.createModelInfoTextures(app, data);
        renderable.createDrawCalls(data, createDrawCall, mainProgram, mainAlphaProgram);
        renderable.createAnimatedLocs(time, data, seqTypeLoader, seqFrameLoader);
        renderable.createNpcs(
            data,
            npcTypeLoader,
            basTypeLoader,
            seqTypeLoader,
            seqFrameLoader,
            createDrawCall,
            npcProgram,
        );

        return renderable;
    }

    constructor(
        readonly type: RenderableType,
        readonly id: number,

        readonly borderSize: number,
        readonly tileRenderFlags: Uint8Array[][],

        readonly timeLoaded: number,
        readonly frameLoaded: number,
    ) {}

    getTileRenderFlag(level: number, tileX: number, tileY: number): number {
        return this.tileRenderFlags[level][tileX + this.borderSize][tileY + this.borderSize];
    }

    createHeightMapTexture(app: PicoApp, data: Int16Array, heightMapSize: number) {
        this.heightMapTexture = app.createTextureArray(
            data,
            heightMapSize,
            heightMapSize,
            Scene.MAX_LEVELS,
            {
                internalFormat: PicoGL.R16I,
                minFilter: PicoGL.NEAREST,
                magFilter: PicoGL.NEAREST,
                type: PicoGL.SHORT,
                wrapS: PicoGL.CLAMP_TO_EDGE,
                wrapT: PicoGL.CLAMP_TO_EDGE,
            },
        );
    }

    createBuffers(app: PicoApp, data: SdRenderableData) {
        this.interleavedBuffer = app.createInterleavedBuffer(16, data.vertices);
        this.indexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, data.indices);

        this.vertexArray = app
            .createVertexArray()
            // v0, v1, v2, v3
            .vertexAttributeBuffer(0, this.interleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 4,
                stride: 16,
                integer: true as any,
            })
            .indexBuffer(this.indexBuffer);
    }

    createNpcGeometryBuffers(app: PicoApp, data: SdRenderableData) {
        if (
            !(data.npcVertices instanceof Uint8Array) ||
            !(data.npcIndices instanceof Int32Array) ||
            data.npcVertices.length === 0 ||
            data.npcIndices.length === 0
        ) {
            this.npcInterleavedBuffer = undefined;
            this.npcIndexBuffer = undefined;
            this.npcVertexArray = undefined;
            return;
        }
        this.npcInterleavedBuffer = app.createInterleavedBuffer(16, data.npcVertices);
        this.npcIndexBuffer = app.createIndexBuffer(PicoGL.UNSIGNED_INT, data.npcIndices);

        this.npcVertexArray = app
            .createVertexArray()
            .vertexAttributeBuffer(0, this.npcInterleavedBuffer, {
                type: PicoGL.UNSIGNED_INT,
                size: 4,
                stride: 16,
                integer: true as any,
            })
            .indexBuffer(this.npcIndexBuffer);
    }

    createAnimatedLocs(
        time: number,
        data: SdRenderableData,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
    ) {
        const cycle = time / 0.02;
        const seqIds: number[] = [];

        this.locsAnimated = [];
        for (const loc of data.locsAnimated) {
            const seqResult = seqTypeLoader.tryLoad(loc.seqId);
            if (!seqResult.ok) {
                continue;
            }
            const seqType = seqResult.value;
            seqIds.push(loc.seqId | 0);
            this.locsAnimated.push(
                new LocAnimated(
                    loc.drawRangeIndex,
                    loc.drawRangeAlphaIndex,

                    loc.drawRangeLodIndex,
                    loc.drawRangeLodAlphaIndex,

                    loc.drawRangeInteractIndex,
                    loc.drawRangeInteractAlphaIndex,

                    loc.drawRangeInteractLodIndex,
                    loc.drawRangeInteractLodAlphaIndex,

                    loc.anim,
                    seqType,
                    cycle,
                    loc.randomStart,
                ),
            );
        }

        this.initLocAnimationPatchData(seqFrameLoader, seqIds);
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

    private initLocAnimationPatchData(seqFrameLoader: SeqFrameLoader, seqIds: number[]): void {
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

            const frameLengthMeta = WebGLRenderable.appendSeqFrameLengthsPacked(
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

            const baseMeta = WebGLRenderable.appendAnimationFramesPacked(
                basePacked,
                loc.anim.frames,
            );
            this.locAnimFrameOffsetsBase[i] = baseMeta.offset | 0;
            this.locAnimFrameCountsBase[i] = baseMeta.count | 0;

            const alphaMeta = WebGLRenderable.appendAnimationFramesPacked(
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

    syncLocAnimationStateFromObjects(): void {
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

    applyLocAnimationStateToObjects(): void {
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

    createNpcs(
        data: SdRenderableData,
        npcTypeLoader: NpcTypeLoader,
        basTypeLoader: BasTypeLoader,
        seqTypeLoader: SeqTypeLoader,
        seqFrameLoader: SeqFrameLoader,
        createDrawCall: CreateDrawCallFunction,
        npcProgram: Program,
    ) {
        this.npcs = [];
        const npcInput = orderByPacketKeys(data.npcs, data.npcOrderKeys);
        for (const npc of npcInput) {
            const npcResult = npcTypeLoader.tryLoad(npc.id);
            if (!npcResult.ok) {
                continue;
            }
            const npcType = npcResult.value;

            this.npcs.push(
                new Npc(
                    npc.tileX,
                    npc.tileY,
                    npc.level,
                    npc.idleAnim,
                    npc.walkAnim,
                    npcType,
                    npcType.getIdleSeqId(basTypeLoader),
                    npcType.getWalkSeqId(basTypeLoader),
                ),
            );
        }

        const hasPacketNpcDrawRanges =
            data.npcDrawRangesBase instanceof Int32Array &&
            data.npcDrawRangesBase.length === this.npcs.length * DRAW_RANGE_STRIDE;

        const drawRangesNpc = hasPacketNpcDrawRanges
            ? new Int32Array(data.npcDrawRangesBase!)
            : new Int32Array(this.npcs.length * DRAW_RANGE_STRIDE);
        if (!hasPacketNpcDrawRanges) {
            for (let i = 0; i < this.npcs.length; i++) {
                const off = i * DRAW_RANGE_STRIDE;
                drawRangesNpc[off + DRAW_RANGE_OFFSET_INDEX] = 0;
                drawRangesNpc[off + DRAW_RANGE_ELEMENTS_INDEX] = 0;
                drawRangesNpc[off + DRAW_RANGE_INSTANCES_INDEX] = 1;
            }
        }
        this.drawCallNpc = createDrawCall(
            npcProgram,
            undefined,
            drawRangesNpc,
            this.npcVertexArray !== undefined,
        );

        this.initNpcAnimationPatchData(
            seqTypeLoader,
            seqFrameLoader,
            data.npcDrawRangesBase,
            data.npcDrawRangesAlpha,
        );
    }

    private initNpcAnimationPatchData(
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
                const idleBase = WebGLRenderable.appendAnimationFramesPacked(
                    basePacked,
                    npc.idleAnim?.frames,
                );
                this.npcIdleFrameOffsetsBase[i] = idleBase.offset | 0;
                this.npcIdleFrameCountsBase[i] = idleBase.count | 0;

                const walkBase = WebGLRenderable.appendAnimationFramesPacked(
                    basePacked,
                    npc.walkAnim?.frames,
                );
                this.npcWalkFrameOffsetsBase[i] = walkBase.offset | 0;
                this.npcWalkFrameCountsBase[i] = walkBase.count | 0;

                const idleAlpha = WebGLRenderable.appendAnimationFramesPacked(
                    alphaPacked,
                    npc.idleAnim?.framesAlpha,
                );
                this.npcIdleFrameOffsetsAlpha[i] = idleAlpha.offset | 0;
                this.npcIdleFrameCountsAlpha[i] = idleAlpha.count | 0;

                const walkAlpha = WebGLRenderable.appendAnimationFramesPacked(
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
            const idleSeqFramesMeta = WebGLRenderable.appendSeqFrameLengthsPacked(
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
            const walkSeqFramesMeta = WebGLRenderable.appendSeqFrameLengthsPacked(
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

    syncNpcFrameStateFromObjects(): void {
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

    applyNpcFrameStateToObjects(): void {
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

    getTickCapability(): TickCapability | undefined {
        return this;
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

    createModelInfoTextures(app: PicoApp, data: SdRenderableData) {
        this.modelInfoTexture = createModelInfoTexture(app, data.modelInfoTextures.base);
        this.modelInfoTextureAlpha = createModelInfoTexture(app, data.modelInfoTextures.alpha);

        this.modelInfoTextureLod = createModelInfoTexture(app, data.modelInfoTextures.lod);
        this.modelInfoTextureLodAlpha = createModelInfoTexture(
            app,
            data.modelInfoTextures.lodAlpha,
        );

        this.modelInfoTextureInteract = createModelInfoTexture(
            app,
            data.modelInfoTextures.interact,
        );
        this.modelInfoTextureInteractAlpha = createModelInfoTexture(
            app,
            data.modelInfoTextures.interactAlpha,
        );

        this.modelInfoTextureInteractLod = createModelInfoTexture(
            app,
            data.modelInfoTextures.interactLod,
        );
        this.modelInfoTextureInteractLodAlpha = createModelInfoTexture(
            app,
            data.modelInfoTextures.interactLodAlpha,
        );
    }

    createDrawCalls(
        data: SdRenderableData,
        createDrawCall: CreateDrawCallFunction,
        mainProgram: Program,
        mainAlphaProgram: Program,
    ) {
        this.drawCall = createDrawCall(mainProgram, this.modelInfoTexture, data.drawRanges.base);
        this.drawCallAlpha = createDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureAlpha,
            data.drawRanges.alpha,
        );

        this.drawCallLod = createDrawCall(
            mainProgram,
            this.modelInfoTextureLod,
            data.drawRanges.lod,
        );
        this.drawCallLodAlpha = createDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureLodAlpha,
            data.drawRanges.lodAlpha,
        );

        this.drawCallInteract = createDrawCall(
            mainProgram,
            this.modelInfoTextureInteract,
            data.drawRanges.interact,
        );
        this.drawCallInteractAlpha = createDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureInteractAlpha,
            data.drawRanges.interactAlpha,
        );

        this.drawCallInteractLod = createDrawCall(
            mainProgram,
            this.modelInfoTextureInteractLod,
            data.drawRanges.interactLod,
        );
        this.drawCallInteractLodAlpha = createDrawCall(
            mainAlphaProgram,
            this.modelInfoTextureInteractLodAlpha,
            data.drawRanges.interactLodAlpha,
        );
    }

    canRender(frameCount: number): boolean {
        return frameCount - this.frameLoaded > FRAME_RENDER_DELAY;
    }

    getDrawCallKey(isAlpha: boolean, isInteract: boolean, isLod: boolean): DrawCallKey {
        if (isInteract) {
            if (isLod) {
                return isAlpha ? DrawCallKey.InteractLodAlpha : DrawCallKey.InteractLod;
            }
            return isAlpha ? DrawCallKey.InteractAlpha : DrawCallKey.Interact;
        }
        if (isLod) {
            return isAlpha ? DrawCallKey.LodAlpha : DrawCallKey.Lod;
        }
        return isAlpha ? DrawCallKey.Alpha : DrawCallKey.Base;
    }

    getDrawCallByKey(key: DrawCallKey): DrawCallRange {
        switch (key) {
            case DrawCallKey.Base:
                return this.drawCall;
            case DrawCallKey.Alpha:
                return this.drawCallAlpha;
            case DrawCallKey.Lod:
                return this.drawCallLod;
            case DrawCallKey.LodAlpha:
                return this.drawCallLodAlpha;
            case DrawCallKey.Interact:
                return this.drawCallInteract;
            case DrawCallKey.InteractAlpha:
                return this.drawCallInteractAlpha;
            case DrawCallKey.InteractLod:
                return this.drawCallInteractLod;
            case DrawCallKey.InteractLodAlpha:
                return this.drawCallInteractLodAlpha;
        }
        return this.drawCall;
    }

    getDrawCall(isAlpha: boolean, isInteract: boolean, isLod: boolean): DrawCallRange {
        return this.getDrawCallByKey(this.getDrawCallKey(isAlpha, isInteract, isLod));
    }

    delete() {
        this.vertexArray.delete();
        this.interleavedBuffer.delete();
        this.indexBuffer.delete();

        this.heightMapTexture.delete();

        // Model info
        this.modelInfoTexture.delete();
        this.modelInfoTextureAlpha.delete();

        this.modelInfoTextureLod.delete();
        this.modelInfoTextureLodAlpha.delete();

        this.modelInfoTextureInteract.delete();
        this.modelInfoTextureInteractAlpha.delete();

        this.modelInfoTextureInteractLod.delete();
        this.modelInfoTextureInteractLodAlpha.delete();
    }
}
