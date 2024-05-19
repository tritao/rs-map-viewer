import { Actor } from "./Actor";
import { Buffer } from "../../net/Buffer"
import { Model } from "../Model";
import { TextUtils } from "../../util/TextUtils";
import { IdentityKit } from "../../cache/IdentityKit";
import { ItemDefinition } from "../../cache/ItemDefinition";
import { ModelData } from "../../../../rs/model/ModelData";

const NUM_APPEARANCE_EQUIPMENT_SLOTS = 12;

export enum EquipmentId {
    HAT = 0,
    CAPE = 1,
    AMULET = 2,
    WEAPON = 3,
    CHEST = 4,
    SHIELD = 5,
    LEGS = 7,
    HANDS = 9,
    FEET = 10,
    RING = 12,
    ARROWS = 13
}

export enum GenderId {
    MALE = 0,
    FEMALE = 1,
}

export enum BodyPartId {
    GENDER = 0,
    HEAD = 1,
    BEARD = 2,
    CHEST = 3,
    ARMS = 4,
    HANDS = 5,
    LEGS = 6,
    FEET = 7,
    HAIR_COLOR = 8,
    TORSO_COLOR = 9,
    LEG_COLOR = 10,
    FEET_COLOR = 11,
    SKIN_COLOR = 12,
}

const playerColours: number[][] = [
    [6798, 107, 10283, 16, 4797, 7744, 5799, 4634, 33697, 22433, 2983, 54193],
    [8741, 12, 64030, 43162, 7735, 8404, 1701, 38430, 24094, 10153, 56621, 4783,
        1341, 16578, 35003, 25239],
    [25238, 8742, 12, 64030, 43162, 7735, 8404, 1701, 38430, 24094, 10153, 56621,
        4783, 1341, 16578, 35003],
    [4626, 11146, 6439, 12, 4758, 10270],
    [4550, 4537, 5681, 5673, 5790, 6806, 8076, 4574]
];

const SKIN_COLOURS: number[] = [9104, 10275, 7595, 3610, 7975, 8526, 918, 38802,
    24466, 10145, 58654, 5027, 1457, 16565, 34991, 25486];

export class Player extends Actor {
    //public static modelCache: Cache = new Cache(260);

    public anInt1743: number;

    public drawHeight: number;

    public anInt1745: number;

    public playerModel: Model | null;

    public prayerIconId: number = -1;

    public cachedModel: number = -1;

    public drawHeight2: number;

    public playerName: string | null;

    public appearance: number[] = Array(12).fill(0);

    public combatLevel: number;

    public appearanceHash: number;

    public gender: number;

    public isSkulled: number = -1;

    //public npcDefinition: ActorDefinition;

    public visible: boolean = false;

    public skillLevel: number;

    public appearanceColors: number[] = [0, 0, 0, 0, 0];

    public preventRotation: boolean = false;

    public objectAppearanceStartTick: number;

    public objectAppearanceEndTick: number;

    public teamId: number;

    public minX: number;

    public minY: number;

    public tileHeight: number;

    public tileWidth: number;

    constructor() {
        super();
        this.anInt1743 = 0;
        this.drawHeight = 0;
        this.anInt1745 = 0;
        this.playerModel = null;
        this.drawHeight2 = 0;
        this.playerName = null;
        this.combatLevel = 0;
        this.appearanceHash = 0;
        this.gender = 0;
        //this.npcDefinition = null;
        this.skillLevel = 0;
        this.objectAppearanceStartTick = 0;
        this.objectAppearanceEndTick = 0;
        this.teamId = 0;
        this.minX = 0;
        this.minY = 0;
        this.tileHeight = 0;
        this.tileWidth = 0;
    }

