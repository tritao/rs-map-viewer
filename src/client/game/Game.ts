import Long from "long";
import { Configuration } from "./Configuration";
import { BufferedConnection } from "./net/BufferedConnection";
import { Buffer } from "./net/Buffer";
import { Socket } from "./net/Socket";
import { TextUtils } from "./util/TextUtils";
import { SignLink } from "./util/SignLink";
import { ISAACCipher } from "./net/ISAACCipher";
import { LoginStatus, PacketConstants, IncomingPacket, LoginType, RegionUpdateOpcode, OutgoingPacket, NpcUpdateMask, PlayerUpdateMask, MovementType } from "./net/Packet";
import { array3d } from "./util/Arrays";
import { Player } from "./renderable/actor/Player";
import { Npc } from "./renderable/actor/Npc";
import { SpawnObjectClassType, SpawnObjectNode } from "./SpawnObjectNode";
import { LinkedList } from "./util/LinkedList";
import { Actor } from "./renderable/actor/Actor";
import { CacheLoaders } from "../../rs/cache/CacheLoaders";

export interface GameEvents {
    onMapRegionLoad(mapX: number, mapY: number): void;
    onChatboxMessage(message: string): void;
}

export class Game {
    events!: GameEvents;
    gameConnection!: BufferedConnection;
    incomingRandom: ISAACCipher | null = null;
    public outBuffer: Buffer = Buffer.allocate(1);
    buffer: Buffer = Buffer.allocate(1);
    opcode: number = 0;
    packetSize: number = 0;

    netAliveCycle: number = 0;
    netCycle: number = 0;
    systemUpdateTime: number = 0;
    idleLogout: number = 0;

    loggedIn: boolean = false;

    constructedMapPalette: number[][][] = array3d(4, 13, 13, 0);
    loadingStage: number = 0;

    tickDelta: number = 0;
    pulseCycle: number = 0;

    chunkX: number = 0;
    chunkY: number = 0;
    plane: number = 0;

    static MAX_LEVELS = 4;
    static MAX_TILES = 104;

    static MAX_PLAYERS = 2048;
    static MAX_NPCS = 16384;

    localPlayer!: Player;
    players: (Player | null)[] = Array(Game.MAX_PLAYERS).fill(null);
    playerList: number[] = Array(Game.MAX_PLAYERS).fill(0);
    cachedAppearances: (Buffer | null)[] = Array(Game.MAX_PLAYERS).fill(null);
    updatedActors: number[] = Array(Game.MAX_PLAYERS).fill(0);

    entityUpdatesIndices: number[] = Array(1000).fill(0);
    entityUpdateCount: number = 0;

    localPlayerCount: number = 0;
    updatedActorCount: number = 0;
    thisPlayerId: number = Game.MAX_PLAYERS - 1;
    thisPlayerServerId: number = -1;

    npcs: (Npc | null)[] = Array(Game.MAX_NPCS).fill(null);
    npcIds: number[] = Array(Game.MAX_NPCS).fill(0);
    npcCount: number = 0;

    spawnObjectList: LinkedList = new LinkedList();
    projectileQueue: LinkedList = new LinkedList();
    gameAnimableObjectQueue: LinkedList = new LinkedList();
    groundItems: (LinkedList | null)[][][] = array3d(Game.MAX_LEVELS, Game.MAX_TILES, Game.MAX_TILES, null);

    objectTypes: number[] = [0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3];
    placementX: number = 0;
    placementY: number = 0;

    cacheLoaders!: CacheLoaders;

    // Sound-related data
    sound: number[] = Array(50).fill(0);
    soundType: number[] = Array(50).fill(0);
    soundDelay: number[] = Array(50).fill(0);
    currentSound: number = 0;

    aBoolean1301: boolean = true;
    anIntArray1005: number[] = Array(2000).fill(0);
    currentSong: number = 0;
    previousSong: number = 0;

    public async openSocket(port: number): Promise<Socket> {
        const socket = new Socket(Configuration.SERVER_ADDRESS, port);
        await socket.connect();
        return socket;
    }

    public async processGameLoop() {
        this.pulseCycle++;

        if (!this.loggedIn) {
            //await this.updateLogin();
        } else {
            await this.updateGame();
        }
        //this.processOnDemandQueue(false);
    }

    public async updateGame() {
        //if (this.systemUpdateTime > 1) {
        //    this.systemUpdateTime--;
        //}
        //if (this.idleLogout > 0) {
        //    this.idleLogout--;
        //}

        for (let i = 0; i < 5; i++) {
            if (!(await this.parseIncomingPacket())) {
                break;
            }
        }
        if (!this.loggedIn) {
            return;
        }

        //this.loadingStages();
        this.processLocationCreation();
        //this.processAudio();
        this.netCycle++;
        if (this.netCycle > 750) {
            //this.dropClient();
        }
        this.processPlayers();
        this.processNPCs();
        //this.processActorOverheadText();
        this.tickDelta++;

        this.netAliveCycle++;
        if (this.netAliveCycle > 50) {
            this.outBuffer.putOpcode(OutgoingPacket.KEEP_ALIVE);
        }
        try {
            if (this.gameConnection != null && this.outBuffer.currentPosition > 0) {
                this.gameConnection.write(this.outBuffer.currentPosition, 0, this.outBuffer.buffer);
                this.outBuffer.currentPosition = 0;
                this.netAliveCycle = 0;
                return;
            }
        } catch (__e) {
            // if (__e != null && __e instanceof IOException as any) {
            //     this.dropClient();
            //     return;

            // }
            if (__e != null && ((__e instanceof Error) as any)) {
                const exception: Error = __e as Error;
                //this.logout();
            }
        }
    }

    public processPlayers() {
        for (let i = -1; i < this.localPlayerCount; i++) {
            let index: number;
            if (i === -1) {
                index = this.thisPlayerId;
            } else {
                index = this.playerList[i];
            }
            const player: Player | null = this.players[index];
            if (player != null) {
                this.processActor(player);
            }
        }
    }

    public processNPCs() {
        for (let i = 0; i < this.npcCount; i++) {
            const npcIndex: number = this.npcIds[i];
            const npc = this.npcs[npcIndex];
            if (npc != null) {
                this.processActor(npc);
            }
        }
    }

    public processActor(actor: Actor) {
        if (actor.worldX < 128 || actor.worldY < 128 || actor.worldX >= 13184 || actor.worldY >= 13184) {
            actor.emoteAnimation = -1;
            actor.graphic = -1;
            actor.moveCycleEnd = 0;
            actor.moveCycleStart = 0;
            actor.worldX = actor.pathX[0] * 128 + actor.size * 64;
            actor.worldY = actor.pathY[0] * 128 + actor.size * 64;
            actor.resetPath();
        }
        if (actor === this.localPlayer && (actor.worldX < 1536 || actor.worldY < 1536 || actor.worldX >= 11776 || actor.worldY >= 11776)) {
            actor.emoteAnimation = -1;
            actor.graphic = -1;
            actor.moveCycleEnd = 0;
            actor.moveCycleStart = 0;
            actor.worldX = actor.pathX[0] * 128 + actor.size * 64;
            actor.worldY = actor.pathY[0] * 128 + actor.size * 64;
            actor.resetPath();
        }
        if (actor.moveCycleEnd > this.pulseCycle) {
            //this.processActorLateMovement(actor, true);
        } else if (actor.moveCycleStart >= this.pulseCycle) {
            //this.processActorMovementVariables(actor);
        } else {
            //this.processActorMovement(actor, 0);
        }
        //this.processActorRotation(actor);
        //this.processActorSequence(actor);
    }

    static Region_method170(type: number, index: number): boolean {
        // const gameObjectDefinition: GameObjectDefinition = GameObjectDefinition.getDefinition(index);
        // if (type === 11) {
        //     type = 10;
        // }
        // if (type >= 5 && type <= 8) {
        //     type = 4;
        // }
        // return gameObjectDefinition.method432(type);
        return true;
    }

