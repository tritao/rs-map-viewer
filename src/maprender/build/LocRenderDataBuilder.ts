import { LocType } from "../../rs/config/loctype/LocType";
import { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { VarProvider } from "../../rs/config/vartype/VarProvider";
import { Scene } from "../../rs/scene/Scene";
import { LocModelLoader } from "../../rs/scene/model/LocModelLoader";
import type { AnimationFrames } from "../../runtime/entities/AnimationFrames";
import type { DrawRange } from "../MapRenderData";
import { type LocAnimatedGroup, createLocAnimatedGroupKey } from "./LocAnimatedGroup";
import { resolveLocRenderPlacement } from "./LocPlacementResolver";
import type { SceneGeometryBuffer, SceneModel } from "./SceneGeometryBuffer";
import type { SceneLocEntity } from "./SceneLocEntity";

const NULL_DRAW_RANGE: DrawRange = [0, 0, 0];

export type LocAnimatedGroupBuild = {
    seqId: number;
    type: number;
    rotation: number;
    locType: LocType;
    locs: SceneLocEntity[];
};

export function buildLocAnimationFrames(
    locModelLoader: LocModelLoader,
    seqTypeLoader: SeqTypeLoader,
    sceneBuf: SceneGeometryBuffer,
    locType: LocType,
    type: number,
    rotation: number,
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
        const model = locModelLoader.getModelAnimated(locType, type, rotation, seqId, i);
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

function pushLocEntityRenderData(
    locAnimatedGroupMap: Map<number, LocAnimatedGroupBuild>,
    locModelLoader: LocModelLoader,
    locTypeLoader: LocTypeLoader,
    varManager: VarProvider,
    scene: Scene,
    sceneModels: SceneModel[],
    sceneLocEntity: SceneLocEntity,
    idIsResolved: boolean,
): void {
    const entity = sceneLocEntity.entity;
    const resolved = resolveLocRenderPlacement(
        scene,
        sceneLocEntity,
        locTypeLoader,
        varManager,
        idIsResolved,
    );
    if (!resolved) {
        return;
    }

    if (entity.seqId !== -1) {
        const loc = {
            ...sceneLocEntity,
            lowDetail: resolved.lowDetail,
            interactId: resolved.locType.id,
        };

        const key = createLocAnimatedGroupKey(
            resolved.rotation,
            resolved.type,
            resolved.locType.id,
        );
        const group = locAnimatedGroupMap.get(key);
        if (group) {
            group.locs.push(loc);
        } else {
            locAnimatedGroupMap.set(key, {
                seqId: entity.seqId,
                type: resolved.type,
                rotation: resolved.rotation,
                locType: resolved.locType,
                locs: [loc],
            });
        }
        return;
    }

    const model = locModelLoader.getModelAnimated(
        resolved.locType,
        resolved.type,
        resolved.rotation,
        -1,
        -1,
        resolved.contourGroundInfo,
    );
    if (!model) {
        return;
    }

    sceneModels.push({
        ...sceneLocEntity,
        model,
        sceneHeight: resolved.centerHeight,
        lowDetail: resolved.lowDetail,
        // Any terrain-contoured model differs per placement; force per-placement merge.
        forceMerge: resolved.locType.contourGroundType > 0,
        interactId: resolved.locType.id,
    });
}

export function appendLocEntitiesToSceneModels(
    locModelLoader: LocModelLoader,
    locTypeLoader: LocTypeLoader,
    varManager: VarProvider,
    scene: Scene,
    sceneModels: SceneModel[],
    locEntities: SceneLocEntity[],
): Iterable<LocAnimatedGroupBuild> {
    const locAnimatedGroupMap = new Map<number, LocAnimatedGroupBuild>();

    for (const sceneLocEntity of locEntities) {
        pushLocEntityRenderData(
            locAnimatedGroupMap,
            locModelLoader,
            locTypeLoader,
            varManager,
            scene,
            sceneModels,
            sceneLocEntity,
            false,
        );
    }

    return locAnimatedGroupMap.values();
}

export function buildLocAnimatedGroups(
    buildGroups: Iterable<LocAnimatedGroupBuild>,
    buildFrames: (group: LocAnimatedGroupBuild) => AnimationFrames | undefined,
): LocAnimatedGroup[] {
    const groups: LocAnimatedGroup[] = [];
    for (const group of buildGroups) {
        const anim = buildFrames(group);
        if (!anim) {
            continue;
        }
        groups.push({ anim, locs: group.locs });
    }
    return groups;
}
