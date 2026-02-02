import { CacheInfo, GameType } from "../../cache/CacheInfo";
import { CacheType } from "../../cache/CacheType";
import { ByteBuffer } from "../../io/ByteBuffer";
import { Type } from "../Type";

export type SeqFrameLengthLoader = {
    load(id: number): { frameLength: number } | undefined;
};

export class SeqSoundEffect {
    constructor(
        readonly id: number,
        readonly loops: number,
        readonly location: number,
        readonly retain: number,
    ) {}
}

export class SeqType extends Type {
    frameIds!: number[];
    chatFrameIds?: number[];
    frameLengths!: number[];
    frameSounds?: SeqSoundEffect[];

    frameStep: number;

    masks?: number[];

    stretches: boolean;

    forcedPriority: number;

    leftHandItem: number;
    rightHandItem: number;

    maxLoops: number;

    looping: boolean;

    precedenceAnimating: number;

    priority: number;

    replyMode: number;

    tweened: boolean;
    vorbisSound: boolean;
    soundVolumesByIndex?: Map<number, number>;
    soundRateMinByIndex?: Map<number, number>;
    soundRateMaxByIndex?: Map<number, number>;

    animMayaId: number;
    animMayaFrameSounds?: Map<number, SeqSoundEffect>;
    animMayaStart: number;
    animMayaEnd: number;
    animMayaMasks?: boolean[];

    rotateNormals: boolean;

    constructor(id: number, cacheInfo: CacheInfo) {
        super(id, cacheInfo);
        this.frameStep = -1;
        this.stretches = false;
        this.forcedPriority = 5;
        this.leftHandItem = -1;
        this.rightHandItem = -1;
        this.maxLoops = 99;
        this.looping = false;
        this.precedenceAnimating = -1;
        this.priority = -1;
        this.replyMode = 2;
        this.tweened = false;
        this.vorbisSound = false;
        this.animMayaId = -1;
        this.animMayaStart = 0;
        this.animMayaEnd = 0;
        this.rotateNormals = false;
    }

    getFrameLength(seqFrameLoader: SeqFrameLengthLoader, frame: number): number {
        let frameLength = this.frameLengths[frame];

        if (this.cacheType === CacheType.Legacy || this.cacheType === CacheType.Dat) {
            if (frameLength === 0) {
                const animFrame = seqFrameLoader.load(this.frameIds[frame]);
                if (animFrame) {
                    frameLength = this.frameLengths[frame] = animFrame.frameLength;
                }
            }

            if (frameLength === 0) {
                frameLength = 1;
            }
        }

        return frameLength;
    }

    isNewSoundEffects(): boolean {
        return this.cacheInfo.game === GameType.Oldschool && this.cacheInfo.revision >= 220;
    }

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        if (opcode === 1) {
            let count = 0;
            if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision < 456) {
                count = buffer.readUnsignedByte();
            } else {
                count = buffer.readUnsignedShort();
            }
            this.frameIds = new Array(count);
            this.frameLengths = new Array(count);