    // public getHeadModel(): Model | null {
    //     if (!this.visible) {
    //         return null;
    //     }
    //     //if (this.npcDefinition != null) {
    //     //    return this.npcDefinition.getHeadModel();
    //     //}
    //     let cached: boolean = false;
    //     for (let index: number = 0; index < 12; index++) {
    //         {
    //             const appearanceId: number = this.appearance[index];
    //             if (appearanceId >= 256 && appearanceId < 512 &&
    //                 !IdentityKit.cache[appearanceId - 256].isHeadModelCached()) {
    //                cached = true;
    //             }
    //             if (appearanceId >= 512 &&
    //                 !ItemDefinition.lookup(appearanceId - 512).headPieceReady(this.gender)) {
    //                cached = true;
    //             }
    //         }
    //     }
    //     if (cached) {
    //         return null;
    //     }
    //     const headModels: (Model | null)[] = (s => {
    //         const a = [];
    //         while (s-- > 0) {
    //             a.push(null);
    //         }
    //         return a;
    //     })(12);
    //     let headModelsOffset: number = 0;
    //     for (let modelIndex: number = 0; modelIndex < 12; modelIndex++) {
    //        {
    //            const appearanceId: number = this.appearance[modelIndex];
    //            if (appearanceId >= 256 && appearanceId < 512) {
    //                const subModel: Model = IdentityKit.cache[appearanceId - 256].getHeadModel();
    //                if (subModel != null) {
    //                    headModels[headModelsOffset++] = subModel;
    //                }
    //            }
    //            if (appearanceId >= 512) {
    //                const subModel: Model = ItemDefinition.lookup(appearanceId - 512).asHeadPiece(this.gender);
    //                if (subModel != null) {
    //                    headModels[headModelsOffset++] = subModel;
    //                }
    //            }
    //        }
    //     }
    //     const headModel: Model = new Model(headModelsOffset, headModels);

    //     for (let index: number = 0; index < 5; index++) {
    //        if (this.appearanceColors[index] !== 0) {
    //            //headModel.replaceColor(Game.playerColours[index][0], Game.playerColours[index][this.appearanceColors[index]]);
    //            if (index === 1) {
    //                //headModel.replaceColor(Game.SKIN_COLOURS[0], Game.SKIN_COLOURS[this.appearanceColors[index]]);
    //            }
    //        }
    //     }

    //     return headModel;
    // }

