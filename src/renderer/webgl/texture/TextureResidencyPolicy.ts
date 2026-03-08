import { TEXTURE_ID_LUT_SIZE, textureIdToLutIndex } from "./TextureIdLut";

const MAX_TEXTURE_UPLOADS_PER_FRAME = 16;
const MAX_TEXTURE_PIXEL_CACHE = 512;

export const enum EnsureTextureStatus {
    Ok = 0,
    UnknownTexture = 1,
    Oversubscribed = 2,
    DecodeFailed = 3,
}

export type EnsureTextureResult = Readonly<{
    slot: number;
    lutDirty: boolean;
    updated: boolean;
    status: EnsureTextureStatus;
}>;

export class TextureResidencyPolicy {
    private textureIds: number[] = [];
    private knownTextureIds: Set<number> = new Set();

    readonly textureIdToSlot: Map<number, number> = new Map();
    readonly freeTextureSlots: number[] = [];
    readonly textureLastUsedFrame: Map<number, number> = new Map();
    textureSlotLutData?: Uint16Array;
    textureSlotCount: number = 0;

    readonly visibleTextureIds: Set<number> = new Set();
    readonly texturePixelCache: Map<number, Int32Array> = new Map();

    frameCount: number = 0;

    constructor(private readonly loadedTextureIdsOut: Set<number>) {}

    getTextureIds(): ReadonlyArray<number> {
        return this.textureIds;
    }

    setTextureIds(textureIds: ReadonlyArray<number>): void {
        this.textureIds = Array.from(textureIds);
        this.knownTextureIds.clear();
        for (let i = 0; i < this.textureIds.length; i++) {
            this.knownTextureIds.add(this.textureIds[i] | 0);
        }
    }

    getTextureIdPlus1(textureId: number): number | undefined {
        const id = textureId | 0;
        if (!this.knownTextureIds.has(id)) {
            return undefined;
        }
        return textureIdToLutIndex(id);
    }

    initTextureSlotLutData(): Uint16Array {
        this.textureSlotLutData = new Uint16Array(TEXTURE_ID_LUT_SIZE);
        return this.textureSlotLutData;
    }

    resetForNewTextureArray(slotCount: number): void {
        this.loadedTextureIdsOut.clear();
        this.textureIdToSlot.clear();
        this.freeTextureSlots.length = 0;
        this.textureLastUsedFrame.clear();
        this.texturePixelCache.clear();
        this.visibleTextureIds.clear();
        this.textureSlotCount = slotCount | 0;

        if (this.textureSlotLutData) {
            this.textureSlotLutData.fill(0);
        }
    }

    computeMaxPreloadTextures(maxPreloadTexturesHint: number | undefined): number {
        let maxPreloadTextures = Math.min(
            this.textureIds.length,
            Math.max(0, this.textureSlotCount - 1),
        );
        if (typeof maxPreloadTexturesHint === "number" && Number.isFinite(maxPreloadTexturesHint)) {
            maxPreloadTextures = Math.min(maxPreloadTextures, Math.max(0, maxPreloadTexturesHint | 0));
        }
        maxPreloadTextures = Math.min(maxPreloadTextures, Math.max(0, this.textureSlotCount - 1));
        return maxPreloadTextures | 0;
    }

    onPreloadedTexture(textureId: number, slot: number, pixels: Int32Array | undefined): void {
        this.textureIdToSlot.set(textureId, slot);
        if (pixels) {
            this.cacheTexturePixels(textureId, pixels);
        }
        this.touchTexture(textureId);

        const textureIdPlus1 = this.getTextureIdPlus1(textureId);
        if (textureIdPlus1 !== undefined && this.textureSlotLutData) {
            this.textureSlotLutData[textureIdPlus1] = slot;
        }
    }

    initFreeSlotsAfterPreload(preloadCount: number): void {
        this.freeTextureSlots.length = 0;
        for (let slot = (preloadCount | 0) + 1; slot < (this.textureSlotCount | 0); slot++) {
            this.freeTextureSlots.push(slot);
        }
    }

    cacheTexturePixels(textureId: number, pixels: Int32Array): void {
        if (this.texturePixelCache.has(textureId)) {
            this.texturePixelCache.delete(textureId);
        }
        this.texturePixelCache.set(textureId, pixels);
        this.loadedTextureIdsOut.add(textureId);

        while (this.texturePixelCache.size > MAX_TEXTURE_PIXEL_CACHE) {
            const oldest = this.texturePixelCache.keys().next().value as number | undefined;
            if (oldest === undefined) {
                break;
            }
            if (this.textureIdToSlot.has(oldest)) {
                const p = this.texturePixelCache.get(oldest);
                this.texturePixelCache.delete(oldest);
                if (p) {
                    this.texturePixelCache.set(oldest, p);
                }
                continue;
            }
            this.texturePixelCache.delete(oldest);
            this.loadedTextureIdsOut.delete(oldest);
        }
    }

    touchTexture(textureId: number): void {
        if (textureId === -1) {
            return;
        }
        this.textureLastUsedFrame.set(textureId, this.frameCount);
    }

