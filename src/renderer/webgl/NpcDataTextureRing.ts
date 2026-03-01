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

    write(
        app: PicoApp,
        index: number,
        input: NpcDataTextureFlushInput,
    ): number {
        const ringSize = this.textures.length | 0;
        const safeIndex = (((index | 0) % ringSize) + ringSize) % ringSize;
        const existing = this.textures[safeIndex];
        if (
            existing &&
            (existing.width | 0) === (input.width | 0) &&
            (existing.height | 0) === (input.height | 0)
        ) {
            // PicoGL requires the data to fit the currently-allocated storage.
            existing.data(input.data);
            return safeIndex | 0;
        }

        existing?.delete();
        this.textures[safeIndex] = app.createTexture2D(input.data, input.width, input.height, {
            internalFormat: PicoGL.RGBA16UI,
            minFilter: PicoGL.NEAREST,
            magFilter: PicoGL.NEAREST,
        });
        return safeIndex | 0;
    }

    get(index: number): Texture | undefined {
        const ringSize = this.textures.length | 0;
        const safeIndex = (((index | 0) % ringSize) + ringSize) % ringSize;
        return this.textures[safeIndex];
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
