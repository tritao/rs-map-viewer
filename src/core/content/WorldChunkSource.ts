export type WorldChunkId = number;

export type WorldChunkRequest = Readonly<{
    chunkId: WorldChunkId;
    lod?: number;
}>;

export type WorldChunkData = Readonly<{
    chunkId: WorldChunkId;
    terrain?: Uint8Array;
    staticInstances?: Uint8Array;
    actorSpawns?: Uint8Array;
    metadata?: Record<string, unknown>;
}>;

export type WorldChunkSource = Readonly<{
    loadChunk(request: WorldChunkRequest): Promise<WorldChunkData | undefined>;
}>;