    public getAnimatedModel(): Model | null {
        // TODO: Refactor according to RuneJS 435 rename.
        // if (this.npcDefinition != null) {
        //     let frame: number = -1;
        //     if (this.emoteAnimation >= 0 && this.animationDelay === 0) {
        //         frame = AnimationSequence.animations[this.emoteAnimation].getPrimaryFrame[this.displayedEmoteFrames];
        //     } else if (this.movementAnimation >= 0) {
        //         frame = AnimationSequence.animations[this.movementAnimation].getPrimaryFrame[this.displayedMovementFrames];
        //     }
        //     const model: Model = this.npcDefinition.getChildModel(frame, -1, null);
        //     return model;
        // }

        // First check if we are running an animation and use the animation-specific models.
        let hash: number = this.appearanceHash;
        let primaryFrame: number = -1;
        let secondaryFrame: number = -1;
        let shieldModel: number = -1;
        let weaponModel: number = -1;
        if (this.emoteAnimation >= 0 && this.animationDelay === 0) {
            //const emote: AnimationSequence = AnimationSequence.animations[this.emoteAnimation];
            //primaryFrame = emote.getPrimaryFrame[this.displayedEmoteFrames];
            //if (this.movementAnimation >= 0 && this.movementAnimation !== this.idleAnimation) {
            //    secondaryFrame = AnimationSequence.animations[this.movementAnimation].getPrimaryFrame[this.displayedMovementFrames];
            //}
            //if (emote.getPlayerShieldModel >= 0) {
            //    shieldModel = emote.getPlayerShieldModel;
            //    hash += (shieldModel - this.appearance[5]) << 40;
            //}
            //if (emote.getPlayerWeaponModel >= 0) {
            //    weaponModel = emote.getPlayerWeaponModel;
            //    hash += (weaponModel - this.appearance[3]) << 48;
            //}
        } else if (this.movementAnimation >= 0) {
            //primaryFrame = AnimationSequence.animations[this.movementAnimation].getPrimaryFrame[this.displayedMovementFrames];
        }

        // Else lets check the cache
        let cachedModel: Model | null = null; // Player.modelCache.get(hash) as Model;
        //if (cachedModel == null) {
        //    let invalid = false;
        //    for (let bodyPart = 0; bodyPart < NUM_APPEARANCE_EQUIPMENT_SLOTS; bodyPart++) {
        //        let appearanceModel: number = this.appearance[bodyPart];

        //        // TODO: Refactor these.
        //        if (weaponModel >= 0 && bodyPart === 3) {
        //            appearanceModel = weaponModel;
        //        }
        //        if (shieldModel >= 0 && bodyPart === 5) {
        //            appearanceModel = shieldModel;
        //        }

        //        if (appearanceModel >= 256 && appearanceModel < 512 &&
        // !IdentityKit.cache[appearanceModel - 256].isBodyModelCached()) {
        //            invalid = true;
        //        }

        //        if (appearanceModel >= 512 && !ItemDefinition.lookup(appearanceModel - 512)
        //.equipmentReady(this.gender)) {
        //            invalid = true;
        //        }
        //    }
        //    if (invalid) {
        //        if (this.cachedModel !== -1) {
        //            cachedModel = Player.modelCache.get(this.cachedModel) as Model;
        //        }
        //        if (cachedModel == null) {
        //            return null;
        //        }
        //    }
        //}

        // If we have no cached model, then lets create the player appearance.
        // For this we check the appearance slot blocks and populate the models with
        // either the builtin model from the identity kit or the model from equipment.
        if (cachedModel == null) {
            const models: Model[] = [];
            for (let index: number = 0; index < NUM_APPEARANCE_EQUIPMENT_SLOTS; index++) {
                let part: number = this.appearance[index];

                // TODO: Refactor these.
                if (weaponModel >= 0 && index === 3) {
                    part = weaponModel;
                }
                if (shieldModel >= 0 && index === 5) {
                    part = shieldModel;
                }

                if (part >= 256 && part < 512) {
                    const identityKit = IdentityKit.loadFromCache(part - 256);
                    if (identityKit) {
                        const bodyModel: Model | null = identityKit.getBodyModel();
                        if (bodyModel) {
                            models.push(bodyModel);
                        }
                    }
                } else if (part >= 512) {
                    throw new Error("Not implemented yet");
                    //const equipment: Model = ItemDefinition.lookup(part - 512)
                        //.asEquipment(this.gender);
                    //if (equipment != null) {
                    //    models[count++] = equipment;
                    //}
                }
            }
            cachedModel = Model.merge(models.length, models);

            // Now we recolor the models (HAIR_COLOR to SKIN_COLOR).
            for (let part: number = 0; part < 5; part++) {
                if (this.appearanceColors[part] !== 0) {
                    //cachedModel.replaceColor(playerColours[part][0],
                    //    playerColours[part][this.appearanceColors[part]]);
                    //if (part === 1) {
                    //    cachedModel.replaceColor(SKIN_COLOURS[0],
                    //        SKIN_COLOURS[this.appearanceColors[part]]);
                    //}
                }
            }
            //cachedModel.createBones();
            //cachedModel.applyLighting(64, 850, -30, -50, -30, true);
            //Player.modelCache.put(cachedModel, hash);
            this.cachedModel = hash;
        }
        if (this.preventRotation) {
            return cachedModel;
        }

        //const finalModel: Model = new Model(new ModelData());
        //finalModel.replaceWithModel(cachedModel,
            //((lhs, rhs) => lhs && rhs)(Animation.exists(primaryFrame), Animation.exists(secondaryFrame)));
        //if (primaryFrame !== -1 && secondaryFrame !== -1) {
        //    finalModel.mixAnimationFrames(secondaryFrame, 0, primaryFrame, AnimationSequence.animations[this.emoteAnimation].flowControl);
        //} else if (primaryFrame !== -1) {
        //    finalModel.applyTransform(primaryFrame);
        //}
        //finalModel.calculateDiagonals();
        //finalModel.triangleSkin = null;
        //finalModel.vectorSkin = null;
        //return finalModel;

        return cachedModel;
    }

