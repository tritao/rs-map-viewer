import Long from "long";
import { Configuration } from "./Configuration";
import { BufferedConnection } from "./net/BufferedConnection";
import { Buffer } from "./net/Buffer";
import { Socket } from "./net/Socket";
import { TextUtils } from "./util/TextUtils";
import { SignLink } from "./util/SignLink";
import { ISAACCipher } from "./net/ISAACCipher";
import { LoginStatus, PacketConstants, IncomingPacket } from "./net/Packet";
import { array3d } from "./util/Arrays";
import { Player } from "./renderable/actor/Player";
import { Npc } from "./renderable/actor/Npc";

export enum MovementType {
    NONE = 0,
    WALK = 1,
    RUN = 2,
    TELEPORT = 3
}

export class Game {
    public static archiveHashes: number[] = [
        0, -1794511643, -1998798937, 1433713710, -1592896084,
        999217025, -1741782021, -2063599502, 1123906948
    ];

    gameConnection!: BufferedConnection;
    tempBuffer: Buffer = Buffer.allocate(1);
    incomingRandom: ISAACCipher | null = null;
    public outBuffer: Buffer = Buffer.allocate(1);
    buffer: Buffer = Buffer.allocate(1);
    loggedIn: boolean = false;
    opcode: number = 0;
    packetSize: number = 0;
    constructedMapPalette: number[][][] = array3d(4, 13, 13, 0);
    loadingStage: number = 0;

    chunkX: number = 0;
    chunkY: number = 0;

    maxPlayers: number = 2048;
    players: Player[] = Array(this.maxPlayers).fill(null);
    playerList: number[] = Array(this.maxPlayers).fill(0);
    updatedPlayers: number[] = Array(this.maxPlayers).fill(0);
    removePlayers: number[] = Array(1000).fill(0);
    localPlayerCount: number = 0;
    removePlayerCount: number = 0;
    updatedPlayerCount: number = 0;

    maxNpcs: number = 16384;
    npcs: Npc[] = Array(this.maxNpcs).fill(null);
    npcIds: number[] = Array(this.maxNpcs).fill(0);
    npcCount: number = 0;

    thisPlayerId: number = this.maxPlayers - 1;
    thisPlayerServerId: number = -1;

    public async openSocket(port: number): Promise<Socket> {
        const socket = new Socket(Configuration.SERVER_ADDRESS, port);
        await socket.connect();
        return socket;
    }

    public async process() {
        for (let i: number = 0; i < 5; i++) {
            if (!(await this.parseIncomingPacket())) {
                break;
            }
        }
        if (!this.loggedIn) {
            return;
        }
    }


