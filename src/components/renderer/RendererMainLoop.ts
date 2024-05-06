import { Renderer } from "../../renderer/Renderer";
import { pixelRatio } from "../../util/DeviceUtil";
function resizeCanvas(canvas: HTMLCanvasElement) {
    const devicePixelRatio = pixelRatio;
    const width = canvas.offsetWidth * devicePixelRatio;
    const height = canvas.offsetHeight * devicePixelRatio;

    if (width !== canvas.width || height !== canvas.height) {
        canvas.width = width;
        canvas.height = height;
        return true;
    }

    return false;
}

export class RendererMainLoop {
    canvas: HTMLCanvasElement;
    animationId: number | undefined;
    running: boolean = false;
    fpsLimit: number = 999;
    renderer!: Renderer | undefined;

    constructor() {
        this.canvas = document.createElement("canvas");
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.tabIndex = 0;
    }

    async init(): Promise<void> {
        this.renderer!.init(this.canvas);
    }

    cleanUp(): void {
        this.renderer!.cleanUp();
    }

    start() {
        this.running = true;
        this.animationId = requestAnimationFrame(this.frameCallback);
    }

    stop() {
        this.running = false;
        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
        this.cleanUp();
    }

    onResize(width: number, height: number) {
        this.renderer!.onResize(width, height);
    }

    frameCallback = (time: DOMHighResTimeStamp) => {
        try {
            const resized = resizeCanvas(this.canvas);
            if (resized) {
                this.onResize(this.canvas.width, this.canvas.height);
            }

            const deltaTime = this.renderer!.stats.getDeltaTime(time);

            if (this.fpsLimit && deltaTime > 0) {
                const tolerance = 1;
                if (deltaTime < 1000 / this.fpsLimit - tolerance) {
                    return;
                }
            }

            this.renderer!.stats.update(time);
            this.update(time, deltaTime);

            this.render(time, deltaTime, resized);

            this.onFrameEnd();
        } finally {
            if (this.running) {
                this.animationId = requestAnimationFrame(this.frameCallback);
            }
        }
    };

    update(time: number, deltaTime: number): void {}

    render(
        time: DOMHighResTimeStamp,
        deltaTime: DOMHighResTimeStamp,
        resized: boolean,
    ): void {
        this.renderer!.render(time, deltaTime, resized);
    }

    onFrameEnd() {
        this.renderer!.onFrameEnd();
    }
}
