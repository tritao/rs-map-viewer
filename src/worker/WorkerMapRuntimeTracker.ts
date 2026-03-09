export class WorkerMapRuntimeTracker {
    private readonly mapSimTokenByMapId = new Map<number, number>();
    private readonly warnedMissingRuntimeStateMapIds = new Set<number>();

    reset(): void {
        this.mapSimTokenByMapId.clear();
        this.warnedMissingRuntimeStateMapIds.clear();
    }

    tryAcceptMapSimToken(mapId: number, mapSimToken: number | undefined): boolean {
        const id = mapId | 0;
        const incoming = mapSimToken === undefined ? 0 : mapSimToken | 0;
        const current = this.mapSimTokenByMapId.get(id) ?? 0;
        if (incoming < current) {
            return false;
        }
        this.mapSimTokenByMapId.set(id, incoming);
        return true;
    }

    clearMissingRuntimeStateWarning(mapId: number): void {
        this.warnedMissingRuntimeStateMapIds.delete(mapId | 0);
    }

    consumeMissingRuntimeStateWarning(mapId: number): boolean {
        const id = mapId | 0;
        if (this.warnedMissingRuntimeStateMapIds.has(id)) {
            return false;
        }
        this.warnedMissingRuntimeStateMapIds.add(id);
        return true;
    }
}
