import PicoGL, { App, Texture as TextureType } from "picogl";
import { Texture } from "picogl/build/module/texture.js";

// Hack to fix invalid mipmap levels

export function createTextureArray(
    app: App,
    image: ArrayBufferView,
    width: number,
    height: number,
    depth: number,
    options: unknown,
): TextureType {
    return new PicoTexture(
        app.gl,
        app.state,
        PicoGL.TEXTURE_2D_ARRAY,
        image,
        width,
        height,
        depth,
        true,
        options,
    ) as TextureType;
}

export class PicoTexture extends Texture {
    constructor(
        gl: WebGLRenderingContext,
        appState: unknown,
        binding: number,
        image: ArrayBufferView,
        width: number,
        height: number,
        depth: number,
        mipmaps: boolean,
        options: unknown,
    ) {
        // @ts-ignore
        super(gl, appState, binding, image, width, height, depth, mipmaps, options);
    }

    resize(width: number, height: number, depth?: number | undefined) {
        if (!(this.gl instanceof WebGL2RenderingContext)) {
            throw new Error("Only WebGL2 is supported");
        }
        const gl = this.gl;
        depth = depth || 0;

        if (
            this.texture &&
            width === this.width &&
            height === this.height &&
            depth === this.depth
        ) {
            return this;
        }

        this.gl.deleteTexture(this.texture);
        if (this.currentUnit !== -1) {
            this.appState.textures[this.currentUnit] = null;
        }

        const textureInternal = this as unknown as TextureInternalState;

        const texture = this.gl.createTexture();
        if (!texture) {
            throw new Error("Failed creating texture");
        }
        this.texture = texture;
        textureInternal.bind(Math.max(this.currentUnit, 0));

        this.width = width;
        this.height = height;
        this.depth = depth;

        this.gl.texParameteri(this.binding, gl.TEXTURE_MIN_FILTER, textureInternal.minFilter);
        this.gl.texParameteri(this.binding, gl.TEXTURE_MAG_FILTER, textureInternal.magFilter);
        this.gl.texParameteri(this.binding, gl.TEXTURE_WRAP_S, textureInternal.wrapS);
        this.gl.texParameteri(this.binding, gl.TEXTURE_WRAP_T, textureInternal.wrapT);
        this.gl.texParameteri(this.binding, gl.TEXTURE_WRAP_R, textureInternal.wrapR);
        this.gl.texParameteri(this.binding, gl.TEXTURE_COMPARE_FUNC, textureInternal.compareFunc);
        this.gl.texParameteri(this.binding, gl.TEXTURE_COMPARE_MODE, textureInternal.compareMode);

        if (textureInternal.minLOD !== null) {
            this.gl.texParameterf(this.binding, gl.TEXTURE_MIN_LOD, textureInternal.minLOD);
        }

        if (textureInternal.maxLOD !== null) {
            this.gl.texParameterf(this.binding, gl.TEXTURE_MAX_LOD, textureInternal.maxLOD);
        }

        if (textureInternal.baseLevel !== null) {
            this.gl.texParameteri(this.binding, gl.TEXTURE_BASE_LEVEL, textureInternal.baseLevel);
        }

        if (textureInternal.maxLevel !== null) {
            this.gl.texParameteri(this.binding, gl.TEXTURE_MAX_LEVEL, textureInternal.maxLevel);
        }

        if (textureInternal.maxAnisotropy > 1) {
            this.gl.texParameteri(
                this.binding,
                PicoGL.TEXTURE_MAX_ANISOTROPY_EXT,
                textureInternal.maxAnisotropy,
            );
        }

        let levels;
        if (this.is3D) {
            if (this.mipmaps) {
                levels = Math.floor(Math.log2(Math.max(this.width, this.height))) + 1;
            } else {
                levels = 1;
            }
            // console.error("creating mip maps for 3d texture", levels)
            this.gl.texStorage3D(
                this.binding,
                levels,
                this.internalFormat,
                this.width,
                this.height,
                this.depth,
            );
        } else {
            if (this.mipmaps) {
                levels = Math.floor(Math.log2(Math.max(this.width, this.height))) + 1;
            } else {
                levels = 1;
            }
            this.gl.texStorage2D(
                this.binding,
                levels,
                this.internalFormat,
                this.width,
                this.height,
            );
        }

        return this;
    }
}

type TextureInternalState = TextureType & {
    bind(unit: number): void;
    minFilter: number;
    magFilter: number;
    wrapS: number;
    wrapT: number;
    wrapR: number;
    compareFunc: number;
    compareMode: number;
    minLOD: number | null;
    maxLOD: number | null;
    baseLevel: number | null;
    maxLevel: number | null;
    maxAnisotropy: number;
};
