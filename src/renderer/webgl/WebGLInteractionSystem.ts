import type { Framebuffer, App as PicoApp } from "picogl";
import PicoGL from "picogl";

import type { InteractionInput } from "../MapRenderer";
import { INTERACTION_RADIUS, InteractionState } from "../../runtime/InteractionState";
import { pixelRatio } from "../../util/DeviceUtil";
import type { RendererStats } from "../Renderer";
import { InteractionsReadback } from "./InteractionsReadback";

export type InteractionsCallback = (
    interactReady: boolean,
    interactBuffer: Float32Array,
    closestInteractIndices: Map<number, number[]>,
) => void;

const INTERACT_BUFFER_COUNT = 2;

export class WebGLInteractionSystem {
    readonly state = new InteractionState();
    private interactBuffer?: Float32Array;
    private readonly interactions: InteractionsReadback[];
    private input: InteractionInput = { pointerLocked: false, mouseX: -1, mouseY: -1 };

    constructor(private readonly onInteractions: InteractionsCallback | undefined) {
        this.interactions = new Array(INTERACT_BUFFER_COUNT);
        for (let i = 0; i < INTERACT_BUFFER_COUNT; i++) {
            this.interactions[i] = new InteractionsReadback(INTERACTION_RADIUS);
        }
    }

    setInput(input: InteractionInput): void {
        this.input = input;
    }

    getHoveredMapIds(): Set<number> {
        return this.state.hoveredMapIds;
    }

    private getForFrame(frameCount: number): InteractionsReadback {
        return this.interactions[(frameCount | 0) % this.interactions.length];
    }

    private prepareFrame(
        gl: WebGL2RenderingContext,
        frameCount: number,
    ): { interactions: InteractionsReadback; interactReady: boolean } {
        const interactions = this.getForFrame(frameCount);
        if (!this.input.pointerLocked) {
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

    private readAtMouse(
        gl: WebGL2RenderingContext,
        app: PicoApp,
        msaaEnabled: boolean,
        interactFramebuffer: Framebuffer,
        interactions: InteractionsReadback,
    ): void {
        if (this.input.pointerLocked) {
            return;
        }
        const mouseX = this.input.mouseX;
        const mouseY = this.input.mouseY;
        if (mouseX === -1 || mouseY === -1) {
            return;
        }
        const pixelX = (mouseX * pixelRatio) | 0;
        const pixelY = (mouseY * pixelRatio) | 0;
        const canvasWidth = gl.canvas.width | 0;
        const canvasHeight = gl.canvas.height | 0;
        if (
            (canvasWidth | 0) <= 0 ||
            (canvasHeight | 0) <= 0 ||
            pixelX < 0 ||
            pixelY < 0 ||
            pixelX >= (canvasWidth | 0) ||
            pixelY >= (canvasHeight | 0)
        ) {
            this.state.reset();
            this.interactBuffer = undefined;
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
        if (!interactions.read(gl, pixelX, pixelY)) {
            this.state.reset();
            this.interactBuffer = undefined;
        }
    }

    frame(
        gl: WebGL2RenderingContext,
        app: PicoApp,
        msaaEnabled: boolean,
        interactFramebuffer: Framebuffer,
        frameCount: number,
        rendererStats: RendererStats | undefined,
    ): void {
        const interactionsStart = performance.now();
        const { interactions, interactReady } = this.prepareFrame(gl, frameCount);
        if (this.onInteractions && this.interactBuffer) {
            this.onInteractions(
                interactReady,
                this.interactBuffer,
                this.state.closestInteractIndices,
            );
        }
        this.readAtMouse(gl, app, msaaEnabled, interactFramebuffer, interactions);
        if (rendererStats) {
            rendererStats.interactionsTime = performance.now() - interactionsStart;
        }
    }

    reset(): void {
        this.state.reset();
        this.interactBuffer = undefined;
    }
}
