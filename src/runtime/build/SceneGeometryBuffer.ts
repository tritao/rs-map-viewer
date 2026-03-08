import { vec3 } from "gl-matrix";

import { InteractType } from "../packets/InteractType";
import { Model, computeTextureCoords } from "../../rs/model/Model";
import { Scene } from "../../rs/scene/Scene";
import { SceneTile } from "../../rs/scene/SceneTile";
import { TextureLoader } from "../../rs/texture/TextureLoader";
import { clamp } from "../../util/MathUtil";
import { newDrawRange, type DrawRange } from "../DrawRange";
import { LocAnimatedData } from "../LocAnimatedData";
import { LocAnimatedGroup } from "./LocAnimatedGroup";
import { SceneLocEntity } from "./SceneLocEntity";
import { VertexBuffer } from "./VertexBuffer";

export enum ContourGroundType {
    CENTER_TILE = 0,
    VERTEX = 1,
    NONE = 2,
}

export type ModelInfo = {
    sceneX: number;
    sceneZ: number;
    heightOffset: number;
    level: number;
    contourGround: ContourGroundType;
    priority: number;
    interactType: InteractType;
    interactId: number;
};

export type DrawCommand = {
    offset: number;
    elements: number;
    instances: ModelInfo[];
};

export type TerrainTileVertexRecord = Readonly<{
    x: number;
    y: number;
    z: number;
    hsl: number;
    u: number;
    v: number;
    textureId: number;
    textureId1: number;
    texBlend: number;
}>;

export type TerrainDigest = Readonly<{
    levels: number;
    facesTotal: number;
    verticesTotal: number;
    levelFaces: number[];
    levelVertices: number[];
    hash: number;
}>;

function fnv1a32UpdateInt(hash: number, value: number): number {
    const h = ((hash >>> 0) ^ (value >>> 0)) >>> 0;
    return Math.imul(h, 16777619) >>> 0;
}

function quantizeUv(v: number): number {
    // Keep stable across runtimes: fixed-point quantization (1/4096).
    return (v * 4096) | 0;
}

export function collectTerrainTileVertexRecords(
    tile: SceneTile,
    offsetX: number,
    offsetY: number,
): TerrainTileVertexRecord[] {
    const tileModel = tile.tileModel;
    if (!tileModel) {
        return [];
    }

    const out: TerrainTileVertexRecord[] = [];
    for (let faceIndex = 0; faceIndex < tileModel.faces.length; faceIndex++) {
        const face = tileModel.faces[faceIndex];
        for (let vertexIndex = 0; vertexIndex < face.vertices.length; vertexIndex++) {
            const vertex = face.vertices[vertexIndex];
            out.push({
                x: vertex.x + offsetX,
                y: vertex.y,
                z: vertex.z + offsetY,
                hsl: vertex.hsl,
                u: vertex.u,
                v: vertex.v,
                textureId: vertex.textureId,
                textureId1: vertex.textureId1,
                texBlend: vertex.texBlend,
            });
        }
    }

    return out;
}

