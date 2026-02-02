export class CacheFiles {
    static readonly DAT_FILE_NAME: string = "main_file_cache.dat";
    static readonly DAT2_FILE_NAME: string = "main_file_cache.dat2";

    static readonly INDEX_FILE_PREFIX: string = "main_file_cache.idx";

    static readonly META_FILE_NAME: string = "main_file_cache.idx255";

    static readonly DAT_INDEX_COUNT: number = 5;

    constructor(readonly files: Map<string, ArrayBuffer>) {}
}

