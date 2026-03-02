import { NpcSpawn } from "../../data/npc/NpcSpawn";
import { AnimationFrames } from "../contracts/AnimationFrames";

export type NpcSpawnGroup = {
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames | undefined;
    spawns: NpcSpawn[];
};