export function summarizeTerrainGeometry(
    scene: Scene,
    borderSize: number,
    maxLevel: number,
    textureLoader?: TextureLoader,
): TerrainDigest {
    const startX = borderSize;
    const startY = borderSize;
    const endX = borderSize + Scene.MAP_SQUARE_SIZE;
    const endY = borderSize + Scene.MAP_SQUARE_SIZE;
    const vertexOffset = borderSize * -128;

    let hash = 2166136261 >>> 0;
    let facesTotal = 0;
    let verticesTotal = 0;
    const levelFaces = new Array<number>(scene.levels).fill(0);
    const levelVertices = new Array<number>(scene.levels).fill(0);

    for (let level = 0; level < scene.levels; level++) {
        for (let x = startX; x < endX; x++) {
            for (let y = startY; y < endY; y++) {
                const tile = scene.tiles[level][x][y];
                if (!tile || tile.minLevel > maxLevel) {
                    continue;
                }
                const tileModel = tile.tileModel;
                const faceCount = tileModel?.faces.length ?? 0;
                if (faceCount === 0) {
                    continue;
                }
                facesTotal += faceCount;
                levelFaces[level] += faceCount;
                const vertices = collectTerrainTileVertexRecords(tile, vertexOffset, vertexOffset);
                verticesTotal += vertices.length;
                levelVertices[level] += vertices.length;
                for (let i = 0; i < vertices.length; i++) {
                    const v = vertices[i];
                    const id0 = v.textureId | 0;
                    const id1 = v.textureId1 | 0;
                    const tex0 = id0 >= 0 && textureLoader && textureLoader.isSd(id0) ? id0 : -1;
                    const tex1 = id1 >= 0 && textureLoader && textureLoader.isSd(id1) ? id1 : -1;
                    hash = fnv1a32UpdateInt(hash, v.x | 0);
                    hash = fnv1a32UpdateInt(hash, v.y | 0);
                    hash = fnv1a32UpdateInt(hash, v.z | 0);
                    hash = fnv1a32UpdateInt(hash, v.hsl | 0);
                    hash = fnv1a32UpdateInt(hash, quantizeUv(v.u));
                    hash = fnv1a32UpdateInt(hash, quantizeUv(v.v));
                    hash = fnv1a32UpdateInt(hash, tex0 | 0);
                    hash = fnv1a32UpdateInt(hash, tex1 | 0);
                    hash = fnv1a32UpdateInt(hash, v.texBlend | 0);
                }
            }
        }
    }

    return {
        levels: scene.levels | 0,
        facesTotal: facesTotal | 0,
        verticesTotal: verticesTotal | 0,
        levelFaces,
        levelVertices,
        hash: hash >>> 0,
    };
}

export type SceneModel = {
    model: Model;
    sceneHeight: number;
    lowDetail: boolean;
    forceMerge: boolean;
} & ModelInfo;

export type ModelMergeGroup = {
    transparent: boolean;
    lowDetail: boolean;
    level: number;
    priority: number;
    models: SceneModel[];
};

export type DrawBucketKey =
    | "base"
    | "alpha"
    | "lod"
    | "lodAlpha"
    | "interact"
    | "interactAlpha"
    | "interactLod"
    | "interactLodAlpha";

export const DRAW_BUCKET_KEYS: readonly DrawBucketKey[] = [
    "base",
    "alpha",
    "lod",
    "lodAlpha",
    "interact",
    "interactAlpha",
    "interactLod",
    "interactLodAlpha",
];

export type SceneCommandStreamEntry = Readonly<{
    bucketIndex: number;
    offset: number;
    elements: number;
    instances: ReadonlyArray<ModelInfo>;
}>;

export function buildSceneCommandStreamFromBuckets(
    drawCommands: Readonly<Record<DrawBucketKey, ReadonlyArray<DrawCommand>>>,
): SceneCommandStreamEntry[] {
    const out: SceneCommandStreamEntry[] = [];
    for (let bucketIndex = 0; bucketIndex < DRAW_BUCKET_KEYS.length; bucketIndex++) {
        const key = DRAW_BUCKET_KEYS[bucketIndex];
        const commands = drawCommands[key];
        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            out.push({
                bucketIndex,
                offset: command.offset | 0,
                elements: command.elements | 0,
                instances: command.instances,
            });
        }
    }
    return out;
}

export function getMergedCommandBucketKeys(
    transparent: boolean,
    includeLod: boolean,
): readonly DrawBucketKey[] {
    if (transparent) {
        return includeLod ? ["alpha", "lodAlpha"] : ["alpha"];
    }
    return includeLod ? ["base", "lod"] : ["base"];
}

export function getInteractCommandBucketKeys(
    transparent: boolean,
    includeLod: boolean,
): readonly DrawBucketKey[] {
    if (transparent) {
        return includeLod ? ["interactAlpha", "interactLodAlpha"] : ["interactAlpha"];
    }
    return includeLod ? ["interact", "interactLod"] : ["interact"];
}

export type SceneModelMergeDecision = Readonly<{
    mergeOpaque: boolean;
    mergeTransparent: boolean;
}>;

export function decideSceneModelMergeStrategy(
    instanceCount: number,
    opaqueFaceCount: number,
    transparentFaceCount: number,
    minimizeDrawCalls: boolean,
): SceneModelMergeDecision {
    const forceMerge = minimizeDrawCalls || instanceCount === 1;
    return {
        mergeOpaque: forceMerge || instanceCount * opaqueFaceCount < 100,
        mergeTransparent: forceMerge || instanceCount * transparentFaceCount < 100,
    };
}

