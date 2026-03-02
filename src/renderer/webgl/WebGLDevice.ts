import PicoGL, { type App as PicoApp } from "picogl";

export type WebGLDevice = Readonly<{
    app: PicoApp;
    gl: WebGL2RenderingContext;
    hasMultiDraw: boolean;
}>;

type PicoAppWithExtensions = PicoApp & {
    state: PicoApp["state"] & {
        extensions?: {
            multiDrawInstanced?: unknown;
        };
    };
};

export function createWebGLDevice(canvas: HTMLCanvasElement): WebGLDevice {
    const app = PicoGL.createApp(canvas);
    const gl = app.gl as WebGL2RenderingContext;

    // Hack to get the right multi draw extension for picogl.
    const appWithExtensions = app as PicoAppWithExtensions;
    const ext = gl.getExtension("WEBGL_multi_draw");
    PicoGL.WEBGL_INFO.MULTI_DRAW_INSTANCED = ext;
    appWithExtensions.state.extensions = appWithExtensions.state.extensions ?? {};
    appWithExtensions.state.extensions.multiDrawInstanced = ext;

    const hasMultiDraw = !!PicoGL.WEBGL_INFO.MULTI_DRAW_INSTANCED;

    gl.getExtension("EXT_float_blend");

    app.enable(PicoGL.CULL_FACE);
    app.enable(PicoGL.DEPTH_TEST);
    app.depthFunc(PicoGL.LEQUAL);
    app.enable(PicoGL.BLEND);
    app.blendFunc(PicoGL.SRC_ALPHA, PicoGL.ONE_MINUS_SRC_ALPHA);
    app.clearColor(0.0, 0.0, 0.0, 1.0);

    return { app, gl, hasMultiDraw };
}