            if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision <= 377) {
                for (let i = 0; i < count; i++) {
                    this.frameIds[i] = buffer.readUnsignedShort();
                    // used by widgets
                    buffer.readUnsignedShort();
                    this.frameLengths[i] = buffer.readUnsignedShort();
                }
            } else {
                for (let i = 0; i < count; i++) {
                    this.frameLengths[i] = buffer.readUnsignedShort();
                }
                for (let i = 0; i < count; i++) {
                    this.frameIds[i] = buffer.readUnsignedShort();
                }
                for (let i = 0; i < count; i++) {
                    this.frameIds[i] += buffer.readUnsignedShort() << 16;
                }
            }
        } else if (opcode === 2) {
            this.frameStep = buffer.readUnsignedShort();
        } else if (opcode === 3) {
            const count = buffer.readUnsignedByte();
            this.masks = new Array(count + 1);
            for (let i = 0; i < count; i++) {
                this.masks[i] = buffer.readUnsignedByte();
            }
            this.masks[count] = 9999999;
        } else if (opcode === 4) {
            if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision <= 194) {
                this.stretches = buffer.readUnsignedShort() === 1;
            } else {
                this.stretches = true;
            }
        } else if (opcode === 5) {
            this.forcedPriority = buffer.readUnsignedByte();
        } else if (opcode === 6) {
            this.leftHandItem = buffer.readUnsignedShort();
        } else if (opcode === 7) {
            this.rightHandItem = buffer.readUnsignedShort();
        } else if (opcode === 8) {
            this.maxLoops = buffer.readUnsignedByte();
            this.looping = true;
        } else if (opcode === 9) {
            this.precedenceAnimating = buffer.readUnsignedByte();
        } else if (opcode === 10) {
            this.priority = buffer.readUnsignedByte();
        } else if (opcode === 11) {
            this.replyMode = buffer.readUnsignedByte();
        } else if (opcode === 12) {
            if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision <= 377) {
                buffer.readInt();
            } else {
                const count = buffer.readUnsignedByte();
                this.chatFrameIds = new Array(count);

                for (let i = 0; i < count; i++) {
                    this.chatFrameIds[i] = buffer.readUnsignedShort();
                }
                for (let i = 0; i < count; i++) {
                    this.chatFrameIds[i] += buffer.readUnsignedShort() << 16;
                }
            }
        } else if (opcode === 13) {
            // might be wrong start revision
            if (this.cacheInfo.game === GameType.Runescape && this.cacheInfo.revision >= 508) {
                const count = buffer.readUnsignedShort();
                for (let i = 0; i < count; i++) {
                    const effectCount = buffer.readUnsignedByte();
                    if (effectCount > 0) {
                        buffer.readMedium();
                        for (let e = 1; e < effectCount; e++) {
                            buffer.readUnsignedShort();
                        }
                    }
                }
            } else {
                const count = buffer.readUnsignedByte();
                this.frameSounds = new Array(count);

                const isNewSoundEffects = this.isNewSoundEffects();

                for (let i = 0; i < count; i++) {
                    let id: number;
                    let loops: number;
                    let location: number;
                    let retain: number = 0;
                    if (isNewSoundEffects) {
                        id = buffer.readUnsignedShort();
                        loops = buffer.readUnsignedByte();
                        location = buffer.readUnsignedByte();
                        retain = buffer.readUnsignedByte();
                    } else {
                        const sound = buffer.readUnsignedMedium();
                        id = sound >> 8;
                        loops = (sound >> 4) & 0x7;
                        location = sound & 0xf;
                    }
                    this.frameSounds[i] = new SeqSoundEffect(id, loops, location, retain);
                }
            }
        } else if (opcode === 14) {
            if (this.cacheInfo.game === GameType.Oldschool) {
                this.animMayaId = buffer.readInt();
            } else {
                this.rotateNormals = true;
            }
        } else if (opcode === 15) {
            if (this.cacheInfo.game === GameType.Oldschool) {
                const count = buffer.readUnsignedShort();
                this.animMayaFrameSounds = new Map();

                const isNewSoundEffects = this.isNewSoundEffects();

                for (let i = 0; i < count; i++) {
                    const frame = buffer.readUnsignedShort();
                    let id: number;
                    let loops: number;
                    let location: number;
                    let retain: number = 0;
                    if (isNewSoundEffects) {
                        id = buffer.readUnsignedShort();
                        loops = buffer.readUnsignedByte();
                        location = buffer.readUnsignedByte();
                        retain = buffer.readUnsignedByte();
                    } else {
                        const sound = buffer.readUnsignedMedium();
                        id = sound >> 8;
                        loops = (sound >> 4) & 0x7;
                        location = sound & 0xf;
                    }
                    this.animMayaFrameSounds.set(
                        frame,
                        new SeqSoundEffect(id, loops, location, retain),
                    );
                }
            } else {
                this.tweened = true;
            }
        } else if (opcode === 16) {
            if (this.cacheInfo.game === GameType.Oldschool) {
                this.animMayaStart = buffer.readUnsignedShort();
                this.animMayaEnd = buffer.readUnsignedShort();
            } else {
                // bool = true;
            }
        } else if (opcode === 17) {
            if (this.cacheInfo.game === GameType.Oldschool) {
                const count = buffer.readUnsignedByte();

                this.animMayaMasks = new Array(256).fill(false);

                for (let i = 0; i < count; i++) {
                    this.animMayaMasks[buffer.readUnsignedByte()] = true;
                }
            } else {
                const blendFlagCount = buffer.readUnsignedByte();
            }
        } else if (opcode === 18) {
            this.vorbisSound = true;
        } else if (opcode === 19) {
            const soundIndex = buffer.readUnsignedByte();
            const volume = buffer.readUnsignedByte();
            if (!this.soundVolumesByIndex) {
                this.soundVolumesByIndex = new Map();
            }
            this.soundVolumesByIndex.set(soundIndex, volume);
        } else if (opcode === 20) {
            const soundIndex = buffer.readUnsignedByte();
            const rateMin = buffer.readUnsignedShort();
            const rateMax = buffer.readUnsignedShort();
            if (!this.soundRateMinByIndex || !this.soundRateMaxByIndex) {
                this.soundRateMinByIndex = new Map();
                this.soundRateMaxByIndex = new Map();
            }
            this.soundRateMinByIndex.set(soundIndex, rateMin);
            this.soundRateMaxByIndex.set(soundIndex, rateMax);
        } else {
            throw new Error("SeqType: Opcode " + opcode + " not implemented.");
        }
    }

    hasAnimMayaSeq(): boolean {
        return this.animMayaId >= 0;
    }

    getAnimMayaDuration(): number {
        return this.animMayaEnd - this.animMayaStart;
    }
}
