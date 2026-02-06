import { GameType } from "../../cache/CacheInfo";
import { NpcType } from "../../config/npctype/NpcType";
import { NpcTypeLoader } from "../../config/npctype/NpcTypeLoader";
import { SeqType } from "../../config/seqtype/SeqType";
import { SeqTypeLoader } from "../../config/seqtype/SeqTypeLoader";
import { VarProvider } from "../../config/vartype/VarProvider";
import { Model } from "../../model/Model";
import { ModelData } from "../../model/ModelData";
import { ModelLoader } from "../../model/ModelLoader";
import { SeqFrameLoader } from "../../model/seq/SeqFrameLoader";
import { SkeletalSeqLoader } from "../../model/skeletal/SkeletalSeqLoader";
import { TextureLoader } from "../../texture/TextureLoader";

export class NpcModelLoader {
    modelCache: Map<number, Model>;

    constructor(
        private readonly npcTypeLoader: NpcTypeLoader,
        private readonly modelLoader: ModelLoader,
        private readonly textureLoader: TextureLoader,
        private readonly seqTypeLoader: SeqTypeLoader,
        private readonly seqFrameLoader: SeqFrameLoader,
        private readonly skeletalSeqLoader: SkeletalSeqLoader | undefined,
        private readonly varProvider: VarProvider,
    ) {
        this.modelCache = new Map();
    }

    getModel(npcType: NpcType, seqId: number, frame: number): Model | undefined {
        if (npcType.transforms) {
            const transformed = npcType.transform(this.varProvider, this.npcTypeLoader);
            if (!transformed) {
                return undefined;
            }
            return this.getModel(transformed, seqId, frame);
        }

        let model = this.modelCache.get(npcType.id);
        if (!model) {
            const models = new Array<ModelData>(npcType.modelIds.length);
            for (let i = 0; i < models.length; i++) {
                const modelData = this.modelLoader.tryGetModel(npcType.modelIds[i]);
                if (modelData) {
                    models[i] = modelData;
                }
            }

            const merged = ModelData.merge(models, models.length);

            if (npcType.recolorFrom) {
                const retexture =
                    npcType.cacheInfo.game === GameType.Runescape &&
                    npcType.cacheInfo.revision <= 377;
                for (let i = 0; i < npcType.recolorFrom.length; i++) {
                    merged.recolor(npcType.recolorFrom[i], npcType.recolorTo[i]);
                    if (retexture) {
                        merged.retexture(npcType.recolorFrom[i], npcType.recolorTo[i]);
                    }
                }
            }

            if (npcType.retextureFrom) {
                for (let i = 0; i < npcType.retextureFrom.length; i++) {
                    merged.retexture(npcType.retextureFrom[i], npcType.retextureTo[i]);
                }
            }

            model = merged.light(
                this.textureLoader,
                npcType.ambient + 64,
                npcType.contrast * 5 + 850,
                -30,
                -50,
                -30,
            );

            this.modelCache.set(npcType.id, model);
        }

        const hasScale = npcType.widthScale !== 128 || npcType.heightScale !== 128;

        if (seqId !== -1 && frame !== -1) {
            const seqResult = this.seqTypeLoader.tryLoad(seqId);
            if (seqResult.ok) {
                model = this.transformNpcModel(model, seqResult.value, frame);
            } else if (hasScale) {
                model = Model.copyAnimated(model, true, true);
            }
        } else if (hasScale) {
            model = Model.copyAnimated(model, true, true);
        }

        if (hasScale) {
            model.scale(npcType.widthScale, npcType.heightScale, npcType.widthScale);
        }

        return model;
    }

    transformNpcModel(model: Model, seqType: SeqType, frame: number): Model {
        if (seqType.hasAnimMayaSeq()) {
            const skeletalSeq = this.skeletalSeqLoader?.tryGet(seqType.animMayaId);
            if (!skeletalSeq) {
                return Model.copyAnimated(model, true, true);
            }
            model = Model.copyAnimated(model, !skeletalSeq.hasAlphaTransform, true);

            model.animateSkeletal(skeletalSeq, frame);
        } else {
            if (!seqType.frameIds || seqType.frameIds.length === 0) {
                return Model.copyAnimated(model, true, true);
            }

            const seqFrame = this.seqFrameLoader.tryGet(seqType.frameIds[frame]);

            if (seqFrame) {
                model = Model.copyAnimated(
                    model,
                    !seqFrame.hasAlphaTransform,
                    !seqFrame.hasColorTransform,
                );

                model.animate(seqFrame, undefined, seqType.rotateNormals);
            }
        }

        return model;
    }

    clearCache(): void {
        this.modelCache.clear();
    }
}
