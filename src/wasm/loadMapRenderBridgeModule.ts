export function resolveMapRenderBridgeModuleUrl(moduleUrl: string, baseUrl?: string): string {
    if (!baseUrl) {
        return moduleUrl;
    }
    try {
        return new URL(moduleUrl, baseUrl).href;
    } catch {
        return moduleUrl;
    }
}

export async function importMapRenderBridgeModule(
    moduleUrl?: string,
    baseUrl?: string,
): Promise<Record<string, unknown>> {
    if (!moduleUrl) {
        return (await import("./rs_map_render_backend_runtime.mjs")) as Record<string, unknown>;
    }
    const resolvedUrl = resolveMapRenderBridgeModuleUrl(moduleUrl, baseUrl);
    return (await import(/* @vite-ignore */ resolvedUrl)) as Record<string, unknown>;
}
