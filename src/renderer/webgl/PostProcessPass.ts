import type { DrawCall } from "picogl";
import PicoGL, { type App as PicoApp } from "picogl";

import type { RenderTargets } from "./RenderTargets";

export class PostProcessPass {
    blitSceneToTexture(app: PicoApp, gl: WebGL2RenderingContext, targets: RenderTargets): void {
        // Can't sample from renderbuffer so blit to a texture for sampling.
        app.readFramebuffer(targets.framebuffer!);
        app.drawFramebuffer(targets.textureFramebuffer!);
        gl.readBuffer(PicoGL.COLOR_ATTACHMENT0);
        app.blitFramebuffer(PicoGL.COLOR_BUFFER_BIT);
    }

    present(
        app: PicoApp,
        targets: RenderTargets,
        resolutionUni: Float32Array,
        frameDrawCall: DrawCall,
        frameFxaaDrawCall: DrawCall | undefined,
        fxaaEnabled: boolean,
    ): void {
        app.disable(PicoGL.DEPTH_TEST);
        app.depthMask(false);
        app.disable(PicoGL.BLEND);

        app.clearMask(PicoGL.COLOR_BUFFER_BIT | PicoGL.DEPTH_BUFFER_BIT);
        app.clearColor(0.0, 0.0, 0.0, 1.0);
        app.defaultDrawFramebuffer().clear();

        const frameTexture = targets.textureFramebuffer!.colorAttachments[0];
        if (frameFxaaDrawCall && fxaaEnabled) {
            frameFxaaDrawCall.uniform("u_resolution", resolutionUni);
            frameFxaaDrawCall.texture("u_frame", frameTexture);
            frameFxaaDrawCall.draw();
            return;
        }
        frameDrawCall.texture("u_frame", frameTexture);
        frameDrawCall.draw();
    }
}
