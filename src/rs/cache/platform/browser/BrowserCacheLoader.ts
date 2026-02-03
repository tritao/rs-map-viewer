import { CachedFile, CacheLoader, DownloadProgress, ProgressListener } from "../CacheLoader";

function ReadableBufferStream(ab: ArrayBuffer): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(ab));
            controller.close();
        },
    });
}

export class BrowserCacheLoader implements CacheLoader {
    async fetchCachedFile(
        baseUrl: string,
        name: string,
        shared: boolean,
        incremental: boolean,
        cacheName: string,
        signal?: AbortSignal,
        progressListener?: ProgressListener,
    ): Promise<CachedFile> {
        const cache = await caches.open(cacheName);
        return fetchCachedFile(baseUrl, name, shared, incremental, cache, signal, progressListener)
    }
}

async function toBufferParts(
    response: Response,
    offset: number,
    progressListener?: ProgressListener,
): Promise<Uint8Array[]> {
    if (!response.body) {
        return [];
    }
    const contentLength = offset + Number(response.headers.get("Content-Length") || 0);

    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let currentLength = offset;

    if (progressListener) {
        progressListener({
            total: contentLength,
            current: currentLength,
            part: new Uint8Array(0),
        });
    }

    for (let res = await reader.read(); !res.done && res.value; res = await reader.read()) {
        parts.push(res.value);
        currentLength += res.value.byteLength;
        if (progressListener) {
            progressListener({
                total: contentLength,
                current: currentLength,
                part: res.value,
            });
        }
    }
    return parts;
}

function partsToBuffer(parts: Uint8Array[], shared: boolean): ArrayBuffer {
    let totalLength = 0;
    for (const part of parts) {
        totalLength += part.byteLength;
    }

    const sab = shared ? new SharedArrayBuffer(totalLength) : new ArrayBuffer(totalLength);
    const u8 = new Uint8Array(sab);
    let offset = 0;
    for (const buffer of parts) {
        u8.set(buffer, offset);
        offset += buffer.byteLength;
    }
    return sab;
}

export async function fetchCachedFile(
    baseUrl: string,
    name: string,
    shared: boolean,
    incremental: boolean,
    cache: Cache,
    signal?: AbortSignal,
    progressListener?: ProgressListener,
): Promise<CachedFile> {
    const path = baseUrl + name;
    const cachedResp = await cache.match(path);
    if (cachedResp) {
        const parts = await toBufferParts(cachedResp, 0, progressListener);
        return {
            name,
            data: partsToBuffer(parts, shared),
        };
    }
    const partUrls: RequestInfo[] = [];
    const partBuffers: Uint8Array[][] = [];
    if (incremental) {
        const partResponses = await cache.matchAll(path + "/part/", {
            ignoreSearch: true,
        });
        for (const partResp of partResponses) {
            const index = parseInt(partResp.headers.get("Cache-Part") || "0");
            partUrls.push(path + "/part/?p=" + index);
            partBuffers[index] = await toBufferParts(partResp, 0);
        }
    }

    const parts: Uint8Array[] = [];
    let partCount = 0;
    let offset = 0;
    for (let i = 0; i < partBuffers.length; i++) {
        const partBuffer = partBuffers[i];
        if (!partBuffer) {
            break;
        }
        partCount++;
        for (const part of partBuffer) {
            parts.push(part);
            offset += part.byteLength;
        }
    }

    const headers: HeadersInit = {};

    if (offset > 0) {
        headers["Range"] = `bytes=${offset}-${Number.MAX_SAFE_INTEGER}`;
    }

    const resp = await fetch(path, {
        headers,
        signal,
    });
    if (resp.status !== 200 && resp.status !== 206) {
        throw new Error("Failed downloading " + path + ", " + resp.status);
    }
    const cacheUpdates: Promise<void>[] = [];
    let partCache: Uint8Array[] = [];
    let partCacheLength = 0;
    const partProgressListener = (progress: DownloadProgress) => {
        if (incremental && progress.part.byteLength > 0) {
            partCache.push(progress.part);
            partCacheLength += progress.part.byteLength;

            // cache every 1% of the total file size
            const partCacheThreshold = Math.max(progress.total * 0.01, 1000 * 1024);

            if (partCacheLength > partCacheThreshold) {
                const partUrl = path + "/part/?p=" + partCount;
                partUrls.push(partUrl);
                const partResp = new Response(
                    ReadableBufferStream(partsToBuffer(partCache, false)),
                    {
                        status: 200,
                        headers: {
                            "Content-Type": "application/octet-stream",
                            "Content-Length": partCacheLength.toString(),
                            "Cache-Part": partCount.toString(),
                        },
                    },
                );
                Object.defineProperty(partResp, "url", { value: partUrl });
                const update = cache.put(partUrl, partResp);
                cacheUpdates.push(update);
                partCount++;

                partCache = [];
                partCacheLength = 0;
            }
        }
        if (progressListener) {
            progressListener(progress);
        }
    };
    const newParts = await toBufferParts(resp, offset, partProgressListener);
    for (const part of newParts) {
        parts.push(part);
    }

    const buffer = partsToBuffer(parts, shared);

    cache.put(
        path,
        new Response(ReadableBufferStream(buffer), {
            status: 200,
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": buffer.byteLength.toString(),
            },
        }),
    );

    if (incremental) {
        await Promise.all(cacheUpdates);
        for (const url of partUrls) {
            cache.delete(url);
        }
    }

    return {
        name,
        data: buffer,
    };
}
