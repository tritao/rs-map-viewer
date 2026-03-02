import { CollisionData } from "../../rs/scene/CollisionMap";
import type { NpcTypeAnimationEntry } from "../../runtime/contracts/NpcTypeAnimationTable";
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
        // Maps NpcType -> animation frame drawRanges within this map's npc geometry buffers.
        // Used by the worker tick pipeline to patch npc draw ranges per-frame.
        readonly npcTypeAnimationTable?: ReadonlyArray<NpcTypeAnimationEntry>;
    };
