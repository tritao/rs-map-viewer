import { Scene } from "../../src/rs/scene/Scene";
import {
    TerrainSquareDecodeScratch,
    decodeTerrainSquareFromBytesInto,
} from "../../src/rs/scene/decodeTerrainSquare";
import { computeSceneTileModelForTile } from "../../src/rs/scene/computeSceneTileModel";
import { Dat2SeqFrame, DatSeqFrame } from "../../src/rs/model/seq/SeqFrame";
import { SpriteLoader } from "../../src/rs/sprite/SpriteLoader";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function withSilencedConsoleError<T>(fn: () => T): T {
    const prev = console.error;
    console.error = () => {};
    try {
        return fn();
    } finally {
        console.error = prev;
    }
}

function buildTerrainSquareBytesOldFormat(options?: {
    overlayAt00?: { overlay: number; underlay: number };
}): Uint8Array {
    const size = Scene.MAP_SQUARE_SIZE;
    const levels = Scene.MAX_LEVELS;

    const bytes: number[] = [];

    for (let level = 0; level < levels; level++) {
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                if (level === 0 && x === 0 && y === 0 && options?.overlayAt00) {
                    const { overlay, underlay } = options.overlayAt00;

                    // overlay: v<=49 => read overlay byte, then terminator
                    bytes.push(2); // v=2 => shape 0, rotation 0
                    bytes.push(overlay);

                    // underlay: v>81 => underlayId = v-81
                    bytes.push(81 + underlay);

                    bytes.push(0); // terminate tile
                } else {
                    bytes.push(0); // terminate tile
                }
            }
        }
    }

    return new Uint8Array(bytes);
}

function testTerrainDecodeScratchReuse(): void {
    const scratch = new TerrainSquareDecodeScratch();

    const withOverlay = buildTerrainSquareBytesOldFormat({ overlayAt00: { overlay: 5, underlay: 1 } });
    const zeroed = buildTerrainSquareBytesOldFormat();

    const overlaysColRef = scratch.tileOverlays[0][0];
    const underlaysColRef = scratch.tileUnderlays[0][0];

    decodeTerrainSquareFromBytesInto(scratch, withOverlay, false, 0, 0);
    const overlay00AfterFirstDecode = scratch.tileOverlays[0][0][0];
    const underlay00AfterFirstDecode = scratch.tileUnderlays[0][0][0];
    assert(overlay00AfterFirstDecode === 5, "expected overlay set for [0][0][0]");
    assert(underlay00AfterFirstDecode === 1, "expected underlay set for [0][0][0]");

    decodeTerrainSquareFromBytesInto(scratch, zeroed, false, 0, 0);
    const overlay00AfterSecondDecode = scratch.tileOverlays[0][0][0];
    const underlay00AfterSecondDecode = scratch.tileUnderlays[0][0][0];
    assert(overlay00AfterSecondDecode === 0, "expected overlay cleared on reuse");
    assert(underlay00AfterSecondDecode === 0, "expected underlay cleared on reuse");

    assert(scratch.tileOverlays[0][0] === overlaysColRef, "expected overlay column array reused");
    assert(scratch.tileUnderlays[0][0] === underlaysColRef, "expected underlay column array reused");
}

function testComputeSceneTileModelInvariants(): void {
    const blendedColors: Int32Array[] = [
        new Int32Array([10, 11, 12]),
        new Int32Array([20, 21, 22]),
        new Int32Array([30, 31, 32]),
    ];

    const none = computeSceneTileModelForTile({
        x: 1,
        y: 1,
        heightSw: 0,
        heightSe: 0,
        heightNe: 0,
        heightNw: 0,
        lightSw: 96,
        lightSe: 96,
        lightNe: 96,
        lightNw: 96,
        underlayId: -1,
        overlayId: -1,
        tileShape: 0,
        tileRotation: 0,
        smoothUnderlays: true,
        blendedColors,
        underlayTypeLoader: { tryLoad: () => ({ ok: false }) } as any,
        overlayTypeLoader: {} as any,
        textureLoader: {} as any,
    } as any);
    assert(none === undefined, "expected undefined when no underlay and no overlay");

    const underlayOnly = computeSceneTileModelForTile({
        x: 1,
        y: 1,
        heightSw: 1,
        heightSe: 2,
        heightNe: 3,
        heightNw: 4,
        lightSw: 96,
        lightSe: 96,
        lightNe: 96,
        lightNw: 96,
        underlayId: 0,
        overlayId: -1,
        tileShape: 0,
        tileRotation: 0,
        smoothUnderlays: true,
        blendedColors,
        underlayTypeLoader: { tryLoad: () => ({ ok: false }) } as any,
        overlayTypeLoader: {} as any,
        textureLoader: {} as any,
    } as any);
    assert(underlayOnly !== undefined, "expected tile model for underlay-only");
    assert(underlayOnly.faceTextures === undefined, "expected underlay-only tile model to have no overlay/underlay textures");
    assert(underlayOnly.underlayTextureId === -1, "expected underlay-only tile model to have no underlay texture");
    assert(underlayOnly.shape === 0, "expected underlay-only tile model to use shape=0");
}

function testTryLoadNeverThrows(): void {
    // Dat seq frames: `tryLoad` should never throw even for invalid/truncated bytes.
    const frames = new Map<number, any>();
    const ok = DatSeqFrame.tryLoad(frames as any, new Uint8Array());
    assert(ok === false, "expected DatSeqFrame.tryLoad to return false on invalid data");

    // Dat2 seq frames: also should never throw; base loader can be missing.
    const dat2 = withSilencedConsoleError(() =>
        Dat2SeqFrame.tryLoad(
            {} as any,
            { load: () => undefined, clearCache: () => {} } as any,
            new Uint8Array(),
        ),
    );
    assert(dat2 === undefined, "expected Dat2SeqFrame.tryLoad to return undefined on invalid data");

    // Dat sprites: tryLoad should never throw on missing files.
    const archiveStub = {
        getFile: () => undefined,
        getFileNamed: () => undefined,
    } as any;
    const sprite = withSilencedConsoleError(() => SpriteLoader.tryLoadIndexedSpriteDatId(archiveStub, 123, 0));
    assert(sprite === undefined, "expected SpriteLoader.tryLoadIndexedSpriteDatId to return undefined on missing files");
}

function main(): void {
    testTerrainDecodeScratchReuse();
    testComputeSceneTileModelInvariants();
    testTryLoadNeverThrows();
    console.log("decode-invariants: ok");
}

main();