type DrawCommandBuckets = {
    base: DrawCommand[];
    alpha: DrawCommand[];
    lod: DrawCommand[];
    lodAlpha: DrawCommand[];
    interact: DrawCommand[];
    interactAlpha: DrawCommand[];
    interactLod: DrawCommand[];
    interactLodAlpha: DrawCommand[];
};

function createDrawCommandBuckets(): DrawCommandBuckets {
    return {
        base: [],
        alpha: [],
        lod: [],
        lodAlpha: [],
        interact: [],
        interactAlpha: [],
        interactLod: [],
        interactLodAlpha: [],
    };
}

class SceneCommandEmitter {
    private readonly buckets: DrawCommandBuckets = createDrawCommandBuckets();

    getBucket(key: DrawBucketKey): readonly DrawCommand[] {
        return this.buckets[key];
    }

    getBucketLength(key: DrawBucketKey): number {
        return this.buckets[key].length;
    }

    emitToBucket(key: DrawBucketKey, command: DrawCommand): void {
        this.buckets[key].push(command);
    }

    emitToBuckets(keys: readonly DrawBucketKey[], command: DrawCommand): void {
        for (let i = 0; i < keys.length; i++) {
            this.buckets[keys[i]].push(command);
        }
    }

    emitMergedCommand(command: DrawCommand, transparent: boolean, includeLod: boolean): void {
        this.emitToBuckets(getMergedCommandBucketKeys(transparent, includeLod), command);
    }

    emitInteractCommand(command: DrawCommand, transparent: boolean, includeLod: boolean): void {
        this.emitToBuckets(getInteractCommandBucketKeys(transparent, includeLod), command);
    }

    toCommandStream(): SceneCommandStreamEntry[] {
        return buildSceneCommandStreamFromBuckets(this.buckets);
    }
}

export class SceneGeometryBuffer {
    vertexBuf: VertexBuffer;
    indices: number[] = [];
    private readonly commandEmitter: SceneCommandEmitter = new SceneCommandEmitter();

    usedTextureIds = new Set<number>();

    constructor(
        readonly textureLoader: TextureLoader,
        initVertexCount: number,
    ) {
        this.vertexBuf = new VertexBuffer(initVertexCount);
    }

    private resolveSdTextureId(textureId: number): number {
        const id = textureId | 0;
        if (id < 0) {
            return -1;
        }
        return this.textureLoader.isSd(id) ? id : -1;
    }

    vertexCount(): number {
        return this.vertexBuf.offset;
    }

    indexByteOffset(): number {
        return this.indices.length * 4;
    }

    writeModelGeometry(
        model: Model,
        faces: readonly ModelFace[],
        offset?: vec3,
        reuseVertices: boolean = true,
    ): Readonly<{ offset: number; elements: number }> {
        const indexOffset = this.indexByteOffset();
        this.addModel(model, faces, offset, reuseVertices);
        const elements = (this.indexByteOffset() - indexOffset) / 4;
        return { offset: indexOffset, elements };
    }

    writeTerrainTileGeometry(tile: SceneTile, offsetX: number, offsetY: number): number {
        const indexOffset = this.indexByteOffset();
        this.addTerrainTile(tile, offsetX, offsetY);
        return (this.indexByteOffset() - indexOffset) / 4;
    }

    get drawCommands(): readonly DrawCommand[] {
        return this.commandEmitter.getBucket("base");
    }

    get drawCommandsAlpha(): readonly DrawCommand[] {
        return this.commandEmitter.getBucket("alpha");
    }

    get drawCommandsLod(): readonly DrawCommand[] {
        return this.commandEmitter.getBucket("lod");
    }

    get drawCommandsLodAlpha(): readonly DrawCommand[] {
        return this.commandEmitter.getBucket("lodAlpha");
    }

    get drawCommandsInteract(): readonly DrawCommand[] {
        return this.commandEmitter.getBucket("interact");
    }

    get drawCommandsInteractAlpha(): readonly DrawCommand[] {
        return this.commandEmitter.getBucket("interactAlpha");
    }

    get drawCommandsInteractLod(): readonly DrawCommand[] {
        return this.commandEmitter.getBucket("interactLod");
    }

    get drawCommandsInteractLodAlpha(): readonly DrawCommand[] {
        return this.commandEmitter.getBucket("interactLodAlpha");
    }

    emitMergedCommand(command: DrawCommand, transparent: boolean, includeLod: boolean): void {
        this.commandEmitter.emitMergedCommand(command, transparent, includeLod);
    }

