import { CacheInfo, GameType } from "../../src/rs/cache/CacheInfo";
import { ByteBuffer } from "../../src/rs/io/ByteBuffer";
import { BaseTypeLoader, IndexedDatTypeLoader } from "../../src/rs/config/TypeLoader";
import { Type } from "../../src/rs/config/Type";

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
    override getDataBuffer(_id: number): ByteBuffer | undefined {
        return undefined;
    }

    override getCount(): number {
        return 0;
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

    const buf0 = loader.getDataBuffer(0);
    const buf1 = loader.getDataBuffer(1);
    assert(!!buf0 && !!buf1, "expected getDataBuffer to return buffers");
    assert(buf0.offset === 0 && buf1.offset === 0, "expected independent buffers with offset=0");
}

function main(): void {
    testTryLoadNotFound();
    testIndexedDatLoaderSlices();
    console.log("sanity-config-loaders: ok");
}

main();

