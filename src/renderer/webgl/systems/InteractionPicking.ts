import { INTERACTION_RADIUS, INTERACT_BUFFER_COUNT } from "../../interaction/InteractionState";
import { pixelRatio } from "../../../util/DeviceUtil";
import PicoGL, { type App as PicoApp, type Framebuffer } from "picogl";
import type { InteractionState } from "../../interaction/InteractionState";
import { InteractionsReadback } from "./InteractionsReadback";
import type { InteractionInput } from "../../interaction/InteractionState";

export class InteractionPicking {
    interactBuffer?: Float32Array;

    private readonly interactions: InteractionsReadback[];

    constructor(readonly state: InteractionState) {
        this.interactions = new Array(INTERACT_BUFFER_COUNT);
        for (let i = 0; i < INTERACT_BUFFER_COUNT; i++) {
            this.interactions[i] = new InteractionsReadback(INTERACTION_RADIUS);
        }
    }

    getForFrame(frameCount: number): InteractionsReadback {
        return this.interactions[(frameCount | 0) % this.interactions.length];
    }

    prepare(
        gl: WebGL2RenderingContext,
        input: InteractionInput,
        frameCount: number,
    ): { interactions: InteractionsReadback; interactReady: boolean } {
        const interactions = this.getForFrame(frameCount);
        if (!input.pointerLocked) {
            const interactReady = interactions.check(gl, this.state);
            if (interactReady) {
                this.interactBuffer = interactions.interactBuffer;
            }
            return { interactions, interactReady };
        }

        if (this.state.hoveredMapIds.size > 0) {
            this.state.hoveredMapIds.clear();
        }
        return { interactions, interactReady: false };
    }

    readAtMouse(
        gl: WebGL2RenderingContext,
        app: PicoApp,
        input: InteractionInput,
        msaaEnabled: boolean,
        interactFramebuffer: Framebuffer,
        interactions: InteractionsReadback,
    ): void {
        if (input.pointerLocked) {
            return;
        }
        const mouseX = input.mouseX;
        const mouseY = input.mouseY;
        if (mouseX === -1 || mouseY === -1) {
            return;
        }
        if (msaaEnabled) {
            // TODO: reading from the multisampled framebuffer is not accurate
            app.drawFramebuffer(interactFramebuffer);
            gl.readBuffer(PicoGL.COLOR_ATTACHMENT1);
            app.blitFramebuffer(PicoGL.COLOR_BUFFER_BIT);

            app.readFramebuffer(interactFramebuffer);
            gl.readBuffer(PicoGL.COLOR_ATTACHMENT0);
        } else {
            gl.readBuffer(PicoGL.COLOR_ATTACHMENT1);
        }
        interactions.read(gl, (mouseX * pixelRatio) | 0, (mouseY * pixelRatio) | 0);
    }

    reset(): void {
        this.state.reset();
        this.interactBuffer = undefined;
    }
}
