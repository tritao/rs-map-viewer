#include <cstddef>
#include <cstring>
#include <exception>
#include <iostream>
#include <string>
#include <vector>

#include "../rs/cache/CacheIndex.hpp"
#include "../rs/cache/CacheSystem.hpp"
#include "../rs/cache/CacheType.hpp"
#include "../rs/cache/store/CacheStore.hpp"
#include "../rs/cache/store/DatLayout.hpp"
#include "../rs/cache/format/Archive.hpp"
#include "../rs/compression/NativeCompressionHandler.hpp"
#include "../rs/core/Allocator.hpp"
#include "../rs/core/Move.hpp"
#include "../rs/core/Result.hpp"
#include "../rs/core/Span.hpp"
#include "../rs/core/Status.hpp"
#include "../rs/core/Vec.hpp"
#include "../rs/config/TypeDecode.hpp"
#include "../rs/config/enumtype/EnumTypeLoader.hpp"
#include "../rs/config/floortype/FloorTypeLoaders.hpp"
#include "../rs/config/floortype/OverlayFloorType.hpp"
#include "../rs/config/floortype/UnderlayFloorType.hpp"
#include "../rs/config/idktype/IdkTypeLoader.hpp"
#include "../rs/config/invtype/InvTypeLoader.hpp"
#include "../rs/config/structtype/StructTypeLoader.hpp"
#include "../rs/config/paramtype/ParamTypeLoader.hpp"
#include "../rs/config/seqtype/SeqTypeLoader.hpp"
#include "../rs/config/spotanimtype/SpotAnimTypeLoader.hpp"
#include "../rs/config/vartype/VarBitType.hpp"
#include "../rs/config/vartype/VarBitTypeLoader.hpp"
#include "../rs/config/bastype/BasTypeLoader.hpp"
#include "../rs/config/questtype/QuestTypeLoader.hpp"
#include "../rs/config/mapscenetype/MapSceneTypeLoader.hpp"
#include "../rs/config/meltype/MapElementTypeLoader.hpp"
#include "../rs/config/loctype/LocTypeLoader.hpp"
#include "../rs/config/npctype/NpcTypeLoader.hpp"
#include "../rs/config/objtype/ObjTypeLoader.hpp"
#include "../rs/types.hpp"

namespace {

static int fail(const std::string& msg) {
    std::cerr << "FAIL: " << msg << "\n";
    return 1;
}

static bool eqBytes(const rs::Span<const rs::u8> a, const rs::Span<const rs::u8> b) {
    if (a.size() != b.size()) {
        return false;
    }
    for (std::size_t i = 0; i < a.size(); i++) {
        if (a[i] != b[i]) {
            return false;
        }
    }
    return true;
}

class FakeStore final : public rs::CacheStore {
public:
    std::size_t idxSize = 0;
    std::vector<rs::u8> datArchive0;
    std::vector<rs::u8> datArchive1;
    std::vector<rs::u8> dat2Meta; // meta index (255), archive id = index id

    rs::Status getIndexFileSize(rs::i32 indexId, std::size_t* outSize) const noexcept override {
        if (!outSize) {
            return rs::Status::InvalidArgument;
        }
        if (indexId < 0) {
            return rs::Status::OutOfRange;
        }
        *outSize = idxSize;
        return rs::Status::Ok;
    }

    rs::Status readArchive(rs::i32 indexId, rs::i32 archiveId, rs::Vec<rs::u8>* out) const noexcept override {
        if (!out) {
            return rs::Status::InvalidArgument;
        }

        const std::vector<rs::u8>* src = nullptr;

        if (indexId == 255) {
            // Dat2 meta index: archive id is the index id.
            (void)archiveId;
            src = &dat2Meta;
        } else {
            if (archiveId == 0) {
                src = &datArchive0;
            } else if (archiveId == 1) {
                src = &datArchive1;
            } else {
                return rs::Status::NotFound;
            }
        }

        out->clear();
        auto r = out->resize(src->size());
        if (!r.isOk()) {
            return r.status();
        }
        if (!src->empty()) {
            std::memcpy(out->data(), src->data(), src->size());
        }
        return rs::Status::Ok;
    }
};

} // namespace

