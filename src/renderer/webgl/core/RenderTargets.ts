import type { Framebuffer, Renderbuffer, Texture } from "picogl";
import PicoGL, { type App as PicoApp } from "picogl";

export class RenderTargets {
    framebuffer?: Framebuffer;
    colorTarget?: Renderbuffer;
    interactTarget?: Renderbuffer;
    depthTarget?: Renderbuffer;

    textureColorTarget?: Texture;
    textureFramebuffer?: Framebuffer;

    interactColorTarget?: Texture;
    interactFramebuffer?: Framebuffer;

    init(app: PicoApp, gl: WebGL2RenderingContext, msaaEnabled: boolean): void {
        this.initSecondary(app);
        this.initMain(app, gl, msaaEnabled);
    }

    initSecondary(app: PicoApp): void {
        this.textureFramebuffer?.delete();
        this.textureFramebuffer = undefined;
        this.textureColorTarget?.delete();
        this.textureColorTarget = undefined;

        this.interactFramebuffer?.delete();
        this.interactFramebuffer = undefined;
        this.interactColorTarget?.delete();
        this.interactColorTarget = undefined;

        // Post-process sampling target.
        this.textureColorTarget = app.createTexture2D(app.width, app.height, {
            minFilter: PicoGL.LINEAR,
            magFilter: PicoGL.LINEAR,
        });
        this.textureFramebuffer = app.createFramebuffer().colorTarget(0, this.textureColorTarget);

        // Interaction-picking target.
        this.interactColorTarget = app.createTexture2D(app.width, app.height, {
            internalFormat: PicoGL.RGBA32F,
            type: PicoGL.FLOAT,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
        });
        this.interactFramebuffer = app.createFramebuffer().colorTarget(0, this.interactColorTarget);
    }

    initMain(app: PicoApp, gl: WebGL2RenderingContext, msaaEnabled: boolean): void {
        this.framebuffer?.delete();
        this.framebuffer = undefined;
        this.colorTarget?.delete();
        this.colorTarget = undefined;
        this.interactTarget?.delete();
        this.interactTarget = undefined;
        this.depthTarget?.delete();
        this.depthTarget = undefined;

        let samples = 0;
        if (msaaEnabled) {
            samples = gl.getParameter(PicoGL.MAX_SAMPLES);
        }

        this.colorTarget = app.createRenderbuffer(app.width, app.height, PicoGL.RGBA8, samples);
        this.interactTarget = app.createRenderbuffer(app.width, app.height, PicoGL.RGBA32F, samples);
        this.depthTarget = app.createRenderbuffer(
            app.width,
            app.height,
            PicoGL.DEPTH_COMPONENT24,
            samples,
        );

        this.framebuffer = app
            .createFramebuffer()
            .colorTarget(0, this.colorTarget)
            .colorTarget(1, this.interactTarget)
            .depthTarget(this.depthTarget);
    }

    resize(): void {
        this.framebuffer?.resize();
        this.textureFramebuffer?.resize();
        this.interactFramebuffer?.resize();
    }

    dispose(): void {
        this.framebuffer?.delete();
        this.framebuffer = undefined;
        this.colorTarget?.delete();
        this.colorTarget = undefined;
        this.interactTarget?.delete();
        this.interactTarget = undefined;
        this.depthTarget?.delete();
        this.depthTarget = undefined;

        this.textureFramebuffer?.delete();
        this.textureFramebuffer = undefined;
        this.textureColorTarget?.delete();
        this.textureColorTarget = undefined;

        this.interactFramebuffer?.delete();
        this.interactFramebuffer = undefined;
        this.interactColorTarget?.delete();
        this.interactColorTarget = undefined;
    }
}

