import Denque from "denque";

export class ColourImageCacheSlot {
    constructor(
        public readonly line: number,
        public readonly slotId: number,
    ) {}
}

export class ColourImageCache {
    static readonly SLOT_USED = new ColourImageCacheSlot(0, 0);

    slotCount: number;

    lineCount: number;

    usageTracker: Denque<ColourImageCacheSlot>;

    images: Int32Array[][];

    slots: Array<ColourImageCacheSlot | undefined>;

    usedSlots: number;

    lastLine: number;

    dirty: boolean;

    constructor(slotCount: number, lineCount: number, imageSize: number) {
        this.slotCount = slotCount;
        this.lineCount = lineCount;
        this.usageTracker = new Denque<ColourImageCacheSlot>();
        this.images = Array.from({ length: slotCount }, () =>
            Array.from({ length: 3 }, () => new Int32Array(imageSize)),
        );
        this.slots = Array.from({ length: lineCount }, () => undefined);
        this.usedSlots = 0;
        this.lastLine = -1;
        this.dirty = false;
    }

    get(line: number): Int32Array[] {
        if (this.slotCount === this.lineCount) {
            this.dirty = this.slots[line] === undefined;
            this.slots[line] = ColourImageCache.SLOT_USED;
            return this.images[line];
        } else if (this.slotCount === 1) {
            this.dirty = line !== this.lastLine;
            this.lastLine = line;
            return this.images[0];
        } else {
            let slot = this.slots[line];
            if (slot === undefined) {
                this.dirty = true;
                if (this.slotCount > this.usedSlots) {
                    slot = new ColourImageCacheSlot(line, this.usedSlots);
                    this.usedSlots++;
                } else {
                    const oldSlot = this.usageTracker.pop();
                    if (oldSlot) {
                        slot = new ColourImageCacheSlot(line, oldSlot.slotId);
                        this.slots[oldSlot.line] = undefined;
                    }
                }
                this.slots[line] = slot;
            } else {
                this.dirty = false;
            }
            if (!slot) {
                throw new Error("ColourImageCache: invariant violation (slot is undefined)");
            }
            const activeSlot = slot;
            // Remove the slot from the usage tracker and add it to the front
            for (let i = 0; i < this.usageTracker.length; i++) {
                if (this.usageTracker.peekAt(i) === activeSlot) {
                    this.usageTracker.removeOne(i);
                    break;
                }
            }
            this.usageTracker.unshift(activeSlot);
            return this.images[activeSlot.slotId];
        }
    }

    getAll(): Int32Array[][] {
        if (this.lineCount !== this.slotCount) {
            throw new Error("Can only retrieve a full image cache");
        }
        for (let slot = 0; slot < this.slotCount; slot++) {
            this.slots[slot] = ColourImageCache.SLOT_USED;
        }
        return this.images;
    }
}
