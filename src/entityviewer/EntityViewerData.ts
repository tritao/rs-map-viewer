import { InteractType } from "../renderer/InteractType";
import { GameType } from "../rs/cache/CacheInfo";
import { VarManagerProvider } from "../rs/config/vartype/VarProvider";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import type { CacheSession } from "../rs/loaders/CacheSession";
import { Model } from "../rs/model/Model";
import { ModelData } from "../rs/model/ModelData";
import { isModelData } from "../rs/model/ModelData";
import { LocModelLoader } from "../rs/scene/model/LocModelLoader";
import { NpcModelLoader } from "../rs/scene/model/NpcModelLoader";
import { ObjModelLoader } from "../rs/scene/model/ObjModelLoader";
import { buildStandaloneRenderableData, type StandaloneRenderableData } from "../runtime/build/StandaloneRenderableDataBuilder";
import {
    renderObjIconSprite,
    renderLegacyObjIconSprite,
    type ObjIconSprite,
} from "./ObjIconSpriteRenderer";

export type EntityViewerKind = "obj" | "npc" | "loc" | "model";
export type EntityViewerObjMode = "icon" | "icon-viewer" | "world";

export type EntityViewerRequest = Readonly<{
    kind: EntityViewerKind;
    id: number;
    count: number;
    rotation: number;
    objMode: EntityViewerObjMode;
    legacyIconMath: boolean;
}>;

export type EntityViewerResolvedData = Readonly<{
    label: string;
    renderData?: StandaloneRenderableData;
    iconSprite?: ObjIconSprite;
}>;

export type EntityViewerServices = Readonly<{
    session: CacheSession;
    objModelLoader: ObjModelLoader;
    npcModelLoader: NpcModelLoader;
    locModelLoader: LocModelLoader;
}>;

export function createEntityViewerServices(session: CacheSession): EntityViewerServices {
    const {
        objTypeLoader,
        npcTypeLoader,
        locTypeLoader,
        modelLoader,
        textureLoader,
        seqTypeLoader,
        seqFrameLoader,
    } = session.loaders;
    const skeletalSeqLoader = session.getSkeletalSeqLoader();
    const varProvider = new VarManagerProvider(session.varManager);
    return {
        session,
        objModelLoader: new ObjModelLoader(objTypeLoader, modelLoader, textureLoader),
        npcModelLoader: new NpcModelLoader(
            npcTypeLoader,
            modelLoader,
            textureLoader,
            seqTypeLoader,
            seqFrameLoader,
            skeletalSeqLoader,
            varProvider,
        ),
        locModelLoader: new LocModelLoader(
            locTypeLoader,
            modelLoader,
            textureLoader,
            seqTypeLoader,
            seqFrameLoader,
            skeletalSeqLoader,
        ),
    };
}

function buildObjData(
    services: EntityViewerServices,
    request: EntityViewerRequest,
): EntityViewerResolvedData {
    const objResult = services.session.loaders.objTypeLoader.tryLoad(request.id | 0);
    if (!objResult.ok) {
        throw new Error(`Object ${request.id | 0} not found`);
    }
    const iconModelResult =
        request.objMode === "icon" || request.objMode === "icon-viewer"
            ? buildObjIconModel(services, request.id | 0, request.count | 0)
            : undefined;
    const model =
        request.objMode === "icon" || request.objMode === "icon-viewer"
            ? iconModelResult?.model
            : services.objModelLoader.getModel(request.id | 0, request.count | 0);
    if (!model) {
        throw new Error(`Object ${request.id | 0} has no renderable model`);
    }
    const iconSprite =
        request.objMode === "icon" || request.objMode === "icon-viewer"
            ? request.legacyIconMath
                ? renderLegacyObjIconSprite(
                      model,
                      iconModelResult?.zoom2d ?? 2000,
                      iconModelResult?.xan2d ?? 0,
                      iconModelResult?.yan2d ?? 0,
                      iconModelResult?.zan2d ?? 0,
                      iconModelResult?.offsetX2d ?? 0,
                      iconModelResult?.offsetY2d ?? 0,
                  )
                : renderObjIconSprite(
                      model,
                      iconModelResult?.zoom2d ?? 2000,
                      iconModelResult?.xan2d ?? 0,
                      iconModelResult?.yan2d ?? 0,
                      iconModelResult?.zan2d ?? 0,
                      iconModelResult?.offsetX2d ?? 0,
                      iconModelResult?.offsetY2d ?? 0,
                      request.objMode === "icon-viewer" ? "viewer" : "authentic",
                  )
            : undefined;
    const renderData =
        request.objMode === "icon" || request.objMode === "icon-viewer"
            ? undefined
            : buildStandaloneRenderableData({
                  textureLoader: services.session.loaders.textureLoader,
                  model,
                  interactType: InteractType.OBJ,
                  interactId: request.id | 0,
              });
    if (
        request.objMode !== "icon" &&
        request.objMode !== "icon-viewer" &&
        !renderData
    ) {
        throw new Error(`Failed to build object render data for ${request.id | 0}`);
    }
    return {
        label: `obj:${request.id | 0} ${objResult.value.name} (${request.objMode})`,
        renderData,
        iconSprite,
    };
}

