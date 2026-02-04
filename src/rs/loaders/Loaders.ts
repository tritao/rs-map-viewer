import { BasTypeLoader } from "../config/bastype/BasTypeLoader";
import { FloorTypeLoader, OverlayFloorTypeLoader } from "../config/floortype/FloorTypeLoader";
import { LocTypeLoader } from "../config/loctype/LocTypeLoader";
import { NpcTypeLoader } from "../config/npctype/NpcTypeLoader";
import { ObjTypeLoader } from "../config/objtype/ObjTypeLoader";
import { QuestTypeLoader } from "../config/questtype/QuestTypeLoader";
import { SeqTypeLoader } from "../config/seqtype/SeqTypeLoader";
import { VarBitTypeLoader } from "../config/vartype/bit/VarBitTypeLoader";
import { MapFileLoader } from "../map/MapFileLoader";
import { ModelLoader } from "../model/ModelLoader";
import { SeqFrameLoader } from "../model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../model/skeletal/SkeletalSeqLoader";
import { IndexedSprite } from "../sprite/IndexedSprite";
import { TextureLoader } from "../texture/TextureLoader";

export type Loaders = Readonly<{
    underlayTypeLoader: FloorTypeLoader;
    overlayTypeLoader: OverlayFloorTypeLoader;

    varBitTypeLoader: VarBitTypeLoader;

    locTypeLoader: LocTypeLoader;
    npcTypeLoader: NpcTypeLoader;
    objTypeLoader: ObjTypeLoader;

    seqTypeLoader: SeqTypeLoader;

    basTypeLoader: BasTypeLoader;

    questTypeLoader?: QuestTypeLoader;

    textureLoader: TextureLoader;

    modelLoader: ModelLoader;
    seqFrameLoader: SeqFrameLoader;
    skeletalSeqLoader?: SkeletalSeqLoader;

    mapFileLoader: MapFileLoader;

    mapScenes: ReadonlyArray<IndexedSprite>;
    mapFunctions: ReadonlyArray<IndexedSprite>;
}>;
