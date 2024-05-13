import { Game } from "./game/Game";

console.log("Running game client...");

let game = new Game();
let username = "Wildy" + Math.floor(Math.random() * 1000);
await game.login(username, "test123");

setInterval(async () => {
    await game.processGameLoop();
}, 0);