    public async parseIncomingPacket(): Promise<boolean> {
        if (this.gameConnection == null) {
            return false;
        }
        try {
            let available: number = this.gameConnection.getAvailable();
            if (available === 0) {
                return false;
            }
            //console.log("available: ", available);
            if (this.opcode === -1) {
                await this.gameConnection.read$byte_A$int$int(this.buffer.buffer, 0, 1);
                this.opcode = this.buffer.buffer[0] & 255;
                if (this.incomingRandom != null) {
                    this.opcode = (this.opcode - this.incomingRandom.nextInt()) & 255;
                }
                this.packetSize = PacketConstants.PACKET_SIZES[this.opcode];
                available--;
            }
            if (this.packetSize === -1) {
                if (available > 0) {
                    await this.gameConnection.read$byte_A$int$int(this.buffer.buffer, 0, 1);
                    this.packetSize = this.buffer.buffer[0] & 255;
                    available--;
                } else {
                    return false;
                }
            }
            if (this.packetSize === -2) {
                if (available > 1) {
                    await this.gameConnection.read$byte_A$int$int(this.buffer.buffer, 0, 2);
                    this.buffer.currentPosition = 0;
                    this.packetSize = this.buffer.getUnsignedShortBE();
                    available -= 2;
                } else {
                    return false;
                }
            }
            if (available < this.packetSize) {
                return false;
            }
            this.buffer.currentPosition = 0;
            await this.gameConnection.read$byte_A$int$int(this.buffer.buffer, 0, this.packetSize);
            //this.timeoutCounter = 0;
            //this.thirdLastOpcode = this.secondLastOpcode;
            //this.secondLastOpcode = this.lastOpcode;
            //this.lastOpcode = this.opcode;

            console.log(`got opcode ${IncomingPacket[this.opcode]} (${this.opcode}), size ${this.packetSize}`);

            if (this.opcode === IncomingPacket.UPDATE_MEMBERSHIP_AND_WORLD_INDEX) {
                let playerMembers = this.buffer.getUnsignedByte();
                this.thisPlayerServerId = this.buffer.getUnsignedShortLE();
                this.opcode = -1;
                return true;
            }

            if (this.opcode === IncomingPacket.CHATBOX_MESSAGE) {
                const message: string = this.buffer.getString();
                console.log("  mesage: " + message);
                this.opcode = -1;
                return true;
            }

            if (this.opcode === IncomingPacket.SET_TAB_WIDGET) {
                const l8: number = this.buffer.getUnsignedPreNegativeOffsetByte();
                let j15: number = this.buffer.getUnsignedNegativeOffsetShortBE();
                if (j15 === 65535) {
                    j15 = -1;
                }
                this.opcode = -1;
                return true;
            }

            if (this.opcode === IncomingPacket.UPDATE_ALL_WIDGET_ITEMS) {
                //this.redrawTabArea = true;
                const interfaceId: number = this.buffer.getUnsignedShortBE();
                //const inter: Widget = Widget.forId(interfaceId);
                const items: number = this.buffer.getUnsignedShortBE();
                for (let item: number = 0; item < items; item++) {
                    {
                        //inter.items[item]
                        let id = this.buffer.getUnsignedNegativeOffsetShortLE();
                        let amount: number = this.buffer.getUnsignedInvertedByte();
                        if (amount === 255) {
                            amount = this.buffer.getIntLE();
                        }
                        //inter.itemAmounts[item] = amount;
                    }
                }
                this.opcode = -1;
                return true;
            }

            if (this.opcode === IncomingPacket.UPDATE_SKILL) {
                const j7: number = this.buffer.getUnsignedInvertedByte();
                const j14: number = this.buffer.getUnsignedByte();
                const j19: number = this.buffer.getIntBE();
                this.opcode = -1;
                return true;
            }

            if (this.opcode === IncomingPacket.UPDATE_PLAYER_CONTEXT_OPTION) {
                const slot: number = this.buffer.getUnsignedInvertedByte();
                let option: string | null = this.buffer.getString();
                const alwaysOnTop: number = this.buffer.getUnsignedByte();
                if (slot >= 1 && slot <= 5) {
                    if (/* equalsIgnoreCase */ ((o1, o2) => o1.toUpperCase() === (o2 === null ? o2 : o2.toUpperCase()))(option, "null")) {
                        option = null;
                    }
                }
                this.opcode = -1;
                return true;
            }

            if (this.opcode === IncomingPacket.UPDATE_ACTIVE_MAP_REGION ||
                this.opcode === IncomingPacket.CONSTRUCT_MAP_REGION) {
                let tmpChunkX: number = this.chunkX;
                let tmpChunkY: number = this.chunkY;
                if (this.opcode === IncomingPacket.UPDATE_ACTIVE_MAP_REGION) {
                    tmpChunkY = this.buffer.getUnsignedShortBE();
                    tmpChunkX = this.buffer.getUnsignedNegativeOffsetShortLE();
                }
                if (this.opcode === IncomingPacket.CONSTRUCT_MAP_REGION) {
                    tmpChunkX = this.buffer.getUnsignedNegativeOffsetShortBE();
                    this.buffer.initBitAccess();
                    for (let z: number = 0; z < 4; z++) {
                        {
                            for (let x: number = 0; x < 13; x++) {
                                {
                                    for (let y: number = 0; y < 13; y++) {
                                        {
                                            const flag: number = this.buffer.getBits(1);
                                            if (flag === 1) {
                                                this.constructedMapPalette[z][x][y] = this.buffer.getBits(26);
                                            } else {
                                                this.constructedMapPalette[z][x][y] = -1;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    this.buffer.finishBitAccess();
                    tmpChunkY = this.buffer.getUnsignedNegativeOffsetShortBE();
                }
                if (this.chunkX === tmpChunkX && this.chunkY === tmpChunkY && this.loadingStage === 2) {
                    this.opcode = -1;
                    return true;
                }
                this.chunkX = tmpChunkX;
                this.chunkY = tmpChunkY;
                console.log(`got region update for X: ${this.chunkX}, Y: ${this.chunkY}`);

                this.loadingStage = 1;

                this.opcode = -1;
                return true;
            }

            if (this.opcode === IncomingPacket.PLAYER_UPDATING) {
                this.updatePlayers(this.packetSize, this.buffer);
                this.opcode = -1;
                return true;
            }

            if (this.opcode === IncomingPacket.NPC_UPDATING) {
                this.updateNpcs(this.buffer, this.packetSize);
                this.opcode = -1;
                return true;
            }

            if (this.opcode != -1) {
                process.exit();
            }

        } catch (__e: any) {
            // if (__e != null && __e instanceof IOException as any) {
            //     this.dropClient();

            // }
            if (__e != null && ((__e instanceof Error) as any)) {
                const exception: Error = __e as Error;
                //     let s1: string =
                //         "T2 - " + this.opcode + "," + this.secondLastOpcode + "," + this.thirdLastOpcode + " - " + this.packetSize + "," +
                //         (this.nextTopLeftTileX + Game.localPlayer.pathX[0]) + "," + (this.nextTopRightTileY + Game.localPlayer.pathY[0]) + " - ";
                //     for (let j16: number = 0; j16 < this.packetSize && j16 < 50; j16++) {
                //         s1 = s1 + this.buffer.buffer[j16] + ",";
                //     }
                //     console.error(s1);
                //     this.logout();
                console.error(exception.message, exception);
            }
        }

        return true;
    }

    public updateNpcs(buffer: Buffer, packetSize: number) {
        this.removePlayerCount = 0;
        this.updatedPlayerCount = 0;
        this.updateNpcMovement(buffer);
        this.processNewNpcs(buffer, packetSize);
        this.parseNpcUpdateMasks(buffer, packetSize, 838);

        //for (let j: number = 0; j < this.removePlayerCount; j++) {
        //    {
        //        const npcIndex: number = this.removePlayers[j];
        //        if (this.npcs[npcIndex].pulseCycle !== Game.pulseCycle) {
        //            this.npcs[npcIndex].npcDefinition = null;
        //            this.npcs[npcIndex] = null;
        //        }
        //    }
        //}
        if (buffer.currentPosition !== packetSize) {
            console.error(
                " size mismatch in getnpcpos - coord:" + buffer.currentPosition + " psize:" + packetSize
            );
            throw Error("eek");
        }

        for (let l: number = 0; l < this.npcCount; l++) {
            if (this.npcs[this.npcIds[l]] == null) {
                console.error(" null entry in npc list - coord:" + l + " size:" + this.npcCount);
                throw Error("eek");
            }
        }
    }


    public updateNpcMovement(buffer: Buffer) {
        buffer.initBitAccess();
        const j: number = buffer.getBits(8);
        if (j < this.npcCount) {
            //    for (let k: number = j; k < this.npcCount; k++) {
            //        this.removePlayers[this.removePlayerCount++] = this.npcIds[k];
        }
        //}
        if (j > this.npcCount) {
            console.error(" Too many npcs");
            throw Error("eek");
        }
        this.npcCount = 0;
        for (let l: number = 0; l < j; l++) {
            {
                const npcId: number = this.npcIds[l];
                //const npc: Npc = this.npcs[i1];
                const updateRequired: number = buffer.getBits(1);
                if (updateRequired === 0) {
                    this.npcIds[this.npcCount++] = npcId;
                    //npc.pulseCycle = Game.pulseCycle;
                } else {
                    const moveType: number = buffer.getBits(2);
                    if (moveType === MovementType.NONE) {
                        this.npcIds[this.npcCount++] = npcId;
                        //npc.pulseCycle = Game.pulseCycle;
                        this.updatedPlayers[this.updatedPlayerCount++] = npcId;
                    } else if (moveType === MovementType.WALK) {
                        this.npcIds[this.npcCount++] = npcId;
                        //npc.pulseCycle = Game.pulseCycle;
                        const direction: number = buffer.getBits(3);
                        //npc.move(direction, false);
                        const blockUpdateRequired: number = buffer.getBits(1);
                        if (blockUpdateRequired === 1) {
                            this.updatedPlayers[this.updatedPlayerCount++] = npcId;
                        }
                    } else if (moveType === MovementType.RUN) {
                        this.npcIds[this.npcCount++] = npcId;
                        //npc.pulseCycle = Game.pulseCycle;
                        const direction1: number = buffer.getBits(3);
                        //npc.move(direction1, true);
                        const direction2: number = buffer.getBits(3);
                        //npc.move(direction2, true);
                        const blockUpdateRequired: number = buffer.getBits(1);
                        if (blockUpdateRequired === 1) {
                            this.updatedPlayers[this.updatedPlayerCount++] = npcId;
                        }
                    } else if (moveType === MovementType.TELEPORT) {
                        this.removePlayers[this.removePlayerCount++] = npcId;
                    }
                }
            }
        }
    }


    public processNewNpcs(buffer: Buffer, i: number) {
        while (buffer.bitPosition + 21 < i * 8) {
            const j: number = buffer.getBits(14);
            if (j === 16383) {
                break;
            }
            if (this.npcs[j] == null) {
                this.npcs[j] = new Npc();
            }
            //const npc: Npc = this.npcs[j];
            this.npcIds[this.npcCount++] = j;
            //npc.pulseCycle = Game.pulseCycle;
            const k: number = buffer.getBits(1);
            if (k === 1) {
                this.updatedPlayers[this.updatedPlayerCount++] = j;
            }
            let l: number = buffer.getBits(5);
            if (l > 15) {
                l -= 32;
            }
            let i1: number = buffer.getBits(5);
            if (i1 > 15) {
                i1 -= 32;
            }
            const j1: number = buffer.getBits(1);
            let actorDef = buffer.getBits(13);
            //npc.npcDefinition = ActorDefinition.getDefinition();
            //npc.boundaryDimension = npc.npcDefinition.boundaryDimension;
            //npc.anInt1600 = npc.npcDefinition.degreesToTurn;
            //npc.walkAnimationId = npc.npcDefinition.walkAnimationId;
            //npc.turnAroundAnimationId = npc.npcDefinition.turnAroundAnimationId;
            //npc.turnRightAnimationId = npc.npcDefinition.turnRightAnimationId;
            //npc.turnLeftAnimationId = npc.npcDefinition.turnLeftAnimationId;
            //npc.idleAnimation = npc.npcDefinition.standAnimationId;
            //npc.setPosition(Game.localPlayer.pathX[0] + i1, Game.localPlayer.pathY[0] + l, j1 === 1);
        }
        buffer.finishBitAccess();
    }


    public parseNpcUpdateMasks(buffer: Buffer, i: number, j: number) {
        j = (24 / j) | 0;
        for (let k: number = 0; k < this.updatedPlayerCount; k++) {
            {
                const l: number = this.updatedPlayers[k];
                //const npc: Npc = this.npcs[l];
                const i1: number = buffer.getUnsignedByte();
                if ((i1 & 1) !== 0) {
                    //npc.npcDefinition = ActorDefinition.getDefinition(buffer.getUnsignedNegativeOffsetShortBE());
                    //npc.boundaryDimension = npc.npcDefinition.boundaryDimension;
                    //npc.anInt1600 = npc.npcDefinition.degreesToTurn;
                    //npc.walkAnimationId = npc.npcDefinition.walkAnimationId;
                    //npc.turnAroundAnimationId = npc.npcDefinition.turnAroundAnimationId;
                    //npc.turnRightAnimationId = npc.npcDefinition.turnRightAnimationId;
                    //npc.turnLeftAnimationId = npc.npcDefinition.turnLeftAnimationId;
                    //npc.idleAnimation = npc.npcDefinition.standAnimationId;
                }
                if ((i1 & 0x40) !== 0) {
                    //npc.
                    let faceActor = buffer.getUnsignedShortLE();
                    //if (npc.faceActor === 65535) {
                    //    npc.faceActor = -1;
                    //}
                }
                if ((i1 & 0x80) !== 0) {
                    const j1: number = buffer.getUnsignedPostNegativeOffsetByte();
                    const j2: number = buffer.getUnsignedPostNegativeOffsetByte();
                    //npc.updateHits(j2, j1, Game.pulseCycle);
                    //npc.endCycle = Game.pulseCycle + 300;
                    //npc.anInt1596 = buffer.getUnsignedByte();
                    //npc.anInt1597 = buffer.getByteSubtracted();
                }
                if ((i1 & 4) !== 0) {
                    //npc.graphic = buffer.getUnsignedLEShort();
                    const k1: number = buffer.getIntME1();
                    //npc.spotGraphicHeight = k1 >> 16;
                    //npc.spotGraphicDelay = Game.pulseCycle + (k1 & 0xffff);
                    //npc.currentAnimation = 0;
                    //npc.animationCycle = 0;
                    //if (npc.spotGraphicDelay > Game.pulseCycle) {
                    //    npc.currentAnimation = -1;
                    //}
                    //if (npc.graphic === 65535) {
                    //    npc.graphic = -1;
                    //}
                }
                if ((i1 & 0x20) !== 0) {
                    //npc.forcedChat = buffer.getString();
                    //npc.textCycle = 100;
                }
                if ((i1 & 8) !== 0) {
                    //npc.
                    let faceX = buffer.getUnsignedNegativeOffsetShortLE();
                    //npc.
                    let faceY = buffer.getUnsignedShortLE();
                }
                if ((i1 & 2) !== 0) {
                    let l1: number = buffer.getUnsignedShortBE();
                    if (l1 === 65535) {
                        l1 = -1;
                    }
                    const k2: number = buffer.getUnsignedPreNegativeOffsetByte();
                    //if (l1 === npc.emoteAnimation && l1 !== -1) {
                    //    const i3: number = AnimationSequence.animations[l1].anInt307;
                    //    if (i3 === 1) {
                    //        npc.displayedEmoteFrames = 0;
                    //        npc.animationSequence = 0;
                    //        npc.animationDelay = k2;
                    //        npc.animationResetCycle = 0;
                    //    }
                    //    if (i3 === 2) {
                    //        npc.animationResetCycle = 0;
                    //    }
                    //} else if (
                    //    l1 === -1 ||
                    //    npc.emoteAnimation === -1 ||
                    //    AnimationSequence.animations[l1].anInt301 >=
                    //        AnimationSequence.animations[npc.emoteAnimation].anInt301
                    //) {
                    //    npc.emoteAnimation = l1;
                    //    npc.displayedEmoteFrames = 0;
                    //    npc.animationSequence = 0;
                    //    npc.animationDelay = k2;
                    //    npc.animationResetCycle = 0;
                    //    npc.stillPathPosition = npc.pathLength;
                    //}
                }
                if ((i1 & 0x10) !== 0) {
                    const i2: number = buffer.getUnsignedPreNegativeOffsetByte();
                    const l2: number = buffer.getUnsignedPreNegativeOffsetByte();
                    //npc.updateHits(l2, i2, Game.pulseCycle);
                    //npc.endCycle = Game.pulseCycle + 300;
                    //npc.
                    let anInt1596 = buffer.getUnsignedByte();
                    //npc.
                    let anInt1597 = buffer.getUnsignedInvertedByte();
                }
            }
        }
    }



    /*private*/ public updatePlayers(size: number, buffer: Buffer) {
        this.removePlayerCount = 0;
        this.updatedPlayerCount = 0;
        this.updateLocalPlayerMovement(buffer);
        this.updateOtherPlayerMovement(buffer);
        this.addNewPlayers(size, buffer);
        this.parsePlayerBlocks(buffer);
        for (let i: number = 0; i < this.removePlayerCount; i++) {
            {
                // const index: number = this.removePlayers[i];
                // if (this.players[index].pulseCycle !== Game.pulseCycle) {
                //     this.players[index] = null;
                // }
            }
        }
        if (buffer.currentPosition !== size) {
            console.log("Error packet size mismatch in getplayer coord:" + buffer.currentPosition + " psize:" + size);
            throw Error("eek");
        }
        // for (let i: number = 0; i < this.localPlayerCount; i++) {
        //     if (this.players[this.playerList[i]] == null) {
        //         SignLink.reportError(this.username + " null entry in pl list - coord:" + i + " size:" + this.localPlayerCount);
        //         throw Error("eek");
        //     }
        // }
    }


    /*private*/ public updateLocalPlayerMovement(buffer: Buffer) {
        buffer.initBitAccess();

        const moved: number = buffer.getBits(1);
        if (moved === 0) {
            return;
        }

        const moveType: MovementType = buffer.getBits(2);
        if (moveType === MovementType.NONE) {
            this.updatedPlayers[this.updatedPlayerCount++] = this.thisPlayerId;
            return;
        }

        if (moveType === MovementType.WALK) {
            const direction: number = buffer.getBits(3);
            //Game.localPlayer.move(direction, false);
            const blockUpdateRequired: number = buffer.getBits(1);
            if (blockUpdateRequired === 1) {
                this.updatedPlayers[this.updatedPlayerCount++] = this.thisPlayerId;
            }
            return;
        }

        if (moveType === MovementType.RUN) {
            const direction1: number = buffer.getBits(3);
            //Game.localPlayer.move(direction1, true);
            const direction2: number = buffer.getBits(3);
            //Game.localPlayer.move(direction2, true);
            const blockUpdateRequired: number = buffer.getBits(1);
            if (blockUpdateRequired === 1) {
                this.updatedPlayers[this.updatedPlayerCount++] = this.thisPlayerId;
            }
            return;
        }
        if (moveType === MovementType.TELEPORT) {
            const discardWalkingQueue: number = buffer.getBits(1);
            let plane = buffer.getBits(2);
            const localY: number = buffer.getBits(7);
            const localX: number = buffer.getBits(7);
            const blockUpdateRequired: number = buffer.getBits(1);
            if (blockUpdateRequired === 1) {
                this.updatedPlayers[this.updatedPlayerCount++] = this.thisPlayerId;
            }
            //Game.localPlayer.setPosition(localX, localY, discardWalkingQueue === 1);
        }
    }


    /*private*/ public updateOtherPlayerMovement(buffer: Buffer) {
        const playerCount: number = buffer.getBits(8);

        // if (playerCount < this.localPlayerCount) {
        //     for (let i: number = playerCount; i < this.localPlayerCount; i++) {
        //         this.removePlayers[this.removePlayerCount++] = this.playerList[i];
        //     }
        //}

        // if (playerCount > this.localPlayerCount) {
        //     SignLink.reportError(this.username + " Too many players");
        //     throw Error("eek");
        // }

        //this.localPlayerCount = 0;

        for (let i: number = 0; i < playerCount; i++) {
            {
                const id = 0;
                //const id: number = this.playerList[i];
                //const player: Player = this.players[id];
                const updated: number = buffer.getBits(1);
                if (updated === 0) {
                    //this.playerList[this.localPlayerCount++] = id;
                    //player.pulseCycle = Game.pulseCycle;
                } else {
                    const moveType: number = buffer.getBits(2);
                    if (moveType === MovementType.NONE) {
                        //this.playerList[this.localPlayerCount++] = id;
                        //player.pulseCycle = Game.pulseCycle;
                        this.updatedPlayers[this.updatedPlayerCount++] = id;
                    } else if (moveType === MovementType.WALK) {
                        //this.playerList[this.localPlayerCount++] = id;
                        //player.pulseCycle = Game.pulseCycle;
                        const direction: number = buffer.getBits(3);
                        //player.move(direction, false);
                        const blockUpdateRequired: number = buffer.getBits(1);
                        if (blockUpdateRequired === MovementType.RUN) {
                            this.updatedPlayers[this.updatedPlayerCount++] = id;
                        }
                    } else if (moveType === MovementType.RUN) {
                        //this.playerList[this.localPlayerCount++] = id;
                        //player.pulseCycle = Game.pulseCycle;
                        const direction1: number = buffer.getBits(3);
                        //player.move(direction1, true);
                        const direction2: number = buffer.getBits(3);
                        //player.move(direction2, true);
                        const updateRequired: number = buffer.getBits(1);
                        if (updateRequired === 1) {
                            this.updatedPlayers[this.updatedPlayerCount++] = id;
                        }
                    } else if (moveType === MovementType.TELEPORT) {
                        //this.removePlayers[this.removePlayerCount++] = id;
                    }
                }
            }
        }
    }


    /*private*/ public addNewPlayers(size: number, buffer: Buffer) {
        while (buffer.bitPosition + 10 < size * 8) {
            {
                const id: number = buffer.getBits(11);
                if (id === 2047) {
                    break;
                }
                //if (this.players[id] == null) {
                //    this.players[id] = new Player();
                //    if (this.cachedAppearances[id] != null) {
                //        this.players[id].updateAppearance(this.cachedAppearances[id]);
                //    }
                //}

                this.playerList[this.localPlayerCount++] = id;
                //const player: Player = this.players[id];
                //player.pulseCycle = Game.pulseCycle;

                let x: number = buffer.getBits(5);
                if (x > 15) {
                    x -= 32;
                }
                const updated: number = buffer.getBits(1);
                if (updated === 1) {
                    this.updatedPlayers[this.updatedPlayerCount++] = id;
                }
                const discardQueue: number = buffer.getBits(1);
                let y: number = buffer.getBits(5);
                if (y > 15) {
                    y -= 32;
                }
                //player.setPosition(Game.localPlayer.pathX[0] + x, Game.localPlayer.pathY[0] + y, discardQueue === 1);
            }
        }

        buffer.finishBitAccess();
    }



    /*private*/ public parsePlayerBlocks(buffer: Buffer) {
        for (let i: number = 0; i < this.updatedPlayerCount; i++) {
            {
                const id: number = this.updatedPlayers[i];
                //const player: Player = this.players[id];
                let mask: number = buffer.getUnsignedByte();
                if ((mask & 32) !== 0) {
                    mask += buffer.getUnsignedByte() << 8;
                }
                this.parsePlayerBlock(0, mask, buffer);
            }
        }
    }


    /*private*/ public parsePlayerBlock(id: number, mask: number, buffer: Buffer) {
        if ((mask & 8) !== 0) {
            let animation: number = buffer.getUnsignedShortBE();
            if (animation === 65535) {
                animation = -1;
            }
            const delay: number = buffer.getUnsignedPreNegativeOffsetByte();
            //if (animation === player.emoteAnimation && animation !== -1) {
            //    const mode: number = AnimationSequence.animations[animation].anInt307;
            //    if (mode === 1) {
            //        player.displayedEmoteFrames = 0;
            //        player.animationSequence = 0;
            //        player.animationDelay = delay;
            //        player.animationResetCycle = 0;
            //    }
            //    if (mode === 2) {
            //        player.animationResetCycle = 0;
            //    }
            //} else if (
            //    animation === -1 ||
            //    player.emoteAnimation === -1 ||
            //    AnimationSequence.animations[animation].anInt301 >= AnimationSequence.animations[player.emoteAnimation].anInt301
            //) {
            //    player.emoteAnimation = animation;
            //    player.displayedEmoteFrames = 0;
            //    player.animationSequence = 0;
            //    player.animationDelay = delay;
            //    player.animationResetCycle = 0;
            //    player.stillPathPosition = player.pathLength;
            //}
        }
        if ((mask & 0x10) !== 0) {
            let forcedChat = buffer.getString();
            if ((c => (c.charCodeAt == null ? (c as any) : c.charCodeAt(0)))(forcedChat.charAt(0)) == "~".charCodeAt(0)) {
                //player.forcedChat = player.forcedChat.substring(1);
                //this.addChatMessage(player.playerName, player.forcedChat, 2);
            }
            //else if (player === Game.localPlayer) {
            //    this.addChatMessage(player.playerName, player.forcedChat, 2);
            //}
            //player.textColour = 0;
            //player.textEffect = 0;
            //player.textCycle = 150;
        }
        if ((mask & 0x100) !== 0) {
            let movementStartX = buffer.getUnsignedPostNegativeOffsetByte();
            let movementStartY = buffer.getUnsignedInvertedByte();
            let movementEndX = buffer.getUnsignedPreNegativeOffsetByte();
            let movementEndY = buffer.getUnsignedByte();
            let moveCycleEnd = buffer.getUnsignedShortBE(); // + Game.pulseCycle;
            let moveCycleStart = buffer.getUnsignedNegativeOffsetShortBE(); // + Game.pulseCycle;
            let moveDirection = buffer.getUnsignedByte();

            //player.resetPath();
        }
        if ((mask & 1) !== 0) {
            let faceActor = buffer.getUnsignedNegativeOffsetShortBE();
            if (faceActor === 65535) {
                faceActor = -1;
            }
        }
        if ((mask & 2) !== 0) {
            let faceX = buffer.getUnsignedShortBE();
            let faceY = buffer.getUnsignedShortBE();
        }
        if ((mask & 512) !== 0) {
            let graphic = buffer.getUnsignedNegativeOffsetShortBE();
            const heightAndDelay: number = buffer.getIntME1();
            //player.spotGraphicHeight = heightAndDelay >> 16;
            //player.spotGraphicDelay = Game.pulseCycle + (heightAndDelay & 65535);
            //player.currentAnimation = 0;
            //player.animationCycle = 0;
            //if (player.spotGraphicDelay > Game.pulseCycle) {
            //    player.currentAnimation = -1;
            //}
            //if (player.graphic === 65535) {
            //    player.graphic = -1;
            //}
        }
        if ((mask & 4) !== 0) {
            const size: number = buffer.getUnsignedByte();
            const bytes: number[] = (s => {
                const a = [];
                while (s-- > 0) {
                    a.push(0);
                }
                return a;
            })(size);
            const appearance: Buffer = new Buffer(bytes);
            buffer.getBytesReverse(bytes, 0, size);
            //this.cachedAppearances[id] = appearance;
            //player.updateAppearance(appearance);
        }
        if ((mask & 1024) !== 0) {
            const damage: number = buffer.getUnsignedPostNegativeOffsetByte();
            const type: number = buffer.getUnsignedPreNegativeOffsetByte();
            //player.updateHits(type, damage, Game.pulseCycle);
            //player.endCycle = Game.pulseCycle + 300;
            let anInt1596 = buffer.getUnsignedInvertedByte();
            let anInt1597 = buffer.getUnsignedByte();
        }
        if ((mask & 64) !== 0) {
            const effectsAndColour: number = buffer.getUnsignedShortBE();
            const rights: number = buffer.getUnsignedInvertedByte();
            const length: number = buffer.getUnsignedPostNegativeOffsetByte();
            const currentPosition: number = buffer.currentPosition;
            // TODO: process message
            buffer.currentPosition = currentPosition + length;
        }
        if ((mask & 128) !== 0) {
            const damage: number = buffer.getUnsignedPreNegativeOffsetByte();
            const type: number = buffer.getUnsignedInvertedByte();

            //player.updateHits(type, damage, Game.pulseCycle);
            //player.endCycle = Game.pulseCycle + 300;

            let anInt1596 = buffer.getUnsignedPreNegativeOffsetByte();
            let anInt1597 = buffer.getUnsignedByte();
        }
    }


    public async login(username: string, password: string, reconnecting: boolean = false) {
        let socket = await this.openSocket(Configuration.GAME_PORT);
        this.gameConnection = new BufferedConnection(socket);

        const base37name: Long = TextUtils.nameToLong(username);
        const hash: number = ((base37name.shiftRight(16).toNumber() & 31) as number) | 0;

        this.outBuffer.currentPosition = 0;
        this.outBuffer.putByte(14);
        this.outBuffer.putByte(hash);
        this.gameConnection.write(2, 0, this.outBuffer.buffer);

        for (let j: number = 0; j < 8; j++) {
            await this.gameConnection.read$();
        }

        let responseCode: number = await this.gameConnection.read$();
        if (responseCode === LoginStatus.STATUS_EXCHANGE_DATA) {
            responseCode = await this.sendLoginHandshake(username, password, reconnecting);
            //console.log(`login response code: ${LoginStatus[responseCode]}`);
        }

        if (responseCode === LoginStatus.STATUS_DELAY) {
            //                 try {
            //                     await sleep(500);
            //                 } catch (ignored) {}
            //                 this.login(username, password, reconnecting);
            //                 return;
        }
        if (responseCode === LoginStatus.STATUS_OK) {
            let playerRights = await this.gameConnection.read$();
            let accountFlagged = (await this.gameConnection.read$()) === 1;

            this.loggedIn = true;
            this.outBuffer.currentPosition = 0;
            this.buffer.currentPosition = 0;
            this.opcode = -1;
            //                 this.lastOpcode = -1;
            //                 this.secondLastOpcode = -1;
            //                 this.thirdLastOpcode = -1;
            this.packetSize = 0;
            //                 this.timeoutCounter = 0;
            //                 this.systemUpdateTime = 0;
            //                 this.idleTime = 0;
            //                 this.anInt850 = (((Math.random() * 100.0) as number) | 0) - 50;
            //                 this.anInt1009 = (((Math.random() * 110.0) as number) | 0) - 55;
            //                 this.anInt1255 = (((Math.random() * 80.0) as number) | 0) - 40;
            //                 this.anInt916 = (((Math.random() * 120.0) as number) | 0) - 60;
            //                 this.anInt1233 = (((Math.random() * 30.0) as number) | 0) - 20;
            //                 this.cameraHorizontal = ((((Math.random() * 20.0) as number) | 0) - 10) & 2047;
            //                 this.minimapState = 0;
            //                 this.anInt1276 = -1;
            //                 this.destinationX = 0;
            //                 this.destinationY = 0;
                             this.localPlayerCount = 0;
                             this.npcCount = 0;
            //                 for (let i2: number = 0; i2 < this.anInt968; i2++) {
            //                     {
            //                         this.players[i2] = null;
            //                         this.cachedAppearances[i2] = null;
            //                     }
            //                 }
            //                 for (let k2: number = 0; k2 < 16384; k2++) {
            //                     this.npcs[k2] = null;
            //                 }
            //                 Game.localPlayer = this.players[this.thisPlayerId] = new Player();
            //                 this.aClass6_1282.getNodeCount();
            //                 this.aClass6_1210.getNodeCount();
            //                 for (let l2: number = 0; l2 < 4; l2++) {
            //                     {
            //                         for (let i3: number = 0; i3 < 104; i3++) {
            //                             {
            //                                 for (let k3: number = 0; k3 < 104; k3++) {
            //                                     this.groundItems[l2][i3][k3] = null;
            //                                 }
            //                             }
            //                         }
            //                     }
            //                 }
        }
        //             if (responseCode === 3) {
        //                 this.statusLineOne = "";
        //                 this.statusLineTwo = "Invalid username or password.";
        //                 return;
        //             }
        //             if (responseCode === 4) {
        //                 this.statusLineOne = "Your account has been disabled.";
        //                 this.statusLineTwo = "Please check your message-centre for details.";
        //                 return;
        //             }
        //             if (responseCode === 5) {
        //                 this.statusLineOne = "Your account is already logged in.";
        //                 this.statusLineTwo = "Try again in 60 secs...";
        //                 return;
        //             }
        //             if (responseCode === 6) {
        //                 this.statusLineOne = "RuneScape has been updated!";
        //                 this.statusLineTwo = "Please reload this page.";
        //                 return;
        //             }
        //             if (responseCode === 7) {
        //                 this.statusLineOne = "This world is full.";
        //                 this.statusLineTwo = "Please use a different world.";
        //                 return;
        //             }
        //             if (responseCode === 8) {
        //                 this.statusLineOne = "Unable to connect.";
        //                 this.statusLineTwo = "Login server offline.";
        //                 return;
        //             }
        //             if (responseCode === 9) {
        //                 this.statusLineOne = "Login limit exceeded.";
        //                 this.statusLineTwo = "Too many connections from your address.";
        //                 return;
        //             }
        //             if (responseCode === 10) {
        //                 this.statusLineOne = "Unable to connect.";
        //                 this.statusLineTwo = "Bad session id.";
        //                 return;
        //             }
        //             if (responseCode === 12) {
        //                 this.statusLineOne = "You need a members account to login to this world.";
        //                 this.statusLineTwo = "Please subscribe, or use a different world.";
        //                 return;
        //             }
        //             if (responseCode === 13) {
        //                 this.statusLineOne = "Could not complete login.";
        //                 this.statusLineTwo = "Please try using a different world.";
        //                 return;
        //             }
        //             if (responseCode === 14) {
        //                 this.statusLineOne = "The server is being updated.";
        //                 this.statusLineTwo = "Please wait 1 minute and try again.";
        //                 return;
        //             }
        //             if (responseCode === 15) {
        //                 this.loggedIn = true;
        //                 this.outBuffer.currentPosition = 0;
        //                 this.buffer.currentPosition = 0;
        //                 this.opcode = -1;
        //                 this.lastOpcode = -1;
        //                 this.secondLastOpcode = -1;
        //                 this.thirdLastOpcode = -1;
        //                 this.packetSize = 0;
        //                 this.timeoutCounter = 0;
        //                 this.systemUpdateTime = 0;
        //                 this.menuActionRow = 0;
        //                 this.menuOpen = false;
        //                 this.aLong1229 = new Date().getTime();
        //                 return;
        //             }
        //             if (responseCode === 16) {
        //                 this.statusLineOne = "Login attempts exceeded.";
        //                 this.statusLineTwo = "Please wait 1 minute and try again.";
        //                 return;
        //             }
        //             if (responseCode === 17) {
        //                 this.statusLineOne = "You are standing in a members-only area.";
        //                 this.statusLineTwo = "To play on this world move to a free area first";
        //                 return;
        //             }
        //             if (responseCode === 18) {
        //                 this.statusLineOne = "Account locked as we suspect it has been stolen.";
        //                 this.statusLineTwo = "Press 'recover a locked account' on front page.";
        //                 return;
        //             }
        //             if (responseCode === 20) {
        //                 this.statusLineOne = "Invalid loginserver requested";
        //                 this.statusLineTwo = "Please try using a different world.";
        //                 return;
        //             }
        //             if (responseCode === 21) {
        //                 let time: number = await this.gameConnection.read$();
        //                 for (time += 3; time >= 0; time--) {
        //                     {
        //                         this.statusLineOne = "You have only just left another world";
        //                         this.statusLineTwo = "Your profile will be transferred in: " + time;
        //                         await this.drawLoginScreen(true);
        //                         try {
        //                             await sleep(1200);
        //                         } catch (ignored) {}
        //                     }
        //                 }
        //                 this.login(username, password, reconnecting);
        //                 return;
        //             }
        //             if (responseCode === 22) {
        //                 this.statusLineOne = "Malformed login packet.";
        //                 this.statusLineTwo = "Please try again.";
        //                 return;
        //             }
        //             if (responseCode === 23) {
        //                 this.statusLineOne = "No reply from loginserver.";
        //                 this.statusLineTwo = "Please try again.";
        //                 return;
        //             }
        //             if (responseCode === 24) {
        //                 this.statusLineOne = "Error loading your profile.";
        //                 this.statusLineTwo = "Please contact customer support.";
        //                 return;
        //             }
        //             if (responseCode === 25) {
        //                 this.statusLineOne = "Unexpected loginserver response.";
        //                 this.statusLineTwo = "Please try using a different world.";
        //                 return;
        //             }
        //             if (responseCode === 26) {
        //                 this.statusLineOne = "This computers address has been blocked";
        //                 this.statusLineTwo = "as it was used to break our rules";
        //                 return;
        //             }
        //             if (responseCode === -1) {
        //                 if (initialResponseCode === 0) {
        //                     if (this.anInt850 < 2) {
        //                         try {
        //                             await sleep(2000);
        //                         } catch (ignored) {}
        //                         this.anInt850++;
        //                         this.login(username, password, reconnecting);
        //                         return;
        //                     } else {
        //                         this.statusLineOne = "No response from loginserver";
        //                         this.statusLineTwo = "Please wait 1 minute and try again.";
        //                         return;
        //                     }
        //                 } else {
        //                     this.statusLineOne = "No response from server";
        //                     this.statusLineTwo = "Please try using a different world.";
        //                     return;
        //                 }
        //             } else {
        //                 console.info("response:" + responseCode);
        //                 this.statusLineOne = "Unexpected server response";
        //                 this.statusLineTwo = "Please try using a different world.";
        //                 return;
        //             }
        //         } catch (ex) {
        //             this.statusLineOne = "";
        //         }
        //         this.statusLineTwo = "Error connecting to server.";
    }

    private async sendLoginHandshake(username: string, password: string, reconnecting: boolean): Promise<number> {
        await this.gameConnection.read$byte_A$int$int(this.buffer.buffer, 0, 8);
        this.buffer.currentPosition = 0;

        const seed: number[] = [0, 0, 0, 0];
        seed[0] = ((Math.random() * 9.9999999e7) as number) | 0;
        seed[1] = ((Math.random() * 9.9999999e7) as number) | 0;
        seed[2] = this.buffer.getIntBE();
        seed[3] = this.buffer.getIntBE();

        this.outBuffer.currentPosition = 0;
        this.outBuffer.putByte(10);
        this.outBuffer.putIntBE(seed[0]);
        this.outBuffer.putIntBE(seed[1]);
        this.outBuffer.putIntBE(seed[2]);
        this.outBuffer.putIntBE(seed[3]);
        this.outBuffer.putIntBE(SignLink.uid);
        this.outBuffer.putString(username);
        this.outBuffer.putString(password);

        if (Configuration.RSA_ENABLED) {
            this.outBuffer.encrypt(Configuration.RSA_MODULUS, Configuration.RSA_PUBLIC_KEY);
        }

        this.tempBuffer.currentPosition = 0;
        if (reconnecting) {
            this.tempBuffer.putByte(18);
        } else {
            this.tempBuffer.putByte(16);
        }

        this.tempBuffer.putByte(this.outBuffer.currentPosition + 36 + 1 + 1 + 2);
        this.tempBuffer.putByte(255);
        this.tempBuffer.putShortBE(SignLink.CLIENT_REVISION);
        const lowMemory = false;
        this.tempBuffer.putByte(lowMemory ? 1 : 0);
        for (let i: number = 0; i < 9; i++) {
            this.tempBuffer.putIntBE(Game.archiveHashes[i]);
        }
        this.tempBuffer.putBytes(this.outBuffer.buffer, 0, this.outBuffer.currentPosition);

        this.outBuffer.random = new ISAACCipher(seed);
        for (let i: number = 0; i < 4; i++) {
            seed[i] += 50;
        }
        this.incomingRandom = new ISAACCipher(seed);
        this.gameConnection.write(this.tempBuffer.currentPosition, 0, this.tempBuffer.buffer);

        return await this.gameConnection.read$();
    }
}