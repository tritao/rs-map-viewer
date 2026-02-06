import { errorToString } from "../../util/ErrorUtil";

export type InitError =
    | { kind: "missing_index"; indexId: number; description: string }
    | { kind: "missing_archive"; indexId: number; archiveId: number; description: string }
    | { kind: "create_failed"; description: string; error: string }
    | { kind: "unexpected"; error: string };

export function missingIndex(indexId: number, description: string): InitError {
    return { kind: "missing_index", indexId, description };
}

export function missingArchive(indexId: number, archiveId: number, description: string): InitError {
    return { kind: "missing_archive", indexId, archiveId, description };
}

export function createFailed(description: string, error: unknown): InitError {
    return { kind: "create_failed", description, error: errorToString(error) };
}

export function unexpected(error: unknown): InitError {
    return { kind: "unexpected", error: errorToString(error) };
}

export function initErrorToString(error: InitError): string {
    switch (error.kind) {
        case "missing_index":
            return `Missing ${error.description} index (index=${error.indexId})`;
        case "missing_archive":
            return `Missing ${error.description} archive (index=${error.indexId} archive=${error.archiveId})`;
        case "create_failed":
            return `Failed creating ${error.description}: ${error.error}`;
        case "unexpected":
            return error.error;
    }
}

