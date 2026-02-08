import {
    U64_ZERO,
    u64FromNumber,
    u64FromU32,
    u64IsNonZero,
    u64IsZero,
    u64Or,
    u64SetBit,
    u64Shl,
    u64Shr,
    u64TestBit,
    u64ToNumber,
} from "../../util/U64";

export enum EntityType {
    PLAYER = 0,
    NPC = 1,
    LOC = 2,
    OBJ = 3,
}

export type EntityTag = u64;

export const ENTITY_TAG_NONE: EntityTag = U64_ZERO;

export function hasEntityTag(tag: EntityTag): boolean {
    return u64IsNonZero(tag);
}

export function calculateEntityTag(
    tileX: number,
    tileY: number,
    entityType: EntityType,
    notInteractive: boolean,
    id: number,
): EntityTag {
    let tag = u64Or(u64FromU32(tileX & 0x7f), u64Shl(u64FromU32(tileY & 0x7f), 7));
    tag = u64Or(tag, u64Shl(u64FromU32(entityType & 0x3), 14));
    tag = u64Or(tag, u64Shl(u64FromNumber(id), 17));
    if (notInteractive) {
        tag = u64SetBit(tag, 16);
    }
    return tag;
}

export function isEntityInteractive(tag: EntityTag): boolean {
    if (u64IsZero(tag)) {
        return false;
    }
    return !u64TestBit(tag, 16);
}

export function getIdFromTag(tag: EntityTag): number {
    return u64ToNumber(u64Shr(tag, 17));
}

export function getEntityTypeFromTag(tag: EntityTag): EntityType {
    return u64ToNumber(u64Shr(tag, 14)) & 0x3;
}