    public isVisible(): boolean {
        return this.visible;
    }

    public getRotatedModel(): Model | null {
        if (!this.visible) {
            return null;
        }

        let appearanceModel: Model | null = this.getAnimatedModel();
        if (appearanceModel == null) {
            return null;
        }

        this.modelHeight = appearanceModel.modelHeight;
        //appearanceModel.oneSquareModel = true;
        if (this.preventRotation) {
            return appearanceModel;
        }

        //if (this.graphic !== -1 && this.currentAnimation !== -1) {
        //    const spotAnimation: SpotAnimation = SpotAnimation.cache[this.graphic];
        //    const spotAnimationModel: Model = spotAnimation.getModel();
        //    if (spotAnimationModel != null) {
        //        const spotAnimationModel2: Model = new Model(true, spotAnimationModel, Animation.exists(this.currentAnimation));
        //        spotAnimationModel2.translate(0, 0, -this.spotAnimationDelay);
        //        spotAnimationModel2.createBones();
        //        spotAnimationModel2.applyTransform(spotAnimation.sequences.getPrimaryFrame[this.currentAnimation]);
        //        spotAnimationModel2.triangleSkin = null;
        //        spotAnimationModel2.vectorSkin = null;
        //        if (spotAnimation.resizeXY !== 128 || spotAnimation.resizeZ !== 128) {
        //            spotAnimationModel2.scaleT(spotAnimation.resizeZ, spotAnimation.resizeXY, 9, spotAnimation.resizeXY);
        //        }
        //        spotAnimationModel2.applyLighting(
        //            64 + spotAnimation.modelLightFalloff,
        //            850 + spotAnimation.modelLightAmbient,
        //            -30,
        //            -50,
        //            -30,
        //            true
        //        );
        //        const models: Model[] = [appearanceModel, spotAnimationModel2];
        //        appearanceModel = new Model(2, 0, models);
        //    }
        //}

        // Transformed player model
        //if (this.playerModel != null) {
        //    if (Game.pulseCycle >= this.objectAppearanceEndTick) {
        //        this.playerModel = null;
        //    }
        //    if (Game.pulseCycle >= this.objectAppearanceStartTick && Game.pulseCycle < this.objectAppearanceEndTick) {
        //        const model: Model = this.playerModel;
        //        model.translate(this.anInt1743 - this.worldX, this.anInt1745 - this.worldY, this.drawHeight - this.drawHeight2);
        //        if (this.nextStepOrientation === 512) {
        //            model.rotate90Degrees();
        //            model.rotate90Degrees();
        //            model.rotate90Degrees();
        //        } else if (this.nextStepOrientation === 1024) {
        //            model.rotate90Degrees();
        //            model.rotate90Degrees();
        //        } else if (this.nextStepOrientation === 1536) {
        //            model.rotate90Degrees();
        //        }
        //        const models: Model[] = [appearanceModel, model];
        //        appearanceModel = new Model(2, 0, models);
        //        if (this.nextStepOrientation === 512) {
        //            model.rotate90Degrees();
        //        } else if (this.nextStepOrientation === 1024) {
        //            model.rotate90Degrees();
        //            model.rotate90Degrees();
        //        } else if (this.nextStepOrientation === 1536) {
        //            model.rotate90Degrees();
        //            model.rotate90Degrees();
        //            model.rotate90Degrees();
        //        }
        //        model.translate(this.worldX - this.anInt1743, this.worldY - this.anInt1745, this.drawHeight2 - this.drawHeight);
        //    }
        //}

        //appearanceModel.oneSquareModel = true;
        return appearanceModel;
    }

