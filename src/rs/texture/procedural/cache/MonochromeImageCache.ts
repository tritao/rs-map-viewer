import Denque from "denque";

export class MonochromeImageCacheSlot {
    constructor(
        public readonly line: number,
        public readonly slotId: number,
    ) {}
}

export class MonochromeImageCache {
    static readonly SLOT_USED = new MonochromeImageCacheSlot(0, 0);

    slotCount: number;

    lineCount: number;

    usageTracker: Denque<MonochromeImageCacheSlot>;

    images: Int32Array[];

    slots: MonochromeImageCacheSlot[];

    usedSlots: number;

    lastLine: number;

    dirty: boolean;

    constructor(slotCount: number, lineCount: number, imageSize: number) {
        this.slotCount = slotCount;
        this.lineCount = lineCount;
        this.usageTracker = new Denque<MonochromeImageCacheSlot>();
        this.images = new Array(slotCount);
        for (let i = 0; i < slotCount; i++) {
            this.images[i] = new Int32Array(imageSize);
        }
        this.slots = new Array(slotCount);
        this.usedSlots = 0;
        this.lastLine = -1;
        this.dirty = false;
    }

    get(line: number): Int32Array {
        if (this.slotCount === this.lineCount) {
            this.dirty = this.slots[line] === undefined;
            this.slots[line] = MonochromeImageCache.SLOT_USED;
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
                    slot = new MonochromeImageCacheSlot(line, this.usedSlots);
                    this.usedSlots++;
                } else {
                    const oldSlot = this.usageTracker.pop();
                    if (oldSlot) {
                        slot = new MonochromeImageCacheSlot(line, oldSlot.slotId);
                        delete this.slots[oldSlot.line];
                    }
                }
                this.slots[line] = slot;
            } else {
                this.dirty = false;
            }
            // Remove the slot from the usage tracker and add it to the front
            for (let i = 0; i < this.usageTracker.length; i++) {
                if (this.usageTracker.peekAt(i) === slot) {
                    this.usageTracker.removeOne(i);
                    break;
                }
            }
            this.usageTracker.unshift(slot);
            return this.images[slot.slotId];
        }
    }

    getAll(): Int32Array[] {
        if (this.lineCount !== this.slotCount) {
            throw new Error("Can only retrieve a full image cache");
        }
        for (let slot = 0; slot < this.slotCount; slot++) {
            this.slots[slot] = MonochromeImageCache.SLOT_USED;
        }
        return this.images;
    }
}
