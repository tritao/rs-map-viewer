import { applyInteractionReadbackToState, type InteractionState } from "../../interaction/InteractionState";

export class InteractionsReadback {
    interactSize: number;
    interactBuffer: Float32Array;

    pixelBuf: WebGLBuffer | null = null;
    sync: WebGLSync | null = null;

    offsetX = 0;
    offsetY = 0;

    readWidth = 0;
    readHeight = 0;

    constructor(readonly interactRadius: number) {
        this.interactSize = interactRadius * 2 + 1;
        this.interactBuffer = new Float32Array(this.interactSize * this.interactSize * 4);
    }

    read(gl: WebGL2RenderingContext, x: number, y: number): void {
        if (this.sync) {
            return;
        }

        const canvasWidth = gl.canvas.width;
        const canvasHeight = gl.canvas.height;

        const startX = x - this.interactRadius;
        const startY = canvasHeight - y - this.interactRadius - 1;

        const readX = Math.max(startX, 0);
        const readY = Math.max(startY, 0);

        this.offsetX = readX - startX;
        this.offsetY = readY - startY;

        this.readWidth = Math.min(startX + this.interactSize, canvasWidth) - readX;
        this.readHeight = Math.min(startY + this.interactSize, canvasHeight) - readY;

        this.pixelBuf = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuf);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, this.interactBuffer.byteLength, gl.STREAM_READ);
        gl.readPixels(readX, readY, this.readWidth, this.readHeight, gl.RGBA, gl.FLOAT, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

        this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    }

    check(gl: WebGL2RenderingContext, state: InteractionState): boolean {
        if (!this.sync) {
            return false;
        }

        const status = gl.clientWaitSync(this.sync, 0, 0);
        if (status === gl.WAIT_FAILED || status === gl.TIMEOUT_EXPIRED) {
            return false;
        }

        gl.deleteSync(this.sync);
        this.sync = null;

        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pixelBuf);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.interactBuffer);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

        gl.deleteBuffer(this.pixelBuf);

        applyInteractionReadbackToState(
            state,
            this.interactBuffer,
            this.readWidth,
            this.readHeight,
            this.offsetX,
            this.offsetY,
            this.interactRadius,
        );

        return true;
    }
}