    emitInteractCommand(command: DrawCommand, transparent: boolean, includeLod: boolean): void {
        this.commandEmitter.emitInteractCommand(command, transparent, includeLod);
    }

    emitCommandToBucket(bucket: DrawBucketKey, command: DrawCommand): void {
        this.commandEmitter.emitToBucket(bucket, command);
    }

    getCommandStream(): SceneCommandStreamEntry[] {
        return this.commandEmitter.toCommandStream();
    }

    addTerrainTile(tile: SceneTile, offsetX: number, offsetY: number): void {
        const vertices = collectTerrainTileVertexRecords(tile, offsetX, offsetY);
        for (let i = 0; i < vertices.length; i++) {
            const vertex = vertices[i];
            const textureId0 = this.resolveSdTextureId(vertex.textureId);
            const textureId1 = this.resolveSdTextureId(vertex.textureId1);

            if (textureId0 !== -1) {
                this.usedTextureIds.add(textureId0);
            }
            if (textureId1 !== -1) {
                this.usedTextureIds.add(textureId1);
            }

            const index = this.vertexBuf.addVertex(
                vertex.x,
                vertex.y,
                vertex.z,
                vertex.hsl,
                0xff,
                vertex.u,
                vertex.v,
                textureId0,
                0,
                true,
                textureId1,
                vertex.texBlend,
            );

            this.indices.push(index);
        }
    }

    addTerrain(scene: Scene, borderSize: number, maxLevel: number): number {
        const startX = borderSize;
        const startY = borderSize;
        const endX = borderSize + Scene.MAP_SQUARE_SIZE;
        const endY = borderSize + Scene.MAP_SQUARE_SIZE;

        const vertexOffset = borderSize * -128;

        const terrainStartVertexCount = this.vertexCount();
        for (let level = 0; level < scene.levels; level++) {
            const indexOffset = this.indexByteOffset();
            for (let x = startX; x < endX; x++) {
                for (let y = startY; y < endY; y++) {
                    const tile = scene.tiles[level][x][y];
                    if (!tile || tile.minLevel > maxLevel) {
                        continue;
                    }
                    this.writeTerrainTileGeometry(tile, vertexOffset, vertexOffset);
                }
            }

            const levelVertexCount = (this.indexByteOffset() - indexOffset) / 4;

            if (levelVertexCount > 0) {
                const command: DrawCommand = {
                    offset: indexOffset,
                    elements: levelVertexCount,
                    instances: [
                        {
                            sceneX: 0,
                            sceneZ: 0,
                            heightOffset: 0,
                            level,
                            contourGround: ContourGroundType.NONE,
                            priority: 0,
                            interactType: InteractType.NONE,
                            interactId: 0xffff,
                        },
                    ],
                };
                this.commandEmitter.emitMergedCommand(command, false, true);
                this.commandEmitter.emitInteractCommand(command, false, true);
            }
        }

        return this.vertexCount() - terrainStartVertexCount;
    }

    addModelAnimFrame(model: Model, transparent: boolean): DrawRange {
        const split = splitModelFacesByTransparency(this.textureLoader, model);
        const faces = transparent ? split.transparentFaces : split.opaqueFaces;

        const { offset, elements } = this.writeModelGeometry(model, faces);

        return newDrawRange(offset, elements, 1);
    }

    addLocAnimatedGroups(groups: Iterable<LocAnimatedGroup>): LocAnimatedData[] {
        const locsAnimated: LocAnimatedData[] = [];

        for (const group of groups) {
            for (const loc of group.locs) {
                locsAnimated.push(this.addLocAnimated(group, loc));
            }
        }

        return locsAnimated;
    }

