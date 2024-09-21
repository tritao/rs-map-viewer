import { CacheLoaders } from "../../../../rs/cache/CacheLoaders";
import { NpcType } from "../../../../rs/config/npctype/NpcType";
import { Model } from "../../../../rs/model/Model";
import { Actor } from "./Actor";

export class Npc extends Actor {
    public npcDefinition: NpcType | null;

    constructor() {
        super();
        this.npcDefinition = null;
    }

    public getChildModel(cacheLoaders: CacheLoaders): Model | undefined {
        if (this.emoteAnimation >= 0 && this.animationDelay === 0) {
            let seqId = this.emoteAnimation;
            let frameId = this.displayedEmoteFrames;

            //let frameId2: number = -1;
            if (this.movementAnimation >= 0 && this.movementAnimation !== this.idleAnimation) {
                seqId = this.movementAnimation;
                frameId = this.displayedMovementFrames;
            }

            this.primaryAnimSeq = cacheLoaders.seqTypeLoader.load(seqId);

            console.error("Animation mixing is not implemented");
            return cacheLoaders.npcModelLoader.getModel(this.npcDefinition!, seqId, frameId);
            //, frameId2, cacheLoaders.seqTypeLoader.load(this.emoteAnimation).masks);
        }

        let seqId: number = -1;
        let frameId: number = -1;
        if (this.movementAnimation >= 0) {
            seqId = this.movementAnimation;
            frameId = this.displayedMovementFrames;
        }

        this.primaryAnimSeq = cacheLoaders.seqTypeLoader.load(seqId);

        return cacheLoaders.npcModelLoader.getModel(this.npcDefinition!, seqId, frameId)
    }

    public getRotatedModel(cacheLoaders: CacheLoaders): Model | null {
        if (this.npcDefinition == null) { return null; }
        let model: Model | undefined = this.getChildModel(cacheLoaders);
        if (!model) { return null; }

        this.modelHeight = model.height;

        // if (this.graphic !== -1 && this.currentAnimation !== -1) {
        //     const spotAnim: SpotAnimation = SpotAnimation.cache[this.graphic];
        //     const spotAnimModel: Model = spotAnim.getModel();
        //     if (spotAnimModel != null) {
        //         const animationId: number = spotAnim.sequences.getPrimaryFrame[this.currentAnimation];
        //         const animationModel: Model = new Model(true, spotAnimModel, Animation.exists(animationId));
        //         animationModel.translate(0, 0, -this.spotAnimationDelay);
        //         animationModel.createBones();
        //         animationModel.applyTransform(animationId);
        //         animationModel.triangleSkin = null;
        //         animationModel.vectorSkin = null;
        //         if (spotAnim.resizeXY !== 128 || spotAnim.resizeZ !== 128) { animationModel.scaleT(spotAnim.resizeZ, spotAnim.resizeXY, 9, spotAnim.resizeXY); }
        //         animationModel.applyLighting(64 + spotAnim.modelLightFalloff, 850 + spotAnim.modelLightAmbient, -30, -50, -30, true);
        //         const models: Model[] = [model, animationModel];
        //         model = new Model(2, 0, models);
        //     }
        // }

        if (this.npcDefinition.size === 1) {
            //model.oneSquareModel = true;
        }

        return model;
    }

    public isVisible(): boolean {
        return this.npcDefinition != null;
    }
}
