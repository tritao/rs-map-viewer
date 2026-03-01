import { CollisionData } from "../../rs/scene/CollisionMap";
import { MapData } from "./MapData";
import type { SdRenderableData } from "./SdRenderableData";

export type SdMapData = MapData &
    SdRenderableData & {
        readonly mapX: number;
        readonly mapY: number;

        readonly loadLocs: boolean;

        readonly collisionDatas: CollisionData[];
        readonly minimapBlob: Blob;
        readonly heightMapTextureData: Int16Array;
        readonly usedTextureIds: Int32Array;
    };
