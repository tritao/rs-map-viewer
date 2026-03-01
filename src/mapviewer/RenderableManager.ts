export type LoadRenderableFunction = (ids: number[]) => void;
export type RemoveRenderableFunction = (id: number) => void;

export class RenderableManager {
    invalidIds: Set<number> = new Set();
    loadingIds: Set<number> = new Set();

    renderables: Set<number> = new Set();

    constructor(
        readonly maxQueuedTasks: number,
        readonly loadRenderableFunction: LoadRenderableFunction,
        readonly removeRenderableFunction: RemoveRenderableFunction,
    ) {}

    init(): void {
        this.cleanUp();
    }

    clear(): void {
        this.invalidIds.clear();
        this.loadingIds.clear();
        for (const model of this.renderables.values()) {
            this.removeRenderableFunction(model);
        }
        this.renderables.clear();
    }

    add(id: number): void {
        this.loadingIds.delete(id);
        this.invalidIds.delete(id);
        if (this.renderables.has(id)) {
            this.removeRenderableFunction(id);
            this.renderables.delete(id);
        }
        this.renderables.add(id);
    }

    remove(id: number): void {
        if (this.renderables.has(id)) {
            this.removeRenderableFunction(id);
            this.renderables.delete(id);
        }
    }

    addInvalid(id: number): void {
        this.invalidIds.add(id);
        this.loadingIds.delete(id);
    }

    load(id: number): void {
        if (
            this.renderables.has(id) ||
            this.invalidIds.has(id) ||
            this.loadingIds.has(id) ||
            this.loadingIds.size > this.maxQueuedTasks
        ) {
            return;
        }
        //console.log("Loading renderable", id);
        this.loadingIds.add(id);
        this.loadRenderableFunction([id]);
    }

    cleanUp(): void {
        this.clear();
    }
}
