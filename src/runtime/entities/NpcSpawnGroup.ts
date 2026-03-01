import { NpcSpawn } from "../../data/npc/NpcSpawn";
import { AnimationFrames } from "../../renderer/AnimationFrames";

export type NpcSpawnGroup = {
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames | undefined;
    spawns: NpcSpawn[];
};
