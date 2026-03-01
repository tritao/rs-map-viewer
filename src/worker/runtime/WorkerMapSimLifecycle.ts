export class WorkerMapSimLifecycle {
    private readonly mapSimTokenByMapId = new Map<number, number>();
    private readonly warnedMissingTickStateMapIds = new Set<number>();

    reset(): void {
        this.mapSimTokenByMapId.clear();
        this.warnedMissingTickStateMapIds.clear();
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

    clearMissingTickStateWarning(mapId: number): void {
        this.warnedMissingTickStateMapIds.delete(mapId | 0);
    }

    consumeMissingTickStateWarning(mapId: number): boolean {
        const id = mapId | 0;
        if (this.warnedMissingTickStateMapIds.has(id)) {
            return false;
        }
        this.warnedMissingTickStateMapIds.add(id);
        return true;
    }
}