    public updateAppearance(buffer: Buffer) {
        buffer.currentPosition = 0;
        this.gender = buffer.getUnsignedByte();
        this.isSkulled = buffer.getByte();
        this.prayerIconId = buffer.getByte();
        //this.npcDefinition = null;
        this.teamId = 0;
        for (let index: number = 0; index < 12; index++) {
            const upperByte: number = buffer.getUnsignedByte();
            if (upperByte === 0) {
                this.appearance[index] = 0;
                continue;
            }
            const lowerByte: number = buffer.getUnsignedByte();
            this.appearance[index] = (upperByte << 8) + lowerByte;
            if (index === 0 && this.appearance[0] === 65535) {
                let actorDefId = buffer.getUnsignedShortBE();
                //this.npcDefinition = ActorDefinition.getDefinition(actorDefId);
                break;
            }
            //if (this.appearance[index] >= 512 && this.appearance[index] - 512 < ItemDefinition.count) {
            //    const itemTeam: number = ItemDefinition.lookup(this.appearance[index] - 512).team;
            //    if (itemTeam !== 0) {
            //        this.teamId = itemTeam;
            //    }
            //}
        }
        for (let l: number = 0; l < 5; l++) {
            let j1: number = buffer.getUnsignedByte();
            //if (j1 < 0 || j1 >= Game.playerColours[l].length) {
            //    j1 = 0;
            //}
            this.appearanceColors[l] = j1;
        }
        this.idleAnimation = buffer.getUnsignedShortBE();
        if (this.idleAnimation === 65535) {
            this.idleAnimation = -1;
        }
        this.standTurnAnimationId = buffer.getUnsignedShortBE();
        if (this.standTurnAnimationId === 65535) {
            this.standTurnAnimationId = -1;
        }
        this.walkAnimationId = buffer.getUnsignedShortBE();
        if (this.walkAnimationId === 65535) {
            this.walkAnimationId = -1;
        }
        this.turnAroundAnimationId = buffer.getUnsignedShortBE();
        if (this.turnAroundAnimationId === 65535) {
            this.turnAroundAnimationId = -1;
        }
        this.turnRightAnimationId = buffer.getUnsignedShortBE();
        if (this.turnRightAnimationId === 65535) {
            this.turnRightAnimationId = -1;
        }
        this.turnLeftAnimationId = buffer.getUnsignedShortBE();
        if (this.turnLeftAnimationId === 65535) {
            this.turnLeftAnimationId = -1;
        }
        this.runAnimationId = buffer.getUnsignedShortBE();
        if (this.runAnimationId === 65535) {
            this.runAnimationId = -1;
        }
        this.playerName = TextUtils.formatName(TextUtils.longToName(buffer.getLongBE()));
        this.combatLevel = buffer.getUnsignedByte();
        this.skillLevel = buffer.getUnsignedShortBE();
        this.visible = true;
        this.appearanceHash = 0;
        const k1: number = this.appearance[5];
        const i2: number = this.appearance[9];
        this.appearance[5] = i2;
        this.appearance[9] = k1;
        for (let j2: number = 0; j2 < 12; j2++) {
            this.appearanceHash <<= 4;
            if (this.appearance[j2] >= 256) {
                this.appearanceHash += this.appearance[j2] - 256;
            }
        }
        if (this.appearance[0] >= 256) {
            this.appearanceHash += (this.appearance[0] - 256) >> 4;
        }
        if (this.appearance[1] >= 256) {
            this.appearanceHash += (this.appearance[1] - 256) >> 8;
        }
        this.appearance[5] = k1;
        this.appearance[9] = i2;
        for (let k2: number = 0; k2 < 5; k2++) {
            this.appearanceHash <<= 3;
            this.appearanceHash += this.appearanceColors[k2];
        }
        this.appearanceHash <<= 1;
        this.appearanceHash += this.gender;
    }
}
