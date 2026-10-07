import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type {
    FloorTypeLoader,
    OverlayFloorTypeLoader,
} from "../../rs/config/floortype/FloorTypeLoader";
import type { LocTypeLoader } from "../../rs/config/loctype/LocTypeLoader";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { VarBitTypeLoader } from "../../rs/config/vartype/bit/VarBitTypeLoader";
import type { ModelLoader } from "../../rs/model/ModelLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import type { TextureLoader } from "../../rs/texture/TextureLoader";
import type { ContentSession } from "../content/ContentSession";

export type MapRenderContentSession = ContentSession &
    Readonly<{
        getMapRenderCacheInfo(): CacheInfo;
        getMapRenderLocTypeLoader(): LocTypeLoader;
        getMapRenderObjTypeLoader(): ObjTypeLoader;
        getMapRenderNpcTypeLoader(): NpcTypeLoader;
        getMapRenderBasTypeLoader(): BasTypeLoader;
        getMapRenderSeqTypeLoader(): SeqTypeLoader;
        getMapRenderVarBitTypeLoader(): VarBitTypeLoader;
        getMapRenderUnderlayTypeLoader(): FloorTypeLoader;
        getMapRenderOverlayTypeLoader(): OverlayFloorTypeLoader;
        getMapRenderTextureLoader(): TextureLoader;
        getMapRenderModelLoader(): ModelLoader;
        getMapRenderSeqFrameLoader(): SeqFrameLoader;
        getMapRenderSkeletalSeqLoader(): SkeletalSeqLoader | undefined;
        getMapRenderVarpValuesSnapshot(): Int32Array;
    }>;
