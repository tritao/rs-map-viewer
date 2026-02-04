export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ArchiveId = Brand<number, "ArchiveId">;
export type FileId = Brand<number, "FileId">;
export type MapSquareId = Brand<number, "MapSquareId">;

export type LocId = Brand<number, "LocId">;
export type NpcId = Brand<number, "NpcId">;
export type ObjId = Brand<number, "ObjId">;

export function asArchiveId(value: number): ArchiveId {
    return value as ArchiveId;
}

export function asFileId(value: number): FileId {
    return value as FileId;
}

export function asMapSquareId(value: number): MapSquareId {
    return value as MapSquareId;
}

export function asLocId(value: number): LocId {
    return value as LocId;
}

export function asNpcId(value: number): NpcId {
    return value as NpcId;
}

export function asObjId(value: number): ObjId {
    return value as ObjId;
}

