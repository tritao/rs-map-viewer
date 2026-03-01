import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { type CollisionData, CollisionMap } from "../../rs/scene/CollisionMap";
import { LocAnimated } from "../../runtime/entities/LocAnimated";
import type { LocAnimatedData } from "../../runtime/entities/LocAnimatedData";
import { Npc } from "../../runtime/entities/Npc";
import type { NpcData } from "../../runtime/entities/NpcData";
import { orderByPacketKeys } from "../../runtime/entities/orderByPacketKeys";

export type WorkerNpcSimMapState = {
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    collisionMaps: CollisionMap[];
    seededNpcFlags: boolean;
    npcs: Npc[];
    locsAnimated: LocAnimated[];

    // Tick patch scratch buffers (per-map) to avoid per-frame allocations.
    locTickPatchesByVariant: Int32Array[]; // 8 variants
    locTickPatchCountsByVariant: Int32Array; // length 8
    npcTickPatchesByVariant: Int32Array[]; // 2 variants (base/alpha)
    npcTickPatchCountsByVariant: Int32Array; // length 2
};

export type RegisterWorkerNpcSimMapInput = Readonly<{
    mapId: number;
    borderSize: number;
    tileRenderFlagsLevel1: Uint8Array[];
    collisionDatas: CollisionData[];
    locsAnimated: LocAnimatedData[];
    npcsIn: NpcData[];
    npcOrderKeys?: Int32Array;
}>;

export type WorkerNpcSimStateStoreDeps = Readonly<{
    npcTypeLoader: NpcTypeLoader;
    basTypeLoader: BasTypeLoader;
    seqTypeLoader: SeqTypeLoader;
    tickPatchEntryStride: number;
}>;

export class WorkerNpcSimStateStore {
    private readonly maps = new Map<number, WorkerNpcSimMapState>();

    clear(): void {
        this.maps.clear();
    }

    unregisterMap(mapId: number): void {
        this.maps.delete(mapId | 0);
    }

    getMap(mapId: number): WorkerNpcSimMapState | undefined {
        return this.maps.get(mapId | 0);
    }

    registerMap(
        input: RegisterWorkerNpcSimMapInput,
        deps: WorkerNpcSimStateStoreDeps,
    ): void {
        const ordered = orderByPacketKeys(input.npcsIn, input.npcOrderKeys);
        const npcs: Npc[] = [];
        for (const init of ordered) {
            const npcTypeResult = deps.npcTypeLoader.tryLoad(init.id);
            if (!npcTypeResult.ok) {
                continue;
            }
            const npcType = npcTypeResult.value;
            const idleSeqId = npcType.getIdleSeqId(deps.basTypeLoader);
            const walkSeqId = npcType.getWalkSeqId(deps.basTypeLoader);
            npcs.push(
                new Npc(
                    init.tileX | 0,
                    init.tileY | 0,
                    init.level | 0,
                    init.idleAnim,
                    init.walkAnim,
                    npcType,
                    idleSeqId | 0,
                    walkSeqId | 0,
                ),
            );
        }

        const cycleNow = 0;
        const locs: LocAnimated[] = [];
        for (const loc of input.locsAnimated) {
            const seqResult = deps.seqTypeLoader.tryLoad(loc.seqId);
            if (!seqResult.ok) {
                continue;
            }
            const seqType = seqResult.value;
            locs.push(
                new LocAnimated(
                    loc.drawRangeIndex | 0,
                    loc.drawRangeAlphaIndex | 0,
                    loc.drawRangeLodIndex | 0,
                    loc.drawRangeLodAlphaIndex | 0,
                    loc.drawRangeInteractIndex | 0,
                    loc.drawRangeInteractAlphaIndex | 0,
                    loc.drawRangeInteractLodIndex | 0,
                    loc.drawRangeInteractLodAlphaIndex | 0,
                    loc.anim,
                    seqType,
                    cycleNow,
                    !!loc.randomStart,
                ),
            );
        }

        const locCount = locs.length | 0;
        const locTickPatchesByVariant: Int32Array[] = [];
        for (let i = 0; i < 8; i++) {
            locTickPatchesByVariant.push(
                new Int32Array((locCount | 0) * (deps.tickPatchEntryStride | 0)),
            );
        }
        const npcCount = npcs.length | 0;
        const npcTickPatchesByVariant: Int32Array[] = [
            new Int32Array((npcCount | 0) * (deps.tickPatchEntryStride | 0)),
            new Int32Array((npcCount | 0) * (deps.tickPatchEntryStride | 0)),
        ];

        this.maps.set(input.mapId | 0, {
            borderSize: input.borderSize | 0,
            tileRenderFlagsLevel1: input.tileRenderFlagsLevel1,
            collisionMaps: input.collisionDatas.map(CollisionMap.fromData),
            seededNpcFlags: false,
            npcs,
            locsAnimated: locs,
            locTickPatchesByVariant,
            locTickPatchCountsByVariant: new Int32Array(8),
            npcTickPatchesByVariant,
            npcTickPatchCountsByVariant: new Int32Array(2),
        });
    }
}
