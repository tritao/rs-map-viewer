import type { WorldChunkSource } from "./WorldChunkSource";

export type ContentFormatId = "runescape-cache" | "studio-world" | "server-snapshot";

export type DefinitionRecord = Readonly<{
    id: number;
    raw: unknown;
}>;

export type DefinitionCatalog = Readonly<{
    getObjectDef(id: number): Promise<DefinitionRecord | undefined>;
    getActorDef(id: number): Promise<DefinitionRecord | undefined>;
    getItemDef?(id: number): Promise<DefinitionRecord | undefined>;
    getVarValueResolver?(): unknown;
}>;

export type AnimationCatalog = Readonly<{
    getObjectAnimationSet(id: number): Promise<unknown | undefined>;
    getActorAnimationSet(id: number): Promise<unknown | undefined>;
    getClip(id: number): Promise<unknown | undefined>;
}>;

export type MaterialCatalog = Readonly<{
    getMaterial(id: number): Promise<unknown | undefined>;
    getPixelsArgb(id: number, size: number): Promise<Int32Array | undefined>;
}>;

export type ContentSession = Readonly<{
    format: ContentFormatId;
    getWorldChunkSource(): WorldChunkSource;
    getDefinitionCatalog(): DefinitionCatalog;
    getAnimationCatalog(): AnimationCatalog;
    getMaterialCatalog(): MaterialCatalog;
    clearCaches(): void;
    fork(): Promise<ContentSession>;
}>;
