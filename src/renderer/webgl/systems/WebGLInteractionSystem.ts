import type { App as PicoApp, Framebuffer } from "picogl";

import { InteractionState, type InteractionInput } from "../../interaction/InteractionState";
import type { RendererStats } from "../../Renderer";
import { InteractionPicking } from "./InteractionPicking";
import type { InteractionsReadback } from "./InteractionsReadback";

export type InteractionsCallback = (
    interactReady: boolean,
    interactBuffer: Float32Array,
    closestInteractIndices: Map<number, number[]>,
) => void;

export class WebGLInteractionSystem {
    readonly state = new InteractionState();
    private readonly picking = new InteractionPicking(this.state);
    private input: InteractionInput = { pointerLocked: false, mouseX: -1, mouseY: -1 };

    constructor(private readonly onInteractions: InteractionsCallback | undefined) {}

    setInput(input: InteractionInput): void {
        this.input = input;
    }

    getHoveredMapIds(): Set<number> {
        return this.state.hoveredMapIds;
    }

    prepare(
        gl: WebGL2RenderingContext,
        frameCount: number,
        rendererStats: RendererStats | undefined,
    ): InteractionsReadback {
        const interactionsStart = performance.now();
        const { interactions, interactReady } = this.picking.prepare(gl, this.input, frameCount);
        if (this.onInteractions && this.picking.interactBuffer) {
            this.onInteractions(
                interactReady,
                this.picking.interactBuffer,
                this.state.closestInteractIndices,
            );
        }
        if (rendererStats) {
            rendererStats.interactionsTime = performance.now() - interactionsStart;
        }
        return interactions;
    }

    readAtMouse(
        gl: WebGL2RenderingContext,
        app: PicoApp,
        msaaEnabled: boolean,
        interactFramebuffer: Framebuffer,
        interactions: InteractionsReadback,
    ): void {
        this.picking.readAtMouse(gl, app, this.input, msaaEnabled, interactFramebuffer, interactions);
    }

    reset(): void {
        this.picking.reset();
    }
}
