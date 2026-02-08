export class RendererStats {
    frameStart: number;
    tickTime: number;
    interactionsTime: number;

    opaquePassTime: number;
    opaqueNpcPassTime: number;
    transparentPassTime: number;
    transparentNpcPassTime: number;

    constructor() {
        this.frameStart = 0;
        this.tickTime = 0;
        this.interactionsTime = 0;
        this.opaquePassTime = 0;
        this.opaqueNpcPassTime = 0;
        this.transparentPassTime = 0;
        this.transparentNpcPassTime = 0;
    }
}
