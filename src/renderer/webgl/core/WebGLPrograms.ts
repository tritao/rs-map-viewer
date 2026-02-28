import type { DrawCall, Program, VertexArray } from "picogl";
import type { App as PicoApp } from "picogl";

import {
    FRAME_FXAA_PROGRAM,
    FRAME_PROGRAM,
    createMainProgram,
    createNpcProgram,
} from "../shaders/Shaders";

export class WebGLPrograms {
    private initPromise: Promise<void> | undefined;
    private createdPrograms: Program[] = [];

    mainProgram?: Program;
    mainAlphaProgram?: Program;
    npcProgram?: Program;

    frameDrawCall?: DrawCall;
    frameFxaaDrawCall?: DrawCall;

    init(app: PicoApp, quadArray: VertexArray, hasMultiDraw: boolean): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }
        this.initPromise = (async () => {
            const programs = await app.createPrograms(
                createMainProgram(hasMultiDraw, false),
                createMainProgram(hasMultiDraw, true),
                createNpcProgram(hasMultiDraw, true),
                FRAME_PROGRAM,
                FRAME_FXAA_PROGRAM,
            );
            this.createdPrograms = programs;

            const [mainProgram, mainAlphaProgram, npcProgram, frameProgram, frameFxaaProgram] =
                programs;
            this.mainProgram = mainProgram;
            this.mainAlphaProgram = mainAlphaProgram;
            this.npcProgram = npcProgram;

            this.frameDrawCall = app.createDrawCall(frameProgram, quadArray);
            this.frameFxaaDrawCall = app.createDrawCall(frameFxaaProgram, quadArray);
        })();
        return this.initPromise;
    }

    async dispose(): Promise<void> {
        const p = this.initPromise;
        if (p) {
            // Ensure programs exist before trying to delete them.
            await p.catch(() => undefined);
        }

        // PicoGL DrawCall has no delete(); releasing references is sufficient.
        this.frameDrawCall = undefined;
        this.frameFxaaDrawCall = undefined;

        for (const prog of this.createdPrograms) {
            prog?.delete();
        }
        this.createdPrograms = [];

        this.mainProgram = undefined;
        this.mainAlphaProgram = undefined;
        this.npcProgram = undefined;

        this.initPromise = undefined;
    }
}