    updateVisibleTextureIds(
        visibleUsedTextureIds: ReadonlyArray<Int32Array>,
        frameCount: number,
    ): void {
        this.frameCount = frameCount | 0;
        this.visibleTextureIds.clear();

        for (let i = 0; i < visibleUsedTextureIds.length; i++) {
            const used = visibleUsedTextureIds[i];
            for (let j = 0; j < used.length; j++) {
                const textureId = used[j] | 0;
                this.visibleTextureIds.add(textureId);
                this.touchTexture(textureId);
            }
        }
    }

    ensureVisibleTextures(
        opts: Readonly<{
            tryLoadPixels(textureId: number): Int32Array | undefined;
            uploadToSlot(textureId: number, slot: number, pixels: Int32Array): void;
        }>,
    ): Readonly<{
        updatedCount: number;
        lutDirty: boolean;
        missingOversubscribed: number;
        missingUnknown: number;
        missingDecode: number;
    }> {
        let updatedCount = 0;
        let lutDirty = false;
        let missingOversubscribed = 0;
        let missingUnknown = 0;
        let missingDecode = 0;

        for (const textureId of this.visibleTextureIds) {
            if (updatedCount >= MAX_TEXTURE_UPLOADS_PER_FRAME) {
                break;
            }
            if (this.textureIdToSlot.has(textureId)) {
                continue;
            }
            const result = this.ensureTextureInSlot(
                textureId,
                undefined,
                this.visibleTextureIds,
                opts,
            );
            lutDirty ||= result.lutDirty;
            updatedCount += result.updated ? 1 : 0;
            if (result.status === EnsureTextureStatus.Oversubscribed) {
                missingOversubscribed++;
            } else if (result.status === EnsureTextureStatus.UnknownTexture) {
                missingUnknown++;
            } else if (result.status === EnsureTextureStatus.DecodeFailed) {
                missingDecode++;
            }
        }

        return { updatedCount, lutDirty, missingOversubscribed, missingUnknown, missingDecode };
    }

    ensureTextureInSlot(
        textureId: number,
        pixels: Int32Array | undefined,
        protectedTextureIds: Set<number> | undefined,
        opts: Readonly<{
            tryLoadPixels(textureId: number): Int32Array | undefined;
            uploadToSlot(textureId: number, slot: number, pixels: Int32Array): void;
        }>,
    ): EnsureTextureResult {
        const existingSlot = this.textureIdToSlot.get(textureId);
        if (existingSlot !== undefined) {
            this.touchTexture(textureId);
            return {
                slot: existingSlot,
                lutDirty: false,
                updated: false,
                status: EnsureTextureStatus.Ok,
            };
        }

        const textureIdPlus1 = this.getTextureIdPlus1(textureId);
        if (textureIdPlus1 === undefined) {
            return {
                slot: 0,
                lutDirty: false,
                updated: false,
                status: EnsureTextureStatus.UnknownTexture,
            };
        }

        let slot = this.freeTextureSlots.pop();
        if (slot === undefined) {
            slot = this.evictTextureSlot(protectedTextureIds);
            if (slot === undefined) {
                return {
                    slot: 0,
                    lutDirty: false,
                    updated: false,
                    status: EnsureTextureStatus.Oversubscribed,
                };
            }
        }

        if (!pixels) {
            pixels = this.texturePixelCache.get(textureId);
        }
        if (!pixels) {
            pixels = opts.tryLoadPixels(textureId);
            if (!pixels) {
                this.freeTextureSlots.push(slot);
                return {
                    slot: 0,
                    lutDirty: false,
                    updated: false,
                    status: EnsureTextureStatus.DecodeFailed,
                };
            }
        }

        opts.uploadToSlot(textureId, slot, pixels);

        this.textureIdToSlot.set(textureId, slot);
        this.cacheTexturePixels(textureId, pixels);
        this.touchTexture(textureId);

        let outLutDirty = false;
        if (this.textureSlotLutData) {
            this.textureSlotLutData[textureIdPlus1] = slot;
            outLutDirty = true;
        }

        return { slot, lutDirty: outLutDirty, updated: true, status: EnsureTextureStatus.Ok };
    }

    private evictTextureSlot(protectedTextureIds?: Set<number>): number | undefined {
        let candidateTextureId: number | undefined;
        let candidateLastUsed = Number.POSITIVE_INFINITY;

        for (const [textureId, slot] of this.textureIdToSlot) {
            if (slot === 0) {
                continue;
            }
            if (protectedTextureIds?.has(textureId)) {
                continue;
            }
            const lastUsed = this.textureLastUsedFrame.get(textureId) ?? -1;
            if (lastUsed < candidateLastUsed) {
                candidateLastUsed = lastUsed;
                candidateTextureId = textureId;
            }
        }

        if (candidateTextureId === undefined) {
            return undefined;
        }

        const slot = this.textureIdToSlot.get(candidateTextureId);
        if (slot === undefined) {
            throw new Error("Texture slot bookkeeping corrupted");
        }

        this.textureIdToSlot.delete(candidateTextureId);
        this.textureLastUsedFrame.delete(candidateTextureId);

        const textureIdPlus1 = this.getTextureIdPlus1(candidateTextureId);
        if (textureIdPlus1 !== undefined && this.textureSlotLutData) {
            this.textureSlotLutData[textureIdPlus1] = 0;
        }

        return slot;
    }
}