int main() {
    try {
        rs::Allocator& alloc = rs::defaultAllocator();
        rs::NativeCompressionHandler compression;

        // gzip("hello rs") created via Python's gzip.compress(payload, 9)
        const std::vector<rs::u8> payload = {'h', 'e', 'l', 'l', 'o', ' ', 'r', 's'};
        const std::vector<rs::u8> gz = {
            0x1F, 0x8B, 0x08, 0x00, 0xCA, 0x3E, 0x83, 0x69, 0x02, 0xFF, 0xCB, 0x48, 0xCD, 0xC9,
            0xC9, 0x57, 0x28, 0x2A, 0x06, 0x00, 0x0F, 0xC8, 0x5B, 0x13, 0x08, 0x00, 0x00, 0x00,
        };

        {
            auto outRes = compression.decompressGzip(rs::Span<const rs::u8>(gz.data(), gz.size()), alloc);
            if (!outRes.isOk()) {
                return fail("decompressGzip: expected Ok");
            }
            rs::Vec<rs::u8> out = rs::move(outRes.value());
            if (!eqBytes(rs::Span<const rs::u8>(out.data(), out.size()), rs::Span<const rs::u8>(payload.data(), payload.size()))) {
                return fail("decompressGzip: output mismatch");
            }
        }

        {
            // Old `.dat` caches may append a trailing u16 after the gzip member (e.g. 0x0006).
            std::vector<rs::u8> withTrailing = gz;
            withTrailing.push_back(0x00);
            withTrailing.push_back(0x06);

            auto archRes = rs::Archive::decodeOld(
                0,
                rs::Span<const rs::u8>(withTrailing.data(), withTrailing.size()),
                false,
                compression,
                alloc);
            if (!archRes.isOk()) {
                return fail("Archive::decodeOld: expected Ok");
            }
            const rs::Archive archive = rs::move(archRes.value());
            if (archive.files().size() != 1) {
                return fail("Archive::decodeOld (gzip): expected 1 file");
            }
            if (!eqBytes(archive.files()[0].data.span(), rs::Span<const rs::u8>(payload.data(), payload.size()))) {
                return fail("Archive::decodeOld (gzip trailing u16): output mismatch");
            }
        }

        {
            // Strict checksum enforcement.
            std::vector<rs::u8> bad = gz;
            bad[bad.size() - 8] ^= 0x01; // corrupt CRC32
            auto outRes = compression.decompressGzip(rs::Span<const rs::u8>(bad.data(), bad.size()), alloc);
            if (outRes.isOk() || outRes.status() != rs::Status::ChecksumMismatch) {
                return fail("decompressGzip: expected checksum failure");
            }
        }

        {
            // CacheIndex Dat: dense archive ids and raw byte reads.
            FakeStore store;
            store.idxSize = 2 * rs::IDX_ENTRY_SIZE;
            store.datArchive0 = {0x01, 0x02, 0x03};
            store.datArchive1 = {0x10, 0x20};

            auto idxRes = rs::CacheIndex::fromStore(rs::CacheType::Dat, 5, store, compression, alloc);
            if (!idxRes.isOk()) {
                return fail("CacheIndex::fromStore(Dat): expected Ok");
            }
            rs::CacheIndex idx = rs::move(idxRes.value());

            if (idx.archiveCount() != 2) {
                return fail("CacheIndex(Dat): archiveCount mismatch");
            }
            const rs::Span<const rs::i32> ids = idx.archiveIds();
            if (ids.size() != 2 || ids[0] != 0 || ids[1] != 1) {
                return fail("CacheIndex(Dat): archiveIds mismatch");
            }

            rs::Vec<rs::u8> raw(alloc);
            const rs::Status s = idx.readArchiveBytes(1, &raw, alloc);
            if (!rs::ok(s) || !eqBytes(rs::Span<const rs::u8>(raw.data(), raw.size()),
                                       rs::Span<const rs::u8>(store.datArchive1.data(), store.datArchive1.size()))) {
                return fail("CacheIndex(Dat): readArchiveBytes mismatch");
            }

            rs::Vec<rs::u8> payload(alloc);
            const rs::Status ps = idx.readContainerPayload(0, nullptr, &payload, alloc);
            if (ps != rs::Status::Unsupported) {
                return fail("CacheIndex(Dat): readContainerPayload expected Unsupported");
            }
        }

        {
            // CacheIndex Dat2: empty meta => empty reference table.
            FakeStore store;
            store.dat2Meta = {}; // no meta bytes => invalid/empty table
            auto idxRes = rs::CacheIndex::fromStore(rs::CacheType::Dat2, 2, store, compression, alloc);
            if (!idxRes.isOk()) {
                return fail("CacheIndex::fromStore(Dat2): expected Ok");
            }
            rs::CacheIndex idx = rs::move(idxRes.value());
            if (idx.archiveCount() != 0 || idx.archiveIds().size() != 0) {
                return fail("CacheIndex(Dat2 empty): expected 0 archives");
            }

            rs::Vec<rs::u8> raw(alloc);
            const rs::Status s = idx.readArchiveBytes(0, &raw, alloc);
            if (s != rs::Status::NotFound) {
                return fail("CacheIndex(Dat2 empty): readArchiveBytes expected NotFound");
            }
        }

        {
            // CacheSystem convenience helpers.
            FakeStore store;
            store.idxSize = 2 * rs::IDX_ENTRY_SIZE;
            store.datArchive0 = {0x01, 0x02, 0x03};
            store.datArchive1 = {0x10, 0x20};
            store.dat2Meta = {};

            const rs::i32 indexIds[] = {5};
            auto sysRes = rs::CacheSystem::fromStore(
                rs::CacheType::Dat,
                store,
                rs::Span<const rs::i32>(indexIds, 1),
                compression,
                alloc);
            if (!sysRes.isOk()) {
                return fail("CacheSystem::fromStore(Dat): expected Ok");
            }
            rs::CacheSystem sys = rs::move(sysRes.value());

            rs::Vec<rs::u8> raw(alloc);
            const rs::Status s = sys.readArchiveBytes(5, 1, &raw, alloc);
            if (!rs::ok(s) || raw.size() != store.datArchive1.size()) {
                return fail("CacheSystem(Dat): readArchiveBytes expected Ok");
            }

            rs::Vec<rs::u8> payload(alloc);
            const rs::Status ps = sys.readContainerPayload(5, 0, nullptr, &payload, alloc);
            if (ps != rs::Status::Unsupported) {
                return fail("CacheSystem(Dat): readContainerPayload expected Unsupported");
            }
        }

        {
            // Config decode: VarBitType (opcode=1) + archive-backed loader.
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // Bytes: [opcode=1][baseVar=u16][start=u8][end=u8][opcode=0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(6);
            if (!rr.isOk()) {
                return fail("VarBitType: OOM");
            }
            fileBytes[0] = 1;
            fileBytes[1] = 0x01;
            fileBytes[2] = 0x23;
            fileBytes[3] = 4;
            fileBytes[4] = 9;
            fileBytes[5] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("VarBitType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::VarBitTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("VarBitTypeLoader::fromArchive failed");
            }
            rs::VarBitTypeLoader loader = rs::move(loaderRes.value());

            const rs::VarBitType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("VarBitTypeLoader.get(0) expected Ok");
            }
            if (t->baseVar != 0x0123 || t->startBit != 4 || t->endBit != 9) {
                return fail("VarBitType decoded fields mismatch");
            }
        }

        {
            // Config decode: UnderlayFloorType (opcode=1 rgb) + post() derived HSL fields.
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // Bytes: [opcode=1][rgb=0x112233][opcode=0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(5);
            if (!rr.isOk()) {
                return fail("UnderlayFloorType: OOM");
            }
            fileBytes[0] = 1;
            fileBytes[1] = 0x11;
            fileBytes[2] = 0x22;
            fileBytes[3] = 0x33;
            fileBytes[4] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("UnderlayFloorType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::UnderlayFloorTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("UnderlayFloorTypeLoader::fromArchive failed");
            }
            rs::UnderlayFloorTypeLoader loader = rs::move(loaderRes.value());

            const rs::UnderlayFloorType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("UnderlayFloorTypeLoader.get(0) expected Ok");
            }
            if (t->rgbColor != 0x112233) {
                return fail("UnderlayFloorType rgbColor mismatch");
            }
            if (t->hueMultiplier < 1) {
                return fail("UnderlayFloorType post() not applied (hueMultiplier)");
            }
        }

        {
            // Config decode: OverlayFloorType (opcode=1 rgb, opcode=6 name) + post() primaryHsl.
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // Bytes: [1][0x22 0x44 0x66][6]["abc" 0][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(10);
            if (!rr.isOk()) {
                return fail("OverlayFloorType: OOM");
            }
            fileBytes[0] = 1;
            fileBytes[1] = 0x22;
            fileBytes[2] = 0x44;
            fileBytes[3] = 0x66;
            fileBytes[4] = 6;
            fileBytes[5] = static_cast<rs::u8>('a');
            fileBytes[6] = static_cast<rs::u8>('b');
            fileBytes[7] = static_cast<rs::u8>('c');
            fileBytes[8] = 0; // Dat2 string terminator
            fileBytes[9] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("OverlayFloorType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::OverlayFloorTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("OverlayFloorTypeLoader::fromArchive failed");
            }
            rs::OverlayFloorTypeLoader loader = rs::move(loaderRes.value());

            const rs::OverlayFloorType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("OverlayFloorTypeLoader.get(0) expected Ok");
            }
            if (t->primaryRgb != 0x224466) {
                return fail("OverlayFloorType primaryRgb mismatch");
            }
            if (t->name.len != 3 || !t->name.data || t->name.data[0] != 'a' || t->name.data[1] != 'b' || t->name.data[2] != 'c') {
                return fail("OverlayFloorType name mismatch");
            }
            if (t->primaryHsl != rs::rgbToHsl(t->primaryRgb)) {
                return fail("OverlayFloorType primaryHsl mismatch");
            }
        }

        {
            // Config decode: IdkType (Identity Kit) with arrays.
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // Bytes:
            // [1][bodyPart=7]
            // [2][modelCount=2][0x0102][0x0304]
            // [40][count=1][from=0x0011][to=0x0022]
            // [60][if0=0x0A0B]
            // [3] nonSelectable
            // [0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 1 + (1 + 1 + 2 + 2) + (1 + 1 + 2 + 2) + (1 + 2) + 1 + 1);
            if (!rr.isOk()) {
                return fail("IdkType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = 7;
            fileBytes[off++] = 2;
            fileBytes[off++] = 2;
            fileBytes[off++] = 0x01;
            fileBytes[off++] = 0x02;
            fileBytes[off++] = 0x03;
            fileBytes[off++] = 0x04;
            fileBytes[off++] = 40;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x11;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x22;
            fileBytes[off++] = 60;
            fileBytes[off++] = 0x0A;
            fileBytes[off++] = 0x0B;
            fileBytes[off++] = 3;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("IdkType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::IdkTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("IdkTypeLoader::fromArchive failed");
            }
            rs::IdkTypeLoader loader = rs::move(loaderRes.value());

            const rs::IdkType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("IdkTypeLoader.get(0) expected Ok");
            }
            if (t->bodyPartId != 7 || !t->nonSelectable) {
                return fail("IdkType scalar fields mismatch");
            }
            if (t->modelIds.size() != 2 || t->modelIds[0] != 0x0102 || t->modelIds[1] != 0x0304) {
                return fail("IdkType modelIds mismatch");
            }
            if (t->recolorFrom.size() != 1 || t->recolorTo.size() != 1 || t->recolorFrom[0] != 0x0011 || t->recolorTo[0] != 0x0022) {
                return fail("IdkType recolor mismatch");
            }
            if (t->ifModelIds[0] != 0x0A0B) {
                return fail("IdkType ifModelIds mismatch");
            }
        }

        {
            // Config decode: EnumType with string values.
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // Bytes:
            // [1]['i'][2]['s'][3]["def\0"][5][count=2][key=1][val="a\0"][key=2][val="bb\0"][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 1 + 1 + 1 + 1 + 4 + 1 + 2 + (4 + 2) + (4 + 3) + 1);
            if (!rr.isOk()) {
                return fail("EnumType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = static_cast<rs::u8>('i');
            fileBytes[off++] = 2;
            fileBytes[off++] = static_cast<rs::u8>('s');
            fileBytes[off++] = 3;
            fileBytes[off++] = static_cast<rs::u8>('d');
            fileBytes[off++] = static_cast<rs::u8>('e');
            fileBytes[off++] = static_cast<rs::u8>('f');
            fileBytes[off++] = 0;
            fileBytes[off++] = 5;
            fileBytes[off++] = 0;
            fileBytes[off++] = 2; // u16 count
            // key=1
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;
            fileBytes[off++] = 1;
            // val="a"
            fileBytes[off++] = static_cast<rs::u8>('a');
            fileBytes[off++] = 0;
            // key=2
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;
            fileBytes[off++] = 2;
            // val="bb"
            fileBytes[off++] = static_cast<rs::u8>('b');
            fileBytes[off++] = static_cast<rs::u8>('b');
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("EnumType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::EnumTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("EnumTypeLoader::fromArchive failed");
            }
            rs::EnumTypeLoader loader = rs::move(loaderRes.value());

            const rs::EnumType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("EnumTypeLoader.get(0) expected Ok");
            }
            if (t->outputCount != 2 || t->keys.size() != 2 || t->stringValues.size() != 2) {
                return fail("EnumType sizes mismatch");
            }
            if (t->keys[0] != 1 || t->keys[1] != 2) {
                return fail("EnumType keys mismatch");
            }
            if (t->defaultString.len != 3 || !t->defaultString.data || t->defaultString.data[0] != 'd') {
                return fail("EnumType defaultString mismatch");
            }
            if (t->stringValues[0].len != 1 || t->stringValues[1].len != 2) {
                return fail("EnumType stringValues mismatch");
            }
        }

        {
            // Config decode: ParamType (type + default string + autoDisable).
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // Bytes: [1]['s'][5]["hi\0"][4][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 1 + 1 + 3 + 1 + 1);
            if (!rr.isOk()) {
                return fail("ParamType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = static_cast<rs::u8>('s');
            fileBytes[off++] = 5;
            fileBytes[off++] = static_cast<rs::u8>('h');
            fileBytes[off++] = static_cast<rs::u8>('i');
            fileBytes[off++] = 0;
            fileBytes[off++] = 4;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("ParamType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::ParamTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("ParamTypeLoader::fromArchive failed");
            }
            rs::ParamTypeLoader loader = rs::move(loaderRes.value());

            const rs::ParamType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("ParamTypeLoader.get(0) expected Ok");
            }
            if (!t->isString() || t->autoDisable) {
                return fail("ParamType fields mismatch");
            }
            if (t->defaultString.len != 2 || !t->defaultString.data || t->defaultString.data[0] != 'h') {
                return fail("ParamType defaultString mismatch");
            }
        }

        {
            // Config decode: SeqType (basic Dat2-style frame ids).
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // Bytes:
            // [1][count=2]
            //   lengths: [0x0003][0x0004]
            //   frameId lows: [0x0011][0x0022]
            //   frameId highs: [0x0001][0x0000] => ids: 0x0001_0011, 0x0000_0022
            // [2][frameStep=0x0010]
            // [3][maskCount=2][5][6]
            // [8][maxLoops=7]
            // [15] tweened=true (non-oldschool)
            // [0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(26);
            if (!rr.isOk()) {
                return fail("SeqType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0;
            fileBytes[off++] = 2;
            fileBytes[off++] = 0;
            fileBytes[off++] = 3;
            fileBytes[off++] = 0;
            fileBytes[off++] = 4;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0x11;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0x22;
            fileBytes[off++] = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;
            fileBytes[off++] = 2;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0x10;
            fileBytes[off++] = 3;
            fileBytes[off++] = 2;
            fileBytes[off++] = 5;
            fileBytes[off++] = 6;
            fileBytes[off++] = 8;
            fileBytes[off++] = 7;
            fileBytes[off++] = 15;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("SeqType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::SeqTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("SeqTypeLoader::fromArchive failed");
            }
            rs::SeqTypeLoader loader = rs::move(loaderRes.value());

            const rs::SeqType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("SeqTypeLoader.get(0) expected Ok");
            }
            if (t->frameIds.size() != 2 || t->frameLengths.size() != 2) {
                return fail("SeqType frame array sizes mismatch");
            }
            if (t->frameLengths[0] != 3 || t->frameLengths[1] != 4) {
                return fail("SeqType frameLengths mismatch");
            }
            if (t->frameIds[0] != ((1 << 16) | 0x0011) || t->frameIds[1] != 0x0022) {
                return fail("SeqType frameIds mismatch");
            }
            if (t->frameStep != 0x0010 || !t->looping || t->maxLoops != 7 || !t->tweened) {
                return fail("SeqType scalar fields mismatch");
            }
            if (t->masks.size() != 3 || t->masks[0] != 5 || t->masks[1] != 6 || t->masks[2] != 9999999) {
                return fail("SeqType masks mismatch");
            }
        }

        {
            // Config decode: SpotAnimType (scales + recolor/retexture).
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // Bytes:
            // [1][model=0x0123][2][seq=0x0456][4][w=0x00C8][5][h=0x00C9]
            // [40][n=1][from=0x0011][to=0x0022]
            // [41][n=1][from=0x0033][to=0x0044]
            // [0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 2 + 1 + 2 + 1 + 2 + 1 + 2 + (1 + 1 + 2 + 2) + (1 + 1 + 2 + 2) + 1);
            if (!rr.isOk()) {
                return fail("SpotAnimType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0x01;
            fileBytes[off++] = 0x23;
            fileBytes[off++] = 2;
            fileBytes[off++] = 0x04;
            fileBytes[off++] = 0x56;
            fileBytes[off++] = 4;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0xC8;
            fileBytes[off++] = 5;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0xC9;
            fileBytes[off++] = 40;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x11;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x22;
            fileBytes[off++] = 41;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x33;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x44;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("SpotAnimType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::SpotAnimTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("SpotAnimTypeLoader::fromArchive failed");
            }
            rs::SpotAnimTypeLoader loader = rs::move(loaderRes.value());

            const rs::SpotAnimType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("SpotAnimTypeLoader.get(0) expected Ok");
            }
            if (t->modelId != 0x0123 || t->sequenceId != 0x0456) {
                return fail("SpotAnimType ids mismatch");
            }
            if (t->widthScale != 0x00C8 || t->heightScale != 0x00C9) {
                return fail("SpotAnimType scales mismatch");
            }
            if (t->recolorFrom.size() != 1 || t->retextureFrom.size() != 1) {
                return fail("SpotAnimType array sizes mismatch");
            }
            if (t->recolorFrom[0] != 0x0011 || t->recolorTo[0] != 0x0022) {
                return fail("SpotAnimType recolor mismatch");
            }
            if (t->retextureFrom[0] != 0x0033 || t->retextureTo[0] != 0x0044) {
                return fail("SpotAnimType retexture mismatch");
            }
        }

        {
            // Config decode: InvType.
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 2 + 1);
            if (!rr.isOk()) {
                return fail("InvType: OOM");
            }
            fileBytes[0] = 2;
            fileBytes[1] = 0x00;
            fileBytes[2] = 0x10;
            fileBytes[3] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("InvType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::InvTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("InvTypeLoader::fromArchive failed");
            }
            rs::InvTypeLoader loader = rs::move(loaderRes.value());

            const rs::InvType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || t->itemCount != 16) {
                return fail("InvType decoded fields mismatch");
            }
        }

        {
            // Config decode: StructType (params map).
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Oldschool,
                .environment = "test",
                .revision = 220,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // [249][count=2]
            //   [isStr=0][key=0x010203][int=0x11223344]
            //   [isStr=1][key=0x000001]["hi\0"]
            // [0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 1 + (1 + 3 + 4) + (1 + 3 + 3) + 1);
            if (!rr.isOk()) {
                return fail("StructType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 249;
            fileBytes[off++] = 2;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0x01;
            fileBytes[off++] = 0x02;
            fileBytes[off++] = 0x03;
            fileBytes[off++] = 0x11;
            fileBytes[off++] = 0x22;
            fileBytes[off++] = 0x33;
            fileBytes[off++] = 0x44;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x01;
            fileBytes[off++] = static_cast<rs::u8>('h');
            fileBytes[off++] = static_cast<rs::u8>('i');
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("StructType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::StructTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("StructTypeLoader::fromArchive failed");
            }
            rs::StructTypeLoader loader = rs::move(loaderRes.value());

            const rs::StructType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("StructTypeLoader.get(0) expected Ok");
            }
            if (t->params.keys.size() != 2 || t->params.values.size() != 2) {
                return fail("StructType params size mismatch");
            }
            if (t->params.keys[0] != 0x010203 || t->params.values[0].isString || t->params.values[0].intValue != 0x11223344) {
                return fail("StructType param0 mismatch");
            }
            if (t->params.keys[1] != 1 || !t->params.values[1].isString || t->params.values[1].stringValue.len != 2) {
                return fail("StructType param1 mismatch");
            }
        }

        {
            // Config decode: BasType (idle/walk + rotate/translate block).
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 667,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // [1][idle=0x0001][walk=0x0002][27][slot=2][6 * i16][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 2 + 2 + 1 + 1 + (6 * 2) + 1);
            if (!rr.isOk()) {
                return fail("BasType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0;
            fileBytes[off++] = 2;
            fileBytes[off++] = 27;
            fileBytes[off++] = 2;
            for (int i = 0; i < 6; i++) {
                fileBytes[off++] = 0;
                fileBytes[off++] = static_cast<rs::u8>(i + 1);
            }
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("BasType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::BasTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("BasTypeLoader::fromArchive failed");
            }
            rs::BasTypeLoader loader = rs::move(loaderRes.value());

            const rs::BasType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || t->idleSeqId != 1 || t->walkSeqId != 2 || !t->hasModelRotateTranslate[2]) {
                return fail("BasType decoded fields mismatch");
            }
        }

        {
            // Config decode: QuestType (verstring) + post() sortName fallback.
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // [1][0]["Q\0"][15][pointsReq=0x000A][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 1 + 2 + 1 + 2 + 1);
            if (!rr.isOk()) {
                return fail("QuestType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0;
            fileBytes[off++] = static_cast<rs::u8>('Q');
            fileBytes[off++] = 0;
            fileBytes[off++] = 15;
            fileBytes[off++] = 0;
            fileBytes[off++] = 10;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("QuestType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::QuestTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("QuestTypeLoader::fromArchive failed");
            }
            rs::QuestTypeLoader loader = rs::move(loaderRes.value());

            const rs::QuestType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || !t->hasName || !t->hasSortName || t->sortName.len != 1) {
                return fail("QuestType decoded fields mismatch");
            }
        }

        {
            // Config decode: MapSceneType.
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // [1][sprite=0x0010][2][rgb=0x112233][3][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 2 + 1 + 3 + 1 + 1);
            if (!rr.isOk()) {
                return fail("MapSceneType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0x10;
            fileBytes[off++] = 2;
            fileBytes[off++] = 0x11;
            fileBytes[off++] = 0x22;
            fileBytes[off++] = 0x33;
            fileBytes[off++] = 3;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("MapSceneType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::MapSceneTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("MapSceneTypeLoader::fromArchive failed");
            }
            rs::MapSceneTypeLoader loader = rs::move(loaderRes.value());

            const rs::MapSceneType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || t->spriteId != 0x10 || t->colorRgb != 0x112233 || !t->enlarge) {
                return fail("MapSceneType decoded fields mismatch");
            }
        }

        {
            // Config decode: MapElementType.
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Oldschool,
                .environment = "test",
                .revision = 220,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // [1][bigSmart=0x0012][3]["name\0"][10]["op\0"][249][count=1][isStr=0][key=0x000001][int=7][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(2 + 1 + 5 + 1 + 3 + 1 + 1 + (1 + 1 + 3 + 4) + 1);
            if (!rr.isOk()) {
                return fail("MapElementType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0x12;
            fileBytes[off++] = 3;
            fileBytes[off++] = static_cast<rs::u8>('n');
            fileBytes[off++] = static_cast<rs::u8>('a');
            fileBytes[off++] = static_cast<rs::u8>('m');
            fileBytes[off++] = static_cast<rs::u8>('e');
            fileBytes[off++] = 0;
            fileBytes[off++] = 10;
            fileBytes[off++] = static_cast<rs::u8>('o');
            fileBytes[off++] = static_cast<rs::u8>('p');
            fileBytes[off++] = 0;
            fileBytes[off++] = 249;
            fileBytes[off++] = 1;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x01;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x00;
            fileBytes[off++] = 0x07;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("MapElementType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::MapElementTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("MapElementTypeLoader::fromArchive failed");
            }
            rs::MapElementTypeLoader loader = rs::move(loaderRes.value());

            const rs::MapElementType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || t->spriteId != 0x12 || !t->hasName || t->name.len != 4 || !t->hasOp[0] || t->params.keys.size() != 1) {
                return fail("MapElementType decoded fields mismatch");
            }
        }

        {
            // Config decode: LocType (name + action => interactive in post()).
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // [2]["door\0"][30]["Open\0"][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 5 + 1 + 5 + 1);
            if (!rr.isOk()) {
                return fail("LocType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 2;
            fileBytes[off++] = static_cast<rs::u8>('d');
            fileBytes[off++] = static_cast<rs::u8>('o');
            fileBytes[off++] = static_cast<rs::u8>('o');
            fileBytes[off++] = static_cast<rs::u8>('r');
            fileBytes[off++] = 0;
            fileBytes[off++] = 30;
            fileBytes[off++] = static_cast<rs::u8>('O');
            fileBytes[off++] = static_cast<rs::u8>('p');
            fileBytes[off++] = static_cast<rs::u8>('e');
            fileBytes[off++] = static_cast<rs::u8>('n');
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("LocType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::LocTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("LocTypeLoader::fromArchive failed");
            }
            rs::LocTypeLoader loader = rs::move(loaderRes.value());

            const rs::LocType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || t->name.len != 4 || t->isInteractive != 1) {
                return fail("LocType decoded fields mismatch");
            }
        }

        {
            // Config decode: NpcType (name + action).
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // [2]["bob\0"][12][2][30]["Talk-to\0"][95][0x0010][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 4 + 1 + 1 + 1 + 8 + 1 + 2 + 1);
            if (!rr.isOk()) {
                return fail("NpcType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 2;
            fileBytes[off++] = static_cast<rs::u8>('b');
            fileBytes[off++] = static_cast<rs::u8>('o');
            fileBytes[off++] = static_cast<rs::u8>('b');
            fileBytes[off++] = 0;
            fileBytes[off++] = 12;
            fileBytes[off++] = 2;
            fileBytes[off++] = 30;
            fileBytes[off++] = static_cast<rs::u8>('T');
            fileBytes[off++] = static_cast<rs::u8>('a');
            fileBytes[off++] = static_cast<rs::u8>('l');
            fileBytes[off++] = static_cast<rs::u8>('k');
            fileBytes[off++] = static_cast<rs::u8>('-');
            fileBytes[off++] = static_cast<rs::u8>('t');
            fileBytes[off++] = static_cast<rs::u8>('o');
            fileBytes[off++] = 0;
            fileBytes[off++] = 95;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0x10;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("NpcType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::NpcTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("NpcTypeLoader::fromArchive failed");
            }
            rs::NpcTypeLoader loader = rs::move(loaderRes.value());

            const rs::NpcType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || t->name.len != 3 || t->size != 2 || t->combatLevel != 0x10 || !t->hasAction[0]) {
                return fail("NpcType decoded fields mismatch");
            }
        }

        {
            // Config decode: ObjType (hidden ground action is cleared).
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // [2]["item\0"][11][30]["hidden\0"][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 5 + 1 + 1 + 1 + 7 + 1);
            if (!rr.isOk()) {
                return fail("ObjType: OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 2;
            fileBytes[off++] = static_cast<rs::u8>('i');
            fileBytes[off++] = static_cast<rs::u8>('t');
            fileBytes[off++] = static_cast<rs::u8>('e');
            fileBytes[off++] = static_cast<rs::u8>('m');
            fileBytes[off++] = 0;
            fileBytes[off++] = 11;
            fileBytes[off++] = 30;
            fileBytes[off++] = static_cast<rs::u8>('h');
            fileBytes[off++] = static_cast<rs::u8>('i');
            fileBytes[off++] = static_cast<rs::u8>('d');
            fileBytes[off++] = static_cast<rs::u8>('d');
            fileBytes[off++] = static_cast<rs::u8>('e');
            fileBytes[off++] = static_cast<rs::u8>('n');
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("ObjType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::ObjTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("ObjTypeLoader::fromArchive failed");
            }
            rs::ObjTypeLoader loader = rs::move(loaderRes.value());

            const rs::ObjType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || t->name.len != 4 || t->stackability != rs::ObjStackability::Always || t->hasGroundAction[0]) {
                return fail("ObjType decoded fields mismatch");
            }
        }

        std::cout << "OK\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "ERROR: " << e.what() << "\n";
        return 2;
    }
}