    public processLocationCreation() {
        //if (this.loadingStage === 2) {
        for (
            let spawnObjectNode: SpawnObjectNode = this.spawnObjectList.first() as SpawnObjectNode;
            spawnObjectNode != null;
            spawnObjectNode = this.spawnObjectList.next() as SpawnObjectNode
        ) {
            console.log(spawnObjectNode);
            if (spawnObjectNode.cycle > 0) {
                spawnObjectNode.cycle--;
            }
            if (spawnObjectNode.cycle === 0) {
                if (
                    spawnObjectNode.index < 0 ||
                    Game.Region_method170(spawnObjectNode.type, spawnObjectNode.index)
                ) {
                    this.addLocation(
                        spawnObjectNode.rotation,
                        spawnObjectNode.x,
                        spawnObjectNode.index,
                        spawnObjectNode.y,
                        spawnObjectNode.plane,
                        spawnObjectNode.type,
                        spawnObjectNode.classType
                    );
                    spawnObjectNode.remove();
                }
            } else {
                if (spawnObjectNode.spawnCycle > 0) {
                    spawnObjectNode.spawnCycle--;
                }
                if (
                    spawnObjectNode.spawnCycle === 0 &&
                    spawnObjectNode.x >= 1 &&
                    spawnObjectNode.y >= 1 &&
                    spawnObjectNode.x <= 102 &&
                    spawnObjectNode.y <= 102 &&
                    (spawnObjectNode.locationIndex < 0 ||
                        Game.Region_method170(spawnObjectNode.locationType, spawnObjectNode.locationIndex))
                ) {
                    this.addLocation(
                        spawnObjectNode.locationRotation,
                        spawnObjectNode.x,
                        spawnObjectNode.locationIndex,
                        spawnObjectNode.y,
                        spawnObjectNode.plane,
                        spawnObjectNode.locationType,
                        spawnObjectNode.classType
                    );
                    spawnObjectNode.spawnCycle = -1;
                    if (spawnObjectNode.locationIndex === spawnObjectNode.index && spawnObjectNode.index === -1) {
                        spawnObjectNode.remove();
                    } else if (
                        spawnObjectNode.locationIndex === spawnObjectNode.index &&
                        spawnObjectNode.locationRotation === spawnObjectNode.rotation &&
                        spawnObjectNode.locationType === spawnObjectNode.type
                    ) {
                        spawnObjectNode.remove();
                    }
                }
            }
        }
        //}
    }

    public addLocation(rotation: number, x: number, objectId: number, y: number, plane: number,
        objectType: number, classType: SpawnObjectClassType) {
        if (x >= 1 && y >= 1 && x <= 102 && y <= 102) {
            //if (Game.LOW_MEMORY && plane !== this.plane) {
            //    return;
            //}
            //let locationHash: number = 0;
            //if (classType === SpawnObjectClassType.Wall) {
            //    locationHash = this.currentScene.getWallObjectHash(plane, x, y);
            //}
            //if (classType === SpawnObjectClassType.WallDecoration) {
            //    locationHash = this.currentScene.getWallDecorationHash(x, plane, y);
            //}
            //if (classType === SpawnObjectClassType.Loc) {
            //    locationHash = this.currentScene.getLocationHash(plane, x, y);
            //}
            //if (classType === SpawnObjectClassType.FloorDecoration) {
            //    locationHash = this.currentScene.getFloorDecorationHash(plane, x, y);
            //}
            //if (locationHash !== 0) {
            //    const locationArrangement: number = this.currentScene.getArrangement(plane, x, y, locationHash);
            //    const locationIndex: number = (locationHash >> 14) & 0x7fff;
            //    const locationType: number = locationArrangement & 0x1f;
            //    const locationRot: number = locationArrangement >> 6;
            //    if (classType === SpawnObjectClassType.Wall) {
            //        this.currentScene.removeWallObject(y, plane, x);
            //        const objectDef: GameObjectDefinition = GameObjectDefinition.getDefinition(locationIndex);
            //        if (objectDef.solid) {
            //            this.currentCollisionMap[plane].unmarkWall(locationRot, x, y, locationType, objectDef.walkable);
            //        }
            //    }
            //    if (classType === SpawnObjectClassType.WallDecoration) {
            //        this.currentScene.removeWallDecoration(false, x, y, plane);
            //    }
            //    if (classType === SpawnObjectClassType.Loc) {
            //        this.currentScene.removeInteractiveObject(y, plane, -779, x);
            //        const objectDef: GameObjectDefinition = GameObjectDefinition.getDefinition(locationIndex);
            //        if (x + objectDef.sizeX > 103 || y + objectDef.sizeX > 103 || x + objectDef.sizeY > 103 || y + objectDef.sizeY > 103) {
            //            return;
            //        }
            //        if (objectDef.solid) {
            //            this.currentCollisionMap[plane].unmarkSolidOccupant(
            //                this.anInt1055,
            //                y,
            //                x,
            //                locationRot,
            //                objectDef.sizeY,
            //                objectDef.walkable,
            //                objectDef.sizeX
            //            );
            //        }
            //    }
            //    if (classType === SpawnObjectClassType.FloorDecoration) {
            //        this.currentScene.method261(x, y, true, plane);
            //        const objectDef: GameObjectDefinition = GameObjectDefinition.getDefinition(locationIndex);
            //        if (objectDef.solid && objectDef.actionsBoolean) {
            //            this.currentCollisionMap[plane].unmarkConcealed(x, y);
            //        }
            //    }
            //}
            //if (objectId >= 0) {
            //    let objectPlane: number = plane;
            //    if (objectPlane < 3 && (this.currentSceneTileFlags[1][x][y] & 2) === 2) {
            //        objectPlane++;
            //    }
            //    Region.forceRenderObject(objectId, objectPlane, objectType, y, this.currentCollisionMap[plane], rotation, x, 0, plane, this.currentScene, this.intGroundArray);
            //}
        }
    }

