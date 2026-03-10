import type {
    EntityViewerKind,
    EntityViewerObjMode,
    EntityViewerRequest,
} from "./EntityViewerData";

export const DEFAULT_ENTITY_VIEWER_IDS_BY_KIND: Record<EntityViewerKind, number> = {
    obj: 4151,
    npc: 1,
    loc: 10,
    model: 0,
};

function parseEntityViewerKind(value: string | null): EntityViewerKind {
    switch (value) {
        case "npc":
        case "loc":
        case "model":
            return value;
        default:
            return "obj";
    }
}

function parseEntityViewerObjMode(value: string | null): EntityViewerObjMode {
    return value === "world" ? "world" : "icon";
}

function patchSearchParams(
    current: URLSearchParams,
    patch: Record<string, string | undefined>,
): URLSearchParams {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value.length <= 0) {
            next.delete(key);
        } else {
            next.set(key, value);
        }
    }
    return next;
}

export function parseEntityViewerRequest(searchParams: URLSearchParams): EntityViewerRequest {
    const kind = parseEntityViewerKind(searchParams.get("kind"));
    const id = Number.parseInt(searchParams.get("id") ?? "4151", 10);
    const count = Number.parseInt(searchParams.get("count") ?? "1", 10);
    const rotation = Number.parseInt(searchParams.get("rotation") ?? "0", 10);
    const npcSeqId = Number.parseInt(searchParams.get("npcSeqId") ?? "-1", 10);
    return {
        kind,
        id: Number.isFinite(id) ? Math.max(0, id | 0) : DEFAULT_ENTITY_VIEWER_IDS_BY_KIND[kind],
        count: Number.isFinite(count) ? Math.max(1, count | 0) : 1,
        rotation: Number.isFinite(rotation) ? rotation & 3 : 0,
        objMode: parseEntityViewerObjMode(searchParams.get("objMode")),
        icon36x32: searchParams.get("icon36x32") === "1",
        iconOutline: searchParams.get("iconOutline") !== "0",
        iconShadow: searchParams.get("iconShadow") !== "0",
        npcSeqId: Number.isFinite(npcSeqId) ? npcSeqId | 0 : -1,
        npcFrame: 0,
    };
}

export function getEntityViewerRenderTargetKey(request: EntityViewerRequest): string {
    switch (request.kind) {
        case "obj":
            return `obj:${request.id}:${request.count}:${request.objMode}`;
        case "npc":
            return `npc:${request.id}`;
        case "loc":
            return `loc:${request.id}`;
        case "model":
            return `model:${request.id}`;
    }
}

export function updateEntityViewerCacheSearchParams(
    current: URLSearchParams,
    cacheName: string,
): URLSearchParams {
    return patchSearchParams(current, { cache: cacheName });
}

export function updateEntityViewerRequestSearchParams(
    input: Readonly<{
        currentSearchParams: URLSearchParams;
        currentRequest: EntityViewerRequest;
        nextRequest: EntityViewerRequest;
        lastIdsByKind: Record<EntityViewerKind, number>;
    }>,
): URLSearchParams {
    const effectiveId =
        input.nextRequest.kind === input.currentRequest.kind
            ? input.nextRequest.id
            : input.lastIdsByKind[input.nextRequest.kind] ??
              DEFAULT_ENTITY_VIEWER_IDS_BY_KIND[input.nextRequest.kind];
    const resetNpcAnimation =
        input.nextRequest.kind === "npc" &&
        (input.currentRequest.kind !== "npc" || effectiveId !== input.currentRequest.id);
    return patchSearchParams(input.currentSearchParams, {
        kind: input.nextRequest.kind,
        id: effectiveId.toString(),
        count: input.nextRequest.count.toString(),
        rotation: input.nextRequest.rotation.toString(),
        objMode: input.nextRequest.kind === "obj" ? input.nextRequest.objMode : undefined,
        icon36x32:
            input.nextRequest.kind === "obj" && input.nextRequest.icon36x32 ? "1" : undefined,
        iconOutline:
            input.nextRequest.kind === "obj" && !input.nextRequest.iconOutline
                ? "0"
                : undefined,
        iconShadow:
            input.nextRequest.kind === "obj" && !input.nextRequest.iconShadow
                ? "0"
                : undefined,
        npcSeqId:
            input.nextRequest.kind === "npc" &&
            !resetNpcAnimation &&
            input.nextRequest.npcSeqId >= 0
                ? input.nextRequest.npcSeqId.toString()
                : undefined,
    });
}
