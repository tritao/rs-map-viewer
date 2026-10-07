import type { MapRenderContentSession } from "../../core/build/MapRenderContentSession";
import type {
    AnimationCatalog,
    ContentSession,
    DefinitionCatalog,
    MaterialCatalog,
} from "../../core/content/ContentSession";
import type { WorldChunkSource } from "../../core/content/WorldChunkSource";
import type { CacheSession } from "../../rs/loaders/CacheSession";
import { initErrorToString } from "../../rs/loaders/InitError";
import { MapFileBytesProvider } from "../../rs/map/MapBytesProvider";
import type { ModelLoader } from "../../rs/model/ModelLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import type { TextureLoader } from "../../rs/texture/TextureLoader";
import { RunescapeWorldChunkSource } from "./RunescapeWorldChunkSource";

function unwrapResult<T>(value: { ok: true; value: T } | { ok: false }): T | undefined {
    return value.ok ? value.value : undefined;
}

export class RunescapeContentSession implements ContentSession, MapRenderContentSession {
    readonly format = "runescape-cache" as const;

    private readonly chunkSource: RunescapeWorldChunkSource;
    private readonly definitionCatalog: DefinitionCatalog;
    private readonly animationCatalog: AnimationCatalog;
    private readonly materialCatalog: MaterialCatalog;

    constructor(private readonly session: CacheSession) {
        this.chunkSource = new RunescapeWorldChunkSource(
            new MapFileBytesProvider(session.getMapFileLoader(), session.cache.xteas),
        );
        this.definitionCatalog = {
            getObjectDef: async (id: number) => {
                const value = unwrapResult(this.session.tryLoadLocType(id));
                return value ? { id: id | 0, raw: value } : undefined;
            },
            getActorDef: async (id: number) => {
                const value = unwrapResult(this.session.tryLoadNpcType(id));
                return value ? { id: id | 0, raw: value } : undefined;
            },
            getItemDef: async (id: number) => {
                const value = unwrapResult(this.session.tryLoadObjType(id));
                return value ? { id: id | 0, raw: value } : undefined;
            },
            getVarValueResolver: () => this.session.varManager,
        };
        this.animationCatalog = {
            getObjectAnimationSet: async (id: number) =>
                unwrapResult(this.session.tryLoadLocType(id)),
            getActorAnimationSet: async (id: number) =>
                unwrapResult(this.session.tryLoadNpcType(id)),
            getClip: async (id: number) => unwrapResult(this.session.tryLoadSeqType(id)),
        };
        this.materialCatalog = {
            getMaterial: async (id: number) => {
                const textureLoader = this.session.getTextureLoader();
                return (
                    textureLoader.tryGetMaterial(id) ??
                    unwrapResult(textureLoader.tryLoadMaterial(id))
                );
            },
            getPixelsArgb: async (id: number, size: number) =>
                this.session.getTextureLoader().tryGetPixelsArgb(id, size, false, 1.0),
        };
    }

    getWorldChunkSource(): WorldChunkSource {
        return this.chunkSource;
    }

    getMapRenderCacheInfo() {
        return this.session.cache.info;
    }

    getMapRenderLocTypeLoader() {
        return this.session.loaders.locTypeLoader;
    }

    getMapRenderObjTypeLoader() {
        return this.session.loaders.objTypeLoader;
    }

    getMapRenderNpcTypeLoader() {
        return this.session.loaders.npcTypeLoader;
    }

    getMapRenderBasTypeLoader() {
        return this.session.loaders.basTypeLoader;
    }

    getMapRenderSeqTypeLoader() {
        return this.session.loaders.seqTypeLoader;
    }

    getMapRenderVarBitTypeLoader() {
        return this.session.loaders.varBitTypeLoader;
    }

    getMapRenderUnderlayTypeLoader() {
        return this.session.loaders.underlayTypeLoader;
    }

    getMapRenderOverlayTypeLoader() {
        return this.session.loaders.overlayTypeLoader;
    }

    getMapRenderTextureLoader() {
        return this.session.getTextureLoader() as TextureLoader;
    }

    getMapRenderModelLoader() {
        return this.session.loaders.modelLoader as ModelLoader;
    }

    getMapRenderSeqFrameLoader() {
        return this.session.loaders.seqFrameLoader as SeqFrameLoader;
    }

    getMapRenderSkeletalSeqLoader() {
        return this.session.loaders.skeletalSeqLoader as SkeletalSeqLoader | undefined;
    }

    getMapRenderVarpValuesSnapshot() {
        return this.session.varManager.values instanceof Int32Array
            ? new Int32Array(this.session.varManager.values)
            : new Int32Array(0);
    }

    getDefinitionCatalog(): DefinitionCatalog {
        return this.definitionCatalog;
    }

    getAnimationCatalog(): AnimationCatalog {
        return this.animationCatalog;
    }

    getMaterialCatalog(): MaterialCatalog {
        return this.materialCatalog;
    }

    getRunescapeWorldChunkSource(): RunescapeWorldChunkSource {
        return this.chunkSource;
    }

    getCacheSession(): CacheSession {
        return this.session;
    }

    clearCaches(): void {
        this.session.clearCaches();
    }

    async fork(): Promise<ContentSession> {
        const forkResult = this.session.tryFork();
        if (!forkResult.ok) {
            throw new Error(initErrorToString(forkResult.error));
        }
        return new RunescapeContentSession(forkResult.value);
    }
}

export function requireRunescapeContentSession(
    contentSession: ContentSession,
): RunescapeContentSession {
    if (contentSession instanceof RunescapeContentSession) {
        return contentSession;
    }
    throw new Error("Expected RunescapeContentSession");
}