function buildObjIconModel(
    services: EntityViewerServices,
    id: number,
    count: number,
): Readonly<{
    model: Model;
    zoom2d: number;
    xan2d: number;
    yan2d: number;
    zan2d: number;
    offsetX2d: number;
    offsetY2d: number;
}> | undefined {
    const objResult = services.session.loaders.objTypeLoader.tryLoad(id);
    if (!objResult.ok) {
        return undefined;
    }
    const objType = objResult.value;
    let resolvedId = id;
    if (objType.countObj && count > 1) {
        for (let i = 0; i < 10; i++) {
            if (count >= objType.countCo[i] && objType.countCo[i] !== 0) {
                resolvedId = objType.countObj[i];
            }
        }
    }
    const resolvedResult = services.session.loaders.objTypeLoader.tryLoad(resolvedId);
    if (!resolvedResult.ok) {
        return undefined;
    }
    const resolvedType = resolvedResult.value;
    if (resolvedType.model === undefined) {
        return undefined;
    }
    const rawModelData = services.session.loaders.modelLoader.tryGet(resolvedType.model);
    if (!rawModelData) {
        return undefined;
    }
    const modelData = ModelData.copyFrom(rawModelData, false, false, false, false);
    if (resolvedType.resizeX !== 128 || resolvedType.resizeY !== 128 || resolvedType.resizeZ !== 128) {
        modelData.resize(resolvedType.resizeX, resolvedType.resizeY, resolvedType.resizeZ);
    }
    if (resolvedType.recolorFrom) {
        const retextureOnRecolor =
            resolvedType.cacheInfo.game === GameType.Runescape &&
            resolvedType.cacheInfo.revision <= 377;
        for (let i = 0; i < resolvedType.recolorFrom.length; i++) {
            modelData.recolor(resolvedType.recolorFrom[i], resolvedType.recolorTo[i]);
            if (retextureOnRecolor) {
                modelData.retexture(resolvedType.recolorFrom[i], resolvedType.recolorTo[i]);
            }
        }
    }
    if (resolvedType.retextureFrom) {
        for (let i = 0; i < resolvedType.retextureFrom.length; i++) {
            modelData.retexture(resolvedType.retextureFrom[i], resolvedType.retextureTo[i]);
        }
    }
    const model = modelData.light(
        services.session.loaders.textureLoader,
        resolvedType.ambient + 96,
        resolvedType.contrast + 1024,
        -96,
        -160,
        -96,
    );
    model.calculateBoundsCylinder();
    return {
        model,
        zoom2d: resolvedType.zoom2d,
        xan2d: resolvedType.xan2d,
        yan2d: resolvedType.yan2d,
        zan2d: resolvedType.zan2d,
        offsetX2d: resolvedType.offsetX2d,
        offsetY2d: resolvedType.offsetY2d,
    };
}

function buildNpcData(
    services: EntityViewerServices,
    request: EntityViewerRequest,
): EntityViewerResolvedData {
    const npcResult = services.session.loaders.npcTypeLoader.tryLoad(request.id | 0);
    if (!npcResult.ok) {
        throw new Error(`NPC ${request.id | 0} not found`);
    }
    const model = services.npcModelLoader.getModel(npcResult.value, -1, -1);
    if (!model) {
        throw new Error(`NPC ${request.id | 0} has no renderable model`);
    }
    const renderData = buildStandaloneRenderableData({
        textureLoader: services.session.loaders.textureLoader,
        model,
        interactType: InteractType.NPC,
        interactId: request.id | 0,
    });
    if (!renderData) {
        throw new Error(`Failed to build NPC render data for ${request.id | 0}`);
    }
    return {
        label: `npc:${request.id | 0} ${npcResult.value.name}`,
        renderData,
    };
}

function buildLocData(
    services: EntityViewerServices,
    request: EntityViewerRequest,
): EntityViewerResolvedData {
    const locResult = services.session.loaders.locTypeLoader.tryLoad(request.id | 0);
    if (!locResult.ok) {
        throw new Error(`Loc ${request.id | 0} not found`);
    }
    const locType = locResult.value;
    const modelType = (locType.types?.[0] ?? LocModelType.NORMAL) as LocModelType;
    const rawModel = services.locModelLoader.getModel(
        locType,
        modelType,
        request.rotation & 3,
    );
    if (!rawModel) {
        throw new Error(`Loc ${request.id | 0} has no renderable model`);
    }
    const model = isModelData(rawModel)
        ? rawModel.light(
              services.session.loaders.textureLoader,
              locType.ambient + 64,
              locType.contrast + 768,
              -50,
              -10,
              -50,
          )
        : rawModel;
    const renderData = buildStandaloneRenderableData({
        textureLoader: services.session.loaders.textureLoader,
        model,
        interactType: InteractType.LOC,
        interactId: request.id | 0,
    });
    if (!renderData) {
        throw new Error(`Failed to build loc render data for ${request.id | 0}`);
    }
    return {
        label: `loc:${request.id | 0} ${locType.name}`,
        renderData,
    };
}

function buildModelData(
    services: EntityViewerServices,
    request: EntityViewerRequest,
): EntityViewerResolvedData {
    const modelData = services.session.loaders.modelLoader.tryGet(request.id | 0);
    if (!modelData) {
        throw new Error(`Model ${request.id | 0} not found`);
    }
    const model = modelData.light(
        services.session.loaders.textureLoader,
        64,
        768,
        -50,
        -10,
        -50,
    );
    const renderData = buildStandaloneRenderableData({
        textureLoader: services.session.loaders.textureLoader,
        model,
        interactType: InteractType.NONE,
        interactId: request.id | 0,
    });
    if (!renderData) {
        throw new Error(`Failed to build model render data for ${request.id | 0}`);
    }
    return {
        label: `model:${request.id | 0}`,
        renderData,
    };
}

export function resolveEntityViewerData(
    services: EntityViewerServices,
    request: EntityViewerRequest,
): EntityViewerResolvedData {
    switch (request.kind) {
        case "obj":
            return buildObjData(services, request);
        case "npc":
            return buildNpcData(services, request);
        case "loc":
            return buildLocData(services, request);
        case "model":
            return buildModelData(services, request);
    }
}
