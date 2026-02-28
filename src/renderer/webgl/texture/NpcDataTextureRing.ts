import PicoGL, { type App as PicoApp, type Texture } from "picogl";

type NpcDataTextureFlushInput = Readonly<{
    width: number;
    height: number;
    data: Uint16Array;
}>;

export class NpcDataTextureRing {
    private readonly textures: (Texture | undefined)[];

    constructor(private readonly ringSize: number) {
        this.textures = new Array(ringSize);
    }

    flush(
        app: PicoApp,
        frameCount: number,
        input: NpcDataTextureFlushInput,
    ): { npcDataTextureIndex: number; npcDataTexture: Texture | undefined } {
        const writeIndex = (frameCount | 0) % this.textures.length;
        const readIndex = ((frameCount | 0) + this.textures.length - 1) % this.textures.length;

        this.textures[writeIndex]?.delete();
        this.textures[writeIndex] = app.createTexture2D(input.data, input.width, input.height, {
            internalFormat: PicoGL.RGBA16UI,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
        });

        // Render from a stable slot (one behind) to avoid sampling a texture that was just replaced.
        // This also naturally aligns with per-map offset rings that write at (frameCount % ringSize).
        return { npcDataTextureIndex: readIndex, npcDataTexture: this.textures[readIndex] };
    }

    dispose(): void {
        for (const t of this.textures) {
            t?.delete();
        }
        for (let i = 0; i < this.textures.length; i++) {
            this.textures[i] = undefined;
        }
    }
}