    addLocAnimated(group: LocAnimatedGroup, loc: SceneLocEntity): LocAnimatedData {
        const anim = group.anim;

        // Normal (merged)
        const drawRangeIndex = this.commandEmitter.getBucketLength("base");
        this.commandEmitter.emitToBucket("base", {
            offset: 0,
            elements: 0,
            instances: [loc],
        });
        const drawRangeAlphaIndex = this.commandEmitter.getBucketLength("alpha");
        if (anim.framesAlpha) {
            this.commandEmitter.emitToBucket("alpha", {
                offset: 0,
                elements: 0,
                instances: [loc],
            });
        }
        // Lod (merged)
        let drawRangeLodIndex = -1;
        let drawRangeLodAlphaIndex = -1;
        if (!loc.lowDetail) {
            drawRangeLodIndex = this.commandEmitter.getBucketLength("lod");
            this.commandEmitter.emitToBucket("lod", {
                offset: 0,
                elements: 0,
                instances: [loc],
            });
            if (anim.framesAlpha) {
                drawRangeLodAlphaIndex = this.commandEmitter.getBucketLength("lodAlpha");
                this.commandEmitter.emitToBucket("lodAlpha", {
                    offset: 0,
                    elements: 0,
                    instances: [loc],
                });
            }
        }

        // Interact (non merged)
        const drawRangeInteractIndex = this.commandEmitter.getBucketLength("interact");
        this.commandEmitter.emitToBucket("interact", {
            offset: 0,
            elements: 0,
            instances: [loc],
        });
        const drawRangeInteractAlphaIndex = this.commandEmitter.getBucketLength("interactAlpha");
        if (anim.framesAlpha) {
            this.commandEmitter.emitToBucket("interactAlpha", {
                offset: 0,
                elements: 0,
                instances: [loc],
            });
        }

        // Interact Lod (non merged)
        let drawRangeInteractLodIndex = -1;
        let drawRangeInteractLodAlphaIndex = -1;
        if (!loc.lowDetail) {
            drawRangeInteractLodIndex = this.commandEmitter.getBucketLength("interactLod");
            this.commandEmitter.emitToBucket("interactLod", {
                offset: 0,
                elements: 0,
                instances: [loc],
            });
            if (anim.framesAlpha) {
                drawRangeInteractLodAlphaIndex =
                    this.commandEmitter.getBucketLength("interactLodAlpha");
                this.commandEmitter.emitToBucket("interactLodAlpha", {
                    offset: 0,
                    elements: 0,
                    instances: [loc],
                });
            }
        }
        return {
            drawRangeIndex,
            drawRangeAlphaIndex,

            drawRangeLodIndex,
            drawRangeLodAlphaIndex,

            drawRangeInteractIndex,
            drawRangeInteractAlphaIndex,

            drawRangeInteractLodIndex,
            drawRangeInteractLodAlphaIndex,

            anim,
            seqId: loc.entity.seqId,
            randomStart: loc.entity.seqRandomStart,
        };
    }

    addModelGroup(group: ModelMergeGroup): void {
        const groupOffset = this.indexByteOffset();

        for (const sceneModel of group.models) {
            const model = sceneModel.model;

            const faces = getModelFaces(model).filter(
                (face) => isModelFaceTransparent(this.textureLoader, face) === group.transparent,
            );

            const vertexOffset: vec3 = [
                sceneModel.sceneX,
                sceneModel.sceneHeight,
                sceneModel.sceneZ,
            ];
            if (sceneModel.heightOffset !== 0) {
                vertexOffset[1] = -sceneModel.heightOffset;
            }
            const { offset, elements } = this.writeModelGeometry(model, faces, vertexOffset);

            const drawCommand: DrawCommand = {
                offset: offset,
                elements: elements,
                instances: [
                    {
                        sceneX: 0,
                        sceneZ: 0,
                        heightOffset: 0,
                        level: group.level,
                        contourGround: ContourGroundType.NONE,
                        priority: group.priority,
                        interactType: sceneModel.interactType,
                        interactId: sceneModel.interactId,
                    },
                ],
            };
            this.commandEmitter.emitInteractCommand(
                drawCommand,
                group.transparent,
                !group.lowDetail,
            );
        }

        const groupElements = (this.indexByteOffset() - groupOffset) / 4;

        if (groupElements > 0) {
            const drawCommand: DrawCommand = {
                offset: groupOffset,
                elements: groupElements,
                instances: [
                    {
                        sceneX: 0,
                        sceneZ: 0,
                        heightOffset: 0,
                        level: group.level,
                        contourGround: ContourGroundType.NONE,
                        priority: group.priority,
                        interactType: InteractType.NONE,
                        interactId: 0xffff,
                    },
                ],
            };
            this.commandEmitter.emitMergedCommand(drawCommand, group.transparent, !group.lowDetail);
        }
    }

