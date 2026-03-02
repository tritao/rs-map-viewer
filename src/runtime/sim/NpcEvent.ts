import type { NpcSpawnEvent } from "./NpcSpawnEvent";
import type { NpcRuntimeEvent } from "./NpcUpdateEvent";

export type NpcEvent = NpcSpawnEvent | NpcRuntimeEvent;
