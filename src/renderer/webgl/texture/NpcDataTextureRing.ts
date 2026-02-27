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
        const newIndex = (frameCount | 0) % this.textures.length;

        this.textures[newIndex]?.delete();
        this.textures[newIndex] = app.createTexture2D(input.data, input.width, input.height, {
            internalFormat: PicoGL.RGBA16UI,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
        });

        return { npcDataTextureIndex: newIndex, npcDataTexture: this.textures[newIndex] };
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