    addModel(
        model: Model,
        faces: readonly ModelFace[],
        offset?: vec3,
        reuseVertices: boolean = true,
    ): void {
        if (faces.length === 0) {
            return;
        }

        const verticesX = model.verticesX;
        let verticesY = model.verticesY;
        const verticesZ = model.verticesZ;

        let sceneX = 0;
        let sceneZ = 0;
        let sceneHeight = 0;
        if (offset) {
            sceneX = offset[0];
            sceneHeight = offset[1];
            sceneZ = offset[2];
            if (model.contourVerticesY) {
                verticesY = model.contourVerticesY;
            }
        }

        const facesA = model.indices1;
        const facesB = model.indices2;
        const facesC = model.indices3;

        // const modelTexCoords = computeTextureCoords(model);
        const modelTexCoords = model.uvs;

        if (model.faceTextures && !modelTexCoords) {
            throw new Error("Model has face textures but no texture coordinates");
        }

        for (const face of faces) {
            const index = face.index;
            const alpha = face.alpha;
            const priority = face.priority;
            const textureId = face.textureId;
            const textureIdSd = this.resolveSdTextureId(textureId);

            let hslA = model.faceColors1[index];
            let hslB = model.faceColors2[index];
            let hslC = model.faceColors3[index];

            if (hslC === -1) {
                hslC = hslB = hslA;
            }

            let u0: number = 0;
            let v0: number = 0;
            let u1: number = 0;
            let v1: number = 0;
            let u2: number = 0;
            let v2: number = 0;

            if (modelTexCoords) {
                const texCoordIdx = index * 6;
                u0 = modelTexCoords[texCoordIdx];
                v0 = modelTexCoords[texCoordIdx + 1];
                u1 = modelTexCoords[texCoordIdx + 2];
                v1 = modelTexCoords[texCoordIdx + 3];
                u2 = modelTexCoords[texCoordIdx + 4];
                v2 = modelTexCoords[texCoordIdx + 5];

                // emulate wrapS: PicoGL.CLAMP_TO_EDGE
                // u0 = clamp(u0, 0.00390625 * 3, 1 - 0.00390625 * 3);
                // u1 = clamp(u1, 0.00390625 * 3, 1 - 0.00390625 * 3);
                // u2 = clamp(u2, 0.00390625 * 3, 1 - 0.00390625 * 3);
            }

            const fa = facesA[index];
            const fb = facesB[index];
            const fc = facesC[index];

            const vxa = sceneX + verticesX[fa];
            const vxb = sceneX + verticesX[fb];
            const vxc = sceneX + verticesX[fc];

            const vya = sceneHeight + verticesY[fa];
            const vyb = sceneHeight + verticesY[fb];
            const vyc = sceneHeight + verticesY[fc];

            const vza = sceneZ + verticesZ[fa];
            const vzb = sceneZ + verticesZ[fb];
            const vzc = sceneZ + verticesZ[fc];

            if (textureIdSd !== -1) {
                this.usedTextureIds.add(textureIdSd);
            }

            const index0 = this.vertexBuf.addVertex(
                vxa,
                vya,
                vza,
                hslA,
                alpha,
                u0,
                v0,
                textureIdSd,
                priority + 1,
                reuseVertices,
            );
            const index1 = this.vertexBuf.addVertex(
                vxb,
                vyb,
                vzb,
                hslB,
                alpha,
                u1,
                v1,
                textureIdSd,
                priority + 1,
                reuseVertices,
            );
            const index2 = this.vertexBuf.addVertex(
                vxc,
                vyc,
                vzc,
                hslC,
                alpha,
                u2,
                v2,
                textureIdSd,
                priority + 1,
                reuseVertices,
            );

            this.indices.push(index0, index1, index2);
        }
    }
}

export type ModelFace = {
    index: number;
    alpha: number;
    priority: number;
    textureId: number;
};

export type IsTextureTransparentFn = (textureId: number) => boolean;

export function isModelFaceTransparentById(
    isTextureTransparent: IsTextureTransparentFn,
    face: ModelFace,
): boolean {
    return face.alpha < 0xff || (face.textureId !== -1 && isTextureTransparent(face.textureId));
}

export function isModelFaceTransparent(textureLoader: TextureLoader, face: ModelFace): boolean {
    return isModelFaceTransparentById((id) => textureLoader.isTransparent(id), face);
}

