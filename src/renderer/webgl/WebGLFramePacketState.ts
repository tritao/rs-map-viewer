import { NPC_DATA_TEXTURE_RING_SIZE, type NpcGpuFrameData } from "../../runtime/contracts/NpcGpuFrame";
import {
    parseFramePacket,
    type FramePacket,
    type ParsedFramePacket,
    type ParsedFrameTickPatches,
} from "../../runtime/contracts/FramePacket";

export class WebGLFramePacketState {
    private readonly npcDataOffsetsByMapIdByRing: Map<number, number>[] = Array.from(
        { length: NPC_DATA_TEXTURE_RING_SIZE },
        () => new Map<number, number>(),
    );
    private npcDataRingIndex: number = 0;
    private npcGpuFrameData: NpcGpuFrameData | undefined;
    private frameTickPatches: ParsedFrameTickPatches | undefined;
    private frameRenderListPacked: Int32Array | undefined;
    private lastAppliedFramePacketFrameCount: number = -1;
    private npcDataTextureDirty: boolean = false;

    apply(packet: FramePacket | undefined): void {
        if (!packet) {
            this.reset();
            return;
        }

        // Avoid re-parsing the packet when the worker output lags by a frame.
        if ((packet.frameCount | 0) !== (this.lastAppliedFramePacketFrameCount | 0)) {
            this.lastAppliedFramePacketFrameCount = packet.frameCount | 0;
            const parsed = parseFramePacket(packet);
            if (parsed) {
                this.applyParsedFramePacket(parsed);
            }
        }
    }

    reset(): void {
        this.lastAppliedFramePacketFrameCount = -1;
        this.clearNpcOffsetRing();
        this.frameTickPatches = undefined;
        this.frameRenderListPacked = undefined;
        this.npcGpuFrameData = undefined;
        this.npcDataTextureDirty = false;
    }

    getTickPatches(): ParsedFrameTickPatches | undefined {
        return this.frameTickPatches;
    }

    getRenderListPacked(): Int32Array | undefined {
        return this.frameRenderListPacked;
    }

    getNpcGpuFrameData(): NpcGpuFrameData | undefined {
        return this.npcGpuFrameData;
    }

    isNpcDataTextureDirty(): boolean {
        return this.npcDataTextureDirty;
    }

    markNpcDataTextureClean(): void {
        this.npcDataTextureDirty = false;
    }

    getNpcDataRingIndex(): number {
        return this.npcDataRingIndex | 0;
    }

    setNpcDataRingIndex(index: number): void {
        this.npcDataRingIndex =
            (((index | 0) % NPC_DATA_TEXTURE_RING_SIZE) + NPC_DATA_TEXTURE_RING_SIZE) %
            NPC_DATA_TEXTURE_RING_SIZE;
    }

    getNpcDataOffsetForCurrentRing(mapId: number): number | undefined {
        const ringOffsets = this.npcDataOffsetsByMapIdByRing[this.npcDataRingIndex | 0];
        return ringOffsets?.get(mapId | 0);
    }

    private applyParsedFramePacket(packet: ParsedFramePacket): void {
        this.npcGpuFrameData = packet.npcGpuFrameData;
        this.frameTickPatches = packet.tickPatches;
        this.frameRenderListPacked = packet.renderListPacked;
        this.setNpcDataRingIndex(packet.npcRingWriteIndex);

        const ringOffsets = this.npcDataOffsetsByMapIdByRing[this.npcDataRingIndex]!;
        ringOffsets.clear();
        for (const [mapId, dataOffset] of packet.npcOffsetsByMapId.entries()) {
            ringOffsets.set(mapId, dataOffset);
        }
        this.npcDataTextureDirty = true;
    }

    private clearNpcOffsetRing(): void {
        this.npcDataRingIndex = 0;
        for (let i = 0; i < this.npcDataOffsetsByMapIdByRing.length; i++) {
            this.npcDataOffsetsByMapIdByRing[i]!.clear();
        }
    }
}
