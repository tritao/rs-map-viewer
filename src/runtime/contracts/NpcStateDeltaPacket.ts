export type NpcStateDeltaPacket = Readonly<{
    frameCount: number;
    tickMapIdsVersion: number;
    tickViewStateVersion: number;
    eventCount: number;
    lifecyclePacketBytes: Uint8Array;
}>;

export function buildNpcStateDeltaPacket(input: Readonly<{
    frameCount: number;
    tickMapIdsVersion: number;
    tickViewStateVersion: number;
    eventCount: number;
    lifecyclePacketBytes: Uint8Array;
}>): NpcStateDeltaPacket {
    return {
        frameCount: input.frameCount | 0,
        tickMapIdsVersion: input.tickMapIdsVersion | 0,
        tickViewStateVersion: input.tickViewStateVersion | 0,
        eventCount: Math.max(0, input.eventCount | 0),
        lifecyclePacketBytes: input.lifecyclePacketBytes,
    };
}

export function npcStateDeltaPacketTransferables(packet: NpcStateDeltaPacket): Transferable[] {
    return [packet.lifecyclePacketBytes.buffer as Transferable];
}
