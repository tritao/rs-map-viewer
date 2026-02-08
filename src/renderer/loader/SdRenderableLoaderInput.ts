import { RenderableType } from "../Renderer";

export type SdRenderableLoaderInput = {
    type: RenderableType;
    ids: number[];
    loadedTextureIds: Set<number>;
};
