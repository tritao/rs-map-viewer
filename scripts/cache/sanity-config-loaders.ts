import { CacheInfo, GameType } from "../../src/rs/cache/CacheInfo";
import { Type } from "../../src/rs/config/Type";
import { BaseTypeLoader, IndexedDatTypeLoader } from "../../src/rs/config/TypeLoader";
import { EnumType } from "../../src/rs/config/enumtype/EnumType";
import { LocType } from "../../src/rs/config/loctype/LocType";
import { NpcType } from "../../src/rs/config/npctype/NpcType";
import { ByteBuffer } from "../../src/rs/io/ByteBuffer";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

class TestType extends Type {
    value = 0;

    override decodeOpcode(opcode: number, buffer: ByteBuffer): void {
        switch (opcode) {
            case 1:
                this.value = buffer.readUnsignedByte();
                return;
            default:
                throw new Error(`TestType: unimplemented opcode=${opcode}`);
        }
    }
}

class MissingDataLoader extends BaseTypeLoader<TestType> {
    override getData(_id: number): Uint8Array | undefined {
        return undefined;
    }

    override getCount(): number {
        return 0;
    }
}

class FailingDecodeType extends Type {
    override decodeOpcode(opcode: number, _buffer: ByteBuffer): void {
        if (opcode === 2) {
            throw new Error("boom");
        }
    }
}

class FixedBufferLoader extends BaseTypeLoader<FailingDecodeType> {
    constructor(
        cacheInfo: CacheInfo,
        readonly bytes: Uint8Array,
    ) {
        super(FailingDecodeType, cacheInfo);
    }

    override getData(_id: number): Uint8Array | undefined {
        return this.bytes;
    }

    override getCount(): number {
        return 1;
    }
}

function testTryLoadNotFound(): void {
    const cacheInfo = new CacheInfo("test", GameType.Runescape, "test", 1, "1970-01-01", 0);
    const loader = new MissingDataLoader(TestType, cacheInfo);

    const r1 = loader.tryLoad(0);
    assert(!r1.ok, "expected tryLoad(0) to fail");
    assert(r1.error.kind === "not_found", "expected not_found error");

    const r2 = loader.tryLoad(0);
    assert(!r2.ok, "expected tryLoad(0) to fail consistently");
    assert(r2.error.kind === "not_found", "expected cached not_found error");
}

function testIndexedDatLoaderSlices(): void {
    const cacheInfo = new CacheInfo("test", GameType.Runescape, "test", 1, "1970-01-01", 0);

    // Data layout: [u16 count][entry0][entry1]
    // entry0: opcode 1, value 42, opcode 0
    // entry1: opcode 1, value 99, opcode 0
    const data = new Uint8Array([0x00, 0x02, 0x01, 42, 0x00, 0x01, 99, 0x00]);

    const loader = new IndexedDatTypeLoader(
        TestType,
        cacheInfo,
        2,
        data,
        new Int32Array([2, 5]),
        new Int32Array([3, 3]),
    );

    const a = loader.tryLoad(0);
    assert(a.ok, "expected entry0 to decode");
    assert(a.value.value === 42, `expected entry0 value=42, got ${a.value.value}`);

    const b = loader.tryLoad(1);
    assert(b.ok, "expected entry1 to decode");
    assert(b.value.value === 99, `expected entry1 value=99, got ${b.value.value}`);
    const bytes0 = loader.getData(0);
    const bytes1 = loader.getData(1);
    assert(!!bytes0 && !!bytes1, "expected getData to return bytes");
    assert(bytes0.length === 3 && bytes1.length === 3, "expected independent slices");
}

function testDecodeErrorIncludesOpcodeAndOffset(): void {
    const cacheInfo = new CacheInfo("test", GameType.Runescape, "test", 1, "1970-01-01", 0);

    // opcode=2 then a terminator 0 (won't be reached).
    const loader = new FixedBufferLoader(cacheInfo, new Uint8Array([2, 0]));
    const r = loader.tryLoad(0);
    assert(!r.ok, "expected decode to fail");
    assert(r.error.kind === "decode_failed", "expected decode_failed error");
    assert(r.error.opcode === 2, `expected opcode=2, got ${String(r.error.opcode)}`);
    assert(typeof r.error.offset === "number", "expected numeric offset");
}

function encodeCString(s: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
        bytes.push(s.charCodeAt(i) & 0xff);
    }
    bytes.push(0);
    return bytes;
}

function encodeI32BE(v: number): number[] {
    return [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function testConfigTypesUseDenseOptionalArrays(): void {
    // Use a Dat2-like cache type so `Type.readString()` uses 0 terminators (simpler fixtures).
    const cacheInfo = new CacheInfo("test", GameType.Runescape, "test", 500, "1970-01-01", 0);

    // LocType: "hidden" action should become `undefined` (not a sparse hole).
    {
        const loc = new LocType(0, cacheInfo);
        const bytes = new Uint8Array([30, ...encodeCString("hidden"), 0]);
        loc.decode(new ByteBuffer(bytes));
        assert(loc.actions.length === 5, "expected LocType.actions length=5");
        assert(loc.actions[0] === undefined, "expected LocType.actions[0] cleared to undefined");
        assert(0 in loc.actions, "expected LocType.actions[0] to be present (dense array)");
    }

    // NpcType: same semantics for action clearing.
    {
        const npc = new NpcType(0, cacheInfo);
        const bytes = new Uint8Array([30, ...encodeCString("hidden"), 0]);
        npc.decode(new ByteBuffer(bytes));
        assert(npc.actions.length === 5, "expected NpcType.actions length=5");
        assert(npc.actions[0] === undefined, "expected NpcType.actions[0] cleared to undefined");
        assert(0 in npc.actions, "expected NpcType.actions[0] to be present (dense array)");
    }

    // EnumType: keys/values arrays should be dense (no `new Array(n)` holes).
    {
        const en = new EnumType(0, cacheInfo);
        const bytes = new Uint8Array([
            5, // opcode
            0,
            2, // u16 outputCount
            ...encodeI32BE(1),
            ...encodeCString("a"),
            ...encodeI32BE(2),
            ...encodeCString("b"),
            0, // terminator opcode
        ]);
        en.decode(new ByteBuffer(bytes));
        assert(en.keys.length === 2, "expected EnumType.keys length=2");
        assert(en.stringValues.length === 2, "expected EnumType.stringValues length=2");
        assert(0 in en.keys && 1 in en.keys, "expected EnumType.keys to be dense");
        assert(
            0 in en.stringValues && 1 in en.stringValues,
            "expected EnumType.stringValues to be dense",
        );
    }
}

function main(): void {
    testTryLoadNotFound();
    testIndexedDatLoaderSlices();
    testDecodeErrorIncludesOpcodeAndOffset();
    testConfigTypesUseDenseOptionalArrays();
    console.log("sanity-config-loaders: ok");
}

main();
