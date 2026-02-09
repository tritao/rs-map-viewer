import { FloorTypeLoader, OverlayFloorTypeLoader } from "../config/floortype/FloorTypeLoader";
import { LocTypeLoader } from "../config/loctype/LocTypeLoader";
import { VarProvider } from "../config/vartype/VarProvider";
import { TextureLoader } from "../texture/TextureLoader";
import { LocModelLoader } from "./model/LocModelLoader";

export type SceneRuntimeServices = Readonly<{
    underlayTypeLoader: FloorTypeLoader;
    overlayTypeLoader: OverlayFloorTypeLoader;
    locTypeLoader: LocTypeLoader;
    textureLoader: TextureLoader;
    locModelLoader: LocModelLoader;
    varProvider: VarProvider;
}>;

