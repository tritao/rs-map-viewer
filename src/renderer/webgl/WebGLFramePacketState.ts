import {
    type ParsedRenderFramePacket,
    type RenderFramePacket,
    type ParsedFrameTickPatches,
    parseRenderFramePacket,
} from "../RenderFramePacket";
import {
    NPC_DATA_TEXTURE_RING_SIZE,
    type NpcGpuFrameData,
} from "../NpcGpuFrame";

export class WebGLFramePacketState {
    private readonly npcDataRangesByMapIdByRing: Map<
        number,
        Readonly<{ start: number; count: number }>
    >[] = Array.from(
        { length: NPC_DATA_TEXTURE_RING_SIZE },
        () => new Map<number, Readonly<{ start: number; count: number }>>(),
    );
    private npcDataRingIndex: number = 0;
    private npcGpuFrameData: NpcGpuFrameData | undefined;
    private frameTickPatches: ParsedFrameTickPatches | undefined;
    private frameRenderListPacked: Int32Array | undefined;
    private lastAppliedFramePacketFrameCount: number = -1;
    private npcDataTextureDirty: boolean = false;

    apply(packet: RenderFramePacket | undefined): void {
        if (!packet) {
            this.reset();
            return;
        }

        // Avoid re-parsing the packet when the worker output lags by a frame.
        if ((packet.frameCount | 0) !== (this.lastAppliedFramePacketFrameCount | 0)) {
            this.lastAppliedFramePacketFrameCount = packet.frameCount | 0;
            const parsed = parseRenderFramePacket(packet);
            if (parsed) {
                this.applyParsedFramePacket(parsed);
            }
        }
    }

    reset(): void {
        this.lastAppliedFramePacketFrameCount = -1;
        this.clearNpcRangeRing();
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

    getNpcDataRangeForCurrentRing(
        mapId: number,
    ): Readonly<{ start: number; count: number }> | undefined {
        const ringRanges = this.npcDataRangesByMapIdByRing[this.npcDataRingIndex | 0];
        return ringRanges?.get(mapId | 0);
    }

    private applyParsedFramePacket(packet: ParsedRenderFramePacket): void {
        this.npcGpuFrameData = packet.npcGpuFrameData;
        this.frameTickPatches = packet.tickPatches;
        this.frameRenderListPacked = packet.renderListPacked;
        this.setNpcDataRingIndex(packet.npcRingWriteIndex);

        const ringRanges = this.npcDataRangesByMapIdByRing[this.npcDataRingIndex]!;
        ringRanges.clear();
        for (const [mapId, dataRange] of packet.npcRangesByMapId.entries()) {
            ringRanges.set(mapId, dataRange);
        }
        this.npcDataTextureDirty = true;
    }

    private clearNpcRangeRing(): void {
        this.npcDataRingIndex = 0;
        for (let i = 0; i < this.npcDataRangesByMapIdByRing.length; i++) {
            this.npcDataRangesByMapIdByRing[i]!.clear();
        }
    }
}
