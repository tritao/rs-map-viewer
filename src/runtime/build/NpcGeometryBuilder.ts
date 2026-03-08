import type { NpcSpawn } from "../../data/npc/NpcSpawn";
import { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import { NpcType } from "../../rs/config/npctype/NpcType";
import { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { NpcModelLoader } from "../../rs/scene/model/NpcModelLoader";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import type { DrawRange } from "../../shared/DrawRange";
import { AnimationFrames } from "../entities/AnimationFrames";
import type { NpcData } from "../entities/NpcData";
import { createNpcDatas, createNpcDatasFromSpawns } from "../entities/NpcData";
import type { NpcSpawnGroup } from "../entities/NpcSpawnGroup";
import { SceneGeometryBuffer } from "./SceneGeometryBuffer";

const NPC_SCENE_BUFFER_INIT_VERTEX_COUNT = 20000;
const NULL_DRAW_RANGE: DrawRange = [0, 0, 0];

function addNpcAnimationFrames(
    npcModelLoader: NpcModelLoader,
    seqTypeLoader: SeqTypeLoader,
    sceneBuf: SceneGeometryBuffer,
    npcType: NpcType,
    seqId: number,
): AnimationFrames | undefined {
    const seqResult = seqTypeLoader.tryLoad(seqId);
    if (!seqResult.ok) {
        return undefined;
    }
    const seqType = seqResult.value;
    let frameCount: number;
    if (seqType.hasAnimMayaSeq()) {
        frameCount = seqType.getAnimMayaDuration();
    } else {
        if (!seqType.frameIds) {
            return undefined;
        }
        frameCount = seqType.frameIds.length;
    }
    if (frameCount === 0) {
        return undefined;
    }
    const frames = new Array<DrawRange>(frameCount);
    const framesAlpha = new Array<DrawRange>(frameCount);
    let alphaFrameCount = 0;
    for (let i = 0; i < frameCount; i++) {
        const model = npcModelLoader.getModel(npcType, seqId, i);
        if (model) {
            frames[i] = sceneBuf.addModelAnimFrame(model, false);
            framesAlpha[i] = sceneBuf.addModelAnimFrame(model, true);
            if (framesAlpha[i][1] > 0) {
                alphaFrameCount++;
            }
        } else {
            frames[i] = NULL_DRAW_RANGE;
            framesAlpha[i] = NULL_DRAW_RANGE;
        }
    }

    return {
        frames,
        framesAlpha: alphaFrameCount > 0 ? framesAlpha : undefined,
    };
}

function createNpcSpawnGroups(
    npcModelLoader: NpcModelLoader,
    npcTypeLoader: NpcTypeLoader,
    seqTypeLoader: SeqTypeLoader,
    basTypeLoader: BasTypeLoader,
    sceneBuf: SceneGeometryBuffer,
    npcSpawns: readonly NpcSpawn[],
): NpcSpawnGroup[] {
    const groupedSpawns = new Map<number, NpcSpawn[]>();
    for (const spawn of npcSpawns) {
        const group = groupedSpawns.get(spawn.id);
        if (group) {
            group.push(spawn);
        } else {
            groupedSpawns.set(spawn.id, [spawn]);
        }
    }

    const groups: NpcSpawnGroup[] = [];

    for (const spawns of groupedSpawns.values()) {
        const npcResult = npcTypeLoader.tryLoad(spawns[0].id);
        if (!npcResult.ok) {
            continue;
        }
        const npcType = npcResult.value;

        const idleSeqId = npcType.getIdleSeqId(basTypeLoader);
        const walkSeqId = npcType.getWalkSeqId(basTypeLoader);

        if (idleSeqId === -1) {
            continue;
        }

        const idleAnim = addNpcAnimationFrames(
            npcModelLoader,
            seqTypeLoader,
            sceneBuf,
            npcType,
            idleSeqId,
        );
        let walkAnim = idleAnim;
        if (walkSeqId !== -1 && walkSeqId !== idleSeqId) {
            walkAnim = addNpcAnimationFrames(
                npcModelLoader,
                seqTypeLoader,
                sceneBuf,
                npcType,
                walkSeqId,
            );
        }

        if (!idleAnim) {
            continue;
        }

        groups.push({
            idleAnim,
            walkAnim,
            spawns,
        });
    }

    return groups;
}

function createDefaultNpcDrawRanges(npcCount: number): Int32Array {
    const count = Math.max(0, npcCount | 0);
    const out = new Int32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const off = i * 3;
        out[off + 0] = 0;
        out[off + 1] = 0;
        out[off + 2] = 1;
    }
    return out;
}

export type BuildNpcGeometryInput = Readonly<{
    loadNpcs: boolean;
    includeNpcAnimationFrames: boolean;
    npcSpawns: readonly NpcSpawn[];
    textureLoader: TextureLoader;
    npcModelLoader: NpcModelLoader;
    npcTypeLoader: NpcTypeLoader;
    seqTypeLoader: SeqTypeLoader;
    basTypeLoader: BasTypeLoader;
}>;

export type BuiltNpcGeometry = Readonly<{
    npcs: NpcData[];
    npcVertices: Uint8Array | undefined;
    npcIndices: Int32Array | undefined;
    npcDrawRangesBase: Int32Array | undefined;
    npcDrawRangesAlpha: Int32Array | undefined;
    usedTextureIds: ReadonlySet<number>;
}>;

export function buildNpcGeometry(input: BuildNpcGeometryInput): BuiltNpcGeometry {
    if (!input.loadNpcs) {
        return {
            npcs: [],
            npcVertices: undefined,
            npcIndices: undefined,
            npcDrawRangesBase: undefined,
            npcDrawRangesAlpha: undefined,
            usedTextureIds: new Set<number>(),
        };
    }

    if (!input.includeNpcAnimationFrames) {
        return {
            npcs: createNpcDatasFromSpawns(Array.from(input.npcSpawns)),
            npcVertices: undefined,
            npcIndices: undefined,
            npcDrawRangesBase: undefined,
            npcDrawRangesAlpha: undefined,
            usedTextureIds: new Set<number>(),
        };
    }

    const sceneBuf = new SceneGeometryBuffer(input.textureLoader, NPC_SCENE_BUFFER_INIT_VERTEX_COUNT);
    const npcSpawnGroups = createNpcSpawnGroups(
        input.npcModelLoader,
        input.npcTypeLoader,
        input.seqTypeLoader,
        input.basTypeLoader,
        sceneBuf,
        input.npcSpawns,
    );
    const npcs = createNpcDatas(npcSpawnGroups);

    const npcVertices = sceneBuf.vertexCount() > 0 ? sceneBuf.vertexBuf.byteArray() : undefined;
    const npcIndices = sceneBuf.indices.length > 0 ? new Int32Array(sceneBuf.indices) : undefined;
    const hasNpcGeometry =
        npcVertices instanceof Uint8Array &&
        npcVertices.length > 0 &&
        npcIndices instanceof Int32Array &&
        npcIndices.length > 0;
    const npcDrawRangesBase = hasNpcGeometry
        ? createDefaultNpcDrawRanges(npcs.length | 0)
        : undefined;
    const npcDrawRangesAlpha = hasNpcGeometry
        ? createDefaultNpcDrawRanges(npcs.length | 0)
        : undefined;

    return {
        npcs,
        npcVertices,
        npcIndices,
        npcDrawRangesBase,
        npcDrawRangesAlpha,
        usedTextureIds: sceneBuf.usedTextureIds,
    };
}
