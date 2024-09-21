import { Configuration } from "./Configuration";
import { Game } from "./Game";
import { Npc } from "./renderable/actor/Npc";
import { Player } from "./renderable/actor/Player";

export function renderGameView(game: Game) {
    if (!game.loggedIn) { // FIXME: loadingStage
        return;
    }

    const scene = game.currentScene;

    scene.renderCount++;
    renderPlayers(game, true);
    renderNPCs(game, true);
    renderPlayers(game, false);
    renderNPCs(game, false);
    //this.renderProjectiles();
    //this.renderStationaryGraphics();
}

export function renderPlayers(game: Game, priority: boolean) {
    const scene = game.currentScene;

    let playersToRender: number = game.localPlayerCount;
    if (priority) {
        playersToRender = 1;
    }

    for (let index: number = 0; index < playersToRender; index++) {
        let player: Player | null;
        let hash: number;
        if (priority) {
            player = game.localPlayer;
            hash = game.thisPlayerId << 14;
        } else {
            player = game.players[game.playerList[index]];
            hash = game.playerList[index] << 14;
        }
        if (player == null || !player.isVisible()) {
            continue;
        }
        player.preventRotation = false;
        if (
            ((Configuration.LOW_MEMORY && game.localPlayerCount > 50) || game.localPlayerCount > 200) &&
            !priority && player.movementAnimation === player.idleAnimation
        ) {
            player.preventRotation = true;
        }

        const viewportX = player.worldX >> 7;
        const viewportY = player.worldY >> 7;
        if (viewportX < 0 || viewportX >= Game.MAX_TILES || 
            viewportY < 0 || viewportY >= Game.MAX_TILES) {
            continue;
        }

        // Check if an overriden model exists for the player and use it if that is the case.
        if (player.playerModel != null &&
            game.pulseCycle >= player.objectAppearanceStartTick &&
            game.pulseCycle < player.objectAppearanceEndTick
        ) {
            player.preventRotation = false;
            player.drawHeight2 = game.currentScene.getFloorDrawHeight(player.worldY, player.worldX,
                game.plane);
            game.currentScene.addRenderable(
                player.drawHeight2,
                player.minY,
                player,
                player.minX,
                player.worldY,
                player.tileWidth,
                player.worldX,
                player.currentRotation,
                player.tileHeight,
                game.plane,
                hash
            );
            continue;
        }

        if ((player.worldX & 0x7F) === 64 && (player.worldY & 0x7F) === 64) {
            if (scene.tileRenderCount[viewportX][viewportY] === scene.renderCount) {
                continue;
            }
            scene.tileRenderCount[viewportX][viewportY] = scene.renderCount;
        }

        player.drawHeight2 = scene.getFloorDrawHeight(player.worldY, player.worldX, game.plane);
        scene.addEntity(
            hash,
            player,
            player.worldX,
            player.drawHeight2,
            player.dynamic,
            0,
            game.plane,
            60,
            player.worldY,
            player.currentRotation
        );
    }
}

export function renderNPCs(game: Game, flag: boolean) {
    const scene = game.currentScene;

    for (let i: number = 0; i < game.npcCount; i++) {
        const npc: Npc = game.npcs[game.npcIds[i]]!;

        let hash: number = 0x20000000 + (game.npcIds[i] << 14);
        //if (!npc.npcDefinition.clickable) {
        //    hash += 0x80000000;
        //}

        if (npc == null || !npc.isVisible() //||
            //npc.npcDefinition.visible !== flag || !npc.npcDefinition.isVisible()
        ) {
            continue;
        }
        const viewportX: number = npc.worldX >> 7;
        const viewportY: number = npc.worldY >> 7;
        if (viewportX < 0 || viewportX >= 104 || viewportY < 0 || viewportY >= 104) {
            continue;
        }

        if (npc.size === 1 && (npc.worldX & 0x7F) === 64 && (npc.worldY & 0x7F) === 64) {
            if (scene.tileRenderCount[viewportX][viewportY] === scene.renderCount) {
                continue;
            }
            scene.tileRenderCount[viewportX][viewportY] = scene.renderCount;
        }

        scene.addEntity(
            hash,
            npc,
            npc.worldX,
            scene.getFloorDrawHeight(npc.worldY, npc.worldX, game.plane),
            npc.dynamic,
            0,
            game.plane,
            (npc.size - 1) * 64 + 60,
            npc.worldY,
            npc.currentRotation
        );
    }
}
