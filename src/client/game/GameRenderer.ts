import { Configuration } from "./Configuration";
import { Game } from "./Game";
import { Player } from "./renderable/actor/Player";

export function renderGameView(game: Game) {
    if (!game.loggedIn) { // FIXME: loadingStage
        return;
    }

    const scene = game.currentScene;

    scene.renderCount++;
    renderPlayers(game, true);
    //this.renderNPCs(true);
    //this.renderPlayers(false);
    //this.renderNPCs(false);
    //this.renderProjectiles();
    //this.renderStationaryGraphics();
}

export function renderPlayers(game: Game, priority: boolean) {
    const scene = game.currentScene;

    //if (game.localPlayer.worldX >> 7 === game.destinationX && game.localPlayer.worldY >> 7 === game.destinationY) {
    //    //game.destinationX = 0;
    //}

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
            !priority &&
            player.movementAnimation === player.idleAnimation
        ) {
            player.preventRotation = true;
        }

        const viewportX: number = player.worldX >> 7;
        const viewportY: number = player.worldY >> 7;
        if (viewportX < 0 || viewportX >= Game.MAX_TILES || viewportY < 0 || viewportY >= Game.MAX_TILES) {
            continue;
        }

        if (
            player.playerModel != null &&
            game.pulseCycle >= player.objectAppearanceStartTick &&
            game.pulseCycle < player.objectAppearanceEndTick
        ) {
            player.preventRotation = false;
            player.drawHeight2 = game.currentScene.getFloorDrawHeight(player.worldY, player.worldX, game.plane);
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

        if ((player.worldX & 127) === 64 && (player.worldY & 127) === 64) {
            if (scene.tileRenderCount[viewportX][viewportY] === scene.renderCount) {
                continue;
            }
            scene.tileRenderCount[viewportX][viewportY] = scene.renderCount;
        }

        player.drawHeight2 = scene.getFloorDrawHeight(player.worldY, player.worldX, game.plane);
        game.currentScene.addEntity(
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
