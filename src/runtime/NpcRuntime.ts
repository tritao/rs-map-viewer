import { encodeNpcLifecyclePacketFromEvents } from "./contracts/NpcLifecyclePacket";
import type { NpcEvent } from "./sim/NpcEvents";

export function createNpcLifecyclePacket(
    events: ReadonlyArray<NpcEvent>,
): Uint8Array | undefined {
    if ((events.length | 0) <= 0) {
        return undefined;
    }
    return encodeNpcLifecyclePacketFromEvents(events);
}