    public dropClient() {
        if (this.idleLogout > 0) {
            //this.logout();
            return;
        }
        //this.method125("Please wait - attempting to reestablish", "Connection lost");
        //this.minimapState = 0;
        //this.destinationX = 0;
        const connection: BufferedConnection = this.gameConnection;
        this.loggedIn = false;
        //this.reconnectionAttempts = 0;
        //this.login(this.username, this.password, true);
        if (!this.loggedIn) {
            //this.logout();
        }
        try {
            connection.close();
            return;
        } catch (_ex) {
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
            else if (this.packetSize === -2) {
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

            else if (this.opcode === IncomingPacket.CHATBOX_MESSAGE) {
                const message: string = this.buffer.getString();
                console.log("  mesage: " + message);
                this.events.onChatboxMessage(message);
                this.opcode = -1;
                return true;
            }

            else if (this.opcode === IncomingPacket.SET_TAB_WIDGET) {
                const l8: number = this.buffer.getUnsignedPreNegativeOffsetByte();
                let j15: number = this.buffer.getUnsignedNegativeOffsetShortBE();
                if (j15 === 65535) {
                    j15 = -1;
                }
                this.opcode = -1;
                return true;
            }

            else if (this.opcode === IncomingPacket.UPDATE_ALL_WIDGET_ITEMS) {
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

            else if (this.opcode === IncomingPacket.UPDATE_SKILL) {
                const j7: number = this.buffer.getUnsignedInvertedByte();
                const j14: number = this.buffer.getUnsignedByte();
                const j19: number = this.buffer.getIntBE();
                this.opcode = -1;
                return true;
            }

            else if (this.opcode === IncomingPacket.UPDATE_PLAYER_CONTEXT_OPTION) {
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

            else if (this.opcode === IncomingPacket.UPDATE_ACTIVE_MAP_REGION ||
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
                        for (let x: number = 0; x < 13; x++) {
                            for (let y: number = 0; y < 13; y++) {
                                const flag: number = this.buffer.getBits(1);
                                if (flag === 1) {
                                    this.constructedMapPalette[z][x][y] = this.buffer.getBits(26);
                                } else {
                                    this.constructedMapPalette[z][x][y] = -1;
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
                this.events.onMapRegionLoad(this.chunkX, this.chunkY);

                this.loadingStage = 1;

                this.opcode = -1;
                return true;
            }

            else if (this.opcode === IncomingPacket.PLAYER_UPDATING) {
                this.updatePlayers(this.packetSize, this.buffer);
                this.opcode = -1;
                return true;
            }

            else if (this.opcode === IncomingPacket.NPC_UPDATING) {
                this.updateNpcs(this.buffer, this.packetSize);
                this.opcode = -1;
                return true;
            }

            else if (this.opcode === IncomingPacket.CLEAR_REGION) {
                let placementY = this.buffer.getUnsignedPreNegativeOffsetByte();
                let placementX = this.buffer.getUnsignedInvertedByte();
                //for (int x = placementX; x < placementX + 8; x++) {
                //    for (int y = placementY; y < placementY + 8; y++)
                //        if (!groundItems.isTileEmpty(plane, x, y)) {
                //            groundItems.clearTile(plane, x, y);
                //            processGroundItems(x, y);
                //        }
                //}

                //for (SpawnObjectNode spawnObjectNode = (SpawnObjectNode) spawnObjectList.first(); spawnObjectNode != null; spawnObjectNode = (SpawnObjectNode) spawnObjectList
                //        .next())
                //    if (spawnObjectNode.x >= placementX && spawnObjectNode.x < placementX + 8
                //            && spawnObjectNode.y >= placementY && spawnObjectNode.y < placementY + 8
                //            && spawnObjectNode.plane == plane)
                //        spawnObjectNode.cycle = 0;
                this.opcode = -1;
                return true;
            }

            else if (this.opcode === IncomingPacket.UPDATE_REGION) {
                let placementX = this.buffer.getUnsignedByte();
                let placementY = this.buffer.getUnsignedPostNegativeOffsetByte();
                while (this.buffer.currentPosition < this.packetSize) {
                    let subPacketId = this.buffer.getUnsignedByte();
                    console.log(`processing region update ${RegionUpdateOpcode[subPacketId]} (${subPacketId})`);
                    this.processRegionUpdateSubMessage(this.buffer, subPacketId);
                }
                this.opcode = -1;
                return true;
            }

            if (this.opcode != -1) {
                throw new Error("TODO: packet id is not handled yet")
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
        this.entityUpdateCount = 0;
        this.updatedActorCount = 0;
        this.updateNpcMovement(buffer);
        this.processNewNpcs(buffer, packetSize);
        this.parseNpcUpdateMasks(buffer, packetSize);

        for (let i = 0; i < this.entityUpdateCount; i++) {
            const npcIndex: number = this.entityUpdatesIndices[i];
            const npc = this.npcs[npcIndex];
            if (npc != null && npc.pulseCycle !== this.pulseCycle) {
                npc.npcDefinition = null;
                this.npcs[npcIndex] = null;
            }
        }

        if (buffer.currentPosition !== packetSize) {
            console.error(
                "Size mismatch in getnpcpos - coord:" + buffer.currentPosition + " psize:" + packetSize
            );
            throw Error("eek");
        }

        for (let l: number = 0; l < this.npcCount; l++) {
            if (this.npcs[this.npcIds[l]] == null) {
                console.error("Null entry in npc list - coord:" + l + " size:" + this.npcCount);
                throw Error("eek");
            }
        }
    }

    public updateNpcMovement(buffer: Buffer) {
        buffer.initBitAccess();

        const id: number = buffer.getBits(8);
        if (id < this.npcCount) {
            for (let i = id; i < this.npcCount; i++) {
                this.entityUpdatesIndices[this.entityUpdateCount++] = this.npcIds[i];
            }
        }

        if (id > this.npcCount) {
            console.error(" Too many npcs");
            throw Error("eek");
        }

        this.npcCount = 0;
        for (let i = 0; i < id; i++) {
            const npcId: number = this.npcIds[i];
            const npc: Npc = this.npcs[npcId]!;

            const updateRequired: number = buffer.getBits(1);
            if (updateRequired === 0) {
                this.npcIds[this.npcCount++] = npcId;
                npc.pulseCycle = this.pulseCycle;
                continue;
            }

            const moveType: number = buffer.getBits(2);
            if (moveType === MovementType.NONE) {
                this.npcIds[this.npcCount++] = npcId;
                npc.pulseCycle = this.pulseCycle;
                this.updatedActors[this.updatedActorCount++] = npcId;
            } else if (moveType === MovementType.WALK) {
                this.npcIds[this.npcCount++] = npcId;
                npc.pulseCycle = this.pulseCycle;
                const direction: number = buffer.getBits(3);
                npc.move(direction, false);
                const blockUpdateRequired: number = buffer.getBits(1);
                if (blockUpdateRequired === 1) {
                    this.updatedActors[this.updatedActorCount++] = npcId;
                }
            } else if (moveType === MovementType.RUN) {
                this.npcIds[this.npcCount++] = npcId;
                npc.pulseCycle = this.pulseCycle;
                const direction1: number = buffer.getBits(3);
                npc.move(direction1, true);
                const direction2: number = buffer.getBits(3);
                npc.move(direction2, true);
                const blockUpdateRequired: number = buffer.getBits(1);
                if (blockUpdateRequired === 1) {
                    this.updatedActors[this.updatedActorCount++] = npcId;
                }
            } else if (moveType === MovementType.TELEPORT) {
                this.entityUpdatesIndices[this.entityUpdateCount++] = npcId;
            }
        }
    }

    public processNewNpcs(buffer: Buffer, packetSize: number) {
        while (buffer.bitPosition + 21 < packetSize * 8) {
            const id: number = buffer.getBits(14);
            if (id === (Game.MAX_NPCS - 1)) {
                break;
            }
            if (this.npcs[id] == null) {
                this.npcs[id] = new Npc();
            }
            const npc: Npc = this.npcs[id]!;
            this.npcIds[this.npcCount++] = id;
            npc.pulseCycle = this.pulseCycle;
            const updateRequired: number = buffer.getBits(1);
            if (updateRequired === 1) {
                this.updatedActors[this.updatedActorCount++] = id;
            }
            let offsetX: number = buffer.getBits(5);
            if (offsetX > 15) {
                offsetX -= 32;
            }
            let offsetY: number = buffer.getBits(5);
            if (offsetY > 15) {
                offsetY -= 32;
            }
            let defId = buffer.getBits(13);
            npc.npcDefinition = this.cacheLoaders.npcTypeLoader.load(defId);
            npc.size = npc.npcDefinition.size;
            npc.degreesToTurn = npc.npcDefinition.rotationSpeed;
            npc.walkAnimationId = npc.npcDefinition.walkSeqId;
            npc.turnAroundAnimationId = npc.npcDefinition.runBackSeqId;
            npc.turnRightAnimationId = npc.npcDefinition.turnRightSeqId;
            npc.turnLeftAnimationId = npc.npcDefinition.turnLeftSeqId;
            npc.idleAnimation = npc.npcDefinition.idleSeqId;
            let discardWalkingQueue = buffer.getBits(1) === 1;
            npc.setPosition(this.localPlayer.pathX[0] + offsetY, this.localPlayer.pathY[0] + offsetX, discardWalkingQueue);
        }
        buffer.finishBitAccess();
    }

    public parseNpcUpdateMasks(buffer: Buffer, i: number) {
        for (let i = 0; i < this.updatedActorCount; i++) {
            const id: number = this.updatedActors[i];
            const npc: Npc = this.npcs[id]!;
            const mask: number = buffer.getUnsignedByte();
            if ((mask & NpcUpdateMask.TRANSFORM) !== 0) {
                let defId = buffer.getUnsignedNegativeOffsetShortBE();
                npc.npcDefinition = this.cacheLoaders.npcTypeLoader.load(defId);
                npc.size = npc.npcDefinition.size;
                npc.degreesToTurn = npc.npcDefinition.rotationSpeed;
                npc.walkAnimationId = npc.npcDefinition.walkSeqId;
                npc.turnAroundAnimationId = npc.npcDefinition.runBackSeqId;
                npc.turnRightAnimationId = npc.npcDefinition.turnRightSeqId;
                npc.turnLeftAnimationId = npc.npcDefinition.turnLeftSeqId;
                npc.idleAnimation = npc.npcDefinition.idleSeqId;
            }
            else if ((mask & NpcUpdateMask.INTERACTING_MOB) !== 0) {
                npc.faceActor = buffer.getUnsignedShortLE();
                if (npc.faceActor === 65535) {
                    npc.faceActor = -1;
                }
            }
            else if ((mask & NpcUpdateMask.TURN_TO_POSITION) !== 0) {
                npc.faceX = buffer.getUnsignedNegativeOffsetShortLE();
                npc.faceY = buffer.getUnsignedShortLE();
            }
            else if ((mask & NpcUpdateMask.ANIMATION) !== 0) {
                let id = buffer.getUnsignedShortBE();
                if (id === 65535) {
                    id = -1;
                }
                const delay = buffer.getUnsignedPreNegativeOffsetByte();
                if (id === npc.emoteAnimation && id !== -1) {
                    //    const i3: number = AnimationSequence.animations[id].anInt307;
                    //    if (i3 === 1) {
                    //        npc.displayedEmoteFrames = 0;
                    //        npc.animationSequence = 0;
                    //        npc.animationDelay = delay;
                    //        npc.animationResetCycle = 0;
                    //    }
                    //    if (i3 === 2) {
                    //        npc.animationResetCycle = 0;
                    //    }
                    //} else if (
                    //    id === -1 ||
                    //    npc.emoteAnimation === -1 ||
                    //    AnimationSequence.animations[id].anInt301 >=
                    //        AnimationSequence.animations[npc.emoteAnimation].anInt301
                    //) {
                    //    npc.emoteAnimation = id;
                    //    npc.displayedEmoteFrames = 0;
                    //    npc.animationSequence = 0;
                    //    npc.animationDelay = delay;
                    //    npc.animationResetCycle = 0;
                    //    npc.stillPathPosition = npc.pathLength;
                }
            }
            else if ((mask & NpcUpdateMask.GRAPHIC) !== 0) {
                npc.graphic = buffer.getUnsignedShortBE();
                const data = buffer.getIntME1();
                npc.spotGraphicHeight = data >> 16;
                npc.spotGraphicDelay = this.pulseCycle + (data & 0xffff);
                npc.currentAnimation = 0;
                npc.animationCycle = 0;
                if (npc.spotGraphicDelay > this.pulseCycle) {
                    npc.currentAnimation = -1;
                }
                if (npc.graphic === 65535) {
                    npc.graphic = -1;
                }
            }
            else if ((mask & NpcUpdateMask.FORCE_CHAT) !== 0) {
                npc.forcedChat = buffer.getString();
                npc.textCycle = 100;
            }
            else if ((mask & NpcUpdateMask.HIT_UPDATE) !== 0) {
                const damage: number = buffer.getUnsignedPostNegativeOffsetByte();
                const type: number = buffer.getUnsignedPostNegativeOffsetByte();
                npc.updateHits(type, damage, this.pulseCycle);
                npc.endCycle = this.pulseCycle + 300;
                npc.health = buffer.getUnsignedByte();
                npc.maximumHealth = buffer.getUnsignedPreNegativeOffsetByte();
            }
            else if ((mask & NpcUpdateMask.SECONDARY_HIT_UPDATE) !== 0) {
                const damage: number = buffer.getUnsignedPreNegativeOffsetByte();
                const type: number = buffer.getUnsignedPreNegativeOffsetByte();
                npc.updateHits(type, damage, this.pulseCycle);
                npc.endCycle = this.pulseCycle + 300;
                npc.health = buffer.getUnsignedByte();
                npc.maximumHealth = buffer.getUnsignedInvertedByte();
            }
        }
    }

    public updatePlayers(size: number, buffer: Buffer) {
        this.entityUpdateCount = 0;
        this.updatedActorCount = 0;
        this.updateLocalPlayerMovement(buffer);
        this.updateOtherPlayerMovement(buffer);
        this.addNewPlayers(size, buffer);
        this.parsePlayerBlocks(buffer);

        for (let i = 0; i < this.entityUpdateCount; i++) {
            const index: number = this.entityUpdatesIndices[i];
            const player = this.players[index];
            if (player != null && player.pulseCycle !== this.pulseCycle) {
                this.players[index] = null;
            }
        }
        if (buffer.currentPosition !== size) {
            console.log("Error packet size mismatch in getplayer coord:" + buffer.currentPosition + " psize:" + size);
            throw Error("eek");
        }
        for (let i = 0; i < this.localPlayerCount; i++) {
            if (this.players[this.playerList[i]] == null) {
                console.error(" null entry in pl list - coord:" + i + " size:" + this.localPlayerCount);
                throw Error("eek");
            }
        }
    }

    public updateLocalPlayerMovement(buffer: Buffer) {
        buffer.initBitAccess();

        const moved: number = buffer.getBits(1);
        if (moved === 0) {
            return;
        }

        const moveType: MovementType = buffer.getBits(2);
        if (moveType === MovementType.NONE) {
            this.updatedActors[this.updatedActorCount++] = this.thisPlayerId;
            return;
        }
        else if (moveType === MovementType.WALK) {
            const direction: number = buffer.getBits(3);
            this.localPlayer.move(direction, false);
            const blockUpdateRequired: number = buffer.getBits(1);
            if (blockUpdateRequired === 1) {
                this.updatedActors[this.updatedActorCount++] = this.thisPlayerId;
            }
            return;
        }
        else if (moveType === MovementType.RUN) {
            const direction1: number = buffer.getBits(3);
            this.localPlayer.move(direction1, true);
            const direction2: number = buffer.getBits(3);
            this.localPlayer.move(direction2, true);
            const blockUpdateRequired: number = buffer.getBits(1);
            if (blockUpdateRequired === 1) {
                this.updatedActors[this.updatedActorCount++] = this.thisPlayerId;
            }
            return;
        }
        else if (moveType === MovementType.TELEPORT) {
            const discardWalkingQueue: number = buffer.getBits(1);
            this.plane = buffer.getBits(2);
            const localY: number = buffer.getBits(7);
            const localX: number = buffer.getBits(7);
            const blockUpdateRequired: number = buffer.getBits(1);
            if (blockUpdateRequired === 1) {
                this.updatedActors[this.updatedActorCount++] = this.thisPlayerId;
            }
            this.localPlayer.setPosition(localX, localY, discardWalkingQueue === 1);
        }
    }

    public updateOtherPlayerMovement(buffer: Buffer) {
        const playerCount: number = buffer.getBits(8);
        if (playerCount < this.localPlayerCount) {
            for (let i = playerCount; i < this.localPlayerCount; i++) {
                this.entityUpdatesIndices[this.entityUpdateCount++] = this.playerList[i];
            }

            if (playerCount > this.localPlayerCount) {
                console.error(" Too many players");
                throw Error("eek");
            }

            this.localPlayerCount = 0;

            for (let i = 0; i < playerCount; i++) {
                const id = this.playerList[i];
                const player: Player = this.players[id]!;
                const updated: number = buffer.getBits(1);
                if (updated === 0) {
                    this.playerList[this.localPlayerCount++] = id;
                    player.pulseCycle = this.pulseCycle;
                    continue;
                }

                const moveType: number = buffer.getBits(2);
                if (moveType === MovementType.NONE) {
                    this.playerList[this.localPlayerCount++] = id;
                    player.pulseCycle = this.pulseCycle;
                    this.updatedActors[this.updatedActorCount++] = id;
                }
                else if (moveType === MovementType.WALK) {
                    this.playerList[this.localPlayerCount++] = id;
                    player.pulseCycle = this.pulseCycle;
                    const direction: number = buffer.getBits(3);
                    player.move(direction, false);
                    const blockUpdateRequired: number = buffer.getBits(1);
                    if (blockUpdateRequired === MovementType.RUN) {
                        this.updatedActors[this.updatedActorCount++] = id;
                    }
                }
                else if (moveType === MovementType.RUN) {
                    this.playerList[this.localPlayerCount++] = id;
                    player.pulseCycle = this.pulseCycle;
                    const direction1: number = buffer.getBits(3);
                    player.move(direction1, true);
                    const direction2: number = buffer.getBits(3);
                    player.move(direction2, true);
                    const updateRequired: number = buffer.getBits(1);
                    if (updateRequired === 1) {
                        this.updatedActors[this.updatedActorCount++] = id;
                    }
                }
                else if (moveType === MovementType.TELEPORT) {
                    this.entityUpdatesIndices[this.entityUpdateCount++] = id;
                }
            }
        }
    }

    public addNewPlayers(size: number, buffer: Buffer) {
        while (buffer.bitPosition + 10 < size * 8) {
            const id: number = buffer.getBits(11);
            if (id === this.thisPlayerId) {
                break;
            }

            if (this.players[id] == null) {
                this.players[id] = new Player();
                if (this.cachedAppearances[id] != null) {
                    this.players[id]!.updateAppearance(this.cachedAppearances[id]!);
                }
            }

            this.playerList[this.localPlayerCount++] = id;
            const player = this.players[id]!;
            player.pulseCycle = this.pulseCycle;

            let x: number = buffer.getBits(5);
            if (x > 15) {
                x -= 32;
            }
            const updated: number = buffer.getBits(1);
            if (updated === 1) {
                this.updatedActors[this.updatedActorCount++] = id;
            }
            const discardQueue: number = buffer.getBits(1);
            let y: number = buffer.getBits(5);
            if (y > 15) {
                y -= 32;
            }

            player.setPosition(this.localPlayer.pathX[0] + x, this.localPlayer.pathY[0] + y, discardQueue === 1);
        }

        buffer.finishBitAccess();
    }

    public parsePlayerBlocks(buffer: Buffer) {
        for (let i = 0; i < this.updatedActorCount; i++) {
            const id: number = this.updatedActors[i];
            const player: Player = this.players[id]!;
            let mask: number = buffer.getUnsignedByte();
            if ((mask & PlayerUpdateMask.HAS_MORE_DATA) !== 0) {
                mask += buffer.getUnsignedByte() << 8;
            }
            this.parsePlayerBlock(id, player, mask, buffer);
        }
    }

    public parsePlayerBlock(id: number, player: Player, mask: number, buffer: Buffer) {
        if ((mask & PlayerUpdateMask.ANIMATION) !== 0) {
            let animation: number = buffer.getUnsignedShortBE();
            if (animation === 65535) {
                animation = -1;
            }
            const delay: number = buffer.getUnsignedPreNegativeOffsetByte();
            if (animation === player.emoteAnimation && animation !== -1) {
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
            }
        }
        else if ((mask & PlayerUpdateMask.FORCE_CHAT) !== 0) {
            let forcedChat = buffer.getString();
            // FIXME
            if ((c => (c.charCodeAt == null ? (c as any) : c.charCodeAt(0)))(forcedChat.charAt(0)) == "~".charCodeAt(0)) {
                if (player.forcedChat) {
                    player.forcedChat = player.forcedChat.substring(1);
                    this.addChatMessage(player.playerName, player.forcedChat, 2);
                }
            }
            else if (player === this.localPlayer) {
                this.addChatMessage(player.playerName, player.forcedChat, 2);
            }
            player.textColour = 0;
            player.textEffect = 0;
            player.textCycle = 150;
        }
        else if ((mask & PlayerUpdateMask.FORCE_MOVEMENT) !== 0) {
            player.movementStartX = buffer.getUnsignedPostNegativeOffsetByte();
            player.movementStartY = buffer.getUnsignedInvertedByte();
            player.movementEndX = buffer.getUnsignedPreNegativeOffsetByte();
            player.movementEndY = buffer.getUnsignedByte();
            player.moveCycleEnd = buffer.getUnsignedShortBE() + this.pulseCycle;
            player.moveCycleStart = buffer.getUnsignedNegativeOffsetShortBE() + this.pulseCycle;
            player.moveDirection = buffer.getUnsignedByte();

            player.resetPath();
        }
        else if ((mask & PlayerUpdateMask.INTERACTING_MOB) !== 0) {
            player.faceActor = buffer.getUnsignedNegativeOffsetShortBE();
            if (player.faceActor === 65535) {
                player.faceActor = -1;
            }
        }
        else if ((mask & PlayerUpdateMask.TURN_TO_POSITION) !== 0) {
            player.faceX = buffer.getUnsignedShortBE();
            player.faceY = buffer.getUnsignedShortBE();
        }
        else if ((mask & PlayerUpdateMask.GRAPHIC) !== 0) {
            let graphic = buffer.getUnsignedNegativeOffsetShortBE();
            const heightAndDelay: number = buffer.getIntME1();
            player.spotGraphicHeight = heightAndDelay >> 16;
            player.spotGraphicDelay = this.pulseCycle + (heightAndDelay & 65535);
            player.currentAnimation = 0;
            player.animationCycle = 0;
            if (player.spotGraphicDelay > this.pulseCycle) {
                player.currentAnimation = -1;
            }
            if (player.graphic === 65535) {
                player.graphic = -1;
            }
        }
        else if ((mask & PlayerUpdateMask.APPEARANCE) !== 0) {
            const size: number = buffer.getUnsignedByte();
            // FIXME
            const bytes: number[] = (s => {
                const a = [];
                while (s-- > 0) {
                    a.push(0);
                }
                return a;
            })(size);
            const appearance: Buffer = new Buffer(bytes);
            buffer.getBytesReverse(bytes, 0, size);
            this.cachedAppearances[id] = appearance;
            player.updateAppearance(appearance);
        }
        else if ((mask & PlayerUpdateMask.SECONDARY_HIT_UPDATE) !== 0) {
            const damage: number = buffer.getUnsignedPostNegativeOffsetByte();
            const type: number = buffer.getUnsignedPreNegativeOffsetByte();
            player.updateHits(type, damage, this.pulseCycle);
            player.endCycle = this.pulseCycle + 300;
            player.health = buffer.getUnsignedInvertedByte();
            player.maximumHealth = buffer.getUnsignedByte();
        }
        else if ((mask & PlayerUpdateMask.CHAT) !== 0) {
            const effectsAndColour: number = buffer.getUnsignedShortBE();
            const rights: number = buffer.getUnsignedInvertedByte();
            const length: number = buffer.getUnsignedPostNegativeOffsetByte();
            const currentPosition: number = buffer.currentPosition;
            // TODO: process message
            buffer.currentPosition = currentPosition + length;
        }
        else if ((mask & PlayerUpdateMask.HIT_UPDATE) !== 0) {
            const damage: number = buffer.getUnsignedPreNegativeOffsetByte();
            const type: number = buffer.getUnsignedInvertedByte();
            player.updateHits(type, damage, this.pulseCycle);
            player.endCycle = this.pulseCycle + 300;
            player.health = buffer.getUnsignedPreNegativeOffsetByte();
            player.maximumHealth = buffer.getUnsignedByte();
        }
    }

    addChatMessage(playerName: string | null, forcedChat: string | null, arg2: number) {
        throw new Error("Method not implemented.");
    }

    public processRegionUpdateSubMessage(buf: Buffer, opcode: number) {
        if (opcode === RegionUpdateOpcode.ADD_PUBLIC_TILE_ITEM) {
            const offset: number = buf.getUnsignedPostNegativeOffsetByte();
            const x: number = this.placementX + ((offset >> 4) & 7);
            const y: number = this.placementY + (offset & 7);
            const amount: number = buf.getUnsignedNegativeOffsetShortLE();
            const id: number = buf.getUnsignedNegativeOffsetShortBE();
            const playerId: number = buf.getUnsignedNegativeOffsetShortBE();
            if (x >= 0 && y >= 0 && x < Game.MAX_TILES && y < Game.MAX_TILES && playerId !== this.thisPlayerServerId) {
                //const item: Item = new Item();
                //item.itemId = id;
                //item.itemCount = amount;
                if (this.groundItems[this.plane][x][y] == null) {
                    this.groundItems[this.plane][x][y] = new LinkedList();
                }
                //this.groundItems[this.plane][x][y]!.insertBack(item);
                //this.processGroundItems(x, y);
            }
            throw new Error("TODO: region update ADD_PUBLIC_TILE_ITEM")
            return;
        }

        else if (opcode === 142) {
            const animationId: number = buf.getUnsignedShortBE();
            const locObjectData: number = buf.getUnsignedPostNegativeOffsetByte();
            let typeIndex: number = locObjectData >> 2;
            const rotation: number = locObjectData & 3;
            const type: number = this.objectTypes[typeIndex];
            const offset: number = buf.getUnsignedByte();
            const x: number = this.placementX + ((offset >> 4) & 7);
            const y: number = this.placementY + (offset & 7);
            if (x >= 0 && y >= 0 && x < 103 && y < 103) {
                //const vertexHeight: number = this.intGroundArray[this.plane][x][y];
                //const vertexHeightRight: number = this.intGroundArray[this.plane][x + 1][y];
                //const vertexHeightTopRight: number = this.intGroundArray[this.plane][x + 1][y + 1];
                //const vertexHeightTop: number = this.intGroundArray[this.plane][x][y + 1];
                //if (type === 0) {
                //    const wall: Wall = this.currentScene.getWallObject(this.plane, 17734, x, y);
                //    if (wall != null) {
                //        const locObjectId: number = (wall.hash >> 14) & 0x7fff;
                //        if (typeIndex === 2) {
                //            wall.primary = new GameObject(locObjectId, 4 + rotation, 2, vertexHeightRight, vertexHeightTopRight, vertexHeight, vertexHeightTop, animationId, false);
                //            wall.secondary = new GameObject(locObjectId, (rotation + 1) & 3, 2, vertexHeightRight, vertexHeightTopRight, vertexHeight, vertexHeightTop, animationId, false);
                //        } else {
                //            wall.primary = new GameObject(locObjectId, rotation, typeIndex, vertexHeightRight, vertexHeightTopRight, vertexHeight, vertexHeightTop, animationId, false);
                //        }
                //    }
                //}
                //if (type === 1) {
                //    const wallDecoration: WallDecoration = this.currentScene.getWallDecoration(this.plane, y, x, false);
                //    if (wallDecoration != null) {
                //        wallDecoration.renderable = new GameObject(
                //            (wallDecoration.hash >> 14) & 0x7fff,
                //            0,
                //            4,
                //            vertexHeightRight,
                //            vertexHeightTopRight,
                //            vertexHeight,
                //            vertexHeightTop,
                //            animationId,
                //            false
                //        );
                //    }
                //}
                //if (type === 2) {
                //    const interactiveObject: InteractiveObject = this.currentScene.method265(x, (32 as number) | 0, y, this.plane);
                //    if (typeIndex === 11) {
                //        typeIndex = 10;
                //    }
                //    if (interactiveObject != null) {
                //        interactiveObject.renderable = new GameObject(
                //            (interactiveObject.uid >> 14) & 0x7fff,
                //            rotation,
                //            typeIndex,
                //            vertexHeightRight,
                //            vertexHeightTopRight,
                //            vertexHeight,
                //            vertexHeightTop,
                //            animationId,
                //            false
                //        );
                //    }
                //}
                //if (type === 3) {
                //    const floorDecoration: FloorDecoration = this.currentScene.getTileFloorDecoration(this.plane, y, 0, x);
                //    if (floorDecoration != null) {
                //        floorDecoration.renderable = new GameObject(
                //            (floorDecoration.hash >> 14) & 0x7fff,
                //            rotation,
                //            22,
                //            vertexHeightRight,
                //            vertexHeightTopRight,
                //            vertexHeight,
                //            vertexHeightTop,
                //            animationId,
                //            false
                //        );
                //    }
                //}
            }
            throw new Error("TODO: region update opcode 142")
            return;
        }

        else if (opcode === RegionUpdateOpcode.ADD_TILE_ITEM) {
            const id: number = buf.getUnsignedShortBE();
            const offset: number = buf.getUnsignedInvertedByte();
            const x: number = this.placementX + ((offset >> 4) & 7);
            const y: number = this.placementY + (offset & 7);
            const amount: number = buf.getUnsignedNegativeOffsetShortBE();
            if (x >= 0 && y >= 0 && x < Game.MAX_TILES && y < Game.MAX_TILES) {
                // /const item: Item = new Item();
                // /item.itemId = id;
                // /item.itemCount = amount;
                if (this.groundItems[this.plane][x][y] == null) {
                    this.groundItems[this.plane][x][y] = new LinkedList();
                }
                //this.groundItems[this.plane][x][y].insertBack(item);
                //this.processGroundItems(x, y);
            }
            throw new Error("TODO: region update ADD_TILE_ITEM")
            return;
        }

        else if (opcode === RegionUpdateOpcode.UPDATE_TILE_ITEM) {
            const offset: number = buf.getUnsignedByte();
            const x: number = this.placementX + ((offset >> 4) & 7);
            const y: number = this.placementY + (offset & 7);
            const id: number = buf.getUnsignedShortBE();
            const amount: number = buf.getUnsignedShortBE();
            const newAmount: number = buf.getUnsignedShortBE();
            if (x >= 0 && y >= 0 && x < Game.MAX_TILES && y < Game.MAX_TILES) {
                //const list: LinkedList = this.groundItems[this.plane][x][y];
                //if (list != null) {
                //    for (let item: Item = list.first() as Item; item != null; item = list.next() as Item) {
                //            if (item.itemId !== (id & 0x7fff) || item.itemCount !== amount) {
                //                continue;
                //            }
                //            item.itemCount = newAmount;
                //            break;
                //    }
                //    this.processGroundItems(x, y);
                //}
            }
            throw new Error("TODO: region update UPDATE_TILE_ITEM")
            return;
        }

        else if (opcode === RegionUpdateOpcode.SEND_PROJECTILE) {
            const offset: number = buf.getUnsignedByte();
            let startX: number = this.placementX + ((offset >> 4) & 7);
            let startY: number = this.placementY + (offset & 7);
            let endX: number = startX + buf.getByte();
            let endY: number = startY + buf.getByte();
            const entityIndex: number = buf.getShortBE();
            const graphicsId: number = buf.getUnsignedShortBE();
            const startHeight: number = buf.getUnsignedByte() * 4;
            const endHeight: number = buf.getUnsignedByte() * 4;
            const delay: number = buf.getUnsignedShortBE();
            const speed: number = buf.getUnsignedShortBE();
            const startSlope: number = buf.getUnsignedByte();
            const startDistance: number = buf.getUnsignedByte();
            if (startX >= 0 && startY >= 0 && startX < Game.MAX_TILES && startY < Game.MAX_TILES && endX >= 0 && endY >= 0 && endX < Game.MAX_TILES && endY < Game.MAX_TILES && graphicsId !== 65535) {
                startX = startX * 128 + 64;
                startY = startY * 128 + 64;
                endX = endX * 128 + 64;
                endY = endY * 128 + 64;
                // const projectile: Projectile = new Projectile(
                //     this.plane,
                //     endHeight,
                //     startDistance,
                //     startY,
                //     graphicsId,
                //     speed + Game.pulseCycle,
                //     startSlope,
                //     entityIndex,
                //     this.getTileHeight(startY, startX, this.plane) - startHeight,
                //     startX,
                //     delay + Game.pulseCycle
                // );
                // projectile.trackTarget(
                //     endX,
                //     endY,
                //     this.getTileHeight(endY, endX, this.plane) - endHeight,
                //     delay + Game.pulseCycle
                // );
                // this.projectileQueue.insertBack(projectile);
            }
            throw new Error("TODO: SEND_PROJECTILE")
            return;
        }

        else if (opcode === IncomingPacket.PLAY_POSITION_SOUND) {
            const offset: number = buf.getUnsignedByte();
            const x: number = this.placementX + ((offset >> 4) & 7);
            const y: number = this.placementY + (offset & 7);
            const soundId: number = buf.getUnsignedShortBE();
            const soundData: number = buf.getUnsignedByte();
            const radius: number = (soundData >> 4) & 15;
            const type: number = soundData & 7;
            if (
                this.localPlayer.pathX[0] >= x - radius &&
                this.localPlayer.pathX[0] <= x + radius &&
                this.localPlayer.pathY[0] >= y - radius &&
                this.localPlayer.pathY[0] <= y + radius &&
                this.aBoolean1301 &&
                !Configuration.LOW_MEMORY &&
                this.currentSound < 50
            ) {
                this.sound[this.currentSound] = soundId;
                this.soundType[this.currentSound] = type;
                //this.soundDelay[this.currentSound] = SoundTrack.trackDelays[soundId];
                this.currentSound++;
            }
            throw new Error("TODO: region update PLAY_POSITION_SOUND")
            return;
        }

        else if (opcode === IncomingPacket.SHOW_STILL_GRAPHICS) {
            const offset: number = buf.getUnsignedByte();
            let x: number = this.placementX + ((offset >> 4) & 7);
            let y: number = this.placementY + (offset & 7);
            const graphicsId: number = buf.getUnsignedShortBE();
            const graphicsHeight: number = buf.getUnsignedByte();
            const delay: number = buf.getUnsignedShortBE();
            if (x >= 0 && y >= 0 && x < 104 && y < 104) {
                x = x * 128 + 64;
                y = y * 128 + 64;
                // const gameAnimableObject: GameAnimableObject = new GameAnimableObject(
                //     this.plane,
                //     Game.pulseCycle,
                //     delay,
                //     graphicsId,
                //     this.getTileHeight(y, x, this.plane) - graphicsHeight,
                //     y,
                //     x
                // );
                // this.gameAnimableObjectQueue.insertBack(gameAnimableObject);
            }
            throw new Error("TODO: region update SHOW_STILL_GRAPHICS")
            return;
        }

        else if (opcode === RegionUpdateOpcode.SEND_OBJECT) {
            const locObjectData: number = buf.getUnsignedInvertedByte();
            const typeIndex: number = locObjectData >> 2;
            const rotation: number = locObjectData & 3;
            const type: number = this.objectTypes[typeIndex];
            const locObjectId: number = buf.getUnsignedNegativeOffsetShortLE();
            const offset: number = buf.getUnsignedPostNegativeOffsetByte();
            const x: number = this.placementX + ((offset >> 4) & 7);
            const y: number = this.placementY + (offset & 7);
            if (x >= 0 && y >= 0 && x < Game.MAX_TILES && y < Game.MAX_TILES) {
                this.createObjectSpawnRequest(this.plane, x, rotation, -1, typeIndex, locObjectId, 0, type, y);
            }
            return;
        }

        else if (opcode === RegionUpdateOpcode.REMOVE_OBJECT) {
            const offset: number = buf.getUnsignedPreNegativeOffsetByte();
            const x: number = this.placementX + ((offset >> 4) & 7);
            const y: number = this.placementY + (offset & 7);
            const locObjectData: number = buf.getUnsignedPreNegativeOffsetByte();
            const typeIndex: number = locObjectData >> 2;
            const rotation: number = locObjectData & 3;
            const type: number = this.objectTypes[typeIndex];
            if (x >= 0 && y >= 0 && x < Game.MAX_TILES && y < Game.MAX_TILES) {
                this.createObjectSpawnRequest(this.plane, x, rotation, -1, typeIndex, -1, 0, type, y);
            }
            return;
        }

        else if (opcode === RegionUpdateOpcode.REMOVE_TILE_ITEM) {
            const id: number = buf.getUnsignedNegativeOffsetShortBE();
            const offset: number = buf.getUnsignedPostNegativeOffsetByte();
            const x: number = this.placementX + ((offset >> 4) & 7);
            const y: number = this.placementY + (offset & 7);
            if (x >= 0 && y >= 0 && x < 104 && y < 104) {
                // const list: LinkedList = this.groundItems[this.plane][x][y];
                // if (list != null) {
                //     for (let item: Item = list.first() as Item; item != null; item = list.next() as Item) {
                //         if (item.itemId !== (id & 0x7fff)) {
                //             continue;
                //         }
                //         item.remove();
                //         break;
                //     }
                //     if (list.first() == null) {
                //         this.groundItems[this.plane][x][y] = null;
                //     }
                //     this.processGroundItems(x, y);
                //}
            }
            throw new Error("TODO: region update REMOVE_TILE_ITEM")
            return;
        }

        else if (opcode === RegionUpdateOpcode.UNKNOWN1) {
            const locObjectId: number = buf.getUnsignedShortBE();
            const locObjectData: number = buf.getUnsignedByte();
            const typeIndex: number = locObjectData >> 2;
            const rotation: number = locObjectData & 3;
            const type: number = this.objectTypes[typeIndex];
            let byte0: number = buf.getInvertedByte();
            const offset: number = buf.getUnsignedPostNegativeOffsetByte();
            const x: number = this.placementX + ((offset >> 4) & 7);
            const y: number = this.placementY + (offset & 7);
            let byte1: number = buf.getPostNegativeOffsetByte();
            const duration: number = buf.getUnsignedNegativeOffsetShortBE();
            const playerId: number = buf.getUnsignedShortLE();
            let byte2: number = buf.getByte();
            let byte3: number = buf.getPostNegativeOffsetByte();
            const startDelay: number = buf.getUnsignedShortBE();
            let player: Player;
            if (playerId === this.thisPlayerServerId) {
                player = this.localPlayer;
            } else {
                player = this.players[playerId]!;
            }
            if (player != null) {
                //const gameObject: GameObjectDefinition = GameObjectDefinition.getDefinition(locObjectId);
                //const vertexHeight: number = this.intGroundArray[this.plane][x][y];
                //const vertexHeightRight: number = this.intGroundArray[this.plane][x + 1][y];
                //const vertexHeightTopRight: number = this.intGroundArray[this.plane][x + 1][y + 1];
                //const vertexHeightTop: number = this.intGroundArray[this.plane][x][y + 1];
                //const model: Model = gameObject.getGameObjectModel(typeIndex, rotation, vertexHeight, vertexHeightRight, vertexHeightTopRight, vertexHeightTop, -1);
                //if (model != null) {
                //    this.createObjectSpawnRequest(true, this.plane, x, 0, duration + 1, 0, -1, startDelay + 1, type, y);
                //    player.objectAppearanceStartTick = startDelay + Game.pulseCycle;
                //    player.objectAppearanceEndTick = duration + Game.pulseCycle;
                //    player.playerModel = model;
                //    let sizeX: number = gameObject.sizeX;
                //    let sizeY: number = gameObject.sizeY;
                //    if (rotation === 1 || rotation === 3) {
                //        sizeX = gameObject.sizeY;
                //        sizeY = gameObject.sizeX;
                //    }
                //    player.anInt1743 = x * 128 + sizeX * 64;
                //    player.anInt1745 = y * 128 + sizeY * 64;
                //    player.drawHeight = this.getFloorDrawHeight(player.anInt1745, player.anInt1743, this.plane);
                //    if (byte1 > byte0) {
                //        const byte4: number = byte1;
                //        byte1 = byte0;
                //        byte0 = byte4;
                //    }
                //    if (byte3 > byte2) {
                //        const byte5: number = byte3;
                //        byte3 = byte2;
                //        byte2 = byte5;
                //    }
                //    player.anInt1768 = x + byte1;
                //    player.anInt1770 = x + byte0;
                //    player.anInt1769 = y + byte3;
                //    player.anInt1771 = y + byte2;
                //}
            }

            throw new Error("TODO: region update opcode 203")
            return;
        }
    }

    public createObjectSpawnRequest(
        plane: number,
        x: number,
        orientation: number,
        duration: number,
        objectType: number,
        objectId: number,
        startDelay: number,
        type: number,
        y: number
    ) {
        let spawnObjectNode: SpawnObjectNode | null = null;

        // Check for an existing matching spawn request.
        for (
            let spawnObject: SpawnObjectNode = this.spawnObjectList.first() as SpawnObjectNode;
            spawnObject != null;
            spawnObject = this.spawnObjectList.next() as SpawnObjectNode
        ) {
            if (
                spawnObject.plane !== plane ||
                spawnObject.x !== x ||
                spawnObject.y !== y ||
                spawnObject.classType !== type
            ) {
                continue;
            }
            spawnObjectNode = spawnObject;
            break;
        }

        // If one does not yet exist, then create a new one and append it to the list.
        if (spawnObjectNode == null) {
            spawnObjectNode = new SpawnObjectNode();
            spawnObjectNode.plane = plane;
            spawnObjectNode.classType = type;
            spawnObjectNode.x = x;
            spawnObjectNode.y = y;
            this.processObjectSpawn(spawnObjectNode);
            this.spawnObjectList.insertBack(spawnObjectNode);
        }

        spawnObjectNode.locationIndex = objectId;
        spawnObjectNode.locationType = objectType;
        spawnObjectNode.locationRotation = orientation;
        spawnObjectNode.spawnCycle = startDelay;
        spawnObjectNode.cycle = duration;
    }

    public processObjectSpawns() {
        for (
            let spawnObjectNode: SpawnObjectNode = this.spawnObjectList.first() as SpawnObjectNode;
            spawnObjectNode != null;
            spawnObjectNode = this.spawnObjectList.next() as SpawnObjectNode
        ) {
            if (spawnObjectNode.cycle === -1) {
                spawnObjectNode.spawnCycle = 0;
                this.processObjectSpawn(spawnObjectNode);
            } else {
                spawnObjectNode.remove();
            }
        }
    }

    public processObjectSpawn(spawnObjectNode: SpawnObjectNode) {
        let hash: number = 0;
        let index: number = -1;
        let type: number = 0;
        let rotation: number = 0;

        if (spawnObjectNode.classType === SpawnObjectClassType.Wall) {
            //hash = this.currentScene.getWallObjectHash(spawnObjectNode.plane, spawnObjectNode.x, spawnObjectNode.y);
        }
        else if (spawnObjectNode.classType === SpawnObjectClassType.WallDecoration) {
            //hash = this.currentScene.getWallDecorationHash(
            //    spawnObjectNode.x,
            //    spawnObjectNode.plane,
            //    spawnObjectNode.y
            //);
        }
        else if (spawnObjectNode.classType === SpawnObjectClassType.Loc) {
            //hash = this.currentScene.getLocationHash(spawnObjectNode.plane, spawnObjectNode.x, spawnObjectNode.y);
        }
        else if (spawnObjectNode.classType === SpawnObjectClassType.FloorDecoration) {
            //hash = this.currentScene.getFloorDecorationHash(spawnObjectNode.plane, spawnObjectNode.x, spawnObjectNode.y);
        }

        if (hash !== 0) {
            //const i1: number = this.currentScene.getArrangement(
            //    spawnObjectNode.plane,
            //    spawnObjectNode.x,
            //    spawnObjectNode.y,
            //    hash
            //);
            //index = (hash >> 14) & 32767;
            //type = i1 & 31;
            //rotation = i1 >> 6;
        }
        spawnObjectNode.index = index;
        spawnObjectNode.type = type;
        spawnObjectNode.rotation = rotation;
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
        if (responseCode === LoginStatus.EXCHANGE_DATA) {
            responseCode = await this.sendLoginHandshake(username, password, reconnecting);
            //console.log(`login response code: ${LoginStatus[responseCode]}`);
        }

        if (responseCode === LoginStatus.DELAY) {
            //try {
            //    await sleep(500);
            //} catch (ignored) { }
            //this.login(username, password, reconnecting);
            return;
        }
        if (responseCode === LoginStatus.OK) {
            let playerRights = await this.gameConnection.read$();
            let accountFlagged = (await this.gameConnection.read$()) === 1;

            this.loggedIn = true;
            this.outBuffer.currentPosition = 0;
            this.buffer.currentPosition = 0;
            this.opcode = -1;
            this.packetSize = 0;
            //this.timeoutCounter = 0;
            //this.systemUpdateTime = 0;
            //this.idleTime = 0;
            this.localPlayerCount = 0;
            this.npcCount = 0;
            for (let i = 0; i < Game.MAX_PLAYERS; i++) {
                this.players[i] = null;
                this.cachedAppearances[i] = null;
            }
            for (let i = 0; i < Game.MAX_NPCS; i++) {
                this.npcs[i] = null;
            }
            this.localPlayer = this.players[this.thisPlayerId] = new Player();

            this.projectileQueue.clear();
            this.gameAnimableObjectQueue.clear();

            for (let level = 0; level < Game.MAX_LEVELS; level++) {
                for (let x: number = 0; x < Game.MAX_TILES; x++) {
                    for (let y: number = 0; y < Game.MAX_TILES; y++) {
                        this.groundItems[level][x][y] = null;
                    }
                }
            }
        } else {
            this.handleLoginResponseCode(responseCode);
        }
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

        let response: Buffer = Buffer.allocate(1);
        response.currentPosition = 0;
        if (reconnecting) {
            response.putByte(LoginType.CLAIM_EXISTING_SESSION);
        } else {
            response.putByte(LoginType.CREATE_SESSION);
        }

        response.putByte(this.outBuffer.currentPosition + 36 + 1 + 1 + 2);
        response.putByte(255);
        response.putShortBE(Configuration.CLIENT_REVISION);
        response.putByte(Configuration.LOW_MEMORY ? 1 : 0);
        for (let i = 0; i < 9; i++) {
            response.putIntBE(Configuration.ARCHIVE_HASHES[i]);
        }
        response.putBytes(this.outBuffer.buffer, 0, this.outBuffer.currentPosition);

        this.outBuffer.random = new ISAACCipher(seed);
        for (let i = 0; i < 4; i++) {
            seed[i] += 50;
        }
        this.incomingRandom = new ISAACCipher(seed);
        this.gameConnection.write(response.currentPosition, 0, response.buffer);

        return await this.gameConnection.read$();
    }

    async handleLoginResponseCode(responseCode: number) {
        let statusLineOne: String;
        let statusLineTwo: String;
        if (responseCode === LoginStatus.INVALID_CREDENTIALS) {
            statusLineOne = "";
            statusLineTwo = "Invalid username or password.";
            return;
        }
        if (responseCode === LoginStatus.ACCOUNT_DISABLED) {
            statusLineOne = "Your account has been disabled.";
            statusLineTwo = "Please check your message-centre for details.";
            return;
        }
        if (responseCode === LoginStatus.ACCOUNT_ONLINE) {
            statusLineOne = "Your account is already logged in.";
            statusLineTwo = "Try again in 60 secs...";
            return;
        }
        if (responseCode === LoginStatus.GAME_UPDATED) {
            statusLineOne = "RuneScape has been updated!";
            statusLineTwo = "Please reload this page.";
            return;
        }
        if (responseCode === LoginStatus.SERVER_FULL) {
            statusLineOne = "This world is full.";
            statusLineTwo = "Please use a different world.";
            return;
        }
        if (responseCode === LoginStatus.LOGIN_SERVER_OFFLINE) {
            statusLineOne = "Unable to connect.";
            statusLineTwo = "Login server offline.";
            return;
        }
        if (responseCode === LoginStatus.TOO_MANY_CONNECTIONS) {
            statusLineOne = "Login limit exceeded.";
            statusLineTwo = "Too many connections from your address.";
            return;
        }
        if (responseCode === LoginStatus.BAD_SESSION_ID) {
            statusLineOne = "Unable to connect.";
            statusLineTwo = "Bad session id.";
            return;
        }
        if (responseCode === LoginStatus.MEMBERS_ACCOUNT_REQUIRED) {
            statusLineOne = "You need a members account to login to this world.";
            statusLineTwo = "Please subscribe, or use a different world.";
            return;
        }
        if (responseCode === LoginStatus.COULD_NOT_COMPLETE) {
            statusLineOne = "Could not complete login.";
            statusLineTwo = "Please try using a different world.";
            return;
        }
        if (responseCode === LoginStatus.UPDATING) {
            statusLineOne = "The server is being updated.";
            statusLineTwo = "Please wait 1 minute and try again.";
            return;
        }
        if (responseCode === LoginStatus.RECONNECTION_OK) {
            this.loggedIn = true;
            this.outBuffer.currentPosition = 0;
            this.buffer.currentPosition = 0;
            this.opcode = -1;
            //this.lastOpcode = -1;
            //this.secondLastOpcode = -1;
            //this.thirdLastOpcode = -1;
            this.packetSize = 0;
            //this.timeoutCounter = 0;
            this.systemUpdateTime = 0;
            return;
        }
        if (responseCode === LoginStatus.TOO_MANY_LOGINS) {
            statusLineOne = "Login attempts exceeded.";
            statusLineTwo = "Please wait 1 minute and try again.";
            return;
        }
        if (responseCode === LoginStatus.IN_MEMBERS_AREA) {
            statusLineOne = "You are standing in a members-only area.";
            statusLineTwo = "To play on this world move to a free area first";
            return;
        }
        if (responseCode === LoginStatus.LOCKED) {
            statusLineOne = "Account locked as we suspect it has been stolen.";
            statusLineTwo = "Press 'recover a locked account' on front page.";
            return;
        }
        if (responseCode === LoginStatus.INVALID_LOGIN_SERVER) {
            statusLineOne = "Invalid loginserver requested";
            statusLineTwo = "Please try using a different world.";
            return;
        }
        if (responseCode === LoginStatus.PROFILE_TRANSFER) {
            let time: number = await this.gameConnection.read$();
            statusLineOne = "You have only just left another world";
            statusLineTwo = "Your profile will be transferred in: " + time;
            //for (time += 3; time >= 0; time--) {
            //    {
            //        statusLineOne = "You have only just left another world";
            //        statusLineTwo = "Your profile will be transferred in: " + time;
            //        await this.drawLoginScreen(true);
            //        try {
            //            await sleep(1200);
            //        } catch (ignored) { }
            //    }
            //}
            //this.login(username, password, reconnecting);
            return;
        }
        if (responseCode === LoginStatus.MALFORMED_PACKET) {
            statusLineOne = "Malformed login packet.";
            statusLineTwo = "Please try again.";
            return;
        }
        if (responseCode === LoginStatus.NO_REPLY) {
            statusLineOne = "No reply from loginserver.";
            statusLineTwo = "Please try again.";
            return;
        }
        if (responseCode === LoginStatus.LOADING_ERROR) {
            statusLineOne = "Error loading your profile.";
            statusLineTwo = "Please contact customer support.";
            return;
        }
        if (responseCode === LoginStatus.UNEXPECTED_RESPONSE) {
            statusLineOne = "Unexpected loginserver response.";
            statusLineTwo = "Please try using a different world.";
            return;
        }
        if (responseCode === LoginStatus.ADDRESS_BLOCKED) {
            statusLineOne = "This computers address has been blocked";
            statusLineTwo = "as it was used to break our rules";
            return;
        }
        if (responseCode === -1) {
            //if (initialResponseCode === 0) {
            //    if (this.anInt850 < 2) {
            //        try {
            //            await sleep(2000);
            //        } catch (ignored) { }
            //        this.anInt850++;
            //        this.login(username, password, reconnecting);
            //        return;
            //    } else {
            //        statusLineOne = "No response from loginserver";
            //        statusLineTwo = "Please wait 1 minute and try again.";
            //        return;
            //    }
            //} else {
            //    statusLineOne = "No response from server";
            //    statusLineTwo = "Please try using a different world.";
            //    return;
            //}
        } else {
            statusLineOne = "Unexpected server response";
            statusLineTwo = "Please try using a different world.";
            return;
        }
        statusLineTwo = "Error connecting to server.";
    }
}