export function getModelFaces(model: Model): ModelFace[] {
    const faces: ModelFace[] = [];

    const faceTransparencies = model.faceAlphas;

    const priorities = model.faceRenderPriorities;

    for (let index = 0; index < model.faceCount; index++) {
        let hslC = model.faceColors3[index];

        if (hslC === -2) {
            continue;
        }

        let textureId = -1;
        if (model.faceTextures) {
            textureId = model.faceTextures[index];
        }

        let alpha = 0xff;
        if (faceTransparencies && textureId === -1) {
            alpha = 0xff - (faceTransparencies[index] & 0xff);
        }
        // if (faceTransparencies) {
        //     alpha = 0xff - (faceTransparencies[index] & 0xff);
        // }

        if (alpha === 0 || alpha === 0x1) {
            continue;
        }

        let priority = 0;
        if (priorities) {
            priority = priorities[index];
        }

        faces.push({
            index,
            alpha,
            priority,
            textureId,
        });
    }

    return faces;
}

export type SplitModelFaces = Readonly<{
    opaqueFaces: readonly ModelFace[];
    transparentFaces: readonly ModelFace[];
}>;

export type ModelFacesDigest = Readonly<{
    faceCount: number;
    opaqueCount: number;
    transparentCount: number;
    hash: number;
}>;

export function splitModelFacesByTransparencyById(
    isTextureTransparent: IsTextureTransparentFn,
    faces: readonly ModelFace[],
): SplitModelFaces {
    const opaqueFaces: ModelFace[] = [];
    const transparentFaces: ModelFace[] = [];
    for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        if (isModelFaceTransparentById(isTextureTransparent, face)) {
            transparentFaces.push(face);
        } else {
            opaqueFaces.push(face);
        }
    }
    return { opaqueFaces, transparentFaces };
}

export function splitModelFacesByTransparency(
    textureLoader: TextureLoader,
    model: Model,
): SplitModelFaces {
    return splitModelFacesByTransparencyById(
        (id) => textureLoader.isTransparent(id),
        getModelFaces(model),
    );
}

export function summarizeModelFacesById(
    isTextureTransparent: IsTextureTransparentFn,
    model: Model,
): ModelFacesDigest {
    const faces = getModelFaces(model);
    let hash = 2166136261 >>> 0;
    let opaqueCount = 0;
    let transparentCount = 0;
    for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        const isTrans = isModelFaceTransparentById(isTextureTransparent, f);
        if (isTrans) transparentCount++;
        else opaqueCount++;
        hash = fnv1a32UpdateInt(hash, f.index | 0);
        hash = fnv1a32UpdateInt(hash, f.alpha | 0);
        hash = fnv1a32UpdateInt(hash, f.priority | 0);
        hash = fnv1a32UpdateInt(hash, f.textureId | 0);
        hash = fnv1a32UpdateInt(hash, isTrans ? 1 : 0);
    }
    return {
        faceCount: faces.length | 0,
        opaqueCount: opaqueCount | 0,
        transparentCount: transparentCount | 0,
        hash: hash >>> 0,
    };
}

export function summarizeModelFaces(textureLoader: TextureLoader, model: Model): ModelFacesDigest {
    return summarizeModelFacesById((id) => textureLoader.isTransparent(id), model);
}

export function createModelInfoTextureData(drawCommands: readonly DrawCommand[]): Uint16Array {
    const instances: ModelInfo[] = [];
    for (const cmd of drawCommands) {
        instances.push(...cmd.instances);
    }
    const instanceCount = instances.length;

    const dataLength = Math.ceil((drawCommands.length * 4 + instanceCount) / 16) * 16;
    const textureData = new Uint16Array(Math.max(dataLength, 16) * 4);
    let dataOffset = 0;
    drawCommands.forEach((cmd, index) => {
        textureData[index * 4] = drawCommands.length + dataOffset;

        dataOffset += cmd.instances.length;
    });

    instances.forEach((data, index) => {
        let offset = drawCommands.length * 4 + index * 4;

        const contourGround = data.contourGround;

        const height = data.heightOffset;

        textureData[offset++] = data.sceneX | (data.level << 14);
        textureData[offset++] = data.sceneZ | (contourGround << 14);
        textureData[offset++] =
            (data.priority & 0x7) |
            ((data.interactId >> 16) << 3) |
            (data.interactType << 4) |
            (Math.round(height / 8) << 6);
        textureData[offset++] = data.interactId;
    });

    return textureData;
}
