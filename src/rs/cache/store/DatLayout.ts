/**
 * Dat/Dat2 cache layout constants.
 */
export const IDX_ENTRY_SIZE: number = 6; // 3-byte length + 3-byte first-sector pointer

export const SECTOR_HEADER_SIZE: number = 8;
export const SECTOR_DATA_SIZE: number = 512;
export const SECTOR_SIZE: number = SECTOR_HEADER_SIZE + SECTOR_DATA_SIZE;

export const SECTOR_EXTENDED_HEADER_SIZE: number = 10;
export const SECTOR_EXTENDED_DATA_SIZE: number = 510;
